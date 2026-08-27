'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { Client, Pool } = require('pg');
const request = require('supertest');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { normalizeMutationApproval, normalizeMutationPreview } = require('../../src/scheduling/approvalContract');
const {
  loadSchedulingOperatorDirectory,
  loadSchedulingOperatorTargetPage,
  parseOperatorTargetRequest,
} = require('../../src/scheduling/operatorDirectory');
const { buildSchedulingOverview } = require('../../src/scheduling/overviewRepository');
const { AccountRepository } = require('../../src/accounts/repository');
const {
  createCanonicalRouter,
  createCompatibilityRouter,
} = require('../../src/routes/canonicalPolaris');
const { createCommandCenterRouter } = require('../../src/routes/commandCenter');
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
  conflictAppointment: 'e5100000-0000-4000-8000-000000000003',
  overlapAppointment: 'e5100000-0000-4000-8000-000000000004',
  expiryAppointment: 'e5100000-0000-4000-8000-000000000005',
  lockWaitAppointment: 'e5100000-0000-4000-8000-000000000006',
  hardMatrixAppointment: 'e5100000-0000-4000-8000-000000000007',
  crewHardAppointment: 'e5100000-0000-4000-8000-000000000008',
  invalidTargetAppointment: 'e5100000-0000-4000-8000-000000000009',
  boundaryAppointment: 'e5100000-0000-4000-8000-000000000010',
  staleAuthorityAppointment: 'e5100000-0000-4000-8000-000000000011',
  reviewEvidenceAppointment: 'e5100000-0000-4000-8000-000000000012',
  mutationMatrixAppointment: 'e5100000-0000-4000-8000-000000000013',
  idempotencyAppointment: 'e5100000-0000-4000-8000-000000000014',
  bypassAppointment: 'e5100000-0000-4000-8000-000000000015',
  crewDivergenceAppointment: 'e5100000-0000-4000-8000-000000000016',
  rollbackAppointment: 'e5100000-0000-4000-8000-000000000017',
  concurrencyAppointment: 'e5100000-0000-4000-8000-000000000018',
  evidenceDivergenceAppointment: 'e5100000-0000-4000-8000-000000000019',
  hardConflictAppointment: 'e5100000-0000-4000-8000-000000000020',
  sqlContractAppointment: 'e5100000-0000-4000-8000-000000000021',
  digestProvenanceAppointment: 'e5100000-0000-4000-8000-000000000022',
  part5Appointment: 'e5100000-0000-4000-8000-000000000023',
  targetDiscoveryAppointment: 'e5100000-0000-4000-8000-000000000024',
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
    `SELECT id,revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,
            workforce_crew_id,schedule_state,dispatch_state,scheduled_start,scheduled_end,appointment_status
       FROM public.canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
    [organizationId, appointmentId]
  )).rows[0];
  return {
    id: row.id, revision: Number(row.revision), digest: row.digest,
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
    '2027-04-15T13:00:00.000Z': '2027-04-15T09:00:00-04:00',
    '2027-04-15T14:00:00.000Z': '2027-04-15T10:00:00-04:00',
    '2027-04-15T15:00:00.000Z': '2027-04-15T11:00:00-04:00',
    '2027-04-15T16:00:00.000Z': '2027-04-15T12:00:00-04:00',
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
    await seedAppointment(runtimePool, IDS.organization, IDS.part5Appointment);
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

  test('Part 5 mounted operator directory and server overview preserve tenant, role, session, conflict, and paid/demo boundaries', async () => {
    const ownerInput = {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      membershipId: IDS.owner, authSessionId: sessions.owner.sessionId,
      onboardingComplete: true, subscriptionMutable: true,
    };
    const ownerDirectory = await loadSchedulingOperatorDirectory(runtimePool, ownerInput);
    expect(ownerDirectory).toMatchObject({ canRead: true, canMutate: true, reason: null, truncated: false });
    expect(ownerDirectory.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'profile', id: IDS.owner }),
      expect.objectContaining({ kind: 'profile', id: IDS.dispatcher }),
      expect.objectContaining({ kind: 'crew', id: IDS.crew, label: expect.stringContaining(HOSTILE) }),
    ]));
    expect(ownerDirectory.targets.some(target => target.id === IDS.otherOwner)).toBe(false);
    const dispatcherDirectory = await loadSchedulingOperatorDirectory(runtimePool, {
      ...ownerInput, actorUserId: IDS.dispatcher, actorAccessRole: 'member', membershipId: IDS.dispatcher,
      authSessionId: sessions.dispatcher.sessionId,
    });
    expect(dispatcherDirectory.canMutate).toBe(true);
    const employeeDirectory = await loadSchedulingOperatorDirectory(runtimePool, {
      ...ownerInput, actorUserId: IDS.employee, actorAccessRole: 'member', membershipId: IDS.employee,
      authSessionId: sessions.employee.sessionId,
    });
    expect(employeeDirectory).toMatchObject({ canRead: false, canMutate: false, reason: 'operator_role_required', targets: [] });
    await runtimePool.query("UPDATE public.subscriptions SET status='past_due' WHERE organization_id=$1", [IDS.organization]);
    try {
      const readOnlyDirectory = await loadSchedulingOperatorDirectory(runtimePool, ownerInput);
      expect(readOnlyDirectory).toMatchObject({
        canRead: true, canMutate: false, reason: 'subscription_read_only',
      });
      expect(readOnlyDirectory.targets.length).toBeGreaterThan(1);
    } finally {
      await runtimePool.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [IDS.organization]);
    }

    await previewAndApproveAppointment(IDS.part5Appointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
    }, 'm22-part5-assign-mounted-00001');
    await previewAndApproveAppointment(IDS.part5Appointment, 'schedule', {
      scheduledStart: '2035-06-15T09:00:00-04:00', scheduledEnd: '2035-06-15T10:00:00-04:00',
    }, 'm22-part5-schedule-mounted-001');
    const schedule = (await runtimePool.query(
      `SELECT revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,
              workforce_crew_id,schedule_state,dispatch_state,scheduled_start,scheduled_end,
              appointment_status,needs_review,review_reasons
         FROM public.canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`,
      [IDS.organization, IDS.part5Appointment]
    )).rows[0];
    const item = {
      ids: {
        appointment: IDS.part5Appointment,
        graph: IDS.part5Appointment.replace(/^e5/, 'e7'),
      },
      customer: { id: IDS.part5Appointment.replace(/^e5/, 'e8'), name: HOSTILE },
      opportunity: { serviceType: null },
      snapshot: { service: { label: HOSTILE } },
      appointment: { scheduleAuthority: {
        revision: Number(schedule.revision), digest: schedule.digest,
        targetState: schedule.target_state, workforceProfileId: schedule.workforce_profile_id,
        workforceCrewId: schedule.workforce_crew_id, scheduleState: schedule.schedule_state,
        dispatchState: schedule.dispatch_state,
        scheduledStart: new Date(schedule.scheduled_start).toISOString(),
        scheduledEnd: new Date(schedule.scheduled_end).toISOString(),
        appointmentStatus: schedule.appointment_status, needsReview: schedule.needs_review,
        reviewReasons: schedule.review_reasons,
      } },
    };
    const overviewInput = {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      authSessionId: sessions.owner.sessionId, items: [item],
    };
    const overview = await buildSchedulingOverview(runtimePool, overviewInput);
    expect(overview).toMatchObject({
      version: 'm22-part5-overview-v1', timeZone: 'America/New_York', truncated: false,
      records: [expect.objectContaining({
        appointmentId: IDS.part5Appointment,
        customer: { id: item.customer.id, name: HOSTILE },
        allowedActions: expect.arrayContaining(['reassign', 'unassign', 'reschedule', 'dispatch']),
        conflict: expect.objectContaining({ persisted: false, grantsMutation: false }),
      })],
    });
    expect(overview.digest).toMatch(/^[0-9a-f]{64}$/);
    const staleInput = {
      ...item,
      appointment: { scheduleAuthority: {
        ...item.appointment.scheduleAuthority,
        revision: 1,
        digest: '0'.repeat(64),
        targetState: 'unassigned',
        workforceProfileId: null,
        scheduleState: 'unscheduled',
        scheduledStart: null,
        scheduledEnd: null,
      } },
    };
    const refreshedOverview = await buildSchedulingOverview(runtimePool, { ...overviewInput, items: [staleInput] });
    expect(refreshedOverview.records[0].authority).toMatchObject({
      revision: Number(schedule.revision), digest: schedule.digest, targetState: 'assigned', scheduleState: 'scheduled',
    });
    await expect(buildSchedulingOverview(runtimePool, {
      ...overviewInput, actorUserId: IDS.employee, actorAccessRole: 'member',
      authSessionId: sessions.employee.sessionId,
    })).rejects.toMatchObject({ status: 403, code: 'M22_OVERVIEW_FORBIDDEN' });

    const calendarOwner = await request(app).get('/api/v1/canonical/compat/calendar?limit=100')
      .set(sessions.owner.headers).expect(200);
    expect(calendarOwner.body.data).toEqual(expect.objectContaining({
      schedulingOperator: expect.objectContaining({ canMutate: true }),
      schedulingOverview: expect.objectContaining({ version: 'm22-part5-overview-v1' }),
    }));
    const calendarEmployee = await request(app).get('/api/v1/canonical/compat/calendar?limit=100')
      .set(sessions.employee.headers).expect(403);
    expect(calendarEmployee.body.error.code).toBe('CALENDAR_OPERATOR_REQUIRED');
    expect(calendarEmployee.body.data).toBeUndefined();
    const broadAliases = [
      '/api/v1/canonical/graphs?limit=1',
      '/api/v1/canonical/dashboard?limit=1',
      '/api/v1/canonical/analytics?limit=1',
      '/api/v1/canonical/surfaces/calendar?limit=1',
      '/api/v1/canonical/compat/command-center?limit=1',
      '/api/customers?limit=1',
      '/api/communications?limit=1',
      '/api/opportunities?limit=1',
      '/api/appointments?limit=1',
      '/api/dashboard/overview?limit=1',
    ];
    for (const route of broadAliases) {
      const denied = await request(app).get(route).set(sessions.employee.headers).expect(403);
      expect(JSON.stringify(denied.body)).not.toContain(HOSTILE);
    }
    const statusAliases = ['/api/v1/canonical/status', '/api/dashboard/status'];
    for (const route of statusAliases) {
      const ownerStatus = await request(app).get(route).set(sessions.owner.headers).expect(200);
      const dispatcherStatus = await request(app).get(route).set(sessions.dispatcher.headers).expect(200);
      const employeeStatus = await request(app).get(route).set(sessions.employee.headers).expect(200);
      const otherTenantStatus = await request(app).get(route).set(sessions.other.headers).expect(200);
      expect(ownerStatus.body.completedGraphs ?? ownerStatus.body.data.completedGraphs).toBeGreaterThan(0);
      expect(dispatcherStatus.body.completedGraphs ?? dispatcherStatus.body.data.completedGraphs).toBeGreaterThan(0);
      expect(otherTenantStatus.body.completedGraphs ?? otherTenantStatus.body.data.completedGraphs).toBe(1);
      const employeeData = employeeStatus.body.data || employeeStatus.body;
      expect(JSON.stringify(employeeStatus.body)).not.toContain(HOSTILE);
      expect(employeeData).toMatchObject({ status: 'operational', broadSchedulingRead: false });
      expect(employeeData.completedGraphs).toBeUndefined();
    }
    await runtimePool.query(
      "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND user_id=$2",
      [IDS.organization, IDS.dispatcher]
    );
    try {
      for (const route of statusAliases) {
        const inactive = await request(app).get(route).set(sessions.dispatcher.headers).expect(403);
        expect(JSON.stringify(inactive.body)).not.toContain(HOSTILE);
      }
    } finally {
      await runtimePool.query(
        "UPDATE public.organization_memberships SET status='active' WHERE organization_id=$1 AND user_id=$2",
        [IDS.organization, IDS.dispatcher]
      );
    }
    await runtimePool.query(
      "UPDATE public.auth_sessions SET status='revoked',revoked_at=NOW(),revoke_reason='m22_part5_status_test' WHERE id=$1",
      [sessions.dispatcher.sessionId]
    );
    try {
      for (const route of statusAliases) {
        const revoked = await request(app).get(route).set(sessions.dispatcher.headers).expect(401);
        expect(JSON.stringify(revoked.body)).not.toContain(HOSTILE);
      }
    } finally {
      await runtimePool.query(
        "UPDATE public.auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",
        [sessions.dispatcher.sessionId]
      );
    }
    const commandOwner = await request(app).get('/api/v1/command-center/workspace')
      .set(sessions.owner.headers).expect(200);
    expect(commandOwner.body.data).toEqual(expect.objectContaining({
      mode: 'paid', schedulingOperator: expect.objectContaining({ canMutate: true }),
      schedulingOverview: expect.objectContaining({ version: 'm22-part5-overview-v1' }),
    }));
    const commandEmployee = await request(app).get('/api/v1/command-center/workspace')
      .set(sessions.employee.headers).expect(403);
    expect(commandEmployee.body.error.code).toBe('COMMAND_CENTER_OPERATOR_REQUIRED');
    await runtimePool.query("UPDATE public.subscriptions SET status='past_due' WHERE organization_id=$1", [IDS.organization]);
    try {
      const readOnlyCalendar = await request(app).get('/api/v1/canonical/compat/calendar?limit=100')
        .set(sessions.owner.headers).expect(200);
      expect(readOnlyCalendar.body.data.schedulingOperator).toMatchObject({
        canRead: true, canMutate: false, reason: 'subscription_read_only',
      });
      expect(readOnlyCalendar.body.data.schedulingOverview).toEqual(expect.objectContaining({
        records: expect.any(Array), total: expect.any(Number), truncated: false,
      }));
      const readOnlyCommand = await request(app).get('/api/v1/command-center/workspace')
        .set(sessions.owner.headers).expect(200);
      expect(readOnlyCommand.body.data.schedulingOperator).toMatchObject({ canRead: true, canMutate: false });
      for (const route of statusAliases) {
        const readOnlyStatus = await request(app).get(route).set(sessions.owner.headers).expect(200);
        expect(readOnlyStatus.body.completedGraphs ?? readOnlyStatus.body.data.completedGraphs).toBeGreaterThan(0);
      }
    } finally {
      await runtimePool.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [IDS.organization]);
    }
  }, 120000);

  test('Part 5 broad reads recheck current role, session, membership, workforce, and subscription authority in one snapshot', async () => {
    const broadRoutes = [
      '/api/v1/canonical/operator-targets?query=Part%204',
      '/api/v1/canonical/graphs?limit=1',
      '/api/v1/canonical/dashboard?limit=1',
      '/api/v1/canonical/analytics?limit=1',
      '/api/v1/canonical/surfaces/calendar?limit=1',
      '/api/v1/canonical/compat/command-center?limit=1',
      '/api/customers?limit=1',
      '/api/communications?limit=1',
      '/api/opportunities?limit=1',
      '/api/appointments?limit=1',
      '/api/dashboard/overview?limit=1',
      '/api/v1/command-center/workspace',
    ];
    const repository = new AccountRepository(runtimePool);
    const priorRepository = app.locals.accountRepository;
    async function resetOwner() {
      await runtimePool.query(
        "UPDATE public.organization_memberships SET role='owner',status='active',revoked_at=NULL WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
      await runtimePool.query(
        "UPDATE public.users SET role='owner',status='active' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
      await runtimePool.query(
        "UPDATE public.workforce_profiles SET operational_role='owner' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
      await runtimePool.query(
        "UPDATE public.auth_sessions SET status='active',access_expires_at=NOW()+INTERVAL '15 minutes',refresh_expires_at=NOW()+INTERVAL '14 days',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",
        [sessions.owner.sessionId]
      );
      await runtimePool.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [IDS.organization]);
    }
    async function racedGet(route, mutation) {
      let changed = false;
      app.locals.accountRepository = {
        sessionAuthority: async function (sessionId, userId) {
          const authority = await repository.sessionAuthority(sessionId, userId);
          if (!changed) {
            changed = true;
            await mutation();
          }
          return authority;
        },
      };
      return request(app).get(route).set(sessions.owner.headers);
    }
    try {
      for (const route of broadRoutes) {
        await resetOwner();
        const demoted = await racedGet(route, async function () {
          await runtimePool.query(
            "UPDATE public.organization_memberships SET role='member' WHERE organization_id=$1 AND id=$2",
            [IDS.organization, IDS.owner]
          );
          await runtimePool.query(
            "UPDATE public.users SET role='member' WHERE organization_id=$1 AND id=$2",
            [IDS.organization, IDS.owner]
          );
          await runtimePool.query(
            "UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id=$2",
            [IDS.organization, IDS.owner]
          );
        });
        expect(demoted.status).toBe(403);
        expect(JSON.stringify(demoted.body)).not.toContain(HOSTILE);
        expect(JSON.stringify(demoted.body)).not.toContain('total_count');
      }
      for (const route of broadRoutes) {
        await resetOwner();
        const revoked = await racedGet(route, async function () {
          await runtimePool.query(
            "UPDATE public.auth_sessions SET status='revoked',revoked_at=NOW(),revoke_reason='m22_part5_current_read_race' WHERE id=$1",
            [sessions.owner.sessionId]
          );
        });
        expect(revoked.status).toBe(401);
        expect(revoked.body.error.code).toBe('M22_OPERATOR_SESSION_NOT_CURRENT');
        expect(JSON.stringify(revoked.body)).not.toContain(HOSTILE);
      }

      await resetOwner();
      const suspendedMember = await racedGet(broadRoutes[0], async function () {
        await runtimePool.query(
          "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, IDS.owner]
        );
      });
      expect(suspendedMember.status).toBe(403);

      await resetOwner();
      const suspendedUser = await racedGet(broadRoutes[0], async function () {
        await runtimePool.query(
          "UPDATE public.users SET status='suspended' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, IDS.owner]
        );
      });
      expect(suspendedUser.status).toBe(403);

      await resetOwner();
      const expired = await racedGet(broadRoutes[0], async function () {
        await runtimePool.query(
          "UPDATE public.auth_sessions SET access_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
          [sessions.owner.sessionId]
        );
      });
      expect(expired.status).toBe(401);
      expect(expired.body.error.code).toBe('M22_OPERATOR_SESSION_NOT_CURRENT');

      await resetOwner();
      const readOnly = await racedGet(broadRoutes[0], async function () {
        await runtimePool.query("UPDATE public.subscriptions SET status='past_due' WHERE organization_id=$1", [IDS.organization]);
      });
      expect(readOnly.status).toBe(200);
      expect(readOnly.body.data).toMatchObject({ canRead: true, canMutate: false, reason: 'subscription_read_only' });

      await expect(loadSchedulingOperatorDirectory(runtimePool, {
        organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
        membershipId: IDS.owner, authSessionId: sessions.other.sessionId,
      })).rejects.toMatchObject({ status: 401, code: 'M22_OPERATOR_SESSION_NOT_CURRENT' });

      await runtimePool.query(
        "UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.dispatcher]
      );
      try {
        const removedDispatcher = await loadSchedulingOperatorDirectory(runtimePool, {
          organizationId: IDS.organization, actorUserId: IDS.dispatcher, actorAccessRole: 'member',
          membershipId: IDS.dispatcher, authSessionId: sessions.dispatcher.sessionId,
        });
        expect(removedDispatcher).toMatchObject({ canRead: false, canMutate: false, reason: 'operator_role_required', targets: [] });
      } finally {
        await runtimePool.query(
          "UPDATE public.workforce_profiles SET operational_role='dispatcher' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, IDS.dispatcher]
        );
      }
    } finally {
      await resetOwner();
      if (priorRepository === undefined) delete app.locals.accountRepository;
      else app.locals.accountRepository = priorRepository;
    }
  }, 180000);

  test('Part 5 broad aliases keep current authority and response bytes in one owned PostgreSQL snapshot', async () => {
    const atomicSessionId = 'e5100000-0000-4000-8000-000000000001';
    await provisionDurableSession(runtimePool, {
      userId: IDS.owner, organizationId: IDS.organization, membershipId: IDS.owner,
      sessionId: atomicSessionId, role: 'owner',
    });
    let activeTrace = null;
    const tracePool = {
      query: jest.fn(async function () {
        if (activeTrace) activeTrace.poolQueries += 1;
        throw new Error('A protected broad read escaped its owned snapshot client.');
      }),
      connect: async function () {
        const trace = activeTrace;
        if (!trace) throw new Error('A trace is required before opening the broad read snapshot.');
        trace.connects += 1;
        const source = await runtimePool.connect();
        let transactionActive = false;
        const client = {
          __m22Trace: trace,
          async query(sql, values) {
            const statement = String(sql).replace(/\s+/g, ' ').trim();
            if (/^BEGIN\b/.test(statement)) {
              transactionActive = true;
              trace.begins += 1;
            } else if (statement === 'COMMIT') {
              trace.commits += 1;
            } else if (statement === 'ROLLBACK') {
              trace.rollbacks += 1;
            } else if (trace.authorityComplete && !/^SET LOCAL\b/.test(statement)) {
              trace.dataQueries += 1;
              if (!transactionActive) trace.dataQueriesOutsideTransaction += 1;
              if (trace.failFirstDataQuery && !trace.dataFailureInjected) {
                trace.dataFailureInjected = true;
                throw new Error('injected protected broad read failure');
              }
            }
            try {
              return await source.query(sql, values);
            } finally {
              if (statement === 'COMMIT' || statement === 'ROLLBACK') transactionActive = false;
            }
          },
          release() {
            if (transactionActive) trace.releasedWhileActive += 1;
            trace.releases += 1;
            source.release();
          },
        };
        return client;
      },
    };
    const atomicOperatorDirectory = async function (client, input) {
      const directory = await loadSchedulingOperatorDirectory(client, input);
      const trace = client.__m22Trace;
      trace.authorityBackendPid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      trace.authorityComplete = true;
      if (typeof trace.afterAuthority === 'function' && !trace.boundaryMutationApplied) {
        trace.boundaryMutationApplied = true;
        await trace.afterAuthority();
      }
      return directory;
    };
    const fakeAuth = function (req, _res, next) {
      req.requestId = 'm22-part5-atomic-read';
      req.tenantContext = { organizationId: IDS.organization, userId: IDS.owner, role: 'owner' };
      req.orgId = IDS.organization;
      req.userRole = 'owner';
      req.user = { id: IDS.owner, organizationId: IDS.organization, role: 'owner', onboardingStatus: 'complete' };
      req.accountAuthority = { membership_id: IDS.owner };
      req.authSession = { id: atomicSessionId };
      next();
    };
    const allowPermission = function () {
      return function (_req, _res, next) { next(); };
    };
    const atomicApp = express();
    atomicApp.use(express.json());
    const dependencies = {
      auth: fakeAuth,
      onboardedAuth: fakeAuth,
      externalAuth: fakeAuth,
      permission: allowPermission,
      poolProvider: function () { return tracePool; },
      operatorDirectory: atomicOperatorDirectory,
    };
    atomicApp.use('/api/v1/canonical', createCanonicalRouter(dependencies));
    atomicApp.use('/api/v1/command-center', createCommandCenterRouter(dependencies));
    atomicApp.use('/api', createCompatibilityRouter(dependencies));

    function freshTrace(overrides = {}) {
      return {
        connects: 0, begins: 0, commits: 0, rollbacks: 0, releases: 0,
        poolQueries: 0, dataQueries: 0, dataQueriesOutsideTransaction: 0,
        releasedWhileActive: 0, authorityComplete: false, boundaryMutationApplied: false,
        dataFailureInjected: false, ...overrides,
      };
    }
    function expectOwnedSnapshot(trace) {
      expect(trace).toMatchObject({
        connects: 1, begins: 1, commits: 1, rollbacks: 0, releases: 1,
        poolQueries: 0, dataQueriesOutsideTransaction: 0, releasedWhileActive: 0,
        authorityComplete: true,
      });
      expect(trace.dataQueries).toBeGreaterThan(0);
      expect(trace.authorityBackendPid).toBeGreaterThan(0);
    }
    const notFoundId = 'f5100000-0000-4000-8000-000000000099';
    const protectedAliases = [
      '/api/v1/canonical/status',
      '/api/v1/canonical/graphs?limit=1',
      '/api/v1/canonical/dashboard?limit=1',
      '/api/v1/canonical/analytics?limit=1',
      ...['customer-detail', 'leads', 'communications', 'calendar', 'command-center', 'polaris', 'executive', 'estimates']
        .map(surface => `/api/v1/canonical/surfaces/${surface}?limit=1`),
      ...['customer-detail', 'leads', 'communications', 'calendar', 'command-center', 'polaris', 'executive', 'estimates']
        .map(surface => `/api/v1/canonical/compat/${surface}?limit=1`),
      `/api/v1/canonical/graphs/${notFoundId}`,
      `/api/v1/canonical/snapshots/${notFoundId}`,
      '/api/customers?limit=1',
      '/api/communications?limit=1',
      '/api/opportunities/pipeline?limit=1',
      '/api/opportunities?limit=1',
      '/api/financial/estimates?limit=1',
      '/api/analytics/executive?limit=1',
      '/api/analytics/kpis?limit=1',
      '/api/analytics/dashboard?limit=1',
      '/api/analytics/alerts?limit=1',
      '/api/analytics/trends?limit=1',
      '/api/analytics/pipeline?limit=1',
      '/api/analytics/by-service?limit=1',
      '/api/workflows/agenda/today?limit=1',
      '/api/leads?limit=1',
      '/api/calls?limit=1',
      '/api/appointments?limit=1',
      '/api/dashboard/overview?limit=1',
      ...['summary', 'revenue', 'brief', 'coach', 'kpis', 'trends', 'revenue-trends']
        .map(endpoint => `/api/dashboard/${endpoint}?limit=1`),
      '/api/dashboard/status',
      '/api/calendar/events?limit=1',
      '/api/calendar/upcoming?limit=1',
      '/api/financial/metrics?limit=1',
      '/api/polaris/intelligence?limit=1',
      '/api/polaris/estimates?limit=1',
      '/api/polaris/recommendations?limit=1',
      '/api/polaris/learning?limit=1',
      '/api/polaris/pipeline?limit=1',
      '/api/polaris/retell-context?limit=1',
      '/api/polaris/business-context?limit=1',
      '/api/polaris/unified-context?limit=1',
      '/api/stats?limit=1',
      '/api/leads/intelligence/dashboard?limit=1',
      `/api/customers/${notFoundId}`,
      `/api/communications/${notFoundId}`,
      `/api/opportunities/${notFoundId}`,
      `/api/financial/estimates/${notFoundId}`,
      `/api/leads/${notFoundId}/intelligence`,
      `/api/leads/${notFoundId}`,
      '/api/v1/command-center/workspace',
      `/api/v1/command-center/polaris/customer/${notFoundId}`,
      `/api/v1/command-center/polaris/lead/${notFoundId}`,
      `/api/v1/command-center/polaris/work/${notFoundId}`,
    ];
    for (const route of protectedAliases) {
      activeTrace = freshTrace();
      const response = await request(atomicApp).get(route);
      expect([200, 404]).toContain(response.status);
      expectOwnedSnapshot(activeTrace);
    }

    async function resetOwner() {
      await runtimePool.query(
        "UPDATE public.organization_memberships SET role='owner',status='active',revoked_at=NULL WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
      await runtimePool.query(
        "UPDATE public.users SET role='owner',status='active' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
      await runtimePool.query(
        "UPDATE public.workforce_profiles SET operational_role='owner' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
      const session = await runtimePool.query('SELECT id FROM public.auth_sessions WHERE id=$1', [atomicSessionId]);
      if (session.rowCount === 0) {
        await provisionDurableSession(runtimePool, {
          userId: IDS.owner, organizationId: IDS.organization, membershipId: IDS.owner,
          sessionId: atomicSessionId, role: 'owner',
        });
      } else {
        await runtimePool.query(
          "UPDATE public.auth_sessions SET status='active',access_expires_at=NOW()+INTERVAL '15 minutes',refresh_expires_at=NOW()+INTERVAL '14 days',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",
          [atomicSessionId]
        );
      }
      await runtimePool.query(
        "UPDATE public.canonical_business_profiles SET is_active=TRUE,retired_at=NULL WHERE organization_id=$1",
        [IDS.organization]
      );
      await runtimePool.query(
        `UPDATE public.organization_onboarding
            SET status='complete',active_business_profile_id=(
              SELECT id FROM public.canonical_business_profiles
               WHERE organization_id=$1 AND is_active=TRUE ORDER BY version_number DESC,id LIMIT 1
            ),completed_at=NOW()
          WHERE organization_id=$1`,
        [IDS.organization]
      );
      await runtimePool.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [IDS.organization]);
    }
    async function runLinearizedRace(mutation, expectedNextStatus, expectedCode) {
      await resetOwner();
      activeTrace = freshTrace({ afterAuthority: mutation });
      const raced = await request(atomicApp).get('/api/v1/canonical/graphs?limit=1');
      expect(raced.status).toBe(200);
      expect(raced.body.success).toBe(true);
      expectOwnedSnapshot(activeTrace);
      expect(activeTrace.boundaryMutationApplied).toBe(true);

      activeTrace = freshTrace();
      const current = await request(atomicApp).get('/api/v1/canonical/graphs?limit=1');
      expect(current.status).toBe(expectedNextStatus);
      if (expectedCode) expect(current.body.error.code).toBe(expectedCode);
      if (expectedNextStatus !== 200) expect(JSON.stringify(current.body)).not.toContain(HOSTILE);
      await resetOwner();
    }
    await runLinearizedRace(async function () {
      await runtimePool.query(
        "UPDATE public.organization_memberships SET role='member' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
      await runtimePool.query(
        "UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
    }, 403, 'M22_BROAD_SCHEDULING_READ_FORBIDDEN');
    await runLinearizedRace(async function () {
      await runtimePool.query(
        "UPDATE public.auth_sessions SET status='revoked',revoked_at=NOW(),revoke_reason='m22_part5_atomic_read' WHERE id=$1",
        [atomicSessionId]
      );
    }, 401, 'M22_OPERATOR_SESSION_NOT_CURRENT');
    await runLinearizedRace(async function () {
      await runtimePool.query(
        "UPDATE public.auth_sessions SET access_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [atomicSessionId]
      );
    }, 401, 'M22_OPERATOR_SESSION_NOT_CURRENT');
    await runLinearizedRace(async function () {
      await runtimePool.query('DELETE FROM public.auth_sessions WHERE id=$1', [atomicSessionId]);
    }, 401, 'M22_OPERATOR_SESSION_NOT_CURRENT');
    await runLinearizedRace(async function () {
      await runtimePool.query(
        "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
    }, 403, 'M22_BROAD_SCHEDULING_READ_FORBIDDEN');
    await runLinearizedRace(async function () {
      await runtimePool.query(
        "UPDATE public.users SET status='suspended' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, IDS.owner]
      );
    }, 403, 'M22_BROAD_SCHEDULING_READ_FORBIDDEN');

    await resetOwner();
    activeTrace = freshTrace({
      afterAuthority: async function () {
        await runtimePool.query("UPDATE public.subscriptions SET status='past_due' WHERE organization_id=$1", [IDS.organization]);
      },
    });
    expect((await request(atomicApp).get('/api/v1/canonical/graphs?limit=1')).status).toBe(200);
    expectOwnedSnapshot(activeTrace);
    const readOnly = await loadSchedulingOperatorDirectory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      membershipId: IDS.owner, authSessionId: atomicSessionId,
    });
    expect(readOnly).toMatchObject({ canRead: true, canMutate: false, reason: 'subscription_read_only' });

    await resetOwner();
    activeTrace = freshTrace({
      afterAuthority: async function () {
        await runtimePool.query(
          "UPDATE public.canonical_business_profiles SET is_active=FALSE,retired_at=NOW() WHERE organization_id=$1",
          [IDS.organization]
        );
        await runtimePool.query(
          "UPDATE public.organization_onboarding SET status='business_profile_required',active_business_profile_id=NULL,completed_at=NULL WHERE organization_id=$1",
          [IDS.organization]
        );
      },
    });
    expect((await request(atomicApp).get('/api/v1/canonical/graphs?limit=1')).status).toBe(200);
    expectOwnedSnapshot(activeTrace);
    const onboardingReadOnly = await loadSchedulingOperatorDirectory(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      membershipId: IDS.owner, authSessionId: atomicSessionId,
    });
    expect(onboardingReadOnly).toMatchObject({ canRead: true, canMutate: false, reason: 'onboarding_incomplete' });
    await resetOwner();

    activeTrace = freshTrace({ failFirstDataQuery: true });
    const failed = await request(atomicApp).get('/api/v1/canonical/graphs?limit=1');
    expect(failed.status).toBe(503);
    expect(activeTrace).toMatchObject({
      connects: 1, begins: 1, commits: 0, rollbacks: 1, releases: 1,
      dataFailureInjected: true, dataQueriesOutsideTransaction: 0, releasedWhileActive: 0,
    });
    expect(activeTrace.poolQueries).toBe(0);
    await resetOwner();
  }, 300000);

  test('Part 5 bounded target discovery reaches 101+ active profiles and crews without weakening current authority', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.targetDiscoveryAppointment);
    const profileRows = Array.from({ length: 102 }, (_, index) => ({
      id: `b2100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: index >= 100 ? `ZZZ ${HOSTILE} duplicate` : `Directory worker ${String(index).padStart(3, '0')}`,
      email: `directory-worker-${String(index).padStart(3, '0')}@part5.test`,
    }));
    const crewRows = Array.from({ length: 102 }, (_, index) => ({
      id: `b3100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      key: `directory-crew-${String(index).padStart(3, '0')}`,
      name: index === 101 ? `ZZZ ${HOSTILE} duplicate` : `Directory crew ${String(index).padStart(3, '0')}`,
    }));
    const profileIds = profileRows.map(row => row.id);
    const crewIds = crewRows.map(row => row.id);
    const ownerInput = {
      organizationId: IDS.organization, actorUserId: IDS.owner, actorAccessRole: 'owner',
      membershipId: IDS.owner, authSessionId: sessions.owner.sessionId,
      onboardingComplete: true, subscriptionMutable: true,
    };
    await runtimePool.query(
      `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
       SELECT item.id::uuid,$1,item.name,item.email,'not-used','member','active'
         FROM jsonb_to_recordset($2::jsonb) AS item(id text,name text,email text)`,
      [IDS.organization, JSON.stringify(profileRows)]
    );
    await runtimePool.query(
      `INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
       SELECT item.id::uuid,$1,item.id::uuid,'member','active'
         FROM jsonb_to_recordset($2::jsonb) AS item(id text)`,
      [IDS.organization, JSON.stringify(profileRows)]
    );
    await runtimePool.query(
      `UPDATE public.workforce_profiles SET operational_role='technician'
        WHERE organization_id=$1 AND id=ANY($2::uuid[])`, [IDS.organization, profileIds]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crews(
         id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id)
       SELECT item.id::uuid,$1,item.key,item.name,'headquarters',$2,$2
         FROM jsonb_to_recordset($3::jsonb) AS item(id text,key text,name text)`,
      [IDS.organization, IDS.owner, JSON.stringify(crewRows)]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crew_members(
         organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       SELECT $1,item.id::uuid,$2,'lead',$2
         FROM jsonb_to_recordset($3::jsonb) AS item(id text)`,
      [IDS.organization, IDS.owner, JSON.stringify(crewRows)]
    );
    try {
      const initial = await loadSchedulingOperatorDirectory(runtimePool, ownerInput);
      expect(initial).toMatchObject({
        canRead: true, canMutate: true, truncated: true,
        discovery: {
          version: 'm22-part5-target-directory-v1', pageSize: 25,
          shown: 200, total: 208, truncated: true,
          counts: { profiles: { shown: 100, total: 105 }, crews: { shown: 100, total: 103 } },
        },
      });
      expect(initial.targets.some(target => target.id === profileRows[101].id)).toBe(false);
      expect(initial.targets.some(target => target.id === crewRows[101].id)).toBe(false);

      let targetRequest = parseOperatorTargetRequest({ query: 'ZZZ ' }, IDS.organization);
      const duplicatePage = await loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...targetRequest });
      expect(duplicatePage.targets.map(target => ({ kind: target.kind, id: target.id, label: target.label }))).toEqual([
        { kind: 'profile', id: profileRows[100].id, label: profileRows[100].name },
        { kind: 'profile', id: profileRows[101].id, label: profileRows[101].name },
        { kind: 'crew', id: crewRows[101].id, label: crewRows[101].name },
      ]);
      expect(duplicatePage).toMatchObject({ canRead: true, canMutate: true, query: 'ZZZ', page: { shown: 3, total: 3, truncated: false } });
      expect(duplicatePage.digest).toMatch(/^[0-9a-f]{64}$/);

      const collected = [];
      let rawCursor = null;
      let pages = 0;
      do {
        targetRequest = parseOperatorTargetRequest({ query: '', ...(rawCursor ? { cursor: rawCursor } : {}) }, IDS.organization);
        const page = await loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...targetRequest });
        pages += 1;
        expect(page.targets.length).toBeLessThanOrEqual(25);
        expect(page.page).toMatchObject({ size: 25, total: 208 });
        collected.push(...page.targets.map(target => `${target.kind}:${target.id}`));
        rawCursor = page.page.nextCursor;
      } while (rawCursor && pages < 20);
      expect(pages).toBe(9);
      expect(collected).toHaveLength(208);
      expect(new Set(collected).size).toBe(208);
      expect(collected).toContain(`profile:${profileRows[101].id}`);
      expect(collected).toContain(`crew:${crewRows[101].id}`);

      const uppercaseRequest = parseOperatorTargetRequest({ query: profileRows[101].id.toUpperCase() }, IDS.organization);
      expect(uppercaseRequest.query).toBe(profileRows[101].id);
      const uppercasePage = await loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...uppercaseRequest });
      expect(uppercasePage).toMatchObject({ query: profileRows[101].id, page: { shown: 1, total: 1 } });
      expect(uppercasePage.targets[0].id).toBe(profileRows[101].id);

      const renameFirstRequest = parseOperatorTargetRequest({ query: '' }, IDS.organization);
      const renameFirstPage = await loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...renameFirstRequest });
      expect(renameFirstPage.page.nextCursor).toEqual(expect.any(String));
      await runtimePool.query(
        `UPDATE public.users
            SET name=CASE id WHEN $2::uuid THEN 'ZZZ renamed returned' ELSE 'AAA renamed unseen' END
          WHERE organization_id=$1 AND id IN ($2::uuid,$3::uuid)`,
        [IDS.organization, profileRows[0].id, profileRows[60].id]
      );
      try {
        const renamedTraversal = renameFirstPage.targets.map(target => `${target.kind}:${target.id}`);
        let renamedCursor = renameFirstPage.page.nextCursor;
        while (renamedCursor) {
          const requestPage = parseOperatorTargetRequest({ query: '', cursor: renamedCursor }, IDS.organization);
          const page = await loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...requestPage });
          renamedTraversal.push(...page.targets.map(target => `${target.kind}:${target.id}`));
          renamedCursor = page.page.nextCursor;
        }
        expect(renamedTraversal).toHaveLength(208);
        expect(new Set(renamedTraversal).size).toBe(208);
        expect(renamedTraversal).toContain(`profile:${profileRows[0].id}`);
        expect(renamedTraversal).toContain(`profile:${profileRows[60].id}`);
      } finally {
        await runtimePool.query(
          `UPDATE public.users
              SET name=CASE id WHEN $2::uuid THEN $4 ELSE $5 END
            WHERE organization_id=$1 AND id IN ($2::uuid,$3::uuid)`,
          [IDS.organization, profileRows[0].id, profileRows[60].id, profileRows[0].name, profileRows[60].name]
        );
      }

      const matchingFirst = await loadSchedulingOperatorTargetPage(runtimePool, {
        ...ownerInput, ...parseOperatorTargetRequest({ query: 'Directory worker' }, IDS.organization),
      });
      await runtimePool.query('UPDATE public.users SET name=$3 WHERE organization_id=$1 AND id=$2',
        [IDS.organization, profileRows[60].id, 'No longer query matching']);
      try {
        const staleRequest = parseOperatorTargetRequest({
          query: 'Directory worker', cursor: matchingFirst.page.nextCursor,
        }, IDS.organization);
        await expect(loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...staleRequest }))
          .rejects.toMatchObject({ status: 409, code: 'M22_OPERATOR_TARGET_DIRECTORY_STALE' });
      } finally {
        await runtimePool.query('UPDATE public.users SET name=$3 WHERE organization_id=$1 AND id=$2',
          [IDS.organization, profileRows[60].id, profileRows[60].name]);
      }

      const beforeDeactivate = await loadSchedulingOperatorTargetPage(runtimePool, {
        ...ownerInput, ...parseOperatorTargetRequest({ query: '' }, IDS.organization),
      });
      await runtimePool.query(
        "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, profileRows[80].id]
      );
      try {
        const staleRequest = parseOperatorTargetRequest({ cursor: beforeDeactivate.page.nextCursor }, IDS.organization);
        await expect(loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...staleRequest }))
          .rejects.toMatchObject({ status: 409, code: 'M22_OPERATOR_TARGET_DIRECTORY_STALE' });
      } finally {
        await runtimePool.query(
          "UPDATE public.organization_memberships SET status='active' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, profileRows[80].id]
        );
      }

      await runtimePool.query(
        "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, profileRows[81].id]
      );
      const beforeActivate = await loadSchedulingOperatorTargetPage(runtimePool, {
        ...ownerInput, ...parseOperatorTargetRequest({ query: '' }, IDS.organization),
      });
      await runtimePool.query(
        "UPDATE public.organization_memberships SET status='active' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, profileRows[81].id]
      );
      const activatedRequest = parseOperatorTargetRequest({ cursor: beforeActivate.page.nextCursor }, IDS.organization);
      await expect(loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...activatedRequest }))
        .rejects.toMatchObject({ status: 409, code: 'M22_OPERATOR_TARGET_DIRECTORY_STALE' });

      const beforeCrewMembership = await loadSchedulingOperatorTargetPage(runtimePool, {
        ...ownerInput, ...parseOperatorTargetRequest({ query: '' }, IDS.organization),
      });
      await runtimePool.query(
        'DELETE FROM public.workforce_crew_members WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3',
        [IDS.organization, crewRows[101].id, IDS.owner]
      );
      try {
        const staleRequest = parseOperatorTargetRequest({ cursor: beforeCrewMembership.page.nextCursor }, IDS.organization);
        await expect(loadSchedulingOperatorTargetPage(runtimePool, { ...ownerInput, ...staleRequest }))
          .rejects.toMatchObject({ status: 409, code: 'M22_OPERATOR_TARGET_DIRECTORY_STALE' });
      } finally {
        await runtimePool.query(
          `INSERT INTO public.workforce_crew_members(organization_id,crew_id,profile_id,crew_role,created_by_user_id)
           VALUES ($1,$2,$3,'lead',$3)`,
          [IDS.organization, crewRows[101].id, IDS.owner]
        );
      }

      const ownerHttp = await request(app).get('/api/v1/canonical/operator-targets')
        .query({ query: 'ZZZ ' }).set(sessions.owner.headers).expect(200);
      expect(ownerHttp.body.data.targets.map(target => target.id)).toEqual([
        profileRows[100].id, profileRows[101].id, crewRows[101].id,
      ]);
      const uppercaseHttp = await request(app).get('/api/v1/canonical/operator-targets')
        .query({ query: profileRows[101].id.toUpperCase() }).set(sessions.owner.headers).expect(200);
      expect(uppercaseHttp.body.data).toMatchObject({ query: profileRows[101].id, page: { shown: 1, total: 1 } });
      const employeeHttp = await request(app).get('/api/v1/canonical/operator-targets')
        .query({ query: 'ZZZ ' }).set(sessions.employee.headers).expect(403);
      expect(employeeHttp.body.error.code).toBe('M22_OPERATOR_TARGET_DIRECTORY_FORBIDDEN');
      expect(JSON.stringify(employeeHttp.body)).not.toContain(HOSTILE);
      const crossTenant = await request(app).get('/api/v1/canonical/operator-targets')
        .query({ query: profileRows[101].id }).set(sessions.other.headers).expect(200);
      expect(crossTenant.body.data.targets).toEqual([]);

      await runtimePool.query("UPDATE public.subscriptions SET status='past_due' WHERE organization_id=$1", [IDS.organization]);
      try {
        const readOnly = await request(app).get('/api/v1/canonical/operator-targets')
          .query({ query: 'ZZZ ' }).set(sessions.owner.headers).expect(200);
        expect(readOnly.body.data).toMatchObject({ canRead: true, canMutate: false, reason: 'subscription_read_only' });
      } finally {
        await runtimePool.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [IDS.organization]);
      }

      await runtimePool.query(
        "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, profileRows[101].id]
      );
      try {
        const inactiveLookup = await request(app).get('/api/v1/canonical/operator-targets')
          .query({ query: profileRows[101].id }).set(sessions.owner.headers).expect(200);
        expect(inactiveLookup.body.data.targets).toEqual([]);
        const inactivePreview = await previewAppointment(IDS.targetDiscoveryAppointment, 'assign', {
          target: { kind: 'profile', id: profileRows[101].id },
          reason: 'A deactivated discovered target cannot enter preview.',
        });
        expect(inactivePreview.response.status).toBe(409);
        expect(inactivePreview.response.body.error.code).toBe('M22_INVALID_TRANSITION');
      } finally {
        await runtimePool.query(
          "UPDATE public.organization_memberships SET status='active' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, profileRows[101].id]
        );
      }

      const currentPreview = await previewAppointment(IDS.targetDiscoveryAppointment, 'assign', {
        target: { kind: 'profile', id: profileRows[101].id },
        reason: 'Approval must recheck a discovered target after lookup and preview.',
      });
      expect(currentPreview.response.status).toBe(201);
      await runtimePool.query(
        "UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2",
        [IDS.organization, profileRows[101].id]
      );
      try {
        const rejectedApproval = await request(app)
          .post(`/api/v1/canonical/appointments/${IDS.targetDiscoveryAppointment}/mutation-approvals`)
          .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part5-target-deactivate-after-preview')
          .send({
            previewId: currentPreview.response.body.data.id,
            previewDigest: currentPreview.response.body.data.previewDigest,
            acknowledgedWarningDigests: currentPreview.response.body.data.warningDigests,
            acknowledgedReviewReasonDigests: currentPreview.response.body.data.reviewReasonDigests,
            reason: currentPreview.reason,
          });
        expect(rejectedApproval.status).toBe(409);
        expect(rejectedApproval.body.error.code).toBe('M22_EVIDENCE_STALE');
      } finally {
        await runtimePool.query(
          "UPDATE public.organization_memberships SET status='active' WHERE organization_id=$1 AND id=$2",
          [IDS.organization, profileRows[101].id]
        );
      }
    } finally {
      await runtimePool.query(
        'DELETE FROM public.workforce_crew_members WHERE organization_id=$1 AND crew_id=ANY($2::uuid[])',
        [IDS.organization, crewIds]
      );
      await runtimePool.query(
        'DELETE FROM public.workforce_crews WHERE organization_id=$1 AND id=ANY($2::uuid[])',
        [IDS.organization, crewIds]
      );
      await runtimePool.query(
        'DELETE FROM public.workforce_profiles WHERE organization_id=$1 AND id=ANY($2::uuid[])',
        [IDS.organization, profileIds]
      );
      await runtimePool.query(
        'DELETE FROM public.organization_memberships WHERE organization_id=$1 AND id=ANY($2::uuid[])',
        [IDS.organization, profileIds]
      );
      await runtimePool.query(
        'DELETE FROM public.users WHERE organization_id=$1 AND id=ANY($2::uuid[])',
        [IDS.organization, profileIds]
      );
    }
  }, 180000);

  async function previewAndApprove(action, input = {}, session = sessions.owner, key = crypto.randomUUID()) {
    const appointmentId = input.appointmentId || IDS.mutationMatrixAppointment;
    const before = await pins(runtimePool, IDS.organization, appointmentId);
    const reason = input.reason || `${action} approved after exact human review. ${HOSTILE}`;
    const proposedTarget = input.target || before.target;
    const proposedStart = Object.prototype.hasOwnProperty.call(input, 'scheduledStart')
      ? input.scheduledStart : explicitOffset(before.scheduledStart);
    const proposedEnd = Object.prototype.hasOwnProperty.call(input, 'scheduledEnd')
      ? input.scheduledEnd : explicitOffset(before.scheduledEnd);
    const previewResponse = await request(app)
      .post(`/api/v1/canonical/appointments/${appointmentId}/mutation-previews`)
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
      .post(`/api/v1/canonical/appointments/${appointmentId}/mutation-approvals`)
      .set(session.headers).set('Idempotency-Key', key).send(approvalBody);
    expect(approvalResponse.status).toBe(200);
    return { before, preview: previewResponse.body.data, approvalBody, approval: approvalResponse.body.data, key };
  }

  async function previewAppointment(appointmentId, action, input = {}, session = sessions.owner) {
    const before = await pins(runtimePool, IDS.organization, appointmentId);
    const reason = input.reason || `${action} exact human preview for ${appointmentId}.`;
    const target = input.target || before.target;
    const scheduledStart = Object.prototype.hasOwnProperty.call(input, 'scheduledStart')
      ? input.scheduledStart : explicitOffset(before.scheduledStart);
    const scheduledEnd = Object.prototype.hasOwnProperty.call(input, 'scheduledEnd')
      ? input.scheduledEnd : explicitOffset(before.scheduledEnd);
    const response = await request(app)
      .post(`/api/v1/canonical/appointments/${appointmentId}/mutation-previews`)
      .set(session.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest,
        expectedTimeZone: 'America/New_York', action, target, scheduledStart, scheduledEnd,
        appointmentStatus: before.appointmentStatus, reason,
      });
    return { before, reason, response };
  }

  async function approveAppointment(appointmentId, created, key, session = sessions.owner) {
    return request(app)
      .post(`/api/v1/canonical/appointments/${appointmentId}/mutation-approvals`)
      .set(session.headers).set('Idempotency-Key', key).send({
        previewId: created.response.body.data.id,
        previewDigest: created.response.body.data.previewDigest,
        acknowledgedWarningDigests: created.response.body.data.warningDigests,
        acknowledgedReviewReasonDigests: created.response.body.data.reviewReasonDigests,
        reason: created.reason,
      });
  }

  async function previewAndApproveAppointment(appointmentId, action, input, key) {
    const created = await previewAppointment(appointmentId, action, input);
    expect(created.response.status).toBe(201);
    const approved = await approveAppointment(appointmentId, created, key);
    expect(approved.status).toBe(200);
    return { ...created, approved };
  }

  async function movePreviewExpiry(previewId, interval) {
    await migrationPool.query(
      'ALTER TABLE public.canonical_schedule_mutation_previews DISABLE TRIGGER canonical_schedule_previews_immutable'
    );
    try {
      return (await migrationPool.query(
        `WITH fixed AS (SELECT clock_timestamp() AS now_value)
         UPDATE public.canonical_schedule_mutation_previews preview SET
           created_at=fixed.now_value-INTERVAL '15 minutes'+$3::interval,
           expires_at=fixed.now_value+$3::interval,
           preview_digest=public.canonical_schedule_part4_preview_digest(
             preview.id,preview.organization_id,preview.assignment_id,preview.appointment_id,
             preview.actor_user_id,preview.auth_session_id,preview.expected_revision,rtrim(preview.expected_digest),
             preview.expected_time_zone,preview.action_code,preview.proposed_target_kind,preview.proposed_target_id,
             preview.proposed_scheduled_start,preview.proposed_scheduled_end,preview.proposed_schedule_state,
             preview.proposed_dispatch_state,preview.proposed_appointment_status,preview.reason,
             rtrim(preview.conflict_digest),preview.warning_digests,preview.review_reason_digests,
             rtrim(preview.recommendation_digest),rtrim(preview.recommendation_authority_digest),
             rtrim(preview.request_digest),fixed.now_value-INTERVAL '15 minutes'+$3::interval,
             fixed.now_value+$3::interval)
         FROM fixed WHERE preview.organization_id=$1 AND preview.id=$2
         RETURNING rtrim(preview.preview_digest) AS preview_digest,preview.expires_at,
                   rtrim(preview.conflict_digest) AS conflict_digest,
                   rtrim(preview.recommendation_authority_digest) AS recommendation_authority_digest,
                   preview.warning_digests,preview.review_reason_digests,preview.reason`,
        [IDS.organization, previewId, interval]
      )).rows[0];
    } finally {
      await migrationPool.query(
        'ALTER TABLE public.canonical_schedule_mutation_previews ENABLE TRIGGER canonical_schedule_previews_immutable'
      );
    }
  }

  async function directApproval(client, appointmentId, previewId, evidence, suffix) {
    const idempotencyKey = `m22-${suffix}-direct-idempotency`;
    const normalized = normalizeMutationApproval({
      organizationId: IDS.organization,
      actorUserId: IDS.owner,
      authSessionId: sessions.owner.sessionId,
      appointmentId,
      idempotencyKey,
      body: {
        previewId,
        previewDigest: evidence.preview_digest,
        acknowledgedWarningDigests: evidence.warning_digests,
        acknowledgedReviewReasonDigests: evidence.review_reason_digests,
        reason: evidence.reason,
      },
    });
    return client.query(
      `SELECT public.canonical_schedule_apply_mutation_approval(
         $1::uuid,$2::uuid,$3::uuid,'owner',$4::uuid,$5::text,$6::uuid,$7::text,
         $8::jsonb,$9::jsonb,$10::text,$11::text,$12::text,$13::text,$14::text) AS response`,
      [IDS.organization, appointmentId, IDS.owner, sessions.owner.sessionId, sessions.owner.csrfToken,
        previewId, evidence.preview_digest, JSON.stringify(evidence.warning_digests),
        JSON.stringify(evidence.review_reason_digests), evidence.reason, evidence.conflict_digest,
        evidence.recommendation_authority_digest, normalized.idempotencyKeyHash, normalized.requestDigest]
    );
  }

  function previewContractInput(appointmentId, before, overrides = {}) {
    return {
      organizationId: IDS.organization,
      actorUserId: IDS.owner,
      authSessionId: sessions.owner.sessionId,
      appointmentId,
      body: {
        expectedRevision: before.revision,
        expectedDigest: before.digest,
        expectedTimeZone: 'America/New_York',
        action: 'assign',
        target: { kind: 'profile', id: IDS.owner },
        scheduledStart: before.scheduledStart,
        scheduledEnd: before.scheduledEnd,
        appointmentStatus: before.appointmentStatus,
        reason: 'Direct runtime canonical contract evidence.',
        ...overrides,
      },
    };
  }

  async function directPreview(client, input, requestDigest) {
    const before = await pins(client, IDS.organization, input.appointmentId);
    const body = input.body;
    const conflict = {
      id: '0'.repeat(64), assignmentId: before.id, appointmentId: input.appointmentId,
      evaluationVersion: 'caller-evidence-is-non-authoritative', assignmentRevision: before.revision,
      assignmentDigest: before.digest, status: 'clear', hardConflicts: [], warnings: [],
      needsReview: false, reviewReasons: [], digest: '0'.repeat(64), persisted: false,
      grantsMutation: false,
    };
    return client.query(
      `SELECT public.canonical_schedule_create_mutation_preview(
         $1::uuid,$2::uuid,$3::uuid,'owner',$4::uuid,$5::text,$6::bigint,$7::text,
         $8::text,$9::text,$10::text,$11::uuid,$12::timestamptz,$13::timestamptz,
         $14::jsonb,$15::text,$16::text,$17::jsonb,$18::text,'[]'::jsonb,'[]'::jsonb,
         $18::text,$18::text,$19::text) AS response`,
      [IDS.organization, input.appointmentId, IDS.owner, sessions.owner.sessionId,
        sessions.owner.csrfToken, body.expectedRevision, body.expectedDigest,
        body.expectedTimeZone, body.action, body.target.kind, body.target.id,
        body.scheduledStart, body.scheduledEnd,
        JSON.stringify({ scheduledStart: body.scheduledStart, scheduledEnd: body.scheduledEnd }),
        body.appointmentStatus, body.reason, JSON.stringify(conflict), '0'.repeat(64), requestDigest]
    );
  }

  test('applies all six mutation types, exact revisions, and post-dispatch revocation', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.mutationMatrixAppointment);
    const assigned = await previewAndApprove('assign', { target: { kind: 'crew', id: IDS.crew } });
    expect(assigned.approval.scheduleAuthority).toMatchObject({ targetState: 'assigned', workforceCrewId: IDS.crew, revision: 2 });
    const scheduled = await previewAndApprove('schedule', {
      scheduledStart: '2027-04-15T09:00:00-04:00', scheduledEnd: '2027-04-15T10:00:00-04:00',
    });
    expect(scheduled.approval.scheduleAuthority).toMatchObject({ scheduleState: 'scheduled', dispatchState: 'not_dispatched', revision: 3 });
    const dispatched = await previewAndApprove('dispatch');
    expect(dispatched.approval.scheduleAuthority.dispatchState).toBe('dispatched');
    const reassigned = await previewAndApprove('reassign', { target: { kind: 'profile', id: IDS.dispatcher } });
    expect(reassigned.approval.scheduleAuthority).toMatchObject({ workforceProfileId: IDS.dispatcher, dispatchState: 'revoked' });
    await previewAndApprove('dispatch');
    const rescheduled = await previewAndApprove('reschedule', {
      scheduledStart: '2027-04-15T11:00:00-04:00', scheduledEnd: '2027-04-15T12:00:00-04:00',
    });
    expect(rescheduled.approval.scheduleAuthority.dispatchState).toBe('revoked');
    await previewAndApprove('dispatch');
    const unassigned = await previewAndApprove('unassign', { target: { kind: 'unassigned', id: null } });
    expect(unassigned.approval.scheduleAuthority).toMatchObject({ targetState: 'unassigned', dispatchState: 'revoked', revision: 9 });
    expect(unassigned.approval.humanApproval.timeEvidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    const evidence = (await migrationPool.query(
      `SELECT (SELECT count(*) FROM public.canonical_schedule_mutation_previews WHERE assignment_id=$1)::int AS previews,
              (SELECT count(*) FROM public.canonical_schedule_human_approvals WHERE assignment_id=$1)::int AS approvals,
              (SELECT count(*) FROM public.canonical_schedule_human_audit_events WHERE assignment_id=$1)::int AS audits,
              (SELECT count(*) FROM public.canonical_schedule_human_idempotency WHERE assignment_id=$1)::int AS replays`,
      [assigned.before.id]
    )).rows[0];
    expect(evidence).toEqual({ previews: 8, approvals: 8, audits: 8, replays: 8 });
  }, 120000);

  test('makes replay idempotent but rejects mismatched key reuse', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.idempotencyAppointment);
    const assigned = await previewAndApprove('assign', {
      appointmentId: IDS.idempotencyAppointment, target: { kind: 'profile', id: IDS.owner },
    }, sessions.dispatcher,
      'm22-part4-idempotent-retry-0001');
    const retry = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.idempotencyAppointment}/mutation-approvals`)
      .set(sessions.dispatcher.headers).set('Idempotency-Key', assigned.key).send(assigned.approvalBody);
    expect(retry.status).toBe(200);
    expect(retry.body.data.humanApproval.id).toBe(assigned.approval.humanApproval.id);
    expect((await pins(runtimePool, IDS.organization, IDS.idempotencyAppointment)).revision).toBe(assigned.before.revision + 1);
    const divergent = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.idempotencyAppointment}/mutation-approvals`)
      .set(sessions.dispatcher.headers).set('Idempotency-Key', assigned.key)
      .send({ ...assigned.approvalBody, reason: 'Divergent reason cannot reuse the key.' });
    expect(divergent.status).toBe(409);
  });

  test('rejects stale authority, changed sessions/roles, cross-tenant and employee mutation', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.staleAuthorityAppointment);
    const before = await pins(runtimePool, IDS.organization, IDS.staleAuthorityAppointment);
    const reason = 'Exact preview must not survive an authority downgrade.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.staleAuthorityAppointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'assign', target: { kind: 'profile', id: IDS.dispatcher },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    await runtimePool.query("UPDATE public.organization_memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2",
      [IDS.organization, IDS.owner]);
    const rejected = await request(app).post(`/api/v1/canonical/appointments/${IDS.staleAuthorityAppointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-role-change-000001').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: created.body.data.warningDigests,
        acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
      });
    expect([401, 403]).toContain(rejected.status);
    await runtimePool.query("UPDATE public.organization_memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",
      [IDS.organization, IDS.owner]);
    const employee = await request(app).post(`/api/v1/canonical/appointments/${IDS.staleAuthorityAppointment}/mutation-previews`)
      .set(sessions.employee.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'assign', target: { kind: 'profile', id: IDS.dispatcher },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(employee.status).toBe(403);
    const crossTenant = await request(app).post(`/api/v1/canonical/appointments/${IDS.staleAuthorityAppointment}/mutation-previews`)
      .set(sessions.other.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'assign', target: { kind: 'profile', id: IDS.dispatcher },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(crossTenant.status).toBe(404);
    expect((await pins(runtimePool, IDS.organization, IDS.staleAuthorityAppointment)).revision).toBe(before.revision);
  });

  test('blocks legacy, direct-SQL, internal-helper, ambiguous-body and oversized bypasses', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.bypassAppointment);
    const before = await pins(runtimePool, IDS.organization, IDS.bypassAppointment);
    const legacy = await request(app).patch(`/api/v1/canonical/appointments/${IDS.bypassAppointment}`)
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
      `SELECT public.canonical_schedule_part4_hard_authority(
         $1,$2,'unassigned',NULL,NULL,NULL)`,
      [IDS.organization, before.id]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(runtimePool.query(
      `SELECT public.canonical_schedule_part4_review_authority(
         $1,$2,'unassigned',NULL,NULL,NULL,'America/New_York')`,
      [IDS.organization, before.id]
    )).rejects.toMatchObject({ code: '42501' });
    const withheldContractHelpers = (await runtimePool.query(
      `SELECT procedure.proname,
              pg_catalog.has_function_privilege(current_user,procedure.oid,'EXECUTE') AS executable
         FROM pg_catalog.pg_proc procedure
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
        WHERE namespace.nspname='public'
          AND procedure.proname=ANY($1::text[])
        ORDER BY procedure.proname`,
      [[
        'canonical_schedule_part4_reason_valid',
        'canonical_schedule_part4_normalize_digest_list',
        'canonical_schedule_part4_preview_request_digest',
        'canonical_schedule_part4_approval_request_digest',
        'canonical_schedule_part4_schedule_contract_valid',
      ]]
    )).rows;
    expect(withheldContractHelpers).toHaveLength(5);
    expect(withheldContractHelpers.every(row => row.executable === false)).toBe(true);
    await expect(runtimePool.query(
      `UPDATE public.canonical_appointments SET scheduled_start=NOW(),scheduled_end=NOW()+INTERVAL '1 hour'
        WHERE organization_id=$1 AND id=$2`, [IDS.organization, IDS.bypassAppointment]
    )).rejects.toMatchObject({ code: '42501' });
    const pathName = `/api/v1/canonical/appointments/${IDS.bypassAppointment}/mutation-previews`;
    const ambiguous = await request(app).post(pathName).set(sessions.owner.headers)
      .set('Content-Type', 'application/json').send('{"expectedRevision":1,"expectedRevision":2}');
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error.code).toBe('M22_APPROVAL_AMBIGUOUS_JSON');
    const oversized = await request(app).post(pathName).set(sessions.owner.headers)
      .set('Content-Type', 'application/json').send(' '.repeat(65537));
    expect(oversized.status).toBe(413);
    expect((await pins(runtimePool, IDS.organization, IDS.bypassAppointment)).revision).toBe(before.revision);
  });

  test('rejects crew membership divergence between preview and approval', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.crewDivergenceAppointment);
    await previewAndApproveAppointment(IDS.crewDivergenceAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Establish a dedicated current target for the crew divergence case.',
    }, 'm22-part4-crew-divergence-prerequisite');
    const before = await pins(runtimePool, IDS.organization, IDS.crewDivergenceAppointment);
    const reason = 'Crew membership must remain exact between preview and approval.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.crewDivergenceAppointment}/mutation-previews`)
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
      const stale = await request(app).post(`/api/v1/canonical/appointments/${IDS.crewDivergenceAppointment}/mutation-approvals`)
        .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-crew-membership-stale-001').send({
          previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
          acknowledgedWarningDigests: created.body.data.warningDigests,
          acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
        });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('M22_EVIDENCE_STALE');
      expect((await pins(runtimePool, IDS.organization, IDS.crewDivergenceAppointment)).revision).toBe(before.revision);
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
    await seedAppointment(runtimePool, IDS.organization, IDS.rollbackAppointment);
    await previewAndApproveAppointment(IDS.rollbackAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Establish a dedicated current target for the rollback case.',
    }, 'm22-part4-rollback-prerequisite');
    const before = await pins(runtimePool, IDS.organization, IDS.rollbackAppointment);
    const reason = 'Durable audit must commit atomically with the authorized mutation.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.rollbackAppointment}/mutation-previews`)
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
      const failed = await request(app).post(`/api/v1/canonical/appointments/${IDS.rollbackAppointment}/mutation-approvals`)
        .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-audit-rollback-0001').send({
          previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
          acknowledgedWarningDigests: created.body.data.warningDigests,
          acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
        });
      expect(failed.status).toBe(503);
      expect((await pins(runtimePool, IDS.organization, IDS.rollbackAppointment)).revision).toBe(before.revision);
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
    await seedAppointment(runtimePool, IDS.organization, IDS.concurrencyAppointment);
    await previewAndApproveAppointment(IDS.concurrencyAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Establish a dedicated current target for the concurrency case.',
    }, 'm22-part4-concurrency-prerequisite');
    const before = await pins(runtimePool, IDS.organization, IDS.concurrencyAppointment);
    const reason = 'Concurrent reassign preview requires exactly one current-authority winner.';
    const body = {
      expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
      action: 'reassign', target: { kind: 'profile', id: IDS.dispatcher },
      scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
      appointmentStatus: before.appointmentStatus, reason,
    };
    const [leftPreview, rightPreview] = await Promise.all([
      request(app).post(`/api/v1/canonical/appointments/${IDS.concurrencyAppointment}/mutation-previews`).set(sessions.owner.headers).send(body),
      request(app).post(`/api/v1/canonical/appointments/${IDS.concurrencyAppointment}/mutation-previews`).set(sessions.owner.headers).send(body),
    ]);
    expect(leftPreview.status).toBe(201);
    expect(rightPreview.status).toBe(201);
    function approval(preview, key) {
      return request(app).post(`/api/v1/canonical/appointments/${IDS.concurrencyAppointment}/mutation-approvals`)
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
    const after = await pins(runtimePool, IDS.organization, IDS.concurrencyAppointment);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.target).toEqual({ kind: 'profile', id: IDS.dispatcher });
  }, 120000);

  test('rejects conflict/recommendation divergence and subscription changes after preview', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.evidenceDivergenceAppointment);
    await previewAndApproveAppointment(IDS.evidenceDivergenceAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.dispatcher },
      reason: 'Establish a dedicated current target for the evidence divergence case.',
    }, 'm22-part4-evidence-divergence-prerequisite');
    const before = await pins(runtimePool, IDS.organization, IDS.evidenceDivergenceAppointment);
    const reason = 'Recommendation and current subscription evidence remain approval preconditions.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.evidenceDivergenceAppointment}/mutation-previews`)
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
    const staleEvidence = await request(app).post(`/api/v1/canonical/appointments/${IDS.evidenceDivergenceAppointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-recommendation-stale-01').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: created.body.data.warningDigests,
        acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
      });
    expect(staleEvidence.status).toBe(409);

    const refreshed = await request(app).post(`/api/v1/canonical/appointments/${IDS.evidenceDivergenceAppointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'reassign', target: { kind: 'profile', id: IDS.owner },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(refreshed.status).toBe(201);
    await runtimePool.query("UPDATE public.subscriptions SET status='canceled' WHERE organization_id=$1", [IDS.organization]);
    const readOnly = await request(app).post(`/api/v1/canonical/appointments/${IDS.evidenceDivergenceAppointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-subscription-stale-01').send({
        previewId: refreshed.body.data.id, previewDigest: refreshed.body.data.previewDigest,
        acknowledgedWarningDigests: refreshed.body.data.warningDigests,
        acknowledgedReviewReasonDigests: refreshed.body.data.reviewReasonDigests, reason,
      });
    expect(readOnly.status).toBe(403);
    await runtimePool.query("UPDATE public.subscriptions SET status='active' WHERE organization_id=$1", [IDS.organization]);
    expect((await pins(runtimePool, IDS.organization, IDS.evidenceDivergenceAppointment)).revision).toBe(before.revision);
  });

  test('requires exact acknowledgements and never applies a Part 2 hard conflict', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.hardConflictAppointment);
    await previewAndApproveAppointment(IDS.hardConflictAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.dispatcher },
      reason: 'Establish the dedicated hard-conflict target.',
    }, 'm22-part4-hard-conflict-assign-prerequisite');
    await previewAndApproveAppointment(IDS.hardConflictAppointment, 'schedule', {
      scheduledStart: '2027-03-15T09:00:00-04:00', scheduledEnd: '2027-03-15T10:00:00-04:00',
      reason: 'Establish the dedicated hard-conflict schedule.',
    }, 'm22-part4-hard-conflict-schedule-prerequisite');
    const unavailable = await request(app)
      .put(`/api/v1/canonical/availability/profiles/${IDS.dispatcher}`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-unavailable-hard-0001').send({
        expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'America/New_York',
        coverageStart: '2027-03-01T00:00:00-05:00', coverageEnd: '2027-04-01T00:00:00-04:00',
        intervals: [{ kind: 'unavailable', start: '2027-03-15T12:00:00-04:00', end: '2027-03-15T14:00:00-04:00' }],
        reason: 'Dispatcher declared unavailable; no human override exists.',
      });
    expect(unavailable.status).toBe(200);
    const before = await pins(runtimePool, IDS.organization, IDS.hardConflictAppointment);
    const reason = 'Hard conflict cannot be overridden by acknowledgement.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.hardConflictAppointment}/mutation-previews`)
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
      .post(`/api/v1/canonical/appointments/${IDS.hardConflictAppointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-wrong-ack-00000001').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: [], acknowledgedReviewReasonDigests: [], reason,
      });
    expect(wrongAcknowledgement.status).toBe(409);
    const exactAcknowledgement = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.hardConflictAppointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-hard-no-override-00001').send({
        previewId: created.body.data.id, previewDigest: created.body.data.previewDigest,
        acknowledgedWarningDigests: created.body.data.warningDigests,
        acknowledgedReviewReasonDigests: created.body.data.reviewReasonDigests, reason,
      });
    expect(exactAcknowledgement.status).toBe(409);
    expect(exactAcknowledgement.body.error.code).toBe('M22_HARD_CONFLICT');
    expect((await pins(runtimePool, IDS.organization, IDS.hardConflictAppointment)).revision).toBe(before.revision);
  });

  test('enforces the exact fifteen-minute boundary with a database-owner controlled clock fixture', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.boundaryAppointment);
    const before = await pins(runtimePool, IDS.organization, IDS.boundaryAppointment);
    const reason = 'A preview at the exact expiry boundary grants no mutation.';
    const created = await request(app).post(`/api/v1/canonical/appointments/${IDS.boundaryAppointment}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action: 'assign', target: { kind: 'profile', id: IDS.owner },
        scheduledStart: explicitOffset(before.scheduledStart), scheduledEnd: explicitOffset(before.scheduledEnd),
        appointmentStatus: before.appointmentStatus, reason,
      });
    expect(created.status).toBe(201);
    await migrationPool.query('ALTER TABLE public.canonical_schedule_mutation_previews DISABLE TRIGGER canonical_schedule_previews_immutable');
    try {
      await migrationPool.query(
        `WITH fixed AS (SELECT clock_timestamp() AS expires_at),
              boundary AS (
                SELECT expires_at-INTERVAL '15 minutes' AS created_at,expires_at FROM fixed
              )
         UPDATE public.canonical_schedule_mutation_previews preview SET
           created_at=boundary.created_at,expires_at=boundary.expires_at,
           preview_digest=public.canonical_schedule_part4_preview_digest(
             preview.id,preview.organization_id,preview.assignment_id,preview.appointment_id,
             preview.actor_user_id,preview.auth_session_id,preview.expected_revision,rtrim(preview.expected_digest),
             preview.expected_time_zone,preview.action_code,preview.proposed_target_kind,preview.proposed_target_id,
             preview.proposed_scheduled_start,preview.proposed_scheduled_end,preview.proposed_schedule_state,
             preview.proposed_dispatch_state,preview.proposed_appointment_status,preview.reason,
             rtrim(preview.conflict_digest),preview.warning_digests,preview.review_reason_digests,
             rtrim(preview.recommendation_digest),rtrim(preview.recommendation_authority_digest),
             rtrim(preview.request_digest),boundary.created_at,boundary.expires_at)
         FROM boundary
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
    const rejected = await request(app).post(`/api/v1/canonical/appointments/${IDS.boundaryAppointment}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-expired-boundary-0001').send({
        previewId: created.body.data.id, previewDigest: expired.digest,
        acknowledgedWarningDigests: expired.warning_digests,
        acknowledgedReviewReasonDigests: expired.review_reason_digests, reason,
      });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('M22_PREVIEW_EXPIRED');
    expect((await pins(runtimePool, IDS.organization, IDS.boundaryAppointment)).revision).toBe(before.revision);
  });

  test('matches trusted SQL hard classes for skills, location, availability, inactive crew and invalid targets', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.hardMatrixAppointment);
    await previewAndApproveAppointment(IDS.hardMatrixAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Assign only; hard schedule evidence is evaluated separately.',
    }, 'm22-part4-hard-matrix-assign-0001');
    await runtimePool.query(
      `UPDATE public.canonical_opportunities opportunity SET
         service_type='plumbing',job_scope=jsonb_build_object('locationId','headquarters')
        FROM public.canonical_appointments appointment
       WHERE appointment.organization_id=opportunity.organization_id
         AND appointment.opportunity_id=opportunity.id
         AND appointment.organization_id=$1 AND appointment.id=$2`,
      [IDS.organization, IDS.hardMatrixAppointment]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_skills(
         id,organization_id,skill_key,name,service_id,created_by_user_id,updated_by_user_id)
       VALUES ('e4100000-0000-4000-8000-000000000001',$1,'plumbing-skill','Plumbing','plumbing',$2,$2)`,
      [IDS.organization, IDS.owner]
    );
    const availability = await request(app)
      .put(`/api/v1/canonical/availability/profiles/${IDS.owner}`)
      .set(sessions.owner.headers).set('Idempotency-Key', 'm22-part4-hard-matrix-availability')
      .send({
        expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'America/New_York',
        coverageStart: '2027-03-01T00:00:00-05:00', coverageEnd: '2027-04-01T00:00:00-04:00',
        intervals: [{
          kind: 'unavailable', start: '2027-03-15T15:00:00-04:00', end: '2027-03-15T16:00:00-04:00',
        }],
        reason: 'Hard matrix declared unavailability fixture.',
      });
    expect(availability.status).toBe(200);
    await runtimePool.query(
      `UPDATE public.workforce_profiles SET home_location_id='remote'
        WHERE organization_id=$1 AND id=$2`, [IDS.organization, IDS.owner]
    );
    try {
      const hardMatrix = await previewAppointment(IDS.hardMatrixAppointment, 'schedule', {
        scheduledStart: '2027-03-15T15:00:00-04:00',
        scheduledEnd: '2027-03-15T16:00:00-04:00',
        reason: 'Trusted SQL and mounted Part 2 must agree on every hard class.',
      });
      expect(hardMatrix.response.status).toBe(201);
      expect(hardMatrix.response.body.data.conflicts.hardConflicts.map(entry => entry.code)).toEqual([
        'declared_unavailable', 'location_scope_mismatch', 'required_skill_mismatch',
      ]);
    } finally {
      await runtimePool.query(
        `UPDATE public.workforce_profiles SET home_location_id=NULL
          WHERE organization_id=$1 AND id=$2`, [IDS.organization, IDS.owner]
      );
    }

    await seedAppointment(runtimePool, IDS.organization, IDS.crewHardAppointment);
    await previewAndApproveAppointment(IDS.crewHardAppointment, 'assign', {
      target: { kind: 'crew', id: IDS.crew },
      reason: 'Crew assignment precedes the inactive-member schedule gate.',
    }, 'm22-part4-inactive-crew-assign-01');
    await runtimePool.query(
      `UPDATE public.organization_memberships SET status='suspended',updated_at=clock_timestamp()
        WHERE organization_id=$1 AND user_id=$2`, [IDS.organization, IDS.dispatcher]
    );
    try {
      const inactiveCrew = await previewAppointment(IDS.crewHardAppointment, 'schedule', {
        scheduledStart: '2027-03-15T18:00:00-04:00',
        scheduledEnd: '2027-03-15T19:00:00-04:00',
        reason: 'Inactive crew members are a trusted hard conflict.',
      });
      expect(inactiveCrew.response.status).toBe(201);
      expect(inactiveCrew.response.body.data.conflicts.hardConflicts).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'inactive_crew_member', profileId: IDS.dispatcher }),
      ]));
    } finally {
      await runtimePool.query(
        `UPDATE public.organization_memberships SET status='active',updated_at=clock_timestamp()
          WHERE organization_id=$1 AND user_id=$2`, [IDS.organization, IDS.dispatcher]
      );
    }

    await seedAppointment(runtimePool, IDS.organization, IDS.invalidTargetAppointment);
    const invalidBefore = await pins(runtimePool, IDS.organization, IDS.invalidTargetAppointment);
    await runtimePool.query(
      `UPDATE public.organization_memberships SET status='suspended',updated_at=clock_timestamp()
        WHERE organization_id=$1 AND user_id=$2`, [IDS.organization, IDS.employee]
    );
    try {
      const inactiveTarget = await previewAppointment(IDS.invalidTargetAppointment, 'assign', {
        target: { kind: 'profile', id: IDS.employee },
        reason: 'Inactive direct targets cannot enter the approval lane.',
      });
      expect(inactiveTarget.response.status).toBe(409);
      expect(inactiveTarget.response.body.error.code).toBe('M22_INVALID_TRANSITION');
    } finally {
      await runtimePool.query(
        `UPDATE public.organization_memberships SET status='active',updated_at=clock_timestamp()
          WHERE organization_id=$1 AND user_id=$2`, [IDS.organization, IDS.employee]
      );
    }
    const unavailableTarget = await previewAppointment(IDS.invalidTargetAppointment, 'assign', {
      target: { kind: 'profile', id: 'e2100000-0000-4000-8000-000000000099' },
      reason: 'Unavailable direct targets cannot enter the approval lane.',
    });
    expect(unavailableTarget.response.status).toBe(409);
    expect(unavailableTarget.response.body.error.code).toBe('M22_INVALID_TRANSITION');
    expect(await pins(runtimePool, IDS.organization, IDS.invalidTargetAppointment)).toEqual(invalidBefore);
  }, 120000);

  test('rejects the exact ordinary-runtime forged clear evidence against an approved overlap', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.overlapAppointment);
    await seedAppointment(runtimePool, IDS.organization, IDS.conflictAppointment);
    await previewAndApproveAppointment(IDS.overlapAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Owner accepts the exact overlap fixture assignment.',
    }, 'm22-part4-overlap-fixture-assign-001');
    await previewAndApproveAppointment(IDS.overlapAppointment, 'schedule', {
      scheduledStart: '2027-03-15T09:00:00-04:00',
      scheduledEnd: '2027-03-15T10:00:00-04:00',
      reason: 'Owner accepts the exact overlap fixture schedule.',
    }, 'm22-part4-overlap-fixture-schedule-01');
    await previewAndApproveAppointment(IDS.conflictAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Owner accepts the conflict fixture assignment only.',
    }, 'm22-part4-conflict-fixture-assign-01');

    const authoritative = await previewAppointment(IDS.conflictAppointment, 'schedule', {
      scheduledStart: '2027-03-15T09:00:00-04:00',
      scheduledEnd: '2027-03-15T10:00:00-04:00',
      reason: 'The trusted preview must expose the approved schedule overlap.',
    });
    expect(authoritative.response.status).toBe(201);
    expect(authoritative.response.body.data.conflicts.hardConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'approved_schedule_overlap' }),
    ]));

    const before = await pins(runtimePool, IDS.organization, IDS.conflictAppointment);
    const forged = '0'.repeat(64);
    const reason = 'Direct runtime forged clear evidence cannot become authority.';
    const forgedConflict = {
      id: forged, assignmentId: before.id, appointmentId: IDS.conflictAppointment,
      evaluationVersion: 'forged-runtime-evidence', assignmentRevision: before.revision,
      assignmentDigest: before.digest, status: 'clear', hardConflicts: [], warnings: [],
      needsReview: false, reviewReasons: [], digest: forged, persisted: false, grantsMutation: false,
    };
    const canonicalRequestDigest = normalizeMutationPreview({
      organizationId: IDS.organization, actorUserId: IDS.owner,
      authSessionId: sessions.owner.sessionId, appointmentId: IDS.conflictAppointment,
      body: {
        expectedRevision: before.revision, expectedDigest: before.digest,
        expectedTimeZone: 'America/New_York', action: 'schedule',
        target: { kind: 'profile', id: IDS.owner },
        scheduledStart: '2027-03-15T09:00:00-04:00',
        scheduledEnd: '2027-03-15T10:00:00-04:00',
        appointmentStatus: 'preferred', reason,
      },
    }).requestDigest;
    const evidenceBefore = (await migrationPool.query(
      `SELECT (SELECT count(*) FROM public.canonical_schedule_mutation_previews
                WHERE organization_id=$1 AND assignment_id=$2)::int AS previews,
              (SELECT count(*) FROM public.canonical_schedule_human_approvals
                WHERE organization_id=$1 AND assignment_id=$2)::int AS approvals,
              (SELECT count(*) FROM public.canonical_schedule_human_audit_events
                WHERE organization_id=$1 AND assignment_id=$2)::int AS audits,
              (SELECT count(*) FROM public.canonical_schedule_human_idempotency
                WHERE organization_id=$1 AND assignment_id=$2)::int AS replays`,
      [IDS.organization, before.id]
    )).rows[0];
    const canonicalized = (await runtimePool.query(
      `SELECT public.canonical_schedule_create_mutation_preview(
         $1::uuid,$2::uuid,$3::uuid,'owner',$4::uuid,$5::text,$6::bigint,$7::text,
         'America/New_York','schedule','profile',$3::uuid,
         '2027-03-15T13:00:00.000Z'::timestamptz,'2027-03-15T14:00:00.000Z'::timestamptz,
         '{"scheduledStart":"2027-03-15T09:00:00-04:00","scheduledEnd":"2027-03-15T10:00:00-04:00"}'::jsonb,
         'preferred',$8::text,$9::jsonb,$10::text,'[]'::jsonb,'[]'::jsonb,$10::text,$10::text,$11::text)`,
      [IDS.organization, IDS.conflictAppointment, IDS.owner, sessions.owner.sessionId,
        sessions.owner.csrfToken, before.revision, before.digest, reason,
        JSON.stringify(forgedConflict), forged, canonicalRequestDigest]
    )).rows[0].canonical_schedule_create_mutation_preview.data;
    expect(canonicalized.conflicts.hardConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'approved_schedule_overlap' }),
    ]));
    expect(canonicalized.conflicts.digest).not.toBe(forged);
    const canonicalEvidence = (await runtimePool.query(
      `SELECT rtrim(preview_digest) AS preview_digest,warning_digests,review_reason_digests,reason,
              rtrim(conflict_digest) AS conflict_digest,
              rtrim(recommendation_authority_digest) AS recommendation_authority_digest
         FROM public.canonical_schedule_mutation_previews WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, canonicalized.id]
    )).rows[0];
    await expect(directApproval(runtimePool, IDS.conflictAppointment, canonicalized.id,
      canonicalEvidence, 'forged-overlap-canonical-hard')).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_schedule_part4_hard_conflict',
    });
    expect(await pins(runtimePool, IDS.organization, IDS.conflictAppointment)).toEqual(before);
    const evidenceAfter = (await migrationPool.query(
      `SELECT (SELECT count(*) FROM public.canonical_schedule_mutation_previews
                WHERE organization_id=$1 AND assignment_id=$2)::int AS previews,
              (SELECT count(*) FROM public.canonical_schedule_human_approvals
                WHERE organization_id=$1 AND assignment_id=$2)::int AS approvals,
              (SELECT count(*) FROM public.canonical_schedule_human_audit_events
                WHERE organization_id=$1 AND assignment_id=$2)::int AS audits,
              (SELECT count(*) FROM public.canonical_schedule_human_idempotency
                WHERE organization_id=$1 AND assignment_id=$2)::int AS replays`,
      [IDS.organization, before.id]
    )).rows[0];
    expect(evidenceAfter).toEqual({ ...evidenceBefore, previews: evidenceBefore.previews + 1 });
  }, 120000);

  test('canonicalizes ordinary-runtime forged false-clear review evidence before any durable mutation', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.reviewEvidenceAppointment);
    const before = await pins(runtimePool, IDS.organization, IDS.reviewEvidenceAppointment);
    const forged = '0'.repeat(64);
    const reason = 'Direct runtime false-clear review assertions cannot become immutable authority.';
    const forgedConflict = {
      id: forged, assignmentId: before.id, appointmentId: IDS.reviewEvidenceAppointment,
      evaluationVersion: 'forged-runtime-evidence', assignmentRevision: before.revision,
      assignmentDigest: before.digest, status: 'clear', hardConflicts: [], warnings: [],
      needsReview: false, reviewReasons: [], digest: forged, persisted: false, grantsMutation: false,
    };
    const canonicalRequestDigest = normalizeMutationPreview({
      organizationId: IDS.organization, actorUserId: IDS.owner,
      authSessionId: sessions.owner.sessionId, appointmentId: IDS.reviewEvidenceAppointment,
      body: {
        expectedRevision: before.revision, expectedDigest: before.digest,
        expectedTimeZone: 'America/New_York', action: 'assign',
        target: { kind: 'profile', id: IDS.owner }, scheduledStart: null, scheduledEnd: null,
        appointmentStatus: 'preferred', reason,
      },
    }).requestDigest;
    const created = (await runtimePool.query(
      `SELECT public.canonical_schedule_create_mutation_preview(
         $1::uuid,$2::uuid,$3::uuid,'owner',$4::uuid,$5::text,$6::bigint,$7::text,
         'America/New_York','assign','profile',$3::uuid,NULL,NULL,
         '{"scheduledStart":null,"scheduledEnd":null}'::jsonb,
         'preferred',$8::text,$9::jsonb,$10::text,'[]'::jsonb,'[]'::jsonb,
         $10::text,$10::text,$11::text) AS response`,
      [IDS.organization, IDS.reviewEvidenceAppointment, IDS.owner, sessions.owner.sessionId,
        sessions.owner.csrfToken, before.revision, before.digest, reason,
        JSON.stringify(forgedConflict), forged, canonicalRequestDigest]
    )).rows[0].response.data;
    expect(created.conflicts).toMatchObject({
      status: 'needs_review', hardConflicts: [], warnings: [], needsReview: true,
      reviewReasons: [{ code: 'appointment_schedule_unavailable' }],
    });
    expect(created.conflicts.digest).not.toBe(forged);
    expect(created.reviewReasonDigests).toHaveLength(1);
    const evidence = (await runtimePool.query(
      `SELECT rtrim(preview_digest) AS preview_digest,warning_digests,review_reason_digests,reason,
              rtrim(conflict_digest) AS conflict_digest,
              rtrim(recommendation_authority_digest) AS recommendation_authority_digest
         FROM public.canonical_schedule_mutation_previews WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, created.id]
    )).rows[0];
    const applied = await directApproval(runtimePool, IDS.reviewEvidenceAppointment, created.id,
      evidence, 'forged-false-clear-canonicalized');
    expect(applied.rows[0].response.data.scheduleAuthority).toMatchObject({
      revision: before.revision + 1, needsReview: true,
      reviewReasons: [{ code: 'appointment_schedule_unavailable' }],
    });
    expect((await migrationPool.query(
      `SELECT approval.resulting_needs_review,approval.resulting_review_reasons,
              (SELECT count(*)::int FROM public.canonical_schedule_human_audit_events audit
                WHERE audit.organization_id=approval.organization_id AND audit.human_approval_id=approval.id) AS audits,
              (SELECT count(*)::int FROM public.canonical_schedule_human_idempotency replay
                WHERE replay.organization_id=approval.organization_id AND replay.human_approval_id=approval.id) AS replays
         FROM public.canonical_schedule_human_approvals approval
        WHERE approval.organization_id=$1 AND approval.preview_id=$2`,
      [IDS.organization, created.id]
    )).rows).toEqual([{
      resulting_needs_review: true,
      resulting_review_reasons: [{ code: 'appointment_schedule_unavailable' }],
      audits: 1, replays: 1,
    }]);
  }, 120000);

  test('enforces SQL/public input parity and database-owned request-digest provenance', async () => {
    await seedAppointment(runtimePool, IDS.organization, IDS.sqlContractAppointment);
    await seedAppointment(runtimePool, IDS.organization, IDS.digestProvenanceAppointment);
    const contractBefore = await pins(runtimePool, IDS.organization, IDS.sqlContractAppointment);
    const contractPath = `/api/v1/canonical/appointments/${IDS.sqlContractAppointment}/mutation-previews`;
    const longHttp = await request(app).post(contractPath).set(sessions.owner.headers).send({
      expectedRevision: contractBefore.revision, expectedDigest: contractBefore.digest,
      expectedTimeZone: 'America/New_York', action: 'schedule', target: contractBefore.target,
      scheduledStart: '2027-04-01T09:00:00-04:00',
      scheduledEnd: '2027-05-03T09:00:00-04:00', appointmentStatus: 'preferred',
      reason: 'The public and SQL duration boundaries must agree.',
    });
    expect(longHttp.status).toBe(400);
    expect(longHttp.body.error.code).toBe('INVALID_APPROVAL_SCHEDULE');
    const controlHttp = await request(app).post(contractPath).set(sessions.owner.headers).send({
      expectedRevision: contractBefore.revision, expectedDigest: contractBefore.digest,
      expectedTimeZone: 'America/New_York', action: 'assign',
      target: { kind: 'profile', id: IDS.owner }, scheduledStart: null, scheduledEnd: null,
      appointmentStatus: 'preferred', reason: `public${String.fromCharCode(1)}control`,
    });
    expect(controlHttp.status).toBe(400);
    expect(controlHttp.body.error.code).toBe('INVALID_APPROVAL_REASON');

    const evidenceCounts = async appointmentId => (await migrationPool.query(
      `SELECT assignment.revision::int,
              (SELECT count(*)::int FROM public.canonical_schedule_mutation_previews preview
                WHERE preview.organization_id=assignment.organization_id
                  AND preview.assignment_id=assignment.id) AS previews,
              (SELECT count(*)::int FROM public.canonical_schedule_human_approvals approval
                WHERE approval.organization_id=assignment.organization_id
                  AND approval.assignment_id=assignment.id) AS approvals,
              (SELECT count(*)::int FROM public.canonical_schedule_human_audit_events audit
                WHERE audit.organization_id=assignment.organization_id
                  AND audit.assignment_id=assignment.id) AS audits,
              (SELECT count(*)::int FROM public.canonical_schedule_human_idempotency replay
                WHERE replay.organization_id=assignment.organization_id
                  AND replay.assignment_id=assignment.id) AS replays
         FROM public.canonical_schedule_assignments assignment
        WHERE assignment.organization_id=$1 AND assignment.appointment_id=$2`,
      [IDS.organization, appointmentId]
    )).rows[0];
    const invalidBefore = await evidenceCounts(IDS.sqlContractAppointment);
    const invalidBodies = [
      previewContractInput(IDS.sqlContractAppointment, contractBefore, {
        action: 'schedule', target: contractBefore.target,
        scheduledStart: '2027-04-01T09:00:00-04:00', scheduledEnd: '2027-05-03T09:00:00-04:00',
        reason: 'Direct SQL must reject thirty-two days.',
      }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, {
        action: 'schedule', target: contractBefore.target,
        scheduledStart: '2027-04-01T09:00:00-04:00', scheduledEnd: '2027-05-02T09:00:00.001-04:00',
        reason: 'Direct SQL must reject thirty-one days plus one millisecond.',
      }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, { action: 'invalid_action' }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, { appointmentStatus: 'pending' }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, {
        scheduledStart: '2027-04-01T09:00:00-04:00', scheduledEnd: null,
      }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, { reason: `\u00a0leading whitespace` }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, { reason: `trailing whitespace\ufeff` }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, { reason: 'x'.repeat(1001) }),
      ...[1,2,8,11,12,14,31,127].map(code => previewContractInput(
        IDS.sqlContractAppointment, contractBefore,
        { reason: `direct${String.fromCharCode(code)}control` }
      )),
    ];
    for (const invalid of invalidBodies) {
      let rejection;
      try {
        await directPreview(runtimePool, invalid, 'c'.repeat(64));
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBeDefined();
      expect(['23514', '40001']).toContain(rejection.code);
      expect([
        'canonical_schedule_part4_transition_invalid',
        'canonical_schedule_part4_preview_stale',
      ]).toContain(rejection.constraint);
    }
    expect(await evidenceCounts(IDS.sqlContractAppointment)).toEqual(invalidBefore);

    const validBodies = [
      previewContractInput(IDS.sqlContractAppointment, contractBefore, {
        action: 'schedule', target: contractBefore.target,
        scheduledStart: '2027-04-01T09:00:00-04:00', scheduledEnd: '2027-05-02T09:00:00-04:00',
        reason: 'Exact 31-day boundary with printable hostile Unicode <script>🔥 café Ω.',
      }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, {
        reason: 'Interior\ttab\nline\rcarriage return remains legitimate.',
      }),
      previewContractInput(IDS.sqlContractAppointment, contractBefore, { reason: '😀'.repeat(1000) }),
    ];
    const validPreviews = [];
    for (const valid of validBodies) {
      const normalized = normalizeMutationPreview(valid);
      validPreviews.push((await directPreview(runtimePool, valid, normalized.requestDigest)).rows[0].response.data);
    }
    expect(validPreviews).toHaveLength(3);

    await migrationPool.query(
      'ALTER TABLE public.canonical_schedule_mutation_previews DISABLE TRIGGER canonical_schedule_previews_immutable'
    );
    try {
      await expect(migrationPool.query(
        `UPDATE public.canonical_schedule_mutation_previews preview SET
           reason=$3,
           request_digest=public.canonical_schedule_part4_preview_request_digest(
             preview.organization_id,preview.appointment_id,preview.actor_user_id,preview.auth_session_id,
             preview.expected_revision,rtrim(preview.expected_digest),preview.expected_time_zone,
             preview.action_code,preview.proposed_target_kind,preview.proposed_target_id,
             preview.proposed_scheduled_start,preview.proposed_scheduled_end,preview.submitted_schedule,
             preview.proposed_appointment_status,$3)
         WHERE preview.organization_id=$1 AND preview.id=$2`,
        [IDS.organization, validPreviews[0].id, `durable${String.fromCharCode(1)}control`]
      )).rejects.toMatchObject({ code: '23514' });
      await expect(migrationPool.query(
        `UPDATE public.canonical_schedule_mutation_previews preview SET
           proposed_scheduled_end='2027-05-03T13:00:00Z',
           submitted_schedule='{"scheduledStart":"2027-04-01T09:00:00-04:00","scheduledEnd":"2027-05-03T09:00:00-04:00"}'::jsonb,
           request_digest=public.canonical_schedule_part4_preview_request_digest(
             preview.organization_id,preview.appointment_id,preview.actor_user_id,preview.auth_session_id,
             preview.expected_revision,rtrim(preview.expected_digest),preview.expected_time_zone,
             preview.action_code,preview.proposed_target_kind,preview.proposed_target_id,
             preview.proposed_scheduled_start,'2027-05-03T13:00:00Z',
             '{"scheduledStart":"2027-04-01T09:00:00-04:00","scheduledEnd":"2027-05-03T09:00:00-04:00"}'::jsonb,
             preview.proposed_appointment_status,preview.reason)
         WHERE preview.organization_id=$1 AND preview.id=$2`,
        [IDS.organization, validPreviews[0].id]
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await migrationPool.query(
        'ALTER TABLE public.canonical_schedule_mutation_previews ENABLE TRIGGER canonical_schedule_previews_immutable'
      );
    }

    const digestCases = [
      { action: 'assign', target: { kind: 'profile', id: IDS.owner.toUpperCase() }, scheduledStart: null, scheduledEnd: null },
      { action: 'reassign', target: { kind: 'crew', id: IDS.crew }, scheduledStart: '2027-04-15T09:00:00-04:00', scheduledEnd: '2027-04-15T10:00:00-04:00' },
      { action: 'unassign', target: { kind: 'unassigned', id: null }, scheduledStart: null, scheduledEnd: null },
      { action: 'schedule', target: { kind: 'unassigned', id: null }, scheduledStart: '2027-04-15T09:00:00.125-04:00', scheduledEnd: '2027-04-15T10:00:00.250-04:00' },
      { action: 'reschedule', target: { kind: 'profile', id: IDS.dispatcher }, scheduledStart: '2027-04-15T11:00:00-04:00', scheduledEnd: '2027-04-15T12:00:00-04:00' },
      { action: 'dispatch', target: { kind: 'crew', id: IDS.crew }, scheduledStart: '2027-04-15T11:00:00-04:00', scheduledEnd: '2027-04-15T12:00:00-04:00' },
    ];
    for (const [index, candidate] of digestCases.entries()) {
      const raw = previewContractInput(IDS.digestProvenanceAppointment.toUpperCase(), {
        revision: 7, digest: 'a'.repeat(64), scheduledStart: null, scheduledEnd: null,
        appointmentStatus: 'preferred', target: { kind: 'unassigned', id: null },
      }, {
        ...candidate, reason: `Digest parity ${index} printable Unicode Ω🔥.`,
      });
      const normalized = normalizeMutationPreview(raw);
      const sqlDigest = (await migrationPool.query(
        `SELECT public.canonical_schedule_part4_preview_request_digest(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::text,$7::text,$8::text,
           $9::text,$10::uuid,$11::timestamptz,$12::timestamptz,$13::jsonb,$14::text,$15::text) AS digest`,
        [IDS.organization, normalized.appointmentId, IDS.owner, sessions.owner.sessionId,
          normalized.expectedRevision, normalized.expectedDigest, normalized.expectedTimeZone,
          normalized.action, normalized.target.kind, normalized.target.id, normalized.scheduledStart,
          normalized.scheduledEnd, JSON.stringify({
            scheduledStart: normalized.rawScheduledStart, scheduledEnd: normalized.rawScheduledEnd,
          }), normalized.appointmentStatus, normalized.reason]
      )).rows[0].digest;
      expect(sqlDigest).toBe(normalized.requestDigest);
    }

    const parityWarnings = ['b'.repeat(64), 'a'.repeat(64)];
    const parityReviews = ['d'.repeat(64), 'c'.repeat(64)];
    const parityApproval = normalizeMutationApproval({
      organizationId: IDS.organization.toUpperCase(), actorUserId: IDS.owner,
      authSessionId: sessions.owner.sessionId, appointmentId: IDS.digestProvenanceAppointment.toUpperCase(),
      idempotencyKey: 'm22-sql-js-parity-000001',
      body: {
        previewId: 'e6100000-0000-4000-8000-000000000001'.toUpperCase(),
        previewDigest: 'e'.repeat(64), acknowledgedWarningDigests: parityWarnings,
        acknowledgedReviewReasonDigests: parityReviews,
        reason: 'Approval digest canonical order Ω🔥.',
      },
    });
    const parityRows = (await migrationPool.query(
      `SELECT public.canonical_schedule_part4_normalize_digest_list($1::jsonb) AS warnings,
              public.canonical_schedule_part4_normalize_digest_list($2::jsonb) AS reviews`,
      [JSON.stringify(parityWarnings), JSON.stringify(parityReviews)]
    )).rows[0];
    const sqlApprovalDigest = (await migrationPool.query(
      `SELECT public.canonical_schedule_part4_approval_request_digest(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::jsonb,$8::jsonb,
         $9::text,$10::text) AS digest`,
      [IDS.organization, parityApproval.appointmentId, IDS.owner, sessions.owner.sessionId,
        parityApproval.previewId, parityApproval.previewDigest, JSON.stringify(parityRows.warnings),
        JSON.stringify(parityRows.reviews), parityApproval.reason, parityApproval.idempotencyKeyHash]
    )).rows[0].digest;
    expect(sqlApprovalDigest).toBe(parityApproval.requestDigest);

    const digestBefore = await pins(runtimePool, IDS.organization, IDS.digestProvenanceAppointment);
    const digestInput = previewContractInput(IDS.digestProvenanceAppointment, digestBefore, {
      reason: 'Database-owned exact request digest provenance Ω.',
    });
    const normalizedDigestPreview = normalizeMutationPreview(digestInput);
    const digestEvidenceBefore = await evidenceCounts(IDS.digestProvenanceAppointment);
    await expect(directPreview(runtimePool, digestInput, 'c'.repeat(64))).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_schedule_part4_request_digest_divergent',
    });
    expect(await evidenceCounts(IDS.digestProvenanceAppointment)).toEqual(digestEvidenceBefore);
    const digestPreview = (await directPreview(
      runtimePool, digestInput, normalizedDigestPreview.requestDigest
    )).rows[0].response.data;
    const digestEvidence = (await runtimePool.query(
      `SELECT rtrim(preview_digest) AS preview_digest,warning_digests,review_reason_digests,reason,
              rtrim(conflict_digest) AS conflict_digest,
              rtrim(recommendation_authority_digest) AS recommendation_authority_digest,
              rtrim(request_digest) AS request_digest
         FROM public.canonical_schedule_mutation_previews WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, digestPreview.id]
    )).rows[0];
    expect(digestEvidence.request_digest).toBe(normalizedDigestPreview.requestDigest);
    const digestKey = 'm22-database-digest-provenance-0001';
    const normalizedDigestApproval = normalizeMutationApproval({
      organizationId: IDS.organization, actorUserId: IDS.owner,
      authSessionId: sessions.owner.sessionId, appointmentId: IDS.digestProvenanceAppointment,
      idempotencyKey: digestKey,
      body: {
        previewId: digestPreview.id, previewDigest: digestEvidence.preview_digest,
        acknowledgedWarningDigests: digestEvidence.warning_digests,
        acknowledgedReviewReasonDigests: digestEvidence.review_reason_digests,
        reason: digestEvidence.reason,
      },
    });
    const applyDigest = requestDigest => runtimePool.query(
      `SELECT public.canonical_schedule_apply_mutation_approval(
         $1::uuid,$2::uuid,$3::uuid,'owner',$4::uuid,$5::text,$6::uuid,$7::text,
         $8::jsonb,$9::jsonb,$10::text,$11::text,$12::text,$13::text,$14::text) AS response`,
      [IDS.organization, IDS.digestProvenanceAppointment, IDS.owner, sessions.owner.sessionId,
        sessions.owner.csrfToken, digestPreview.id, digestEvidence.preview_digest,
        JSON.stringify(digestEvidence.warning_digests), JSON.stringify(digestEvidence.review_reason_digests),
        digestEvidence.reason, digestEvidence.conflict_digest,
        digestEvidence.recommendation_authority_digest, normalizedDigestApproval.idempotencyKeyHash,
        requestDigest]
    );
    await expect(applyDigest('d'.repeat(64))).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_schedule_part4_request_digest_divergent',
    });
    expect(await evidenceCounts(IDS.digestProvenanceAppointment)).toEqual({
      ...digestEvidenceBefore, previews: digestEvidenceBefore.previews + 1,
    });
    const applied = await applyDigest(normalizedDigestApproval.requestDigest);
    expect(applied.rows[0].response.data.humanApproval.requestDigest).toBe(normalizedDigestApproval.requestDigest);
    const ledger = (await migrationPool.query(
      `SELECT rtrim(approval.request_digest) AS approval_digest,
              rtrim(revision.request_digest) AS revision_digest,
              rtrim(replay.request_digest) AS replay_digest
         FROM public.canonical_schedule_human_approvals approval
         JOIN public.canonical_schedule_assignment_revisions revision
           ON revision.organization_id=approval.organization_id AND revision.human_approval_id=approval.id
         JOIN public.canonical_schedule_human_idempotency replay
           ON replay.organization_id=approval.organization_id AND replay.human_approval_id=approval.id
        WHERE approval.organization_id=$1 AND approval.preview_id=$2`,
      [IDS.organization, digestPreview.id]
    )).rows[0];
    expect(ledger).toEqual({
      approval_digest: normalizedDigestApproval.requestDigest,
      revision_digest: normalizedDigestApproval.requestDigest,
      replay_digest: normalizedDigestApproval.requestDigest,
    });
    const replayed = await applyDigest(normalizedDigestApproval.requestDigest);
    expect(replayed.rows[0].response).toEqual(applied.rows[0].response);
    const divergentReason = 'Different valid request using the same idempotency key.';
    const divergentApproval = normalizeMutationApproval({
      organizationId: IDS.organization, actorUserId: IDS.owner,
      authSessionId: sessions.owner.sessionId, appointmentId: IDS.digestProvenanceAppointment,
      idempotencyKey: digestKey,
      body: {
        previewId: digestPreview.id, previewDigest: digestEvidence.preview_digest,
        acknowledgedWarningDigests: digestEvidence.warning_digests,
        acknowledgedReviewReasonDigests: digestEvidence.review_reason_digests,
        reason: divergentReason,
      },
    });
    await expect(runtimePool.query(
      `SELECT public.canonical_schedule_apply_mutation_approval(
         $1::uuid,$2::uuid,$3::uuid,'owner',$4::uuid,$5::text,$6::uuid,$7::text,
         $8::jsonb,$9::jsonb,$10::text,$11::text,$12::text,$13::text,$14::text)`,
      [IDS.organization, IDS.digestProvenanceAppointment, IDS.owner, sessions.owner.sessionId,
        sessions.owner.csrfToken, digestPreview.id, digestEvidence.preview_digest,
        JSON.stringify(digestEvidence.warning_digests), JSON.stringify(digestEvidence.review_reason_digests),
        divergentReason, digestEvidence.conflict_digest,digestEvidence.recommendation_authority_digest,
        divergentApproval.idempotencyKeyHash, divergentApproval.requestDigest]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_schedule_part4_idempotency_divergent',
    });
    expect((await pins(runtimePool, IDS.organization, IDS.digestProvenanceAppointment)).revision)
      .toBe(digestBefore.revision + 1);
  }, 180000);

  test('uses live wall time after held-transaction and lock waits with zero mutation evidence', async () => {
    async function assertNoAppliedEvidence(appointmentId, before) {
      expect(await pins(runtimePool, IDS.organization, appointmentId)).toEqual(before);
      expect((await migrationPool.query(
        `SELECT (SELECT count(*) FROM public.canonical_schedule_human_approvals
                  WHERE organization_id=$1 AND assignment_id=$2)::int AS approvals,
                (SELECT count(*) FROM public.canonical_schedule_human_audit_events
                  WHERE organization_id=$1 AND assignment_id=$2)::int AS audits,
                (SELECT count(*) FROM public.canonical_schedule_human_idempotency
                  WHERE organization_id=$1 AND assignment_id=$2)::int AS replays`,
        [IDS.organization, before.id]
      )).rows[0]).toEqual({ approvals: 0, audits: 0, replays: 0 });
    }

    await seedAppointment(runtimePool, IDS.organization, IDS.expiryAppointment);
    const heldCreated = await previewAppointment(IDS.expiryAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Held transaction must not freeze preview lifetime.',
    });
    expect(heldCreated.response.status).toBe(201);
    const heldEvidence = await movePreviewExpiry(heldCreated.response.body.data.id, '1 second');
    const heldBefore = await pins(runtimePool, IDS.organization, IDS.expiryAppointment);
    const held = await runtimePool.connect();
    try {
      await held.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      const started = (await held.query(
        'SELECT transaction_timestamp() AS transaction_started,clock_timestamp() AS wall_started'
      )).rows[0];
      await held.query('SELECT pg_sleep(2)');
      const afterWait = (await held.query('SELECT clock_timestamp() AS wall_after_wait')).rows[0];
      expect(new Date(started.transaction_started).getTime()).toBeLessThan(new Date(heldEvidence.expires_at).getTime());
      expect(new Date(afterWait.wall_after_wait).getTime()).toBeGreaterThanOrEqual(new Date(heldEvidence.expires_at).getTime());
      await expect(directApproval(held, IDS.expiryAppointment, heldCreated.response.body.data.id,
        heldEvidence, 'held-expiry')).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_schedule_part4_preview_expired',
      });
    } finally {
      await held.query('ROLLBACK').catch(() => {});
      held.release();
    }
    await assertNoAppliedEvidence(IDS.expiryAppointment, heldBefore);

    await seedAppointment(runtimePool, IDS.organization, IDS.lockWaitAppointment);
    const lockCreated = await previewAppointment(IDS.lockWaitAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Lock waits must not freeze preview lifetime.',
    });
    expect(lockCreated.response.status).toBe(201);
    const lockEvidence = await movePreviewExpiry(lockCreated.response.body.data.id, '1 second');
    const lockBefore = await pins(runtimePool, IDS.organization, IDS.lockWaitAppointment);
    const blocker = await runtimePool.connect();
    const waiter = await runtimePool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE', [IDS.organization]);
      await waiter.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      const pending = directApproval(waiter, IDS.lockWaitAppointment, lockCreated.response.body.data.id,
        lockEvidence, 'lock-wait-expiry');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await blocker.query('COMMIT');
      await expect(pending).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_schedule_part4_preview_expired',
      });
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      await waiter.query('ROLLBACK').catch(() => {});
      blocker.release();
      waiter.release();
    }
    expect(new Date()).toEqual(expect.any(Date));
    expect(new Date(lockEvidence.expires_at).getTime()).toBeLessThanOrEqual(Date.now());
    await assertNoAppliedEvidence(IDS.lockWaitAppointment, lockBefore);
  }, 120000);

  test('Part 5 canonical overview paginates bounded rows with complete counts and stable current authority', async () => {
    const created = [];
    for (let offset = 0; offset < 101; offset += 5) {
      const batch = Array.from({ length: Math.min(5, 101 - offset) }, async (_value, batchOffset) => {
        const ordinal = offset + batchOffset;
        const response = await request(app)
          .post('/api/v1/simulations/leads')
          .set(sessions.owner.headers)
          .set('Idempotency-Key', `m22-part5-pagination-${String(ordinal).padStart(3, '0')}`)
          .send({
            name: `Part 5 pagination ${String(ordinal).padStart(3, '0')}`,
            service: 'plumbing',
            phone: `+1555${String(ordinal).padStart(7, '0')}`,
          });
        expect(response.status).toBe(201);
        return response.body.ids;
      });
      created.push(...await Promise.all(batch));
    }
    expect(created[0]).toEqual(expect.objectContaining({ appointment: expect.any(String) }));
    const sourceUpdate = await runtimePool.query(
      `UPDATE public.canonical_transcripts SET source='manual'
        WHERE organization_id=$1 AND EXISTS (
          SELECT 1 FROM public.canonical_appointments appointment
           WHERE appointment.organization_id=canonical_transcripts.organization_id
             AND appointment.operation_id=canonical_transcripts.operation_id
             AND appointment.id=ANY($2::uuid[])
        )`,
      [IDS.organization, created.map(value => value.appointment)]
    );
    expect(sourceUpdate.rowCount).toBe(101);

    const empty = await request(app).get('/api/v1/command-center/workspace')
      .set(sessions.other.headers).expect(200);
    expect(empty.body.data.schedulingOverview).toMatchObject({ total: 0, shown: 0, truncated: false });

    const first = await request(app).get('/api/v1/command-center/workspace')
      .set(sessions.owner.headers).expect(200);
    const firstOverview = first.body.data.schedulingOverview;
    expect(first.body.data.graphs).toHaveLength(100);
    expect(firstOverview).toMatchObject({
      total: 101, shown: 100, truncated: true,
      counts: expect.objectContaining({ unassigned: 101 }),
      page: expect.objectContaining({
        size: 100, shown: 100, total: 101, hasPrevious: false, hasNext: true,
        cursor: null, nextCursor: expect.any(String),
      }),
    });
    expect(firstOverview.categories.unassigned).toHaveLength(101);
    const firstIds = new Set(firstOverview.records.map(value => value.appointmentId));
    expect(firstIds.size).toBe(100);

    const decodedCursor = JSON.parse(Buffer.from(firstOverview.page.nextCursor, 'base64url').toString('utf8'));
    const encodeCursor = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const malformedCursors = [
      '',
      firstOverview.page.nextCursor + '!!!',
      firstOverview.page.nextCursor + '=',
      'A'.repeat(513),
      Buffer.from('{', 'utf8').toString('base64url'),
      encodeCursor([decodedCursor.createdAt, decodedCursor.operationId]),
      encodeCursor({ ...decodedCursor, tenantId: IDS.otherOrganization }),
      encodeCursor({ operationId: decodedCursor.operationId, createdAt: decodedCursor.createdAt }),
      encodeCursor({ createdAt: 1, operationId: decodedCursor.operationId }),
      encodeCursor({ createdAt: decodedCursor.createdAt, operationId: decodedCursor.operationId.toUpperCase() }),
      encodeCursor({ createdAt: '2026-02-31T00:00:00.000000Z', operationId: decodedCursor.operationId }),
      encodeCursor({ createdAt: '2025-02-29T00:00:00.000000Z', operationId: decodedCursor.operationId }),
      encodeCursor({ createdAt: '2026-02-28T00:00:00.000Z', operationId: decodedCursor.operationId }),
      encodeCursor({ createdAt: decodedCursor.createdAt, operationId: 'not-a-uuid' }),
    ];
    for (const cursor of malformedCursors) {
      const invalidResponse = await request(app).get('/api/v1/command-center/workspace')
        .query({ cursor }).set(sessions.owner.headers).expect(400);
      expect(invalidResponse.body.error).toMatchObject({ code: 'INVALID_CURSOR' });
    }
    const arrayCursor = await request(app).get('/api/v1/command-center/workspace')
      .query({ cursor: [firstOverview.page.nextCursor, firstOverview.page.nextCursor] })
      .set(sessions.owner.headers).expect(400);
    expect(arrayCursor.body.error.code).toBe('INVALID_CURSOR');

    const crossTenantCursor = await request(app).get('/api/v1/command-center/workspace')
      .query({ cursor: firstOverview.page.nextCursor }).set(sessions.other.headers).expect(200);
    expect(crossTenantCursor.body.data.schedulingOverview.records.every(record =>
      record.appointmentId === IDS.otherAppointment)).toBe(true);
    expect(JSON.stringify(crossTenantCursor.body)).not.toContain(IDS.organization);
    const staleCursor = encodeCursor({
      createdAt: '2000-01-01T00:00:00.000000Z',
      operationId: '00000000-0000-4000-8000-000000000099',
    });
    const stalePage = await request(app).get('/api/v1/command-center/workspace')
      .query({ cursor: staleCursor }).set(sessions.owner.headers).expect(200);
    expect(stalePage.body.data.schedulingOverview).toMatchObject({ total: 101, shown: 0 });
    expect(stalePage.body.data.schedulingOverview.page.cursor).toBe(staleCursor);

    // The one operation excluded from the first keyset page is on the second page.
    // Concurrent fixture inserts deliberately do not assume creation order. Change
    // that operation's current assignment between page reads; the next page must
    // keep keyset ordering but project the current revision and complete category
    // counts from its own repeatable-read snapshot.
    const pageTwoAppointment = created
      .map(value => value.appointment)
      .find(appointmentId => !firstIds.has(appointmentId));
    expect(pageTwoAppointment).toEqual(expect.any(String));
    await previewAndApproveAppointment(pageTwoAppointment, 'assign', {
      target: { kind: 'profile', id: IDS.owner },
      reason: 'Page-two assignment proves current authoritative pagination.',
    }, 'm22-part5-pagination-between-pages');
    const assignedPins = await pins(runtimePool, IDS.organization, pageTwoAppointment);

    const second = await request(app)
      .get('/api/v1/command-center/workspace')
      .query({ cursor: firstOverview.page.nextCursor })
      .set(sessions.owner.headers).expect(200);
    const secondOverview = second.body.data.schedulingOverview;
    expect(second.body.data.graphs).toHaveLength(1);
    expect(secondOverview).toMatchObject({
      total: 101, shown: 1, truncated: true,
      counts: expect.objectContaining({ unassigned: 100 }),
      page: expect.objectContaining({
        size: 100, shown: 1, total: 101, hasPrevious: true, hasNext: false,
        cursor: firstOverview.page.nextCursor, nextCursor: null,
      }),
    });
    expect(secondOverview.records).toEqual([
      expect.objectContaining({
        appointmentId: pageTwoAppointment,
        authority: expect.objectContaining({
          revision: assignedPins.revision,
          digest: assignedPins.digest,
          targetState: 'assigned',
          workforceProfileId: IDS.owner,
        }),
      }),
    ]);
    expect(firstIds.has(secondOverview.records[0].appointmentId)).toBe(false);

    const invalid = await request(app).get('/api/v1/command-center/workspace')
      .query({ cursor: Buffer.from('{"createdAt":"not-a-date"}').toString('base64url') })
      .set(sessions.owner.headers).expect(400);
    expect(invalid.body.error.code).toBe('INVALID_CURSOR');
  }, 300000);
});
