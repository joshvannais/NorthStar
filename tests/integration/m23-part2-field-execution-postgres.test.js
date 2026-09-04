'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const MIGRATION = '038_canonical_field_execution_authority.sql';
const LABOR_MIGRATION = '039_canonical_labor_time_evidence.sql';
const LABOR_CORRECTION_MIGRATION = '040_canonical_labor_time_audit_corrections.sql';
const LABOR_SOURCE_MIGRATION = '041_canonical_labor_transcript_source_authority.sql';
const MATERIAL_MIGRATION = '042_canonical_material_inventory_evidence.sql';
const LABOR_CATEGORY_VERSION = 'm23-labor-category-v1';
const LABOR_CATEGORY_DIGEST = '298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738';
const MATERIAL_UNIT_VERSION = 'm23-material-unit-v1';
const MATERIAL_UNIT_DIGEST = '8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const DIGEST = /^[0-9a-f]{64}$/;

const IDS = Object.freeze({
  organization: 'c1000000-0000-4000-8000-000000000001',
  otherOrganization: 'c1000000-0000-4000-8000-000000000002',
  owner: 'c2000000-0000-4000-8000-000000000001',
  member: 'c2000000-0000-4000-8000-000000000002',
  unassignedMember: 'c2000000-0000-4000-8000-000000000003',
  dispatcher: 'c2000000-0000-4000-8000-000000000004',
  viewer: 'c2000000-0000-4000-8000-000000000005',
  otherOwner: 'c2000000-0000-4000-8000-000000000006',
  crew: 'c3000000-0000-4000-8000-000000000001',
  appointments: Array.from({ length: 70 }, (_unused, index) => {
    const sequence = index < 8 ? index + 1 : index + 2;
    return `c4000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  }),
  otherAppointment: 'c4000000-0000-4000-8000-000000000009',
});

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function roleUrl(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}

async function createRoles(database, label) {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const migrationRole = `northstar-m23-p2-${label}-migration-${suffix}`.slice(0, 63);
  const runtimeRole = `northstar-m23-p2-${label}-runtime-${suffix}`.slice(0, 63);
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

function businessProfile(name) {
  const hours = {};
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    hours[day] = { open: '00:00', close: '23:59', lunch: '', emergency: false, afterHours: false, holiday: false };
  }
  return {
    industry: 'field-service', businessDescription: `${name} Mission 23 Part 2 test authority.`,
    company: { name, email: 'm23-p2@example.test', phone: '+15550102302', timeZone: 'America/New_York', currency: 'USD' },
    headquarters: { street: '23 Evidence Way', city: 'Boston', state: 'MA', country: 'US', latitude: 42.36, longitude: -71.06, additionalOffices: [] },
    hours,
    scheduling: { maxJobsPerDay: 20, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 },
    crew: { defaultCrewSize: 2, maxCrewSize: 20 },
    services: [{ id: 'field-service', name: 'Field service', description: 'Field service', active: true }],
  };
}

async function seedTenant(pool, organizationId, name, actors) {
  await pool.query('INSERT INTO public.organizations(id,name,email) VALUES ($1,$2,$3)',
    [organizationId, name, `${organizationId}@m23-p2.test`]);
  for (const actor of actors) {
    await pool.query(
      `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
      [actor.id, organizationId, actor.name, `${actor.id}@m23-p2.test`, actor.role]
    );
    await pool.query(
      `INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
       VALUES ($1,$2,$1,$3,'active')`, [actor.id, organizationId, actor.role]
    );
  }
  const raw = businessProfile(name);
  const normalized = adaptBusinessProfile(raw, 'm23-p2-profile-v1');
  await pool.query(
    `INSERT INTO public.canonical_business_profiles(
       organization_id,version_number,version_label,raw_profile,normalized_profile,
       normalized_profile_hash,is_active,created_by)
     VALUES ($1,1,'m23-p2-profile-v1',$2::jsonb,$3::jsonb,$4,TRUE,$5)`,
    [organizationId, JSON.stringify(raw), JSON.stringify(normalized), normalized.hash, actors[0].id]
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function seedAppointment(pool, organizationId, appointmentId, source = 'lead') {
  const sequence = appointmentId.slice(-2);
  const operationId = `c5000000-0000-4000-8000-0000000000${sequence}`;
  const graphId = `c6000000-0000-4000-8000-0000000000${sequence}`;
  const customerId = `c7000000-0000-4000-8000-0000000000${sequence}`;
  const transcriptId = `c8000000-0000-4000-8000-0000000000${sequence}`;
  const opportunityId = `c9000000-0000-4000-8000-0000000000${sequence}`;
  await pool.query(
    `INSERT INTO public.canonical_operations(
       id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
       lease_owner,lease_expires_at,result_status,result_body,completed_at)
     VALUES ($1,$2,$3,$4,$5,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [operationId, organizationId, graphId, sha256(`key:${appointmentId}`), sha256(`payload:${appointmentId}`)]
  );
  await pool.query(
    'INSERT INTO public.canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES ($1,$2,$3,$4,$5)',
    [customerId, organizationId, operationId, graphId, `Customer ${sequence}`]
  );
  await pool.query(
    `INSERT INTO public.canonical_transcripts(
       id,organization_id,operation_id,graph_id,customer_id,source,source_version,
       transcript_text,normalized_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,'m23-part2',$7,$8)`,
    [transcriptId, organizationId, operationId, graphId, customerId, source,
      `Authorized field request ${sequence}`, sha256(`transcript:${appointmentId}`)]
  );
  await pool.query(
    `INSERT INTO public.canonical_opportunities(
       id,organization_id,operation_id,graph_id,customer_id,status,job_scope)
     VALUES ($1,$2,$3,$4,$5,'qualified',$6::jsonb)`,
    [opportunityId, organizationId, operationId, graphId, customerId,
      JSON.stringify({ scope: `Field work ${sequence}` })]
  );
  await pool.query(
    `INSERT INTO public.canonical_appointments(
       id,organization_id,operation_id,graph_id,opportunity_id,scheduled_start,scheduled_end,status)
     VALUES ($1,$2,$3,$4,$5,'2027-06-15T13:00:00Z','2027-06-15T14:00:00Z','scheduled')`,
    [appointmentId, organizationId, operationId, graphId, opportunityId]
  );
}

async function forceAcceptedAssignment(pool, organizationId, appointmentId, profileId) {
  await pool.query('ALTER TABLE public.canonical_schedule_assignments DISABLE TRIGGER USER');
  try {
    const result = await pool.query(
      `UPDATE public.canonical_schedule_assignments
          SET target_state='assigned', workforce_profile_id=$3, workforce_crew_id=NULL,
              schedule_state='scheduled', dispatch_state='dispatched', needs_review=FALSE,
              review_reasons='[]'::jsonb, revision=4,
              canonical_digest=public.canonical_schedule_assignment_digest(
                'assigned',$3,NULL,'scheduled','dispatched',scheduled_start,scheduled_end,
                appointment_status,FALSE,'[]'::jsonb),
              last_action_code='dispatch',last_reason='Accepted upstream Mission 22 fixture.',
              updated_at=transaction_timestamp()
        WHERE organization_id=$1 AND appointment_id=$2
        RETURNING id,revision,rtrim(canonical_digest) AS digest`,
      [organizationId, appointmentId, profileId]
    );
    if (result.rowCount !== 1) throw new Error('Expected one canonical assignment fixture');
    return result.rows[0];
  } finally {
    await pool.query('ALTER TABLE public.canonical_schedule_assignments ENABLE TRIGGER USER');
  }
}

async function forceAssignmentAuthority(pool, organizationId, appointmentId, changes = {}) {
  const current = (await pool.query(
    `SELECT target_state,workforce_profile_id,workforce_crew_id,dispatch_state,
            appointment_status
       FROM public.canonical_schedule_assignments
      WHERE organization_id=$1 AND appointment_id=$2`,
    [organizationId, appointmentId]
  )).rows[0];
  if (!current) throw new Error('Expected current canonical assignment fixture');
  const next = {
    targetState: changes.targetState === undefined ? current.target_state : changes.targetState,
    profileId: changes.profileId === undefined ? current.workforce_profile_id : changes.profileId,
    crewId: changes.crewId === undefined ? current.workforce_crew_id : changes.crewId,
    dispatchState: changes.dispatchState === undefined ? current.dispatch_state : changes.dispatchState,
    appointmentStatus: changes.appointmentStatus === undefined
      ? current.appointment_status : changes.appointmentStatus,
  };
  await pool.query('ALTER TABLE public.canonical_schedule_assignments DISABLE TRIGGER USER');
  try {
    const result = await pool.query(
      `UPDATE public.canonical_schedule_assignments
          SET target_state=$3::text,workforce_profile_id=$4::uuid,workforce_crew_id=$5::uuid,
              dispatch_state=$6::text,appointment_status=$7::text,revision=revision+1,
              canonical_digest=public.canonical_schedule_assignment_digest(
                $3::text,$4::uuid,$5::uuid,schedule_state,$6::text,
                scheduled_start,scheduled_end,$7::text,
                needs_review,review_reasons),
              last_action_code='test_authority_change',
              last_reason='Adversarial current-authority replay fixture.',
              updated_at=transaction_timestamp()
        WHERE organization_id=$1 AND appointment_id=$2
        RETURNING id,revision,rtrim(canonical_digest) AS digest`,
      [organizationId, appointmentId, next.targetState, next.profileId, next.crewId,
        next.dispatchState, next.appointmentStatus]
    );
    if (result.rowCount !== 1) throw new Error('Expected one current assignment mutation');
    return result.rows[0];
  } finally {
    await pool.query('ALTER TABLE public.canonical_schedule_assignments ENABLE TRIGGER USER');
  }
}

async function assignCrew(pool, appointmentId, crewId) {
  await pool.query(
    `INSERT INTO public.workforce_crews(
       id,organization_id,crew_key,name,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$5)`,
    [crewId, IDS.organization, `m23-replay-${crewId.slice(-2)}`,
      `M23 replay crew ${crewId.slice(-2)}`, IDS.owner]
  );
  await pool.query(
    `INSERT INTO public.workforce_crew_members(
       organization_id,crew_id,profile_id,crew_role,created_by_user_id)
     VALUES ($1,$2,$3,'member',$4)`,
    [IDS.organization, crewId, IDS.member, IDS.owner]
  );
  return forceAssignmentAuthority(pool, IDS.organization, appointmentId, {
    targetState: 'assigned', profileId: null, crewId, dispatchState: 'dispatched',
  });
}

async function forceAppointmentStatus(pool, appointmentId, status) {
  await pool.query('ALTER TABLE public.canonical_appointments DISABLE TRIGGER USER');
  try {
    await pool.query(
      `UPDATE public.canonical_appointments
          SET status=$3,updated_at=transaction_timestamp()
        WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, appointmentId, status]
    );
  } finally {
    await pool.query('ALTER TABLE public.canonical_appointments ENABLE TRIGGER USER');
  }
}

async function executionEvidence(pool, executionId) {
  return (await pool.query(
    `SELECT to_jsonb(execution) AS current,
            (SELECT count(*)::int FROM public.canonical_field_execution_events
              WHERE execution_id=execution.id) AS events,
            (SELECT count(*)::int FROM public.canonical_field_execution_revisions
              WHERE execution_id=execution.id) AS revisions,
            (SELECT count(*)::int FROM public.canonical_field_execution_audit_events
              WHERE execution_id=execution.id) AS audits,
            (SELECT count(*)::int FROM public.canonical_field_execution_idempotency
              WHERE execution_id=execution.id) AS idempotency_count,
            (SELECT jsonb_agg(jsonb_build_object(
                'keyHash',rtrim(replay.idempotency_key_hash),
                'requestDigest',rtrim(replay.request_digest),
                'responseStatus',replay.response_status,
                'responseBody',replay.response_body
              ) ORDER BY replay.idempotency_key_hash)
               FROM public.canonical_field_execution_idempotency replay
              WHERE replay.execution_id=execution.id) AS stored_replays
       FROM public.canonical_field_executions execution
      WHERE execution.id=$1`,
    [executionId]
  )).rows[0];
}

async function laborEvidence(pool, intervalId) {
  return (await pool.query(
    `SELECT to_jsonb(current_interval) AS current,
            (SELECT count(*)::int FROM public.canonical_labor_events
              WHERE interval_id=current_interval.id) AS events,
            (SELECT count(*)::int FROM public.canonical_labor_revisions
              WHERE interval_id=current_interval.id) AS revisions,
            (SELECT count(*)::int FROM public.canonical_labor_audit_events
              WHERE interval_id=current_interval.id) AS audits,
            (SELECT count(*)::int FROM public.canonical_labor_idempotency
              WHERE interval_id=current_interval.id) AS replays
       FROM public.canonical_labor_intervals current_interval
      WHERE current_interval.id=$1`,
    [intervalId]
  )).rows[0];
}

async function laborExecutionEvidence(pool, executionId) {
  return (await pool.query(
    `SELECT
       (SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id),'[]'::jsonb)
          FROM public.canonical_labor_intervals row_value
         WHERE row_value.execution_id=$1) AS current_rows,
       (SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id),'[]'::jsonb)
          FROM public.canonical_labor_events row_value
         WHERE row_value.execution_id=$1) AS events,
       (SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id),'[]'::jsonb)
          FROM public.canonical_labor_revisions row_value
          JOIN public.canonical_labor_intervals current_interval
            ON current_interval.organization_id=row_value.organization_id
           AND current_interval.id=row_value.interval_id
         WHERE current_interval.execution_id=$1) AS revisions,
       (SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id),'[]'::jsonb)
          FROM public.canonical_labor_audit_events row_value
         WHERE row_value.execution_id=$1) AS audits,
       (SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.idempotency_key_hash),'[]'::jsonb)
          FROM public.canonical_labor_idempotency row_value
         WHERE row_value.execution_id=$1) AS idempotency`,
    [executionId]
  )).rows[0];
}

function tenantRfc3339(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(date).filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  const offset = parts.timeZoneName === 'GMT' ? 'Z' : parts.timeZoneName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function entry(input, session, role, overrides = {}) {
  return {
    organizationId: input.organizationId || IDS.organization,
    actorUserId: input.actorUserId,
    actorAccessRole: role,
    authSessionId: session.sessionId,
    csrfToken: session.csrfToken,
    appointmentId: input.appointmentId,
    expectedAssignmentRevision: input.assignment.revision,
    expectedAssignmentDigest: input.assignment.digest,
    idempotencyKey: input.key || `m23-p2-${crypto.randomUUID()}`,
    reason: input.reason || 'Initialize exact canonical field execution.',
    requestCorrelationId: input.requestCorrelationId || `m23-p2-request-${crypto.randomUUID()}`,
    ...overrides,
  };
}

function transition(input, session, role, overrides = {}) {
  return {
    organizationId: input.organizationId || IDS.organization,
    actorUserId: input.actorUserId,
    actorAccessRole: role,
    authSessionId: session.sessionId,
    csrfToken: session.csrfToken,
    executionId: input.execution.id,
    expectedRevision: input.execution.revision,
    expectedDigest: input.execution.digest,
    expectedAssignmentRevision: input.assignment.revision,
    expectedAssignmentDigest: input.assignment.digest,
    action: input.action,
    idempotencyKey: input.key || `m23-p2-${crypto.randomUUID()}`,
    reason: input.reason || `Record ${input.action} against exact field authority.`,
    requestCorrelationId: input.requestCorrelationId || `m23-p2-request-${crypto.randomUUID()}`,
    ...overrides,
  };
}

function labor(input, session, role, timeAuthority, overrides = {}) {
  return {
    organizationId: input.organizationId || IDS.organization,
    actorUserId: input.actorUserId,
    actorAccessRole: role,
    authSessionId: session.sessionId,
    csrfToken: session.csrfToken,
    executionId: input.execution.id,
    action: input.action,
    performerProfileId: input.performerProfileId || input.actorUserId,
    category: input.category === undefined ? null : input.category,
    categoryContractVersion: LABOR_CATEGORY_VERSION,
    categoryContractDigest: LABOR_CATEGORY_DIGEST,
    expectedExecutionRevision: input.execution.revision,
    expectedExecutionDigest: input.execution.digest,
    expectedAssignmentRevision: input.assignment.revision,
    expectedAssignmentDigest: input.assignment.digest,
    businessProfileId: timeAuthority.id,
    businessProfileVersion: Number(timeAuthority.version_number),
    businessProfileHash: timeAuthority.hash,
    timeZone: timeAuthority.time_zone,
    observedStart: input.observedStart || null,
    observedEnd: input.observedEnd || null,
    intervalId: input.interval ? input.interval.id : null,
    expectedIntervalRevision: input.interval ? input.interval.revision : null,
    expectedIntervalDigest: input.interval ? input.interval.digest : null,
    reviewOutcome: input.reviewOutcome || null,
    idempotencyKey: input.key || `m23-p3-${crypto.randomUUID()}`,
    reason: input.reason || `Record ${input.action} as operational labor evidence.`,
    requestCorrelationId: input.requestCorrelationId || `m23-p3-request-${crypto.randomUUID()}`,
    ...overrides,
  };
}

function material(input, session, role, overrides = {}) {
  const writesMaterial = ['record', 'correct'].includes(input.action);
  const usesExisting = ['correct', 'review', 'reverse'].includes(input.action);
  return {
    organizationId: input.organizationId || IDS.organization,
    actorUserId: input.actorUserId,
    actorAccessRole: role,
    authSessionId: session.sessionId,
    csrfToken: session.csrfToken,
    executionId: input.execution.id,
    action: input.action,
    performerProfileId: input.performerProfileId || input.actorUserId,
    movementKind: writesMaterial ? input.movementKind : null,
    itemKey: writesMaterial ? input.itemKey : null,
    description: writesMaterial ? input.description : null,
    quantity: writesMaterial ? input.quantity : null,
    unitCode: writesMaterial ? input.unitCode : null,
    unitContractVersion: MATERIAL_UNIT_VERSION,
    unitContractDigest: MATERIAL_UNIT_DIGEST,
    locationKey: writesMaterial ? (input.locationKey || null) : null,
    destinationLocationKey: writesMaterial ? (input.destinationLocationKey || null) : null,
    lotCode: writesMaterial ? (input.lotCode || null) : null,
    adjustmentDirection: writesMaterial ? (input.adjustmentDirection || null) : null,
    movementId: usesExisting ? input.movement.id : null,
    expectedMovementRevision: usesExisting ? input.movement.revision : null,
    expectedMovementDigest: usesExisting ? input.movement.digest : null,
    reviewOutcome: input.action === 'review' ? input.reviewOutcome : null,
    expectedExecutionRevision: input.execution.revision,
    expectedExecutionDigest: input.execution.digest,
    expectedAssignmentRevision: input.assignment.revision,
    expectedAssignmentDigest: input.assignment.digest,
    idempotencyKey: input.key || `m23-p4-${crypto.randomUUID()}`,
    reason: input.reason || `Record ${input.action} as material movement evidence.`,
    requestCorrelationId: input.requestCorrelationId || `m23-p4-request-${crypto.randomUUID()}`,
    ...overrides,
  };
}

async function materialEvidence(pool, executionId) {
  return (await pool.query(
    `SELECT
      (SELECT count(*)::int FROM public.canonical_material_movements WHERE execution_id=$1) AS movements,
      (SELECT count(*)::int FROM public.canonical_material_events WHERE execution_id=$1) AS events,
      (SELECT count(*)::int FROM public.canonical_material_revisions revision
        JOIN public.canonical_material_movements movement
          ON movement.organization_id=revision.organization_id AND movement.id=revision.movement_id
        WHERE movement.execution_id=$1) AS revisions,
      (SELECT count(*)::int FROM public.canonical_material_audit_events WHERE execution_id=$1) AS audits,
      (SELECT count(*)::int FROM public.canonical_material_idempotency WHERE execution_id=$1) AS replays`,
    [executionId]
  )).rows[0];
}

realPostgres('Mission 23 Part 2 canonical field execution PostgreSQL authority', () => {
  let database;
  let roles;
  let migrationPool;
  let runtimePool;
  let db;
  let repository;
  let sessions;
  let timeAuthority;
  const assignments = new Map();
  const original = {};

  beforeAll(async () => {
    for (const key of ['NODE_ENV', 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AUTH_ACCESS_SECRET', 'TZ']) original[key] = process.env[key];
    database = await createSuiteDatabase('m23-p2-execution');
    roles = await createRoles(database, 'authority');
    migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 4 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.AUTH_ACCESS_SECRET = 'mission-23-part2-test-only-secret-00000000000000000000000000000000';
    process.env.TZ = 'UTC';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    runtimePool = db.getPool();
    repository = require('../../src/operations/repository');

    await seedTenant(migrationPool, IDS.organization, 'Mission 23 Part 2', [
      { id: IDS.owner, role: 'owner', name: 'Part 2 owner' },
      { id: IDS.member, role: 'member', name: 'Assigned worker' },
      { id: IDS.unassignedMember, role: 'member', name: 'Unassigned worker' },
      { id: IDS.dispatcher, role: 'member', name: 'Dispatcher' },
      { id: IDS.viewer, role: 'viewer', name: 'Viewer' },
    ]);
    await seedTenant(migrationPool, IDS.otherOrganization, 'Mission 23 Part 2 Other', [
      { id: IDS.otherOwner, role: 'owner', name: 'Other owner' },
    ]);
    await migrationPool.query(
      "UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id=$2",
      [IDS.organization, IDS.member]
    );
    await migrationPool.query(
      "UPDATE public.workforce_profiles SET operational_role='dispatcher' WHERE organization_id=$1 AND id=$2",
      [IDS.organization, IDS.dispatcher]
    );
    sessions = {
      owner: await provisionDurableSession(migrationPool, { userId: IDS.owner, organizationId: IDS.organization, membershipId: IDS.owner, role: 'owner' }),
      member: await provisionDurableSession(migrationPool, { userId: IDS.member, organizationId: IDS.organization, membershipId: IDS.member, role: 'member' }),
      unassigned: await provisionDurableSession(migrationPool, { userId: IDS.unassignedMember, organizationId: IDS.organization, membershipId: IDS.unassignedMember, role: 'member' }),
      dispatcher: await provisionDurableSession(migrationPool, { userId: IDS.dispatcher, organizationId: IDS.organization, membershipId: IDS.dispatcher, role: 'member' }),
      viewer: await provisionDurableSession(migrationPool, { userId: IDS.viewer, organizationId: IDS.organization, membershipId: IDS.viewer, role: 'viewer' }),
      other: await provisionDurableSession(migrationPool, { userId: IDS.otherOwner, organizationId: IDS.otherOrganization, membershipId: IDS.otherOwner, role: 'owner' }),
    };
    timeAuthority = (await migrationPool.query(
      `SELECT id,version_number,rtrim(normalized_profile_hash) AS hash,
              raw_profile#>>'{company,timeZone}' AS time_zone
         FROM public.canonical_business_profiles
        WHERE organization_id=$1 AND is_active`, [IDS.organization]
    )).rows[0];
    for (const appointmentId of IDS.appointments) {
      await seedAppointment(migrationPool, IDS.organization, appointmentId);
      assignments.set(appointmentId,
        await forceAcceptedAssignment(migrationPool, IDS.organization, appointmentId, IDS.member));
    }
    await seedAppointment(migrationPool, IDS.otherOrganization, IDS.otherAppointment);
    assignments.set(IDS.otherAppointment,
      await forceAcceptedAssignment(migrationPool, IDS.otherOrganization, IDS.otherAppointment, IDS.otherOwner));
  }, 180000);

  afterAll(async () => {
    try {
      if (db) await db.close().catch(() => {});
      if (migrationPool) await migrationPool.end().catch(() => {});
      if (database) await database.cleanup();
      await dropRoles(roles);
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }, 180000);

  async function createStartedExecution(index, actorUserId = IDS.member,
    session = sessions.member, role = 'member') {
    const appointmentId = IDS.appointments[index];
    const assignment = assignments.get(appointmentId);
    const created = (await repository.initializeFieldExecution(runtimePool, entry({
      appointmentId, assignment, actorUserId,
    }, session, role))).body.data;
    const started = (await repository.transitionFieldExecution(runtimePool, transition({
      execution: created, assignment, actorUserId, action: 'start',
    }, session, role))).body.data;
    return { appointmentId, assignment, execution: started };
  }

  test('uses the automatic runner exactly once and preserves PostgreSQL 18 UTC identity on restart', async () => {
    const source = db.loadMigrations(MIGRATIONS).find(item => item.file === MIGRATION);
    const before = (await migrationPool.query(
      'SELECT checksum,applied_at FROM public._migrations WHERE filename=$1', [MIGRATION]
    )).rows;
    expect(before).toHaveLength(1);
    expect(before[0].checksum).toBe(source.digest);
    await db.close();
    db.resetForTests();
    expect(await db.initDatabase()).toBe(true);
    runtimePool = db.getPool();
    expect(await db.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
    const after = (await migrationPool.query(
      `SELECT checksum,applied_at,
              (SELECT count(*)::int FROM public._migrations WHERE filename=$1) AS rows
         FROM public._migrations WHERE filename=$1`, [MIGRATION]
    )).rows[0];
    expect(after).toMatchObject({ checksum: source.digest, rows: 1 });
    expect(after.applied_at.toISOString()).toBe(before[0].applied_at.toISOString());
    const identity = (await migrationPool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('server_encoding') AS encoding,
              (SELECT datcollate FROM pg_catalog.pg_database
                WHERE datname=current_database()) AS collate,
              current_setting('data_checksums') AS data_checksums`
    )).rows[0];
    expect(Number(identity.version.split('.')[0])).toBe(18);
    expect(identity).toMatchObject({ timezone: 'UTC', encoding: 'UTF8', collate: 'C', data_checksums: 'on' });
  }, 120000);

  test('derives individual assigned-worker authority and records complete immutable evidence', async () => {
    const appointmentId = IDS.appointments[0];
    const assignment = assignments.get(appointmentId);
    const created = await repository.initializeFieldExecution(runtimePool, entry({
      appointmentId, assignment, actorUserId: IDS.member,
    }, sessions.member, 'member'));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      appointmentId, assignmentId: assignment.id, lifecycleState: 'not_started',
      sourceAssignmentRevision: 4, recordedByUserId: IDS.member,
      performedByProfileId: IDS.member, revision: 1,
    });
    expect(created.body.data.digest).toMatch(DIGEST);
    const counts = (await migrationPool.query(
      `SELECT
        (SELECT count(*)::int FROM public.canonical_field_execution_events WHERE execution_id=$1) AS events,
        (SELECT count(*)::int FROM public.canonical_field_execution_revisions WHERE execution_id=$1) AS revisions,
        (SELECT count(*)::int FROM public.canonical_field_execution_audit_events WHERE execution_id=$1) AS audits,
        (SELECT count(*)::int FROM public.canonical_field_execution_idempotency WHERE execution_id=$1) AS replays`,
      [created.body.data.id]
    )).rows[0];
    expect(counts).toEqual({ events: 1, revisions: 1, audits: 1, replays: 1 });
  });

  test('fails closed across tenant, viewer, dispatcher, unassigned worker, and client role claims', async () => {
    const appointmentId = IDS.appointments[1];
    const assignment = assignments.get(appointmentId);
    const attempts = [
      entry({ appointmentId, assignment, actorUserId: IDS.otherOwner, organizationId: IDS.otherOrganization }, sessions.other, 'owner'),
      entry({ appointmentId, assignment, actorUserId: IDS.viewer }, sessions.viewer, 'viewer'),
      entry({ appointmentId, assignment, actorUserId: IDS.dispatcher }, sessions.dispatcher, 'member'),
      entry({ appointmentId, assignment, actorUserId: IDS.unassignedMember }, sessions.unassigned, 'member'),
      entry({ appointmentId, assignment, actorUserId: IDS.member }, sessions.member, 'owner'),
    ];
    const expected = [404, 403, 403, 403, 403];
    for (let index = 0; index < attempts.length; index += 1) {
      await expect(repository.initializeFieldExecution(runtimePool, attempts[index]))
        .rejects.toMatchObject({ status: expected[index] });
    }
    expect((await migrationPool.query(
      'SELECT count(*)::int AS count FROM public.canonical_field_executions WHERE appointment_id=$1',
      [appointmentId]
    )).rows[0].count).toBe(0);
  });

  test('requires exact current assignment and execution pins and permits only Part 2 transitions', async () => {
    const appointmentId = IDS.appointments[2];
    const assignment = assignments.get(appointmentId);
    await expect(repository.initializeFieldExecution(runtimePool, entry({
      appointmentId, assignment, actorUserId: IDS.owner,
    }, sessions.owner, 'owner', { expectedAssignmentRevision: 3 })))
      .rejects.toMatchObject({ status: 409, code: 'M23_EXECUTION_STALE' });
    const created = (await repository.initializeFieldExecution(runtimePool, entry({
      appointmentId, assignment, actorUserId: IDS.owner,
    }, sessions.owner, 'owner'))).body.data;
    await expect(repository.transitionFieldExecution(runtimePool, transition({
      execution: created, assignment, actorUserId: IDS.owner, action: 'start',
    }, sessions.owner, 'owner', { expectedDigest: 'f'.repeat(64) })))
      .rejects.toMatchObject({ status: 409, code: 'M23_EXECUTION_STALE' });
    await expect(repository.transitionFieldExecution(runtimePool, transition({
      execution: created, assignment, actorUserId: IDS.owner, action: 'complete',
    }, sessions.owner, 'owner'))).rejects.toMatchObject({ status: 400 });
    const started = (await repository.transitionFieldExecution(runtimePool, transition({
      execution: created, assignment, actorUserId: IDS.owner, action: 'start',
    }, sessions.owner, 'owner'))).body.data;
    expect(started).toMatchObject({ lifecycleState: 'in_progress', revision: 2, lastAction: 'start' });
  });

  test('returns the exact stored response for replay and rejects mismatched key reuse', async () => {
    const appointmentId = IDS.appointments[3];
    const assignment = assignments.get(appointmentId);
    const key = 'm23-part2-exact-replay-key-0001';
    const firstInput = entry({
      appointmentId, assignment, actorUserId: IDS.member, key,
      requestCorrelationId: 'm23-original-request',
    }, sessions.member, 'member');
    const first = await repository.initializeFieldExecution(runtimePool, firstInput);
    const replay = await repository.initializeFieldExecution(runtimePool, {
      ...firstInput, requestCorrelationId: 'm23-retry-request',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.body.requestId).toBe('m23-original-request');
    await expect(repository.initializeFieldExecution(runtimePool, {
      ...firstInput, reason: 'A different mutation cannot reuse this key.',
    })).rejects.toMatchObject({ status: 409, code: 'M23_EXECUTION_IDEMPOTENCY_CONFLICT' });
  });

  test('preserves exact replay after a benign current assignment revision while authority remains valid', async () => {
    const appointmentId = IDS.appointments[7];
    const assignment = assignments.get(appointmentId);
    const initializeInput = entry({
      appointmentId, assignment, actorUserId: IDS.member,
      key: 'm23-benign-init-replay-0001', requestCorrelationId: 'm23-benign-init-original',
    }, sessions.member, 'member');
    const initializedResult = await repository.initializeFieldExecution(runtimePool, initializeInput);
    const initialized = initializedResult.body.data;
    const transitionInput = transition({
      execution: initialized, assignment, actorUserId: IDS.member, action: 'start',
      key: 'm23-benign-start-replay-001', requestCorrelationId: 'm23-benign-start-original',
    }, sessions.member, 'member');
    const startedResult = await repository.transitionFieldExecution(runtimePool, transitionInput);
    await forceAssignmentAuthority(migrationPool, IDS.organization, appointmentId);
    const before = await executionEvidence(migrationPool, initialized.id);

    const initializeReplay = await repository.initializeFieldExecution(runtimePool, initializeInput);
    const transitionReplay = await repository.transitionFieldExecution(runtimePool, transitionInput);

    expect(initializeReplay).toMatchObject({ status: 201, replayed: true });
    expect(initializeReplay.body).toEqual(initializedResult.body);
    expect(transitionReplay).toMatchObject({ status: 200, replayed: true });
    expect(transitionReplay.body).toEqual(startedResult.body);
    expect(await executionEvidence(migrationPool, initialized.id)).toEqual(before);
  });

  test('denies initialize and transition replay after every current-authority loss without new effects', async () => {
    const scenarios = [
      {
        label: 'direct reassignment',
        revoke: context => forceAssignmentAuthority(
          migrationPool, IDS.organization, context.appointmentId,
          { profileId: IDS.unassignedMember, crewId: null }
        ),
      },
      {
        label: 'crew removal',
        prepare: async context => {
          context.crewId = 'd3000000-0000-4000-8000-000000000010';
          return assignCrew(migrationPool, context.appointmentId, context.crewId);
        },
        revoke: context => migrationPool.query(
          `DELETE FROM public.workforce_crew_members
            WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3`,
          [IDS.organization, context.crewId, IDS.member]
        ),
      },
      {
        label: 'dispatch revocation',
        revoke: context => forceAssignmentAuthority(
          migrationPool, IDS.organization, context.appointmentId,
          { dispatchState: 'revoked' }
        ),
      },
      {
        label: 'assignment removal',
        revoke: context => forceAssignmentAuthority(
          migrationPool, IDS.organization, context.appointmentId,
          { targetState: 'unassigned', profileId: null, crewId: null, dispatchState: 'revoked' }
        ),
      },
      {
        label: 'assignment appointment completion',
        revoke: context => forceAssignmentAuthority(
          migrationPool, IDS.organization, context.appointmentId,
          { appointmentStatus: 'completed' }
        ),
      },
      {
        label: 'canonical appointment completion',
        revoke: context => forceAppointmentStatus(
          migrationPool, context.appointmentId, 'completed'
        ),
      },
      {
        label: 'transcript source invalidation',
        revoke: context => migrationPool.query(
          `UPDATE public.canonical_transcripts transcript SET source='demo'
            FROM public.canonical_appointments appointment
           WHERE appointment.organization_id=$1 AND appointment.id=$2
             AND transcript.organization_id=appointment.organization_id
             AND transcript.operation_id=appointment.operation_id`,
          [IDS.organization, context.appointmentId]
        ),
      },
      {
        label: 'subscription loss',
        revoke: async context => {
          context.originalSubscriptionStatus = (await migrationPool.query(
            'SELECT status FROM public.subscriptions WHERE organization_id=$1',
            [IDS.organization]
          )).rows[0].status;
          await migrationPool.query(
            "UPDATE public.subscriptions SET status='past_due' WHERE organization_id=$1",
            [IDS.organization]
          );
        },
        restore: context => migrationPool.query(
          'UPDATE public.subscriptions SET status=$2 WHERE organization_id=$1',
          [IDS.organization, context.originalSubscriptionStatus]
        ),
      },
      {
        label: 'session revocation',
        revoke: () => migrationPool.query(
          `UPDATE public.auth_sessions
              SET status='revoked',revoked_at=transaction_timestamp(),revoke_reason='m23_test'
            WHERE id=$1`,
          [sessions.member.sessionId]
        ),
        restore: () => migrationPool.query(
          `UPDATE public.auth_sessions
              SET status='active',revoked_at=NULL,revoke_reason=NULL
            WHERE id=$1`,
          [sessions.member.sessionId]
        ),
      },
      {
        label: 'crew-member account inactivation',
        prepare: async context => {
          context.crewId = 'd3000000-0000-4000-8000-000000000018';
          return assignCrew(migrationPool, context.appointmentId, context.crewId);
        },
        revoke: () => migrationPool.query(
          "UPDATE public.users SET status='suspended' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, IDS.member]
        ),
        restore: () => migrationPool.query(
          "UPDATE public.users SET status='active' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, IDS.member]
        ),
      },
      {
        label: 'membership inactivation',
        revoke: () => migrationPool.query(
          "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND user_id=$2",
          [IDS.organization, IDS.member]
        ),
        restore: () => migrationPool.query(
          "UPDATE public.organization_memberships SET status='active' WHERE organization_id=$1 AND user_id=$2",
          [IDS.organization, IDS.member]
        ),
      },
      {
        label: 'actor permission loss',
        revoke: () => migrationPool.query(
          "UPDATE public.organization_memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2",
          [IDS.organization, IDS.member]
        ),
        restore: () => migrationPool.query(
          "UPDATE public.organization_memberships SET role='member' WHERE organization_id=$1 AND user_id=$2",
          [IDS.organization, IDS.member]
        ),
      },
    ];

    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const appointmentId = IDS.appointments[index + 8];
      const context = { appointmentId };
      const assignment = scenario.prepare
        ? await scenario.prepare(context)
        : assignments.get(appointmentId);
      const initializeInput = entry({
        appointmentId, assignment, actorUserId: IDS.member,
        key: `m23-revoked-init-${String(index).padStart(2, '0')}-0001`,
        requestCorrelationId: `m23-revoked-init-original-${index}`,
      }, sessions.member, 'member');
      const initialized = (await repository.initializeFieldExecution(
        runtimePool, initializeInput
      )).body.data;
      const transitionInput = transition({
        execution: initialized, assignment, actorUserId: IDS.member, action: 'start',
        key: `m23-revoked-start-${String(index).padStart(2, '0')}-001`,
        requestCorrelationId: `m23-revoked-start-original-${index}`,
      }, sessions.member, 'member');
      await repository.transitionFieldExecution(runtimePool, transitionInput);
      const before = await executionEvidence(migrationPool, initialized.id);
      expect(before).toMatchObject({
        events: 2, revisions: 2, audits: 2, idempotency_count: 2,
      });

      await scenario.revoke(context);
      try {
        for (const replay of [
          () => repository.initializeFieldExecution(runtimePool, initializeInput),
          () => repository.transitionFieldExecution(runtimePool, transitionInput),
        ]) {
          await expect(replay()).rejects.toMatchObject({
            status: 403, code: 'M23_EXECUTION_FORBIDDEN',
          });
        }
        expect(await executionEvidence(migrationPool, initialized.id)).toEqual(before);
      } catch (error) {
        error.message = `${scenario.label}: ${error.message}`;
        throw error;
      } finally {
        if (scenario.restore) await scenario.restore(context);
      }
    }
  }, 120000);

  test('serializes concurrent mutations to one winner and makes same-key concurrency one effect', async () => {
    const appointmentId = IDS.appointments[4];
    const assignment = assignments.get(appointmentId);
    const created = (await repository.initializeFieldExecution(runtimePool, entry({
      appointmentId, assignment, actorUserId: IDS.owner,
    }, sessions.owner, 'owner'))).body.data;
    const candidates = ['winner-a-0000000000000001', 'winner-b-0000000000000001'].map(key =>
      repository.transitionFieldExecution(runtimePool, transition({
        execution: created, assignment, actorUserId: IDS.owner, action: 'start', key,
      }, sessions.owner, 'owner'))
    );
    const resolved = await Promise.allSettled(candidates);
    expect(resolved.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(resolved.filter(item => item.status === 'rejected')[0].reason)
      .toMatchObject({ status: 409, code: 'M23_EXECUTION_STALE' });
    const started = resolved.find(item => item.status === 'fulfilled').value.body.data;
    const sameKey = 'm23-part2-concurrent-replay-0001';
    const pauses = [1, 2].map(() => repository.transitionFieldExecution(runtimePool, transition({
      execution: started, assignment, actorUserId: IDS.owner, action: 'pause', key: sameKey,
    }, sessions.owner, 'owner')));
    const [pauseA, pauseB] = await Promise.all(pauses);
    expect([pauseA.replayed, pauseB.replayed].sort()).toEqual([false, true]);
    expect(pauseA.body).toEqual(pauseB.body);
    const counts = (await migrationPool.query(
      `SELECT count(*) FILTER (WHERE action_code='pause')::int AS pauses,
              count(*)::int AS events
         FROM public.canonical_field_execution_events WHERE execution_id=$1`,
      [created.id]
    )).rows[0];
    expect(counts).toEqual({ pauses: 1, events: 3 });
  }, 30000);

  test('rolls back current, history, audit, and replay atomically when audit insertion fails', async () => {
    const appointmentId = IDS.appointments[5];
    const assignment = assignments.get(appointmentId);
    const created = (await repository.initializeFieldExecution(runtimePool, entry({
      appointmentId, assignment, actorUserId: IDS.owner,
    }, sessions.owner, 'owner'))).body.data;
    await migrationPool.query(
      `CREATE OR REPLACE FUNCTION public.m23_p2_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'test audit rejection'; END $$`
    );
    await migrationPool.query(
      `CREATE TRIGGER m23_p2_test_reject_audit BEFORE INSERT ON public.canonical_field_execution_audit_events
       FOR EACH ROW EXECUTE FUNCTION public.m23_p2_test_reject_audit()`
    );
    try {
      await expect(repository.transitionFieldExecution(runtimePool, transition({
        execution: created, assignment, actorUserId: IDS.owner, action: 'start',
      }, sessions.owner, 'owner'))).rejects.toMatchObject({ status: 503 });
    } finally {
      await migrationPool.query('DROP TRIGGER m23_p2_test_reject_audit ON public.canonical_field_execution_audit_events');
      await migrationPool.query('DROP FUNCTION public.m23_p2_test_reject_audit()');
    }
    const evidence = (await migrationPool.query(
      `SELECT execution.revision,execution.lifecycle_state,
              (SELECT count(*)::int FROM public.canonical_field_execution_events WHERE execution_id=execution.id) AS events,
              (SELECT count(*)::int FROM public.canonical_field_execution_revisions WHERE execution_id=execution.id) AS revisions,
              (SELECT count(*)::int FROM public.canonical_field_execution_audit_events WHERE execution_id=execution.id) AS audits,
              (SELECT count(*)::int FROM public.canonical_field_execution_idempotency WHERE execution_id=execution.id) AS replays
         FROM public.canonical_field_executions execution WHERE execution.id=$1`, [created.id]
    )).rows[0];
    expect(evidence).toMatchObject({ revision: '1', lifecycle_state: 'not_started', events: 1, revisions: 1, audits: 1, replays: 1 });
  });

  test('withholds canonical tables/helpers from runtime and keeps history immutable even to migration role', async () => {
    for (const sql of [
      'SELECT * FROM public.canonical_field_executions LIMIT 1',
      'INSERT INTO public.canonical_field_execution_events(id) VALUES (gen_random_uuid())',
      "SELECT public.canonical_field_execution_reason_valid('bypass')",
      `SELECT public.canonical_field_execution_replay_authorized(
         NULL::uuid,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid)`,
    ]) {
      await expect(runtimePool.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
    const event = (await migrationPool.query(
      'SELECT id FROM public.canonical_field_execution_events ORDER BY decided_at LIMIT 1'
    )).rows[0];
    await expect(migrationPool.query(
      "UPDATE public.canonical_field_execution_events SET reason='tampered' WHERE id=$1", [event.id]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_field_execution_evidence_immutable' });
  });

  test('reads are tenant-private, assigned-member bounded, and owner-readable without exposing storage authority', async () => {
    const appointmentId = IDS.appointments[6];
    const assignment = assignments.get(appointmentId);
    const created = (await repository.initializeFieldExecution(runtimePool, entry({
      appointmentId, assignment, actorUserId: IDS.owner,
    }, sessions.owner, 'owner'))).body.data;
    const memberRead = await repository.readFieldExecution(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.member, actorAccessRole: 'member',
      authSessionId: sessions.member.sessionId, executionId: created.id,
    });
    expect(memberRead.body.data).toMatchObject({ id: created.id, performedByProfileId: IDS.owner });
    await expect(repository.readFieldExecution(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.unassignedMember, actorAccessRole: 'member',
      authSessionId: sessions.unassigned.sessionId, executionId: created.id,
    })).rejects.toMatchObject({ status: 404 });
    await expect(repository.readFieldExecution(runtimePool, {
      organizationId: IDS.otherOrganization, actorUserId: IDS.otherOwner, actorAccessRole: 'owner',
      authSessionId: sessions.other.sessionId, executionId: created.id,
    })).rejects.toMatchObject({ status: 404 });
  });

  test('Part 3 records timer, manual, correction, and review as complete immutable labor evidence', async () => {
    const context = await createStartedExecution(20);
    const timerStarted = (await repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'start_timer', category: 'production',
    }, sessions.member, 'member', timeAuthority))).body.data;
    expect(timerStarted).toMatchObject({ entryMode: 'timer', category: 'production',
      performedByProfileId: IDS.member, reviewState: 'unreviewed', revision: 1 });
    expect(timerStarted.observedEnd).toBeNull();
    const timerStopped = (await repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'stop_timer', interval: timerStarted,
    }, sessions.member, 'member', timeAuthority))).body.data;
    expect(timerStopped).toMatchObject({ entryMode: 'timer', revision: 2, lastAction: 'stop_timer' });
    expect(timerStopped.durationSeconds).toBeGreaterThanOrEqual(0);

    const manual = (await repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.owner, action: 'record_manual', performerProfileId: IDS.member,
      category: 'travel', observedStart: '2026-08-10T08:00:00-04:00',
      observedEnd: '2026-08-10T08:30:00-04:00',
    }, sessions.owner, 'owner', timeAuthority))).body.data;
    expect(manual).toMatchObject({ entryMode: 'manual', durationSeconds: 1800,
      reviewState: 'needs_review', recordedByUserId: IDS.owner });
    const corrected = (await repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'correct', interval: manual,
      category: 'setup', observedStart: '2026-08-10T08:05:00-04:00',
      observedEnd: '2026-08-10T08:35:00-04:00',
    }, sessions.member, 'member', timeAuthority))).body.data;
    expect(corrected).toMatchObject({ entryMode: 'manual', category: 'setup', revision: 2,
      reviewState: 'unreviewed' });
    const reviewed = (await repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'review', interval: corrected,
      reviewOutcome: 'accepted',
    }, sessions.member, 'member', timeAuthority))).body.data;
    expect(reviewed).toMatchObject({ reviewState: 'accepted', revision: 3, lastAction: 'review' });

    const evidence = (await migrationPool.query(
      `SELECT (SELECT count(*)::int FROM public.canonical_labor_intervals WHERE execution_id=$1) AS intervals,
              (SELECT count(*)::int FROM public.canonical_labor_events WHERE execution_id=$1) AS events,
              (SELECT count(*)::int FROM public.canonical_labor_revisions revision
                JOIN public.canonical_labor_intervals current_interval
                  ON current_interval.organization_id=revision.organization_id AND current_interval.id=revision.interval_id
               WHERE current_interval.execution_id=$1) AS revisions,
              (SELECT count(*)::int FROM public.canonical_labor_audit_events WHERE execution_id=$1) AS audits,
              (SELECT count(*)::int FROM public.canonical_labor_idempotency WHERE execution_id=$1) AS replays`,
      [context.execution.id]
    )).rows[0];
    expect(evidence).toEqual({ intervals: 2, events: 5, revisions: 5, audits: 5, replays: 5 });
  });

  test('Part 3 rejects DST gaps, preserves distinct fold instants, and returns safe summaries', async () => {
    const context = await createStartedExecution(21);
    await expect(repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'record_manual', category: 'production',
      observedStart: '2026-03-08T02:15:00-05:00', observedEnd: '2026-03-08T02:45:00-05:00',
    }, sessions.member, 'member', timeAuthority))).rejects.toMatchObject({
      status: 400, code: 'INVALID_LABOR_REQUEST',
    });
    const first = (await repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'record_manual', category: 'production',
      observedStart: '2025-11-02T01:15:00-04:00', observedEnd: '2025-11-02T01:45:00-04:00',
    }, sessions.member, 'member', timeAuthority))).body.data;
    const second = (await repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'record_manual', category: 'production',
      observedStart: '2025-11-02T01:15:00-05:00', observedEnd: '2025-11-02T01:45:00-05:00',
    }, sessions.member, 'member', timeAuthority))).body.data;
    expect(first.displayStart).toBe(second.displayStart);
    expect(first.observedStart).not.toBe(second.observedStart);
    const read = await repository.readLaborTime(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.member, actorAccessRole: 'member',
      authSessionId: sessions.member.sessionId, executionId: context.execution.id,
    });
    expect(read.body.data).toMatchObject({ totalIntervalCount: 2, truncated: false });
    expect(read.body.data.summaries[0]).toMatchObject({ category: 'production',
      closedIntervalCount: 2, observedSeconds: 3600 });
    expect(read.body.data.interpretation).toContain('not payroll');
  });

  test('Part 3 makes overlap and open-timer races one-winner operations across a worker', async () => {
    const contextA = await createStartedExecution(22);
    const contextB = await createStartedExecution(23);
    const overlapping = [contextA, contextB].map((context, index) =>
      repository.mutateLaborTime(runtimePool, labor({
        ...context, actorUserId: IDS.member, action: 'record_manual', category: 'cleanup',
        observedStart: index ? '2026-08-11T10:15:00-04:00' : '2026-08-11T10:00:00-04:00',
        observedEnd: index ? '2026-08-11T10:45:00-04:00' : '2026-08-11T10:30:00-04:00',
      }, sessions.member, 'member', timeAuthority)));
    const overlapResults = await Promise.allSettled(overlapping);
    expect(overlapResults.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(overlapResults.find(item => item.status === 'rejected').reason)
      .toMatchObject({ status: 409, code: 'M23_LABOR_OVERLAP' });

    const timerAttempts = [contextA, contextB].map(context => repository.mutateLaborTime(runtimePool,
      labor({ ...context, actorUserId: IDS.member, action: 'start_timer', category: 'production' },
        sessions.member, 'member', timeAuthority)));
    const timerResults = await Promise.allSettled(timerAttempts);
    expect(timerResults.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(timerResults.find(item => item.status === 'rejected').reason)
      .toMatchObject({ status: 409, code: 'M23_LABOR_TIMER_ALREADY_OPEN' });
  }, 30000);

  test('Part 3 rejects stale, cross-tenant, forged-performer, and revoked replay without effects', async () => {
    const context = await createStartedExecution(24);
    await expect(repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'record_manual', category: 'setup',
      observedStart: '2026-08-12T09:00:00-04:00', observedEnd: '2026-08-12T09:30:00-04:00',
    }, sessions.member, 'member', timeAuthority, { expectedExecutionDigest: 'f'.repeat(64) })))
      .rejects.toMatchObject({ status: 409, code: 'M23_LABOR_STALE' });
    await expect(repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.owner, performerProfileId: IDS.unassignedMember,
      action: 'record_manual', category: 'setup', observedStart: '2026-08-12T09:00:00-04:00',
      observedEnd: '2026-08-12T09:30:00-04:00',
    }, sessions.owner, 'owner', timeAuthority))).rejects.toMatchObject({ status: 403 });
    await expect(repository.mutateLaborTime(runtimePool, labor({
      ...context, organizationId: IDS.otherOrganization, actorUserId: IDS.otherOwner,
      action: 'record_manual', category: 'setup', observedStart: '2026-08-12T09:00:00-04:00',
      observedEnd: '2026-08-12T09:30:00-04:00',
    }, sessions.other, 'owner', timeAuthority))).rejects.toMatchObject({ status: 404 });

    const replayInput = labor({ ...context, actorUserId: IDS.member, action: 'record_manual',
      category: 'setup', observedStart: '2026-08-12T09:00:00-04:00',
      observedEnd: '2026-08-12T09:30:00-04:00', key: 'm23-p3-revoked-replay-0001',
    }, sessions.member, 'member', timeAuthority);
    await repository.mutateLaborTime(runtimePool, replayInput);
    const before = (await migrationPool.query(
      `SELECT count(*)::int AS events FROM public.canonical_labor_events WHERE execution_id=$1`,
      [context.execution.id]
    )).rows[0];
    await forceAssignmentAuthority(migrationPool, IDS.organization, context.appointmentId,
      { targetState: 'unassigned', profileId: null, crewId: null, dispatchState: 'revoked' });
    await expect(repository.mutateLaborTime(runtimePool, replayInput)).rejects.toMatchObject({ status: 403 });
    expect((await migrationPool.query(
      `SELECT count(*)::int AS events FROM public.canonical_labor_events WHERE execution_id=$1`,
      [context.execution.id]
    )).rows[0]).toEqual(before);
  });

  test('Part 3 replays an exact request once, conflicts on changed content, and makes concurrent retries one effect', async () => {
    const exactContext = await createStartedExecution(25);
    const exactInput = labor({
      ...exactContext, actorUserId: IDS.member, action: 'record_manual', category: 'production',
      observedStart: '2026-08-13T08:00:00-04:00', observedEnd: '2026-08-13T08:30:00-04:00',
      key: 'm23-p3-exact-replay-000001',
    }, sessions.member, 'member', timeAuthority);
    const first = await repository.mutateLaborTime(runtimePool, exactInput);
    const replay = await repository.mutateLaborTime(runtimePool, exactInput);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(first.body);
    await expect(repository.mutateLaborTime(runtimePool, {
      ...exactInput, reason: 'Changed content must not reuse the same labor key.',
    })).rejects.toMatchObject({ status: 409, code: 'M23_LABOR_IDEMPOTENCY_CONFLICT' });

    const concurrentContext = await createStartedExecution(26);
    const concurrentInput = labor({
      ...concurrentContext, actorUserId: IDS.member, action: 'record_manual', category: 'setup',
      observedStart: '2026-08-13T09:00:00-04:00', observedEnd: '2026-08-13T09:30:00-04:00',
      key: 'm23-p3-concurrent-retry-001',
    }, sessions.member, 'member', timeAuthority);
    const concurrent = await Promise.all([
      repository.mutateLaborTime(runtimePool, concurrentInput),
      repository.mutateLaborTime(runtimePool, concurrentInput),
    ]);
    expect(concurrent.map(item => item.replayed).sort()).toEqual([false, true]);
    expect(concurrent[0].body).toEqual(concurrent[1].body);
    const counts = (await migrationPool.query(
      `SELECT (SELECT count(*)::int FROM public.canonical_labor_intervals WHERE execution_id=$1) AS intervals,
              (SELECT count(*)::int FROM public.canonical_labor_events WHERE execution_id=$1) AS events,
              (SELECT count(*)::int FROM public.canonical_labor_audit_events WHERE execution_id=$1) AS audits,
              (SELECT count(*)::int FROM public.canonical_labor_idempotency WHERE execution_id=$1) AS replays`,
      [concurrentContext.execution.id]
    )).rows[0];
    expect(counts).toEqual({ intervals: 1, events: 1, audits: 1, replays: 1 });
  }, 30000);

  test('Part 3 rolls back the full evidence set when an audit insertion fails', async () => {
    const context = await createStartedExecution(27);
    await migrationPool.query(
      `CREATE FUNCTION public.m23_part3_fail_labor_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'forced labor audit failure'
         USING ERRCODE='P0001',CONSTRAINT='m23_part3_forced_audit_failure'; END $$`
    );
    await migrationPool.query(
      `CREATE TRIGGER m23_part3_forced_audit_failure BEFORE INSERT ON public.canonical_labor_audit_events
       FOR EACH ROW EXECUTE FUNCTION public.m23_part3_fail_labor_audit()`
    );
    try {
      await expect(repository.mutateLaborTime(runtimePool, labor({
        ...context, actorUserId: IDS.member, action: 'record_manual', category: 'cleanup',
        observedStart: '2026-08-13T10:00:00-04:00', observedEnd: '2026-08-13T10:30:00-04:00',
      }, sessions.member, 'member', timeAuthority))).rejects.toMatchObject({ status: 503 });
    } finally {
      await migrationPool.query(
        'DROP TRIGGER m23_part3_forced_audit_failure ON public.canonical_labor_audit_events'
      );
      await migrationPool.query('DROP FUNCTION public.m23_part3_fail_labor_audit()');
    }
    const counts = (await migrationPool.query(
      `SELECT (SELECT count(*)::int FROM public.canonical_labor_intervals WHERE execution_id=$1) AS intervals,
              (SELECT count(*)::int FROM public.canonical_labor_events WHERE execution_id=$1) AS events,
              (SELECT count(*)::int FROM public.canonical_labor_revisions revision
                JOIN public.canonical_labor_intervals current_interval
                  ON current_interval.organization_id=revision.organization_id AND current_interval.id=revision.interval_id
               WHERE current_interval.execution_id=$1) AS revisions,
              (SELECT count(*)::int FROM public.canonical_labor_audit_events WHERE execution_id=$1) AS audits,
              (SELECT count(*)::int FROM public.canonical_labor_idempotency WHERE execution_id=$1) AS replays`,
      [context.execution.id]
    )).rows[0];
    expect(counts).toEqual({ intervals: 0, events: 0, revisions: 0, audits: 0, replays: 0 });
  });

  test('Part 3 reauthorizes crew membership on replay and rejects stale category, time, and text authority without effects', async () => {
    const crewContextIndex = 28;
    const crewAppointmentId = IDS.appointments[crewContextIndex];
    const crewId = 'c3000000-0000-4000-8000-000000000002';
    assignments.set(crewAppointmentId, await assignCrew(migrationPool, crewAppointmentId, crewId));
    const crewContext = await createStartedExecution(crewContextIndex);
    const crewReplayInput = labor({
      ...crewContext, actorUserId: IDS.member, action: 'record_manual', category: 'travel',
      observedStart: '2026-08-13T11:00:00-04:00', observedEnd: '2026-08-13T11:30:00-04:00',
      key: 'm23-p3-crew-replay-revoke-1',
    }, sessions.member, 'member', timeAuthority);
    await repository.mutateLaborTime(runtimePool, crewReplayInput);
    await migrationPool.query(
      'DELETE FROM public.workforce_crew_members WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3',
      [IDS.organization, crewId, IDS.member]
    );
    await expect(repository.mutateLaborTime(runtimePool, crewReplayInput))
      .rejects.toMatchObject({ status: 403 });

    const boundaryContext = await createStartedExecution(29);
    const base = labor({
      ...boundaryContext, actorUserId: IDS.member, action: 'record_manual', category: 'other',
      observedStart: '2026-08-13T12:00:00-04:00', observedEnd: '2026-08-13T12:30:00-04:00',
    }, sessions.member, 'member', timeAuthority);
    await expect(repository.mutateLaborTime(runtimePool, {
      ...base, categoryContractDigest: 'f'.repeat(64),
    })).rejects.toMatchObject({ status: 409, code: 'M23_LABOR_SOURCE_STALE' });
    await expect(repository.mutateLaborTime(runtimePool, {
      ...base, idempotencyKey: 'm23-p3-stale-time-source-01', businessProfileHash: 'f'.repeat(64),
    })).rejects.toMatchObject({ status: 409, code: 'M23_LABOR_SOURCE_STALE' });
    await expect(repository.mutateLaborTime(runtimePool, {
      ...base, idempotencyKey: 'm23-p3-control-text-boundary-1', reason: 'invalid\u0001reason',
    })).rejects.toMatchObject({ status: 400, code: 'INVALID_LABOR_REQUEST' });
    const noEffects = (await migrationPool.query(
      `SELECT (SELECT count(*)::int FROM public.canonical_labor_intervals WHERE execution_id=$1) AS intervals,
              (SELECT count(*)::int FROM public.canonical_labor_events WHERE execution_id=$1) AS events,
              (SELECT count(*)::int FROM public.canonical_labor_idempotency WHERE execution_id=$1) AS replays`,
      [boundaryContext.execution.id]
    )).rows[0];
    expect(noEffects).toEqual({ intervals: 0, events: 0, replays: 0 });
  });

  test('Part 3 review cannot restore rejected evidence into an authoritative overlap', async () => {
    const contextA = await createStartedExecution(30);
    const contextB = await createStartedExecution(31);
    const intervalA = (await repository.mutateLaborTime(runtimePool, labor({
      ...contextA, actorUserId: IDS.member, action: 'record_manual', category: 'production',
      observedStart: '2026-08-14T08:00:00-04:00', observedEnd: '2026-08-14T09:00:00-04:00',
    }, sessions.member, 'member', timeAuthority))).body.data;
    const rejectedA = (await repository.mutateLaborTime(runtimePool, labor({
      ...contextA, actorUserId: IDS.member, action: 'review', interval: intervalA,
      reviewOutcome: 'rejected',
    }, sessions.member, 'member', timeAuthority))).body.data;
    await repository.mutateLaborTime(runtimePool, labor({
      ...contextB, actorUserId: IDS.member, action: 'record_manual', category: 'setup',
      observedStart: '2026-08-14T08:30:00-04:00', observedEnd: '2026-08-14T09:30:00-04:00',
    }, sessions.member, 'member', timeAuthority));
    const before = await laborEvidence(migrationPool, rejectedA.id);
    await expect(repository.mutateLaborTime(runtimePool, labor({
      ...contextA, actorUserId: IDS.member, action: 'review', interval: rejectedA,
      reviewOutcome: 'accepted', key: 'm23-p3-review-overlap-denied-01',
    }, sessions.member, 'member', timeAuthority))).rejects.toMatchObject({
      status: 409, code: 'M23_LABOR_OVERLAP',
    });
    expect(await laborEvidence(migrationPool, rejectedA.id)).toEqual(before);
  });

  test('Part 3 serializes concurrent reviews that would create a worker overlap', async () => {
    const contextA = await createStartedExecution(32);
    const contextB = await createStartedExecution(33);
    const createRejected = async (context, start, end) => {
      const recorded = (await repository.mutateLaborTime(runtimePool, labor({
        ...context, actorUserId: IDS.member, action: 'record_manual', category: 'cleanup',
        observedStart: start, observedEnd: end,
      }, sessions.member, 'member', timeAuthority))).body.data;
      return (await repository.mutateLaborTime(runtimePool, labor({
        ...context, actorUserId: IDS.member, action: 'review', interval: recorded,
        reviewOutcome: 'rejected',
      }, sessions.member, 'member', timeAuthority))).body.data;
    };
    const rejectedA = await createRejected(
      contextA, '2026-08-14T10:00:00-04:00', '2026-08-14T11:00:00-04:00'
    );
    const rejectedB = await createRejected(
      contextB, '2026-08-14T10:30:00-04:00', '2026-08-14T11:30:00-04:00'
    );
    const inputs = [
      labor({
        ...contextA, actorUserId: IDS.member, action: 'review', interval: rejectedA,
        reviewOutcome: 'accepted', key: 'm23-p3-review-race-a-0001',
      }, sessions.member, 'member', timeAuthority),
      labor({
        ...contextB, actorUserId: IDS.member, action: 'review', interval: rejectedB,
        reviewOutcome: 'accepted', key: 'm23-p3-review-race-b-0001',
      }, sessions.member, 'member', timeAuthority),
    ];
    const results = await Promise.allSettled(inputs.map(input =>
      repository.mutateLaborTime(runtimePool, input)));
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(item => item.status === 'rejected').reason).toMatchObject({
      status: 409, code: 'M23_LABOR_OVERLAP',
    });
    const rejectedIndex = results.findIndex(item => item.status === 'rejected');
    const rejectedInterval = rejectedIndex === 0 ? rejectedA : rejectedB;
    const beforeRetry = await laborEvidence(migrationPool, rejectedInterval.id);
    await expect(repository.mutateLaborTime(runtimePool, inputs[rejectedIndex]))
      .rejects.toMatchObject({ status: 409, code: 'M23_LABOR_OVERLAP' });
    expect(await laborEvidence(migrationPool, rejectedInterval.id)).toEqual(beforeRetry);
  }, 30000);

  test('Part 3 rejects future manual and correction end instants with zero effects', async () => {
    const context = await createStartedExecution(34);
    const now = Date.now();
    const nearNow = tenantRfc3339(new Date(now - 60 * 1000));
    const farFuture = tenantRfc3339(new Date(now + 24 * 60 * 60 * 1000));
    const beforeManual = (await migrationPool.query(
      `SELECT count(*)::int AS intervals FROM public.canonical_labor_intervals
        WHERE execution_id=$1`, [context.execution.id]
    )).rows[0];
    await expect(repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'record_manual', category: 'other',
      observedStart: nearNow, observedEnd: farFuture,
      key: 'm23-p3-manual-future-end-01',
    }, sessions.member, 'member', timeAuthority))).rejects.toMatchObject({
      status: 400, code: 'INVALID_LABOR_REQUEST',
    });
    expect((await migrationPool.query(
      `SELECT count(*)::int AS intervals FROM public.canonical_labor_intervals
        WHERE execution_id=$1`, [context.execution.id]
    )).rows[0]).toEqual(beforeManual);

    const recordedInput = labor({
      ...context, actorUserId: IDS.member, action: 'record_manual', category: 'other',
      observedStart: '2026-08-15T08:00:00-04:00', observedEnd: '2026-08-15T08:30:00-04:00',
      key: 'm23-p3-future-correction-source-01',
    }, sessions.member, 'member', timeAuthority);
    const recorded = (await repository.mutateLaborTime(runtimePool, recordedInput)).body.data;
    const beforeCorrection = await laborEvidence(migrationPool, recorded.id);
    await expect(repository.mutateLaborTime(runtimePool, labor({
      ...context, actorUserId: IDS.member, action: 'correct', interval: recorded,
      category: 'other', observedStart: nearNow, observedEnd: farFuture,
      key: 'm23-p3-correction-future-end-01',
    }, sessions.member, 'member', timeAuthority))).rejects.toMatchObject({
      status: 400, code: 'INVALID_LABOR_REQUEST',
    });
    expect(await laborEvidence(migrationPool, recorded.id)).toEqual(beforeCorrection);
  });

  test('Part 3 transcript-source classifier accepts only the canonical vocabulary after explicit edge normalization', async () => {
    const cases = [
      [' Lead ', 'lead'], ['\tRETELL\u00a0', 'retell'], ['\u2003VoIcE\u3000', 'voice'],
      ['\ndEmO\r', 'demo'], ['\u202fSIMULATION\u205f', 'simulation'],
      ['manual', null], ['lead\t', 'lead'], ['le\tad', null], ['\u200bvoice\u200b', null],
      ['retell-webhook', null], ['customer', null],
    ];
    const normalized = (await migrationPool.query(
      `SELECT public.canonical_labor_transcript_source_normalized(source_value) AS normalized
         FROM unnest($1::text[]) WITH ORDINALITY AS source_values(source_value,position)
        ORDER BY position`, [cases.map(item => item[0])]
    )).rows.map(row => row.normalized);
    expect(normalized).toEqual(cases.map(item => item[1]));
  });

  test.each([
    ['ASCII space', ' Demo ', 35],
    ['TAB', '\tdemo\t', 36],
    ['LF', '\ndemo\n', 37],
    ['CR', '\rdemo\r', 38],
    ['form feed', '\fdemo\f', 39],
    ['vertical tab', '\vdemo\v', 40],
    ['case variant', 'DeMo', 41],
    ['NBSP', '\u00a0demo\u00a0', 42],
    ['Ogham space', '\u1680simulation\u1680', 43],
    ['en quad', '\u2000simulation\u2000', 44],
    ['em space', '\u2003demo\u2003', 45],
    ['line separator', '\u2028simulation\u2028', 46],
    ['narrow NBSP', '\u202fdemo\u202f', 47],
    ['ideographic space', '\u3000simulation\u3000', 48],
    ['unrecognized value', 'manual', 49],
    ['embedded TAB', 'le\tad', 50],
    ['zero-width ambiguity', '\u200bvoice\u200b', 51],
  ])(
    'Part 3 denies normalized non-production source with %s edges before fresh mutation, replay, and read',
    async (label, source, contextIndex) => {
      const context = await createStartedExecution(contextIndex);
      const recordedHour = String(contextIndex - 35).padStart(2, '0');
      const replayInput = labor({
        ...context, actorUserId: IDS.member, action: 'record_manual', category: 'travel',
        observedStart: `2026-08-16T${recordedHour}:00:00-04:00`,
        observedEnd: `2026-08-16T${recordedHour}:30:00-04:00`,
        key: `m23-p3-source-replay-${contextIndex}-01`,
      }, sessions.member, 'member', timeAuthority);
      const recorded = (await repository.mutateLaborTime(runtimePool, replayInput)).body.data;
      await migrationPool.query(
        `UPDATE public.canonical_transcripts transcript SET source=$2
           FROM public.canonical_field_executions execution
          WHERE execution.organization_id=$1 AND execution.id=$3
            AND transcript.organization_id=execution.organization_id
            AND transcript.operation_id=execution.operation_id
            AND transcript.graph_id=execution.graph_id`,
        [IDS.organization, source, context.execution.id]
      );
      const before = await laborExecutionEvidence(migrationPool, context.execution.id);
      await expect(repository.mutateLaborTime(runtimePool, replayInput))
        .rejects.toMatchObject({ status: 404 });
      await expect(repository.mutateLaborTime(runtimePool, labor({
        ...context, actorUserId: IDS.member, action: 'record_manual', category: 'travel',
        observedStart: `2026-08-17T${recordedHour}:00:00-04:00`,
        observedEnd: `2026-08-17T${recordedHour}:30:00-04:00`,
        key: `m23-p3-source-fresh-${contextIndex}-01`,
      }, sessions.member, 'member', timeAuthority))).rejects.toMatchObject({ status: 404 });
      await expect(repository.readLaborTime(runtimePool, {
        organizationId: IDS.organization, actorUserId: IDS.member,
        actorAccessRole: 'member', authSessionId: sessions.member.sessionId,
        executionId: context.execution.id,
      })).rejects.toMatchObject({ status: 404 });
      expect(await laborExecutionEvidence(migrationPool, context.execution.id)).toEqual(before);
    }
  );

  test('Part 3 withholds direct SQL/helpers and makes history immutable', async () => {
    for (const sql of [
      'SELECT * FROM public.canonical_labor_intervals LIMIT 1',
      "SELECT public.canonical_labor_reason_valid('bypass')",
      "SELECT public.canonical_labor_transcript_source_normalized('lead')",
      `SELECT public.canonical_labor_projection(NULL::public.canonical_labor_intervals)`,
    ]) await expect(runtimePool.query(sql)).rejects.toMatchObject({ code: '42501' });
    const event = (await migrationPool.query(
      'SELECT id FROM public.canonical_labor_events ORDER BY decided_at LIMIT 1'
    )).rows[0];
    await expect(migrationPool.query(
      "UPDATE public.canonical_labor_events SET reason='tampered' WHERE id=$1", [event.id]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_labor_evidence_immutable' });
    for (const table of ['canonical_labor_revisions', 'canonical_labor_audit_events',
      'canonical_labor_idempotency']) {
      await expect(migrationPool.query(`DELETE FROM public.${table}`))
        .rejects.toMatchObject({ code: '23514', constraint: 'canonical_labor_evidence_immutable' });
      await expect(migrationPool.query(`TRUNCATE TABLE public.${table}`))
        .rejects.toMatchObject({ code: '23514', constraint: 'canonical_labor_evidence_immutable' });
    }
  });

  test('Part 4 records versioned units, reviewable adjustment, usage, exact replay, and bounded summaries', async () => {
    const context = await createStartedExecution(52);
    const adjustment = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.owner, performerProfileId: IDS.member, action: 'record',
      movementKind: 'adjustment', itemKey: 'fence.post', description: 'Ten counted fence posts.',
      quantity: '10', unitCode: 'each', locationKey: 'truck-1', lotCode: 'lot-a',
      adjustmentDirection: 'increase', key: 'm23-p4-adjustment-record-0001',
    }, sessions.owner, 'owner'))).body.data.material;
    expect(adjustment).toMatchObject({ reviewState: 'needs_review', quantity: '10',
      unitCode: 'each', conversionApplied: false });
    const accepted = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.owner, performerProfileId: IDS.member, action: 'review',
      movement: adjustment, reviewOutcome: 'accepted', key: 'm23-p4-adjustment-review-0001',
    }, sessions.owner, 'owner'))).body.data.material;
    expect(accepted).toMatchObject({ id: adjustment.id, revision: 2, reviewState: 'accepted' });
    const usageInput = material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'consumed',
      itemKey: 'fence.post', description: 'Two posts installed from truck stock.', quantity: '2',
      unitCode: 'each', locationKey: 'truck-1', lotCode: 'lot-a', key: 'm23-p4-usage-replay-0001',
    }, sessions.member, 'member');
    const usage = await repository.mutateMaterialInventory(runtimePool, usageInput);
    const replay = await repository.mutateMaterialInventory(runtimePool, usageInput);
    expect(replay).toMatchObject({ status: 200, replayed: true });
    expect(replay.body).toEqual(usage.body);
    const read = (await repository.readMaterialInventory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: sessions.owner.sessionId, executionId: context.execution.id,
    })).body.data;
    expect(read).toMatchObject({ totalMovementCount: 2, stockKnown: false,
      balanceScope: 'visible execution evidence only' });
    expect(read.balances).toContainEqual(expect.objectContaining({ itemKey: 'fence.post',
      unitCode: 'each', locationKey: 'truck-1', lotCode: 'lot-a',
      recordedMovementBalance: '8', stockKnown: false, conversionApplied: false }));
    expect(await materialEvidence(migrationPool, context.execution.id))
      .toEqual({ movements: 2, events: 3, revisions: 3, audits: 3, replays: 3 });
  });

  test('Part 4 preserves correction and reversal lineage without destructive mutation', async () => {
    const context = await createStartedExecution(53);
    const original = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'copper.pipe', description: 'Unused copper pipe returned to the service truck.',
      quantity: '5', unitCode: 'foot', locationKey: 'truck-2', key: 'm23-p4-return-record-000001',
    }, sessions.member, 'member'))).body.data.material;
    const corrected = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'correct', movement: original,
      movementKind: 'returned', itemKey: 'copper.pipe',
      description: 'Corrected measured copper pipe returned to the service truck.',
      quantity: '6', unitCode: 'foot', locationKey: 'truck-2', key: 'm23-p4-return-correct-000001',
    }, sessions.member, 'member'))).body.data.material;
    expect(corrected).toMatchObject({ id: original.id, revision: 2, quantity: '6' });
    const reversed = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'reverse', movement: corrected,
      key: 'm23-p4-return-reverse-000001',
    }, sessions.member, 'member'))).body.data.material;
    expect(reversed).toMatchObject({ entryKind: 'reversal', reversalOfId: original.id,
      revision: 1, reviewState: 'needs_review' });
    const reviewedReversal = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.owner, performerProfileId: IDS.member, action: 'review',
      movement: reversed, reviewOutcome: 'accepted', key: 'm23-p4-reversal-review-00001',
    }, sessions.owner, 'owner'))).body.data.material;
    expect(reviewedReversal).toMatchObject({ id: reversed.id, entryKind: 'reversal',
      reversalOfId: original.id, revision: 2, reviewState: 'accepted' });
    const before = await materialEvidence(migrationPool, context.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'reverse', movement: corrected,
      key: 'm23-p4-return-reverse-000002',
    }, sessions.member, 'member'))).rejects.toMatchObject({ status: 409 });
    expect(await materialEvidence(migrationPool, context.execution.id)).toEqual(before);
    const history = (await migrationPool.query(
      `SELECT movement_id,revision,snapshot->>'quantity' AS quantity
         FROM public.canonical_material_revisions
        WHERE movement_id=$1 ORDER BY revision`, [original.id]
    )).rows;
    expect(history).toEqual([
      { movement_id: original.id, revision: '1', quantity: '5' },
      { movement_id: original.id, revision: '2', quantity: '6' },
    ]);
    expect((await migrationPool.query(
      `SELECT revision,snapshot->>'reviewState' AS review_state
         FROM public.canonical_material_revisions
        WHERE movement_id=$1 ORDER BY revision`, [reversed.id]
    )).rows).toEqual([
      { revision: '1', review_state: 'needs_review' },
      { revision: '2', review_state: 'accepted' },
    ]);
  });

  test('Part 4 flags underflow and missing location rather than inventing stock, and rejects unsafe acceptance', async () => {
    const context = await createStartedExecution(54);
    const underflow = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'waste',
      itemKey: 'roof.shingle', description: 'Damaged shingle recorded during field work.',
      quantity: '1.5', unitCode: 'bundle', locationKey: 'truck-3', key: 'm23-p4-underflow-record-001',
    }, sessions.member, 'member'))).body.data.material;
    expect(underflow.reviewState).toBe('needs_review');
    const beforeReview = await materialEvidence(migrationPool, context.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.owner, performerProfileId: IDS.member, action: 'review',
      movement: underflow, reviewOutcome: 'accepted', key: 'm23-p4-underflow-review-001',
    }, sessions.owner, 'owner'))).rejects.toMatchObject({
      status: 409, code: 'M23_MATERIAL_BALANCE_REVIEW_REQUIRED',
    });
    expect(await materialEvidence(migrationPool, context.execution.id)).toEqual(beforeReview);
    const underflowRead = (await repository.readMaterialInventory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: sessions.owner.sessionId, executionId: context.execution.id,
    })).body.data;
    expect(underflowRead.balances).toContainEqual(expect.objectContaining({
      itemKey: 'roof.shingle', recordedMovementBalance: null, needsReview: true,
    }));
    const rejected = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.owner, performerProfileId: IDS.member, action: 'review',
      movement: underflow, reviewOutcome: 'rejected', key: 'm23-p4-underflow-reject-0001',
    }, sessions.owner, 'owner'))).body.data.material;
    expect(rejected.reviewState).toBe('rejected');
    const beforeRejectedReverse = await materialEvidence(migrationPool, context.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'reverse', movement: rejected,
      key: 'm23-p4-rejected-reverse-0001',
    }, sessions.member, 'member'))).rejects.toMatchObject({ status: 409 });
    expect(await materialEvidence(migrationPool, context.execution.id)).toEqual(beforeRejectedReverse);
    const unknown = (await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'roof.nail', description: 'Unused nails returned; location not yet recorded.',
      quantity: '12', unitCode: 'each', key: 'm23-p4-unknown-location-0001',
    }, sessions.member, 'member'))).body.data.material;
    expect(unknown.reviewState).toBe('needs_review');
    const read = (await repository.readMaterialInventory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.member, actorAccessRole: 'member',
      authSessionId: sessions.member.sessionId, executionId: context.execution.id,
    })).body.data;
    expect(read.stockKnown).toBe(false);
    expect(read.balances.some(row => row.itemKey === 'roof.shingle')).toBe(false);
    expect(read.balances.some(row => row.itemKey === 'roof.nail')).toBe(false);
  });

  test('Part 4 separates unit and location dimensions, supports transfers, and bounds overflow', async () => {
    const context = await createStartedExecution(55);
    const baseline = async (itemKey, quantity, unitCode, locationKey, key) => {
      const row = (await repository.mutateMaterialInventory(runtimePool, material({
        ...context, actorUserId: IDS.owner, performerProfileId: IDS.member, action: 'record',
        movementKind: 'adjustment', itemKey, description: `Counted ${itemKey} material.`,
        quantity, unitCode, locationKey, adjustmentDirection: 'increase', key,
      }, sessions.owner, 'owner'))).body.data.material;
      return (await repository.mutateMaterialInventory(runtimePool, material({
        ...context, actorUserId: IDS.owner, performerProfileId: IDS.member, action: 'review',
        movement: row, reviewOutcome: 'accepted', key: `${key}-review`,
      }, sessions.owner, 'owner'))).body.data.material;
    };
    await baseline('wire', '20', 'foot', 'truck-4', 'm23-p4-wire-foot-0000001');
    await baseline('wire', '2', 'roll', 'truck-4', 'm23-p4-wire-roll-0000001');
    await repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'transferred',
      itemKey: 'wire', description: 'Wire moved between recorded truck locations.', quantity: '5',
      unitCode: 'foot', locationKey: 'truck-4', destinationLocationKey: 'truck-5',
      key: 'm23-p4-wire-transfer-000001',
    }, sessions.member, 'member'));
    const max = await baseline('aggregate', '999999999999.999999', 'pound', 'yard-1',
      'm23-p4-overflow-base-00001');
    const before = await materialEvidence(migrationPool, context.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'aggregate', description: 'Additional returned aggregate evidence.',
      quantity: '0.000001', unitCode: 'pound', locationKey: 'yard-1',
      key: 'm23-p4-overflow-attempt-001',
    }, sessions.member, 'member'))).rejects.toMatchObject({ status: 409, code: 'M23_MATERIAL_BALANCE_LIMIT' });
    expect(await materialEvidence(migrationPool, context.execution.id)).toEqual(before);
    expect(max.reviewState).toBe('accepted');
    const read = (await repository.readMaterialInventory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: sessions.owner.sessionId, executionId: context.execution.id,
    })).body.data;
    expect(read.balances).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: 'wire', unitCode: 'foot', locationKey: 'truck-4', recordedMovementBalance: '15' }),
      expect.objectContaining({ itemKey: 'wire', unitCode: 'foot', locationKey: 'truck-5', recordedMovementBalance: '5' }),
      expect.objectContaining({ itemKey: 'wire', unitCode: 'roll', locationKey: 'truck-4', recordedMovementBalance: '2' }),
    ]));
  });

  test('Part 4 fails closed for tenant, performer, demo source, and revoked replay with zero side effects', async () => {
    const context = await createStartedExecution(56);
    const input = material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'filter', description: 'Unused filter returned to the assigned truck.',
      quantity: '1', unitCode: 'each', locationKey: 'truck-6', key: 'm23-p4-source-replay-000001',
    }, sessions.member, 'member');
    await repository.mutateMaterialInventory(runtimePool, input);
    const before = await materialEvidence(migrationPool, context.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, material({
      ...context, actorUserId: IDS.member, performerProfileId: IDS.unassignedMember,
      action: 'record', movementKind: 'returned', itemKey: 'filter', description: 'Forged performer.',
      quantity: '1', unitCode: 'each', locationKey: 'truck-6', key: 'm23-p4-forged-performer-0001',
    }, sessions.member, 'member'))).rejects.toMatchObject({ status: 403 });
    await expect(repository.mutateMaterialInventory(runtimePool, material({
      ...context, organizationId: IDS.otherOrganization, actorUserId: IDS.otherOwner,
      performerProfileId: IDS.otherOwner, action: 'record', movementKind: 'returned',
      itemKey: 'filter', description: 'Cross tenant attempt.', quantity: '1', unitCode: 'each',
      locationKey: 'truck-6', key: 'm23-p4-cross-tenant-000001',
    }, sessions.other, 'owner'))).rejects.toMatchObject({ status: 404 });
    await forceAssignmentAuthority(migrationPool, IDS.organization, context.appointmentId,
      { targetState: 'unassigned', profileId: null, crewId: null, dispatchState: 'revoked' });
    await expect(repository.mutateMaterialInventory(runtimePool, input))
      .rejects.toMatchObject({ status: 403 });
    await expect(repository.readMaterialInventory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: sessions.owner.sessionId, executionId: context.execution.id,
    })).rejects.toMatchObject({ status: 404 });
    expect(await materialEvidence(migrationPool, context.execution.id)).toEqual(before);

    const sourceContext = await createStartedExecution(58);
    const sourceInput = material({
      ...sourceContext, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'filter', description: 'Unused filter returned to the assigned truck.',
      quantity: '1', unitCode: 'each', locationKey: 'truck-6', key: 'm23-p4-source-denial-000001',
    }, sessions.member, 'member');
    await migrationPool.query(
      `UPDATE public.canonical_transcripts transcript SET source=E'\tdEmO\t'
         FROM public.canonical_field_executions execution
        WHERE execution.organization_id=$1 AND execution.id=$2
          AND transcript.organization_id=execution.organization_id
          AND transcript.operation_id=execution.operation_id AND transcript.graph_id=execution.graph_id`,
      [IDS.organization, sourceContext.execution.id]
    );
    const beforeSource = await materialEvidence(migrationPool, sourceContext.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, sourceInput))
      .rejects.toMatchObject({ status: 404 });
    await expect(repository.readMaterialInventory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.member, actorAccessRole: 'member',
      authSessionId: sessions.member.sessionId, executionId: sourceContext.execution.id,
    })).rejects.toMatchObject({ status: 404 });
    expect(await materialEvidence(migrationPool, sourceContext.execution.id)).toEqual(beforeSource);

    const appointmentContext = await createStartedExecution(59);
    const appointmentInput = material({
      ...appointmentContext, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'filter', description: 'Appointment status must remain current.',
      quantity: '1', unitCode: 'each', locationKey: 'truck-6', key: 'm23-p4-appointment-denial-1',
    }, sessions.member, 'member');
    await migrationPool.query('ALTER TABLE public.canonical_appointments DISABLE TRIGGER USER');
    try {
      await migrationPool.query(
        `UPDATE public.canonical_appointments SET status='completed'
          WHERE organization_id=$1 AND id=$2`,
        [IDS.organization, appointmentContext.appointmentId]
      );
    } finally {
      await migrationPool.query('ALTER TABLE public.canonical_appointments ENABLE TRIGGER USER');
    }
    const beforeAppointment = await materialEvidence(migrationPool, appointmentContext.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, appointmentInput))
      .rejects.toMatchObject({ status: 404 });
    await expect(repository.readMaterialInventory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: sessions.owner.sessionId, executionId: appointmentContext.execution.id,
    })).rejects.toMatchObject({ status: 404 });
    expect(await materialEvidence(migrationPool, appointmentContext.execution.id))
      .toEqual(beforeAppointment);

    const pausedContext = await createStartedExecution(61);
    pausedContext.execution = (await repository.transitionFieldExecution(runtimePool, transition({
      execution: pausedContext.execution, assignment: pausedContext.assignment,
      actorUserId: IDS.member, action: 'pause',
    }, sessions.member, 'member'))).body.data;
    const beforePaused = await materialEvidence(migrationPool, pausedContext.execution.id);
    await expect(repository.mutateMaterialInventory(runtimePool, material({
      ...pausedContext, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'filter', description: 'Paused execution may not create a new movement.',
      quantity: '1', unitCode: 'each', locationKey: 'truck-6',
      key: 'm23-p4-paused-record-denial-1',
    }, sessions.member, 'member'))).rejects.toMatchObject({
      status: 409, code: 'M23_MATERIAL_ACTION_INVALID',
    });
    expect(await materialEvidence(migrationPool, pausedContext.execution.id)).toEqual(beforePaused);
  });

  test('Part 4 serializes concurrent retries and withholds direct SQL and immutable history', async () => {
    const context = await createStartedExecution(57);
    const input = material({
      ...context, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
      itemKey: 'fastener', description: 'Unused fastener returned after assigned work.',
      quantity: '1', unitCode: 'each', locationKey: 'truck-7', key: 'm23-p4-concurrent-retry-001',
    }, sessions.member, 'member');
    const results = await Promise.all([
      repository.mutateMaterialInventory(runtimePool, input),
      repository.mutateMaterialInventory(runtimePool, input),
    ]);
    expect(results.filter(result => result.replayed)).toHaveLength(1);
    expect(results[0].body).toEqual(results[1].body);
    expect(await materialEvidence(migrationPool, context.execution.id))
      .toEqual({ movements: 1, events: 1, revisions: 1, audits: 1, replays: 1 });
    const movementId = results[0].body.data.material.id;
    const beforeCurrent = (await migrationPool.query(
      `SELECT quantity_text,revision,rtrim(canonical_digest) AS digest
         FROM public.canonical_material_movements WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, movementId]
    )).rows[0];
    await expect(migrationPool.query(
      `UPDATE public.canonical_material_movements
          SET quantity=2,quantity_text='2',revision=revision+1,last_transaction_id=txid_current()
        WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, movementId]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_material_digest_invalid' });
    expect((await migrationPool.query(
      `SELECT quantity_text,revision,rtrim(canonical_digest) AS digest
         FROM public.canonical_material_movements WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, movementId]
    )).rows[0]).toEqual(beforeCurrent);
    for (const sql of [
      'SELECT * FROM public.canonical_material_movements LIMIT 1',
      "SELECT public.canonical_material_text_valid('bypass')",
      `SELECT public.canonical_material_projection(NULL::public.canonical_material_movements)`,
    ]) await expect(runtimePool.query(sql)).rejects.toMatchObject({ code: '42501' });
    const event = (await migrationPool.query(
      'SELECT id FROM public.canonical_material_events WHERE execution_id=$1', [context.execution.id]
    )).rows[0];
    await expect(migrationPool.query(
      "UPDATE public.canonical_material_events SET reason='tampered' WHERE id=$1", [event.id]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_material_evidence_immutable' });
    for (const table of ['canonical_material_revisions','canonical_material_audit_events','canonical_material_idempotency']) {
      await expect(migrationPool.query(`DELETE FROM public.${table}`))
        .rejects.toMatchObject({ code: '23514', constraint: 'canonical_material_evidence_immutable' });
      await expect(migrationPool.query(`TRUNCATE TABLE public.${table}`))
        .rejects.toMatchObject({ code: '23514', constraint: 'canonical_material_evidence_immutable' });
    }
    const validation = (await migrationPool.query(
      `SELECT public.canonical_material_text_valid('Café') AS nfc,
              public.canonical_material_text_valid(E'bad\ntext') AS control,
              public.canonical_material_text_valid('bad' || chr(8238) || 'text') AS bidi`
    )).rows[0];
    expect(validation).toEqual({ nfc: true, control: false, bidi: false });
  });

  test('Part 4 rolls back current, history, audit, and replay when audit evidence cannot commit', async () => {
    const context = await createStartedExecution(60);
    await migrationPool.query(
      `CREATE FUNCTION public.m23_part4_fail_material_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'forced material audit failure'
         USING ERRCODE='P0001',CONSTRAINT='m23_part4_forced_audit_failure'; END $$`
    );
    await migrationPool.query(
      `CREATE TRIGGER m23_part4_fail_material_audit
         BEFORE INSERT ON public.canonical_material_audit_events
         FOR EACH ROW EXECUTE FUNCTION public.m23_part4_fail_material_audit()`
    );
    try {
      await expect(repository.mutateMaterialInventory(runtimePool, material({
        ...context, actorUserId: IDS.member, action: 'record', movementKind: 'returned',
        itemKey: 'sealant', description: 'Unused sealant returned after assigned work.',
        quantity: '1', unitCode: 'tube', locationKey: 'truck-8',
        key: 'm23-p4-forced-audit-failure-1',
      }, sessions.member, 'member'))).rejects.toBeDefined();
    } finally {
      await migrationPool.query('DROP TRIGGER m23_part4_fail_material_audit ON public.canonical_material_audit_events');
      await migrationPool.query('DROP FUNCTION public.m23_part4_fail_material_audit()');
    }
    expect(await materialEvidence(migrationPool, context.execution.id))
      .toEqual({ movements: 0, events: 0, revisions: 0, audits: 0, replays: 0 });
  });
});

realPostgres('Mission 23 Part 2 migration interruption and retry', () => {
  test('rolls back an interrupted 038 application, then applies once and reruns as zero-op', async () => {
    const database = await createSuiteDatabase('m23-p2-retry');
    const roles = await createRoles(database, 'retry');
    const migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 2 });
    const runtimePool = new Pool({ connectionString: roles.runtimeUrl, max: 2 });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m23-p2-migrations-'));
    try {
      for (const name of fs.readdirSync(MIGRATIONS)) {
        // This fixture constructs the exact pre-038 history. Later migrations
        // depend on 038 and must not be ledgered ahead of the interrupted unit.
        if (/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name < MIGRATION) {
          fs.copyFileSync(path.join(MIGRATIONS, name), path.join(temporary, name));
        }
      }
      jest.resetModules();
      const localDb = require('../../src/db');
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool, migrationsDirectory: temporary })).toBe(true);
      const client = await migrationPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8'));
        await expect(client.query('SELECT public.m23_forced_interruption()')).rejects.toBeDefined();
        await client.query('ROLLBACK');
      } finally { client.release(); }
      expect((await migrationPool.query(
        "SELECT to_regclass('public.canonical_field_executions') AS relation"
      )).rows[0].relation).toBeNull();
      expect((await migrationPool.query(
        'SELECT count(*)::int AS count FROM public._migrations WHERE filename=$1', [MIGRATION]
      )).rows[0].count).toBe(0);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const applied = (await migrationPool.query(
        'SELECT checksum,applied_at FROM public._migrations WHERE filename=$1', [MIGRATION]
      )).rows;
      expect(applied).toHaveLength(1);
      expect(applied[0].checksum).toBe(localDb.loadMigrations(MIGRATIONS).find(item => item.file === MIGRATION).digest);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const final = (await migrationPool.query(
        'SELECT checksum,applied_at,count(*) OVER ()::int AS rows FROM public._migrations WHERE filename=$1', [MIGRATION]
      )).rows[0];
      expect(final).toMatchObject({ checksum: applied[0].checksum, rows: 1 });
      expect(final.applied_at.toISOString()).toBe(applied[0].applied_at.toISOString());
    } finally {
      await migrationPool.end().catch(() => {});
      await runtimePool.end().catch(() => {});
      await database.cleanup();
      await dropRoles(roles);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 180000);
});

