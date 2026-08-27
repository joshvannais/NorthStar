'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const request = require('supertest');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const PART4_MIGRATION = '035_schedule_human_preview_approval.sql';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const HOSTILE = '<img src=x onerror="globalThis.part4Compromised=true"> approval bytes';
const IDS = Object.freeze({
  organization: 'e1100000-0000-4000-8000-000000000001',
  otherOrganization: 'e1100000-0000-4000-8000-000000000002',
  owner: 'e2100000-0000-4000-8000-000000000001',
  dispatcher: 'e2100000-0000-4000-8000-000000000002',
  employee: 'e2100000-0000-4000-8000-000000000003',
  otherOwner: 'e2100000-0000-4000-8000-000000000004',
  crew: 'e3100000-0000-4000-8000-000000000001',
  appointment: 'e5100000-0000-4000-8000-000000000001',
  otherAppointment: 'e5100000-0000-4000-8000-000000000002',
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

async function createRoles(database) {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const migrationRole = `northstar-m22-p4-migration-${suffix}`.slice(0, 63);
  const runtimeRole = `northstar-m22-p4-runtime-${suffix}`.slice(0, 63);
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
    industry: 'plumbing', businessDescription: `${name} exact Part 4 approval authority.`,
    company: { name, email: 'part4@example.test', phone: '+15550104444', timeZone: 'America/New_York', currency: 'USD' },
    headquarters: { street: HOSTILE, city: 'Boston', state: 'MA', country: 'US', latitude: 42.36, longitude: -71.06, additionalOffices: [] },
    hours,
    scheduling: { maxJobsPerDay: 20, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 },
    crew: { defaultCrewSize: 2, maxCrewSize: 20 },
    services: [{ id: 'plumbing', name: 'Plumbing', description: 'Plumbing', active: true }],
  };
}

async function seedTenant(pool, organizationId, name, actors) {
  await pool.query('INSERT INTO public.organizations(id,name,email) VALUES ($1,$2,$3)',
    [organizationId, name, `${organizationId}@part4.test`]);
  for (const actor of actors) {
    await pool.query(
      `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
      [actor.id, organizationId, actor.name, `${actor.id}@part4.test`, actor.role]
    );
    await pool.query(
      `INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
       VALUES ($1,$2,$1,$3,'active')`, [actor.id, organizationId, actor.role]
    );
  }
  const raw = businessProfile(name);
  const normalized = adaptBusinessProfile(raw, 'org-profile-v1');
  await pool.query(
    `INSERT INTO public.canonical_business_profiles(
       organization_id,version_number,version_label,raw_profile,normalized_profile,
       normalized_profile_hash,is_active,created_by)
     VALUES ($1,1,'org-profile-v1',$2::jsonb,$3::jsonb,$4,TRUE,$5)`,
    [organizationId, JSON.stringify(raw), JSON.stringify(normalized), normalized.hash, actors[0].id]
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function seedAppointment(pool, organizationId, appointmentId, source = 'manual') {
  const operationId = appointmentId.replace(/^e5/, 'e6');
  const graphId = appointmentId.replace(/^e5/, 'e7');
  const customerId = appointmentId.replace(/^e5/, 'e8');
  const transcriptId = appointmentId.replace(/^e5/, 'e9');
  const opportunityId = appointmentId.replace(/^e5/, 'ea');
  await pool.query(
    `INSERT INTO public.canonical_operations(
       id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
       lease_owner,lease_expires_at,result_status,result_body,completed_at)
     VALUES ($1,$2,$3,$4,$5,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [operationId, organizationId, graphId, sha256(`key:${appointmentId}`), sha256(`payload:${appointmentId}`)]
  );
  await pool.query('INSERT INTO public.canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES ($1,$2,$3,$4,$5)',
    [customerId, organizationId, operationId, graphId, HOSTILE]);
  await pool.query(
    `INSERT INTO public.canonical_transcripts(
       id,organization_id,operation_id,graph_id,customer_id,source,source_version,
       transcript_text,normalized_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,'m22-part4-mounted',$7,$8)`,
    [transcriptId, organizationId, operationId, graphId, customerId, source, HOSTILE, sha256(`transcript:${appointmentId}`)]
  );
  await pool.query(
    `INSERT INTO public.canonical_opportunities(
       id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope)
     VALUES ($1,$2,$3,$4,$5,'qualified',NULL,$6::jsonb)`,
    [opportunityId, organizationId, operationId, graphId, customerId, JSON.stringify({ instructions: HOSTILE })]
  );
  await pool.query(
    `INSERT INTO public.canonical_appointments(id,organization_id,operation_id,graph_id,opportunity_id,status)
     VALUES ($1,$2,$3,$4,$5,'preferred')`,
    [appointmentId, organizationId, operationId, graphId, opportunityId]
  );
}

async function pins(pool, organizationId = IDS.organization, appointmentId = IDS.appointment) {
  const row = (await pool.query(
    `SELECT revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,
            workforce_crew_id,schedule_state,dispatch_state,scheduled_start,scheduled_end,appointment_status
       FROM public.canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
    [organizationId, appointmentId]
  )).rows[0];
  return {
    revision: Number(row.revision), digest: row.digest,
    target: row.target_state === 'unassigned' ? { kind: 'unassigned', id: null }
      : row.workforce_profile_id ? { kind: 'profile', id: row.workforce_profile_id }
        : { kind: 'crew', id: row.workforce_crew_id },
    scheduledStart: row.scheduled_start ? new Date(row.scheduled_start).toISOString() : null,
    scheduledEnd: row.scheduled_end ? new Date(row.scheduled_end).toISOString() : null,
    dispatchState: row.dispatch_state, appointmentStatus: row.appointment_status,
  };
}

function explicitOffset(value) {
  const replacements = {
    '2027-03-15T13:00:00.000Z': '2027-03-15T09:00:00-04:00',
    '2027-03-15T14:00:00.000Z': '2027-03-15T10:00:00-04:00',
    '2027-03-15T15:00:00.000Z': '2027-03-15T11:00:00-04:00',
    '2027-03-15T16:00:00.000Z': '2027-03-15T12:00:00-04:00',
  };
  return value === null ? null : replacements[value] || value;
}

realPostgres('Mission 22 Part 4 mounted human preview and approval authority', () => {
  let database;
  let roles;
  let migrationPool;
  let runtimePool;
  let db;
  let app;
  let sessions;
  const original = {};

  beforeAll(async () => {
    for (const key of ['NODE_ENV', 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AUTH_ACCESS_SECRET', 'TZ']) original[key] = process.env[key];
    database = await createSuiteDatabase('m22-p4-mounted');
    roles = await createRoles(database);
    migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 3 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.AUTH_ACCESS_SECRET = 'mission-22-part4-test-only-secret-00000000000000000000000000000000';
    process.env.TZ = 'UTC';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    runtimePool = db.getPool();
    ({ app } = require('../../src/server'));
    app.locals.m22Pool = runtimePool;
    await seedTenant(runtimePool, IDS.organization, 'Mission 22 Part 4', [
      { id: IDS.owner, role: 'owner', name: 'Part 4 owner' },
      { id: IDS.dispatcher, role: 'member', name: 'Part 4 dispatcher' },
      { id: IDS.employee, role: 'member', name: 'Part 4 employee' },
    ]);
    await seedTenant(runtimePool, IDS.otherOrganization, 'Mission 22 Part 4 Other', [
      { id: IDS.otherOwner, role: 'owner', name: 'Other owner' },
    ]);
    await runtimePool.query("UPDATE public.workforce_profiles SET operational_role='dispatcher' WHERE organization_id=$1 AND id=$2",
      [IDS.organization, IDS.dispatcher]);
    await runtimePool.query("UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id=$2",
      [IDS.organization, IDS.employee]);
    await runtimePool.query(
      `INSERT INTO public.workforce_crews
        (id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'part4-crew',$3,'headquarters',$4,$4)`,
      [IDS.crew, IDS.organization, `Part 4 crew ${HOSTILE}`, IDS.owner]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crew_members
        (organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       VALUES ($1,$2,$3,'lead',$3),($1,$2,$4,'member',$3)`,
      [IDS.organization, IDS.crew, IDS.owner, IDS.dispatcher]
    );
    sessions = {
      owner: await provisionDurableSession(runtimePool, { userId: IDS.owner, organizationId: IDS.organization, membershipId: IDS.owner, role: 'owner' }),
      dispatcher: await provisionDurableSession(runtimePool, { userId: IDS.dispatcher, organizationId: IDS.organization, membershipId: IDS.dispatcher, role: 'member' }),
      employee: await provisionDurableSession(runtimePool, { userId: IDS.employee, organizationId: IDS.organization, membershipId: IDS.employee, role: 'member' }),
      other: await provisionDurableSession(runtimePool, { userId: IDS.otherOwner, organizationId: IDS.otherOrganization, membershipId: IDS.otherOwner, role: 'owner' }),
    };
    await seedAppointment(runtimePool, IDS.organization, IDS.appointment);
    await seedAppointment(runtimePool, IDS.otherOrganization, IDS.otherAppointment);
  }, 180000);

  afterAll(async () => {
    try {
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

  test('pins the exact migration ledger, reapplies nothing on restart, and preserves a supported 001-034 upgrade', async () => {
    const expected = db.loadMigrations(MIGRATIONS);
    const ledgerBefore = (await migrationPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows;
    expect(ledgerBefore).toHaveLength(expected.length);
    expect(ledgerBefore.map(({ filename, checksum }) => ({ filename, checksum }))).toEqual(
      expected.map(({ file, digest }) => ({ filename: file, checksum: digest }))
    );
    expect(ledgerBefore.filter(row => row.filename === PART4_MIGRATION)).toHaveLength(1);
    expect((await migrationPool.query("SELECT current_setting('TimeZone') AS timezone")).rows[0].timezone).toBe('UTC');

    const restartRuntimePool = new Pool({ connectionString: roles.runtimeUrl, max: 2 });
    try {
      expect(await db.runMigrations({ pool: migrationPool, runtimePool: restartRuntimePool })).toBe(true);
    } finally {
      await restartRuntimePool.end();
    }
    const ledgerAfter = (await migrationPool.query(
      'SELECT filename,checksum,applied_at FROM public._migrations ORDER BY filename'
    )).rows;
    expect(ledgerAfter).toEqual(ledgerBefore);

    let upgradeDatabase;
    let upgradeRoles;
    let upgradeMigrationPool;
    let upgradeRuntimePool;
    let through034;
    try {
      upgradeDatabase = await createSuiteDatabase('m22-p4-upgrade');
      upgradeRoles = await createRoles(upgradeDatabase);
      upgradeMigrationPool = new Pool({ connectionString: upgradeRoles.migrationUrl, max: 2 });
      upgradeRuntimePool = new Pool({ connectionString: upgradeRoles.runtimeUrl, max: 2 });
      through034 = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p4-through034-'));
      for (const filename of fs.readdirSync(MIGRATIONS).filter(name => /^\d+.*\.sql$/.test(name) && name < PART4_MIGRATION).sort()) {
        fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(through034, filename));
      }
      expect(await db.runMigrations({
        pool: upgradeMigrationPool, runtimePool: upgradeRuntimePool, migrationsDirectory: through034,
      })).toBe(true);
      await seedTenant(upgradeRuntimePool, IDS.organization, 'Mission 22 Part 4 Upgrade', [
        { id: IDS.owner, role: 'owner', name: 'Upgrade owner' },
      ]);
      await seedAppointment(upgradeRuntimePool, IDS.organization, IDS.appointment);
      const before = await pins(upgradeRuntimePool);
      expect(await db.runMigrations({
        pool: upgradeMigrationPool, runtimePool: upgradeRuntimePool, migrationsDirectory: MIGRATIONS,
      })).toBe(true);
      expect(await pins(upgradeRuntimePool)).toEqual(before);
      expect((await upgradeMigrationPool.query(
        'SELECT count(*)::int AS count FROM public._migrations WHERE filename=$1', [PART4_MIGRATION]
      )).rows).toEqual([{ count: 1 }]);
      expect((await upgradeMigrationPool.query(
        `SELECT to_regclass('public.canonical_schedule_mutation_previews')::text AS previews,
                to_regclass('public.canonical_schedule_human_approvals')::text AS approvals`
      )).rows[0]).toEqual({
        previews: 'canonical_schedule_mutation_previews',
        approvals: 'canonical_schedule_human_approvals',
      });
    } finally {
      if (upgradeRuntimePool) await upgradeRuntimePool.end();
      if (upgradeMigrationPool) await upgradeMigrationPool.end();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
      if (upgradeRoles) await dropRoles(upgradeRoles);
      if (through034 && path.resolve(through034).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(through034, { recursive: true, force: true });
      }
    }
  }, 240000);

  async function previewAndApprove(action, input = {}, session = sessions.owner, key = crypto.randomUUID()) {
    const before = await pins(runtimePool);
    const reason = input.reason || `${action} approved after exact human review. ${HOSTILE}`;
    const proposedTarget = input.target || before.target;
    const proposedStart = Object.prototype.hasOwnProperty.call(input, 'scheduledStart')
      ? input.scheduledStart : explicitOffset(before.scheduledStart);
    const proposedEnd = Object.prototype.hasOwnProperty.call(input, 'scheduledEnd')
      ? input.scheduledEnd : explicitOffset(before.scheduledEnd);
    const previewResponse = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(session.headers)
      .send({
        expectedRevision: before.revision, expectedDigest: before.digest,
        expectedTimeZone: 'America/New_York', action, target: proposedTarget,
        scheduledStart: proposedStart, scheduledEnd: proposedEnd,
        appointmentStatus: before.appointmentStatus, reason,
      });
    if (previewResponse.status !== 201) {
      throw new Error(`Part 4 preview failed: ${previewResponse.status} ${JSON.stringify(previewResponse.body)}`);
    }
    expect(previewResponse.body.data).toMatchObject({ grantsMutation: false, persisted: true, expiresInSeconds: 900 });
    const approvalBody = {
      previewId: previewResponse.body.data.id,
      previewDigest: previewResponse.body.data.previewDigest,
      acknowledgedWarningDigests: previewResponse.body.data.warningDigests,
      acknowledgedReviewReasonDigests: previewResponse.body.data.reviewReasonDigests,
      reason,
    };
    const approvalResponse = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(session.headers).set('Idempotency-Key', key).send(approvalBody);
    expect(approvalResponse.status).toBe(200);
    return { before, preview: previewResponse.body.data, approvalBody, approval: approvalResponse.body.data, key };
  }

  test('applies all six mutation types, exact revisions, and post-dispatch revocation', async () => {
    const assigned = await previewAndApprove('assign', { target: { kind: 'crew', id: IDS.crew } });
    expect(assigned.approval.scheduleAuthority).toMatchObject({ targetState: 'assigned', workforceCrewId: IDS.crew, revision: 2 });
    const scheduled = await previewAndApprove('schedule', {
      scheduledStart: '2027-03-15T09:00:00-04:00', scheduledEnd: '2027-03-15T10:00:00-04:00',
    });
    expect(scheduled.approval.scheduleAuthority).toMatchObject({ scheduleState: 'scheduled', dispatchState: 'not_dispatched', revision: 3 });
    const dispatched = await previewAndApprove('dispatch');
    expect(dispatched.approval.scheduleAuthority.dispatchState).toBe('dispatched');
    const reassigned = await previewAndApprove('reassign', { target: { kind: 'profile', id: IDS.dispatcher } });
    expect(reassigned.approval.scheduleAuthority).toMatchObject({ workforceProfileId: IDS.dispatcher, dispatchState: 'revoked' });
    await previewAndApprove('dispatch');
    const rescheduled = await previewAndApprove('reschedule', {
      scheduledStart: '2027-03-15T11:00:00-04:00', scheduledEnd: '2027-03-15T12:00:00-04:00',
    });
    expect(rescheduled.approval.scheduleAuthority.dispatchState).toBe('revoked');
    await previewAndApprove('dispatch');
    const unassigned = await previewAndApprove('unassign', { target: { kind: 'unassigned', id: null } });
    expect(unassigned.approval.scheduleAuthority).toMatchObject({ targetState: 'unassigned', dispatchState: 'revoked', revision: 9 });
    expect(unassigned.approval.humanApproval.timeEvidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    const evidence = (await migrationPool.query(
      `SELECT (SELECT count(*) FROM public.canonical_schedule_mutation_previews)::int AS previews,
              (SELECT count(*) FROM public.canonical_schedule_human_approvals)::int AS approvals,
              (SELECT count(*) FROM public.canonical_schedule_human_audit_events)::int AS audits,
              (SELECT count(*) FROM public.canonical_schedule_human_idempotency)::int AS replays`
    )).rows[0];
    expect(evidence).toEqual({ previews: 8, approvals: 8, audits: 8, replays: 8 });
  }, 120000);

  test('makes replay idempotent but rejects mismatched key reuse', async () => {
    const assigned = await previewAndApprove('assign', { target: { kind: 'profile', id: IDS.owner } }, sessions.dispatcher,
      'm22-part4-idempotent-retry-0001');
    const retry = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.dispatcher.headers).set('Idempotency-Key', assigned.key).send(assigned.approvalBody);
    expect(retry.status).toBe(200);
    expect(retry.body.data.humanApproval.id).toBe(assigned.approval.humanApproval.id);
    expect((await pins(runtimePool)).revision).toBe(assigned.before.revision + 1);
    const divergent = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.dispatcher.headers).set('Idempotency-Key', assigned.key)
      .send({ ...assigned.approvalBody, reason: 'Divergent reason cannot reuse the key.' });
    expect(divergent.status).toBe(409);
  });

  test('rejects stale authority, changed sessions/roles, cross-tenant and employee mutation', async () => {
    const before = await pins(runtimePool);
    const reason = 'Exact preview must not survive an authority downgrade.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'profile', id: IDS.dispatcher },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    await runtimePool.query("UPDATE public.organization_memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2",
      [IDS.organization, IDS.owner]);
    const rejected = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-role-change-000001').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: created.body.data.warningDigests,
        acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
      });
    expect([401, 403]).toContain(rejected.status);
    await runtimePool.query("UPDATE public.organization_memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",
      [IDS.organization, IDS.owner]);
    const employee = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.employee.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'profile', id: IDS.dispatcher },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(employee.status).toBe(403);
    const crossTenant = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.other.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'profile', id: IDS.dispatcher },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(crossTenant.status).toBe(404);
    expect((await pins(runtimePool)).revision).toBe(before.revision);
  });

  test('blocks legacy, direct-SQL, internal-helper, ambiguous-body and oversized bypasses', async () => {
    const before = await pins(runtimePool);
    const legacy = await request(app).patch(`/api/v1/canonical/appointments/${IDS.appointment}`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-legacy-rejected-0001').send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'calendar_edit', reason: 'Legacy direct mutation is forbidden.',
        scheduledStart: '2027-03-15T09:00:00-04:00', scheduledEnd: '2027-03-15T10:00:00-04:00', status: 'preferred',
      });
    expect(legacy.status).toBe(428);
    await expect(runtimePool.query(
      `UPDATE public.canonical_schedule_assignments SET last_reason='forged' WHERE organization_id=$1`, [IDS.organization]
    )).rejects.toMatchObject({ code: expect.stringMatching(/^(23514|42501)$/) });
    const forgedTransaction = await runtimePool.connect();
    try {
      await forgedTransaction.query('BEGIN');
      await forgedTransaction.query(
        "SELECT pg_catalog.set_config('northstar.m22_human_approval_id',$1,TRUE)",
        [crypto.randomUUID()]
      );
      await expect(forgedTransaction.query(
        `UPDATE public.canonical_schedule_assignments SET last_reason='forged transaction-local authority'
          WHERE organization_id=$1`, [IDS.organization]
      )).rejects.toMatchObject({ code: expect.stringMatching(/^(23514|42501)$/) });
    } finally {
      await forgedTransaction.query('ROLLBACK').catch(() => {});
      forgedTransaction.release();
    }
    await expect(runtimePool.query(
      `INSERT INTO public.canonical_schedule_mutation_previews(id) VALUES (gen_random_uuid())`
    )).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query(
      `SELECT public.canonical_schedule_part4_actor_authority($1,$2,'owner',$3,'forged','America/New_York')`,
      [IDS.organization, IDS.owner, sessions.owner.sessionId]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query(
      `UPDATE public.canonical_appointments SET scheduled_start=NOW(),scheduled_end=NOW()+INTERVAL '1 hour'
        WHERE organization_id=$1 AND id=$2`, [IDS.organization, IDS.appointment]
    )).rejects.toMatchObject({ code: '42501' });
    const pathName = `/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`;
    const ambiguous = await request(app).post(pathName).set(sessions.owner.headers)
      .set('Content-Type', 'application/json').send('{"expectedRevision":1,"expectedRevision":2}');
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error.code).toBe('M22_APPROVAL_AMBIGUOUS_JSON');
    const oversized = await request(app).post(pathName).set(sessions.owner.headers)
      .set('Content-Type', 'application/json').send(' '.repeat(65537));
    expect(oversized.status).toBe(413);
    expect((await pins(runtimePool)).revision).toBe(before.revision);
  });

  test('rejects crew membership divergence between preview and approval', async () => {
    const before = await pins(runtimePool);
    const reason = 'Crew membership must remain exact between preview and approval.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'crew', id: IDS.crew },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    await runtimePool.query(
      `DELETE FROM public.workforce_crew_members
        WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3`,
      [IDS.organization, IDS.crew, IDS.dispatcher]
    );
    try {
      const stale = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
        .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-crew-membership-stale-001').send({
          previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
          acknowledgedWarningDigests: created.body.data.warningDigests,
          acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
        });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('M22_EVIDENCE_STALE');
      expect((await pins(runtimePool)).revision).toBe(before.revision);
    } finally {
      await runtimePool.query(
        `INSERT INTO public.workforce_crew_members
          (organization_id,crew_id,profile_id,crew_role,created_by_user_id)
         VALUES ($1,$2,$3,'member',$4)`,
        [IDS.organization, IDS.crew, IDS.dispatcher, IDS.owner]
      );
    }
  });

  test('rolls the whole approval back when immutable audit persistence fails', async () => {
    const before = await pins(runtimePool);
    const reason = 'Durable audit must commit atomically with the authorized mutation.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'crew', id: IDS.crew },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    await migrationPool.query(`
      CREATE FUNCTION public.m22_part4_test_audit_failure() RETURNS trigger LANGUAGE plpgsql
      SET search_path=pg_catalog,public AS $fixture$
      BEGIN RAISE EXCEPTION 'controlled audit failure' USING ERRCODE='53100'; END $fixture$;
      CREATE TRIGGER m22_part4_test_audit_failure
        BEFORE INSERT ON public.canonical_schedule_human_audit_events
        FOR EACH ROW EXECUTE FUNCTION public.m22_part4_test_audit_failure()
    `);
    try {
      const failed = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
        .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-audit-rollback-0001').send({
          previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
          acknowledgedWarningDigests: created.body.data.warningDigests,
          acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
        });
      expect(failed.status).toBe(503);
      expect((await pins(runtimePool)).revision).toBe(before.revision);
      expect((await migrationPool.query(
        'SELECT count(*)::int AS count FROM public.canonical_schedule_human_approvals WHERE preview_id=$1',
        [created.body.data.id]
      )).rows).toEqual([{ count: 0 }]);
    } finally {
      await migrationPool.query(`
        DROP TRIGGER m22_part4_test_audit_failure ON public.canonical_schedule_human_audit_events;
        DROP FUNCTION public.m22_part4_test_audit_failure()
      `);
    }
  });

  test('serializes concurrent approvals so one exact preview wins without duplicate evidence', async () => {
    const before = await pins(runtimePool);
    const reason = 'Concurrent reassign preview requires exactly one current-authority winner.';
    const body = {
      expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
      action: 'reassign', target: { kind: 'profile', id: IDS.dispatcher },
      scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
      appointmentStatus: before.appointmentStatus, reason,
    };
    const [leftPreview, rightPreview] = await Promise.all([
      request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`).set(sessions.owner.headers).send(body),
      request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`).set(sessions.owner.headers).send(body),
    ]);
    expect(leftPreview.status).toBe(201);
    expect(rightPreview.status).toBe(201);
    function approval(preview, key) {
      return request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
        .set(sessions.owner.headers).set('Idempotency-Key', key).send({
          previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason,
        });
    }
    const results = await Promise.all([
      approval(leftPreview, 'm22-part4-concurrent-left-0001'),
      approval(rightPreview, 'm22-part4-concurrent-right-001'),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const after = await pins(runtimePool);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.target).toEqual({ kind: 'profile', id: IDS.dispatcher });
  }, 120000);

  test('rejects conflict/recommendation divergence and subscription changes after preview', async () => {
    const before = await pins(runtimePool);
    const reason = 'Recommendation and current subscription evidence remain approval preconditions.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'profile', id: IDS.owner },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    await runtimePool.query(
      `UPDATE public.workforce_profiles SET updated_at=updated_at+INTERVAL '1 second'
        WHERE organization_id=$1 AND id=$2`, [IDS.organization, IDS.owner]
    );
    const staleEvidence = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-recommendation-stale-01').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: created.body.data.warningDigests,
        acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
      });
    expect(staleEvidence.status).toBe(409);

    const refreshed = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'profile', id: IDS.owner },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(refreshed.status).toBe(201);
    await runtimePool.query("UPDATE public.subscriptions SET status='canceled' WHERE organization_id=$1", [IDS.organization]);
    const readOnly = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-subscription-stale-01').send({
        previewId: refreshed.body.data.id, previewDigest: refreshed.body.data.previewDigest,
        acknowledgedWarningDigests: refreshed.body.data.warningDigests,
        acknowledgedReviewReasonDigests: refreshed.body.data.reviewReasonDigests, reason,
      });
    expect(readOnly.status).toBe(403);
    await runtimePool.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [IDS.organization]);
    expect((await pins(runtimePool)).revision).toBe(before.revision);
  });

  test('requires exact acknowledgements and never applies a Part 2 hard conflict', async () => {
    const unavailable = await request(app)
      .put(`/api/v1/canonical/availability/profiles/${IDS.dispatcher}`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-unavailable-hard-0001').send({
        expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'America/New_York',
        coverageStart: '2027-03-01T00:00:00-05:00', coverageEnd: '2027-04-01T00:00:00-04:00',
        intervals: [{ kind: 'unavailable', start: '2027-03-15T12:00:00-04:00', end: '2027-03-15T14:00:00-04:00' }],
        reason: 'Dispatcher declared unavailable; no human override exists.',
      });
    expect(unavailable.status).toBe(200);
    const before = await pins(runtimePool);
    const reason = 'Hard conflict cannot be overridden by acknowledgement.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reschedule', target: before.target,
        scheduledStart: '2027-03-15T12:30:00-04:00', scheduledEnd: '2027-03-15T13:30:00-04:00',
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.conflicts.hardConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'declared_unavailable' }),
    ]));
    const wrongAcknowledgement = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-wrong-ack-00000001').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: [], acknowledgedReviewReasonDigests: [], reason,
      });
    expect(wrongAcknowledgement.status).toBe(409);
    const exactAcknowledgement = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-hard-no-override-00001').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: created.body.data.warningDigests,
        acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
      });
    expect(exactAcknowledgement.status).toBe(409);
    expect(exactAcknowledgement.body.error.code).toBe('M22_HARD_CONFLICT');
    expect((await pins(runtimePool)).revision).toBe(before.revision);
  });

  test('enforces the exact fifteen-minute boundary with a database-owner controlled clock fixture', async () => {
    const before = await pins(runtimePool);
    const reason = 'A preview at the exact expiry boundary grants no mutation.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'profile', id: IDS.owner },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    await migrationPool.query('ALTER TABLE public.canonical_schedule_mutation_previews DISABLE TRIGGER canonical_schedule_previews_immutable');
    try {
      await migrationPool.query(
        `UPDATE public.canonical_schedule_mutation_previews preview SET
           created_at=clock_timestamp()-INTERVAL '15 minutes',expires_at=clock_timestamp(),
           preview_digest=public.canonical_schedule_part4_preview_digest(
             preview.id,preview.organization_id,preview.assignment_id,preview.appointment_id,
             preview.actor_user_id,preview.auth_session_id,preview.expected_revision,rtrim(preview.expected_digest),
             preview.expected_time_zone,preview.action_code,preview.proposed_target_kind,preview.proposed_target_id,
             preview.proposed_scheduled_start,preview.proposed_scheduled_end,preview.proposed_schedule_state,
             preview.proposed_dispatch_state,preview.proposed_appointment_status,preview.reason,
             rtrim(preview.conflict_digest),preview.warning_digests,preview.review_reason_digests,
             rtrim(preview.recommendation_digest),rtrim(preview.recommendation_authority_digest),
             rtrim(preview.request_digest),clock_timestamp()-INTERVAL '15 minutes',clock_timestamp())
         WHERE organization_id=$1 AND id=$2`, [IDS.organization, created.body.data.id]
      );
    } finally {
      await migrationPool.query('ALTER TABLE public.canonical_schedule_mutation_previews ENABLE TRIGGER canonical_schedule_previews_immutable');
    }
    const expired = (await migrationPool.query(
      `SELECT rtrim(preview_digest) AS digest,warning_digests,review_reason_digests,
              expires_at-created_at AS lifetime
         FROM public.canonical_schedule_mutation_previews WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, created.body.data.id]
    )).rows[0];
    expect(expired.lifetime).toEqual(expect.objectContaining({ minutes: 15 }));
    const rejected = await request(app).post(`/api/v1/canonical/appointments/${IDS.appointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-expired-boundary-0001').send({
        previewId: created.body.data.id, previewDigest: expired.digest,
        acknowledgedWarningDigests: expired.warning_digests,
        acknowledgedReviewReasonDigests: expired.review_reason_digests, reason,
      });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('M22_PREVIEW_EXPIRED');
    expect((await pins(runtimePool)).revision).toBe(before.revision);
  });
});
