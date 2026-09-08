'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { normalizeEvidenceAction } = require('../../src/fieldEvidence/contract');
const { mutateFieldEvidence, readFieldEvidence } = require('../../src/fieldEvidence/repository');
const { normalizeCompletionAction } = require('../../src/completion/contract');
const { mutateCompletion, readCompletion } = require('../../src/completion/repository');

const conditional = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const IDS = Object.freeze({
  org: 'f1000000-0000-4000-8000-000000000001',
  otherOrg: 'f1000000-0000-4000-8000-000000000002',
  owner: 'f2000000-0000-4000-8000-000000000001',
  member: 'f2000000-0000-4000-8000-000000000002',
  viewer: 'f2000000-0000-4000-8000-000000000003',
  otherOwner: 'f2000000-0000-4000-8000-000000000004',
});
const UNICODE_WHITE_SPACE = Object.freeze([
  ['U+0009 TAB', 0x0009], ['U+000A LINE FEED', 0x000A],
  ['U+000B VERTICAL TAB', 0x000B], ['U+000C FORM FEED', 0x000C],
  ['U+000D CARRIAGE RETURN', 0x000D], ['U+0020 SPACE', 0x0020],
  ['U+0085 NEXT LINE', 0x0085], ['U+00A0 NO-BREAK SPACE', 0x00A0],
  ['U+1680 OGHAM SPACE MARK', 0x1680], ['U+2000 EN QUAD', 0x2000],
  ['U+2001 EM QUAD', 0x2001], ['U+2002 EN SPACE', 0x2002],
  ['U+2003 EM SPACE', 0x2003], ['U+2004 THREE-PER-EM SPACE', 0x2004],
  ['U+2005 FOUR-PER-EM SPACE', 0x2005], ['U+2006 SIX-PER-EM SPACE', 0x2006],
  ['U+2007 FIGURE SPACE', 0x2007], ['U+2008 PUNCTUATION SPACE', 0x2008],
  ['U+2009 THIN SPACE', 0x2009], ['U+200A HAIR SPACE', 0x200A],
  ['U+2028 LINE SEPARATOR', 0x2028], ['U+2029 PARAGRAPH SEPARATOR', 0x2029],
  ['U+202F NARROW NO-BREAK SPACE', 0x202F],
  ['U+205F MEDIUM MATHEMATICAL SPACE', 0x205F],
  ['U+3000 IDEOGRAPHIC SPACE', 0x3000],
]);