realPostgres('Mission 23 Part 3 transcript-source migration interruption and retry', () => {
  test('rolls back interrupted 041, then applies once and restarts as zero-op', async () => {
    const database = await createSuiteDatabase('m23-p3-source-retry');
    const roles = await createRoles(database, 'p3-source-retry');
    const migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 2 });
    const runtimePool = new Pool({ connectionString: roles.runtimeUrl, max: 2 });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m23-p3-source-'));
    try {
      for (const name of fs.readdirSync(MIGRATIONS)) {
        if (/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name < LABOR_SOURCE_MIGRATION) {
          fs.copyFileSync(path.join(MIGRATIONS, name), path.join(temporary, name));
        }
      }
      jest.resetModules();
      const localDb = require('../../src/db');
      expect(await localDb.runMigrations({
        pool: migrationPool, runtimePool, migrationsDirectory: temporary,
      })).toBe(true);
      const before = (await migrationPool.query(
        `SELECT pg_get_functiondef(
          'public.canonical_labor_time_mutate(uuid,uuid,text,uuid,text,uuid,text,uuid,text,text,text,bigint,text,bigint,text,uuid,bigint,text,text,text,text,uuid,bigint,text,text,text,text,text)'::regprocedure
        ) AS definition`
      )).rows[0].definition;
      expect(before).toContain('lower(btrim(transcript.source))');
      expect((await migrationPool.query(
        "SELECT to_regprocedure('public.canonical_labor_transcript_source_normalized(text)') AS helper"
      )).rows[0].helper).toBeNull();
      const client = await migrationPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(
          path.join(MIGRATIONS, LABOR_SOURCE_MIGRATION), 'utf8'
        ));
        await expect(client.query('SELECT public.m23_part3_041_forced_interruption()'))
          .rejects.toBeDefined();
        await client.query('ROLLBACK');
      } finally { client.release(); }
      expect((await migrationPool.query(
        "SELECT to_regprocedure('public.canonical_labor_transcript_source_normalized(text)') AS helper"
      )).rows[0].helper).toBeNull();
      expect((await migrationPool.query(
        `SELECT pg_get_functiondef(
          'public.canonical_labor_time_mutate(uuid,uuid,text,uuid,text,uuid,text,uuid,text,text,text,bigint,text,bigint,text,uuid,bigint,text,text,text,text,uuid,bigint,text,text,text,text,text)'::regprocedure
        ) AS definition`
      )).rows[0].definition).toBe(before);
      expect((await migrationPool.query(
        'SELECT count(*)::int AS count FROM public._migrations WHERE filename=$1',
        [LABOR_SOURCE_MIGRATION]
      )).rows[0].count).toBe(0);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const source = localDb.loadMigrations(MIGRATIONS)
        .find(item => item.file === LABOR_SOURCE_MIGRATION);
      const applied = (await migrationPool.query(
        'SELECT checksum,applied_at FROM public._migrations WHERE filename=$1',
        [LABOR_SOURCE_MIGRATION]
      )).rows;
      expect(applied).toHaveLength(1);
      expect(applied[0].checksum).toBe(source.digest);
      const installed = (await migrationPool.query(
        `SELECT to_regprocedure('public.canonical_labor_transcript_source_normalized(text)')::text AS helper,
                pg_get_functiondef(
          'public.canonical_labor_time_mutate(uuid,uuid,text,uuid,text,uuid,text,uuid,text,text,text,bigint,text,bigint,text,uuid,bigint,text,text,text,text,uuid,bigint,text,text,text,text,text)'::regprocedure
                ) AS definition`
      )).rows[0];
      expect(installed.helper).toBe('canonical_labor_transcript_source_normalized(text)');
      expect(installed.definition).toContain('canonical_labor_transcript_source_normalized(transcript.source)');
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const final = (await migrationPool.query(
        'SELECT checksum,applied_at,count(*) OVER ()::int AS rows FROM public._migrations WHERE filename=$1',
        [LABOR_SOURCE_MIGRATION]
      )).rows[0];
      expect(final).toMatchObject({ checksum: applied[0].checksum, rows: 1 });
      expect(final.applied_at.toISOString()).toBe(applied[0].applied_at.toISOString());
    } finally {
      await migrationPool.end().catch(() => {});
      await runtimePool.end().catch(() => {});
      await database.cleanup();
      await dropRoles(roles);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 180000);
});

