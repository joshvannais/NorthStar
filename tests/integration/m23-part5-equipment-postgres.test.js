'use strict';
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { EquipmentRepository } = require('../../src/equipment/repository');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const conditional = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const q = value => '"' + value.replace(/"/g, '""') + '"';
const IDS = { org: 'd1000000-0000-4000-8000-000000000001', owner: 'd2000000-0000-4000-8000-000000000001', other: 'd1000000-0000-4000-8000-000000000002', member: 'd2000000-0000-4000-8000-000000000002' };
const identity = { manufacturer: 'Example Manufacturer', model: 'Exact Test 350', modelYear: '2024', series: 'Test Series', engine: 'Test Engine', configuration: 'Test Configuration' };
const fields = { ...identity, attachments: 'none', accessType: 'owned' };
const now = new Date();
const research = { schemaVersion: 1, identity, category: 'vehicle', categoryLabel: 'Trucks', specifications: [],
  sources: [{ url: 'https://manufacturer.example/manual', title: 'Deterministic intercepted fixture only', publisher: 'Example Manufacturer', sourceVersion: 'test-v1', documentDigest: 'a'.repeat(64), accessedAt: now.toISOString() }],
  confidence: 'high', reviewedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 86400000).toISOString(), state: 'approved' };
conditional('Mission 23 Part 5 mounted PostgreSQL equipment authority', () => {
  let database, ownerPool, runtimePool, roles, repo, actor, db, session, memberSession, app, execution, assignment, savedAsset, extractor;
  beforeAll(async () => {
    database = await createSuiteDatabase('m23_part5');
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
    roles = { owner: `m23p5_owner_${process.pid}`, runtime: `m23p5_runtime_${process.pid}` };
    try {
      await admin.query(`CREATE ROLE ${q(roles.owner)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await admin.query(`CREATE ROLE ${q(roles.runtime)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await admin.query(`ALTER DATABASE ${q(database.databaseName)} OWNER TO ${q(roles.owner)}`);
    } finally { await admin.end(); }
    const url = role => { const result = new URL(database.connectionString); result.username = role; result.password = ''; return result.toString(); };
    ownerPool = new Pool({ connectionString: url(roles.owner), max: 4 });
    runtimePool = new Pool({ connectionString: url(roles.runtime), max: 4 });
    process.env.DATABASE_URL = url(roles.runtime); process.env.MIGRATION_DATABASE_URL = url(roles.owner);
    db = require('../../src/db');
    await db.runMigrations({ pool: ownerPool, runtimePool });
    await ownerPool.query('INSERT INTO organizations(id,name,email) VALUES ($1,$2,$3)', [IDS.org, 'Equipment test', 'equipment@example.test']);
    for (const [id, role] of [[IDS.owner, 'owner'], [IDS.member, 'member']]) {
      await ownerPool.query("INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,'Equipment test',$3,'unused',$4,'active')", [id, IDS.org, `${id}@example.test`, role]);
      await ownerPool.query("INSERT INTO organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,$3,'active')", [id, IDS.org, role]);
    }
    const raw = { company: { name: 'Equipment test', timeZone: 'UTC' }, headquarters: {}, services: [] };
    const normalized = adaptBusinessProfile(raw, 'm23-p5-v1');
    await ownerPool.query("INSERT INTO canonical_business_profiles(organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,1,'m23-p5-v1',$2,$3,$4,true,$5)", [IDS.org, raw, normalized, normalized.hash, IDS.owner]);
    session = await provisionDurableSession(ownerPool, { organizationId: IDS.org, userId: IDS.owner, membershipId: IDS.owner, role: 'owner' });
    memberSession = await provisionDurableSession(ownerPool, { organizationId: IDS.org, userId: IDS.member, membershipId: IDS.member, role: 'member' });
    actor = { organizationId: IDS.org, userId: IDS.owner, role: 'owner', sessionId: session.sessionId, csrfToken: session.csrfToken };
    repo = new EquipmentRepository(runtimePool);
    const operation = crypto.randomUUID(), graph = crypto.randomUUID(), customer = crypto.randomUUID(), transcript = crypto.randomUUID(), opportunity = crypto.randomUUID(), appointment = crypto.randomUUID();
    await ownerPool.query("INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at) VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())", [operation, IDS.org, graph, 'd'.repeat(64)]);
    await ownerPool.query("INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Equipment fixture customer')", [customer, IDS.org, operation, graph]);
    await ownerPool.query("INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,source,source_version,transcript_text,normalized_fingerprint) VALUES($1,$2,$3,$4,$5,'lead','fixture','Equipment fixture request',$6)", [transcript, IDS.org, operation, graph, customer, 'e'.repeat(64)]);
    await ownerPool.query("INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','{}')", [opportunity, IDS.org, operation, graph, customer]);
    await ownerPool.query("INSERT INTO canonical_appointments(id,organization_id,operation_id,graph_id,opportunity_id,scheduled_start,scheduled_end,status) VALUES($1,$2,$3,$4,$5,'2027-06-15T13:00:00Z','2027-06-15T14:00:00Z','scheduled')", [appointment, IDS.org, operation, graph, opportunity]);
    // Test-owned accepted Mission 22 predecessor, identical to the released
    // Part 2 fixture boundary. Never used by a production module.
    await ownerPool.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
    try {
      assignment = (await ownerPool.query("UPDATE canonical_schedule_assignments SET target_state='assigned',workforce_profile_id=$2,schedule_state='scheduled',dispatch_state='dispatched',needs_review=false,review_reasons='[]',revision=4,canonical_digest=canonical_schedule_assignment_digest('assigned',$2,NULL,'scheduled','dispatched',scheduled_start,scheduled_end,appointment_status,false,'[]'),last_action_code='dispatch',last_reason='Accepted equipment fixture',updated_at=transaction_timestamp() WHERE appointment_id=$1 RETURNING id,revision,rtrim(canonical_digest) AS digest", [appointment, IDS.member])).rows[0];
    } finally { await ownerPool.query('ALTER TABLE canonical_schedule_assignments ENABLE TRIGGER USER'); }
    execution = (await require('../../src/operations/repository').initializeFieldExecution(runtimePool, {
      organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner', authSessionId: session.sessionId, csrfToken: session.csrfToken,
      appointmentId: appointment, expectedAssignmentRevision: assignment.revision, expectedAssignmentDigest: assignment.digest,
      idempotencyKey: crypto.randomUUID(), reason: 'Initialize deterministic equipment execution', requestCorrelationId: 'equipment-fixture',
    })).body.data;
    execution = (await require('../../src/operations/repository').transitionFieldExecution(runtimePool, {
      organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner', authSessionId: session.sessionId, csrfToken: session.csrfToken,
      executionId: execution.id, expectedRevision: execution.revision, expectedDigest: execution.digest,
      expectedAssignmentRevision: assignment.revision, expectedAssignmentDigest: assignment.digest, action: 'start',
      idempotencyKey: crypto.randomUUID(), reason: 'Start deterministic equipment execution', requestCorrelationId: 'equipment-fixture-start',
    })).body.data;
    expect(await db.initDatabase()).toBe(true);
    const express = require('express'); app = express();
    app.use(require('../../src/equipment/httpBoundary').equipmentBodyBoundary);
    app.use(express.json());
    extractor = jest.fn(async ({ message }) => message.includes('Ford F-350') ? { manufacturer: 'Ford', model: 'F-350' } : {});
    app.use('/api/equipment', require('../../src/routes/equipment').createEquipmentRouter({ poolProvider: () => runtimePool, extractIdentifiers: extractor }));
    app.use(require('../../src/middleware/errorHandler').errorHandler);
  }, 120000);
  afterAll(async () => {
    if (ownerPool) await ownerPool.end(); if (runtimePool) await runtimePool.end();
    if (db) await db.close().catch(() => {});
    if (database) await database.cleanup();
    if (roles) { const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect(); try {
      await admin.query(`DROP ROLE IF EXISTS ${q(roles.runtime)}`); await admin.query(`DROP ROLE IF EXISTS ${q(roles.owner)}`);
    } finally { await admin.end(); } }
    delete process.env.DATABASE_URL; delete process.env.MIGRATION_DATABASE_URL;
  });
  test('initializes exact migration and denies runtime research import and direct private tables', async () => {
    const found = await ownerPool.query("SELECT checksum FROM _migrations WHERE filename='046_m23_equipment_operations.sql'");
    expect(found.rowCount).toBe(1);
    await expect(runtimePool.query('SELECT * FROM canonical_equipment_drafts')).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4)', [research, 'fixture reviewer', 'b'.repeat(64), 'Test only'])).rejects.toMatchObject({ code: '42501' });
  });
  test('imports reviewed exact public fixture and creates no tenant asset before explicit confirmation', async () => {
    const imported = await ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4) AS result', [research, 'fixture reviewer', 'b'.repeat(64), 'Deterministic fixture only']);
    expect(imported.rows[0].result.version).toBe(1);
    const before = await ownerPool.query('SELECT count(*)::int AS count FROM tenant_assets WHERE organization_id=$1', [IDS.org]);
    const draft = await repo.mutate(actor, null, crypto.randomUUID(), { entryPath: 'business_profile', message: '', identifiers: fields, useContext: 'Test hauling context' });
    expect(draft.data.document.state).toBe('review'); expect(draft.data.document.research.state).toBe('reviewed');
    expect((await ownerPool.query('SELECT count(*)::int AS count FROM tenant_assets WHERE organization_id=$1', [IDS.org])).rows).toEqual(before.rows);
    const body = { action: 'confirm', expectedRevision: draft.data.revision, expectedDigest: draft.data.digest, confirmation: 'save_reviewed_asset' };
    const key = crypto.randomUUID(); const saved = await repo.mutate(actor, draft.data.id, key, body);
    expect(saved.data.document.state).toBe('saved');
    expect((await repo.mutate(actor, draft.data.id, key, body)).replayed).toBe(true);
    const catalogue = await repo.read(actor); expect(catalogue.assets).toHaveLength(1);
    expect(catalogue.assets[0]).toMatchObject({ categoryLabel: 'Trucks', reviewState: 'reviewed', availability: 'unknown', operationRevision: 0 });
    savedAsset = catalogue.assets[0];
  });
  function operation(kind, override = {}) {
    return { action: 'record', assetId: savedAsset.id, assetVersion: savedAsset.version, assetDigest: savedAsset.assetDigest,
      knowledgeVersionId: savedAsset.knowledgeVersionId, knowledgeDigest: savedAsset.knowledgeDigest,
      expectedExecutionRevision: execution.revision, expectedExecutionDigest: execution.digest,
      expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      expectedAssetRevision: savedAsset.operationRevision, expectedAssetDigest: savedAsset.operationDigest,
      performerProfileId: IDS.member, kind, observedAt: new Date().toISOString(), meterKey: null, reading: null, unit: null,
      description: 'Observed test evidence', reason: 'Attributable deterministic equipment test', correctsEventId: null, ...override };
  }
  async function record(kind, override = {}) {
    const result = await repo.mutate(actor, execution.id, crypto.randomUUID(), operation(kind, override), true);
    savedAsset = (await repo.read(actor)).assets.find(asset => asset.id === savedAsset.id);
    return result;
  }
  test('records checkout, use, meters, reset, condition, fault, maintenance, downtime and checkin', async () => {
    expect((await record('check_out')).data.availability).toBe('in_use');
    await record('use', { reading: '100', unit: 'hours', meterKey: 'engine' });
    await expect(record('reading', { reading: '99', unit: 'hours', meterKey: 'engine' })).rejects.toMatchObject({ status: 409 });
    await record('meter_reset', { reading: '0', unit: 'hours', meterKey: 'engine' });
    await record('reading', { reading: '1.5', unit: 'hours', meterKey: 'engine' });
    await record('condition'); await record('fault'); await record('maintenance');
    expect((await record('downtime_start')).data.availability).toBe('recorded_unavailable');
    await expect(record('use')).rejects.toMatchObject({ status: 409 });
    await record('downtime_end');
    expect((await record('check_in')).data.availability).toBe('needs_review');
    const evidence = await repo.read(actor, null, execution.id); expect(evidence.total).toBe(10); expect(evidence.truncated).toBe(false);
    expect(evidence.events[0].recordedBy).toBe(IDS.owner);
  });
  test('correction preserves original evidence and recomputes exact bounded state', async () => {
    const before = await repo.read(actor, null, execution.id);
    const condition = before.events.find(event => event.document.kind === 'condition');
    await record('condition', { action: 'correct', correctsEventId: condition.id, description: 'Corrected condition observation' });
    const after = await repo.read(actor, null, execution.id);
    expect(after.total).toBe(before.total + 1);
    expect(after.events.find(event => event.id === condition.id)).toEqual(condition);
    await expect(record('condition', { action: 'correct', correctsEventId: condition.id })).rejects.toMatchObject({ status: 409 });
  });
  test('concurrent replay commits one fact and mismatched reuse fails closed', async () => {
    const body = operation('condition'), requestKey = crypto.randomUUID();
    const results = await Promise.allSettled([repo.mutate(actor, execution.id, requestKey, body, true), repo.mutate(actor, execution.id, requestKey, body, true)]);
    expect(results.filter(result => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect((await repo.mutate(actor, execution.id, requestKey, body, true)).replayed).toBe(true);
    await expect(repo.mutate(actor, execution.id, requestKey, { ...body, description: 'Different' }, true)).rejects.toMatchObject({ status: 409 });
    savedAsset = (await repo.read(actor)).assets.find(asset => asset.id === savedAsset.id);
  });
  test('mounted HTTP derives cookie session, role and CSRF and rejects ambiguous bodies', async () => {
    const request = require('supertest');
    expect((await request(app).get('/api/equipment/catalogue')).status).toBe(401);
    expect((await request(app).get('/api/equipment/catalogue').set('Cookie', session.headers.Cookie)).status).toBe(200);
    const body = { entryPath: 'polaris', message: 'Add exact equipment', identifiers: {}, useContext: '' };
    expect((await request(app).post('/api/equipment/drafts').set('Cookie', session.headers.Cookie).set('Idempotency-Key', crypto.randomUUID()).send(body)).status).toBe(403);
    expect((await request(app).post('/api/equipment/drafts').set('Cookie', memberSession.headers.Cookie).set('X-CSRF-Token', memberSession.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(body)).status).toBe(403);
    const accepted = await request(app).post('/api/equipment/drafts').set('Cookie', session.headers.Cookie).set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(body);
    expect(accepted.status).toBe(200); expect(accepted.body.data.question.field).toBe('manufacturer');
    expect((await request(app).post('/api/equipment/drafts').set('Cookie', session.headers.Cookie).set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send({ ...body, organizationId: IDS.other })).status).toBe(400);
    expect((await request(app).post('/api/equipment/drafts').set('Content-Type', 'application/json').send('{"identifiers":{},"identifiers":{}}')).status).toBe(400);
  });
  test.each([
    ['null freshness', value => { value.freshUntil = null; }],
    ['null state', value => { value.state = null; }],
    ['private VIN', value => { value.vin = 'TENANT-PRIVATE'; }],
    ['private location', value => { value.identity.location = 'TENANT-PRIVATE'; }],
    ['generic model', value => { value.identity.model = 'truck'; }],
    ['unknown engine', value => { value.identity.engine = 'unknown'; }],
    ['missing citation version', value => { value.sources[0].sourceVersion = ''; }],
    ['source credential query', value => { value.sources[0].url += '?secret=private'; }],
    ['null citation date', value => { value.sources[0].accessedAt = null; }],
    ['uncited specification', value => { value.specifications = [{ name: 'Capability', value: 'Invented', unit: '', sourceOrdinal: null }]; }],
  ])('reviewed public import rejects %s without app or tenant publication', async (_label, change) => {
    const document = JSON.parse(JSON.stringify(research)); change(document);
    await expect(ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4)', [document, 'fixture reviewer', 'a'.repeat(64), 'Rejected test only'])).rejects.toBeDefined();
    expect((await ownerPool.query('SELECT count(*)::int AS count FROM canonical_equipment_universal_versions')).rows[0].count).toBe(1);
  });
  test('exact base equipment never establishes an unreviewed private attachment configuration', async () => {
    const draft = await repo.mutate(actor, null, crypto.randomUUID(), { entryPath: 'polaris', message: '', identifiers: { ...fields, attachments: 'Private plow configuration' }, useContext: 'Private driveway' });
    expect(draft.data.document.research).toMatchObject({ state: 'needs_review', reason: 'attachment_configuration_unreviewed', versionId: null });
    const publicRows = await ownerPool.query('SELECT document FROM canonical_equipment_universal_versions');
    expect(JSON.stringify(publicRows.rows)).not.toMatch(/Private plow|Private driveway/);
  });
  test('both mounted entry paths use exact replayed literal drafts and only ask missing fields', async () => {
    const request = require('supertest');
    for (const entryPath of ['polaris', 'business_profile']) {
      const body = { entryPath, message: 'Add a Ford F-350 that I use for hauling or plowing', identifiers: {}, useContext: '' };
      const key = crypto.randomUUID(); const before = extractor.mock.calls.length;
      const post = () => request(app).post('/api/equipment/drafts').set(session.headers).set('Idempotency-Key', key).send(body);
      const initial = await post(); const replay = await post();
      expect(initial.status).toBe(200); expect(replay.status).toBe(200);
      expect(initial.body).toEqual(replay.body); expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(initial.body.data.document.identifiers).toEqual({ manufacturer: 'Ford', model: 'F-350' });
      expect(initial.body.data.question.field).toBe('modelYear'); expect(extractor.mock.calls.length).toBe(before + 1);
      let draft = initial.body.data;
      for (const answer of ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']) {
        const next = await request(app).post(`/api/equipment/drafts/${draft.id}/actions`).set(session.headers).set('Idempotency-Key', crypto.randomUUID())
          .send({ action: 'answer', expectedRevision: draft.revision, expectedDigest: draft.digest, answer });
        expect(next.status).toBe(200); draft = next.body.data;
      }
      expect(draft.document.state).toBe('review'); expect(draft.document.research.state).toBe('needs_review');
      await repo.mutate(actor, draft.id, crypto.randomUUID(), { action: 'cancel', expectedRevision: draft.revision, expectedDigest: draft.digest });
    }
    expect((await ownerPool.query('SELECT count(*)::int AS count FROM tenant_assets')).rows[0].count).toBe(1);
  });
  test('direct runtime null semantics, stale pins, role spoofing and forged tenants are fail-closed', async () => {
    await expect(repo.mutate(actor, execution.id, crypto.randomUUID(), operation('condition', { kind: null }), true)).rejects.toMatchObject({ status: 400 });
    await expect(repo.mutate(actor, execution.id, crypto.randomUUID(), operation('condition', { performerProfileId: IDS.owner }), true)).rejects.toMatchObject({ status: 403 });
    await expect(repo.mutate(actor, execution.id, crypto.randomUUID(), operation('condition', { expectedExecutionDigest: 'a'.repeat(64) }), true)).rejects.toMatchObject({ status: 409 });
    await expect(repo.read({ ...actor, organizationId: IDS.other })).rejects.toMatchObject({ status: 403 });
    await expect(repo.read({ ...actor, role: 'admin' })).rejects.toMatchObject({ status: 403 });
    await expect(repo.read({ ...actor, sessionId: memberSession.sessionId })).rejects.toMatchObject({ status: 403 });
  });
  test('re-review advances the same Mission 20 asset while preserving exact historical snapshots and private serial data', async () => {
    const body = operation('condition'); const key = crypto.randomUUID();
    await repo.mutate(actor, execution.id, key, body, true);
    // A test-owned Mission 20 edit, followed by the same exact reviewed target
    // contract, must not discard unrelated private identity fields.
    await ownerPool.query("UPDATE tenant_assets SET serial_number='PRIVATE-SERIAL-TEST',version=version+1 WHERE organization_id=$1 AND id=$2", [IDS.org, savedAsset.id]);
    const old = (await repo.read(actor)).assets.find(asset => asset.id === savedAsset.id);
    const draft = await repo.mutate(actor, null, crypto.randomUUID(), { entryPath: 'business_profile', message: 'Review exact identity', identifiers: fields, useContext: 'Private use', target: { assetId: old.id, version: old.version, digest: old.assetDigest } });
    const saved = await repo.mutate(actor, draft.data.id, crypto.randomUUID(), { action: 'confirm', expectedRevision: draft.data.revision, expectedDigest: draft.data.digest, confirmation: 'save_reviewed_asset' });
    expect(saved.data.document.assetId).toBe(old.id); expect(saved.data.document.assetVersion).toBe(old.version + 1);
    expect((await ownerPool.query('SELECT count(*)::int AS count FROM canonical_equipment_asset_versions WHERE asset_id=$1', [old.id])).rows[0].count).toBe(2);
    expect((await ownerPool.query('SELECT serial_number FROM tenant_assets WHERE id=$1', [old.id])).rows[0].serial_number).toBe('PRIVATE-SERIAL-TEST');
    expect(JSON.stringify((await ownerPool.query('SELECT document FROM canonical_equipment_universal_versions')).rows)).not.toContain('PRIVATE-SERIAL-TEST');
    await expect(repo.mutate(actor, execution.id, key, body, true)).rejects.toMatchObject({ status: 409 });
    savedAsset = (await repo.read(actor)).assets.find(asset => asset.id === old.id);
    await record('condition');
  });
  test('audit failure rolls back ledger, event and receipt as one atomic unit', async () => {
    const before = await repo.read(actor, null, execution.id); const revision = savedAsset.operationRevision;
    await ownerPool.query("CREATE FUNCTION equipment_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deterministic audit failure'; END $$");
    await ownerPool.query('CREATE TRIGGER equipment_test_audit_failure BEFORE INSERT ON canonical_equipment_events FOR EACH ROW EXECUTE FUNCTION equipment_test_audit_failure()');
    try { await expect(record('condition')).rejects.toMatchObject({ status: 503 }); }
    finally { await ownerPool.query('DROP TRIGGER equipment_test_audit_failure ON canonical_equipment_events'); await ownerPool.query('DROP FUNCTION equipment_test_audit_failure()'); }
    expect((await repo.read(actor, null, execution.id)).total).toBe(before.total);
    expect((await repo.read(actor)).assets.find(asset => asset.id === savedAsset.id).operationRevision).toBe(revision);
  });
  test('distinct concurrent writes against one ledger revision cannot both commit', async () => {
    const body = operation('condition'); const before = savedAsset.operationRevision;
    const results = await Promise.allSettled([repo.mutate(actor, execution.id, crypto.randomUUID(), body, true), repo.mutate(actor, execution.id, crypto.randomUUID(), { ...body, description: 'Concurrent second' }, true)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason.status).toBe(409);
    savedAsset = (await repo.read(actor)).assets.find(asset => asset.id === savedAsset.id); expect(savedAsset.operationRevision).toBe(before + 1);
  });
  test('shared supporting-authority fence blocks a writer until the equipment snapshot ends', async () => {
    const reader = await runtimePool.connect(), writer = await ownerPool.connect();
    try {
      await reader.query('SELECT pg_advisory_lock_shared(230004,4)'); await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await reader.query('SELECT equipment_read($1,$2,$3,$4,NULL,NULL)', [actor.organizationId, actor.userId, actor.role, actor.sessionId]);
      await writer.query("SET lock_timeout='60ms'");
      await expect(writer.query("UPDATE tenant_assets SET internal_reference='Fence fixture' WHERE id=$1", [savedAsset.id])).rejects.toMatchObject({ code: '55P03' });
    } finally { await reader.query('ROLLBACK'); await reader.query('SELECT pg_advisory_unlock_shared(230004,4)'); await writer.query('RESET ALL'); reader.release(); writer.release(); }
  });
  test('withdrawn universal version blocks operational use and cached disclosure', async () => {
    const body = operation('condition'), requestKey = crypto.randomUUID();
    await repo.mutate(actor, execution.id, requestKey, body, true);
    await ownerPool.query('SELECT equipment_import_reviewed($1,$2,$3,$4,$5)', [{ ...research, state: 'revoked' }, savedAsset.knowledgeVersionId, 'fixture reviewer', 'c'.repeat(64), 'Fixture withdrawal']);
    await expect(repo.mutate(actor, execution.id, requestKey, body, true)).rejects.toMatchObject({ status: 409 });
    expect((await repo.read(actor)).assets[0].reviewState).toBe('needs_review');
  });
  test.each([['Trailers','trailer'],['Equipment','equipment']])('saves the exact reviewed %s category without category inference', async (categoryLabel, category) => {
    const exact = { ...identity, model: `Exact ${categoryLabel} fixture` };
    await ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4)', [{ ...research, identity: exact, category, categoryLabel }, 'fixture reviewer', 'a'.repeat(64), 'Synthetic category fixture']);
    const draft = await repo.mutate(actor, null, crypto.randomUUID(), { entryPath: 'polaris', message: '', identifiers: { ...fields, ...exact }, useContext: '' });
    const saved = await repo.mutate(actor, draft.data.id, crypto.randomUUID(), { action: 'confirm', expectedRevision: draft.data.revision, expectedDigest: draft.data.digest, confirmation: 'save_reviewed_asset' });
    expect((await repo.read(actor)).assets.find(asset => asset.id === saved.data.document.assetId)).toMatchObject({ category, categoryLabel, reviewState: 'reviewed' });
  });
  test.each(['stale','conflict','low_confidence'])('keeps %s public research needs_review rather than manufacturing operational authority', async disposition => {
    const exact = { ...identity, model: `Exact ${disposition} fixture` }; const publicDocument = JSON.parse(JSON.stringify({ ...research, identity: exact }));
    if (disposition === 'stale') {
      publicDocument.reviewedAt = new Date(Date.now() - 86400000).toISOString();
      publicDocument.sources[0].accessedAt = publicDocument.reviewedAt; publicDocument.freshUntil = new Date(Date.now() - 1000).toISOString();
    } else if (disposition === 'conflict') publicDocument.state = 'conflict'; else publicDocument.confidence = 'low';
    await ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4)', [publicDocument, 'fixture reviewer', 'a'.repeat(64), 'Synthetic disposition fixture']);
    const draft = await repo.mutate(actor, null, crypto.randomUUID(), { entryPath: 'business_profile', message: '', identifiers: { ...fields, ...exact }, useContext: '' });
    expect(draft.data.document.research).toMatchObject({ state: 'needs_review', reason: disposition });
  });
});
