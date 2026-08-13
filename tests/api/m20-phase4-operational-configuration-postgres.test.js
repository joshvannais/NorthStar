'use strict';

const crypto = require('crypto');
const https = require('https');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '9a000000-0000-4000-8000-000000000001';
const ORG_B = '9a000000-0000-4000-8000-000000000002';
const ORG_DRAFT = '9a000000-0000-4000-8000-000000000003';
const OWNER_A = '9b000000-0000-4000-8000-000000000001';
const ADMIN_A = '9b000000-0000-4000-8000-000000000002';
const MEMBER_A = '9b000000-0000-4000-8000-000000000003';
const VIEWER_A = '9b000000-0000-4000-8000-000000000004';
const OWNER_B = '9b000000-0000-4000-8000-000000000005';
const DRAFT_OWNER = '9b000000-0000-4000-8000-000000000006';
const WORKFORCE_CREW = '9c000000-0000-4000-8000-000000000001';
const ASSET = '9d000000-0000-4000-8000-000000000001';
const UNKNOWN_MARKER = '  保留🧭 operational <literal>\r\ne\u0301  ';
const LEGACY_LEAD_TIME = '  legacy lead time 0️⃣ <raw>  ';

function rawProfile(name) {
  const value = canonicalFenceProfile({ companyName: name });
  value.routing = {
    dispatchFrom: 'headquarters', trafficEnabled: true, useLiveTraffic: false,
    avoidTolls: false, avoidHighways: false, avoidFerries: true,
    preferredProvider: 'waze', futureRouting: UNKNOWN_MARKER,
  };
  value.crew = {
    ...value.crew, defaultCrewSize: 2, maxCrewSize: 5, shopTime: 0,
    travelPay: 0, minimumBillableHours: 0.5, futureCrew: UNKNOWN_MARKER,
  };
  value.vehicles = {
    truckCount: 0, trailerCount: null, averageMpg: 12.5, equipmentTransportCapacity: 0,
    averageFuelCost: 0, hourlyVehicleCost: 0, maintenanceReserve: 0,
    futureVehicle: UNKNOWN_MARKER,
  };
  value.scheduling = {
    maxJobsPerDay: 4, travelBuffer: 0, appointmentBuffer: null,
    workDayLength: 8.5, maxDailyTravel: 0, preferredDispatchStrategy: 'balanced',
    leadTimeHours: LEGACY_LEAD_TIME, futureScheduling: UNKNOWN_MARKER,
  };
  value.voiceAssistant = { name: 'North', greeting: UNKNOWN_MARKER, personality: 'professional' };
  value.retell = { providerPrivate: UNKNOWN_MARKER };
  value.financial.futureFinancial = UNKNOWN_MARKER;
  value.policies = { operations: UNKNOWN_MARKER };
  return value;
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

realPostgres('Mission 20 Phase 4 mounted Operational Configuration authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let db;
  let pool;
  let app;
  let sessions;
  let otherAuthority;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-phase4-operational-configuration');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    const identity = (await pool.query(
      "SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums"
    )).rows[0];
    expect(identity).toEqual({ version: '18.4', timezone: 'UTC', checksums: 'on' });

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 4 Organization A','phase4-a@example.test'),
       ($2,'Phase 4 Organization B','phase4-b@example.test'),
       ($3,'Phase 4 Draft Organization','phase4-draft@example.test')`,
      [ORG_A, ORG_B, ORG_DRAFT]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'], [DRAFT_OWNER, ORG_DRAFT, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase4.test`, role]
      );
    }

    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, expectedVersion: null,
      profile: rawProfile('Phase 4 Company'),
    });
    otherAuthority = await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, expectedVersion: null,
      profile: rawProfile('Other Tenant'),
    });

    sessions = {};
    for (const [role, userId, organizationId] of [
      ['owner', OWNER_A, ORG_A], ['admin', ADMIN_A, ORG_A], ['member', MEMBER_A, ORG_A],
      ['viewer', VIEWER_A, ORG_A], ['otherOwner', OWNER_B, ORG_B], ['draftOwner', DRAFT_OWNER, ORG_DRAFT],
    ]) {
      sessions[role] = await provisionDurableSession(pool, {
        userId, organizationId, role: role === 'otherOwner' || role === 'draftOwner' ? 'owner' : role,
      });
    }

    await pool.query(
      `INSERT INTO workforce_crews
         (id, organization_id, crew_key, name, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,'crew-alpha','Normalized Crew Identity',$3,$3)`,
      [WORKFORCE_CREW, ORG_A, OWNER_A]
    );
    await pool.query(
      `INSERT INTO tenant_assets
         (id, organization_id, category, name, internal_reference, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,'equipment','Normalized Asset Identity','phase4-asset',$3,$3)`,
      [ASSET, ORG_A, OWNER_A]
    );
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
    try {
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalAccessSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
      else process.env.AUTH_ACCESS_SECRET = originalAccessSecret;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('GET projects recognized authority and the dedicated versioned write preserves every unrelated raw authority', async () => {
    const beforeRows = {
      crew: (await pool.query('SELECT row_to_json(workforce_crews) AS row FROM workforce_crews WHERE id = $1', [WORKFORCE_CREW])).rows[0].row,
      asset: (await pool.query('SELECT row_to_json(tenant_assets) AS row FROM tenant_assets WHERE id = $1', [ASSET])).rows[0].row,
      other: (await pool.query('SELECT id, version_label, raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B])).rows[0],
      ownership: (await pool.query('SELECT count(*)::int AS count FROM canonical_integration_ownership')).rows[0].count,
    };
    const loaded = await request(app).get('/api/v1/business-profile/operationalConfiguration').set(sessions.owner.headers);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data).toEqual(expect.objectContaining({
      routing: {
        dispatchFrom: 'headquarters', trafficEnabled: true, useLiveTraffic: false,
        avoidTolls: false, avoidHighways: false, avoidFerries: true,
      },
      crew: { defaultCrewSize: 2, maxCrewSize: 5, shopTime: 0 },
      vehicles: { truckCount: 0, trailerCount: null, averageMpg: 12.5, equipmentTransportCapacity: 0 },
      scheduling: {
        maxJobsPerDay: 4, travelBuffer: 0, appointmentBuffer: null,
        workDayLength: 8.5, maxDailyTravel: 0, preferredDispatchStrategy: 'balanced',
      },
      canonicalAuthority: expect.objectContaining({ version: 'org-profile-v1', hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
    expect(JSON.stringify(loaded.body.data)).not.toContain(UNKNOWN_MARKER);
    expect(JSON.stringify(loaded.body.data)).not.toContain('preferredProvider');
    expect(JSON.stringify(loaded.body.data)).not.toContain('leadTimeHours');
    expect(JSON.stringify(loaded.body.data)).not.toContain('Normalized Crew Identity');
    expect(JSON.stringify(loaded.body.data)).not.toContain('Normalized Asset Identity');

    const originalFetch = global.fetch;
    const fetchSpy = jest.fn(() => { throw new Error('provider fetch boundary reached'); });
    global.fetch = fetchSpy;
    const httpsSpy = jest.spyOn(https, 'request').mockImplementation(() => { throw new Error('provider https boundary reached'); });
    let saved;
    try {
      saved = await request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.owner.headers).send({
        expectedVersion: loaded.body.data.canonicalAuthority.version,
        value: {
          routing: { dispatchFrom: 'assigned-crew', trafficEnabled: false },
          crew: { defaultCrewSize: 0 + 3, shopTime: null },
          vehicles: { truckCount: 0, trailerCount: 2 },
          scheduling: { travelBuffer: 0, preferredDispatchStrategy: '' },
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
    } finally {
      httpsSpy.mockRestore();
      global.fetch = originalFetch;
    }
    expect(saved.status).toBe(200);
    expect(saved.body.data.routing).toEqual(expect.objectContaining({
      dispatchFrom: 'assigned-crew', trafficEnabled: false,
      preferredProvider: 'waze', futureRouting: UNKNOWN_MARKER,
    }));
    expect(saved.body.data.crew).toEqual(expect.objectContaining({
      defaultCrewSize: 3, maxCrewSize: 5, shopTime: null,
      averageHourlyRate: 42, travelPay: 0, minimumBillableHours: 0.5, futureCrew: UNKNOWN_MARKER,
    }));
    expect(saved.body.data.vehicles).toEqual(expect.objectContaining({
      truckCount: 0, trailerCount: 2, averageFuelCost: 0,
      hourlyVehicleCost: 0, maintenanceReserve: 0, futureVehicle: UNKNOWN_MARKER,
    }));
    expect(saved.body.data.scheduling).toEqual(expect.objectContaining({
      travelBuffer: 0, leadTimeHours: LEGACY_LEAD_TIME, futureScheduling: UNKNOWN_MARKER,
    }));
    expect(saved.body.data.voiceAssistant.greeting).toBe(UNKNOWN_MARKER);
    expect(saved.body.data.retell.providerPrivate).toBe(UNKNOWN_MARKER);
    expect(saved.body.data.policies.operations).toBe(UNKNOWN_MARKER);

    const stored = (await pool.query(
      `SELECT raw_profile,
              normalized_profile -> 'operationalConfiguration' AS operational,
              normalized_profile_hash,
              encode(convert_to(raw_profile #>> '{routing,futureRouting}', 'UTF8'), 'hex') AS routing_hex,
              encode(convert_to(raw_profile #>> '{scheduling,leadTimeHours}', 'UTF8'), 'hex') AS lead_time_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS voice_hex,
              encode(convert_to(raw_profile #>> '{financial,futureFinancial}', 'UTF8'), 'hex') AS financial_hex
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    expect(stored.routing_hex).toBe(hex(UNKNOWN_MARKER));
    expect(stored.lead_time_hex).toBe(hex(LEGACY_LEAD_TIME));
    expect(stored.voice_hex).toBe(hex(UNKNOWN_MARKER));
    expect(stored.financial_hex).toBe(hex(UNKNOWN_MARKER));
    expect(stored.normalized_profile_hash).toBe(saved.body.data.canonicalAuthority.hash);
    expect(stored.operational).toEqual(expect.objectContaining({
      routing: expect.objectContaining({ dispatchFrom: 'assigned-crew', trafficEnabled: false }),
      crew: expect.objectContaining({ defaultCrewSize: 3, shopTime: null }),
      vehicles: expect.objectContaining({ truckCount: 0, trailerCount: 2 }),
      scheduling: expect.objectContaining({ travelBuffer: 0, preferredDispatchStrategy: '' }),
    }));
    expect((await pool.query('SELECT row_to_json(workforce_crews) AS row FROM workforce_crews WHERE id = $1', [WORKFORCE_CREW])).rows[0].row).toEqual(beforeRows.crew);
    expect((await pool.query('SELECT row_to_json(tenant_assets) AS row FROM tenant_assets WHERE id = $1', [ASSET])).rows[0].row).toEqual(beforeRows.asset);
    expect((await pool.query('SELECT id, version_label, raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B])).rows[0]).toEqual(beforeRows.other);
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_integration_ownership')).rows[0].count).toBe(beforeRows.ownership);
  }, 30000);

  test('strict contract, permissions, tenant isolation, stale and concurrent writes fail closed without advancing invalid versions', async () => {
    const loaded = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    const startingVersion = loaded.body.data.canonicalAuthority.version;
    const startingCount = (await pool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count;
    for (const body of [
      { value: {} },
      { expectedVersion: startingVersion },
      { expectedVersion: startingVersion, value: {}, extra: true },
      { expectedVersion: 'not-a-version', value: {} },
      { expectedVersion: startingVersion, value: [] },
      { expectedVersion: startingVersion, value: { company: {} } },
      { expectedVersion: startingVersion, value: { routing: [] } },
      { expectedVersion: startingVersion, value: { routing: { preferredProvider: 'google-maps' } } },
      { expectedVersion: startingVersion, value: { crew: { averageHourlyRate: 99 } } },
      { expectedVersion: startingVersion, value: { scheduling: { leadTimeHours: 24 } } },
      { expectedVersion: startingVersion, value: { vehicles: { truckCount: -1 } } },
      { expectedVersion: startingVersion, value: { crew: { defaultCrewSize: 6 } } },
    ]) {
      const denied = await request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.owner.headers).send(body);
      expect(denied.status).toBe(400);
      expect(denied.body.error.code).toBe('INVALID_OPERATIONAL_CONFIGURATION_WRITE');
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(startingCount);

    for (const role of ['member', 'viewer']) {
      expect((await request(app).get('/api/v1/business-profile/operationalConfiguration').set(sessions[role].headers)).status).toBe(200);
      const denied = await request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions[role].headers).send({
        expectedVersion: startingVersion, value: { scheduling: { travelBuffer: 1 } },
      });
      expect(denied.status).toBe(403);
    }
    expect((await request(app).put('/api/v1/business-profile/operationalConfiguration').send({
      expectedVersion: startingVersion, value: {},
    })).status).toBe(401);
    const badCsrf = { ...sessions.owner.headers, 'X-CSRF-Token': 'forged' };
    expect((await request(app).put('/api/v1/business-profile/operationalConfiguration').set(badCsrf).send({
      expectedVersion: startingVersion, value: {},
    })).status).toBe(403);

    const adminAdvance = await request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.admin.headers).send({
      expectedVersion: startingVersion, value: { scheduling: { travelBuffer: 2 } },
    });
    expect(adminAdvance.status).toBe(200);
    const beforeStaleCount = (await pool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count;
    const stale = await request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.owner.headers).send({
      expectedVersion: startingVersion, value: { scheduling: { travelBuffer: 3 } },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toEqual({ code: 'BUSINESS_PROFILE_VERSION_CONFLICT', message: 'Business Profile changed; reload and try again.' });
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(beforeStaleCount);

    const raceVersion = adminAdvance.body.data.canonicalAuthority.version;
    const race = await Promise.all([
      request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.owner.headers).send({
        expectedVersion: raceVersion, value: { vehicles: { truckCount: 1 } },
      }),
      request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.admin.headers).send({
        expectedVersion: raceVersion, value: { vehicles: { truckCount: 2 } },
      }),
    ]);
    expect(race.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(beforeStaleCount + 1);
    expect((await pool.query('SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B])).rows[0].id).toBe(otherAuthority.id);
  }, 30000);

  test('whole and section APIs require exact envelopes and enforce versions', async () => {
    const loaded = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    const legacyRaw = JSON.parse(JSON.stringify(loaded.body.data));
    delete legacyRaw.canonicalAuthority;
    legacyRaw.company.dba = 'Legacy raw body';
    const bareWhole = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send(legacyRaw);
    expect(bareWhole.status).toBe(400);
    expect(bareWhole.body.error.code).toBe('INVALID_BUSINESS_PROFILE_WRITE');
    const legacySaved = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send({
      expectedVersion: loaded.body.data.canonicalAuthority.version,
      value: legacyRaw,
    });
    expect(legacySaved.status).toBe(200);
    expect(legacySaved.body.data.company.dba).toBe('Legacy raw body');

    const sectionValue = { ...legacySaved.body.data.company, dba: 'Legacy section body' };
    const bareSection = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send(sectionValue);
    expect(bareSection.status).toBe(400);
    expect(bareSection.body.error.code).toBe('INVALID_BUSINESS_PROFILE_SECTION_WRITE');
    const sectionSaved = await request(app).put('/api/v1/business-profile/company').set(sessions.owner.headers).send({
      expectedVersion: legacySaved.body.data.canonicalAuthority.version,
      value: sectionValue,
    });
    expect(sectionSaved.status).toBe(200);
    expect(sectionSaved.body.data.company.dba).toBe('Legacy section body');

    const versionedValue = JSON.parse(JSON.stringify(sectionSaved.body.data));
    delete versionedValue.canonicalAuthority;
    versionedValue.company.dba = 'Versioned whole body';
    const versionedSaved = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send({
      expectedVersion: sectionSaved.body.data.canonicalAuthority.version,
      value: versionedValue,
    });
    expect(versionedSaved.status).toBe(200);
    expect(versionedSaved.body.data.company.dba).toBe('Versioned whole body');

    const beforeStaleCount = (await pool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count;
    const stale = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send({
      expectedVersion: sectionSaved.body.data.canonicalAuthority.version,
      value: versionedValue,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(beforeStaleCount);

    for (const malformed of [
      { expectedVersion: versionedSaved.body.data.canonicalAuthority.version },
      { value: versionedValue },
      { expectedVersion: 'bad', value: versionedValue },
      { expectedVersion: versionedSaved.body.data.canonicalAuthority.version, value: [], extra: true },
    ]) {
      const response = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send(malformed);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_BUSINESS_PROFILE_WRITE');
    }

    const draft = await request(app).get('/api/v1/business-profile/operationalConfiguration').set(sessions.draftOwner.headers);
    expect(draft.status).toBe(200);
    expect(draft.body.onboardingDraft).toBe(true);
    expect(draft.body.data).toEqual(expect.objectContaining({
      canonicalAuthority: null, onboardingDraft: true,
      routing: expect.objectContaining({ dispatchFrom: '', trafficEnabled: false }),
      crew: expect.objectContaining({ defaultCrewSize: null, maxCrewSize: null, shopTime: null }),
      vehicles: expect.objectContaining({ truckCount: null, trailerCount: null, averageMpg: null, equipmentTransportCapacity: null }),
      scheduling: expect.objectContaining({ maxJobsPerDay: null, travelBuffer: null, workDayLength: null, preferredDispatchStrategy: '' }),
    }));
  }, 30000);
});
