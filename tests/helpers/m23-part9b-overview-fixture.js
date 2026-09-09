'use strict';

const EXECUTION = 'e1900000-0000-4000-8000-000000000001';
const APPOINTMENT = 'd1900000-0000-4000-8000-000000000001';
const INSTANT = '2026-09-08T12:00:00.000000Z';

function record(scope = 'owner_admin', overrides = {}) {
  const value = {
    executionId: EXECUTION, appointmentId: APPOINTMENT,
    title: 'Kitchen sink repair', serviceType: 'Plumbing',
    createdAt: INSTANT, updatedAt: INSTANT, lifecycleState: 'in_progress',
    schedule: { state: 'scheduled', start: '2026-09-08T13:00:00.000000Z',
      end: '2026-09-08T15:00:00.000000Z', timeZone: 'America/New_York' },
    assignment: { kind: 'worker', label: 'Alex Rivera', current: true },
    progress: { recorded: 1, needsReview: 1, uncertain: 0 },
    blockers: { open: 0 }, exceptions: { open: 0 },
    approval: { state: 'none' },
    evidence: { state: 'not_evaluated', recorded: 2 },
    capacity: { status: 'unknown', recordedConstraints: 0 },
  };
  if (scope === 'owner_admin') {
    value.ownerDetails = {
      progress: [{ workKey: 'sink', quantity: { completed: '1', total: '2', unit: 'ea' },
        milestone: null, uncertainty: 'measured', observedAt: INSTANT, reviewState: 'needs_review' }],
      progressTruncated: false,
      evidenceCounts: { checklists: 1, inspections: 0, files: 0, notes: 1 },
      operationalCounts: { laborIntervals: 1, materialMovements: 0, equipmentEvents: 0 },
      pendingProposal: null,
    };
  }
  return { ...value, ...overrides };
}

function overview(scope = 'owner_admin', overrides = {}) {
  return {
    version: 'm23-part9b-overview-v1', authority: 'postgresql', readOnly: true,
    scope, evaluatedAt: INSTANT, dataDigest: 'a'.repeat(64),
    filter: 'active', capacity: { status: 'unknown' },
    pagination: { limit: 25, offset: 0, returned: 1, total: 1, nextCursor: null },
    records: [record(scope)], ...overrides,
  };
}

module.exports = { EXECUTION, APPOINTMENT, INSTANT, record, overview };

