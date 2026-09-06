'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { mutateFieldEvidence } = require('../../src/fieldEvidence/repository');
const { normalizeEvidenceAction, AD_HOC_TEMPLATE_DIGEST, AD_HOC_TEMPLATE_VERSION } = require('../../src/fieldEvidence/contract');

const conditional = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const q = value => '"' + value.replace(/"/g, '""') + '"';
const IDS = Object.freeze({ org: 'e1000000-0000-4000-8000-000000000001', otherOrg: 'e1000000-0000-4000-8000-000000000002',
  owner: 'e2000000-0000-4000-8000-000000000001', member: 'e2000000-0000-4000-8000-000000000002',
  viewer: 'e2000000-0000-4000-8000-000000000003', otherOwner: 'e2000000-0000-4000-8000-000000000004' });
const digest = character => character.repeat(64);

conditional('Mission 23 Part 7 mounted PostgreSQL progress and issue authority', () => {
  let database, ownerPool, runtimePool, roles, db, session, memberSession, execution, assignment, actor, app;

  beforeAll(async () => {
    database = await createSuiteDatabase('m23_part7');
    roles = { owner: `m23p7_owner_${process.pid}`, runtime: `m23p7_runtime_${process.pid}` };
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
    try {
      await admin.query(`CREATE ROLE ${q(roles.owner)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await admin.query(`CREATE ROLE ${q(roles.runtime)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await admin.query(`ALTER DATABASE ${q(database.databaseName)} OWNER TO ${q(roles.owner)}`);
    } finally { await admin.end(); }
    const url = role => { const parsed = new URL(database.connectionString); parsed.username = role; parsed.password = ''; return parsed.toString(); };
    ownerPool = new Pool({ connectionString: url(roles.owner), max: 5 });
    runtimePool = new Pool({ connectionString: url(roles.runtime), max: 5 });
    process.env.DATABASE_URL = url(roles.runtime); process.env.MIGRATION_DATABASE_URL = url(roles.owner);
    db = require('../../src/db');
    await db.runMigrations({ pool: ownerPool, runtimePool });
    for (const [org, name, email] of [[IDS.org, 'Field evidence test', 'field@example.test'], [IDS.otherOrg, 'Other field test', 'other-field@example.test']]) {
      await ownerPool.query('INSERT INTO organizations(id,name,email) VALUES($1,$2,$3)', [org, name, email]);
    }
    for (const [id, org, role] of [[IDS.owner, IDS.org, 'owner'], [IDS.member, IDS.org, 'member'], [IDS.viewer, IDS.org, 'viewer'], [IDS.otherOwner, IDS.otherOrg, 'owner']]) {
      await ownerPool.query("INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,'Field evidence actor',$3,'unused',$4,'active')", [id, org, `${id}@example.test`, role]);
      await ownerPool.query("INSERT INTO organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,$3,'active')", [id, org, role]);
    }
    const raw = { company: { name: 'Field evidence test', timeZone: 'UTC' }, headquarters: {}, services: [] };
    const normalized = adaptBusinessProfile(raw, 'org-profile-v1');
    await ownerPool.query("INSERT INTO canonical_business_profiles(organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,1,'org-profile-v1',$2,$3,$4,true,$5)", [IDS.org, raw, normalized, normalized.hash, IDS.owner]);
    session = await provisionDurableSession(ownerPool, { organizationId: IDS.org, userId: IDS.owner, membershipId: IDS.owner, role: 'owner' });
    memberSession = await provisionDurableSession(ownerPool, { organizationId: IDS.org, userId: IDS.member, membershipId: IDS.member, role: 'member' });
    actor = { organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner', authSessionId: session.sessionId, csrfToken: session.csrfToken };
    const operation = crypto.randomUUID(), graph = crypto.randomUUID(), customer = crypto.randomUUID(), transcript = crypto.randomUUID(), opportunity = crypto.randomUUID(), appointment = crypto.randomUUID();
    await ownerPool.query("INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at) VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())", [operation, IDS.org, graph, digest('1')]);
    await ownerPool.query("INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Field fixture customer')", [customer, IDS.org, operation, graph]);
    await ownerPool.query("INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,source,source_version,transcript_text,normalized_fingerprint) VALUES($1,$2,$3,$4,$5,'lead','fixture','Field evidence request',$6)", [transcript, IDS.org, operation, graph, customer, digest('2')]);
    await ownerPool.query("INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','{}')", [opportunity, IDS.org, operation, graph, customer]);
    await ownerPool.query("INSERT INTO canonical_appointments(id,organization_id,operation_id,graph_id,opportunity_id,scheduled_start,scheduled_end,status) VALUES($1,$2,$3,$4,$5,'2027-06-15T13:00:00Z','2027-06-15T14:00:00Z','scheduled')", [appointment, IDS.org, operation, graph, opportunity]);
    await ownerPool.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
    try {
      assignment = (await ownerPool.query("UPDATE canonical_schedule_assignments SET target_state='assigned',workforce_profile_id=$2,schedule_state='scheduled',dispatch_state='dispatched',needs_review=false,review_reasons='[]',revision=4,canonical_digest=canonical_schedule_assignment_digest('assigned',$2,NULL,'scheduled','dispatched',scheduled_start,scheduled_end,appointment_status,false,'[]'),last_action_code='dispatch',last_reason='Accepted field evidence fixture',updated_at=transaction_timestamp() WHERE appointment_id=$1 RETURNING id,revision,rtrim(canonical_digest) AS digest", [appointment, IDS.member])).rows[0];
    } finally { await ownerPool.query('ALTER TABLE canonical_schedule_assignments ENABLE TRIGGER USER'); }
    const operations = require('../../src/operations/repository');
    execution = (await operations.initializeFieldExecution(runtimePool, { ...actor, appointmentId: appointment,
      expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      idempotencyKey: crypto.randomUUID(), reason: 'Initialize field evidence execution', requestCorrelationId: 'p6-init' })).body.data;
    execution = (await operations.transitionFieldExecution(runtimePool, { ...actor, executionId: execution.id,
      expectedRevision: execution.revision, expectedDigest: execution.digest,
      expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      action: 'start', idempotencyKey: crypto.randomUUID(), reason: 'Start field evidence execution', requestCorrelationId: 'p6-start' })).body.data;
    const actorMiddleware = (req, _res, next) => { req.tenantContext = { organizationId: IDS.org, userId: IDS.owner }; req.accountAuthority = { membership_id: IDS.owner }; req.userRole = 'owner'; req.authSession = { id: session.sessionId }; next(); };
    app = express(); app.use(require('../../src/operations/httpBoundary').executionBodyBoundary); app.use(express.json());
    app.use('/api/v1/field-executions', require('../../src/routes/fieldExecutions').createFieldExecutionsRouter({
      poolProvider: () => runtimePool, tenantAuth: actorMiddleware, mutationAuth: actorMiddleware,
      permission: () => (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    app.use(require('../../src/middleware/errorHandler').errorHandler);
  }, 120000);

  afterAll(async () => {
    if (ownerPool) await ownerPool.end(); if (runtimePool) await runtimePool.end(); if (db) await db.close().catch(() => {});
    if (database) await database.cleanup();
    if (roles) { const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect(); try {
      await admin.query(`DROP ROLE IF EXISTS ${q(roles.runtime)}`); await admin.query(`DROP ROLE IF EXISTS ${q(roles.owner)}`);
    } finally { await admin.end(); } }
    delete process.env.DATABASE_URL; delete process.env.MIGRATION_DATABASE_URL;
  });

  const common = action => ({ action, performerProfileId: IDS.member,
    expectedExecutionRevision: execution.revision, expectedExecutionDigest: execution.digest,
    expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
    reason: 'Attributable deterministic field evidence.' });
  async function mutate(body, key = crypto.randomUUID(), overrides = {}) {
    const normalized = require('../../src/progress/contract').normalizeProgressAction({ ...actor, ...overrides, executionId: execution.id, idempotencyKey: key, body });
    return require('../../src/progress/repository').mutateProgress(runtimePool, { ...normalized, csrfToken: overrides.csrfToken || session.csrfToken, requestCorrelationId: 'p6-evidence' });
  }


  let timeZoneAuthority;
  async function observation() {
    if (!timeZoneAuthority) {
      const row=(await ownerPool.query('SELECT id,version_number,normalized_profile_hash FROM canonical_business_profiles WHERE organization_id=$1 AND is_active',[IDS.org])).rows[0];
      timeZoneAuthority={businessProfileId:row.id,version:Number(row.version_number),hash:row.normalized_profile_hash.trim(),timeZone:'UTC'};
    }
    return {observedAt:'2026-09-01T12:00:00Z',timeZoneAuthority,evidence:[]};
  }
  async function progress() { return {kind:'progress',workKey:'paving-'+crypto.randomUUID(),description:'Measured field work.',...await observation(),
    quantity:{completed:'2.5',total:'10',unit:'m2'},milestone:null,uncertainty:'measured',uncertaintyReason:null}; }
  const read = (overrides={}) => require('../../src/progress/repository').readProgress(runtimePool,{...actor,executionId:execution.id,limit:50,cursor:null,...overrides});
  const body = async (action='record_progress',document) => ({...common(action),document:document||await progress()});
  const edit = (record,action,document) => ({...common(action),recordId:record.id,expectedRecordRevision:record.revision,expectedRecordDigest:record.digest,document});
  test('mounted production router accepts operational progress and no lifecycle mutation',async()=>{
    const input=await body();
    const response=await request(app).post('/api/v1/field-executions/'+execution.id+'/progress-actions')
      .set('Idempotency-Key',crypto.randomUUID()).set('X-CSRF-Token',session.csrfToken).send(input);
    expect(response.status).toBe(201);
    expect(response.body.data.document.quantity.completed).toBe('2.5');
    expect(response.body.data.authorityBoundary).toMatchObject({commercialConsequences:false,authorizationToContinue:false});
    expect((await ownerPool.query('SELECT lifecycle_state FROM canonical_field_executions WHERE id=$1',[execution.id])).rows[0].lifecycle_state).toBe('in_progress');
  });
  test('atomic exact replay and concurrent same-key produce one immutable fact',async()=>{
    const input=await body(),key=crypto.randomUUID();
    const results=await Promise.all([mutate(input,key),mutate(input,key)]);
    expect(results.filter(r=>r.replayed)).toHaveLength(1); expect(results[0].body).toEqual(results[1].body);
    await expect(mutate({...input,reason:'Changed semantic reason.'},key)).rejects.toMatchObject({status:409});
    const id=results[0].body.data.id;
    const counts=(await ownerPool.query('SELECT (SELECT count(*) FROM canonical_progress_records WHERE id=$1)::int records,(SELECT count(*) FROM canonical_progress_events WHERE record_id=$1)::int events,(SELECT count(*) FROM canonical_progress_audit_events WHERE record_id=$1)::int audits,(SELECT count(*) FROM canonical_progress_idempotency WHERE record_id=$1)::int receipts',[id])).rows[0];
    expect(counts).toEqual({records:1,events:1,audits:1,receipts:1});
  });
  test('explicit full quantity and pinned checklist milestone do not infer execution completion',async()=>{
    const checklist=(await mutateFieldEvidence(runtimePool,{...normalizeEvidenceAction({...actor,executionId:execution.id,idempotencyKey:crypto.randomUUID(),
      body:{...common('create_checklist'),template:null,items:[{key:'prep',prompt:'Record preparation observed.',required:true}]}}),
      csrfToken:session.csrfToken,requestCorrelationId:'p7-milestone'})).body.data;
    expect(checklist.document).toMatchObject({adHocTemplateVersion:AD_HOC_TEMPLATE_VERSION,adHocTemplateDigest:AD_HOC_TEMPLATE_DIGEST});
    const input=await body();input.document.quantity={completed:'10',total:'10',unit:'m2'};
    input.document.milestone={key:'prep',state:'done',checklist:{id:checklist.id,revision:checklist.revision,digest:checklist.digest}};
    const fact=(await mutate(input)).body.data;
    expect(fact.authorityBoundary).toMatchObject({percentComplete:null,executionLifecycleChanged:false});
    expect((await ownerPool.query('SELECT count(*)::int count FROM canonical_progress_evidence_links WHERE record_id=$1',[fact.id])).rows[0].count).toBe(1);
    const corrupted=await body();corrupted.document.milestone={...input.document.milestone,checklist:{...input.document.milestone.checklist,digest:digest('f')}};
    await expect(mutate(corrupted)).rejects.toMatchObject({status:403});
    expect((await ownerPool.query('SELECT lifecycle_state FROM canonical_field_executions WHERE id=$1',[execution.id])).rows[0].lifecycle_state).toBe('in_progress');
  });
  test('progress updates require exact predecessor and preserve correction history',async()=>{
    const original=(await mutate(await body())).body.data;
    const changed={...await progress(),workKey:original.document.workKey,quantity:{completed:'5',total:'10',unit:'m2'}};
    const updated=(await mutate(edit(original,'update_progress',changed))).body.data;
    expect(updated).toMatchObject({rootId:original.id,previousRecordId:original.id,revision:2});
    await expect(mutate(edit(original,'update_progress',changed))).rejects.toMatchObject({status:409});
    const lower={...await progress(),workKey:original.document.workKey};
    await expect(mutate(edit(updated,'update_progress',lower))).rejects.toMatchObject({status:400});
    const correction=(await mutate(edit(updated,'correct',lower))).body.data;
    expect(correction.revision).toBe(3);
    expect((await ownerPool.query('SELECT count(*)::int count FROM canonical_progress_records WHERE root_id=$1',[original.id])).rows[0].count).toBe(3);
  });
  test.each(['blocker','exception'])('%s retains unresolved history and explicit resolution evidence, independent of lifecycle',async(kind)=>{
    const document={kind,description:'Material delivery is missing.',...await observation(),category:'material',impact:'prevents_work',
      severity:'moderate',followUp:{profileId:IDS.member,action:'Confirm the delivery facts.'},state:'open',resolution:null};
    const original=(await mutate(await body('record_'+kind,document))).body.data;
    const note=(await mutateFieldEvidence(runtimePool,{...normalizeEvidenceAction({...actor,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{...common('record_note'),note:'Delivery was observed at the staging area.',caption:null}}),csrfToken:session.csrfToken,requestCorrelationId:'p7-resolution'})).body.data;
    const resolution={description:'Delivery observed.',observedAt:'2026-09-01T12:30:00Z',evidence:[{id:note.id,revision:note.revision,digest:note.digest}]};
    const resolved=(await mutate(edit(original,'issue_state',{state:'resolved',resolution}))).body.data;
    expect(resolved.document.state).toBe('resolved'); expect(resolved.previousRecordId).toBe(original.id);
    expect((await ownerPool.query('SELECT document FROM canonical_progress_records WHERE id=$1',[original.id])).rows[0].document.state).toBe('open');
    await expect(mutate(edit(resolved,'correct',{...document,state:'open',resolution:null}))).rejects.toMatchObject({status:400});
    const reactivated=(await mutate(edit(resolved,'issue_state',{state:'open',resolution:null}))).body.data;
    expect(reactivated.previousRecordId).toBe(resolved.id);
    expect((await read()).body.summary.unresolvedIssues).toBeGreaterThan(0);
  });
  test('field change facts and owner or own-worker review never approve commercial consequences',async()=>{
    const document={kind:'field_change',description:'Additional paving area requested.',...await observation(),difference:'requested',
      initiator:{source:'customer_reported',description:'Request reported by assigned worker.'},affectedWork:'Paving area',
      scheduleImplications:'Needs human scheduling review.',resourceImplications:'Material requirements remain unknown.'};
    const created=(await mutate(await body('record_change',document))).body.data;
    const acknowledged=(await mutate(edit(created,'review',{outcome:'worker_acknowledged'}),crypto.randomUUID(),{actorUserId:IDS.member,actorAccessRole:'member',authSessionId:memberSession.sessionId,csrfToken:memberSession.csrfToken})).body.data;
    expect(acknowledged.document.reviewState).toBe('worker_acknowledged');
    await expect(mutate(edit(acknowledged,'review',{outcome:'owner_confirmed'}),crypto.randomUUID(),{actorUserId:IDS.member,actorAccessRole:'member',authSessionId:memberSession.sessionId,csrfToken:memberSession.csrfToken})).rejects.toMatchObject({status:403});
    const reviewed=(await mutate(edit(acknowledged,'review',{outcome:'owner_confirmed'}))).body.data;
    expect(reviewed.authorityBoundary).toMatchObject({commercialConsequences:false,authorizationToContinue:false,percentComplete:null});
  });
  test('runtime lacks table, helper, DDL, mutation and immutable history authority',async()=>{
    for(const table of ['records','events','audit_events','idempotency','evidence_links']){
      await expect(runtimePool.query('SELECT * FROM canonical_progress_'+table)).rejects.toMatchObject({code:'42501'});
      await expect(ownerPool.query('UPDATE canonical_progress_'+table+' SET organization_id=organization_id')).rejects.toThrow();
      await expect(ownerPool.query('TRUNCATE canonical_progress_'+table)).rejects.toThrow();
    }
    await expect(runtimePool.query("SELECT canonical_progress_document_valid('record_progress','{}')")).rejects.toMatchObject({code:'42501'});
    for(const mode of [false,null])await expect(runtimePool.query('SELECT canonical_progress_observation_authorized($1,$2,$3,$4)',
      [IDS.org,execution.id,{},mode])).rejects.toMatchObject({code:'42501'});
  });
  test('audit failure rolls back all evidence and a clean exact retry succeeds',async()=>{
    const counts=()=>ownerPool.query('SELECT count(*)::int count FROM canonical_progress_records');
    const before=(await counts()).rows[0].count,input=await body(),key=crypto.randomUUID();
    await ownerPool.query("CREATE FUNCTION p7_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit unavailable'; END $$");
    await ownerPool.query('CREATE TRIGGER p7_fail_audit BEFORE INSERT ON canonical_progress_audit_events FOR EACH ROW EXECUTE FUNCTION p7_fail_audit()');
    try {await expect(mutate(input,key)).rejects.toMatchObject({status:503});expect((await counts()).rows[0].count).toBe(before);}
    finally{await ownerPool.query('DROP TRIGGER p7_fail_audit ON canonical_progress_audit_events');await ownerPool.query('DROP FUNCTION p7_fail_audit()');}
    expect((await mutate(input,key)).replayed).toBe(false);
  });
  test('bounded stable pagination binds its execution and retains truthful totals',async()=>{
    const first=await read({limit:2});expect(first.body.returned).toBe(2);expect(first.body.truncated).toBe(true);
    const next=await read({limit:2,cursor:first.body.nextCursorData});
    expect(next.body.data.some(r=>first.body.data.some(p=>p.id===r.id))).toBe(false);
    expect(next.body.total).toBe(first.body.total);
    await expect(read({limit:2,cursor:{...first.body.nextCursorData,executionId:crypto.randomUUID()}})).rejects.toMatchObject({status:400});
  });
  test('current source pins, tenant scope and session revocation gate exact replay',async()=>{
    const input=await body(),key=crypto.randomUUID();await mutate(input,key);
    await expect(mutate({...input,expectedExecutionDigest:'0'.repeat(64)},key)).rejects.toMatchObject({status:409});
    await expect(read({organizationId:IDS.otherOrg})).rejects.toMatchObject({status:403});
    await ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='fixture_revocation' WHERE id=$1",[session.sessionId]);
    try{await expect(mutate(input,key)).rejects.toMatchObject({status:403});await expect(read()).rejects.toMatchObject({status:403});}
    finally{await ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",[session.sessionId]);}
  });

  async function direct(input, overrides={}) {
    const n={...require('../../src/progress/contract').normalizeProgressAction({...actor,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:input}),...overrides};
    const c=await runtimePool.connect(),identity=IDS.org+':'+execution.id;
    try{
      await c.query('SELECT pg_advisory_lock_shared(230004,4)');
      await c.query('SELECT pg_advisory_lock(230007,hashtext($1))',[identity]);
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const r=await c.query('SELECT canonical_progress_mutate($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::bigint,$13::text,$14::bigint,$15::text,$16::jsonb,$17::text,$18::text,$19::text) result',
       [n.organizationId,n.actorUserId,n.actorAccessRole,n.authSessionId,session.csrfToken,n.executionId,n.action,n.performerProfileId,n.recordId,n.expectedRecordRevision,n.expectedRecordDigest,n.expectedExecutionRevision,n.expectedExecutionDigest,n.expectedAssignmentRevision,n.expectedAssignmentDigest,n.document,n.idempotencyKey,n.reason,'p7-direct']);
      await c.query('COMMIT');return r.rows[0].result;
    }finally{
      await c.query('ROLLBACK').catch(()=>{});
      await c.query('SELECT pg_advisory_unlock(230007,hashtext($1))',[identity]);
      await c.query('SELECT pg_advisory_unlock_shared(230004,4)');c.release();
    }
  }
  test('vanilla 18.x UTC checksums and separate nonprivileged runtime are real',async()=>{
    const result=(await ownerPool.query("SELECT current_setting('server_version_num')::int version,current_setting('TimeZone') zone,current_setting('server_encoding') encoding,current_setting('data_checksums') checksums")).rows[0];
    expect(result.version).toBeGreaterThanOrEqual(180000);expect(result.zone).toBe('UTC');expect(result.encoding).toBe('UTF8');expect(result.checksums).toBe('on');
    const runtime=(await runtimePool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(Object.values(runtime).every(v=>v===false)).toBe(true);
    await expect(runtimePool.query('CREATE TABLE public.p7_forbidden(id int)')).rejects.toMatchObject({code:'42501'});
    await expect(runtimePool.query('SET ROLE '+roles.owner)).rejects.toMatchObject({code:'42501'});
  });
  test.each(['expectedExecutionRevision','expectedExecutionDigest','expectedAssignmentRevision','expectedAssignmentDigest'])('direct SQL rejects explicit NULL %s before receipt or write',async(field)=>{
    await expect(direct(await body(),{[field]:null})).rejects.toMatchObject({code:'22023'});
  });
  test.each(['<img src=x>','safe\u202Etxt','x\u{e0001}','bad\u200Btext','bad\u0001text'])('database independently rejects non-inert stored text %s',async(description)=>{
    const input=await body(),normalized=require('../../src/progress/contract').normalizeProgressAction({...actor,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:input});
    await expect(direct(input,{document:{...normalized.document,description}})).rejects.toMatchObject({code:'22023'});
  });
  test.each(['ملاحظة ميدانية.','作業を記録。','Observación medida.','Café mesuré.'])('database and HTTP preserve international text %s as inert JSON',async(description)=>{
    const input=await body();input.document.description=description;
    const result=await request(app).post('/api/v1/field-executions/'+execution.id+'/progress-actions')
      .set('Idempotency-Key',crypto.randomUUID()).set('X-CSRF-Token',session.csrfToken).send(input);
    expect(result.status).toBe(201);expect(result.body.data.document.description).toBe(description);
    expect(JSON.parse(JSON.stringify(result.body)).data.document.description).toBe(description);
  });
  test('lost COMMIT acknowledgement retains one effect and exact retry still reauthorizes',async()=>{
    const input=await body(),key=crypto.randomUUID();let committed=false;
    const n=require('../../src/progress/contract').normalizeProgressAction({...actor,executionId:execution.id,idempotencyKey:key,body:input});
    const uncertainPool={connect:async()=>{
      const client=await runtimePool.connect();
      return {query:async(...args)=>{
        const result=await client.query(...args);
        if(args[0]==='COMMIT'&&!committed){committed=true;throw new Error('Synthetic lost COMMIT acknowledgement');}
        return result;
      },release:discard=>client.release(discard)};
    }};
    await expect(require('../../src/progress/repository').mutateProgress(uncertainPool,{...n,csrfToken:session.csrfToken,requestCorrelationId:'p7-lost-commit'})).rejects.toMatchObject({status:503});
    expect(committed).toBe(true);
    await ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='fixture' WHERE id=$1",[session.sessionId]);
    try{await expect(mutate(input,key)).rejects.toMatchObject({status:403});}
    finally{await ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",[session.sessionId]);}
    const result=await mutate(input,key);expect(result.replayed).toBe(true);
    expect((await ownerPool.query('SELECT count(*)::int count FROM canonical_progress_records WHERE root_id=$1',[result.body.data.rootId])).rows[0].count).toBe(1);
  });
  test('concurrent different updates to the same exact predecessor have one winner',async()=>{
    const record=(await mutate(await body())).body.data;
    const a={...await progress(),workKey:record.document.workKey,quantity:{completed:'3',total:'10',unit:'m2'}};
    const b={...a,quantity:{completed:'4',total:'10',unit:'m2'}};
    const results=await Promise.allSettled([mutate(edit(record,'update_progress',a)),mutate(edit(record,'update_progress',b))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected').reason.status).toBe(409);
    expect((await ownerPool.query('SELECT count(*)::int count FROM canonical_progress_records WHERE root_id=$1',[record.id])).rows[0].count).toBe(2);
  });
  test('cursor excludes later inserts and cannot be used as a cross-work oracle',async()=>{
    const first=await read({limit:2});await mutate(await body());
    const second=await read({limit:2,cursor:first.body.nextCursorData});
    expect(second.body.total).toBe(first.body.total);
    await expect(read({executionId:crypto.randomUUID()})).rejects.toMatchObject({status:403});
  });
  test.each([
    ['membership',"UPDATE organization_memberships SET status='suspended' WHERE user_id=$1","UPDATE organization_memberships SET status='active' WHERE user_id=$1",IDS.owner],
    ['account',"UPDATE users SET status='suspended' WHERE id=$1","UPDATE users SET status='active' WHERE id=$1",IDS.owner],
    ['performer',"UPDATE users SET status='suspended' WHERE id=$1","UPDATE users SET status='active' WHERE id=$1",IDS.member],
    ['subscription',"UPDATE subscriptions SET status='canceled' WHERE organization_id=$1","UPDATE subscriptions SET status='active' WHERE organization_id=$1",IDS.org],
    ['onboarding',"UPDATE organization_onboarding SET status='business_profile_required',completed_at=NULL WHERE organization_id=$1","UPDATE organization_onboarding SET status='complete',completed_at=clock_timestamp() WHERE organization_id=$1",IDS.org],
    ['transcript',"UPDATE canonical_transcripts SET source=E'\\tDeMo\\t' WHERE organization_id=$1","UPDATE canonical_transcripts SET source='lead' WHERE organization_id=$1",IDS.org],
  ])('%s revocation blocks new mutation and exact cached response disclosure',async(_name,revoke,restore,id)=>{
    const input=await body(),key=crypto.randomUUID();await mutate(input,key);
    await ownerPool.query(revoke,[id]);
    try{await expect(mutate(input,key)).rejects.toMatchObject({status:403});await expect(mutate(await body())).rejects.toMatchObject({status:403});}
    finally{await ownerPool.query(restore,[id]);}
    expect((await mutate(input,key)).replayed).toBe(true);
  });

  async function assignmentFixture(patch){
    const allowed=['dispatch_state','workforce_profile_id','workforce_crew_id','revision','canonical_digest'];
    if(Object.keys(patch).some(k=>!allowed.includes(k)))throw new Error('Fixture field outside bound');
    await ownerPool.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
    try{const keys=Object.keys(patch);await ownerPool.query('UPDATE canonical_schedule_assignments SET '+keys.map((k,i)=>k+'=$'+(i+2)).join(',')+' WHERE id=$1',[assignment.id,...Object.values(patch)]);}
    finally{await ownerPool.query('ALTER TABLE canonical_schedule_assignments ENABLE TRIGGER USER');}
  }
  test('dispatch revocation, reassignment, and source revision drift block cached replay',async()=>{
    const input=await body(),key=crypto.randomUUID();await mutate(input,key);
    for(const patch of [{dispatch_state:'revoked'},{workforce_profile_id:IDS.owner},{revision:Number(assignment.revision)+1,canonical_digest:digest('f')}]){
      await assignmentFixture(patch);
      try{await expect(mutate(input,key)).rejects.toMatchObject({status:patch.revision?409:403});}
      finally{await assignmentFixture({dispatch_state:'dispatched',workforce_profile_id:IDS.member,revision:assignment.revision,canonical_digest:assignment.digest});}
    }
    const record=execution,operations=require('../../src/operations/repository');
    execution=(await operations.transitionFieldExecution(runtimePool,{...actor,executionId:record.id,expectedRevision:record.revision,expectedDigest:record.digest,
      expectedAssignmentRevision:Number(assignment.revision),expectedAssignmentDigest:assignment.digest,action:'pause',reason:'Fixture pause.',idempotencyKey:crypto.randomUUID(),requestCorrelationId:'p7-pause'})).body.data;
    await expect(mutate(input,key)).rejects.toMatchObject({status:409});
    execution=(await operations.transitionFieldExecution(runtimePool,{...actor,executionId:execution.id,expectedRevision:execution.revision,expectedDigest:execution.digest,
      expectedAssignmentRevision:Number(assignment.revision),expectedAssignmentDigest:assignment.digest,action:'resume',reason:'Fixture resume.',idempotencyKey:crypto.randomUUID(),requestCorrelationId:'p7-resume'})).body.data;
  });
  test('active crew membership is required on worker mutation and exact replay',async()=>{
    const crew=crypto.randomUUID();
    await ownerPool.query("INSERT INTO workforce_crews(id,organization_id,crew_key,name,created_by_user_id,updated_by_user_id) VALUES($1,$2,'progress-crew','Progress fixture crew',$3,$3)",[crew,IDS.org,IDS.owner]);
    const add=()=>ownerPool.query('INSERT INTO workforce_crew_members(organization_id,crew_id,profile_id,created_by_user_id) VALUES($1,$2,$3,$4)',[IDS.org,crew,IDS.member,IDS.owner]);
    await add();await assignmentFixture({workforce_profile_id:null,workforce_crew_id:crew});
    const member={actorUserId:IDS.member,actorAccessRole:'member',authSessionId:memberSession.sessionId,csrfToken:memberSession.csrfToken};
    try{
      const input=await body(),key=crypto.randomUUID();await mutate(input,key,member);
      await ownerPool.query('DELETE FROM workforce_crew_members WHERE organization_id=$1 AND crew_id=$2',[IDS.org,crew]);
      await expect(mutate(input,key,member)).rejects.toMatchObject({status:403});
      await add();expect((await mutate(input,key,member)).replayed).toBe(true);
    }finally{
      await assignmentFixture({workforce_profile_id:IDS.member,workforce_crew_id:null});
      await ownerPool.query('DELETE FROM workforce_crew_members WHERE organization_id=$1 AND crew_id=$2',[IDS.org,crew]);
      await ownerPool.query('DELETE FROM workforce_crews WHERE organization_id=$1 AND id=$2',[IDS.org,crew]);
    }
  });
  test('old direct SQL snapshot cannot hide a committed supporting-authority revocation',async()=>{
    const c=await runtimePool.connect(),identity=IDS.org+':'+execution.id;let acquired=false;
    try{
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query('SELECT count(*) FROM pg_catalog.pg_class');
      await ownerPool.query("UPDATE users SET status='suspended' WHERE id=$1",[IDS.owner]);
      await c.query('SELECT pg_advisory_lock_shared(230004,4)');await c.query('SELECT pg_advisory_lock_shared(230007,hashtext($1))',[identity]);acquired=true;
      await expect(c.query('SELECT canonical_progress_read($1,$2,$3,$4,$5,2,NULL,NULL,NULL)',[IDS.org,IDS.owner,'owner',session.sessionId,execution.id])).rejects.toMatchObject({code:'40001'});
    }finally{
      await c.query('ROLLBACK');if(acquired){await c.query('SELECT pg_advisory_unlock_shared(230007,hashtext($1))',[identity]);await c.query('SELECT pg_advisory_unlock_shared(230004,4)');}
      c.release();await ownerPool.query("UPDATE users SET status='active' WHERE id=$1",[IDS.owner]);
    }
  });
  test('support links and observation zone pins reject forged or shifted evidence',async()=>{
    const input=await body();
    await expect(mutate({...input,document:{...input.document,evidence:[{id:crypto.randomUUID(),revision:1,digest:digest('f')}]}})).rejects.toMatchObject({status:403});
    await expect(mutate({...input,document:{...input.document,observedAt:'2026-09-01T12:00:00-04:00'}})).rejects.toMatchObject({status:403});
    await expect(mutate({...input,document:{...input.document,timeZoneAuthority:{...input.document.timeZoneAuthority,hash:digest('f')}}})).rejects.toMatchObject({status:403});
    const normal=require('../../src/progress/contract').normalizeProgressAction({...actor,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:input});
    for(const key of ['price','customerAcceptance','invoice','authorizationToContinue']){
      await expect(direct(input,{document:{...normal.document,[key]:true}})).rejects.toMatchObject({code:'22023'});
    }
  });
  test('HTTP uses real signed cookies, current database authorization, CSRF and production permissions',async()=>{
    expect(await db.initDatabase()).toBe(true);
    const realApp=express();realApp.use(require('../../src/middleware/auditLog').correlationId);
    realApp.use(require('../../src/operations/httpBoundary').executionBodyBoundary);realApp.use(express.json());
    realApp.use('/api/v1/field-executions',require('../../src/routes/fieldExecutions').createFieldExecutionsRouter());
    realApp.use(require('../../src/middleware/errorHandler').errorHandler);
    const url='/api/v1/field-executions/'+execution.id+'/progress-actions',input=await body(),key=crypto.randomUUID();
    expect((await request(realApp).post(url).send(input)).status).toBe(401);
    expect((await request(realApp).post(url).set('Cookie',session.headers.Cookie).set('Idempotency-Key',key).send(input)).status).toBe(403);
    const accepted=await request(realApp).post(url).set(session.headers).set('Idempotency-Key',key).send(input);
    expect(accepted.status).toBe(201);
    const replay=await request(realApp).post(url).set(session.headers).set('Idempotency-Key',key).send(input);
    expect(replay.status).toBe(201);expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.headers['x-request-id']).not.toBe(accepted.headers['x-request-id']);
    expect(replay.body).toEqual(accepted.body);
    const listed=await request(realApp).get('/api/v1/field-executions/'+execution.id+'/progress?limit=2').set('Cookie',session.headers.Cookie);
    expect(listed.status).toBe(200);expect(listed.body.nextCursor).toBeTruthy();
    expect(listed.headers['cache-control']).toContain('no-store');
    for(const [userId,organizationId,role] of [[IDS.viewer,IDS.org,'viewer'],[IDS.otherOwner,IDS.otherOrg,'owner']]){
      const denied=await provisionDurableSession(ownerPool,{organizationId,userId,membershipId:userId,role});
      expect((await request(realApp).post(url).set(denied.headers).set('Idempotency-Key',key).send(input)).status).toBe(403);
      expect((await request(realApp).get('/api/v1/field-executions/'+execution.id+'/progress').set('Cookie',denied.headers.Cookie)).status).toBe(403);
    }
    await ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='fixture' WHERE id=$1",[session.sessionId]);
    try{
      expect((await request(realApp).post(url).set(session.headers).set('Idempotency-Key',key).send(input)).status).toBe(401);
      expect((await request(realApp).get('/api/v1/field-executions/'+execution.id+'/progress').set('Cookie',session.headers.Cookie)).status).toBe(401);
    }
    finally{await ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",[session.sessionId]);}
  });
  test('mounted strict byte boundary rejects duplicate keys, compressed and forged authority',async()=>{
    const url='/api/v1/field-executions/'+execution.id+'/progress-actions';
    const duplicate=await request(app).post(url).set('Content-Type','application/json').send('{"action":"record_progress","action":"record_change"}');
    expect(duplicate.status).toBe(400);
    expect((await request(app).post(url).set('Content-Type','application/json').set('Content-Encoding','gzip').send(require('zlib').gzipSync('{}'))).status).toBe(415);
    expect((await request(app).post(url).set('Content-Type','application/json').send(JSON.stringify({description:'x'.repeat(33000)}))).status).toBe(413);
    const forged=await request(app).post(url).set('Idempotency-Key',crypto.randomUUID()).set('X-CSRF-Token',session.csrfToken).send({...await body(),organizationId:IDS.otherOrg});
    expect(forged.status).toBe(400);
  });
  async function rotateProfile(timeZone) {
    const old=(await ownerPool.query('SELECT id,version_label,raw_profile FROM canonical_business_profiles WHERE organization_id=$1 AND is_active',[IDS.org])).rows[0];
    await require('../../src/services/organizationAuthority').putBusinessProfile(runtimePool,{
      organizationId:IDS.org,userId:IDS.owner,expectedVersion:old.version_label,
      profile:{...old.raw_profile,company:{...old.raw_profile.company,name:'Profile rotation '+crypto.randomUUID(),timeZone}},
    });
    expect((await ownerPool.query('SELECT is_active FROM canonical_business_profiles WHERE id=$1',[old.id])).rows[0].is_active).toBe(false);
    const row=(await ownerPool.query('SELECT id,version_number,normalized_profile_hash FROM canonical_business_profiles WHERE organization_id=$1 AND is_active',[IDS.org])).rows[0];
    return {businessProfileId:row.id,version:Number(row.version_number),hash:row.normalized_profile_hash.trim(),timeZone};
  }
  let rotationApp;
  async function rotationPost(input,key,headers) {
    if(!rotationApp){
      expect(await db.initDatabase()).toBe(true);
      rotationApp=express();rotationApp.use(require('../../src/middleware/auditLog').correlationId);
      rotationApp.use(require('../../src/operations/httpBoundary').executionBodyBoundary);rotationApp.use(express.json());
      rotationApp.use('/api/v1/field-executions',require('../../src/routes/fieldExecutions').createFieldExecutionsRouter());
      rotationApp.use(require('../../src/middleware/errorHandler').errorHandler);
    }
    return request(rotationApp).post('/api/v1/field-executions/'+execution.id+'/progress-actions').set(headers).set('Idempotency-Key',key).send(input);
  }
  const worker=()=>({actorUserId:IDS.member,actorAccessRole:'member',authSessionId:memberSession.sessionId,csrfToken:memberSession.csrfToken});
  async function issueDocument(kind) {return {kind,description:'Access remains unavailable.',...await observation(),category:'access',impact:'prevents_work',
    severity:'moderate',followUp:{profileId:IDS.member,action:'Confirm access facts.'},state:'open',resolution:null};}
  test.each(['UTC','America/New_York'])('profile rotation to %s preserves owner and own-worker reviews for all fact kinds',async(timeZone)=>{
    const documents=[await progress(),await issueDocument('blocker'),await issueDocument('exception'),
      {kind:'field_change',description:'Observed scope difference.',...await observation(),difference:'observed',
        initiator:{source:'worker',description:'Assigned worker observation.'},affectedWork:'Paving',scheduleImplications:'Unknown.',resourceImplications:'Unknown.'}];
    const records=[];
    for(const document of documents){const input=await body(document.kind==='field_change'?'record_change':'record_'+document.kind,document),key=crypto.randomUUID();
      records.push({input,key,result:await mutate(input,key)});}
    try{
      const current=await rotateProfile(timeZone);
      for(const {input,key,result} of records){
        const original=result.body.data,reviewInput=edit(original,'review',{outcome:'owner_confirmed'}),reviewKey=crypto.randomUUID();
        const accepted=await rotationPost(reviewInput,reviewKey,session.headers);
        expect(accepted.status).toBe(201);
        const reviewed=accepted.body.data;
        expect(reviewed).toMatchObject({previousRecordId:original.id,revision:2,document:{...original.document,reviewState:'owner_confirmed'}});
        const replay=await rotationPost(reviewInput,reviewKey,session.headers);
        expect(replay.status).toBe(201);expect(replay.headers['idempotency-replayed']).toBe('true');expect(replay.body).toEqual(accepted.body);
        const ack=(await mutate(edit(reviewed,'review',{outcome:'worker_acknowledged'}),crypto.randomUUID(),worker())).body.data;
        expect(ack.document.timeZoneAuthority).toEqual(original.document.timeZoneAuthority);
        expect(ack.authorityBoundary).toMatchObject({commercialConsequences:false,authorizationToContinue:false,executionLifecycleChanged:false});
        expect((await mutate(input,key)).body).toEqual(result.body);
        await expect(mutate(edit(original,'review',{outcome:'disputed'}))).rejects.toMatchObject({status:409});
        await expect(mutate(edit(ack,'correct',input.document))).rejects.toMatchObject({status:403});
        if(input.document.kind==='progress')await expect(mutate(edit(ack,'update_progress',input.document))).rejects.toMatchObject({status:403});
        await expect(direct(reviewInput,{document:{outcome:'owner_confirmed',timeZoneAuthority:current}})).rejects.toMatchObject({code:'22023'});
        expect((await ownerPool.query('SELECT document,rtrim(canonical_digest) digest FROM canonical_progress_records WHERE id=$1',[original.id])).rows[0])
          .toEqual({document:original.document,digest:original.digest});
      }
      const stale=await body();await expect(mutate(stale)).rejects.toMatchObject({status:403});
      const valid={...stale,document:{...stale.document,timeZoneAuthority:current,observedAt:timeZone==='UTC'?'2026-09-01T12:00:00Z':'2026-09-01T08:00:00-04:00'}};
      expect((await mutate(valid)).status).toBe(201);
    }finally{await rotateProfile('UTC');timeZoneAuthority=undefined;}
  });
  test.each([['blocker','UTC'],['exception','UTC'],['blocker','America/New_York'],['exception','America/New_York']])(
    'profile rotation preserves assigned-worker %s lifecycle with %s active timezone',async(kind,timeZone)=>{
      const original=(await mutate(await body('record_'+kind,await issueDocument(kind)))).body.data;
      const note=(await mutateFieldEvidence(runtimePool,{...normalizeEvidenceAction({...actor,executionId:execution.id,idempotencyKey:crypto.randomUUID(),
        body:{...common('record_note'),note:'Access was observed.',caption:null}}),csrfToken:session.csrfToken,requestCorrelationId:'p7-rotation-resolution'})).body.data;
      const resolution={description:'Access observed.',observedAt:'2026-09-01T12:30:00Z',evidence:[{id:note.id,revision:note.revision,digest:note.digest}]};
      try{
        await rotateProfile(timeZone);
        const input=edit(original,'issue_state',{state:'investigating',resolution:null}),key=crypto.randomUUID();
        const accepted=await rotationPost(input,key,memberSession.headers);expect(accepted.status).toBe(201);
        const investigating=accepted.body.data;
        const waiting=(await mutate(edit(investigating,'issue_state',{state:'awaiting_follow_up',resolution:null}),crypto.randomUUID(),worker())).body.data;
        for(const patch of [{observedAt:'2026-09-01T08:30:00-04:00'},{observedAt:'2026-09-01T11:00:00Z'},
          {observedAt:'2099-09-01T12:30:00Z'},{evidence:[{id:note.id,revision:note.revision,digest:digest('f')}]},
          {evidence:[{id:crypto.randomUUID(),revision:1,digest:note.digest}]}]){
          await expect(mutate(edit(waiting,'issue_state',{state:'resolved',resolution:{...resolution,...patch}}),crypto.randomUUID(),worker())).rejects.toMatchObject({status:403});
        }
        const resolved=(await mutate(edit(waiting,'issue_state',{state:'resolved',resolution}),crypto.randomUUID(),worker())).body.data;
        const reviewed=(await mutate(edit(resolved,'review',{outcome:'owner_confirmed'}))).body.data;
        const reopened=(await mutate(edit(reviewed,'issue_state',{state:'open',resolution:null}),crypto.randomUUID(),worker())).body.data;
        const resolvedAgain=(await mutate(edit(reopened,'issue_state',{state:'resolved',resolution}),crypto.randomUUID(),worker())).body.data;
        expect(resolvedAgain).toMatchObject({revision:7,document:{timeZoneAuthority:original.document.timeZoneAuthority,resolution}});
        expect((await rotationPost(input,key,memberSession.headers)).body).toEqual(accepted.body);
        await expect(mutate({...input,expectedExecutionRevision:execution.revision+1},key,worker())).rejects.toMatchObject({status:409});
        await expect(mutate({...input,performerProfileId:IDS.owner},crypto.randomUUID(),worker())).rejects.toMatchObject({status:403});
        await expect(mutate(input,crypto.randomUUID(),{...worker(),organizationId:IDS.otherOrg})).rejects.toMatchObject({status:403});
        await ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='rotation fixture' WHERE id=$1",[memberSession.sessionId]);
        try{expect((await rotationPost(input,key,memberSession.headers)).status).toBe(401);await expect(mutate(input,key,worker())).rejects.toMatchObject({status:403});}
        finally{await ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",[memberSession.sessionId]);}
        const history=(await ownerPool.query('SELECT action_code,document FROM canonical_progress_records WHERE root_id=$1 ORDER BY revision',[original.id])).rows;
        expect(history.map(row=>row.action_code)).toEqual(['record_'+kind,'issue_state','issue_state','issue_state','review','issue_state','issue_state']);
        expect(history[0].document).toEqual(original.document);expect(history[3].document.resolution).toEqual(resolution);
        const counts=(await ownerPool.query('SELECT (SELECT count(*) FROM canonical_progress_events WHERE root_id=$1)::int events,(SELECT count(*) FROM canonical_progress_audit_events WHERE record_id IN (SELECT id FROM canonical_progress_records WHERE root_id=$1))::int audits,(SELECT count(*) FROM canonical_progress_idempotency WHERE record_id IN (SELECT id FROM canonical_progress_records WHERE root_id=$1))::int receipts',[original.id])).rows[0];
        expect(counts).toEqual({events:7,audits:7,receipts:7});
      }finally{await rotateProfile('UTC');timeZoneAuthority=undefined;}
    });
  test('real writes stop at the explicit history bound, while exact retry and all bounded pages remain available',async()=>{
    const before=(await ownerPool.query('SELECT count(*)::int count FROM canonical_progress_records WHERE execution_id=$1',[execution.id])).rows[0].count;
    let last,key;
    for(let n=before;n<2000;n+=1){last=await body();key=crypto.randomUUID();await mutate(last,key);}
    await expect(mutate(await body())).rejects.toMatchObject({status:429});
    expect((await mutate(last,key)).replayed).toBe(true);
    const ids=new Set();let cursor=null;
    do{
      const page=(await read({limit:200,cursor})).body;
      expect(page.returned).toBeLessThanOrEqual(200);expect(page.total).toBe(2000);
      for(const record of page.data){expect(ids.has(record.id)).toBe(false);ids.add(record.id);}
      cursor=page.nextCursorData;
      expect(page.truncated).toBe(Boolean(cursor));
    }while(cursor);
    expect(ids.size).toBe(2000);
  },120000);
});
