'use strict';
const request=require('supertest');
const {createDatabaseFixture}=require('../helpers/m23-part9-owner-completion-fixture');
const real=process.env.M19_PG_ADMIN_URL?describe:describe.skip;
real('exact execution links over mounted PostgreSQL runtime ACLs',()=>{
  let fixture;
  beforeAll(async()=>{jest.spyOn(require('https'),'request').mockImplementation(()=>{throw Error('External transport forbidden');});jest.spyOn(require('https'),'get').mockImplementation(()=>{throw Error('External transport forbidden');});fixture=await createDatabaseFixture();},180000);
  afterAll(async()=>{try{if(fixture)await fixture.cleanup();expect(require('https').request).not.toHaveBeenCalled();expect(require('https').get).not.toHaveBeenCalled();}finally{jest.restoreAllMocks();}},180000);
  async function selectors(work){return (await fixture.ownerPool.query('SELECT a.id AS "appointmentId",a.graph_id AS "graphId",o.customer_id AS "customerId" FROM canonical_appointments a JOIN canonical_opportunities o ON o.organization_id=a.organization_id AND o.id=a.opportunity_id WHERE a.organization_id=$1 AND a.id=$2',[work.actor.organizationId,work.appointment])).rows[0];}
  function get(value,actor='owner'){return request(fixture.app).get(`/api/v1/field-executions/links/appointments/${value.appointmentId}`).query({graphId:value.graphId,customerId:value.customerId}).set(fixture.actors[actor].session.headers);}
  test('owner/admin resolve work outside personal Today and destination independently authorizes',async()=>{
    const work=await fixture.createExecution(),ids=await selectors(work);
    for(const actor of ['owner','admin']){const response=await get(ids,actor);expect(response.status).toBe(200);expect(response.headers['cache-control']).toContain('no-store');expect(response.body.data).toMatchObject({...ids,state:'available',executionId:work.execution.id,href:`/dashboard/completion-review?executionId=${work.execution.id}`});
      const destination=await request(fixture.app).get(`/api/v1/field-executions/${work.execution.id}/completion-review`).set(fixture.actors[actor].session.headers);expect(destination.status).toBe(200);expect(destination.body.data.execution.id).toBe(work.execution.id);}
    const today=await request(fixture.app).get('/api/v1/today').set(fixture.actors.owner.session.headers);expect(today.status).toBe(200);expect(today.body.data.records.some(record=>record.appointmentId===work.appointment)).toBe(false);
  });
  test('dispatcher/member/viewer cannot discover owner links; unauthenticated remains401',async()=>{
    const ids=await selectors(await fixture.createExecution());for(const actor of ['dispatcher','member','viewer']){const response=await get(ids,actor);expect(response.status).toBe(403);expect(response.body).not.toHaveProperty('data');}
    expect((await request(fixture.app).get(`/api/v1/field-executions/links/appointments/${ids.appointmentId}`).query(ids)).status).toBe(401);
  });
  test('exact graph/customer/tenant mismatches cannot select same-name or unrelated work',async()=>{
    const first=await fixture.createExecution(),second=await fixture.createExecution(),a=await selectors(first),b=await selectors(second);
    for(const value of [{...a,graphId:b.graphId},{...a,customerId:b.customerId},{...a,appointmentId:b.appointmentId}]){const response=await get(value);expect(response.status).toBe(200);expect(response.body.data).toMatchObject({state:'unavailable',executionId:null,href:null});}
    const other=await get(a,'otherOwner');expect(other.status).toBe(200);expect(other.body.data.state).toBe('unavailable');expect(JSON.stringify(other.body)).not.toContain(first.execution.id);
  });
  test('completion proposal keeps the same identity without creating evidence',async()=>{
    const work=await fixture.createExecution(),ids=await selectors(work);await fixture.completion(work);
    const before=(await fixture.ownerPool.query('SELECT count(*) FROM canonical_completion_records WHERE execution_id=$1',[work.execution.id])).rows[0].count;
    const first=await get(ids);expect(first.body.data.executionId).toBe(work.execution.id);
    const after=(await fixture.ownerPool.query('SELECT count(*) FROM canonical_completion_records WHERE execution_id=$1',[work.execution.id])).rows[0].count;expect(after).toBe(before);
  });
  test('demo and unknown transcript sources fail closed without paid execution disclosure',async()=>{
    for(const source of ['demo','simulation','unknown']){const work=await fixture.createExecution(),ids=await selectors(work);await fixture.ownerPool.query('UPDATE canonical_transcripts SET source=$1 WHERE organization_id=$2 AND graph_id=$3',[source,work.actor.organizationId,ids.graphId]);const response=await get(ids);expect(response.status).toBe(200);expect(response.body.data.state).toBe('unavailable');}
  });
  test('malformed selectors reject before lookup, private execution table remains denied',async()=>{
    const ids=await selectors(await fixture.createExecution());expect((await request(fixture.app).get(`/api/v1/field-executions/links/appointments/${ids.appointmentId}`).query({graphId:ids.graphId,customerId:ids.customerId,role:'owner'}).set(fixture.actors.owner.session.headers)).status).toBe(400);
    await expect(fixture.runtimePool.query('SELECT id FROM canonical_field_executions LIMIT 1')).rejects.toMatchObject({code:'42501'});
  });
});
