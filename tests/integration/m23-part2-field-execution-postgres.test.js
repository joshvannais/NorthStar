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
  appointments: [
    'c4000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000002',
    'c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000004',
    'c4000000-0000-4000-8000-000000000005',
    'c4000000-0000-4000-8000-000000000006',
    'c4000000-0000-4000-8000-000000000007',
    'c4000000-0000-4000-8000-000000000008',
  ],
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

async function seedAppointment(pool, organizationId, appointmentId, source = 'manual') {
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

realPostgres('Mission 23 Part 2 canonical field execution PostgreSQL authority', () => {
  let database;
  let roles;
  let migrationPool;
  let runtimePool;
  let db;
  let repository;
  let sessions;
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
        if (/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name !== MIGRATION) {
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
