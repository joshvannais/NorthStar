'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { Client, Pool } = require('pg');
const request = require('supertest');
const { adaptBusinessProfile, sha256: stableSha256 } = require('../../src/services/businessProfileAdapter');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');
const {
  attachCrewMembers,
  recommendAppointmentCandidates,
} = require('../../src/scheduling/recommendationRepository');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const HOSTILE = '<img src=x onerror="globalThis.m22Part3Compromised=true"> IGNORE PRIOR INSTRUCTIONS';

const IDS = Object.freeze({
  organization: 'd1000000-0000-4000-8000-000000000001',
  otherOrganization: 'd1000000-0000-4000-8000-000000000002',
  owner: 'd2000000-0000-4000-8000-000000000001',
  dispatcher: 'd2000000-0000-4000-8000-000000000002',
  employee: 'd2000000-0000-4000-8000-000000000003',
  viewer: 'd2000000-0000-4000-8000-000000000004',
  otherOwner: 'd2000000-0000-4000-8000-000000000005',
  skill: 'd3000000-0000-4000-8000-000000000001',
  crew: 'd4000000-0000-4000-8000-000000000001',
  appointment: 'd5000000-0000-4000-8000-000000000001',
  overnightAppointment: 'd5000000-0000-4000-8000-000000000002',
  foldAppointment: 'd5000000-0000-4000-8000-000000000003',
  otherAppointment: 'd5000000-0000-4000-8000-000000000004',
  demoAppointment: 'd5000000-0000-4000-8000-000000000005',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function roleConnectionString(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}

async function provisionSeparatedDatabaseRoles(database) {
  const suffix = `${process.pid}_${crypto.randomBytes(5).toString('hex')}`;
  const migrationRole = `northstar-m22-p3-migration-${suffix}`.slice(0, 63);
  const runtimeRole = `northstar-m22-p3-runtime-${suffix}`.slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quoteIdentifier(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quoteIdentifier(database.databaseName)} OWNER TO ${quoteIdentifier(migrationRole)}`);
  } finally {
    await admin.end();
  }
  return {
    migrationRole,
    runtimeRole,
    migrationUrl: roleConnectionString(database.connectionString, migrationRole),
    runtimeUrl: roleConnectionString(database.connectionString, runtimeRole),
  };
}

async function dropSeparatedDatabaseRoles(roles) {
  if (!roles) return;
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.runtimeRole)}`);
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.migrationRole)}`);
  } finally {
    await admin.end();
  }
}

function businessProfile(name, overrides = {}) {
  const hours = {};
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    hours[day] = { open: '00:00', close: '23:59', lunch: '', emergency: false, afterHours: false, holiday: false };
  }
  return {
    industry: 'plumbing',
    businessDescription: `${name} bounded route and recommendation authority.`,
    company: {
      name,
      email: `${name.toLowerCase().replace(/\s/g, '-')}@example.test`,
      phone: '+15550103333',
      timeZone: 'America/New_York',
      currency: 'USD',
    },
    headquarters: {
      street: `${HOSTILE} 1 Main Street`, city: 'Boston', state: 'MA', country: 'US',
      latitude: 42.3601, longitude: -71.0589,
      additionalOffices: [{
        id: 'north', name: HOSTILE, street: '2 North Street', city: 'Lowell', state: 'MA', country: 'US',
        latitude: 42.6334, longitude: -71.3162,
      }],
    },
    hours,
    scheduling: { maxJobsPerDay: 8, workDayLength: 16, appointmentBuffer: 15, travelBuffer: 10 },
    crew: { defaultCrewSize: 2, maxCrewSize: 100 },
    services: [{ id: 'plumbing', name: 'Plumbing', description: 'Current plumbing skill authority.', active: true }],
    ...overrides,
  };
}

async function seedTenant(pool, input) {
  await pool.query('INSERT INTO public.organizations(id,name,email) VALUES ($1,$2,$3)',
    [input.organizationId, input.name, `${input.slug}@m22-part3.test`]);
  for (const actor of input.actors) {
    await pool.query(
      `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
      [actor.id, input.organizationId, actor.name || `${input.name} ${actor.role}`, `${actor.id}@m22-part3.test`, actor.role]
    );
    await pool.query(
      `INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
       VALUES ($1,$2,$1,$3,'active')`,
      [actor.id, input.organizationId, actor.role]
    );
  }
  const raw = businessProfile(input.name);
  const normalized = adaptBusinessProfile(raw, 'org-profile-v1');
  await pool.query(
    `INSERT INTO public.canonical_business_profiles
      (organization_id,version_number,version_label,raw_profile,normalized_profile,
       normalized_profile_hash,is_active,created_by)
     VALUES ($1,1,'org-profile-v1',$2::jsonb,$3::jsonb,$4,TRUE,$5)`,
    [input.organizationId, JSON.stringify(raw), JSON.stringify(normalized), normalized.hash, input.actors[0].id]
  );
}