realPostgres('Mission 23 Part 3 correction migration interruption and retry', () => {
  test('rolls back interrupted 040, then applies once and restarts as zero-op', async () => {
    const database = await createSuiteDatabase('m23-p3-correction-retry');
    const roles = await createRoles(database, 'p3-correction-retry');
    const migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 2 });
    const runtimePool = new Pool({ connectionString: roles.runtimeUrl, max: 2 });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m23-p3-correction-'));
    try {
      for (const name of fs.readdirSync(MIGRATIONS)) {
        if (/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name < LABOR_CORRECTION_MIGRATION) {
          fs.copyFileSync(path.join(MIGRATIONS, name), path.join(temporary, name));
        }
      }
      jest.resetModules();
      const localDb = require('../../src/db');
      expect(await localDb.runMigrations({
        pool: migrationPool, runtimePool, migrationsDirectory: temporary,
      })).toBe(true);
      const before = (await migrationPool.query(
        `SELECT pg_get_functiondef(
          'public.canonical_labor_time_mutate(uuid,uuid,text,uuid,text,uuid,text,uuid,text,text,text,bigint,text,bigint,text,uuid,bigint,text,text,text,text,uuid,bigint,text,text,text,text,text)'::regprocedure
        ) AS definition`
      )).rows[0].definition;
      expect(before).not.toContain('lower(btrim(transcript.source))');
      const client = await migrationPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(
          path.join(MIGRATIONS, LABOR_CORRECTION_MIGRATION), 'utf8'
        ));
        await expect(client.query('SELECT public.m23_part3_040_forced_interruption()'))
          .rejects.toBeDefined();
        await client.query('ROLLBACK');
      } finally { client.release(); }
      expect((await migrationPool.query(
        `SELECT pg_get_functiondef(
          'public.canonical_labor_time_mutate(uuid,uuid,text,uuid,text,uuid,text,uuid,text,text,text,bigint,text,bigint,text,uuid,bigint,text,text,text,text,uuid,bigint,text,text,text,text,text)'::regprocedure
        ) AS definition`
      )).rows[0].definition).toBe(before);
      expect((await migrationPool.query(
        'SELECT count(*)::int AS count FROM public._migrations WHERE filename=$1',
        [LABOR_CORRECTION_MIGRATION]
      )).rows[0].count).toBe(0);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const source = localDb.loadMigrations(MIGRATIONS)
        .find(item => item.file === LABOR_CORRECTION_MIGRATION);
      const applied = (await migrationPool.query(
        'SELECT checksum,applied_at FROM public._migrations WHERE filename=$1',
        [LABOR_CORRECTION_MIGRATION]
      )).rows;
      expect(applied).toHaveLength(1);
      expect(applied[0].checksum).toBe(source.digest);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const final = (await migrationPool.query(
        'SELECT checksum,applied_at,count(*) OVER ()::int AS rows FROM public._migrations WHERE filename=$1',
        [LABOR_CORRECTION_MIGRATION]
      )).rows[0];
      expect(final).toMatchObject({ checksum: applied[0].checksum, rows: 1 });
      expect(final.applied_at.toISOString()).toBe(applied[0].applied_at.toISOString());
    } finally {
      await migrationPool.end().catch(() => {});
      await runtimePool.end().catch(() => {});
      await database.cleanup();
      await dropRoles(roles);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 180000);
});

