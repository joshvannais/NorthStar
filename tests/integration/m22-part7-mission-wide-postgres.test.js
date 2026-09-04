'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const request = require('supertest');
const { adaptBusinessProfile, sha256: stableSha256 } = require('../../src/services/businessProfileAdapter');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { chooseFixturePlan, instantAt } = require('../helpers/m22-part6-browser-fixture-time');
const schedulingTime = require('../../public/js/scheduling-time-contract');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const HOSTILE = '<img src=x onerror="globalThis.m22Part7Compromised=true">';
const IDS = Object.freeze({
  organization: 'a7000000-0000-4000-8000-000000000001',
  otherOrganization: 'a7000000-0000-4000-8000-000000000002',
  owner: 'b7000000-0000-4000-8000-000000000001',
  employee: 'b7000000-0000-4000-8000-000000000002',
  teammate: 'b7000000-0000-4000-8000-000000000003',
  otherOwner: 'b7000000-0000-4000-8000-000000000004',
  crew: 'c7000000-0000-4000-8000-000000000001',
  appointment: 'd7000000-0000-4000-8000-000000000001',
  otherAppointment: 'd7000000-0000-4000-8000-000000000002',
});

const CORE_TABLES = Object.freeze([
  'canonical_schedule_assignments',
  'canonical_schedule_assignment_revisions',
  'canonical_schedule_approvals',
  'canonical_schedule_audit_events',
  'canonical_schedule_idempotency',
  'canonical_schedule_mutation_previews',
  'canonical_schedule_human_approvals',
  'canonical_schedule_human_audit_events',
  'canonical_schedule_human_idempotency',
]);

function quoteIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function roleUrl(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}
function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value)
    ? value : JSON.stringify(value)).digest('hex');
}

async function createRoles(database) {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const migrationRole = `northstar_m22_p7_m_${suffix}`.slice(0, 63);
  const runtimeRole = `northstar_m22_p7_r_${suffix}`.slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quoteIdentifier(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quoteIdentifier(database.databaseName)} OWNER TO ${quoteIdentifier(migrationRole)}`);
  } finally { await admin.end(); }
  return {
    migrationRole, runtimeRole,
    migrationUrl: roleUrl(database.connectionString, migrationRole),
    runtimeUrl: roleUrl(database.connectionString, runtimeRole),
  };
}

async function dropRoles(roles) {
  if (!roles) return;
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.runtimeRole)}`);
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.migrationRole)}`);
  } finally { await admin.end(); }
}

function profile(name, timeZone) {
  const hours = {};
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    hours[day] = { open: '00:00', close: '23:59', lunch: '', emergency: false, afterHours: false, holiday: false };
  }
  return {
    industry: 'plumbing',
    businessDescription: 'Mission 22 Part 7 isolated mounted acceptance tenant.',
    company: { name, email: 'part7@example.test', phone: '+15550107000', timeZone, currency: 'USD' },
    headquarters: {
      street: '1 Acceptance Way', city: 'Riverton', state: 'MA', country: 'US',
      latitude: 42.36, longitude: -71.06, additionalOffices: [],
    },
    hours,
    scheduling: { maxJobsPerDay: 20, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 },
    crew: { defaultCrewSize: 2, maxCrewSize: 50 },
    services: [{ id: 'plumbing', name: 'Plumbing', description: 'Plumbing', active: true }],
  };
}

async function seedTenant(pool, organizationId, name, actors, timeZone) {
  await pool.query('INSERT INTO public.organizations(id,name,email) VALUES ($1,$2,$3)',
    [organizationId, name, `${organizationId}@part7.test`]);
  for (const actor of actors) {
    await pool.query(
      `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
      [actor.id, organizationId, actor.name, `${actor.id}@part7.test`, actor.role]
    );
    await pool.query(
      `INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
       VALUES ($1,$2,$1,$3,'active')`, [actor.id, organizationId, actor.role]
    );
  }
  const raw = profile(name, timeZone);
  const normalized = adaptBusinessProfile(raw, 'm22-part7-profile-v1');
  await pool.query(
    `INSERT INTO public.canonical_business_profiles(
       organization_id,version_number,version_label,raw_profile,normalized_profile,
       normalized_profile_hash,is_active,created_by)
     VALUES ($1,1,'m22-part7-profile-v1',$2::jsonb,$3::jsonb,$4,TRUE,$5)`,
    [organizationId, JSON.stringify(raw), JSON.stringify(normalized), normalized.hash, actors[0].id]
  );
}

function graphIds(appointmentId) {
  return {
    operation: appointmentId.replace(/^d7/, 'e7'),
    graph: appointmentId.replace(/^d7/, 'f7'),
    customer: appointmentId.replace(/^d7/, 'a7'),
    transcript: appointmentId.replace(/^d7/, 'b7'),
    opportunity: appointmentId.replace(/^d7/, 'c7'),
    communication: appointmentId.replace(/^d7/, '97'),
    estimate: appointmentId.replace(/^d7/, '87'),
    snapshot: appointmentId.replace(/^d7/, '67'),
  };
}

