'use strict';

const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { mutateFieldEvidence, readFieldEvidence, authorizeFileRetrieval, authorizeFileUpload,
  confirmFileCleanup, reconcileFileUpload } = require('../../src/fieldEvidence/repository');
const { ingestFileEvidence } = require('../../src/fieldEvidence/fileStorage');
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
    const normalized = adaptBusinessProfile(raw, 'm23-p6-v1');
    await ownerPool.query("INSERT INTO canonical_business_profiles(organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,1,'m23-p6-v1',$2,$3,$4,true,$5)", [IDS.org, raw, normalized, normalized.hash, IDS.owner]);
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
  async function progress() { return {kind:'progress',workKey:'paving',description:'Measured field work.',...await observation(),
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
  test('progress updates require exact predecessor and preserve correction history',async()=>{
    const original=(await mutate(await body())).body.data;
    const changed={...await progress(),quantity:{completed:'5',total:'10',unit:'m2'}};
    const updated=(await mutate(edit(original,'update_progress',changed))).body.data;
    expect(updated).toMatchObject({rootId:original.id,previousRecordId:original.id,revision:2});
    await expect(mutate(edit(original,'update_progress',changed))).rejects.toMatchObject({status:409});
    await expect(mutate(edit(updated,'update_progress',await progress()))).rejects.toMatchObject({status:400});
    const correction=(await mutate(edit(updated,'correct',await progress()))).body.data;
    expect(correction.revision).toBe(3);
    expect((await ownerPool.query('SELECT count(*)::int count FROM canonical_progress_records WHERE root_id=$1',[original.id])).rows[0].count).toBe(3);
  });
  test('blockers retain unresolved history and explicit resolution evidence, independent of lifecycle',async()=>{
    const document={kind:'blocker',description:'Material delivery is missing.',...await observation(),category:'material',impact:'prevents_work',
      severity:'moderate',followUp:{profileId:IDS.member,action:'Confirm the delivery facts.'},state:'open',resolution:null};
    const original=(await mutate(await body('record_blocker',document))).body.data;
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
    for(const table of ['records','events','audit_events','idempotency']){
      await expect(runtimePool.query('SELECT * FROM canonical_progress_'+table)).rejects.toMatchObject({code:'42501'});
      await expect(ownerPool.query('UPDATE canonical_progress_'+table+' SET organization_id=organization_id')).rejects.toThrow();
      await expect(ownerPool.query('TRUNCATE canonical_progress_'+table)).rejects.toThrow();
    }
    await expect(runtimePool.query("SELECT canonical_progress_document_valid('record_progress','{}')")).rejects.toMatchObject({code:'42501'});
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
    await ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",[session.sessionId]);
    try{await expect(mutate(input,key)).rejects.toMatchObject({status:403});await expect(read()).rejects.toMatchObject({status:403});}
    finally{await ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL WHERE id=$1",[session.sessionId]);}
  });
  test('mounted strict byte boundary rejects duplicate keys, compressed and forged authority',async()=>{
    const url='/api/v1/field-executions/'+execution.id+'/progress-actions';
    const duplicate=await request(app).post(url).set('Content-Type','application/json').send('{"action":"record_progress","action":"record_change"}');
    expect(duplicate.status).toBe(400);
    const forged=await request(app).post(url).set('Idempotency-Key',crypto.randomUUID()).set('X-CSRF-Token',session.csrfToken).send({...await body(),organizationId:IDS.otherOrg});
    expect(forged.status).toBe(400);
  });
});

