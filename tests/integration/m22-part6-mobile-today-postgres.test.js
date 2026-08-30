'use strict';

const crypto = require('crypto');
const { Client, Pool } = require('pg');
const request = require('supertest');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const HOSTILE = '<img src=x onerror="globalThis.todayCompromised=true">';
const IDS = Object.freeze({
  organization: 'a1600000-0000-4000-8000-000000000001',
  otherOrganization: 'a1600000-0000-4000-8000-000000000002',
  owner: 'b1600000-0000-4000-8000-000000000001',
  employee: 'b1600000-0000-4000-8000-000000000002',
  teammate: 'b1600000-0000-4000-8000-000000000003',
  otherOwner: 'b1600000-0000-4000-8000-000000000004',
  crew: 'c1600000-0000-4000-8000-000000000001',
  direct: 'd1600000-0000-4000-8000-000000000001',
  crewWork: 'd1600000-0000-4000-8000-000000000002',
  revoked: 'd1600000-0000-4000-8000-000000000003',
  otherWorker: 'd1600000-0000-4000-8000-000000000004',
  unassigned: 'd1600000-0000-4000-8000-000000000005',
  otherTenant: 'd1600000-0000-4000-8000-000000000006',
});

function quoteIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function roleUrl(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}
async function createRoles(database) {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const migrationRole = `northstar-m22-p6-migration-${suffix}`.slice(0, 63);
  const runtimeRole = `northstar-m22-p6-runtime-${suffix}`.slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quoteIdentifier(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quoteIdentifier(database.databaseName)} OWNER TO ${quoteIdentifier(migrationRole)}`);
  } finally { await admin.end(); }
  return { migrationRole, runtimeRole, migrationUrl: roleUrl(database.connectionString, migrationRole), runtimeUrl: roleUrl(database.connectionString, runtimeRole) };
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
function profile(name) {
  const hours = {};
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    hours[day] = { open: '00:00', close: '23:59', lunch: '', emergency: false, afterHours: false, holiday: false };
  }
  return {
    industry: 'plumbing', businessDescription: 'Part 6 disposable mounted tenant.',
    company: { name, email: 'tenant@example.test', phone: '+15550106000', timeZone: 'America/New_York', currency: 'USD' },
    headquarters: { street: '1 Test Way', city: 'Boston', state: 'MA', country: 'US', latitude: 42.36, longitude: -71.06, additionalOffices: [] },
    hours, scheduling: { maxJobsPerDay: 100, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 },
    crew: { defaultCrewSize: 2, maxCrewSize: 50 },
    services: [{ id: 'plumbing', name: 'Plumbing', description: 'Plumbing', active: true }],
  };
}
async function seedTenant(pool, organizationId, name, actors) {
  await pool.query('INSERT INTO public.organizations(id,name,email) VALUES ($1,$2,$3)', [organizationId, name, `${organizationId}@part6.test`]);
  for (const actor of actors) {
    await pool.query(
      `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
      [actor.id, organizationId, actor.name, `${actor.id}@part6.test`, actor.role]
    );
    await pool.query(
      `INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
       VALUES ($1,$2,$1,$3,'active')`, [actor.id, organizationId, actor.role]
    );
  }
  const raw = profile(name);
  const normalized = adaptBusinessProfile(raw, 'org-profile-v1');
  await pool.query(
    `INSERT INTO public.canonical_business_profiles(
       organization_id,version_number,version_label,raw_profile,normalized_profile,
       normalized_profile_hash,is_active,created_by)
     VALUES ($1,1,'org-profile-v1',$2::jsonb,$3::jsonb,$4,TRUE,$5)`,
    [organizationId, JSON.stringify(raw), JSON.stringify(normalized), normalized.hash, actors[0].id]
  );
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function explicitOffset(value, timeZone = 'America/New_York') {
  const instant = new Date(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((localAsUtc - instant.getTime()) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
function graphIds(appointmentId) {
  return {
    operation: appointmentId.replace(/^d1/, 'e1'), graph: appointmentId.replace(/^d1/, 'f1'),
    customer: appointmentId.replace(/^d1/, 'a1'), transcript: appointmentId.replace(/^d1/, 'b1'),
    opportunity: appointmentId.replace(/^d1/, 'c1'),
  };
}
async function seedAppointment(pool, organizationId, appointmentId, start, end, source = 'manual') {
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
     VALUES ($1,$2,$3,$4,$5,'private-history@example.test','+15550106123',$6::jsonb)`,
    [ids.customer, organizationId, ids.operation, ids.graph, `Customer ${HOSTILE}`, JSON.stringify({ street: `12 Safe ${HOSTILE}`, city: 'Boston', state: 'MA', postalCode: '02110', internalGateCode: 'SECRET-GATE' })]
  );
  await pool.query(
    `INSERT INTO public.canonical_transcripts(
       id,organization_id,operation_id,graph_id,customer_id,source,source_version,transcript_text,normalized_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,'m22-part6-mounted',$7,$8)`,
    [ids.transcript, organizationId, ids.operation, ids.graph, ids.customer, source, `PRIVATE TRANSCRIPT ${HOSTILE}`, sha256(`transcript:${appointmentId}`)]
  );
  await pool.query(
    `INSERT INTO public.canonical_opportunities(
       id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope)
     VALUES ($1,$2,$3,$4,$5,'qualified','Drain service',$6::jsonb)`,
    [ids.opportunity, organizationId, ids.operation, ids.graph, ids.customer, JSON.stringify({
      jobTitle: `Kitchen drain ${HOSTILE}`, instructions: `Use the side entrance. ${HOSTILE}`,
      internalMargin: 'SECRET_FINANCIAL_MARGIN', invoiceId: 'SECRET_INVOICE', broadCustomerHistory: 'SECRET_HISTORY',
    })]
  );
  await pool.query(
    `INSERT INTO public.canonical_appointments(
       id,organization_id,operation_id,graph_id,opportunity_id,scheduled_start,scheduled_end,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`,
    [appointmentId, organizationId, ids.operation, ids.graph, ids.opportunity, start, end]
  );
}
async function pins(pool, organizationId, appointmentId) {
  const row = (await pool.query(
    `SELECT revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,workforce_crew_id,
            scheduled_start,scheduled_end,appointment_status
       FROM public.canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
    [organizationId, appointmentId]
  )).rows[0];
  return {
    revision: Number(row.revision), digest: row.digest,
    target: row.target_state === 'unassigned' ? { kind: 'unassigned', id: null }
      : row.workforce_profile_id ? { kind: 'profile', id: row.workforce_profile_id } : { kind: 'crew', id: row.workforce_crew_id },
    scheduledStart: row.scheduled_start ? new Date(row.scheduled_start).toISOString() : null,
    scheduledEnd: row.scheduled_end ? new Date(row.scheduled_end).toISOString() : null,
    appointmentStatus: row.appointment_status,
  };
}

realPostgres('Mission 22 Part 6 mounted mobile crew Today authority', () => {
  let database, roles, migrationPool, runtimePool, db, app, sessions, slots;
  const original = {};

  beforeAll(async () => {
    for (const key of ['NODE_ENV', 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AUTH_ACCESS_SECRET', 'TZ']) original[key] = process.env[key];
    database = await createSuiteDatabase('m22-p6-mounted');
    roles = await createRoles(database);
    migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 3 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.AUTH_ACCESS_SECRET = 'mission-22-part6-test-only-secret-00000000000000000000000000000000';
    process.env.TZ = 'UTC';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    runtimePool = db.getPool();
    ({ app } = require('../../src/server'));

    await seedTenant(runtimePool, IDS.organization, 'Mission 22 Part 6', [
      { id: IDS.owner, role: 'owner', name: 'Owner Operator' },
      { id: IDS.employee, role: 'member', name: `Alex Employee ${HOSTILE}` },
      { id: IDS.teammate, role: 'member', name: `Morgan Teammate ${HOSTILE}` },
    ]);
    await seedTenant(runtimePool, IDS.otherOrganization, 'Other Part 6', [
      { id: IDS.otherOwner, role: 'owner', name: 'Other Owner' },
    ]);
    await runtimePool.query("UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id IN ($2,$3)", [IDS.organization, IDS.employee, IDS.teammate]);
    await runtimePool.query(
      `INSERT INTO public.workforce_crews(id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'part6-crew',$3,'headquarters',$4,$4)`,
      [IDS.crew, IDS.organization, `East crew ${HOSTILE}`, IDS.owner]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crew_members(organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       VALUES ($1,$2,$3,'lead',$4),($1,$2,$4,'member',$4)`,
      [IDS.organization, IDS.crew, IDS.employee, IDS.teammate]
    );
    sessions = {
      owner: await provisionDurableSession(runtimePool, { userId: IDS.owner, organizationId: IDS.organization, membershipId: IDS.owner, role: 'owner' }),
      employee: await provisionDurableSession(runtimePool, { userId: IDS.employee, organizationId: IDS.organization, membershipId: IDS.employee, role: 'member' }),
      teammate: await provisionDurableSession(runtimePool, { userId: IDS.teammate, organizationId: IDS.organization, membershipId: IDS.teammate, role: 'member' }),
      other: await provisionDurableSession(runtimePool, { userId: IDS.otherOwner, organizationId: IDS.otherOrganization, membershipId: IDS.otherOwner, role: 'owner' }),
    };
    const bounds = (await runtimePool.query(
      `WITH day AS (SELECT (transaction_timestamp() AT TIME ZONE 'America/New_York')::date AS value)
       SELECT ((value+time '08:00') AT TIME ZONE 'America/New_York') AS s1,
              ((value+time '09:00') AT TIME ZONE 'America/New_York') AS e1,
              ((value+time '10:00') AT TIME ZONE 'America/New_York') AS s2,
              ((value+time '11:00') AT TIME ZONE 'America/New_York') AS e2,
              ((value+time '12:00') AT TIME ZONE 'America/New_York') AS s3,
              ((value+time '13:00') AT TIME ZONE 'America/New_York') AS e3,
              ((value+time '14:00') AT TIME ZONE 'America/New_York') AS s4,
              ((value+time '15:00') AT TIME ZONE 'America/New_York') AS e4,
              ((value+time '16:00') AT TIME ZONE 'America/New_York') AS s5,
              ((value+time '17:00') AT TIME ZONE 'America/New_York') AS e5 FROM day`
    )).rows[0];
    slots = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, explicitOffset(value)]));
    await seedAppointment(runtimePool, IDS.organization, IDS.direct, slots.s1, slots.e1);
    await seedAppointment(runtimePool, IDS.organization, IDS.crewWork, slots.s2, slots.e2);
    await seedAppointment(runtimePool, IDS.organization, IDS.revoked, slots.s3, slots.e3);
    await seedAppointment(runtimePool, IDS.organization, IDS.otherWorker, slots.s4, slots.e4);
    await seedAppointment(runtimePool, IDS.organization, IDS.unassigned, slots.s5, slots.e5);
    await seedAppointment(runtimePool, IDS.otherOrganization, IDS.otherTenant, slots.s1, slots.e1);

    await previewAndApprove(IDS.direct, 'assign', { kind: 'profile', id: IDS.employee }, slots.s1, slots.e1, 'direct-assign');
    await previewAndApprove(IDS.direct, 'dispatch', { kind: 'profile', id: IDS.employee }, slots.s1, slots.e1, 'direct-dispatch');
    await previewAndApprove(IDS.crewWork, 'assign', { kind: 'crew', id: IDS.crew }, slots.s2, slots.e2, 'crew-assign');
    await previewAndApprove(IDS.revoked, 'assign', { kind: 'profile', id: IDS.employee }, slots.s3, slots.e3, 'revoked-assign');
    await previewAndApprove(IDS.revoked, 'dispatch', { kind: 'profile', id: IDS.employee }, slots.s3, slots.e3, 'revoked-dispatch');
    await previewAndApprove(IDS.revoked, 'reschedule', { kind: 'profile', id: IDS.employee },
      explicitOffset(new Date(new Date(slots.s3).getTime() + 5 * 60 * 1000)),
      explicitOffset(new Date(new Date(slots.e3).getTime() + 5 * 60 * 1000)), 'revoked-reschedule');
    await previewAndApprove(IDS.otherWorker, 'assign', { kind: 'profile', id: IDS.teammate }, slots.s4, slots.e4, 'other-worker-assign');
  }, 180000);

  async function previewAndApprove(appointmentId, action, target, start, end, key) {
    const before = await pins(runtimePool, IDS.organization, appointmentId);
    const reason = `Part 6 mounted exact human approval ${key}.`;
    const preview = await request(app).post(`/api/v1/canonical/appointments/${appointmentId}/mutation-previews`)
      .set(sessions.owner.headers).send({
        expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: 'America/New_York',
        action, target, scheduledStart: start, scheduledEnd: end,
        appointmentStatus: before.appointmentStatus, reason,
      });
    if (preview.status !== 201) throw new Error(`Preview ${key} failed ${preview.status}: ${JSON.stringify(preview.body)}`);
    const approval = await request(app).post(`/api/v1/canonical/appointments/${appointmentId}/mutation-approvals`)
      .set(sessions.owner.headers).set('Idempotency-Key', `m22-part6-${key}-0000000000000001`).send({
        previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason,
      });
    if (approval.status !== 200) throw new Error(`Approval ${key} failed ${approval.status}: ${JSON.stringify(approval.body)}`);
  }

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

  test('returns only current direct and active-crew work with minimized authoritative bytes', async () => {
    const directProjection = await require('../../src/scheduling/todayRepository').loadToday(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.employee, actorAccessRole: 'member',
      membershipId: IDS.employee, authSessionId: sessions.employee.sessionId,
    });
    expect(directProjection.count).toBe(3);
    const response = await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.success).toBe(true);
    const data = response.body.data;
    expect(data).toMatchObject({ version: 'm22-part6-today-v1', readOnly: true, mutationCapabilities: [], count: 3, shown: 3, total: 3, truncated: false });
    expect(data.day).toMatchObject({ timeZone: 'America/New_York' });
    expect(data.records.map(record => record.appointmentId)).toEqual([IDS.direct, IDS.crewWork, IDS.revoked]);
    expect(data.records.map(record => record.schedule.start)).toEqual([...data.records.map(record => record.schedule.start)].sort());
    const direct = data.records.find(record => record.appointmentId === IDS.direct);
    const crew = data.records.find(record => record.appointmentId === IDS.crewWork);
    const revoked = data.records.find(record => record.appointmentId === IDS.revoked);
    expect(direct).toMatchObject({ assignment: { kind: 'worker', direct: true, currentCrew: false }, dispatch: { state: 'dispatched' } });
    expect(crew).toMatchObject({ assignment: { kind: 'crew', direct: false, currentCrew: true }, dispatch: { state: 'not_dispatched' } });
    expect(crew.crew.teammates.map(member => member.name)).toEqual(expect.arrayContaining([expect.stringContaining('Alex Employee'), expect.stringContaining('Morgan Teammate')]));
    expect(revoked.dispatch.state).toBe('revoked');
    for (const record of data.records) {
      expect(record.route).toMatchObject({ providerNeutral: true, providerCalls: 0, travelDurationMinutes: null, distance: null });
      expect(record.instructions.text).toContain(HOSTILE);
      expect(record.customer.name).toContain(HOSTILE);
      expect(record.authority.approvedCurrent).toBe(true);
    }
    const serialized = JSON.stringify(response.body);
    for (const forbidden of ['SECRET_FINANCIAL_MARGIN', 'SECRET_INVOICE', 'SECRET_HISTORY', 'SECRET-GATE', 'private-history@example.test', 'PRIVATE TRANSCRIPT']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain(IDS.otherWorker);
    expect(serialized).not.toContain(IDS.unassigned);
    expect(serialized).not.toContain(IDS.otherTenant);
  });

  test('serves an employee-minimal Today bootstrap and static bundle through a real mounted cookie session', async () => {
    const shell = await request(app).get('/dashboard/today').set(sessions.employee.headers).expect(200);
    const scriptPaths = [...shell.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    expect(scriptPaths).toContain('/js/today-shell.js');
    expect(scriptPaths).not.toContain('/js/auth-session.js');
    expect(scriptPaths).not.toContain('/js/nav-component.js');
    expect(scriptPaths).not.toContain('/js/command-center-contract.js');

    const bodies = [shell.text];
    const bootstrapBodies = [shell.text];
    for (const scriptPath of scriptPaths) {
      const response = await request(app).get(scriptPath).set(sessions.employee.headers).expect(200);
      bodies.push(response.text);
      if (scriptPath === '/js/today-shell.js') bootstrapBodies.push(response.text);
    }
    const employeeBytes = bodies.join('\n').toLowerCase();
    for (const forbidden of [
      '/api/auth/me', '/dashboard/polaris', '/dashboard/leads', '/dashboard/communications',
      '/dashboard/calendar', '/dashboard/team', '/dashboard/business-profile', '/dashboard/settings',
      '/dashboard/integrations', 'subscription', 'onboarding', 'organization',
    ]) expect(employeeBytes).not.toContain(forbidden.toLowerCase());
    const bootstrapBytes = bootstrapBodies.join('\n').toLowerCase();
    for (const privateIdentityField of ['email', 'phone']) expect(bootstrapBytes).not.toContain(privateIdentityField);

    const today = await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(200);
    expect(today.body.data.identity).toEqual(expect.objectContaining({ displayName: expect.any(String) }));
    expect(Object.keys(today.body.data.identity).sort()).toEqual(['displayName', 'operationalRole']);
  });

  test('rejects forged scope, exposes no mutation method, and keeps owner access personal', async () => {
    await request(app).get(`/api/v1/today?tenantId=${IDS.otherOrganization}&workerId=${IDS.teammate}&day=2027-01-01`)
      .set(sessions.employee.headers).expect(400).expect(response => {
        expect(response.body.error.code).toBe('M22_TODAY_QUERY_FORBIDDEN');
      });
    const mutation = await request(app).post('/api/v1/today').set(sessions.employee.headers).send({ appointmentId: IDS.direct });
    expect(mutation.status).toBeGreaterThanOrEqual(400);
    const owner = await request(app).get('/api/v1/today').set(sessions.owner.headers).expect(200);
    expect(owner.body.data.records).toEqual([]);
    const other = await request(app).get('/api/v1/today').set(sessions.other.headers).expect(200);
    expect(other.body.data.records).toEqual([]);
  });

  test('removing crew membership hides prior crew work and session/member changes fail closed', async () => {
    const { loadToday } = require('../../src/scheduling/todayRepository');
    await expect(loadToday(runtimePool, {
      organizationId: IDS.organization, actorUserId: IDS.employee, actorAccessRole: 'owner',
      membershipId: IDS.employee, authSessionId: sessions.employee.sessionId,
    })).rejects.toMatchObject({ code: 'M22_TODAY_WORKFORCE_RESTRICTED', status: 403 });

    await runtimePool.query('DELETE FROM public.workforce_crew_members WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3', [IDS.organization, IDS.crew, IDS.employee]);
    try {
      const removed = await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(200);
      expect(removed.body.data.records.map(record => record.appointmentId)).toEqual([IDS.direct, IDS.revoked]);
    } finally {
      await runtimePool.query(
        `INSERT INTO public.workforce_crew_members(organization_id,crew_id,profile_id,crew_role,created_by_user_id)
         VALUES ($1,$2,$3,'lead',$4)`, [IDS.organization, IDS.crew, IDS.employee, IDS.teammate]
      );
    }

    await runtimePool.query("UPDATE public.auth_sessions SET status='revoked',revoked_at=NOW(),revoke_reason='part6_test' WHERE id=$1", [sessions.employee.sessionId]);
    try { await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(401); }
    finally { await runtimePool.query("UPDATE public.auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1", [sessions.employee.sessionId]); }

    const accessExpiry = (await runtimePool.query(
      'SELECT access_expires_at FROM public.auth_sessions WHERE id=$1', [sessions.employee.sessionId]
    )).rows[0].access_expires_at;
    await runtimePool.query("UPDATE public.auth_sessions SET access_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [sessions.employee.sessionId]);
    try { await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(401); }
    finally { await runtimePool.query('UPDATE public.auth_sessions SET access_expires_at=$2 WHERE id=$1', [sessions.employee.sessionId, accessExpiry]); }

    await runtimePool.query("UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2", [IDS.organization, IDS.employee]);
    try { await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(403); }
    finally { await runtimePool.query("UPDATE public.organization_memberships SET status='active' WHERE organization_id=$1 AND id=$2", [IDS.organization, IDS.employee]); }

    await runtimePool.query("UPDATE public.users SET status='disabled' WHERE organization_id=$1 AND id=$2", [IDS.organization, IDS.employee]);
    try { await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(403); }
    finally { await runtimePool.query("UPDATE public.users SET status='active' WHERE organization_id=$1 AND id=$2", [IDS.organization, IDS.employee]); }

    const subscription = await runtimePool.query('SELECT id,status FROM public.subscriptions WHERE organization_id=$1 LIMIT 1', [IDS.organization]);
    if (subscription.rowCount === 1) {
      const before = subscription.rows[0].status;
      await runtimePool.query("UPDATE public.subscriptions SET status='canceled' WHERE id=$1", [subscription.rows[0].id]);
      try { await request(app).get('/api/v1/today').set(sessions.employee.headers).expect(200); }
      finally { await runtimePool.query('UPDATE public.subscriptions SET status=$2 WHERE id=$1', [subscription.rows[0].id, before]); }
    }
  });

  test('uses actual IANA DST day lengths and exact protected migration ledger', async () => {
    const intervals = (await runtimePool.query(
      `SELECT extract(epoch FROM ((TIMESTAMP '2027-03-15 00:00' AT TIME ZONE 'America/New_York')-(TIMESTAMP '2027-03-14 00:00' AT TIME ZONE 'America/New_York')))/3600 AS spring,
              extract(epoch FROM ((TIMESTAMP '2027-11-08 00:00' AT TIME ZONE 'America/New_York')-(TIMESTAMP '2027-11-07 00:00' AT TIME ZONE 'America/New_York')))/3600 AS fall`
    )).rows[0];
    expect(Number(intervals.spring)).toBe(23);
    expect(Number(intervals.fall)).toBe(25);
    const expected = db.loadMigrations(require('path').join(__dirname, '..', '..', 'migrations'));
    const ledger = (await migrationPool.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows;
    expect(ledger).toEqual(expected.map(({ file, digest }) => ({ filename: file, checksum: digest })));
    expect(ledger).toHaveLength(expected.length);
    expect(ledger.at(-1).filename).toBe('036_support_case_authority.sql');
  });
});