conditional('Mission 23 Part 8 mounted completion and reopening authority', () => {
  let database;
  let ownerPool;
  let runtimePool;
  let roles;
  let db;
  let ownerSession;
  let memberSession;
  let otherSession;
  let ownerActor;
  let memberActor;
  let otherActor;
  let app;
  let sequence = 0;

  beforeAll(async () => {
    database = await createSuiteDatabase('m23_part8');
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    roles = { owner: `m23p8_owner_${suffix}`, runtime: `m23p8_runtime_${suffix}` };
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
    await admin.connect();
    try {
      for (const role of Object.values(roles)) {
        await admin.query(`CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
      await admin.query(`ALTER DATABASE ${quote(database.databaseName)} OWNER TO ${quote(roles.owner)}`);
    } finally {
      await admin.end();
    }
    const roleUrl = role => {
      const url = new URL(database.connectionString);
      url.username = role;
      url.password = '';
      return url.toString();
    };
    ownerPool = new Pool({ connectionString: roleUrl(roles.owner), max: 8 });
    runtimePool = new Pool({ connectionString: roleUrl(roles.runtime), max: 8 });
    process.env.DATABASE_URL = roleUrl(roles.runtime);
    process.env.MIGRATION_DATABASE_URL = roleUrl(roles.owner);
    db = require('../../src/db');
    await db.runMigrations({ pool: ownerPool, runtimePool });

    for (const [org, name, email] of [
      [IDS.org, 'Completion authority fixture', 'completion@example.test'],
      [IDS.otherOrg, 'Other completion fixture', 'other-completion@example.test'],
    ]) {
      await ownerPool.query('INSERT INTO organizations(id,name,email) VALUES($1,$2,$3)', [org, name, email]);
    }
    for (const [id, org, role] of [
      [IDS.owner, IDS.org, 'owner'], [IDS.member, IDS.org, 'member'],
      [IDS.viewer, IDS.org, 'viewer'], [IDS.otherOwner, IDS.otherOrg, 'owner'],
    ]) {
      await ownerPool.query(
        "INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,'Completion actor',$3,'unused',$4,'active')",
        [id, org, `${id}@example.test`, role]
      );
      await ownerPool.query(
        "INSERT INTO organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,$3,'active')",
        [id, org, role]
      );
    }
    const raw = { company: { name: 'Completion authority fixture', timeZone: 'UTC' }, headquarters: {}, services: [] };
    const normalized = adaptBusinessProfile(raw, 'org-profile-v1');
    await ownerPool.query(
      "INSERT INTO canonical_business_profiles(organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,1,'org-profile-v1',$2,$3,$4,true,$5)",
      [IDS.org, raw, normalized, normalized.hash, IDS.owner]
    );
    ownerSession = await provisionDurableSession(ownerPool, {
      organizationId: IDS.org, userId: IDS.owner, membershipId: IDS.owner, role: 'owner',
    });
    memberSession = await provisionDurableSession(ownerPool, {
      organizationId: IDS.org, userId: IDS.member, membershipId: IDS.member, role: 'member',
    });
    otherSession = await provisionDurableSession(ownerPool, {
      organizationId: IDS.otherOrg, userId: IDS.otherOwner, membershipId: IDS.otherOwner, role: 'owner',
    });
    ownerActor = { organizationId: IDS.org, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: ownerSession.sessionId, csrfToken: ownerSession.csrfToken };
    memberActor = { organizationId: IDS.org, actorUserId: IDS.member, actorAccessRole: 'member',
      authSessionId: memberSession.sessionId, csrfToken: memberSession.csrfToken };
    otherActor = { organizationId: IDS.otherOrg, actorUserId: IDS.otherOwner, actorAccessRole: 'owner',
      authSessionId: otherSession.sessionId, csrfToken: otherSession.csrfToken };

    const actorMiddleware = (req, _res, next) => {
      req.tenantContext = { organizationId: IDS.org, userId: IDS.owner };
      req.accountAuthority = { membership_id: IDS.owner };
      req.userRole = 'owner';
      req.authSession = { id: ownerSession.sessionId };
      req.requestId = 'm23-part8-http';
      next();
    };
    app = express();
    app.use(require('../../src/operations/httpBoundary').executionBodyBoundary);
    app.use(express.json());
    app.use('/api/v1/field-executions', require('../../src/routes/fieldExecutions').createFieldExecutionsRouter({
      poolProvider: () => runtimePool,
      tenantAuth: actorMiddleware,
      mutationAuth: actorMiddleware,
      permission: () => (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(),
    }));
    app.use(require('../../src/middleware/errorHandler').errorHandler);
  }, 120000);

  afterAll(async () => {
    if (ownerPool) await ownerPool.end();
    if (runtimePool) await runtimePool.end();
    if (db) await db.close().catch(() => {});
    if (database) await database.cleanup();
    if (roles) {
      const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
      await admin.connect();
      try {
        await admin.query(`DROP ROLE IF EXISTS ${quote(roles.runtime)}`);
        await admin.query(`DROP ROLE IF EXISTS ${quote(roles.owner)}`);
      } finally { await admin.end(); }
    }
    delete process.env.DATABASE_URL;
    delete process.env.MIGRATION_DATABASE_URL;
  });

  async function createExecution() {
    sequence += 1;
    const operation = crypto.randomUUID();
    const graph = crypto.randomUUID();
    const customer = crypto.randomUUID();
    const transcript = crypto.randomUUID();
    const opportunity = crypto.randomUUID();
    const appointment = crypto.randomUUID();
    await ownerPool.query(
      "INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at) VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())",
      [operation, IDS.org, graph, digest(`operation:${sequence}`)]
    );
    await ownerPool.query(
      "INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Completion fixture customer')",
      [customer, IDS.org, operation, graph]
    );
    await ownerPool.query(
      "INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,source,source_version,transcript_text,normalized_fingerprint) VALUES($1,$2,$3,$4,$5,'lead','fixture','Completion evidence request',$6)",
      [transcript, IDS.org, operation, graph, customer, digest(`transcript:${sequence}`)]
    );
    await ownerPool.query(
      "INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','{}')",
      [opportunity, IDS.org, operation, graph, customer]
    );
    const start = new Date(Date.UTC(2027, 6, 1 + sequence, 13, 0, 0));
    const end = new Date(start.getTime() + 3600000);
    await ownerPool.query(
      "INSERT INTO canonical_appointments(id,organization_id,operation_id,graph_id,opportunity_id,scheduled_start,scheduled_end,status) VALUES($1,$2,$3,$4,$5,$6,$7,'scheduled')",
      [appointment, IDS.org, operation, graph, opportunity, start, end]
    );
    await ownerPool.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
    let assignment;
    try {
      assignment = (await ownerPool.query(
        "UPDATE canonical_schedule_assignments SET target_state='assigned',workforce_profile_id=$2,schedule_state='scheduled',dispatch_state='dispatched',needs_review=false,review_reasons='[]',revision=4,canonical_digest=canonical_schedule_assignment_digest('assigned',$2,NULL,'scheduled','dispatched',scheduled_start,scheduled_end,appointment_status,false,'[]'),last_action_code='dispatch',last_reason='Accepted completion fixture',updated_at=transaction_timestamp() WHERE appointment_id=$1 RETURNING id,revision,rtrim(canonical_digest) AS digest",
        [appointment, IDS.member]
      )).rows[0];
    } finally {
      await ownerPool.query('ALTER TABLE canonical_schedule_assignments ENABLE TRIGGER USER');
    }
    const operations = require('../../src/operations/repository');
    let execution = (await operations.initializeFieldExecution(runtimePool, {
      ...ownerActor, appointmentId: appointment,
      expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      idempotencyKey: crypto.randomUUID(), reason: 'Initialize completion execution',
      requestCorrelationId: `m23p8-init-${sequence}`,
    })).body.data;
    execution = (await operations.transitionFieldExecution(runtimePool, {
      ...ownerActor, executionId: execution.id,
      expectedRevision: execution.revision, expectedDigest: execution.digest,
      expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
      action: 'start', idempotencyKey: crypto.randomUUID(), reason: 'Start completion execution',
      requestCorrelationId: `m23p8-start-${sequence}`,
    })).body.data;
    return { execution, assignment };
  }

  async function setTranscriptSource(context, source) {
    const result = await ownerPool.query(
      `UPDATE canonical_transcripts transcript
          SET source=$2
         FROM canonical_field_executions execution
        WHERE execution.organization_id=transcript.organization_id
          AND execution.operation_id=transcript.operation_id
          AND execution.graph_id=transcript.graph_id
          AND execution.id=$1`,
      [context.execution.id, source]
    );
    expect(result.rowCount).toBe(1);
  }

  function completionInput(context, action, extra = {}, actor = ownerActor, key = crypto.randomUUID()) {
    return normalizeCompletionAction({
      ...actor,
      executionId: context.execution.id,
      idempotencyKey: key,
      body: {
        action,
        expectedExecutionRevision: Number(context.execution.revision),
        expectedExecutionDigest: context.execution.digest,
        expectedAssignmentRevision: Number(context.assignment.revision),
        expectedAssignmentDigest: context.assignment.digest,
        reason: `Explicit ${action.replaceAll('_', ' ')} evidence.`,
        ...extra,
      },
    });
  }

  async function mutate(context, action, extra = {}, options = {}) {
    const actor = options.actor || ownerActor;
    const normalized = completionInput(context, action, extra, actor, options.key);
    const result = await mutateCompletion(runtimePool, {
      ...normalized,
      csrfToken: actor.csrfToken,
      requestCorrelationId: options.correlationId || `m23p8-${action}`,
    });
    if (options.update !== false) context.execution = result.body.data;
    return result;
  }

  async function readExecutionByAppointment(actor, appointmentId) {
    const client = await runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await client.query(
        `SELECT public.canonical_field_execution_read_by_appointment(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid
         ) AS result`,
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, appointmentId]
      );
      await client.query('COMMIT');
      return result.rows[0].result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  const pin = record => ({ id: record.id, revision: Number(record.revision), digest: record.digest });
  const emptyRequirements = () => ({ checklists: [], inspections: [], files: [] });
  const proposal = (context, requirements = emptyRequirements(), expiresInMs = 60000, options = {}) => mutate(
    context,
    'propose_completion',
    { expiresAt: new Date(Date.now() + expiresInMs).toISOString(), gateRequirements: requirements },
    options
  );

  async function evidence(context, body) {
    const common = {
      performerProfileId: IDS.member,
      expectedExecutionRevision: Number(context.execution.revision),
      expectedExecutionDigest: context.execution.digest,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest,
      reason: 'Observed field evidence for explicit completion gates.',
    };
    const normalized = normalizeEvidenceAction({
      ...ownerActor, executionId: context.execution.id, idempotencyKey: crypto.randomUUID(),
      body: { ...common, ...body },
    });
    return (await mutateFieldEvidence(runtimePool, {
      ...normalized, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-evidence',
    })).body.data;
  }

  async function directCompletion(input, overrides = {}, commit = false) {
    const value = { ...input, ...overrides };
    const document = {
      contractVersion: value.contractVersion,
      proposal: value.proposal,
      completion: value.completion,
      reopening: value.reopening,
      record: value.record,
      expiresAt: value.expiresAt,
      gateRequirements: value.gateRequirements,
      nextAction: value.nextAction,
      annotation: value.annotation,
    };
    const client = await runtimePool.connect();
    const identity = `${value.organizationId}:${value.executionId}`;
    try {
      await client.query('SELECT pg_advisory_lock_shared(230004,4)');
      await client.query('SELECT pg_advisory_lock(230007,hashtext($1))', [identity]);
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        `SELECT canonical_completion_mutate(
           $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,
           $8::bigint,$9::text,$10::bigint,$11::text,$12::jsonb,$13::text,$14::text,$15::text
         ) AS result`,
        [value.organizationId, value.actorUserId, value.actorAccessRole, value.authSessionId,
          value.csrfToken || ownerSession.csrfToken, value.executionId, value.action, value.expectedExecutionRevision,
          value.expectedExecutionDigest, value.expectedAssignmentRevision,
          value.expectedAssignmentDigest, document, value.idempotencyKey, value.reason,
          'm23p8-direct']
      );
      if (commit) await client.query('COMMIT');
      return result;
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.query('SELECT pg_advisory_unlock(230007,hashtext($1))', [identity]).catch(() => {});
      await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(() => {});
      client.release();
    }
  }

  test('final runtime ACLs freeze provenance and replacement while retaining validated ingestion and scheduling locks', async () => {
    const context = await createExecution();
    const transcript = (await ownerPool.query(
      'SELECT t.* FROM canonical_transcripts t JOIN canonical_field_executions e ON e.operation_id=t.operation_id AND e.organization_id=t.organization_id WHERE e.id=$1',
      [context.execution.id]
    )).rows[0];
    for (const column of ['transcript_text', 'id', 'organization_id', 'operation_id', 'graph_id', 'customer_id',
      'source', 'source_version', 'external_call_id', 'external_transcript_id', 'normalized_fingerprint',
      'occurred_at', 'created_at']) {
      expect((await ownerPool.query(
        "SELECT has_column_privilege($1,'canonical_transcripts',$2,'UPDATE') AS permitted",
        [roles.runtime, column]
      )).rows[0].permitted).toBe(false);
      // A no-op assignment is enough to prove denial, without relabeling data.
      await expect(runtimePool.query(
        `UPDATE canonical_transcripts SET ${quote(column)}=${quote(column)} WHERE id=$1`, [transcript.id]
      )).rejects.toMatchObject({ code: '42501' });
    }
    await expect(runtimePool.query('DELETE FROM canonical_transcripts WHERE id=$1', [transcript.id]))
      .rejects.toMatchObject({ code: '42501' });
    expect((await ownerPool.query('SELECT * FROM canonical_transcripts WHERE id=$1', [transcript.id])).rows[0])
      .toEqual(transcript);
    expect((await ownerPool.query(
      "SELECT has_any_column_privilege($1,'canonical_transcripts','UPDATE') AS writable", [roles.runtime]
    )).rows[0].writable).toBe(false);
    // Ordinary reads and the complete text/fingerprint remain available and intact.
    expect((await runtimePool.query(
      'SELECT transcript_text,normalized_fingerprint FROM canonical_transcripts WHERE id=$1', [transcript.id]
    )).rows[0]).toEqual({
      transcript_text: transcript.transcript_text, normalized_fingerprint: transcript.normalized_fingerprint,
    });
    const graphService = require('../../src/services/canonicalGraphService');
    for (const source of ['lead', 'retell', 'voice', 'demo', 'simulation']) {
      const input = {
        tenantContext: { organizationId: IDS.org }, idempotencyKey: crypto.randomUUID(),
        source, customer: { name: 'Provenance ingestion control' },
        transcript: [{ speaker: 'customer', text: 'Please record the requested service.' }],
        service: { key: 'general', scope: {} }, facts: [],
      };
      const result = await graphService.executeCanonicalGraph(runtimePool, input, {});
      expect(result.status).toBe(201);
      const replay = await graphService.executeCanonicalGraph(runtimePool, input, {});
      expect(replay.replayed).toBe(true);
      expect(replay.body).toEqual(result.body);
    }
    const count = (await ownerPool.query('SELECT count(*)::int AS count FROM canonical_transcripts')).rows[0].count;
    expect((await graphService.executeCanonicalGraph(runtimePool, {
      tenantContext: { organizationId: IDS.org }, idempotencyKey: crypto.randomUUID(), source: 'unknown',
    }, {})).status).toBe(400);
    expect((await ownerPool.query('SELECT count(*)::int AS count FROM canonical_transcripts')).rows[0].count).toBe(count);
  }, 120000);

  test('direct mutation rejects non-string JSON before writes and commits valid strings and exact replay', async () => {
    const context = await createExecution();
    const proposed = await proposal(context);
    const approved = await mutate(context, 'approve_completion', { proposal: pin(proposed.body.completionRecord) });
    const approval = approved.body.completionRecord;
    const snapshot = async () => {
      const counts = {};
      for (const table of ['canonical_completion_records', 'canonical_completion_events',
        'canonical_completion_audit_events', 'canonical_completion_idempotency',
        'canonical_field_execution_events', 'canonical_field_execution_revisions',
        'canonical_field_execution_audit_events', 'canonical_field_execution_idempotency']) {
        counts[table] = (await ownerPool.query(
          `SELECT count(*)::int AS count FROM ${table} WHERE execution_id=$1`, [context.execution.id]
        )).rows[0].count;
      }
      counts.execution = (await ownerPool.query(
        'SELECT * FROM canonical_field_executions WHERE id=$1', [context.execution.id]
      )).rows[0];
      return counts;
    };
    const before = await snapshot();
    for (const field of ['note', 'annotationNextAction', 'reopeningNextAction']) {
      for (const value of [false, true, 0, 42, {}, [], ['Valid text'], null, undefined]) {
        if (field === 'annotationNextAction' && value === null) continue;
        const action = field === 'reopeningNextAction' ? 'reopen_execution' : 'correct_completion';
        const input = completionInput(context, action, action === 'reopen_execution'
          ? { completion: pin(approval), nextAction: 'Return and record the observed condition.' }
          : { record: pin(approval), annotation: { note: 'Clarify the recorded condition.', nextAction: null } });
        if (field === 'reopeningNextAction') input.nextAction = value;
        else input.annotation[field === 'note' ? 'note' : 'nextAction'] = value;
        await expect(directCompletion(input, {}, true)).rejects.toMatchObject({
          code: '22023', constraint: 'canonical_completion_input_invalid',
        });
        expect(await snapshot()).toEqual(before);
      }
    }
    let record = approval;
    for (const nextAction of [null, 'Review the clarified observation.']) {
      const input = completionInput(context, 'correct_completion', {
        record: pin(record), annotation: { note: 'Clarified observation remains a string.', nextAction },
      });
      const result = (await directCompletion(input, {}, true)).rows[0].result;
      expect(result.status).toBe(200);
      const replay = (await directCompletion(input, {}, true)).rows[0].result;
      expect(replay.replayed).toBe(true);
      expect(replay.body).toEqual(result.body);
      record = result.body.completionRecord;
      const stored = (await ownerPool.query(
        "SELECT jsonb_typeof(document->'annotation'->'note') AS note_type FROM canonical_completion_records WHERE id=$1",
        [record.id]
      )).rows[0];
      expect(stored.note_type).toBe('string');
    }
    const input = completionInput(context, 'reopen_execution', {
      completion: pin(approval), nextAction: 'Return and record the observed condition.',
    });
    const reopened = (await directCompletion(input, {}, true)).rows[0].result;
    expect(reopened.body.data.lifecycleState).toBe('reopened');
    const replay = (await directCompletion(input, {}, true)).rows[0].result;
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(reopened.body);
  }, 120000);

  test('completion is never inferred; real pinned checklist gates must pass before an explicit proposal', async () => {
    const context = await createExecution();
    const checklist = await evidence(context, {
      action: 'create_checklist', template: null,
      items: [{ key: 'closeout', prompt: 'Record the observed closeout condition.', required: true }],
    });
    expect((await ownerPool.query(
      'SELECT lifecycle_state FROM canonical_field_executions WHERE id=$1', [context.execution.id]
    )).rows[0].lifecycle_state).toBe('in_progress');
    const requirements = { checklists: [pin(checklist)], inspections: [], files: [] };
    await expect(proposal(context, requirements)).rejects.toMatchObject({
      status: 409, code: 'COMPLETION_GATE_FAILED',
    });
    expect((await ownerPool.query(
      'SELECT count(*)::int AS count FROM canonical_completion_records WHERE execution_id=$1', [context.execution.id]
    )).rows[0].count).toBe(0);

    await evidence(context, {
      action: 'respond_item', checklistId: checklist.id,
      expectedChecklistRevision: checklist.revision, expectedChecklistDigest: checklist.digest,
      itemKey: 'closeout', resultType: 'pass', observation: 'Closeout condition was observed.',
      measurement: null, exception: null, supportingEvidenceIds: [],
    });
    const key = crypto.randomUUID();
    const proposedInput = completionInput(context, 'propose_completion', {
      expiresAt: new Date(Date.now() + 60000).toISOString(), gateRequirements: requirements,
    }, ownerActor, key);
    const proposed = await mutateCompletion(runtimePool, {
      ...proposedInput, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-exact-replay',
    });
    context.execution = proposed.body.data;
    expect(proposed.body.data.lifecycleState).toBe('completion_pending');
    expect(proposed.body.completionRecord.gateSnapshot).toMatchObject({
      hardGatesPassed: true,
      progress: { unresolvedIssueCount: 0, needsReviewCount: 0 },
      labor: { openTimerCount: 0, needsReviewCount: 0 },
      materials: { needsReviewCount: 0 },
      equipment: { checkedOutCount: 0, downtimeCount: 0 },
    });
    const replay = await mutateCompletion(runtimePool, {
      ...proposedInput, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-exact-replay',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(proposed.body);
  }, 120000);

  test('Part 9A current inspection selection survives an authorized observation correction', async () => {
    const context = await createExecution();
    const first = await evidence(context, { action: 'record_observation', observationClass: 'inspection',
      resultType: 'pass', observation: 'Routine inspection complete.', measurement: null, exception: null, supportingEvidenceIds: [] });
    const corrected = await evidence(context, { action: 'correct', evidenceId: first.id,
      expectedEvidenceRevision: first.revision, expectedEvidenceDigest: first.digest,
      replacement: { kind: 'observation', observationClass: 'inspection', resultType: 'pass',
        observation: 'Routine inspection detail corrected after review.', measurement: null, exception: null, supportingEvidenceIds: [] } });
    const response = await readFieldEvidence(runtimePool, { ...ownerActor, executionId: context.execution.id, limit: 100, cursor: null });
    const client = require('../../public/js/field-execution-client');
    const snapshot = await client.collectEvidence({ ...response.body, nextCursor: null }, () => { throw new Error('Unexpected pagination'); }, context.execution.id);
    const requirements = client.completionRequirements(snapshot);
    expect(requirements.inspections).toEqual([pin(corrected)]);
    expect(response.body.data).toHaveLength(2);
    const result = await proposal(context, requirements);
    expect(result.body.data.lifecycleState).toBe('completion_pending');
    expect(result.body.completionRecord.gateSnapshot.inspections).toEqual([
      expect.objectContaining({ id: corrected.id, matched: true, passed: true })
    ]);
  }, 120000);

  test('completion reads and exact replays fail closed for every padded demo source and unknown provenance', async () => {
    const context = await createExecution();
    const key = crypto.randomUUID();
    const body = {
      action: 'propose_completion',
      expectedExecutionRevision: Number(context.execution.revision),
      expectedExecutionDigest: context.execution.digest,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest,
      reason: 'Create one completion record for source-boundary replay checks.',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      gateRequirements: emptyRequirements(),
    };
    const replayInput = normalizeCompletionAction({
      ...ownerActor, executionId: context.execution.id, idempotencyKey: key, body,
    });
    const original = await mutateCompletion(runtimePool, {
      ...replayInput, csrfToken: ownerSession.csrfToken,
      requestCorrelationId: 'm23p8-source-boundary',
    });
    expect(original.replayed).toBe(false);

    const deniedSources = [
      ...UNICODE_WHITE_SPACE.flatMap(([label, codePoint]) => {
        const whitespace = String.fromCodePoint(codePoint);
        return [
          [`${label} padded demo`, `${whitespace}DeMo${whitespace}`],
          [`${label} padded simulation`, `${whitespace}SiMuLaTiOn${whitespace}`],
        ];
      }),
      ['empty', ''], ['whitespace only', '\u00A0'], ['unknown manual', 'manual'],
      ['unknown customer', 'customer'], ['unknown provider', 'twilio'],
      ['embedded TAB', 'de\u0009mo'], ['embedded C0 control', 'de\u0001mo'],
      ['embedded DELETE', 'de\u007Fmo'], ['embedded C1 control', 'de\u009Fmo'],
      ['embedded zero-width space', 'de\u200Bmo'], ['leading byte-order mark', '\uFEFFdemo'],
      ['punctuation', 'demo!'], ['Cyrillic confusable', 'd\u0435mo'],
    ];
    for (const [, source] of deniedSources) {
      await setTranscriptSource(context, source);
      await expect(readCompletion(runtimePool, {
        ...ownerActor, executionId: context.execution.id,
      })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

      const read = await request(app)
        .get(`/api/v1/field-executions/${context.execution.id}/completion`);
      expect(read.status).toBe(404);
      expect(read.headers['cache-control']).toBe('no-store, private');

      await expect(mutateCompletion(runtimePool, {
        ...replayInput, csrfToken: ownerSession.csrfToken,
        requestCorrelationId: 'm23p8-source-boundary',
      })).rejects.toMatchObject({ status: 403 });

      const replay = await request(app)
        .post(`/api/v1/field-executions/${context.execution.id}/completion-actions`)
        .set('Idempotency-Key', key)
        .set('X-CSRF-Token', ownerSession.csrfToken)
        .send(body);
      expect(replay.status).toBe(403);
      expect(replay.headers['cache-control']).toBe('no-store, private');
    }

    const productionSources = [
      ['lead', 'lead'], ['mixed-case retell', 'ReTeLl'], ['mixed-case voice', 'VoIcE'],
      ...UNICODE_WHITE_SPACE.map(([label, codePoint]) => {
        const whitespace = String.fromCodePoint(codePoint);
        return [`${label} padded production source`, `${whitespace}VoIcE${whitespace}`];
      }),
    ];
    for (const [, source] of productionSources) {
      await setTranscriptSource(context, source);
      const read = await readCompletion(runtimePool, {
        ...ownerActor, executionId: context.execution.id,
      });
      expect(read.body.data.records).toHaveLength(1);

      const mountedRead = await request(app)
        .get(`/api/v1/field-executions/${context.execution.id}/completion`);
      expect(mountedRead.status).toBe(200);
      expect(mountedRead.headers['cache-control']).toBe('no-store, private');

      const replay = await mutateCompletion(runtimePool, {
        ...replayInput, csrfToken: ownerSession.csrfToken,
        requestCorrelationId: 'm23p8-source-boundary',
      });
      expect(replay.replayed).toBe(true);
    }
    expect((await ownerPool.query(
      'SELECT count(*)::int AS count FROM canonical_completion_records WHERE execution_id=$1',
      [context.execution.id]
    )).rows[0].count).toBe(1);
  }, 240000);

  test('one concurrent approval wins, completion is immutable, and reopening requires an explicit resume', async () => {
    const context = await createExecution();
    expect(await readExecutionByAppointment(memberActor, context.execution.appointmentId))
      .toMatchObject({ success: true, data: {
        id: context.execution.id,
        lifecycleState: 'in_progress',
        actions: [
          'pause', 'start_timer', 'record_manual', 'record_material', 'record_equipment',
          'create_checklist', 'respond_item', 'record_observation', 'record_note',
          'record_progress', 'record_blocker', 'record_exception', 'record_change',
          'propose_completion',
        ],
        materialMovementKinds: ['consumed', 'returned', 'transferred', 'waste'],
        equipmentKinds: [
          'check_out', 'use', 'check_in', 'reading', 'condition', 'fault',
          'downtime_start', 'downtime_end', 'maintenance',
        ],
      } });
    await expect(readExecutionByAppointment(ownerActor, context.execution.appointmentId))
      .rejects.toMatchObject({ code: 'P0002' });
    const proposed = await proposal(context);
    const proposalPin = pin(proposed.body.completionRecord);
    const first = completionInput(context, 'approve_completion', { proposal: proposalPin }, ownerActor, crypto.randomUUID());
    const second = completionInput(context, 'approve_completion', { proposal: proposalPin }, ownerActor, crypto.randomUUID());
    const settled = await Promise.allSettled([
      mutateCompletion(runtimePool, { ...first, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-approve-a' }),
      mutateCompletion(runtimePool, { ...second, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-approve-b' }),
    ]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(result => result.status === 'rejected')[0].reason).toMatchObject({ status: 409 });
    const approved = settled.find(result => result.status === 'fulfilled').value;
    context.execution = approved.body.data;
    const approval = approved.body.completionRecord;
    expect(context.execution.lifecycleState).toBe('completed');
    expect(await readExecutionByAppointment(memberActor, context.execution.appointmentId))
      .toMatchObject({ success: true, data: { id: context.execution.id, lifecycleState: 'completed' } });
    expect((await ownerPool.query(
      "SELECT count(*)::int AS count FROM canonical_completion_records WHERE execution_id=$1 AND record_kind='approval'",
      [context.execution.id]
    )).rows[0].count).toBe(1);

    const original = (await ownerPool.query(
      'SELECT document,canonical_digest FROM canonical_completion_records WHERE id=$1', [approval.id]
    )).rows[0];
    const completedExecution = { ...context.execution };
    const correction = await mutate(context, 'correct_completion', {
      record: pin(approval),
      annotation: { note: 'Clarified closeout evidence without rewriting the decision.', nextAction: null },
    });
    expect(correction.body.completionRecord).toMatchObject({
      rootId: approval.id, previousRecordId: approval.id, recordKind: 'correction', revision: 2,
    });
    expect(correction.body.data).toEqual(completedExecution);
    expect((await ownerPool.query(
      'SELECT document,canonical_digest FROM canonical_completion_records WHERE id=$1', [approval.id]
    )).rows[0]).toEqual(original);

    const reopened = await mutate(context, 'reopen_execution', {
      completion: pin(approval), nextAction: 'Return to the site and record the newly observed work.',
    });
    expect(reopened.body.data.lifecycleState).toBe('reopened');
    expect(await readExecutionByAppointment(memberActor, context.execution.appointmentId))
      .toMatchObject({ success: true, data: { id: context.execution.id, lifecycleState: 'reopened' } });
    const reopening = reopened.body.completionRecord;
    await expect(require('../../src/operations/repository').transitionFieldExecution(runtimePool, {
      ...ownerActor, executionId: context.execution.id,
      expectedRevision: context.execution.revision, expectedDigest: context.execution.digest,
      expectedAssignmentRevision: Number(context.assignment.revision), expectedAssignmentDigest: context.assignment.digest,
      action: 'resume', idempotencyKey: crypto.randomUUID(), reason: 'Forbidden generic resume.',
      requestCorrelationId: 'm23p8-old-resume',
    })).rejects.toMatchObject({ status: 409 });
    const resumed = await mutate(context, 'resume_reopened', { reopening: pin(reopening) });
    expect(resumed.body.data.lifecycleState).toBe('in_progress');
    expect((await ownerPool.query(
      "SELECT lifecycle_after FROM canonical_completion_records WHERE id=$1", [approval.id]
    )).rows[0].lifecycle_after).toBe('completed');
  }, 120000);

  test('withdrawal, explicit cancellation, proposal expiry, role checks, tenant isolation, and revocation fail closed', async () => {
    const withdrawnContext = await createExecution();
    const memberProposal = await proposal(withdrawnContext, emptyRequirements(), 60000, { actor: memberActor });
    expect(memberProposal.body.data.lifecycleState).toBe('completion_pending');
    await expect(mutate(withdrawnContext, 'cancel_execution', { proposal: null }))
      .rejects.toMatchObject({ status: 400 });
    const withdrawn = await mutate(withdrawnContext, 'withdraw_completion', {
      proposal: pin(memberProposal.body.completionRecord),
    }, { actor: memberActor });
    expect(withdrawn.body.data.lifecycleState).toBe('in_progress');
    const cancelled = await mutate(withdrawnContext, 'cancel_execution', { proposal: null });
    expect(cancelled.body.data.lifecycleState).toBe('cancelled');
    await expect(mutate(withdrawnContext, 'cancel_execution', { proposal: null })).rejects.toMatchObject({ status: 409 });

    const expiringContext = await createExecution();
    const expiring = await proposal(expiringContext, emptyRequirements(), 1800);
    await new Promise(resolve => setTimeout(resolve, 2100));
    await expect(mutate(expiringContext, 'approve_completion', {
      proposal: pin(expiring.body.completionRecord),
    })).rejects.toMatchObject({ status: 409, code: 'COMPLETION_PROPOSAL_EXPIRED' });
    expect((await readCompletion(runtimePool, { ...ownerActor, executionId: expiringContext.execution.id })).body.data)
      .toMatchObject({ execution: { lifecycleState: 'completion_pending' }, activeProposal: { expired: true } });

    await expect(mutate(expiringContext, 'approve_completion', {
      proposal: pin(expiring.body.completionRecord),
    }, { actor: memberActor })).rejects.toMatchObject({ status: 403 });
    await expect(readCompletion(runtimePool, { ...otherActor, executionId: expiringContext.execution.id }))
      .rejects.toMatchObject({ status: 404 });

    const replayContext = await createExecution();
    const replayKey = crypto.randomUUID();
    const replayInput = completionInput(replayContext, 'propose_completion', {
      expiresAt: new Date(Date.now() + 60000).toISOString(), gateRequirements: emptyRequirements(),
    }, ownerActor, replayKey);
    await mutateCompletion(runtimePool, {
      ...replayInput, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-revocation',
    });
    await ownerPool.query(
      "UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='fixture_revocation' WHERE id=$1",
      [ownerSession.sessionId]
    );
    try {
      await expect(mutateCompletion(runtimePool, {
        ...replayInput, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-revocation',
      })).rejects.toMatchObject({ status: 403 });
      await expect(readCompletion(runtimePool, { ...ownerActor, executionId: replayContext.execution.id }))
        .rejects.toMatchObject({ status: 403 });
    } finally {
      await ownerPool.query(
        "UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",
        [ownerSession.sessionId]
      );
    }

    const assignmentContext = await createExecution();
    const assignmentReplayKey = crypto.randomUUID();
    const assignmentReplayInput = completionInput(assignmentContext, 'propose_completion', {
      expiresAt: new Date(Date.now() + 60000).toISOString(), gateRequirements: emptyRequirements(),
    }, ownerActor, assignmentReplayKey);
    await mutateCompletion(runtimePool, {
      ...assignmentReplayInput, csrfToken: ownerSession.csrfToken,
      requestCorrelationId: 'm23p8-assignment-revocation',
    });
    await ownerPool.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
    try {
      await ownerPool.query(
        `UPDATE canonical_schedule_assignments
            SET dispatch_state='revoked',revision=revision+1,
                canonical_digest=canonical_schedule_assignment_digest(
                  target_state,workforce_profile_id,workforce_crew_id,schedule_state,'revoked',
                  scheduled_start,scheduled_end,appointment_status,needs_review,review_reasons),
                last_action_code='test_authority_change',last_reason='Revoke the assignment authority fixture.'
          WHERE id=$1`,
        [assignmentContext.assignment.id]
      );
    } finally {
      await ownerPool.query('ALTER TABLE canonical_schedule_assignments ENABLE TRIGGER USER');
    }
    await expect(mutateCompletion(runtimePool, {
      ...assignmentReplayInput, csrfToken: ownerSession.csrfToken,
      requestCorrelationId: 'm23p8-assignment-revocation',
    })).rejects.toMatchObject({ status: 403 });
    await expect(readCompletion(runtimePool, {
      ...ownerActor, executionId: assignmentContext.execution.id,
    })).rejects.toMatchObject({ status: 404 });
    expect(await request(app)
      .get(`/api/v1/field-executions/${assignmentContext.execution.id}/completion`))
      .toMatchObject({ status: 404 });
  }, 120000);

  test('a lost commit acknowledgement retains one effect and exact retry recovers the response', async () => {
    const context = await createExecution();
    const key = crypto.randomUUID();
    const input = completionInput(context, 'propose_completion', {
      expiresAt: new Date(Date.now() + 60000).toISOString(), gateRequirements: emptyRequirements(),
    }, ownerActor, key);
    let acknowledgementLost = false;
    const uncertainPool = {
      connect: async () => {
        const client = await runtimePool.connect();
        return {
          query: async (...args) => {
            const result = await client.query(...args);
            if (args[0] === 'COMMIT' && !acknowledgementLost) {
              acknowledgementLost = true;
              throw new Error('Synthetic lost COMMIT acknowledgement');
            }
            return result;
          },
          release: discard => client.release(discard),
        };
      },
    };
    await expect(mutateCompletion(uncertainPool, {
      ...input, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-lost-commit',
    })).rejects.toMatchObject({ status: 503, code: 'COMPLETION_UNAVAILABLE' });
    expect(acknowledgementLost).toBe(true);
    const recovered = await mutateCompletion(runtimePool, {
      ...input, csrfToken: ownerSession.csrfToken, requestCorrelationId: 'm23p8-lost-commit',
    });
    expect(recovered.replayed).toBe(true);
    expect(recovered.body.data.lifecycleState).toBe('completion_pending');
    expect((await ownerPool.query(
      'SELECT (SELECT count(*) FROM canonical_completion_records WHERE execution_id=$1)::int records,(SELECT count(*) FROM canonical_completion_events WHERE execution_id=$1)::int events,(SELECT count(*) FROM canonical_completion_audit_events WHERE execution_id=$1)::int audits,(SELECT count(*) FROM canonical_completion_idempotency WHERE execution_id=$1)::int receipts',
      [context.execution.id]
    )).rows[0]).toEqual({ records: 1, events: 1, audits: 1, receipts: 1 });
  }, 120000);

  test('audit sabotage rolls back every effect and runtime authority is narrowly granted', async () => {
    const context = await createExecution();
    const before = (await ownerPool.query(
      'SELECT revision,lifecycle_state,rtrim(canonical_digest) AS digest FROM canonical_field_executions WHERE id=$1',
      [context.execution.id]
    )).rows[0];
    await ownerPool.query("CREATE FUNCTION m23p8_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic completion audit unavailable'; END $$");
    await ownerPool.query('CREATE TRIGGER m23p8_fail_audit BEFORE INSERT ON canonical_completion_audit_events FOR EACH ROW EXECUTE FUNCTION m23p8_fail_audit()');
    const key = crypto.randomUUID();
    try {
      await expect(proposal(context, emptyRequirements(), 60000, { key })).rejects.toMatchObject({ status: 503 });
    } finally {
      await ownerPool.query('DROP TRIGGER m23p8_fail_audit ON canonical_completion_audit_events');
      await ownerPool.query('DROP FUNCTION m23p8_fail_audit()');
    }
    expect((await ownerPool.query(
      'SELECT revision,lifecycle_state,rtrim(canonical_digest) AS digest FROM canonical_field_executions WHERE id=$1',
      [context.execution.id]
    )).rows[0]).toEqual(before);
    expect((await ownerPool.query(
      'SELECT count(*)::int AS count FROM canonical_completion_records WHERE execution_id=$1', [context.execution.id]
    )).rows[0].count).toBe(0);
    const direct = completionInput(context, 'propose_completion', {
      expiresAt: new Date(Date.now() + 60000).toISOString(), gateRequirements: emptyRequirements(),
    });
    for (const field of ['expectedExecutionRevision', 'expectedExecutionDigest',
      'expectedAssignmentRevision', 'expectedAssignmentDigest']) {
      await expect(directCompletion(direct, { [field]: null })).rejects.toMatchObject({ code: '22023' });
    }
    for (const reason of ['<b>complete</b>', 'https://example.test', 'unsafe\u202Etext', 'bad\u200Btext']) {
      await expect(directCompletion(direct, { reason })).rejects.toMatchObject({ code: '22023' });
    }
    expect((await proposal(context, emptyRequirements(), 60000, { key })).replayed).toBe(false);

    for (const table of ['records', 'events', 'audit_events', 'idempotency']) {
      await expect(runtimePool.query(`SELECT * FROM canonical_completion_${table}`)).rejects.toMatchObject({ code: '42501' });
      await expect(ownerPool.query(`UPDATE canonical_completion_${table} SET organization_id=organization_id`)).rejects.toThrow();
      await expect(ownerPool.query(`TRUNCATE canonical_completion_${table}`)).rejects.toThrow();
    }
    await expect(runtimePool.query(
      "SELECT canonical_completion_gate_snapshot($1,$2,'{\"checklists\":[],\"inspections\":[],\"files\":[]}'::jsonb)",
      [IDS.org, context.execution.id]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query('CREATE TABLE public.m23p8_forbidden(id int)')).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query(`SET ROLE ${quote(roles.owner)}`)).rejects.toMatchObject({ code: '42501' });
  }, 120000);

  test('production router enforces the raw JSON boundary and exposes a private bounded completion read', async () => {
    const context = await createExecution();
    const body = {
      action: 'propose_completion',
      expectedExecutionRevision: Number(context.execution.revision),
      expectedExecutionDigest: context.execution.digest,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest,
      reason: 'Explicit HTTP completion proposal evidence.',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      gateRequirements: emptyRequirements(),
    };
    const response = await request(app)
      .post(`/api/v1/field-executions/${context.execution.id}/completion-actions`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('X-CSRF-Token', ownerSession.csrfToken)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.body).toMatchObject({
      success: true, data: { lifecycleState: 'completion_pending' },
      completionRecord: { recordKind: 'proposal' },
    });

    const read = await request(app).get(`/api/v1/field-executions/${context.execution.id}/completion`);
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store, private');
    expect(read.body.data).toMatchObject({ completionInferred: false, authority: 'postgresql' });
    expect(await request(app).get(`/api/v1/field-executions/${context.execution.id}/completion?limit=1`))
      .toMatchObject({ status: 400, body: { error: { code: 'COMPLETION_QUERY_FORBIDDEN' } } });

    const duplicate = JSON.stringify(body).replace(
      '{"action":"propose_completion"',
      '{"action":"propose_completion","action":"propose_completion"'
    );
    const rejected = await request(app)
      .post(`/api/v1/field-executions/${context.execution.id}/completion-actions`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', crypto.randomUUID())
      .set('X-CSRF-Token', ownerSession.csrfToken)
      .send(duplicate);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('M23_EXECUTION_AMBIGUOUS_JSON');
  }, 120000);
});