realPostgres('Mission 23 Part 3 migration interruption and retry', () => {
  test('rolls back an interrupted 039 application, then applies once and restarts as zero-op', async () => {
    const database = await createSuiteDatabase('m23-p3-retry');
    const roles = await createRoles(database, 'p3-retry');
    const migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 2 });
    const runtimePool = new Pool({ connectionString: roles.runtimeUrl, max: 2 });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m23-p3-migrations-'));
    try {
      for (const name of fs.readdirSync(MIGRATIONS)) {
        if (/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name < LABOR_MIGRATION) {
          fs.copyFileSync(path.join(MIGRATIONS, name), path.join(temporary, name));
        }
      }
      jest.resetModules();
      const localDb = require('../../src/db');
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool,
        migrationsDirectory: temporary })).toBe(true);
      const client = await migrationPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(MIGRATIONS, LABOR_MIGRATION), 'utf8'));
        await expect(client.query('SELECT public.m23_part3_forced_interruption()')).rejects.toBeDefined();
        await client.query('ROLLBACK');
      } finally { client.release(); }
      expect((await migrationPool.query(
        "SELECT to_regclass('public.canonical_labor_intervals') AS relation"
      )).rows[0].relation).toBeNull();
      expect((await migrationPool.query(
        'SELECT count(*)::int AS count FROM public._migrations WHERE filename=$1', [LABOR_MIGRATION]
      )).rows[0].count).toBe(0);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const source = localDb.loadMigrations(MIGRATIONS).find(item => item.file === LABOR_MIGRATION);
      const applied = (await migrationPool.query(
        'SELECT checksum,applied_at FROM public._migrations WHERE filename=$1', [LABOR_MIGRATION]
      )).rows;
      expect(applied).toHaveLength(1);
      expect(applied[0].checksum).toBe(source.digest);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const final = (await migrationPool.query(
        'SELECT checksum,applied_at,count(*) OVER ()::int AS rows FROM public._migrations WHERE filename=$1',
        [LABOR_MIGRATION]
      )).rows[0];
      expect(final).toMatchObject({ checksum: applied[0].checksum, rows: 1 });
      expect(final.applied_at.toISOString()).toBe(applied[0].applied_at.toISOString());
    } finally {
      await migrationPool.end().catch(() => {});
      await runtimePool.end().catch(() => {});
      await database.cleanup();
      await dropRoles(roles);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 180000);
});

