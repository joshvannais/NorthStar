'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { mutateFieldEvidence, readFieldEvidence, authorizeFileRetrieval, authorizeFileUpload } = require('../../src/fieldEvidence/repository');
const { normalizeEvidenceAction, AD_HOC_TEMPLATE_DIGEST, AD_HOC_TEMPLATE_VERSION } = require('../../src/fieldEvidence/contract');

const conditional = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const q = value => '"' + value.replace(/"/g, '""') + '"';
const IDS = Object.freeze({ org: 'e1000000-0000-4000-8000-000000000001', otherOrg: 'e1000000-0000-4000-8000-000000000002',
  owner: 'e2000000-0000-4000-8000-000000000001', member: 'e2000000-0000-4000-8000-000000000002',
  viewer: 'e2000000-0000-4000-8000-000000000003', otherOwner: 'e2000000-0000-4000-8000-000000000004' });
const digest = character => character.repeat(64);

conditional('Mission 23 Part 6 mounted PostgreSQL field evidence authority', () => {
  let database, ownerPool, runtimePool, roles, db, session, memberSession, execution, assignment, actor, app;

  beforeAll(async () => {
    database = await createSuiteDatabase('m23_part6');
    roles = { owner: `m23p6_owner_${process.pid}`, runtime: `m23p6_runtime_${process.pid}` };
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
    const normalized = normalizeEvidenceAction({ ...actor, ...overrides, executionId: execution.id, idempotencyKey: key, body });
    return mutateFieldEvidence(runtimePool, { ...normalized, csrfToken: overrides.csrfToken || session.csrfToken, requestCorrelationId: 'p6-evidence' });
  }

  test('applies migration once, reruns zero-op, and withholds every table/helper from runtime', async () => {
    expect((await ownerPool.query("SELECT count(*)::int AS count FROM _migrations WHERE filename='047_canonical_field_evidence_authority.sql'")).rows[0].count).toBe(1);
    await expect(runtimePool.query('SELECT * FROM canonical_field_evidence_records')).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query("SELECT canonical_field_evidence_text_valid('forged')")).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query("SELECT canonical_field_evidence_object_keys_exact('{}'::jsonb,ARRAY[]::text[])")).rejects.toMatchObject({ code: '42501' });
    const invalid = await ownerPool.query(`SELECT
      canonical_field_evidence_json_valid($1::jsonb) AS hostile_key,
      canonical_field_evidence_document_valid('record_note',$2::jsonb) AS extra_field,
      canonical_field_evidence_document_valid('record_observation',$3::jsonb) AS forged_link,
      canonical_field_evidence_document_valid('register_file',$4::jsonb) AS mismatched_media`, [
      { ['safe\u202Ekey']: 'value' }, { kind: 'note', note: 'Safe note.', caption: null, unexpected: 'forged' },
      { kind: 'observation', observationClass: 'inspection', resultType: 'pass', observation: 'Observed.', measurement: null, exception: null,
        supportingEvidenceIds: ['not-a-uuid'], professionalConclusion: false },
      { kind: 'file', objectId: crypto.randomUUID(), displayName: 'forged.png', extension: 'png', mediaType: 'image/jpeg',
        byteCount: 1, contentDigest: digest('1'), quarantineDisposition: 'released_after_clean_scan', scannerVersion: 'scanner-v1',
        scannerEvidenceDigest: digest('2'), metadataRemovalDigest: digest('3'), storageCapabilityVersion: 'storage-v1',
        storageCapabilityDigest: digest('4'), encryptionAtRest: true, decompressionSafe: true,
        decodedPixelCount: 12000000, activeContentInline: false, privacyFlags: ['none'],
        privacyPolicy: null, retentionDays: 30, consentOrComplianceConclusion: false, malwareClearanceClaim: false },
    ]);
    expect(invalid.rows[0]).toEqual({ hostile_key: false, extra_field: false, forged_link: false, mismatched_media: false });
    expect(await db.runMigrations({ pool: ownerPool, runtimePool })).toBe(true);
  });

  test('creates one immutable pinned checklist and exact replay without duplicate evidence', async () => {
    const body = { ...common('create_checklist'), template: null,
      items: [{ key: 'arrival', prompt: 'Record the observed arrival condition.', required: true },
        { key: 'quality', prompt: 'Record the observed work quality.', required: false }] };
    const prepared = normalizeEvidenceAction({ ...actor, executionId: execution.id, idempotencyKey: crypto.randomUUID(), body });
    const validation = await ownerPool.query("SELECT canonical_field_evidence_json_valid($1::jsonb) AS json_valid,canonical_field_evidence_document_valid('create_checklist',$1::jsonb) AS document_valid,canonical_field_execution_reason_valid($2) AS reason_valid", [prepared.document, prepared.reason]);
    expect(validation.rows[0]).toEqual({ json_valid: true, document_valid: true, reason_valid: true });
    const key = crypto.randomUUID(); const created = await mutate(body, key); const replay = await mutate(body, key);
    expect(created.body.data.document).toMatchObject({ adHocTemplateVersion: AD_HOC_TEMPLATE_VERSION, adHocTemplateDigest: AD_HOC_TEMPLATE_DIGEST });
    expect(replay.replayed).toBe(true); expect(replay.body).toEqual(created.body);
    const counts = await ownerPool.query('SELECT (SELECT count(*) FROM canonical_field_evidence_records)::int records,(SELECT count(*) FROM canonical_field_evidence_events)::int events,(SELECT count(*) FROM canonical_field_evidence_audit_events)::int audits,(SELECT count(*) FROM canonical_field_evidence_idempotency)::int receipts');
    expect(counts.rows[0]).toEqual({ records: 1, events: 1, audits: 1, receipts: 1 });
    global.checklist = created.body.data;
    await expect(ownerPool.query('UPDATE canonical_field_evidence_records SET reason=reason WHERE id=$1', [created.body.data.id])).rejects.toMatchObject({ code: '55000' });
    await expect(ownerPool.query('TRUNCATE canonical_field_evidence_events')).rejects.toMatchObject({ code: '0A000' });
    await expect(mutate({ ...body, reason: 'Changed request.' }, key)).rejects.toMatchObject({ status: 409 });
  });

  test('records distinct item and inspection semantics, then corrects by append-only supersession', async () => {
    const checklist = global.checklist;
    const response = await mutate({ ...common('respond_item'), checklistId: checklist.id,
      expectedChecklistRevision: checklist.revision, expectedChecklistDigest: checklist.digest, itemKey: 'arrival',
      resultType: 'unavailable', observation: 'Arrival image is unavailable.', exception: 'Return visit required.', supportingEvidenceIds: [] });
    const observation = await mutate({ ...common('record_observation'), observationClass: 'inspection', resultType: 'measurement',
      observation: 'Measured opening width.', measurement: { value: '32.25', unit: 'in' }, exception: null, supportingEvidenceIds: [] });
    const corrected = await mutate({ ...common('correct'), evidenceId: response.body.data.id,
      expectedEvidenceRevision: response.body.data.revision, expectedEvidenceDigest: response.body.data.digest,
      replacement: { kind: 'checklist_response', checklistId: checklist.id, itemKey: 'arrival', resultType: 'pass',
        observation: 'Arrival condition was later observed.', measurement: null, exception: null, supportingEvidenceIds: [observation.body.data.id] } });
    expect(corrected.body.data).toMatchObject({ rootId: response.body.data.rootId, previousRecordId: response.body.data.id, revision: 2 });
    expect((await ownerPool.query('SELECT document FROM canonical_field_evidence_records WHERE id=$1', [response.body.data.id])).rows[0].document.resultType).toBe('unavailable');
    await expect(mutate({ ...common('respond_item'), checklistId: checklist.id, expectedChecklistRevision: 1,
      expectedChecklistDigest: checklist.digest, itemKey: 'arrival', resultType: 'pass', observation: 'Duplicate.', supportingEvidenceIds: [] })).rejects.toMatchObject({ status: 409 });
  });

  test('serializes concurrent replay and rolls back record/event/audit/receipt on forced audit failure', async () => {
    const body = { ...common('record_note'), note: 'Concurrent bounded note.', caption: null };
    const key = crypto.randomUUID(); const settled = await Promise.allSettled([mutate(body, key), mutate(body, key)]);
    expect(settled.filter(value => value.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const before = (await ownerPool.query('SELECT count(*)::int AS count FROM canonical_field_evidence_records')).rows[0].count;
    await ownerPool.query("CREATE FUNCTION pg_temp.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$");
    await ownerPool.query('CREATE TRIGGER forced_audit BEFORE INSERT ON canonical_field_evidence_audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit()');
    await expect(mutate({ ...common('record_note'), note: 'Must roll back.', caption: null })).rejects.toMatchObject({ status: 503 });
    await ownerPool.query('DROP TRIGGER forced_audit ON canonical_field_evidence_audit_events');
    expect((await ownerPool.query('SELECT count(*)::int AS count FROM canonical_field_evidence_records')).rows[0].count).toBe(before);
  });

  test('reauthorizes stale pins, session, assignment, tenant and performer before mutation or replay', async () => {
    await expect(mutate({ ...common('record_note'), performerProfileId: IDS.owner,
      note: 'Wrong performer.', caption: null })).rejects.toMatchObject({ status: 403 });
    const stale = { ...common('record_note'), note: 'Stale pin.', caption: null, expectedAssignmentRevision: 3 };
    await expect(mutate(stale)).rejects.toMatchObject({ status: 409 });
    await expect(mutate({ ...common('record_note'), note: 'Cross tenant.', caption: null }, crypto.randomUUID(), { organizationId: IDS.otherOrg })).rejects.toMatchObject({ status: 403 });
    const body = { ...common('record_note'), note: 'Replay authority check.', caption: null }; const key = crypto.randomUUID(); await mutate(body, key);
    await ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='Part 6 replay test' WHERE id=$1", [session.sessionId]);
    await expect(mutate(body, key)).rejects.toMatchObject({ status: 403 });
    await ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1", [session.sessionId]);
  });

  test('registers only released encrypted bounded file metadata and authorizes short-lived retrieval separately', async () => {
    const objectId = crypto.randomUUID();
    const uploadAuthority = { ...actor, executionId: execution.id, performerProfileId: IDS.member, objectId,
      expectedExecutionRevision: execution.revision, expectedExecutionDigest: execution.digest,
      expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      idempotencyKey: crypto.randomUUID(), csrfToken: session.csrfToken };
    await expect(authorizeFileUpload(runtimePool, uploadAuthority)).resolves.toMatchObject({ body: { data: { objectId, authorized: true } } });
    await expect(authorizeFileUpload(runtimePool, { ...uploadAuthority, expectedAssignmentRevision: 3 })).rejects.toMatchObject({ status: 409 });
    const document = { kind: 'file', objectId, displayName: 'arrival.jpg', extension: 'jpg', mediaType: 'image/jpeg',
      byteCount: 16, contentDigest: digest('3'), quarantineDisposition: 'released_after_clean_scan', scannerVersion: 'scanner-v1',
      scannerEvidenceDigest: digest('4'), metadataRemovalDigest: digest('5'), storageCapabilityVersion: 'storage-v1',
      storageCapabilityDigest: digest('6'), encryptionAtRest: true, decompressionSafe: true,
      decodedPixelCount: 12000000, activeContentInline: false, privacyFlags: ['none'],
      privacyPolicy: null, retentionDays: 30,
      consentOrComplianceConclusion: false, malwareClearanceClaim: false };
    const saved = await mutateFieldEvidence(runtimePool, { ...actor, executionId: execution.id, action: 'register_file', performerProfileId: IDS.member,
      subjectId: null, expectedSubjectRevision: null, expectedSubjectDigest: null, expectedExecutionRevision: execution.revision,
      expectedExecutionDigest: execution.digest, expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      document, idempotencyKey: crypto.randomUUID(), reason: 'Register released storage metadata.', requestCorrelationId: 'p6-file' });
    expect(saved.body.data.document).toMatchObject({ objectId, malwareClearanceClaim: false, retentionDays: 30,
      retainedUntil: expect.any(String) });
    await ownerPool.query('BEGIN');
    const ownedAccess = await ownerPool.query(`INSERT INTO canonical_field_evidence_file_access_events(
      organization_id,execution_id,record_id,object_id,content_digest,actor_user_id,auth_session_id,transaction_id,authorized_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,'2000-01-01T00:00:00Z') RETURNING transaction_id,authorized_at`,
    [IDS.org, execution.id, saved.body.data.id, objectId, document.contentDigest, IDS.owner, session.sessionId]);
    expect(Number(ownedAccess.rows[0].transaction_id)).not.toBe(1);
    expect(ownedAccess.rows[0].authorized_at.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');
    await ownerPool.query('ROLLBACK');
    await ownerPool.query('BEGIN');
    await expect(ownerPool.query(`INSERT INTO canonical_field_evidence_file_access_events(
      organization_id,execution_id,record_id,object_id,content_digest,actor_user_id,auth_session_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [IDS.org, execution.id, saved.body.data.id, objectId, digest('9'), IDS.owner, session.sessionId]))
      .rejects.toMatchObject({ code: '23514' });
    await ownerPool.query('ROLLBACK');
    await expect(authorizeFileRetrieval(runtimePool, { organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: session.sessionId, executionId: execution.id, objectId })).resolves.toMatchObject({ objectId, executionId: execution.id,
      accessEventId: expect.any(String), authorizedAt: expect.any(String) });
    expect((await ownerPool.query('SELECT count(*)::int AS count FROM canonical_field_evidence_file_access_events WHERE organization_id=$1 AND object_id=$2', [IDS.org, objectId])).rows[0].count).toBe(1);
    await expect(authorizeFileRetrieval(runtimePool, { organizationId: IDS.otherOrg, actorUserId: IDS.otherOwner, actorAccessRole: 'owner',
      authSessionId: session.sessionId, executionId: execution.id, objectId })).rejects.toMatchObject({ status: 403 });
    const consent = await mutate({ ...common('record_note'), note: 'Configured sensitive-media policy evidence.', caption: null });
    const sensitiveObject = crypto.randomUUID(); const sensitive = { ...document, objectId: sensitiveObject,
      displayName: 'private-area.jpg', contentDigest: digest('7'), privacyFlags: ['faces', 'customer_property'],
      privacyPolicy: { policyVersion: 'm23-private-media-v1', policyDigest: digest('8'),
        consentEvidenceId: consent.body.data.id, consentEvidenceDigest: consent.body.data.digest } };
    await expect(mutateFieldEvidence(runtimePool, { ...actor, executionId: execution.id, action: 'register_file', performerProfileId: IDS.member,
      subjectId: null, expectedSubjectRevision: null, expectedSubjectDigest: null, expectedExecutionRevision: execution.revision,
      expectedExecutionDigest: execution.digest, expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      document: sensitive, idempotencyKey: crypto.randomUUID(), reason: 'Register policy-evidenced sensitive metadata.', requestCorrelationId: 'p6-sensitive-file' }))
      .resolves.toMatchObject({ body: { data: { document: { objectId: sensitiveObject, consentOrComplianceConclusion: false } } } });
  });

  test('returns one stable bounded snapshot cursor and mounts JSON plus explicit unavailable-storage routes', async () => {
    const first = await readFieldEvidence(runtimePool, { organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner', authSessionId: session.sessionId,
      executionId: execution.id, limit: 2, cursor: null });
    expect(first.body).toMatchObject({ success: true, returned: 2, truncated: true });
    const next = first.body.nextCursorData;
    const second = await readFieldEvidence(runtimePool, { organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner', authSessionId: session.sessionId,
      executionId: execution.id, limit: 200, cursor: next });
    expect(new Set([...first.body.data, ...second.body.data].map(item => item.id)).size).toBe(first.body.data.length + second.body.data.length);
    await expect(readFieldEvidence(runtimePool, { organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner', authSessionId: session.sessionId,
      executionId: execution.id, limit: 2, cursor: { cutoff: new Date(Date.now() + 60000).toISOString(),
        lastTime: next.lastTime, lastId: next.lastId } })).rejects.toMatchObject({ status: 400 });
    const note = { ...common('record_note'), note: 'Mounted field note.', caption: null };
    const post = await request(app).post(`/api/v1/field-executions/${execution.id}/field-evidence-actions`)
      .set('Content-Type', 'application/json').set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(note);
    expect(post.status).toBe(201);
    const read = await request(app).get(`/api/v1/field-executions/${execution.id}/field-evidence?limit=2`);
    expect(read.status).toBe(200); expect(read.body.nextCursor).toEqual(expect.any(String));
    const image = Buffer.from([0xff,0xd8,0xff,0xd9]);
    const upload = await request(app).post(`/api/v1/field-executions/${execution.id}/files`)
      .set('Content-Type', 'image/jpeg').set('Content-Length', String(image.length)).set('X-CSRF-Token', session.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).set('X-Performer-Profile-Id', IDS.member)
      .set('X-Execution-Revision', String(execution.revision)).set('X-Execution-Digest', execution.digest)
      .set('X-Assignment-Revision', String(assignment.revision)).set('X-Assignment-Digest', assignment.digest)
      .set('X-Evidence-Reason', 'Mounted unavailable storage check.').set('X-File-Name', 'arrival.jpg')
      .set('X-Privacy-Flags', 'none').set('X-Retention-Days', '30').send(image);
    expect(upload.status).toBe(503); expect(upload.body.error.code).toBe('M23_FIELD_STORAGE_UNAVAILABLE');
  });
});