async function seedAppointment(pool, input) {
  const operationId = input.appointmentId.replace(/^d5/, 'd6');
  const graphId = input.appointmentId.replace(/^d5/, 'd7');
  const customerId = input.appointmentId.replace(/^d5/, 'd8');
  const transcriptId = input.appointmentId.replace(/^d5/, 'd9');
  const opportunityId = input.appointmentId.replace(/^d5/, 'da');
  await pool.query(
    `INSERT INTO public.canonical_operations
      (id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
       lease_owner,lease_expires_at,result_status,result_body,completed_at)
     VALUES ($1,$2,$3,$4,$5,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [operationId, input.organizationId, graphId, sha256(`key:${operationId}`), sha256(`payload:${operationId}`)]
  );
  await pool.query(
    `INSERT INTO public.canonical_customers(id,organization_id,operation_id,graph_id,name)
     VALUES ($1,$2,$3,$4,$5)`,
    [customerId, input.organizationId, operationId, graphId, input.name]
  );
  await pool.query(
    `INSERT INTO public.canonical_transcripts
      (id,organization_id,operation_id,graph_id,customer_id,source,source_version,
       external_call_id,transcript_text,normalized_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,'m22-part3-mounted',$7,$8,$9)`,
    [transcriptId, input.organizationId, operationId, graphId, customerId,
      input.source || 'manual', input.externalCallId || null, HOSTILE, sha256(`transcript:${operationId}`)]
  );
  await pool.query(
    `INSERT INTO public.canonical_opportunities
      (id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope)
     VALUES ($1,$2,$3,$4,$5,'qualified','plumbing',$6::jsonb)`,
    [opportunityId, input.organizationId, operationId, graphId, customerId,
      JSON.stringify({ locationId: input.locationId || 'headquarters', instructions: HOSTILE })]
  );
  await pool.query(
    `INSERT INTO public.canonical_appointments
      (id,organization_id,operation_id,graph_id,opportunity_id,status)
     VALUES ($1,$2,$3,$4,$5,'preferred')`,
    [input.appointmentId, input.organizationId, operationId, graphId, opportunityId]
  );
}

async function assignmentPins(pool, appointmentId, organizationId = IDS.organization) {
  const row = (await pool.query(
    `SELECT id,revision,rtrim(canonical_digest) AS digest
       FROM public.canonical_schedule_assignments
      WHERE organization_id=$1 AND appointment_id=$2`,
    [organizationId, appointmentId]
  )).rows[0];
  return { id: row.id, expectedRevision: Number(row.revision), expectedDigest: row.digest };
}

async function scheduleThroughMountedRoute(app, session, appointmentId, start, end, key) {
  const pins = await assignmentPins(app.locals.m22Pool, appointmentId);
  const response = await request(app)
    .patch(`/api/v1/canonical/appointments/${appointmentId}`)
    .set(session.headers)
    .set('Idempotency-Key', key)
    .send({
      expectedRevision: pins.expectedRevision,
      expectedDigest: pins.expectedDigest,
      expectedTimeZone: 'America/New_York',
      action: 'calendar_edit',
      reason: `Human approved exact Part 3 schedule. ${HOSTILE}`,
      scheduledStart: start,
      scheduledEnd: end,
      status: 'scheduled',
  });
  expect(response.status).toBe(200);
  return {
    expectedRevision: response.body.data.scheduleAuthority.revision,
    expectedDigest: response.body.data.scheduleAuthority.digest,
  };
}

function availabilityBody(overrides = {}) {
  return {
    expectedRevision: 0,
    expectedDigest: null,
    expectedTimeZone: 'America/New_York',
    coverageStart: '2027-03-01T00:00:00-05:00',
    coverageEnd: '2027-04-01T00:00:00-04:00',
    intervals: [{ kind: 'available', start: '2027-03-01T00:00:00-05:00', end: '2027-04-01T00:00:00-04:00' }],
    reason: `Authorized availability for Part 3. ${HOSTILE}`,
    ...overrides,
  };
}

function recommendationBody(pins, overrides = {}) {
  return {
    expectedRevision: pins.expectedRevision,
    expectedDigest: pins.expectedDigest,
    expectedTimeZone: 'America/New_York',
    ...overrides,
  };
}

function boundedRawBody(authority, bytes) {
  const base = JSON.stringify(recommendationBody(authority));
  const padding = bytes - Buffer.byteLength(base, 'utf8');
  if (padding < 0) throw new Error('Requested raw body bound is smaller than the canonical envelope.');
  return Buffer.from(base + ' '.repeat(padding), 'utf8');
}

async function publicTableCounts(pool) {
  const tables = (await pool.query(
    `SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname='public' ORDER BY tablename`
  )).rows.map(row => row.tablename);
  const counts = {};
  for (const table of tables) {
    counts[table] = Number((await pool.query(`SELECT count(*) AS count FROM public.${quoteIdentifier(table)}`)).rows[0].count);
  }
  return counts;
}

async function durableRequestAuditSignal(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::bigint FROM public.audit_logs) +
       (SELECT COALESCE(sum(request_count),0)::bigint FROM public.api_observability_hourly) AS total`
  );
  return Number(result.rows[0].total);
}

async function waitForAuditFinish() {
  await new Promise(resolve => setTimeout(resolve, 200));
}

function expectSecurityHeaders(response) {
  expect(response.headers['content-security-policy']).toEqual(expect.any(String));
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['cache-control']).toContain('no-store');
}

function rawHttpRequest(port, input) {
  return new Promise((resolve, reject) => {
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body || '', 'utf8');
    const headers = { ...input.headers, Connection: 'close' };
    if (!input.omitContentType) {
      headers['Content-Type'] = input.contentType || 'application/json; charset=utf-8';
    }
    if (input.contentEncoding) headers['Content-Encoding'] = input.contentEncoding;
    if (!input.chunked) headers['Content-Length'] = input.contentLength === undefined ? body.length : input.contentLength;
    const outgoing = http.request({
      host: '127.0.0.1', port, method: 'POST', path: input.path, headers,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) { /* Preserve the exact response text. */ }
        resolve({ status: response.statusCode, headers: response.headers, body: parsed, text });
      });
    });
    outgoing.on('error', reject);
    if (input.chunked) {
      const midpoint = Math.floor(body.length / 2);
      outgoing.write(body.subarray(0, midpoint));
      outgoing.write(body.subarray(midpoint));
      outgoing.end();
    } else {
      outgoing.end(body);
    }
  });
}

function allowOnlyLoopbackTransport() {
  const originalHttp = http.request;
  const originalHttps = https.request;
  const originalFetch = global.fetch;
  let externalRequests = 0;
  function hostFrom(args) {
    const first = args[0];
    if (first instanceof URL) return first.hostname;
    if (typeof first === 'string') return new URL(first).hostname;
    return first && (first.hostname || first.host) || '127.0.0.1';
  }
  http.request = function (...args) {
    const host = String(hostFrom(args)).replace(/^\[|\]$/g, '').split(':')[0];
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      externalRequests += 1;
      throw new Error('External HTTP transport is forbidden in Mission 22 Part 3 tests.');
    }
    return originalHttp.apply(this, args);
  };
  https.request = function () {
    externalRequests += 1;
    throw new Error('External HTTPS transport is forbidden in Mission 22 Part 3 tests.');
  };
  global.fetch = async function () {
    externalRequests += 1;
    throw new Error('External fetch transport is forbidden in Mission 22 Part 3 tests.');
  };
  return {
    count: () => externalRequests,
    restore() {
      http.request = originalHttp;
      https.request = originalHttps;
      global.fetch = originalFetch;
    },
  };
}