async function seedAppointment(pool, organizationId, appointmentId, start, end, suffix) {
  const ids = graphIds(appointmentId);
  await pool.query(
    `INSERT INTO public.canonical_operations(
       id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
       lease_owner,lease_expires_at,result_status,result_body,completed_at)
     VALUES ($1,$2,$3,$4,$5,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [ids.operation, organizationId, ids.graph, sha256(`key:${appointmentId}`), sha256(`payload:${appointmentId}`)]
  );
  await pool.query(
    `INSERT INTO public.canonical_customers(id,organization_id,operation_id,graph_id,name,email,phone,address)
     VALUES ($1,$2,$3,$4,$5,'private-history@example.test','+15550107123',$6::jsonb)`,
    [ids.customer, organizationId, ids.operation, ids.graph,
      `Acceptance Customer ${suffix} ${HOSTILE}`, JSON.stringify({
        street: `125 Acceptance Avenue ${HOSTILE}`, city: 'Riverton', state: 'MA', postalCode: '02110',
        internalGateCode: 'SECRET-GATE',
      })]
  );
  await pool.query(
    `INSERT INTO public.canonical_transcripts(
       id,organization_id,operation_id,graph_id,customer_id,source,source_version,transcript_text,normalized_fingerprint)
     VALUES ($1,$2,$3,$4,$5,'manual','m22-part7-mounted',$6,$7)`,
    [ids.transcript, organizationId, ids.operation, ids.graph, ids.customer,
      `PRIVATE TRANSCRIPT ${HOSTILE}`, sha256(`transcript:${appointmentId}`)]
  );
  await pool.query(
    `INSERT INTO public.canonical_communications(
       id,organization_id,operation_id,graph_id,customer_id,transcript_id,
       channel,direction,subject,body,duration_seconds,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,'voice_call','inbound',$7,$8,120,NOW())`,
    [ids.communication, organizationId, ids.operation, ids.graph, ids.customer, ids.transcript,
      `Acceptance inquiry ${HOSTILE}`, `PRIVATE COMMUNICATION ${HOSTILE}`]
  );
  await pool.query(
    `INSERT INTO public.canonical_opportunities(
       id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope)
     VALUES ($1,$2,$3,$4,$5,'qualified','Drain service',$6::jsonb)`,
    [ids.opportunity, organizationId, ids.operation, ids.graph, ids.customer, JSON.stringify({
      jobTitle: `Kitchen drain ${suffix} ${HOSTILE}`,
      instructions: `Use the side entrance. ${HOSTILE}`,
      internalMargin: 'SECRET_FINANCIAL_MARGIN', invoiceId: 'SECRET_INVOICE',
      payroll: 'SECRET_PAYROLL', broadCustomerHistory: 'SECRET_HISTORY',
    })]
  );
  const authority = (await pool.query(
    `SELECT id,version_label,normalized_profile_hash
       FROM public.canonical_business_profiles
      WHERE organization_id=$1 AND is_active=TRUE`, [organizationId]
  )).rows[0];
  const calculation = {
    calculationVersion: 'm22-part7-mounted-v1',
    normalizedInputFingerprint: sha256(`normalized:${appointmentId}`),
    businessProfileInputVersion: authority.version_label,
    businessProfileInputHash: authority.normalized_profile_hash,
    customerFacingPrice: null,
    pricingLineItems: [],
    estimatedRevenue: null,
    grossProfit: null,
    service: { key: 'plumbing', label: `Drain service ${HOSTILE}`, scope: {} },
    notCalculated: ['Mission 24 price authority is outside Mission 22.'],
  };
  const snapshotDigest = stableSha256(calculation);
  await pool.query(
    `INSERT INTO public.canonical_estimates(
       id,organization_id,operation_id,graph_id,opportunity_id,calculation_version,
       normalized_input_fingerprint,business_profile_version,business_profile_hash,currency,
       customer_price,line_items,calculation_output,snapshot_digest,business_profile_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'USD',NULL,'[]'::jsonb,$10::jsonb,$11,$12)`,
    [ids.estimate, organizationId, ids.operation, ids.graph, ids.opportunity,
      calculation.calculationVersion, calculation.normalizedInputFingerprint,
      calculation.businessProfileInputVersion, calculation.businessProfileInputHash,
      JSON.stringify(calculation), snapshotDigest, authority.id]
  );
  await pool.query(
    `INSERT INTO public.canonical_appointments(
       id,organization_id,operation_id,graph_id,opportunity_id,scheduled_start,scheduled_end,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`,
    [appointmentId, organizationId, ids.operation, ids.graph, ids.opportunity, start, end]
  );
  await pool.query(
    `INSERT INTO public.canonical_polaris_snapshots(
       id,organization_id,operation_id,graph_id,customer_id,transcript_id,opportunity_id,
       estimate_id,calculation_version,normalized_input_fingerprint,business_profile_version,
       business_profile_hash,supporting_fact_ids,snapshot,snapshot_digest,business_profile_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}'::uuid[],$13::jsonb,$14,$15)`,
    [ids.snapshot, organizationId, ids.operation, ids.graph, ids.customer, ids.transcript,
      ids.opportunity, ids.estimate, calculation.calculationVersion,
      calculation.normalizedInputFingerprint, calculation.businessProfileInputVersion,
      calculation.businessProfileInputHash, JSON.stringify(calculation), snapshotDigest, authority.id]
  );
  return ids;
}

async function assignment(pool, organizationId = IDS.organization, appointmentId = IDS.appointment) {
  const row = (await pool.query(
    `SELECT id,revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,
            workforce_crew_id,schedule_state,dispatch_state,scheduled_start,scheduled_end,
            appointment_status,needs_review,review_reasons,last_action_code,last_actor_user_id,
            last_approval_id,last_human_approval_id
       FROM public.canonical_schedule_assignments
      WHERE organization_id=$1 AND appointment_id=$2`, [organizationId, appointmentId]
  )).rows[0];
  if (!row) return null;
  return {
    id: row.id, revision: Number(row.revision), digest: row.digest,
    target: row.target_state === 'unassigned' ? { kind: 'unassigned', id: null }
      : row.workforce_profile_id ? { kind: 'profile', id: row.workforce_profile_id }
        : { kind: 'crew', id: row.workforce_crew_id },
    targetState: row.target_state, scheduleState: row.schedule_state, dispatchState: row.dispatch_state,
    scheduledStart: row.scheduled_start ? new Date(row.scheduled_start).toISOString() : null,
    scheduledEnd: row.scheduled_end ? new Date(row.scheduled_end).toISOString() : null,
    appointmentStatus: row.appointment_status, needsReview: row.needs_review,
    reviewReasons: row.review_reasons, lastAction: row.last_action_code,
    lastActorUserId: row.last_actor_user_id, lastApprovalId: row.last_approval_id,
    lastHumanApprovalId: row.last_human_approval_id,
  };
}

async function allTableCounts(pool) {
  const tables = (await pool.query(
    `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`
  )).rows.map(row => row.tablename);
  const counts = {};
  for (const table of tables) {
    counts[table] = Number((await pool.query(`SELECT count(*) AS count FROM public.${quoteIdentifier(table)}`)).rows[0].count);
  }
  return counts;
}

function countDelta(before, after) {
  return Object.fromEntries(Object.keys(after).sort().filter(table => after[table] !== before[table])
    .map(table => [table, after[table] - (before[table] || 0)]));
}

async function history(pool, assignmentId) {
  const revisions = (await pool.query(
    `SELECT revision,source_kind,action_code,actor_user_id,human_approval_id,
            target_state,workforce_profile_id,workforce_crew_id,schedule_state,dispatch_state,
            scheduled_start,scheduled_end,rtrim(canonical_digest) AS digest
       FROM public.canonical_schedule_assignment_revisions
      WHERE organization_id=$1 AND assignment_id=$2 ORDER BY revision`,
    [IDS.organization, assignmentId]
  )).rows.map(row => ({ ...row, revision: Number(row.revision) }));
  const evidence = (await pool.query(
    `SELECT
       (SELECT count(*)::int FROM public.canonical_schedule_human_approvals WHERE organization_id=$1 AND assignment_id=$2) AS approvals,
       (SELECT count(*)::int FROM public.canonical_schedule_human_audit_events WHERE organization_id=$1 AND assignment_id=$2) AS audits,
       (SELECT count(*)::int FROM public.canonical_schedule_human_idempotency WHERE organization_id=$1 AND assignment_id=$2) AS idempotency,
       (SELECT count(*)::int FROM public.canonical_schedule_mutation_previews WHERE organization_id=$1 AND assignment_id=$2) AS previews`,
    [IDS.organization, assignmentId]
  )).rows[0];
  return { revisions, evidence };
}

async function preview(app, session, action, proposal = {}) {
  const before = await assignment(app.locals.m22Pool || require('../../src/db').getPool());
  const reason = proposal.reason || `Mission 22 Part 7 exact human ${action} approval. ${HOSTILE}`;
  const body = {
    expectedRevision: before.revision,
    expectedDigest: before.digest,
    expectedTimeZone: proposal.timeZone,
    action,
    target: Object.prototype.hasOwnProperty.call(proposal, 'target') ? proposal.target : before.target,
    scheduledStart: Object.prototype.hasOwnProperty.call(proposal, 'scheduledStart')
      ? proposal.scheduledStart : before.scheduledStart
        ? schedulingTime.formatInstant(before.scheduledStart, proposal.timeZone).rfc3339 : null,
    scheduledEnd: Object.prototype.hasOwnProperty.call(proposal, 'scheduledEnd')
      ? proposal.scheduledEnd : before.scheduledEnd
        ? schedulingTime.formatInstant(before.scheduledEnd, proposal.timeZone).rfc3339 : null,
    appointmentStatus: before.appointmentStatus,
    reason,
  };
  const response = await request(app)
    .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
    .set(session.headers).send(body);
  return { before, body, reason, response };
}

async function approve(app, session, created, key, overrides = {}) {
  return request(app)
    .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
    .set(session.headers).set('Idempotency-Key', key).send({
      previewId: created.response.body.data.id,
      previewDigest: created.response.body.data.previewDigest,
      acknowledgedWarningDigests: created.response.body.data.warningDigests,
      acknowledgedReviewReasonDigests: created.response.body.data.reviewReasonDigests,
      reason: created.reason,
      ...overrides,
    });
}

function coreCounts(counts) {
  return Object.fromEntries(CORE_TABLES.map(table => [table, counts[table]]));
}

realPostgres('Mission 22 Part 7 coherent mission-wide mounted acceptance trace', () => {
  let database, roles, migrationPool, runtimePool, db, app, sessions, plan, ids;
  const original = {};
  const trace = {
    version: 'm22-part7-record-trace-v1',
    providerCalls: 0,
    productionData: false,
    steps: [],
    unavailable: {
      hostedChecks: 'unavailable', physicalSafari: 'unavailable', liveProviders: 'unavailable',
      providerCredentials: 'unavailable', privateProductionLogs: 'unavailable',
    },
  };

  async function checkpoint(name, previousCounts, material = {}) {
    const current = await assignment(runtimePool);
    const counts = await allTableCounts(migrationPool);
    const item = {
      ordinal: trace.steps.length,
      name,
      assignment: current,
      coreCounts: coreCounts(counts),
      allTableDelta: previousCounts ? countDelta(previousCounts, counts) : {},
      history: current ? await history(runtimePool, current.id) : null,
      ...material,
    };
    trace.steps.push(item);
    return { counts, item };
  }

  beforeAll(async () => {
    for (const key of ['NODE_ENV', 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AUTH_ACCESS_SECRET', 'TZ']) {
      original[key] = process.env[key];
    }
    database = await createSuiteDatabase('m22-p7-trace');
    roles = await createRoles(database);
    migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 3 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.AUTH_ACCESS_SECRET = 'mission-22-part7-test-only-secret-00000000000000000000000000000000';
    process.env.TZ = 'UTC';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    runtimePool = db.getPool();
    ({ app } = require('../../src/server'));
    app.locals.m22Pool = runtimePool;

    plan = chooseFixturePlan(new Date());
    await seedTenant(runtimePool, IDS.organization, 'Mission 22 Part 7 Tenant', [
      { id: IDS.owner, role: 'owner', name: 'Acceptance Owner' },
      { id: IDS.employee, role: 'member', name: `Alex Technician ${HOSTILE}` },
      { id: IDS.teammate, role: 'member', name: `Morgan Technician ${HOSTILE}` },
    ], plan.timeZone);
    await seedTenant(runtimePool, IDS.otherOrganization, 'Mission 22 Part 7 Other Tenant', [
      { id: IDS.otherOwner, role: 'owner', name: 'Other Owner' },
    ], plan.timeZone);
    await runtimePool.query(
      "UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id IN ($2,$3)",
      [IDS.organization, IDS.employee, IDS.teammate]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crews(
         id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'m22-part7-crew',$3,'headquarters',$4,$4)`,
      [IDS.crew, IDS.organization, `Acceptance Crew ${HOSTILE}`, IDS.owner]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crew_members(
         organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       VALUES ($1,$2,$3,'lead',$5),($1,$2,$4,'member',$5)`,
      [IDS.organization, IDS.crew, IDS.employee, IDS.teammate, IDS.owner]
    );
    sessions = {
      owner: await provisionDurableSession(runtimePool, {
        userId: IDS.owner, organizationId: IDS.organization, membershipId: IDS.owner, role: 'owner',
      }),
      employee: await provisionDurableSession(runtimePool, {
        userId: IDS.employee, organizationId: IDS.organization, membershipId: IDS.employee, role: 'member',
      }),
      other: await provisionDurableSession(runtimePool, {
        userId: IDS.otherOwner, organizationId: IDS.otherOrganization, membershipId: IDS.otherOwner, role: 'owner',
      }),
    };
    ids = await seedAppointment(runtimePool, IDS.organization, IDS.appointment,
      instantAt(plan, 30), instantAt(plan, 50), 'primary');
    await seedAppointment(runtimePool, IDS.otherOrganization, IDS.otherAppointment,
      instantAt(plan, 60), instantAt(plan, 80), 'other tenant');
  }, 180000);

  afterAll(async () => {
    try {
      if (process.env.M22_PART7_TRACE_OUTPUT) {
        const output = path.resolve(process.env.M22_PART7_TRACE_OUTPUT);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(trace, null, 2) + '\n', 'utf8');
      }
      if (db) await db.close().catch(() => {});
      if (migrationPool) await migrationPool.end();
      if (database) await database.cleanup();
      await dropRoles(roles);
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }, 180000);

  test('traces one exact appointment from legacy ingress through evaluation, approval, all three surfaces, revocations, and immutable history', async () => {
    const created = await checkpoint('01-new-appointment-created-with-compatible-schedule-ingress', null, {
      appointmentId: IDS.appointment, operationId: ids.operation, graphId: ids.graph, opportunityId: ids.opportunity,
    });
    expect(created.item.assignment).toMatchObject({
      revision: 1, targetState: 'unassigned', scheduleState: 'scheduled', dispatchState: 'not_dispatched',
      needsReview: true, lastAction: 'appointment_created', lastActorUserId: null, lastHumanApprovalId: null,
    });
    expect(created.item.history.revisions).toHaveLength(1);
    expect(created.item.history.revisions[0]).toMatchObject({ revision: 1, source_kind: 'appointment_created', actor_user_id: null });

    const conflictResponse = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/conflicts`)
      .set(sessions.owner.headers).send({
        expectedRevision: created.item.assignment.revision,
        expectedDigest: created.item.assignment.digest,
        expectedTimeZone: plan.timeZone,
        target: { kind: 'profile', id: IDS.employee },
        scheduledStart: instantAt(plan, 30), scheduledEnd: instantAt(plan, 50),
      });
    expect(conflictResponse.status).toBe(200);
    expect(conflictResponse.body.data).toMatchObject({ persisted: false, grantsMutation: false });
    expect(conflictResponse.body.data.digest).toMatch(/^[0-9a-f]{64}$/);
    const evaluated = await checkpoint('02-part2-conflict-evaluation-non-capability', created.counts, {
      conflict: {
        digest: conflictResponse.body.data.digest,
        outcome: conflictResponse.body.data.outcome,
        persisted: conflictResponse.body.data.persisted,
        grantsMutation: conflictResponse.body.data.grantsMutation,
      },
    });
    expect(evaluated.item.assignment).toEqual(created.item.assignment);

    const recommendationResponse = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
      .set(sessions.owner.headers).send({
        expectedRevision: created.item.assignment.revision,
        expectedDigest: created.item.assignment.digest,
        expectedTimeZone: plan.timeZone,
      });
    expect(recommendationResponse.status).toBe(200);
    expect(recommendationResponse.body.data).toMatchObject({ persisted: false, grantsMutation: false });
    expect(recommendationResponse.body.data.constraints).toMatchObject({ providerCallsAllowed: 0, mutationGrant: false });
    expect(recommendationResponse.body.data.alternatives.every(candidate => candidate.route.providerCalls === 0)).toBe(true);
    const recommended = await checkpoint('03-part3-evidence-pinned-recommendation-non-capability', evaluated.counts, {
      recommendation: {
        digest: recommendationResponse.body.data.digest,
        authorityDigest: recommendationResponse.body.data.authorityDigest,
        persisted: recommendationResponse.body.data.persisted,
        grantsMutation: recommendationResponse.body.data.grantsMutation,
        candidateCount: recommendationResponse.body.data.alternatives.length,
        providerCalls: 0,
      },
    });
    expect(recommended.item.assignment).toEqual(created.item.assignment);

    const assignPreview = await preview(app, sessions.owner, 'assign', {
      target: { kind: 'profile', id: IDS.employee }, timeZone: plan.timeZone,
    });
    expect(assignPreview.response.status).toBe(201);
    expect(assignPreview.response.body.data).toMatchObject({ grantsMutation: false });
    const assignedResponse = await approve(app, sessions.owner, assignPreview, 'm22-part7-assign-000000000001');
    expect(assignedResponse.status).toBe(200);
    const assigned = await checkpoint('04-current-owner-human-assign-approval', recommended.counts, {
      previewId: assignPreview.response.body.data.id,
      previewDigest: assignPreview.response.body.data.previewDigest,
      approvalResponse: assignedResponse.body.data.scheduleAuthority,
    });
    expect(assigned.item.assignment).toMatchObject({
      revision: 2, target: { kind: 'profile', id: IDS.employee }, scheduleState: 'scheduled',
      dispatchState: 'not_dispatched', lastAction: 'assign', lastActorUserId: IDS.owner,
    });
    expect(assigned.item.history.evidence).toEqual({ approvals: 1, audits: 1, idempotency: 1, previews: 1 });

    const replay = await approve(app, sessions.owner, assignPreview, 'm22-part7-assign-000000000001');
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(assignedResponse.body);
    const collision = await approve(app, sessions.owner, assignPreview, 'm22-part7-assign-000000000001', {
      reason: 'Divergent collision body must not reuse accepted evidence.',
    });
    expect(collision.status).toBe(409);
    expect(collision.body.error.code).toBe('M22_APPROVAL_INVALID');

    async function surfaces(expected) {
      const [calendar, commandCenter, today] = await Promise.all([
        request(app).get('/api/v1/canonical/compat/calendar').set(sessions.owner.headers),
        request(app).get('/api/v1/command-center/workspace').set(sessions.owner.headers),
        request(app).get('/api/v1/today').set(sessions.employee.headers),
      ]);
      expect(calendar.status).toBe(200);
      expect(commandCenter.status).toBe(200);
      expect(today.status).toBe(200);
      const calendarRecord = calendar.body.data.schedulingOverview.records
        .find(record => record.appointmentId === IDS.appointment);
      const commandRecord = commandCenter.body.data.schedulingOverview.records
        .find(record => record.appointmentId === IDS.appointment);
      const todayRecord = today.body.data.records.find(record => record.appointmentId === IDS.appointment);
      expect(calendarRecord).toBeTruthy();
      expect(commandRecord).toBeTruthy();
      expect(todayRecord).toBeTruthy();
      for (const record of [calendarRecord, commandRecord]) {
        expect(record.authority).toMatchObject({
          revision: expected.revision, digest: expected.digest, targetState: expected.targetState,
          scheduleState: expected.scheduleState, dispatchState: expected.dispatchState,
        });
      }
      expect(todayRecord.authority).toMatchObject({ revision: expected.revision, digest: expected.digest });
      expect(todayRecord.dispatch.state).toBe(expected.dispatchState);
      const serializedToday = JSON.stringify(today.body);
      for (const forbidden of [
        'SECRET_FINANCIAL_MARGIN', 'SECRET_INVOICE', 'SECRET_PAYROLL', 'SECRET_HISTORY',
        'SECRET-GATE', 'private-history@example.test', 'PRIVATE TRANSCRIPT', IDS.otherAppointment,
      ]) expect(serializedToday).not.toContain(forbidden);
      expect(serializedToday).toContain('m22Part7Compromised=true');
      return {
        calendarDigest: calendar.body.data.digest,
        commandCenterDigest: commandCenter.body.data.schedulingOverview.digest,
        todayDigest: today.body.data.digest,
        todayCount: today.body.data.count,
      };
    }

    const assignedSurfaces = await surfaces(assigned.item.assignment);
    const crossSurfaceAssigned = await checkpoint('05-calendar-command-center-today-exact-record-parity', assigned.counts, {
      surfaces: assignedSurfaces,
    });
    expect(crossSurfaceAssigned.item.assignment).toEqual(assigned.item.assignment);

    const dispatchPreview = await preview(app, sessions.owner, 'dispatch', { timeZone: plan.timeZone });
    expect(dispatchPreview.response.status).toBe(201);
    const dispatchedResponse = await approve(app, sessions.owner, dispatchPreview, 'm22-part7-dispatch-0000000001');
    expect(dispatchedResponse.status).toBe(200);
    const dispatched = await checkpoint('06-current-owner-human-dispatch-approval', crossSurfaceAssigned.counts);
    expect(dispatched.item.assignment).toMatchObject({ revision: 3, dispatchState: 'dispatched' });
    await surfaces(dispatched.item.assignment);

    const reassignPreview = await preview(app, sessions.owner, 'reassign', {
      target: { kind: 'crew', id: IDS.crew }, timeZone: plan.timeZone,
    });
    expect(reassignPreview.response.status).toBe(201);
    const reassignedResponse = await approve(app, sessions.owner, reassignPreview, 'm22-part7-reassign-000000001');
    expect(reassignedResponse.status).toBe(200);
    const reassigned = await checkpoint('07-reassign-to-current-crew-atomically-revokes-dispatch', dispatched.counts);
    expect(reassigned.item.assignment).toMatchObject({
      revision: 4, target: { kind: 'crew', id: IDS.crew }, dispatchState: 'revoked', lastAction: 'reassign',
    });
    await surfaces(reassigned.item.assignment);

    const redispatchPreview = await preview(app, sessions.owner, 'dispatch', { timeZone: plan.timeZone });
    expect(redispatchPreview.response.status).toBe(201);
    expect((await approve(app, sessions.owner, redispatchPreview, 'm22-part7-redispatch-0000001')).status).toBe(200);
    const redispatched = await checkpoint('08-new-human-dispatch-approval-after-reassignment', reassigned.counts);
    expect(redispatched.item.assignment).toMatchObject({ revision: 5, dispatchState: 'dispatched' });

    const reschedulePreview = await preview(app, sessions.owner, 'reschedule', {
      scheduledStart: instantAt(plan, 65), scheduledEnd: instantAt(plan, 85), timeZone: plan.timeZone,
    });
    expect(reschedulePreview.response.status).toBe(201);
    expect((await approve(app, sessions.owner, reschedulePreview, 'm22-part7-reschedule-000001')).status).toBe(200);
    const rescheduled = await checkpoint('09-reschedule-atomically-revokes-dispatch', redispatched.counts);
    expect(rescheduled.item.assignment).toMatchObject({
      revision: 6, target: { kind: 'crew', id: IDS.crew }, scheduleState: 'scheduled',
      dispatchState: 'revoked', lastAction: 'reschedule',
    });
    expect(rescheduled.item.assignment.scheduledStart).toBe(new Date(instantAt(plan, 65)).toISOString());
    await surfaces(rescheduled.item.assignment);

    const stale = await preview(app, sessions.owner, 'dispatch', { timeZone: plan.timeZone });
    expect(stale.response.status).toBe(201);
    const fresh = await preview(app, sessions.owner, 'dispatch', { timeZone: plan.timeZone });
    expect(fresh.response.status).toBe(201);
    const [left, right] = await Promise.all([
      approve(app, sessions.owner, stale, 'm22-part7-concurrent-left-001'),
      approve(app, sessions.owner, fresh, 'm22-part7-concurrent-right-01'),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const finalDispatch = await checkpoint('10-concurrent-current-authority-approval-has-one-winner', rescheduled.counts, {
      statuses: [left.status, right.status].sort(),
    });
    expect(finalDispatch.item.assignment).toMatchObject({ revision: 7, dispatchState: 'dispatched' });
    expect(finalDispatch.item.history.revisions).toHaveLength(7);
    expect(finalDispatch.item.history.evidence).toEqual({ approvals: 6, audits: 6, idempotency: 6, previews: 7 });

    const crossTenant = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
      .set(sessions.other.headers).send({
        expectedRevision: finalDispatch.item.assignment.revision,
        expectedDigest: finalDispatch.item.assignment.digest,
        expectedTimeZone: plan.timeZone,
      });
    expect([403, 404]).toContain(crossTenant.status);
    const employeeMutation = await preview(app, sessions.employee, 'dispatch', { timeZone: plan.timeZone });
    expect(employeeMutation.response.status).toBe(403);
    const smuggled = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
      .set(sessions.owner.headers).send({
        expectedRevision: finalDispatch.item.assignment.revision,
        expectedDigest: finalDispatch.item.assignment.digest,
        expectedTimeZone: plan.timeZone,
        organizationId: IDS.otherOrganization, actorUserId: IDS.otherOwner, role: 'owner',
        recommendation: { target: IDS.otherOwner }, providerUrl: 'https://example.invalid',
      });
    expect(smuggled.status).toBe(400);

    await expect(runtimePool.query(
      `UPDATE public.canonical_schedule_assignments SET last_reason='forged runtime write'
        WHERE organization_id=$1 AND appointment_id=$2`, [IDS.organization, IDS.appointment]
    )).rejects.toMatchObject({ code: '23514' });
    await expect(runtimePool.query(
      `UPDATE public.canonical_schedule_human_audit_events SET reason='forged runtime history'
        WHERE organization_id=$1`, [IDS.organization]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query(
      `INSERT INTO public.canonical_schedule_mutation_previews(id) VALUES (gen_random_uuid())`
    )).rejects.toMatchObject({ code: '42501' });

    const beforeRevocation = await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(200);
    expect(beforeRevocation.body.data.records.some(record => record.appointmentId === IDS.appointment)).toBe(true);
    await runtimePool.query(
      `DELETE FROM public.workforce_crew_members
        WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3`,
      [IDS.organization, IDS.crew, IDS.employee]
    );
    const afterRevocation = await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(200);
    expect(afterRevocation.body.data.records.some(record => record.appointmentId === IDS.appointment)).toBe(false);
    expect(JSON.stringify(afterRevocation.body.data.records)).not.toContain('m22Part7Compromised=true');
    const revoked = await checkpoint('11-current-crew-membership-revocation-removes-employee-read', finalDispatch.counts, {
      beforeTodayCount: beforeRevocation.body.data.count,
      afterTodayCount: afterRevocation.body.data.count,
      priorRecordAbsent: true,
    });
    expect(revoked.item.assignment).toEqual(finalDispatch.item.assignment);

    const calendarAfter = await request(app).get('/api/v1/canonical/compat/calendar').set(sessions.owner.headers).expect(200);
    const commandAfter = await request(app).get('/api/v1/command-center/workspace').set(sessions.owner.headers).expect(200);
    expect(calendarAfter.body.data.schedulingOverview.records.find(record => record.appointmentId === IDS.appointment)
      .authority.revision).toBe(7);
    expect(commandAfter.body.data.schedulingOverview.records.find(record => record.appointmentId === IDS.appointment)
      .authority.revision).toBe(7);

    const demo = await request(app).get('/api/demo/command-center').expect(response => {
      expect([200, 401, 404]).toContain(response.status);
    });
    expect(JSON.stringify(demo.body)).not.toContain(IDS.appointment);
    const finalState = await checkpoint('12-terminal-paid-demo-isolated-record-trace', revoked.counts, {
      demoStatus: demo.status,
      employeePriorRecordAbsent: true,
      zeroExternalProviderCalls: true,
    });
    expect(finalState.item.history.revisions.map(row => row.revision)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(finalState.item.history.revisions.map(row => row.source_kind)).toEqual([
      'appointment_created', 'human_preview_approved', 'human_preview_approved',
      'human_preview_approved', 'human_preview_approved', 'human_preview_approved',
      'human_preview_approved',
    ]);
    expect(finalState.item.history.evidence).toEqual({ approvals: 6, audits: 6, idempotency: 6, previews: 7 });
    expect(trace.providerCalls).toBe(0);
  }, 300000);

  test('pins exact migration blobs, restart idempotence, trusted function paths, role separation, and indexed record lookups', async () => {
    const migrations = db.loadMigrations(path.resolve(__dirname, '..', '..', 'migrations'));
    const ledgerBefore = (await migrationPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows;
    expect(ledgerBefore.map(row => ({ filename: row.filename, checksum: row.checksum }))).toEqual(
      migrations.map(row => ({ filename: row.file, checksum: row.digest }))
    );
    expect(ledgerBefore.find(row => row.filename === '037_polaris_provider_usage_authority.sql'))
      .toBeDefined();
    expect((await migrationPool.query("SELECT current_setting('TimeZone') AS value")).rows[0].value).toBe('UTC');
    const restartedRuntime = new Pool({ connectionString: roles.runtimeUrl, max: 2 });
    try { expect(await db.runMigrations({ pool: migrationPool, runtimePool: restartedRuntime })).toBe(true); }
    finally { await restartedRuntime.end(); }
    expect((await migrationPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows).toEqual(ledgerBefore);

    const routinePaths = (await migrationPool.query(
      `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
              array_to_string(p.proconfig,',') AS config
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname LIKE 'canonical_schedule_%'
        ORDER BY p.proname,arguments`
    )).rows;
    expect(routinePaths.length).toBeGreaterThan(20);
    expect(routinePaths.every(row => /search_path=(?:pg_catalog, public|pg_catalog,public)/.test(row.config || ''))).toBe(true);
    const runtimeIdentity = (await runtimePool.query(
      `SELECT current_user AS role,
              has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
              has_schema_privilege(current_user,'public','CREATE') AS schema_create`
    )).rows[0];
    expect(runtimeIdentity).toEqual({ role: roles.runtimeRole, database_create: false, schema_create: false });

    const lookupPlan = (await migrationPool.query(
      `EXPLAIN (FORMAT JSON,COSTS TRUE)
       SELECT * FROM public.canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [IDS.organization, IDS.appointment]
    )).rows[0]['QUERY PLAN'][0];
    expect(JSON.stringify(lookupPlan)).toContain('canonical_schedule_assignments');
    expect(JSON.stringify(lookupPlan)).toMatch(/Index|Bitmap|Seq Scan/);
    trace.migrations = {
      count: ledgerBefore.length,
      latest: ledgerBefore.at(-1).filename,
      latestChecksum: ledgerBefore.at(-1).checksum,
      restartApplied: 0,
      timezone: 'UTC',
      runtimeRole: runtimeIdentity.role,
      runtimeDatabaseCreate: runtimeIdentity.database_create,
      runtimeSchemaCreate: runtimeIdentity.schema_create,
      routineCount: routinePaths.length,
      exactBlobLedger: true,
      lookupPlan,
    };
  }, 180000);

  test('upgrades a supported pre-032 database and backfills exact legacy schedule truth without fabricated approval', async () => {
    let upgradeDatabase, upgradeRoles, upgradeMigrationPool, upgradeRuntimePool, through031;
    const migrationsDirectory = path.resolve(__dirname, '..', '..', 'migrations');
    try {
      upgradeDatabase = await createSuiteDatabase('m22-p7-upgrade031');
      upgradeRoles = await createRoles(upgradeDatabase);
      upgradeMigrationPool = new Pool({ connectionString: upgradeRoles.migrationUrl, max: 2 });
      upgradeRuntimePool = new Pool({ connectionString: upgradeRoles.runtimeUrl, max: 2 });
      through031 = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p7-through031-'));
      for (const filename of fs.readdirSync(migrationsDirectory)
        .filter(name => /^\d+.*\.sql$/.test(name) && name < '032_canonical_schedule_assignment_authority.sql').sort()) {
        fs.copyFileSync(path.join(migrationsDirectory, filename), path.join(through031, filename));
      }
      expect(await db.runMigrations({
        pool: upgradeMigrationPool, runtimePool: upgradeRuntimePool, migrationsDirectory: through031,
      })).toBe(true);
      await seedTenant(upgradeRuntimePool, IDS.organization, 'Mission 22 Part 7 Supported Upgrade', [
        { id: IDS.owner, role: 'owner', name: 'Upgrade Owner' },
        { id: IDS.employee, role: 'member', name: 'Upgrade Technician' },
      ], plan.timeZone);
      await seedAppointment(upgradeRuntimePool, IDS.organization, IDS.appointment,
        instantAt(plan, 30), instantAt(plan, 50), 'supported upgrade');
      expect((await upgradeMigrationPool.query(
        "SELECT to_regclass('public.canonical_schedule_assignments')::text AS relation"
      )).rows[0].relation).toBeNull();
      fs.copyFileSync(
        path.join(migrationsDirectory, '032_canonical_schedule_assignment_authority.sql'),
        path.join(through031, '032_canonical_schedule_assignment_authority.sql')
      );
      expect(await db.runMigrations({
        pool: upgradeMigrationPool, runtimePool: upgradeRuntimePool, migrationsDirectory: through031,
      })).toBe(true);
      expect(await db.runMigrations({
        pool: upgradeMigrationPool, runtimePool: upgradeRuntimePool, migrationsDirectory,
      })).toBe(true);
      const backfilled = await assignment(upgradeRuntimePool);
      expect(backfilled).toMatchObject({
        revision: 1, targetState: 'unassigned', scheduleState: 'scheduled',
        dispatchState: 'not_dispatched', needsReview: true, lastAction: 'legacy_import',
        lastActorUserId: null, lastApprovalId: null, lastHumanApprovalId: null,
      });
      expect(backfilled.scheduledStart).toBe(new Date(instantAt(plan, 30)).toISOString());
      expect(backfilled.scheduledEnd).toBe(new Date(instantAt(plan, 50)).toISOString());
      const backfillHistory = await history(upgradeRuntimePool, backfilled.id);
      expect(backfillHistory.revisions).toHaveLength(1);
      expect(backfillHistory.revisions[0]).toMatchObject({
        revision: 1, source_kind: 'legacy_import', actor_user_id: null, human_approval_id: null,
      });
      expect(backfillHistory.evidence).toEqual({ approvals: 0, audits: 0, idempotency: 0, previews: 0 });
      const ledger = (await upgradeMigrationPool.query(
        'SELECT filename,checksum FROM public._migrations ORDER BY filename'
      )).rows;
      expect(ledger.map(row => row.filename)).toEqual(db.loadMigrations(migrationsDirectory).map(row => row.file));
      expect(ledger.filter(row => row.filename === '032_canonical_schedule_assignment_authority.sql')).toHaveLength(1);
      trace.supportedUpgrade = {
        boundary: '001-031 to 001-035',
        legacyBackfill: backfilled,
        history: backfillHistory,
        migrationCount: ledger.length,
        exactChecksums: true,
      };
    } finally {
      if (upgradeRuntimePool) await upgradeRuntimePool.end();
      if (upgradeMigrationPool) await upgradeMigrationPool.end();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
      if (upgradeRoles) await dropRoles(upgradeRoles);
      if (through031) {
        const resolved = path.resolve(through031);
        const allowed = path.resolve(os.tmpdir()) + path.sep;
        if (!resolved.startsWith(allowed) || !path.basename(resolved).startsWith('northstar-m22-p7-through031-')) {
          throw new Error('Refusing unsafe Part 7 upgrade fixture cleanup');
        }
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  }, 240000);
});