// Lazy, disposable PostgreSQL fixture: browser-only contract fixtures above
// never open a database. All identities below are synthetic example.test data.
async function createDatabaseFixture(options = {}) {
  const crypto = require('crypto');
  const { Client, Pool } = require('pg');
  const { createSuiteDatabase } = require('./m19-part3-postgres-database');
  const { provisionDurableSession } = require('./account-session-fixture');
  const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
  const quote = value => '"' + value.replace(/"/g, '""') + '"';
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const database = await createSuiteDatabase('m23p9b-overview');
  const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const roles = { owner: `m23p9b_owner_${suffix}`, runtime: `m23p9b_runtime_${suffix}` };
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    for (const role of Object.values(roles)) await admin.query(
      `CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quote(database.databaseName)} OWNER TO ${quote(roles.owner)}`);
  } finally { await admin.end(); }
  const roleUrl = role => {
    const url = new URL(database.connectionString); url.username = role; url.password = ''; return url.toString();
  };
  const ownerPool = new Pool({ connectionString: roleUrl(roles.owner), max: 5 });
  const runtimePool = new Pool({ connectionString: roleUrl(roles.runtime), max: 6 });
  process.env.DATABASE_URL = roleUrl(roles.runtime);
  process.env.MIGRATION_DATABASE_URL = roleUrl(roles.owner);
  const db = require('../../src/db');
  const org = crypto.randomUUID(), otherOrg = crypto.randomUUID();
  const actors = {}, profiles = {};
  let sequence = 0;
  const fixture = { ownerPool, runtimePool, actors, profiles, org, otherOrg, db, roles,
    async cleanup() {
      await db.close(); await runtimePool.end(); await ownerPool.end(); await database.cleanup();
      const cleanupAdmin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
      await cleanupAdmin.connect();
      try { for (const role of Object.values(roles)) await cleanupAdmin.query(`DROP ROLE ${quote(role)}`); }
      finally { await cleanupAdmin.end(); }
      delete process.env.DATABASE_URL; delete process.env.MIGRATION_DATABASE_URL;
    },
    async createExecution(options = {}) {
      sequence += 1;
      const actor = actors[options.actor || 'owner'];
      const tenant = actor.organizationId;
      const operation = crypto.randomUUID(), graph = crypto.randomUUID(), customer = crypto.randomUUID();
      const transcript = crypto.randomUUID(), opportunity = crypto.randomUUID(), appointment = crypto.randomUUID();
      await ownerPool.query(
        "INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at) VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())",
        [operation, tenant, graph, hash(`overview:${sequence}`)]);
      await ownerPool.query(
        "INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Synthetic overview customer')",
        [customer, tenant, operation, graph]);
      await ownerPool.query(
        "INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,source,source_version,transcript_text,normalized_fingerprint) VALUES($1,$2,$3,$4,$5,'lead','fixture','Synthetic recorded work',$6)",
        [transcript, tenant, operation, graph, customer, hash(`transcript:${sequence}`)]);
      await ownerPool.query(
        "INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','Plumbing',$6)",
        [opportunity, tenant, operation, graph, customer, { jobTitle: options.title || `Recorded work ${sequence}` }]);
      const start = options.start ? new Date(options.start) : new Date(Date.UTC(2027, 8, sequence, 13));
      await ownerPool.query(
        "INSERT INTO canonical_appointments(id,organization_id,operation_id,graph_id,opportunity_id,scheduled_start,scheduled_end,status) VALUES($1,$2,$3,$4,$5,$6,$7,'scheduled')",
        [appointment, tenant, operation, graph, opportunity, start, new Date(start.getTime() + 3600000)]);
      // Synthetic accepted-M22 scheduling baseline only, following the retained
      // Part 8 fixture. Execution and evidence mutations use production entries.
      let assignment;
      if (options.approvedScheduling) {
        const request = require('supertest');
        for (const action of ['assign', 'dispatch']) {
          const before = (await ownerPool.query('SELECT revision,rtrim(canonical_digest) AS digest,appointment_status FROM canonical_schedule_assignments WHERE appointment_id=$1', [appointment])).rows[0];
          const preview = await request(fixture.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
            .set(actor.session.headers).send({ expectedRevision: Number(before.revision), expectedDigest: before.digest,
              expectedTimeZone: 'UTC', action, target: { kind: 'profile', id: actors.member.actorUserId },
              scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3600000).toISOString(),
              appointmentStatus: before.appointment_status, reason: 'Explicit synthetic scheduling approval' });
          if (preview.status !== 201) throw new Error('Synthetic scheduling preview failed: ' + JSON.stringify(preview.body));
          const approval = await request(fixture.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
            .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
            .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
              acknowledgedWarningDigests: preview.body.data.warningDigests,
              acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason: 'Explicit synthetic scheduling approval' });
          if (approval.status !== 200) throw new Error('Synthetic scheduling approval failed: ' + JSON.stringify(approval.body));
        }
        assignment = (await ownerPool.query('SELECT id,revision,rtrim(canonical_digest) AS digest FROM canonical_schedule_assignments WHERE appointment_id=$1', [appointment])).rows[0];
      } else {
      await ownerPool.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
      try {
        assignment = (await ownerPool.query(
          "UPDATE canonical_schedule_assignments SET target_state='assigned',workforce_profile_id=$2,schedule_state='scheduled',dispatch_state='dispatched',needs_review=false,review_reasons='[]',revision=4,canonical_digest=canonical_schedule_assignment_digest('assigned',$2,NULL,'scheduled','dispatched',scheduled_start,scheduled_end,appointment_status,false,'[]'),last_action_code='dispatch',last_reason='Accepted synthetic scheduling baseline',updated_at=transaction_timestamp() WHERE appointment_id=$1 RETURNING id,revision,rtrim(canonical_digest) AS digest",
          [appointment, tenant === org ? actors.member.actorUserId : actors.otherOwner.actorUserId])).rows[0];
      } finally { await ownerPool.query('ALTER TABLE canonical_schedule_assignments ENABLE TRIGGER USER'); }
      }
      const repository = require('../../src/operations/repository');
      let execution = (await repository.initializeFieldExecution(runtimePool, {
        ...actor, appointmentId: appointment, expectedAssignmentRevision: Number(assignment.revision),
        expectedAssignmentDigest: assignment.digest, idempotencyKey: crypto.randomUUID(),
        reason: 'Initialize synthetic overview work', requestCorrelationId: `p9b-init-${sequence}`,
      })).body.data;
      execution = (await repository.transitionFieldExecution(runtimePool, {
        ...actor, executionId: execution.id, expectedRevision: execution.revision, expectedDigest: execution.digest,
        expectedAssignmentRevision: Number(assignment.revision), expectedAssignmentDigest: assignment.digest,
        action: 'start', idempotencyKey: crypto.randomUUID(), reason: 'Start synthetic overview work',
        requestCorrelationId: `p9b-start-${sequence}`,
      })).body.data;
      return { execution, assignment, actor, appointment, opportunity };
    },
    async progress(context, action = 'record_progress', document = null, previous = null) {
      const profile = profiles[context.actor.organizationId];
      const body = { action, performerProfileId: actors.member.actorUserId,
        expectedExecutionRevision: context.execution.revision, expectedExecutionDigest: context.execution.digest,
        expectedAssignmentRevision: Number(context.assignment.revision), expectedAssignmentDigest: context.assignment.digest,
        reason: 'Attributable synthetic overview progress',
        document: document || { kind: 'progress', workKey: 'paving', description: 'Measured recorded work',
          observedAt: new Date().toISOString(), timeZoneAuthority: profile, evidence: [],
          quantity: { completed: '2.5', total: '10', unit: 'm2' }, milestone: null,
          uncertainty: 'measured', uncertaintyReason: null },
      };
      if (previous) Object.assign(body, { recordId: previous.id, expectedRecordRevision: previous.revision,
        expectedRecordDigest: previous.digest });
      const input = require('../../src/progress/contract').normalizeProgressAction({ ...context.actor,
        executionId: context.execution.id, idempotencyKey: crypto.randomUUID(), body });
      return (await require('../../src/progress/repository').mutateProgress(runtimePool, {
        ...input, csrfToken: context.actor.csrfToken, requestCorrelationId: 'p9b-progress',
      })).body.data;
    },
    async fieldEvidence(context, action, extra) {
      const input = require('../../src/fieldEvidence/contract').normalizeEvidenceAction({ ...context.actor,
        executionId: context.execution.id, idempotencyKey: crypto.randomUUID(), body: {
          action, performerProfileId: actors.member.actorUserId,
          expectedExecutionRevision: context.execution.revision, expectedExecutionDigest: context.execution.digest,
          expectedAssignmentRevision: Number(context.assignment.revision), expectedAssignmentDigest: context.assignment.digest,
          reason: 'Attributable synthetic field evidence', ...extra,
        } });
      return (await require('../../src/fieldEvidence/repository').mutateFieldEvidence(runtimePool, {
        ...input, csrfToken: context.actor.csrfToken, requestCorrelationId: 'p9b-field-evidence',
      })).body.data;
    },
    async completion(context, action = 'propose_completion', extra = {}) {
      const input = require('../../src/completion/contract').normalizeCompletionAction({ ...context.actor,
        executionId: context.execution.id, idempotencyKey: crypto.randomUUID(), body: {
          action, expectedExecutionRevision: context.execution.revision, expectedExecutionDigest: context.execution.digest,
          expectedAssignmentRevision: Number(context.assignment.revision), expectedAssignmentDigest: context.assignment.digest,
          reason: 'Explicit synthetic completion decision',
          ...(action === 'propose_completion' ? { expiresAt: new Date(Date.now() + 60000).toISOString(),
            gateRequirements: { checklists: [], inspections: [], files: [] } } : {}), ...extra,
        } });
      const result = await require('../../src/completion/repository').mutateCompletion(runtimePool, {
        ...input, csrfToken: context.actor.csrfToken, requestCorrelationId: 'p9b-completion',
      });
      context.execution = result.body.data; return result;
    },
  };
  try {
    if (!await db.initDatabase()) throw new Error('Disposable overview database initialization failed');
    for (const tenant of [org, otherOrg]) await ownerPool.query(
      'INSERT INTO organizations(id,name,email) VALUES($1,$2,$3)',
      [tenant, 'Synthetic owner operations', `${tenant}@example.test`]);
    for (const [name, role, operationalRole, tenant] of [
      ['owner', 'owner', 'owner', org], ['admin', 'admin', 'administrator', org],
      ['dispatcher', 'member', 'dispatcher', org], ['member', 'member', 'technician', org],
      ['viewer', 'viewer', 'employee', org], ['otherOwner', 'owner', 'owner', otherOrg],
    ]) {
      const id = crypto.randomUUID();
      await ownerPool.query("INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,$3,$4,'unused',$5,'active')",
        [id, tenant, 'Synthetic ' + name, `${id}@example.test`, role]);
      await ownerPool.query("INSERT INTO organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,$3,'active')", [id, tenant, role]);
      await ownerPool.query('UPDATE workforce_profiles SET operational_role=$2 WHERE id=$1', [id, operationalRole]);
      actors[name] = { organizationId: tenant, actorUserId: id, actorAccessRole: role };
    }
    for (const [tenant, creator] of [[org, actors.owner], [otherOrg, actors.otherOwner]]) {
      const raw = options.operationalSchedule ? {
        industry: 'plumbing', businessDescription: 'Disposable operational scheduling fixture.',
        company: { name: 'Synthetic owner operations', email: 'tenant@example.test', phone: '+15550106000', timeZone: 'UTC', currency: 'USD' },
        headquarters: { street: '1 Test Way', city: 'Boston', state: 'MA', country: 'US', latitude: 42.36, longitude: -71.06, additionalOffices: [] },
        hours: Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [day, { open: '00:00', close: '23:59', lunch: '', emergency: false, afterHours: false, holiday: false }])),
        scheduling: { maxJobsPerDay: 100, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 }, crew: { defaultCrewSize: 2, maxCrewSize: 50 },
        services: [{ id: 'plumbing', name: 'Plumbing', description: 'Plumbing', active: true }],
      } : { company: { name: 'Synthetic owner operations', timeZone: 'UTC' }, headquarters: {}, services: [] };
      const normalized = adaptBusinessProfile(raw, 'org-profile-v1');
      const row = (await ownerPool.query(
        "INSERT INTO canonical_business_profiles(organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,1,'org-profile-v1',$2,$3,$4,true,$5) RETURNING id",
        [tenant, raw, normalized, normalized.hash, creator.actorUserId])).rows[0];
      profiles[tenant] = { businessProfileId: row.id, version: 1, hash: normalized.hash, timeZone: 'UTC' };
    }
    for (const actor of Object.values(actors)) {
      const session = await provisionDurableSession(ownerPool, { organizationId: actor.organizationId,
        userId: actor.actorUserId, membershipId: actor.actorUserId, role: actor.actorAccessRole });
      Object.assign(actor, { authSessionId: session.sessionId, csrfToken: session.csrfToken, session });
    }
    fixture.app = require('../../src/server').app; // no start(), outbox workers or provider transport
    return fixture;
  } catch (error) { await fixture.cleanup(); throw error; }
}

module.exports.createDatabaseFixture = createDatabaseFixture;
