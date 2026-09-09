'use strict';
const request = require('supertest');
const crypto = require('crypto');
const { handoff } = require('../../src/operations/handoffRepository');
const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
real('Mission 23 Part 11 mounted immutable downstream references', () => {
  let f, work;
  beforeAll(async () => {
    for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
    jest.spyOn(require('https'),'request').mockImplementation(() => { throw new Error('Provider transport forbidden'); });
    f = await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture();
    work = await f.createExecution({ title: 'Synthetic handoff work' });
  },180000);
  afterAll(async () => { try { if(f)await f.cleanup(); } finally { jest.restoreAllMocks(); } },180000);
  const read = (actor='owner',execution=work.execution.id) => request(f.app).get('/api/v1/field-executions/'+execution+'/handoffs').set(f.actors[actor].session.headers);
  const input = (actor='owner') => ({...f.actors[actor],executionId:work.execution.id});
  const body = (digest,mission=24) => ({action:'prepare',mission,audience:'tenant_owner_admin_review',consentVersion:'m23-internal-reference-consent-v1',consentConfirmed:true,sourceDigest:digest,targetId:null});
  const post = (data,key=crypto.randomUUID(),actor='owner') => request(f.app).post('/api/v1/field-executions/'+work.execution.id+'/handoff-actions')
    .set(f.actors[actor].session.headers).set('X-CSRF-Token',f.actors[actor].csrfToken).set('Idempotency-Key',key).send(data);
  test('fresh role-separated migration and mounted preview produce complete minimized references and explicit destination boundaries', async () => {
    const server=(await f.ownerPool.query("SELECT current_setting('server_version') AS version,current_setting('TimeZone') AS timezone,current_setting('server_encoding') AS encoding,current_setting('data_checksums') AS checksums")).rows[0];
    expect(server.version).toMatch(/^18\./);expect(server.timezone).toBe('UTC');expect(server.encoding).toBe('UTF8');expect(server.checksums).toBe('on');
    const r=await read(); expect(r.status).toBe(200); const d=r.body.data;
    expect(d.sourceSnapshot.execution).toMatchObject({id:work.execution.id,revision:work.execution.revision,digest:work.execution.digest});
    expect(d.sourceSnapshot.assignment).toMatchObject({id:work.assignment.id,digest:work.assignment.digest});
    expect(d.receipts).toEqual([]); expect(d.missions.map(m=>m.mission)).toEqual([24,25,26,27,28,29,30,31,32]);
    expect(d.missions.find(m=>m.mission===31).available).toBe(false); expect(d.consumptionAuthorized).toBe(false);
    expect(r.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(d)).not.toMatch(/Synthetic overview customer|lastReason|recordedByUserId|transcript_text|csrfToken|sessionId|@example/);
  });
  test('all eight permitted purposes record inert consent receipts; Mission 31 remains isolated', async () => {
    const digest=(await read()).body.data.sourceDigest;
    for(const mission of [24,25,26,27,28,29,30,32]) {
      const r=await post(body(digest,mission)); expect(r.status).toBe(201);
      expect(r.body.data.receipt).toMatchObject({mission,delivery:'unavailable',consumptionAuthorized:false,financialConsequence:false,customerConsequence:false});
    }
    expect((await post(body(digest,31))).status).toBe(400);
  });
  test('explicit consent, exact keys, supported audience, digest and query are required', async () => {
    const valid=body((await read()).body.data.sourceDigest);
    for(const change of [{consentConfirmed:false},{consentConfirmed:'true'},{consentVersion:'later'},{audience:'customer'},{mission:33},{sourceDigest:null},{extra:true},{targetId:crypto.randomUUID()}])
      expect((await post({...valid,...change})).status).toBe(400);
    expect((await request(f.app).get('/api/v1/field-executions/'+work.execution.id+'/handoffs?offset=1').set(f.actors.owner.session.headers)).status).toBe(400);
  });
  test('current HTTP and database tenant, individual membership, role and CSRF gates control both reads and writes', async () => {
    const valid=body((await read()).body.data.sourceDigest);
    expect((await request(f.app).get('/api/v1/field-executions/'+work.execution.id+'/handoffs')).status).toBe(401);
    for(const actor of ['member','dispatcher','viewer','otherOwner']) {
      expect([403,404]).toContain((await read(actor)).status); expect([403,404]).toContain((await post(valid,crypto.randomUUID(),actor)).status);
      await expect(handoff(f.runtimePool,input(actor))).rejects.toMatchObject({status:404});
    }
    expect((await read('admin')).status).toBe(200);
    await expect(handoff(f.runtimePool,{...input('member'),actorAccessRole:'owner'})).rejects.toMatchObject({status:404});
    await expect(handoff(f.runtimePool,{...input(),csrfToken:'x'.repeat(64),idempotencyKey:crypto.randomUUID()},valid)).rejects.toMatchObject({status:404});
  });
  test('same-key concurrent retry records exactly one immutable receipt and rejects a changed request', async () => {
    const data=body((await read()).body.data.sourceDigest),key=crypto.randomUUID();
    const results=await Promise.all([post(data,key),post(data,key),post(data,key)]); results.forEach(r=>expect(r.status).toBe(201));
    expect(new Set(results.map(r=>r.body.data.receipt.id)).size).toBe(1);
    expect(results.filter(r=>r.body.data.replayed).length).toBe(2);
    expect((await post({...data,mission:25},key)).status).toBe(409);
    const rows=await f.ownerPool.query('SELECT * FROM canonical_handoff_receipts WHERE id=$1',[results[0].body.data.receipt.id]);
    expect(rows.rowCount).toBe(1); expect(rows.rows[0].actor_user_id).toBe(f.actors.owner.actorUserId);
    expect(rows.rows[0].auth_session_id).toBe(f.actors.owner.authSessionId); expect(rows.rows[0].source_snapshot.execution.id).toBe(work.execution.id);
  });
  test('operational source change invalidates prepared source pins without changing historical receipts', async () => {
    const before=(await read()).body.data; const prepared=await post(body(before.sourceDigest));
    const progress=await f.progress(work); const after=(await read()).body.data;
    expect(after.sourceDigest).not.toBe(before.sourceDigest);
    expect(after.sourceSnapshot.progress.pins).toContainEqual({id:progress.id,revision:progress.revision,digest:progress.digest});
    expect(after.receipts.find(r=>r.id===prepared.body.data.receipt.id).status).toBe('source_changed');
    expect((await post(body(before.sourceDigest))).status).toBe(409);
    const stored=(await f.ownerPool.query('SELECT source_digest FROM canonical_handoff_receipts WHERE id=$1',[prepared.body.data.receipt.id])).rows[0];
    expect(stored.source_digest).toBe(before.sourceDigest);
  });
  test('consent revocation appends history and original idempotency replay cannot restore authority', async () => {
    const data=body((await read()).body.data.sourceDigest),key=crypto.randomUUID(); const prepared=await post(data,key);
    const revoke={...data,action:'revoke',targetId:prepared.body.data.receipt.id}; const revokeKey=crypto.randomUUID();
    const r=await post(revoke,revokeKey); expect(r.status).toBe(201); expect((await post(revoke,revokeKey)).body.data.replayed).toBe(true);
    expect((await post(revoke)).status).toBe(409);
    expect((await post(data,key)).body.data.receipt.consumptionAuthorized).toBe(false);
    const current=(await read()).body.data;
    expect(current.receipts.find(x=>x.id===prepared.body.data.receipt.id).status).toBe('revoked');
    expect(current.receipts.filter(x=>x.targetId===prepared.body.data.receipt.id)).toHaveLength(1);
  });
  test('handoff creation and revocation never mutate execution, source history, commercial records or providers', async () => {
    const counts=async()=> (await f.ownerPool.query(`SELECT (SELECT count(*) FROM canonical_field_execution_events) AS execution,
      (SELECT count(*) FROM canonical_labor_intervals) AS labor,(SELECT count(*) FROM canonical_material_movements) AS materials,
      (SELECT count(*) FROM canonical_progress_records) AS progress,(SELECT count(*) FROM canonical_completion_records) AS completion`)).rows;
    const before=await counts(); const data=body((await read()).body.data.sourceDigest); const r=await post(data);
    expect(r.status).toBe(201);expect((await post({...data,action:'revoke',targetId:r.body.data.receipt.id})).status).toBe(201);
    expect(await counts()).toEqual(before);expect(require('https').request).not.toHaveBeenCalled();
  });
  test('runtime has only guarded entries, while immutable receipt history resists ordinary owner edits', async () => {
    const permissions=(await f.runtimePool.query("SELECT has_table_privilege(current_user,'canonical_handoff_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS table_access,has_function_privilege(current_user,'canonical_handoff_snapshot(uuid,uuid,text,uuid,uuid)','EXECUTE') AS helper")).rows[0];
    expect(permissions).toEqual({table_access:false,helper:false});
    await expect(f.ownerPool.query('UPDATE canonical_handoff_receipts SET audience=audience WHERE organization_id=$1',[f.org])).rejects.toMatchObject({code:'23514'});
    await expect(f.ownerPool.query('DELETE FROM canonical_handoff_receipts WHERE organization_id=$1',[f.org])).rejects.toMatchObject({code:'23514'});
  });
  test('migration restart is zero-op and retains original receipts and exact migration ledger', async () => {
    const before=(await f.ownerPool.query('SELECT * FROM _migrations ORDER BY 1')).rows;
    const receipts=(await f.ownerPool.query('SELECT * FROM canonical_handoff_receipts ORDER BY id')).rows;
    expect(await f.db.initDatabase()).toBe(true);
    expect((await f.ownerPool.query('SELECT * FROM _migrations ORDER BY 1')).rows).toEqual(before);
    expect((await f.ownerPool.query('SELECT * FROM canonical_handoff_receipts ORDER BY id')).rows).toEqual(receipts);
  });
  test('revoked membership denies even exact cached replay before disclosure', async () => {
    const data=body((await read()).body.data.sourceDigest),key=crypto.randomUUID();expect((await post(data,key,'admin')).status).toBe(201);
    await f.ownerPool.query("UPDATE organization_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE organization_id=$1 AND user_id=$2",[f.org,f.actors.admin.actorUserId]);
    expect([401,403,404]).toContain((await post(data,key,'admin')).status);
    await expect(handoff(f.runtimePool,{...input('admin'),idempotencyKey:key},data)).rejects.toMatchObject({status:404});
  });
  test('the history bound fails clearly while every existing consent can still be revoked',async()=>{
    const snapshot=(await read()).body.data,existing=snapshot.receipts.filter(r=>r.action==='prepare').length;
    for(let i=existing;i<50;i++)expect((await post(body(snapshot.sourceDigest))).status).toBe(201);
    expect((await post(body(snapshot.sourceDigest))).status).toBe(429);
    const current=(await read()).body.data;expect(current.receipts.filter(r=>r.action==='prepare')).toHaveLength(50);
    const target=current.receipts.find(r=>r.action==='prepare'&&r.status!=='revoked');
    expect((await post({...body(target.sourceDigest,target.mission),action:'revoke',targetId:target.id})).status).toBe(201);
  });
  test('an unavailable source snapshot prevents preparation while retaining consent revocation and historical replay',async()=>{
    const snapshot=(await read()).body.data,target=snapshot.receipts.find(r=>r.action==='prepare'&&r.status!=='revoked');
    const definition=(await f.ownerPool.query("SELECT pg_get_functiondef('canonical_handoff_snapshot(uuid,uuid,text,uuid,uuid)'::regprocedure) AS definition")).rows[0].definition;
    try {
      // Explicit local dependency-failure fixture, not evidence of 1,001 real source records.
      await f.ownerPool.query("CREATE OR REPLACE FUNCTION public.canonical_handoff_snapshot(org uuid,actor uuid,role_value text,session_value uuid,work uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'synthetic source bound' USING ERRCODE='54000'; END $$");
      const unavailable=await read();expect(unavailable.status).toBe(200);expect(unavailable.body.data.sourceAvailable).toBe(false);
      expect(unavailable.body.data.sourceSnapshot).toBeNull();expect(unavailable.body.data.sourceDigest).toBeNull();
      expect(unavailable.body.data.receipts.find(r=>r.id===target.id).status).toBe('source_unavailable');
      expect((await post(body(snapshot.sourceDigest))).status).toBe(429);
      const revoke={...body(target.sourceDigest,target.mission),action:'revoke',targetId:target.id},key=crypto.randomUUID();
      expect((await post(revoke,key)).status).toBe(201);expect((await post(revoke,key)).body.data.replayed).toBe(true);
    } finally {await f.ownerPool.query(definition);}
  });
});
