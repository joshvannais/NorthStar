'use strict';
const { normalizeLinkRead, readExecutionLink } = require('../../src/operations/executionLinks');
const { overview, record } = require('../helpers/m23-part9b-overview-fixture');
const id = n => `e4900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { organizationId:id(1), actorUserId:id(2), actorAccessRole:'owner', authSessionId:id(3), appointmentId:id(4), graphId:id(5), customerId:id(6) };
function poolFor(options = {}) {
  const calls = [];
  const client = { query:jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('canonical_operational_overview_read')) {
      if (options.error) throw options.error;
      return { rows:[{ result:overview('owner_admin', { filter:'all', pagination:{limit:100,offset:0,returned:1,total:1,nextCursor:null}, records:[record('owner_admin',{ appointmentId:input.appointmentId, executionId:id(7) })] }) }] };
    }
    if (sql.includes('canonical_appointments')) return { rowCount:options.missing ? 0 : 1, rows:options.missing ? [] : [{ appointment_id:id(4),graph_id:id(5),customer_id:id(6) }] };
    return { rows:[],rowCount:0 };
  }), release:jest.fn() };
  return { connect:jest.fn(async()=>client),client,calls };
}
test('normalizes only exact UUID selectors without user supplied authority', () => {
  expect(normalizeLinkRead(id(4),{graphId:id(5),customerId:id(6)})).toEqual({appointmentId:id(4),graphId:id(5),customerId:id(6)});
  for (const query of [{},{graphId:id(5),customerId:id(6),role:'owner'},{graphId:[id(5)],customerId:id(6)},{graphId:id(5),customerId:'same-name'}]) expect(()=>normalizeLinkRead(id(4),query)).toThrow();
});
test('resolves exact server-backed association to fixed owner destination in read-only snapshot', async()=>{
  const pool = poolFor(); const value = await readExecutionLink(pool,input);
  expect(value).toMatchObject({version:'m23-part9-execution-link-v1',state:'available',appointmentId:id(4),graphId:id(5),customerId:id(6),executionId:id(7),href:`/dashboard/completion-review?executionId=${id(7)}`});
  expect(pool.calls[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  expect(pool.calls.some(call=>/INSERT|UPDATE|DELETE|canonical_field_executions/.test(call.sql))).toBe(false);
  expect(pool.calls.at(-1).sql).toBe('COMMIT'); expect(pool.client.release).toHaveBeenCalledTimes(1);
});
test.each(['member','viewer','dispatcher'])('withholds owner destination for %s before pool access',async role=>{
  const pool=poolFor(); await expect(readExecutionLink(pool,{...input,actorAccessRole:role})).rejects.toMatchObject({status:403}); expect(pool.connect).not.toHaveBeenCalled();
});
test('missing exact association returns unavailable, not a name match or unrelated record',async()=>{
  const pool=poolFor({missing:true}); const value=await readExecutionLink(pool,input); expect(value.state).toBe('unavailable'); expect(value.executionId).toBeNull();expect(value.href).toBeNull();
});
test('current authority failure rolls back and releases without disclosure',async()=>{
  const pool=poolFor({error:{code:'42501'}}); await expect(readExecutionLink(pool,input)).rejects.toMatchObject({status:403});expect(pool.calls.at(-1).sql).toBe('ROLLBACK');expect(pool.client.release).toHaveBeenCalledTimes(1);
});
test('client requires exact association and fixed same-origin destination',()=>{
  const {validate}=require('../../public/js/execution-links');
  const value={version:'m23-part9-execution-link-v1',state:'available',appointmentId:id(4),graphId:id(5),customerId:id(6),executionId:id(7),href:`/dashboard/completion-review?executionId=${id(7)}`};
  expect(validate(value,input)).toBe(value);
  for(const changed of [{...value,href:'https://example.test/'},{...value,customerId:id(8)},{...value,href:'/dashboard/work?appointmentId='+id(4)},{...value,role:'owner'},{...value,state:'unavailable'}])expect(()=>validate(changed,input)).toThrow();
});
test('malformed database response does not create a destination',async()=>{
  const pool=poolFor();pool.client.query.mockImplementation(async sql=>sql.includes('canonical_operational_overview_read')?{rows:[{result:{scope:'owner_admin',records:[]}}]}:{rows:[]});await expect(readExecutionLink(pool,input)).rejects.toMatchObject({status:503});expect(pool.client.release).toHaveBeenCalledTimes(1);
});
test.each([3,12])('bounded existing-entry pagination resolves only a proved match (target page %i)',async targetPage=>{
  const pool=poolFor();let pages=0;
  const original=pool.client.query.getMockImplementation();
  pool.client.query.mockImplementation(async(sql,params)=>{
    if(!sql.includes('canonical_operational_overview_read'))return original(sql,params);
    pages+=1;const recordId=id(30+pages),appointmentId=pages===targetPage?id(4):id(60+pages);
    const cursor={version:'m23-part9b-cursor-v1',state:'all',scopeDigest:'a'.repeat(64),dataDigest:'a'.repeat(64),cutoff:'2026-09-08T12:00:00.000000Z',lastCreatedAt:'2026-09-08T12:00:00.000000Z',lastId:recordId};
    return {rows:[{result:overview('owner_admin',{filter:'all',pagination:{limit:100,offset:pages-1,returned:1,total:12,nextCursor:pages<12?Buffer.from(JSON.stringify(cursor)).toString('base64url'):null},records:[record('owner_admin',{executionId:recordId,appointmentId})]})}]};
  });
  const value=await readExecutionLink(pool,input);expect(pages).toBe(Math.min(10,targetPage));expect(value.state).toBe(targetPage<=10?'available':'unavailable');expect(value.href).toBe(targetPage<=10?'/dashboard/completion-review?executionId='+id(30+targetPage):null);
});
test('stale current assignment does not produce a link',async()=>{
  const pool=poolFor();const original=pool.client.query.getMockImplementation();pool.client.query.mockImplementation(async(sql,params)=>{const result=await original(sql,params);if(sql.includes('canonical_operational_overview_read'))result.rows[0].result.records[0].assignment.current=false;return result;});expect((await readExecutionLink(pool,input)).state).toBe('unavailable');
});