realPostgres('Mission 23 Part 4 migration interruption and retry', () => {
  test('rolls back interrupted 042, then applies once and restarts as zero-op', async () => {
    const database = await createSuiteDatabase('m23-p4-retry');
    const roles = await createRoles(database, 'p4-retry');
    const migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 2 });
    const runtimePool = new Pool({ connectionString: roles.runtimeUrl, max: 2 });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m23-p4-migrations-'));
    try {
      for (const name of fs.readdirSync(MIGRATIONS)) {
        if (/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name < MATERIAL_MIGRATION) {
          fs.copyFileSync(path.join(MIGRATIONS, name), path.join(temporary, name));
        }
      }
      jest.resetModules();
      const localDb = require('../../src/db');
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool,
        migrationsDirectory: temporary })).toBe(true);
      const client = await migrationPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(MIGRATIONS, MATERIAL_MIGRATION), 'utf8'));
        await expect(client.query('SELECT public.m23_part4_forced_interruption()')).rejects.toBeDefined();
        await client.query('ROLLBACK');
      } finally { client.release(); }
      expect((await migrationPool.query(
        "SELECT to_regclass('public.canonical_material_movements') AS relation"
      )).rows[0].relation).toBeNull();
      expect((await migrationPool.query(
        'SELECT count(*)::int AS count FROM public._migrations WHERE filename=$1', [MATERIAL_MIGRATION]
      )).rows[0].count).toBe(0);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const source = localDb.loadMigrations(MIGRATIONS).find(item => item.file === MATERIAL_MIGRATION);
      const applied = (await migrationPool.query(
        'SELECT checksum,applied_at FROM public._migrations WHERE filename=$1', [MATERIAL_MIGRATION]
      )).rows;
      expect(applied).toHaveLength(1);
      expect(applied[0].checksum).toBe(source.digest);
      expect(await localDb.runMigrations({ pool: migrationPool, runtimePool })).toBe(true);
      const final = (await migrationPool.query(
        'SELECT checksum,applied_at,count(*) OVER ()::int AS rows FROM public._migrations WHERE filename=$1',
        [MATERIAL_MIGRATION]
      )).rows[0];
      expect(final).toMatchObject({ checksum: applied[0].checksum, rows: 1 });
      expect(final.applied_at.toISOString()).toBe(applied[0].applied_at.toISOString());
    } finally {
      await migrationPool.end().catch(() => {});
      await runtimePool.end().catch(() => {});
      await database.cleanup();
      await dropRoles(roles);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 180000);
});