realPostgres('Mission 22 Part 3 mounted route implications and Polaris recommendations', () => {
  let database;
  let roles;
  let migrationPool;
  let runtimePool;
  let db;
  let app;
  let rawServer;
  let rawPort;
  let sessions;
  let pins;
  let overnightPins;
  let foldPins;
  let firstRecommendation;
  const originalEnvironment = {};

  beforeAll(async () => {
    for (const key of ['NODE_ENV', 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AUTH_ACCESS_SECRET', 'TZ']) {
      originalEnvironment[key] = process.env[key];
    }
    database = await createSuiteDatabase('m22-p3-mounted');
    roles = await provisionSeparatedDatabaseRoles(database);
    migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 4 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.AUTH_ACCESS_SECRET = 'mission-22-part3-test-only-secret-00000000000000000000000000000000';
    process.env.TZ = 'UTC';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    runtimePool = db.getPool();
    ({ app } = require('../../src/server'));
    app.locals.m22Pool = runtimePool;
    rawServer = http.createServer(app);
    await new Promise((resolve, reject) => {
      rawServer.once('error', reject);
      rawServer.listen(0, '127.0.0.1', resolve);
    });
    rawPort = rawServer.address().port;

    await seedTenant(runtimePool, {
      organizationId: IDS.organization,
      name: 'Mission 22 Part 3',
      slug: 'mission22-part3',
      actors: [
        { id: IDS.owner, role: 'owner', name: 'Owner nearest' },
        { id: IDS.dispatcher, role: 'member', name: 'Dispatcher north' },
        { id: IDS.employee, role: 'member', name: HOSTILE },
        { id: IDS.viewer, role: 'viewer', name: 'Viewer excluded from authority' },
      ],
    });
    await seedTenant(runtimePool, {
      organizationId: IDS.otherOrganization,
      name: 'Mission 22 Part 3 Other',
      slug: 'mission22-part3-other',
      actors: [{ id: IDS.otherOwner, role: 'owner', name: 'Other owner' }],
    });
    await runtimePool.query(
      `UPDATE public.workforce_profiles
          SET home_location_id=CASE WHEN id=$2 THEN 'north' ELSE 'headquarters' END
        WHERE organization_id=$1`,
      [IDS.organization, IDS.dispatcher]
    );
    await runtimePool.query(
      `UPDATE public.workforce_profiles SET operational_role='dispatcher'
        WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, IDS.dispatcher]
    );
    await runtimePool.query(
      `UPDATE public.workforce_profiles SET operational_role='technician'
        WHERE organization_id=$1 AND id=$2`,
      [IDS.organization, IDS.employee]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_skills
        (id,organization_id,skill_key,name,service_id,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'plumbing','Plumbing','plumbing',$3,$3)`,
      [IDS.skill, IDS.organization, IDS.owner]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_profile_skills(organization_id,profile_id,skill_id,created_by_user_id)
       VALUES ($1,$2,$3,$2),($1,$4,$3,$2)`,
      [IDS.organization, IDS.owner, IDS.skill, IDS.dispatcher]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crews
        (id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'crew-north',$3,'north',$4,$4)`,
      [IDS.crew, IDS.organization, `Crew ${HOSTILE}`, IDS.owner]
    );
    await runtimePool.query(
      `INSERT INTO public.workforce_crew_members
        (organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       VALUES ($1,$2,$3,'lead',$3),($1,$2,$4,'member',$3)`,
      [IDS.organization, IDS.crew, IDS.owner, IDS.dispatcher]
    );

    sessions = {
      owner: await provisionDurableSession(runtimePool, {
        userId: IDS.owner, organizationId: IDS.organization, membershipId: IDS.owner, role: 'owner',
      }),
      dispatcher: await provisionDurableSession(runtimePool, {
        userId: IDS.dispatcher, organizationId: IDS.organization, membershipId: IDS.dispatcher, role: 'member',
      }),
      employee: await provisionDurableSession(runtimePool, {
        userId: IDS.employee, organizationId: IDS.organization, membershipId: IDS.employee, role: 'member',
      }),
      viewer: await provisionDurableSession(runtimePool, {
        userId: IDS.viewer, organizationId: IDS.organization, membershipId: IDS.viewer, role: 'viewer',
      }),
      other: await provisionDurableSession(runtimePool, {
        userId: IDS.otherOwner, organizationId: IDS.otherOrganization, membershipId: IDS.otherOwner, role: 'owner',
      }),
    };
    for (const appointment of [
      { organizationId: IDS.organization, appointmentId: IDS.appointment, name: 'Mounted recommendation' },
      { organizationId: IDS.organization, appointmentId: IDS.overnightAppointment, name: 'Overnight recommendation' },
      { organizationId: IDS.organization, appointmentId: IDS.foldAppointment, name: 'Fold recommendation' },
      { organizationId: IDS.otherOrganization, appointmentId: IDS.otherAppointment, name: 'Other recommendation' },
      { organizationId: IDS.organization, appointmentId: IDS.demoAppointment, name: 'Demo hidden recommendation', source: 'demo', externalCallId: 'demo-session:call' },
    ]) await seedAppointment(runtimePool, appointment);

    pins = await scheduleThroughMountedRoute(app, sessions.owner, IDS.appointment,
      '2027-03-08T10:00:00-05:00', '2027-03-08T11:00:00-05:00', 'm22-p3-schedule-main-00000001');
    overnightPins = await scheduleThroughMountedRoute(app, sessions.owner, IDS.overnightAppointment,
      '2027-03-08T23:30:00-05:00', '2027-03-09T02:30:00-05:00', 'm22-p3-schedule-overnight-001');
    foldPins = await scheduleThroughMountedRoute(app, sessions.owner, IDS.foldAppointment,
      '2027-11-07T01:30:00-04:00', '2027-11-07T01:30:00-05:00', 'm22-p3-schedule-fold-000000001');

    for (const [profileId, key] of [
      [IDS.owner, 'm22-p3-owner-availability-0001'],
      [IDS.dispatcher, 'm22-p3-dispatcher-availability-0001'],
    ]) {
      const response = await request(app)
        .put(`/api/v1/canonical/availability/profiles/${profileId}`)
        .set(sessions.owner.headers)
        .set('Idempotency-Key', key)
        .send(availabilityBody());
      expect(response.status).toBe(200);
    }
  }, 180000);

  afterAll(async () => {
    try {
      if (rawServer) await new Promise(resolve => rawServer.close(resolve));
      if (db) await db.close().catch(() => {});
      if (migrationPool) await migrationPool.end();
      if (database) await database.cleanup();
      await dropSeparatedDatabaseRoles(roles);
    } finally {
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 180000);

  test('uses fresh PostgreSQL 18 UTC and preserves exact released migrations 001-034 with no Part 3 schema', async () => {
    const identity = (await runtimePool.query(
      `SELECT current_setting('server_version') AS version,current_setting('TimeZone') AS timezone,
              current_user AS runtime_role,current_setting('session_replication_role') AS replication_role`
    )).rows[0];
    expect(identity).toMatchObject({
      version: expect.stringMatching(/^18\./), timezone: 'UTC', runtime_role: roles.runtimeRole, replication_role: 'origin',
    });
    const files = fs.readdirSync(MIGRATIONS).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    expect(files.at(-1)).toBe('034_schedule_availability_conflict_authority.sql');
    const ledgers = (await migrationPool.query('SELECT filename,checksum FROM public._migrations ORDER BY filename')).rows;
    expect(ledgers).toHaveLength(files.length);
    for (const row of ledgers) {
      expect(row.checksum).toBe(sha256(fs.readFileSync(path.join(MIGRATIONS, row.filename))));
    }
    const schema = await migrationPool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE '%recommend%'`
    );
    expect(schema.rows).toEqual([]);
  }, 120000);

  test('mounts deterministic evidence-pinned candidate recommendations with zero external requests or durable mutation', async () => {
    const before = (await runtimePool.query(
      `SELECT
        (SELECT count(*)::int FROM public.canonical_schedule_assignments) AS assignments,
        (SELECT count(*)::int FROM public.canonical_schedule_assignment_revisions) AS revisions,
        (SELECT count(*)::int FROM public.canonical_schedule_approvals) AS approvals,
        (SELECT count(*)::int FROM public.canonical_workforce_availability_revisions) AS availability_revisions`
    )).rows[0];
    const transport = allowOnlyLoopbackTransport();
    let response;
    try {
      response = await request(app)
        .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
        .set(sessions.owner.headers)
        .send(recommendationBody(pins));
    } finally {
      transport.restore();
    }
    expect(transport.count()).toBe(0);
    expect(response.status).toBe(200);
    firstRecommendation = response.body;
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      appointmentId: IDS.appointment,
      assignmentPins: {
        revision: pins.expectedRevision, digest: pins.expectedDigest,
        scheduleState: 'scheduled', scheduledStart: '2027-03-08T15:00:00.000Z', scheduledEnd: '2027-03-08T16:00:00.000Z',
      },
      businessProfilePins: { version: 1, timeZone: 'America/New_York' },
      status: 'needs_review', persisted: false, grantsMutation: false,
      needsReview: true,
    });
    expect(response.body.data.digest).toMatch(/^[0-9a-f]{64}$/);
    const { digest: responseDigest, ...canonical } = response.body.data;
    expect(responseDigest).toBe(stableSha256(canonical));
    expect(response.body.data.candidateSetPins.count).toBeGreaterThanOrEqual(5);
    expect(response.body.data.candidateSetPins.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(response.body.data.conflictInputs).toMatchObject({ evaluationVersion: 1, skillAuthorityKnown: true });
    expect(response.body.data.constraints).toMatchObject({
      providerCallsAllowed: 0, mutationGrant: false,
      drivingRouteEvidence: 'unavailable_without_separately_authorized_current_durable_evidence',
    });
    expect(response.body.data.alternatives.every(candidate => candidate.route.providerCalls === 0)).toBe(true);
    expect(response.body.data.alternatives.every(candidate => candidate.route.driving.status === 'unavailable')).toBe(true);
    expect(response.body.data.alternatives.every(candidate => candidate.route.driving.distanceMiles === null &&
      candidate.route.driving.durationMinutes === null)).toBe(true);
    expect(response.body.data.alternatives.some(candidate => candidate.route.geodesic.status === 'available')).toBe(true);
    expect(response.body.data.alternatives.some(candidate => candidate.candidate.label === HOSTILE)).toBe(true);
    expect(JSON.stringify(response.body.data)).not.toMatch(/https?:\/\//);

    const after = (await runtimePool.query(
      `SELECT
        (SELECT count(*)::int FROM public.canonical_schedule_assignments) AS assignments,
        (SELECT count(*)::int FROM public.canonical_schedule_assignment_revisions) AS revisions,
        (SELECT count(*)::int FROM public.canonical_schedule_approvals) AS approvals,
        (SELECT count(*)::int FROM public.canonical_workforce_availability_revisions) AS availability_revisions`
    )).rows[0];
    expect(after).toEqual(before);
  }, 120000);

  test('normalizes profile-only, crew-only, empty, zero-member crew, and mixed candidate shapes', async () => {
    const profileCandidate = {
      kind: 'profile', id: IDS.owner, label: 'Owner nearest', homeLocationId: 'headquarters',
      updatedAt: '2027-03-01T00:00:00.000Z', membershipStatus: 'active',
      membershipUpdatedAt: '2027-03-01T00:00:00.000Z', userStatus: 'active',
      userUpdatedAt: '2027-03-01T00:00:00.000Z',
    };
    const crewCandidate = {
      kind: 'crew', id: IDS.crew, label: 'Crew north', homeLocationId: 'north',
      updatedAt: '2027-03-01T00:00:00.000Z', membershipStatus: null,
      membershipUpdatedAt: null, userStatus: null, userUpdatedAt: null,
    };

    expect(await attachCrewMembers(runtimePool, IDS.organization, [])).toEqual({
      truncated: false, candidates: [],
    });
    const profileOnly = await attachCrewMembers(runtimePool, IDS.organization, [profileCandidate]);
    expect(profileOnly.candidates[0]).toMatchObject({
      kind: 'profile', id: IDS.owner, membersTruncated: false,
      members: [{ profileId: IDS.owner, membershipStatus: 'active', userStatus: 'active' }],
    });
    const crewOnly = await attachCrewMembers(runtimePool, IDS.organization, [crewCandidate]);
    expect(crewOnly.candidates[0]).toMatchObject({
      kind: 'crew', id: IDS.crew, membersTruncated: false,
    });
    expect(crewOnly.candidates[0].members).toHaveLength(2);
    const mixed = await attachCrewMembers(runtimePool, IDS.organization, [crewCandidate, profileCandidate]);
    expect(mixed.candidates.map(candidate => [candidate.kind, candidate.members.length])).toEqual([
      ['crew', 2], ['profile', 1],
    ]);

    const crewRecord = (await runtimePool.query(
      'SELECT * FROM public.workforce_crews WHERE organization_id=$1 AND id=$2',
      [IDS.organization, IDS.crew]
    )).rows[0];
    const memberRecords = (await runtimePool.query(
      'SELECT * FROM public.workforce_crew_members WHERE organization_id=$1 AND crew_id=$2 ORDER BY profile_id',
      [IDS.organization, IDS.crew]
    )).rows;
    await runtimePool.query('DELETE FROM public.workforce_crew_members WHERE organization_id=$1 AND crew_id=$2',
      [IDS.organization, IDS.crew]);
    try {
      const zeroMemberCrew = await attachCrewMembers(runtimePool, IDS.organization, [crewCandidate]);
      expect(zeroMemberCrew.candidates[0]).toMatchObject({ members: [], membersTruncated: false });
      await runtimePool.query('DELETE FROM public.workforce_crews WHERE organization_id=$1 AND id=$2',
        [IDS.organization, IDS.crew]);
      const mountedProfileOnly = await request(app)
        .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
        .set(sessions.owner.headers).send(recommendationBody(pins));
      expect(mountedProfileOnly.status).toBe(200);
      expect(mountedProfileOnly.body.data.alternatives.length).toBeGreaterThan(0);
      expect(mountedProfileOnly.body.data.alternatives.every(item => item.candidate.kind === 'profile')).toBe(true);
      expect(mountedProfileOnly.body.data.alternatives.every(item => item.authorityPins.memberCount === 1)).toBe(true);
    } finally {
      await runtimePool.query(
        `INSERT INTO public.workforce_crews
          (id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organization_id,id) DO NOTHING`,
        [crewRecord.id, crewRecord.organization_id, crewRecord.crew_key, crewRecord.name,
          crewRecord.home_location_id, crewRecord.created_by_user_id, crewRecord.updated_by_user_id,
          crewRecord.created_at, crewRecord.updated_at]
      );
      for (const member of memberRecords) {
        await runtimePool.query(
          `INSERT INTO public.workforce_crew_members
            (organization_id,crew_id,profile_id,crew_role,created_by_user_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (organization_id,crew_id,profile_id) DO NOTHING`,
          [member.organization_id, member.crew_id, member.profile_id, member.crew_role,
            member.created_by_user_id, member.created_at]
        );
      }
    }
  }, 120000);

  test('enforces the exact raw-wire JSON boundary before global parsing', async () => {
    const pathName = `/api/v1/canonical/appointments/${IDS.appointment}/recommendations`;
    for (const bytes of [65535, 65536]) {
      const accepted = await rawHttpRequest(rawPort, {
        path: pathName, headers: sessions.owner.headers, body: boundedRawBody(pins, bytes),
      });
      expect(accepted.status).toBe(200);
    }
    const oversized = await rawHttpRequest(rawPort, {
      path: pathName, headers: sessions.owner.headers, body: boundedRawBody(pins, 65537),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('M22_RECOMMENDATION_BODY_TOO_LARGE');
    expectSecurityHeaders(oversized);

    const chunkedWithin = await rawHttpRequest(rawPort, {
      path: pathName, headers: sessions.owner.headers, body: boundedRawBody(pins, 65536), chunked: true,
    });
    expect(chunkedWithin.status).toBe(200);
    const chunkedOversized = await rawHttpRequest(rawPort, {
      path: pathName, headers: sessions.owner.headers, body: boundedRawBody(pins, 65537), chunked: true,
    });
    expect(chunkedOversized.status).toBe(413);

    const base = recommendationBody(pins);
    const duplicateCases = [
      `{"expectedRevision":${pins.expectedRevision},"expectedRevision":${pins.expectedRevision},"expectedDigest":"${pins.expectedDigest}","expectedTimeZone":"America/New_York"}`,
      `{"expectedRevision":${pins.expectedRevision},"expectedDigest":"${pins.expectedDigest}","expectedDigest":"${pins.expectedDigest}","expectedTimeZone":"America/New_York"}`,
      `{"expectedRevision":${pins.expectedRevision},"expectedDigest":"${pins.expectedDigest}","expectedTimeZone":"UTC","expectedTimeZone":"America/New_York"}`,
      `{"expectedRevision":${pins.expectedRevision},"\\u0065xpectedRevision":${pins.expectedRevision},"expectedDigest":"${pins.expectedDigest}","expectedTimeZone":"America/New_York"}`,
    ];
    for (const body of duplicateCases) {
      const duplicate = await rawHttpRequest(rawPort, {
        path: pathName, headers: sessions.owner.headers, body,
      });
      expect(duplicate.status).toBe(400);
      expect(duplicate.body.error.code).toBe('M22_RECOMMENDATION_AMBIGUOUS_JSON');
      expectSecurityHeaders(duplicate);
    }
    for (const body of ['{', JSON.stringify(base) + ' trailing', '{"expectedRevision":01}', Buffer.from([0xff])]) {
      const malformed = await rawHttpRequest(rawPort, {
        path: pathName, headers: sessions.owner.headers, body,
      });
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('INVALID_RECOMMENDATION_REQUEST');
      expectSecurityHeaders(malformed);
    }
    for (const contentType of [undefined, 'text/plain', 'application/problem+json', 'application/json; charset=utf-16']) {
      const media = await rawHttpRequest(rawPort, {
        path: pathName, headers: sessions.owner.headers, body: JSON.stringify(base),
        contentType, omitContentType: contentType === undefined,
      });
      expect(media.status).toBe(415);
      expect(media.body.error.code).toBe('M22_RECOMMENDATION_MEDIA_TYPE_UNSUPPORTED');
      expectSecurityHeaders(media);
    }
    for (const contentEncoding of ['gzip', 'deflate', 'br']) {
      const encoded = await rawHttpRequest(rawPort, {
        path: pathName, headers: sessions.owner.headers,
        body: contentEncoding === 'gzip' ? zlib.gzipSync(JSON.stringify(base)) : JSON.stringify(base),
        contentEncoding,
      });
      expect(encoded.status).toBe(415);
      expect(encoded.body.error.code).toBe('M22_RECOMMENDATION_CONTENT_ENCODING_UNSUPPORTED');
      expectSecurityHeaders(encoded);
    }
    const identity = await rawHttpRequest(rawPort, {
      path: pathName, headers: sessions.owner.headers, body: JSON.stringify(base), contentEncoding: 'identity',
    });
    expect(identity.status).toBe(200);
    const bom = await rawHttpRequest(rawPort, {
      path: pathName, headers: sessions.owner.headers,
      body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(base))]),
    });
    expect(bom.status).toBe(200);

    const alternateExpressSpelling = await rawHttpRequest(rawPort, {
      path: `/API/V1/CANONICAL/APPOINTMENTS/${IDS.appointment.toUpperCase()}/RECOMMENDATIONS/`,
      headers: sessions.owner.headers, body: JSON.stringify(base),
    });
    expect(alternateExpressSpelling.status).toBe(200);

    const truncatedLength = await rawHttpRequest(rawPort, {
      path: pathName, headers: sessions.owner.headers, body: JSON.stringify(base),
      contentLength: Buffer.byteLength(JSON.stringify(base), 'utf8') - 1,
    });
    expect(truncatedLength.status).not.toBe(200);
  }, 180000);

  test('binds the zero-write marker to strict raw identity and actual Express route reachability', async () => {
    const pathName = `/api/v1/canonical/appointments/${IDS.appointment}/recommendations`;
    const body = JSON.stringify(recommendationBody(pins));
    const protectedTargets = [
      pathName,
      `/API/V1/CANONICAL/APPOINTMENTS/${IDS.appointment.toUpperCase()}/RECOMMENDATIONS/?raw=query`,
      `http://northstar.invalid${pathName}`,
      `https://user:password@northstar.invalid:443${pathName}?proxy=true`,
      `http://user%3Apassword@northstar.invalid${pathName}`,
      `http://[2001:db8::1]:8080${pathName}`,
      ...['!', '$', '&', '(', ')', '*', '+', ',', '=']
        .map(delimiter => `http://exa${delimiter}mple.invalid${pathName}`),
      `/api/v1/canonical/appointments/${IDS.appointment}%2Fchild/recommendations`,
      `/api/v1/canonical/appointments/${IDS.appointment}%5Cchild/recommendations`,
    ];
    for (const target of protectedTargets) {
      const before = await durableRequestAuditSignal(migrationPool);
      const response = await rawHttpRequest(rawPort, { path: target, body });
      expect(response.status).toBe(401);
      expect({ target, headers: response.headers }).toEqual({
        target,
        headers: expect.objectContaining({
          'content-security-policy': expect.any(String),
          'x-content-type-options': 'nosniff',
          'cache-control': expect.stringContaining('no-store'),
        }),
      });
      await waitForAuditFinish();
      expect(await durableRequestAuditSignal(migrationPool)).toBe(before);
    }

    const ordinarySibling = `/api/v1/canonical/not-a-real-route`;
    const unprotectedTargets = [
      { path: ordinarySibling, status: 404, noStore: true, auditDelta: 1 },
      { path: `http://northstar.invalid/api/v1/canonical/ignored/../appointments/${IDS.appointment}/recommendations`, status: 404, noStore: true, auditDelta: 1 },
      { path: `http://northstar.invalid/api/v1/canonical/ignored/%2e%2e/appointments/${IDS.appointment}/recommendations`, status: 404, noStore: true, auditDelta: 1 },
      { path: `/api%2Fv1%2Fcanonical%2Fappointments%2F${IDS.appointment}%2Frecommendations`, status: 404, noStore: false, auditDelta: 0 },
      { path: `${ordinarySibling}?next=${encodeURIComponent(pathName)}`, status: 404, noStore: true, auditDelta: 1 },
      { path: `/api/v1/canonical/appointments\\${IDS.appointment}\\recommendations`, status: 404, noStore: true, auditDelta: 1 },
      { path: `/api/v1/canonical//appointments/${IDS.appointment}/recommendations`, status: 500, noStore: true, auditDelta: 1 },
      { path: `${pathName}#fragment`, status: 500, noStore: true, auditDelta: 1 },
      { path: `http:///api/v1/canonical/appointments/${IDS.appointment}/recommendations`, status: 500, noStore: true, auditDelta: 1 },
      { path: `http://one.invalid@two.invalid@three.invalid${pathName}`, status: 500, noStore: true, auditDelta: 1 },
      { path: `http://%65xample.invalid${pathName}`, status: 404, noStore: false, auditDelta: 0 },
      { path: `http://exa;mple.invalid${pathName}`, status: 404, noStore: false, auditDelta: 0 },
      { path: `http://exa'mple.invalid${pathName}`, status: 404, noStore: false, auditDelta: 0 },
      { path: `http://northstar.invalid/api/v1/canonical/appointments\\${IDS.appointment}\\recommendations`, status: 500, noStore: true, auditDelta: 1 },
      { path: `/api/v1/canonical/appointments/%zz/recommendations`, status: 400, noStore: true, auditDelta: 1 },
    ];
    for (const target of unprotectedTargets) {
      const before = await durableRequestAuditSignal(migrationPool);
      const response = await rawHttpRequest(rawPort, { path: target.path, body });
      expect(response.status).toBe(target.status);
      expect(response.headers['content-security-policy']).toEqual(expect.any(String));
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      if (target.noStore) expect(response.headers['cache-control']).toContain('no-store');
      await waitForAuditFinish();
      const after = await durableRequestAuditSignal(migrationPool);
      expect({ path: target.path, before, after }).toEqual({
        path: target.path, before, after: before + target.auditDelta,
      });
    }
  }, 180000);

  test('keeps success, error, replay, and concurrency zero-write across every public table', async () => {
    const pathName = `/api/v1/canonical/appointments/${IDS.appointment}/recommendations`;
    const before = await publicTableCounts(migrationPool);
    const absoluteOversized = await rawHttpRequest(rawPort, {
      path: `http://northstar.invalid${pathName}`,
      headers: sessions.owner.headers,
      body: boundedRawBody(pins, 65537),
    });
    expect(absoluteOversized.status).toBe(413);
    expect(absoluteOversized.body.error.code).toBe('M22_RECOMMENDATION_BODY_TOO_LARGE');
    expectSecurityHeaders(absoluteOversized);
    const absoluteDuplicate = await rawHttpRequest(rawPort, {
      path: `http://northstar.invalid@attacker.invalid${pathName}?host-is-not-authority=true`,
      headers: sessions.owner.headers,
      body: `{"expectedRevision":${pins.expectedRevision},"\\u0065xpectedRevision":${pins.expectedRevision},"expectedDigest":"${pins.expectedDigest}","expectedTimeZone":"America/New_York"}`,
    });
    expect(absoluteDuplicate.status).toBe(400);
    expect(absoluteDuplicate.body.error.code).toBe('M22_RECOMMENDATION_AMBIGUOUS_JSON');
    expectSecurityHeaders(absoluteDuplicate);
    const attempts = [
      request(app).post(pathName).set(sessions.owner.headers).send(recommendationBody(pins)),
      request(app).post(pathName).set(sessions.owner.headers).send(recommendationBody(pins)),
      request(app).post(pathName).set(sessions.owner.headers).send(recommendationBody(pins, { providerUrl: 'https://invalid.test' })),
      request(app).post(pathName).set(sessions.owner.headers).send(recommendationBody({ ...pins, expectedDigest: '0'.repeat(64) })),
      request(app).post(pathName).send(recommendationBody(pins)),
      ...Array.from({ length: 8 }, () => request(app).post(pathName)
        .set(sessions.owner.headers).send(recommendationBody(pins))),
    ];
    const responses = await Promise.all(attempts);
    expect(responses.map(response => response.status)).toEqual([
      200, 200, 400, 409, 401, 200, 200, 200, 200, 200, 200, 200, 200,
    ]);
    await waitForAuditFinish();
    expect(await publicTableCounts(migrationPool)).toEqual(before);
  }, 180000);

  test('does not weaken durable auditing for the neighboring conflicts POST', async () => {
    const before = Number((await migrationPool.query('SELECT count(*) AS count FROM public.audit_logs')).rows[0].count);
    const response = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/conflicts`)
      .set(sessions.owner.headers).send({});
    expect(response.status).toBe(428);
    await waitForAuditFinish();
    const after = Number((await migrationPool.query('SELECT count(*) AS count FROM public.audit_logs')).rows[0].count);
    expect(after).toBe(before + 1);
  }, 120000);

  test('recomputes the same candidate/evidence ordering while canonically pinning each evaluation time', async () => {
    const second = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
      .set(sessions.owner.headers)
      .send(recommendationBody(pins));
    expect(second.status).toBe(200);
    expect(second.body.data.alternatives.map(value => [value.candidate.kind, value.candidate.id]))
      .toEqual(firstRecommendation.data.alternatives.map(value => [value.candidate.kind, value.candidate.id]));
    expect(second.body.data.candidateSetPins).toEqual(firstRecommendation.data.candidateSetPins);
    expect(second.body.data.assignmentPins).toEqual(firstRecommendation.data.assignmentPins);
    expect(second.body.data.businessProfilePins).toEqual(firstRecommendation.data.businessProfilePins);
    expect(second.body.data.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const { digest, ...canonical } = second.body.data;
    expect(digest).toBe(stableSha256(canonical));
  }, 120000);

  test('enforces mounted auth/session/role/subscription/tenant/IDOR and rejects smuggled authority', async () => {
    const pathName = `/api/v1/canonical/appointments/${IDS.appointment}/recommendations`;
    const unauthenticated = await request(app).post(pathName).send(recommendationBody(pins));
    expect(unauthenticated.status).toBe(401);

    const employee = await request(app).post(pathName).set(sessions.employee.headers).send(recommendationBody(pins));
    expect(employee.status).toBe(403);
    const viewer = await request(app).post(pathName).set(sessions.viewer.headers).send(recommendationBody(pins));
    expect(viewer.status).toBe(403);

    const crossTenant = await request(app).post(pathName).set(sessions.other.headers).send(recommendationBody(pins));
    expect(crossTenant.status).toBe(404);
    const hiddenDemo = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.demoAppointment}/recommendations`)
      .set(sessions.owner.headers)
      .send(recommendationBody(await assignmentPins(runtimePool, IDS.demoAppointment)));
    expect(hiddenDemo.status).toBe(404);
    for (const headers of [
      { 'X-NorthStar-Session-ID': 'demo-session' },
      { 'X-Session-ID': 'demo-session' },
      { 'x-northstar-session-id': 'demo-session', 'x-session-id': sessions.owner.sessionId },
    ]) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const forged = await request(app)
          .post(`/api/v1/canonical/appointments/${IDS.demoAppointment}/recommendations`)
          .set(sessions.owner.headers).set(headers)
          .send(recommendationBody(await assignmentPins(runtimePool, IDS.demoAppointment)));
        expect(forged.status).toBe(404);
        expect(forged.body).toEqual(hiddenDemo.body);
      }
    }
    const paidWithForgedHeader = await request(app).post(pathName)
      .set(sessions.owner.headers).set('X-NorthStar-Session-ID', 'demo-session')
      .send(recommendationBody(pins));
    expect(paidWithForgedHeader.status).toBe(200);

    for (const payload of [
      { tenantId: IDS.otherOrganization }, { actorUserId: IDS.owner }, { role: 'owner' },
      { candidateIds: [IDS.owner] }, { recommendationDigest: 'f'.repeat(64) },
      { providerUrl: 'https://attacker.invalid/route' }, { providerTimeoutMs: 1 },
      { providerError: 'pretend-success' }, { routeEvidence: 'x'.repeat(60000) },
    ]) {
      const rejected = await request(app).post(pathName).set(sessions.owner.headers)
        .send(recommendationBody(pins, payload));
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe('INVALID_RECOMMENDATION_REQUEST');
    }
    const oversized = await request(app).post(pathName).set(sessions.owner.headers)
      .send(recommendationBody(pins, { routeEvidence: 'x'.repeat(70000) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('M22_RECOMMENDATION_BODY_TOO_LARGE');

    await runtimePool.query(
      `UPDATE public.workforce_profiles SET operational_role='employee'
        WHERE organization_id=$1 AND id=$2`, [IDS.organization, IDS.dispatcher]
    );
    const downgraded = await request(app).post(pathName).set(sessions.dispatcher.headers).send(recommendationBody(pins));
    expect(downgraded.status).toBe(403);
    await runtimePool.query(
      `UPDATE public.workforce_profiles SET operational_role='dispatcher'
        WHERE organization_id=$1 AND id=$2`, [IDS.organization, IDS.dispatcher]
    );

    await runtimePool.query(`UPDATE public.subscriptions SET status='canceled' WHERE organization_id=$1`, [IDS.organization]);
    const readOnly = await request(app).post(pathName).set(sessions.owner.headers).send(recommendationBody(pins));
    expect(readOnly.status).toBe(403);
    await runtimePool.query(`UPDATE public.subscriptions SET status='active' WHERE organization_id=$1`, [IDS.organization]);

    await runtimePool.query(
      `UPDATE public.auth_sessions
          SET status='revoked',revoked_at=NOW(),revoke_reason='m22_part3_test'
        WHERE id=$1`, [sessions.owner.sessionId]
    );
    const revoked = await request(app).post(pathName).set(sessions.owner.headers).send(recommendationBody(pins));
    expect(revoked.status).toBe(401);
    const revokedWithForgedHeader = await request(app).post(pathName).set(sessions.owner.headers)
      .set('X-NorthStar-Session-ID', 'demo-session').send(recommendationBody(pins));
    expect(revokedWithForgedHeader.status).toBe(401);
    await runtimePool.query(
      `UPDATE public.auth_sessions
          SET status='active',revoked_at=NULL,revoke_reason=NULL
        WHERE id=$1`, [sessions.owner.sessionId]
    );
  }, 120000);

  test('rejects stale/divergent pins with oracle-resistant invalid/missing appointment results', async () => {
    const route = `/api/v1/canonical/appointments/${IDS.appointment}/recommendations`;
    const staleRevision = await request(app).post(route).set(sessions.owner.headers)
      .send(recommendationBody({ ...pins, expectedRevision: pins.expectedRevision - 1 }));
    expect(staleRevision.status).toBe(409);
    expect(staleRevision.body.error.code).toBe('M22_RECOMMENDATION_STALE');
    const staleDigest = await request(app).post(route).set(sessions.owner.headers)
      .send(recommendationBody({ ...pins, expectedDigest: '0'.repeat(64) }));
    expect(staleDigest.status).toBe(409);
    const missing = await request(app)
      .post('/api/v1/canonical/appointments/d5000000-0000-4000-8000-ffffffffffff/recommendations')
      .set(sessions.owner.headers).send(recommendationBody(pins));
    expect(missing.status).toBe(404);
    const invalid = await request(app).post('/api/v1/canonical/appointments/not-a-uuid/recommendations')
      .set(sessions.owner.headers).send(recommendationBody(pins));
    expect(invalid.status).toBe(404);
    expect(invalid.body).toEqual(missing.body);
  }, 120000);

  test('inherits overnight, multiday and explicit DST-fold canonical schedule semantics', async () => {
    for (const [appointmentId, authority] of [
      [IDS.overnightAppointment, overnightPins], [IDS.foldAppointment, foldPins],
    ]) {
      const response = await request(app)
        .post(`/api/v1/canonical/appointments/${appointmentId}/recommendations`)
        .set(sessions.owner.headers)
        .send(recommendationBody(authority));
      expect(response.status).toBe(200);
      expect(response.body.data.assignmentPins.scheduleState).toBe('scheduled');
      expect(new Date(response.body.data.assignmentPins.scheduledEnd).getTime())
        .toBeGreaterThan(new Date(response.body.data.assignmentPins.scheduledStart).getTime());
      expect(response.body.data.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(response.body.data.alternatives.length).toBeGreaterThan(0);
    }
    expect(new Date(firstRecommendation.data.assignmentPins.scheduledStart).toISOString())
      .toBe('2027-03-08T15:00:00.000Z');
  }, 120000);

  test('pins origin/destination/profile changes and never reuses a stale route implication', async () => {
    const before = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
      .set(sessions.owner.headers).send(recommendationBody(pins));
    const active = (await runtimePool.query(
      `SELECT version_label,raw_profile FROM public.canonical_business_profiles
        WHERE organization_id=$1 AND is_active=TRUE`, [IDS.organization]
    )).rows[0];
    const changed = JSON.parse(JSON.stringify(active.raw_profile));
    changed.headquarters.latitude = 42.5;
    changed.headquarters.longitude = -71.5;
    await putBusinessProfile(runtimePool, {
      organizationId: IDS.organization,
      userId: IDS.owner,
      expectedVersion: active.version_label,
      profile: changed,
    });
    const after = await request(app)
      .post(`/api/v1/canonical/appointments/${IDS.appointment}/recommendations`)
      .set(sessions.owner.headers).send(recommendationBody(pins));
    expect(after.status).toBe(200);
    expect(after.body.data.businessProfilePins.version).toBe(before.body.data.businessProfilePins.version + 1);
    expect(after.body.data.businessProfilePins.digest).not.toBe(before.body.data.businessProfilePins.digest);
    expect(after.body.data.candidateSetPins.digest).toBe(before.body.data.candidateSetPins.digest);
    expect(after.body.data.digest).not.toBe(before.body.data.digest);
    const ownerBefore = before.body.data.alternatives.find(value => value.candidate.id === IDS.owner);
    const ownerAfter = after.body.data.alternatives.find(value => value.candidate.id === IDS.owner);
    expect(ownerAfter.route.digest).not.toBe(ownerBefore.route.digest);
  }, 120000);

  test('uses a constant bounded query shape and fails closed for a 100-member/truncated candidate set', async () => {
    const extraProfiles = [];
    for (let index = 0; index < 101; index += 1) {
      const id = `db${String(index).padStart(6, '0')}-0000-4000-8000-000000000001`;
      extraProfiles.push(id);
      await runtimePool.query(
        `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
         VALUES ($1,$2,$3,$4,'not-used','member','active')`,
        [id, IDS.organization, `Bounded member ${index}`, `${id}@m22-part3.test`]
      );
      await runtimePool.query(
        `INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status)
         VALUES ($1,$2,$1,'member','active')`, [id, IDS.organization]
      );
      await runtimePool.query(
        `UPDATE public.workforce_profiles SET home_location_id='north',operational_role='technician'
          WHERE organization_id=$1 AND id=$2`, [IDS.organization, id]
      );
      await runtimePool.query(
        `INSERT INTO public.workforce_crew_members
          (organization_id,crew_id,profile_id,crew_role,created_by_user_id)
         VALUES ($1,$2,$3,'member',$4)`, [IDS.organization, IDS.crew, id, IDS.owner]
      );
    }
    let queryCount = 0;
    const countedPool = {
      async connect() {
        const client = await runtimePool.connect();
        return {
          query(...args) { queryCount += 1; return client.query(...args); },
          release() { client.release(); },
        };
      },
    };
    const response = await recommendAppointmentCandidates(countedPool, {
      ...recommendationBody(pins),
      appointmentId: IDS.appointment,
      organizationId: IDS.organization,
      actorUserId: IDS.owner,
      actorAccessRole: 'owner',
      authSessionId: sessions.owner.sessionId,
    });
    expect(queryCount).toBeLessThanOrEqual(18);
    expect(response.data).toMatchObject({
      status: 'needs_review', needsReview: true, rankingComplete: false,
      candidateSetPins: { truncated: true },
    });
    expect(response.data.alternatives).toHaveLength(20);
    const crew = response.data.alternatives.find(value => value.candidate.id === IDS.crew);
    expect(crew).toBeDefined();
    expect(crew.authorityPins).toMatchObject({ memberCount: 100, membersTruncated: true });
    expect(response.data.reviewReasons).toEqual(expect.arrayContaining([
      { code: 'candidate_set_bounded' }, { code: 'recommendation_evidence_incomplete' },
    ]));
    expect(Buffer.byteLength(JSON.stringify(response.data), 'utf8')).toBeLessThanOrEqual(256 * 1024);
  }, 180000);
});
