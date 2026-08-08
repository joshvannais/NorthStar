'use strict';

const crypto = require('crypto');
const https = require('https');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = 'aa000000-0000-4000-8000-000000000001';
const ORG_B = 'aa000000-0000-4000-8000-000000000002';
const ORG_DRAFT = 'aa000000-0000-4000-8000-000000000003';
const ORG_UNVERSIONED = 'aa000000-0000-4000-8000-000000000004';
const OWNER_A = 'ab000000-0000-4000-8000-000000000001';
const ADMIN_A = 'ab000000-0000-4000-8000-000000000002';
const MEMBER_A = 'ab000000-0000-4000-8000-000000000003';
const VIEWER_A = 'ab000000-0000-4000-8000-000000000004';
const OWNER_B = 'ab000000-0000-4000-8000-000000000005';
const DRAFT_OWNER = 'ab000000-0000-4000-8000-000000000006';
const UNVERSIONED_OWNER = 'ab000000-0000-4000-8000-000000000007';
const UNKNOWN = '  financial <literal> 保留😀\r\ne\u0301  ';

function rawProfile(name) {
  const value = canonicalFenceProfile({ companyName: name });
  value.canonicalPricing = {
    ...value.canonicalPricing,
    desiredGrossMarginPercent: 0,
    defaultRangePercent: 0,
    futurePricing: UNKNOWN,
  };
  delete value.canonicalPricing.desiredNetMarginPercent;
  delete value.canonicalPricing.maximumDiscountPercent;
  value.canonicalCosts = {
    ...value.canonicalCosts,
    materialCostByService: { fence: 0 },
    equipmentCostByReference: {},
    futureCosts: UNKNOWN,
  };
  value.crew = {
    ...value.crew,
    averageHourlyRate: 0,
    overtimeMultiplier: 1,
    travelPay: null,
    minimumBillableHours: 0,
    futureCrew: UNKNOWN,
  };
  value.vehicles = {
    averageFuelCost: 0,
    hourlyVehicleCost: null,
    maintenanceReserve: 100,
    futureVehicle: UNKNOWN,
  };
  value.financial = {
    ...value.financial,
    desiredGrossMargin: 88,
    desiredNetMargin: 15,
    maximumDiscount: 0,
    unknownLegacy: UNKNOWN,
  };
  value.routing = { preferredProvider: 'waze', futureRouting: UNKNOWN };
  value.scheduling = { leadTimeHours: 24, futureScheduling: UNKNOWN };
  value.voiceAssistant = { name: 'North', greeting: UNKNOWN, personality: 'professional' };
  value.retell = { providerPrivate: UNKNOWN };
  value.policies = { financialBoundary: UNKNOWN };
  return value;
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

realPostgres('Mission 20 Phase 5 mounted Financial Configuration authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let db;
  let pool;
  let app;
  let sessions;
  let otherAuthority;
  let putBusinessProfile;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-phase5-financial-configuration');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    expect((await pool.query(
      "SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums"
    )).rows[0]).toEqual({ version: '18.4', timezone: 'UTC', checksums: 'on' });

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 5 Organization A','phase5-a@example.test'),
       ($2,'Phase 5 Organization B','phase5-b@example.test'),
       ($3,'Phase 5 Draft Organization','phase5-draft@example.test'),
       ($4,'Phase 5 Unversioned Organization','phase5-unversioned@example.test')`,
      [ORG_A, ORG_B, ORG_DRAFT, ORG_UNVERSIONED]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'], [DRAFT_OWNER, ORG_DRAFT, 'owner'],
      [UNVERSIONED_OWNER, ORG_UNVERSIONED, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase5.test`, role]
      );
    }
    ({ putBusinessProfile } = require('../../src/services/organizationAuthority'));
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: rawProfile('Phase 5 Company') });
    otherAuthority = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: rawProfile('Other Tenant') });
    sessions = {};
    for (const [role, userId, organizationId] of [
      ['owner', OWNER_A, ORG_A], ['admin', ADMIN_A, ORG_A], ['member', MEMBER_A, ORG_A],
      ['viewer', VIEWER_A, ORG_A], ['otherOwner', OWNER_B, ORG_B], ['draftOwner', DRAFT_OWNER, ORG_DRAFT],
      ['unversionedOwner', UNVERSIONED_OWNER, ORG_UNVERSIONED],
    ]) {
      sessions[role] = await provisionDurableSession(pool, {
        userId,
        organizationId,
        role: role === 'otherOwner' || role === 'draftOwner' || role === 'unversionedOwner' ? 'owner' : role,
      });
    }
    ({ app } = require('../../src/server'));
  }, 60000);

  beforeEach(async () => {
    await pool.query('DELETE FROM organization_onboarding WHERE organization_id = $1', [ORG_A]);
    await pool.query('DELETE FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A]);
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: rawProfile('Phase 5 Company') });
  });

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

  test('GET projects recognized fields and a versioned write preserves unrelated PostgreSQL bytes with zero provider calls', async () => {
    const otherBefore = (await pool.query(
      'SELECT id, version_label, raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE',
      [ORG_B]
    )).rows[0];
    const loaded = await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data).toEqual(expect.objectContaining({
      canonicalPricing: expect.objectContaining({
        desiredGrossMarginPercent: 0,
        desiredNetMarginPercent: 15,
        maximumDiscountPercent: 0,
        defaultRangePercent: 0,
      }),
      canonicalCosts: expect.objectContaining({
        materialCostByService: { fence: 0 },
        equipmentCostByReference: {},
      }),
      crew: {
        averageHourlyRate: 0,
        overtimeMultiplier: 1,
        travelPay: null,
        minimumBillableHours: 0,
      },
      vehicles: {
        averageFuelCost: 0,
        hourlyVehicleCost: null,
        maintenanceReserve: 100,
      },
      canonicalAuthority: expect.objectContaining({
        version: 'org-profile-v1',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        legacyMigration: expect.objectContaining({ pending: true }),
      }),
    }));
    expect(JSON.stringify(loaded.body.data)).not.toContain(UNKNOWN);
    expect(loaded.body.data.canonicalPricing.futurePricing).toBeUndefined();

    const originalFetch = global.fetch;
    const fetchSpy = jest.fn(() => { throw new Error('provider fetch boundary reached'); });
    global.fetch = fetchSpy;
    const httpsSpy = jest.spyOn(https, 'request').mockImplementation(() => { throw new Error('provider https boundary reached'); });
    let saved;
    try {
      saved = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers).send({
        expectedVersion: loaded.body.data.canonicalAuthority.version,
        value: {
          canonicalPricing: {
            customerMarkupPercent: 0,
            taxRatePercent: 0,
            emergencyMultiplier: 0,
            travelCustomerChargePerMile: 0,
            minimumJobPrice: 0,
            desiredGrossMarginPercent: 40,
            desiredNetMarginPercent: 0,
            maximumDiscountPercent: 0,
            defaultRangePercent: 0,
          },
          canonicalCosts: {
            overheadPercent: 0,
            travelCostPerMile: 0,
            materialCostByService: {},
            equipmentCostByReference: { truck: 0 },
          },
          crew: {
            averageHourlyRate: 0,
            overtimeMultiplier: 1,
            minimumBillableHours: 0,
          },
          vehicles: {
            averageFuelCost: 0,
            hourlyVehicleCost: 0,
            maintenanceReserve: 0,
          },
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
    } finally {
      httpsSpy.mockRestore();
      global.fetch = originalFetch;
    }
    expect(saved.status).toBe(200);
    expect(saved.body.data.canonicalAuthority.version).toBe('org-profile-v2');
    expect(saved.body.data.crew).toEqual({ averageHourlyRate: 0, overtimeMultiplier: 1, minimumBillableHours: 0 });
    expect(saved.body.data.canonicalPricing.defaultRangePercent).toBe(0);

    const stored = (await pool.query(
      `SELECT raw_profile, normalized_profile_hash,
              encode(convert_to(raw_profile #>> '{canonicalPricing,futurePricing}', 'UTF8'), 'hex') AS pricing_hex,
              encode(convert_to(raw_profile #>> '{canonicalCosts,futureCosts}', 'UTF8'), 'hex') AS costs_hex,
              encode(convert_to(raw_profile #>> '{crew,futureCrew}', 'UTF8'), 'hex') AS crew_hex,
              encode(convert_to(raw_profile #>> '{vehicles,futureVehicle}', 'UTF8'), 'hex') AS vehicle_hex,
              encode(convert_to(raw_profile #>> '{financial,unknownLegacy}', 'UTF8'), 'hex') AS legacy_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS voice_hex,
              encode(convert_to(raw_profile #>> '{retell,providerPrivate}', 'UTF8'), 'hex') AS retell_hex
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    for (const field of ['pricing_hex', 'costs_hex', 'crew_hex', 'vehicle_hex', 'legacy_hex', 'voice_hex', 'retell_hex']) {
      expect(stored[field]).toBe(hex(UNKNOWN));
    }
    expect(stored.raw_profile.routing.futureRouting).toBe(UNKNOWN);
    expect(stored.raw_profile.scheduling.futureScheduling).toBe(UNKNOWN);
    expect(stored.raw_profile.policies.financialBoundary).toBe(UNKNOWN);
    expect(stored.raw_profile.financial.desiredGrossMargin).toBe(88);
    expect(stored.raw_profile.financial.desiredNetMargin).toBe(15);
    expect(stored.raw_profile.financial.maximumDiscount).toBe(0);
    expect(stored.normalized_profile_hash).toBe(saved.body.data.canonicalAuthority.hash);
    expect((await pool.query(
      'SELECT id, version_label, raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE',
      [ORG_B]
    )).rows[0]).toEqual(otherBefore);
    expect(otherBefore.id).toBe(otherAuthority.id);
  }, 30000);

  test('strict envelopes, roles, tenants, stale and concurrent writes fail closed without invalid version advances', async () => {
    const loaded = await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers);
    const startingVersion = loaded.body.data.canonicalAuthority.version;
    const count = async () => (await pool.query(
      'SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A]
    )).rows[0].count;
    const startingCount = await count();
    for (const body of [
      { value: { canonicalPricing: {} } },
      { expectedVersion: startingVersion },
      { expectedVersion: startingVersion, value: {}, extra: true },
      { expectedVersion: startingVersion, value: {} },
      { expectedVersion: '12', value: { canonicalPricing: {} } },
      { expectedVersion: startingVersion, value: [] },
      { expectedVersion: startingVersion, value: { company: {} } },
      { expectedVersion: startingVersion, value: { canonicalPricing: [] } },
      { expectedVersion: startingVersion, value: { canonicalPricing: { taxRatePercnt: 5 } } },
      { expectedVersion: startingVersion, value: { canonicalPricing: { taxRatePercent: null } } },
      { expectedVersion: startingVersion, value: { canonicalPricing: { defaultRangePercent: 101 } } },
      { expectedVersion: startingVersion, value: { canonicalPricing: { desiredGrossMarginPercent: 10, desiredNetMarginPercent: 11 } } },
      { expectedVersion: startingVersion, value: { canonicalCosts: { materialCostByService: { '': 1 } } } },
      { expectedVersion: startingVersion, value: { crew: { averageHourlyRate: '0' } } },
      { expectedVersion: startingVersion, value: { vehicles: { maintenanceReserve: -1 } } },
      { expectedVersion: startingVersion, value: { vehicles: { truckCount: 1 } } },
    ]) {
      const denied = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers).send(body);
      expect(denied.status).toBe(400);
      expect(denied.body.error.code).toBe('INVALID_FINANCIAL_CONFIGURATION_WRITE');
    }
    expect(await count()).toBe(startingCount);

    for (const role of ['member', 'viewer']) {
      expect((await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions[role].headers)).status).toBe(200);
      expect((await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions[role].headers).send({
        expectedVersion: startingVersion,
        value: { canonicalPricing: { defaultRangePercent: 1 } },
      })).status).toBe(403);
    }
    expect((await request(app).put('/api/v1/business-profile/financialConfiguration').send({
      expectedVersion: startingVersion,
      value: { canonicalPricing: { defaultRangePercent: 1 } },
    })).status).toBe(401);
    expect((await request(app).put('/api/v1/business-profile/financialConfiguration').set({
      ...sessions.owner.headers,
      'X-CSRF-Token': 'forged',
    }).send({
      expectedVersion: startingVersion,
      value: { canonicalPricing: { defaultRangePercent: 1 } },
    })).status).toBe(403);

    const other = await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions.otherOwner.headers);
    expect(other.status).toBe(200);
    expect(other.body.data.canonicalAuthority.version).toBe('org-profile-v1');
    expect(other.body.data.canonicalPricing.futurePricing).toBeUndefined();

    const advanced = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.admin.headers).send({
      expectedVersion: startingVersion,
      value: { canonicalPricing: { defaultRangePercent: 5 } },
    });
    expect(advanced.status).toBe(200);
    const beforeStaleCount = await count();
    const stale = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers).send({
      expectedVersion: startingVersion,
      value: { canonicalPricing: { defaultRangePercent: 6 } },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect(await count()).toBe(beforeStaleCount);

    const raceVersion = advanced.body.data.canonicalAuthority.version;
    const race = await Promise.all([
      request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers).send({
        expectedVersion: raceVersion,
        value: { vehicles: { averageFuelCost: 1 } },
      }),
      request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.admin.headers).send({
        expectedVersion: raceVersion,
        value: { vehicles: { averageFuelCost: 2 } },
      }),
    ]);
    expect(race.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await count()).toBe(beforeStaleCount + 1);
    expect((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B]
    )).rows[0].id).toBe(otherAuthority.id);
  }, 30000);

  test('alternate whole and section paths cannot overwrite Financial authority in either write order', async () => {
    const count = async (organizationId = ORG_A) => (await pool.query(
      'SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1',
      [organizationId]
    )).rows[0].count;
    const initial = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    const initialVersion = initial.body.data.canonicalAuthority.version;
    const alternateFirstBody = JSON.parse(JSON.stringify(initial.body.data));
    delete alternateFirstBody.canonicalAuthority;
    alternateFirstBody.company.dba = 'Unversioned alternate wins first';
    alternateFirstBody.canonicalPricing.desiredGrossMarginPercent = 91;
    alternateFirstBody.canonicalPricing.defaultRangePercent = 91;
    alternateFirstBody.financial.desiredGrossMargin = 91;
    const startingCount = await count();
    const alternateFirst = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers)
      .send(alternateFirstBody);
    expect(alternateFirst.status).toBe(200);
    expect(alternateFirst.body.data.company.dba).toBe('Unversioned alternate wins first');
    expect(alternateFirst.body.data.canonicalPricing.defaultRangePercent).toBe(0);
    expect((await pool.query(
      "SELECT raw_profile #>> '{financial,desiredGrossMargin}' AS margin FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE",
      [ORG_A]
    )).rows[0].margin).toBe('88');
    expect(await count()).toBe(startingCount + 1);

    const dedicatedLost = await request(app).put('/api/v1/business-profile/financialConfiguration')
      .set(sessions.admin.headers).send({
        expectedVersion: initialVersion,
        value: { canonicalPricing: { defaultRangePercent: 6 } },
      });
    expect(dedicatedLost.status).toBe(409);
    expect(dedicatedLost.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect(await count()).toBe(startingCount + 1);

    const beforeDedicated = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    const staleBeforeDeletion = JSON.parse(JSON.stringify(beforeDedicated.body.data));
    delete staleBeforeDeletion.canonicalAuthority;
    const dedicatedFirst = await request(app).put('/api/v1/business-profile/financialConfiguration')
      .set(sessions.admin.headers).send({
        expectedVersion: beforeDedicated.body.data.canonicalAuthority.version,
        value: { canonicalPricing: { defaultRangePercent: 7 } },
      });
    expect(dedicatedFirst.status).toBe(200);
    staleBeforeDeletion.company.dba = 'Dedicated authority survives stale whole save';
    staleBeforeDeletion.canonicalPricing.desiredGrossMarginPercent = 93;
    staleBeforeDeletion.canonicalPricing.defaultRangePercent = 93;
    staleBeforeDeletion.financial.desiredGrossMargin = 93;
    staleBeforeDeletion.financial.desiredNetMargin = 92;
    staleBeforeDeletion.financial.maximumDiscount = 91;
    const countAfterDedicated = await count();
    const dedicatedContained = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers)
      .send(staleBeforeDeletion);
    expect(dedicatedContained.status).toBe(200);
    expect(dedicatedContained.body.data.company.dba).toBe('Dedicated authority survives stale whole save');
    expect(dedicatedContained.body.data.canonicalPricing.defaultRangePercent).toBe(7);
    expect(dedicatedContained.body.data.canonicalPricing.desiredGrossMarginPercent).toBeUndefined();
    expect(dedicatedContained.body.data.canonicalPricing.desiredNetMarginPercent).toBeUndefined();
    expect(dedicatedContained.body.data.canonicalPricing.maximumDiscountPercent).toBeUndefined();
    const containedRaw = (await pool.query(
      'SELECT raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE',
      [ORG_A]
    )).rows[0].raw_profile;
    expect(containedRaw.financial.desiredGrossMargin).toBeUndefined();
    expect(containedRaw.financial.desiredNetMargin).toBeUndefined();
    expect(containedRaw.financial.maximumDiscount).toBeUndefined();
    expect(containedRaw.financial.unknownLegacy).toBe(UNKNOWN);
    expect(containedRaw.canonicalPricing.futurePricing).toBe(UNKNOWN);
    expect(await count()).toBe(countAfterDedicated + 1);

    const staleImplicit = JSON.parse(JSON.stringify(beforeDedicated.body.data));
    staleImplicit.company.dba = 'Implicit stale token must conflict';
    staleImplicit.canonicalPricing.desiredGrossMarginPercent = 15;
    const beforeImplicitCount = await count();
    const implicitConflict = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers)
      .send(staleImplicit);
    expect(implicitConflict.status).toBe(409);
    expect(implicitConflict.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect(await count()).toBe(beforeImplicitCount);

    const explicitStaleValue = JSON.parse(JSON.stringify(beforeDedicated.body.data));
    delete explicitStaleValue.canonicalAuthority;
    explicitStaleValue.company.dba = 'Explicit stale envelope must conflict';
    explicitStaleValue.canonicalPricing.desiredGrossMarginPercent = 15;
    const explicitConflict = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send({
      expectedVersion: beforeDedicated.body.data.canonicalAuthority.version,
      value: explicitStaleValue,
    });
    expect(explicitConflict.status).toBe(409);
    expect(explicitConflict.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect(await count()).toBe(beforeImplicitCount);

    const beforeFinancialOnly = (await pool.query(
      'SELECT id, version_label, raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE',
      [ORG_A]
    )).rows[0];
    for (const [section, body] of [
      ['canonicalPricing', { defaultRangePercent: 99 }],
      ['canonicalCosts', { overheadPercent: 99 }],
      ['crew', { averageHourlyRate: 99 }],
      ['vehicles', { averageFuelCost: 99 }],
    ]) {
      const denied = await request(app).put('/api/v1/business-profile/' + section)
        .set(sessions.owner.headers).send(body);
      expect(denied.status).toBe(409);
      expect(denied.body.error.code).toBe('FINANCIAL_CONFIGURATION_VERSION_REQUIRED');
    }
    expect((await pool.query(
      'SELECT id, version_label, raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE',
      [ORG_A]
    )).rows[0]).toEqual(beforeFinancialOnly);
    expect(await count()).toBe(beforeImplicitCount);

    const mixedCrew = await request(app).put('/api/v1/business-profile/crew').set(sessions.owner.headers).send({
      defaultCrewSize: 4,
      averageHourlyRate: 99,
      futureCrew: UNKNOWN,
    });
    expect(mixedCrew.status).toBe(200);
    expect(mixedCrew.body.data.crew.defaultCrewSize).toBe(4);
    expect(mixedCrew.body.data.crew.averageHourlyRate).toBe(containedRaw.crew.averageHourlyRate);
    expect(mixedCrew.body.data.crew.futureCrew).toBe(UNKNOWN);

    const mixedVehicles = await request(app).put('/api/v1/business-profile/vehicles').set(sessions.owner.headers).send({
      truckCount: 3,
      averageFuelCost: 99,
      futureVehicle: UNKNOWN,
    });
    expect(mixedVehicles.status).toBe(200);
    expect(mixedVehicles.body.data.vehicles.truckCount).toBe(3);
    expect(mixedVehicles.body.data.vehicles.averageFuelCost).toBe(containedRaw.vehicles.averageFuelCost);
    expect(mixedVehicles.body.data.vehicles.futureVehicle).toBe(UNKNOWN);

    const mixedPricing = await request(app).put('/api/v1/business-profile/canonicalPricing')
      .set(sessions.owner.headers).send({
        defaultRangePercent: 99,
        futurePricing: '  changed unowned pricing byte  ',
      });
    expect(mixedPricing.status).toBe(200);
    expect(mixedPricing.body.data.canonicalPricing.defaultRangePercent).toBe(7);
    expect(mixedPricing.body.data.canonicalPricing.futurePricing).toBe('  changed unowned pricing byte  ');

    const firstSection = await request(app).put('/api/v1/business-profile/canonicalPricing')
      .set(sessions.unversionedOwner.headers).send({ defaultRangePercent: 55 });
    expect(firstSection.status).toBe(409);
    expect(await count(ORG_UNVERSIONED)).toBe(0);
    const firstBody = rawProfile('Unversioned First Profile');
    firstBody.company.dba = 'Accepted non-financial first write';
    firstBody.canonicalPricing.desiredGrossMarginPercent = 15;
    const firstWhole = await request(app).put('/api/v1/business-profile')
      .set(sessions.unversionedOwner.headers).send(firstBody);
    expect(firstWhole.status).toBe(200);
    const firstRaw = (await pool.query(
      'SELECT version_label, raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE',
      [ORG_UNVERSIONED]
    )).rows[0];
    expect(firstRaw.version_label).toBe('org-profile-v1');
    expect(firstRaw.raw_profile.company.dba).toBe('Accepted non-financial first write');
    for (const field of ['customerMarkupPercent', 'taxRatePercent', 'emergencyMultiplier',
      'travelCustomerChargePerMile', 'minimumJobPrice', 'desiredGrossMarginPercent',
      'desiredNetMarginPercent', 'maximumDiscountPercent', 'defaultRangePercent']) {
      expect(firstRaw.raw_profile.canonicalPricing).not.toHaveProperty(field);
    }
    for (const field of ['overheadPercent', 'travelCostPerMile', 'materialCostByService', 'equipmentCostByReference']) {
      expect(firstRaw.raw_profile.canonicalCosts).not.toHaveProperty(field);
    }
    for (const field of ['averageHourlyRate', 'overtimeMultiplier', 'travelPay', 'minimumBillableHours']) {
      expect(firstRaw.raw_profile.crew).not.toHaveProperty(field);
    }
    for (const field of ['averageFuelCost', 'hourlyVehicleCost', 'maintenanceReserve']) {
      expect(firstRaw.raw_profile.vehicles).not.toHaveProperty(field);
    }
    for (const field of ['desiredGrossMargin', 'desiredNetMargin', 'maximumDiscount']) {
      expect(firstRaw.raw_profile.financial).not.toHaveProperty(field);
    }
    expect(firstRaw.raw_profile.canonicalPricing.futurePricing).toBe(UNKNOWN);
    expect(firstRaw.raw_profile.canonicalCosts.futureCosts).toBe(UNKNOWN);
    expect(firstRaw.raw_profile.financial.unknownLegacy).toBe(UNKNOWN);
  }, 30000);

  test('reserved own keys fail before migration and leave the exact active bytes and version untouched', async () => {
    const loaded = await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers);
    const before = (await pool.query(
      `SELECT id, version_label, raw_profile,
              (SELECT count(*)::int FROM canonical_business_profiles WHERE organization_id = $1) AS version_count
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    for (const key of ['__proto__', 'prototype', 'constructor']) {
      const map = {};
      Object.defineProperty(map, key, { enumerable: true, value: 1 });
      const denied = await request(app).put('/api/v1/business-profile/financialConfiguration')
        .set(sessions.owner.headers).send({
          expectedVersion: loaded.body.data.canonicalAuthority.version,
          value: { canonicalCosts: { materialCostByService: map } },
        });
      expect(denied.status).toBe(400);
      expect(denied.body.error.code).toBe('INVALID_FINANCIAL_CONFIGURATION_WRITE');
      expect(denied.body.errors.join('\n')).toContain('unsafe key');
    }
    expect((await pool.query(
      `SELECT id, version_label, raw_profile,
              (SELECT count(*)::int FROM canonical_business_profiles WHERE organization_id = $1) AS version_count
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0]).toEqual(before);
  }, 30000);

  test('section replacement clears recognized legacy migration sources, preserves unknown bytes, and null is first-write only', async () => {
    const loaded = await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers);
    const before = (await pool.query(
      'SELECT raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_A]
    )).rows[0].raw_profile;
    const cleared = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers).send({
      expectedVersion: loaded.body.data.canonicalAuthority.version,
      value: { canonicalPricing: {} },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.canonicalPricing).toEqual({});
    const after = (await pool.query(
      'SELECT raw_profile FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_A]
    )).rows[0].raw_profile;
    expect(after.canonicalPricing).toEqual({ futurePricing: UNKNOWN });
    expect(after.financial.desiredGrossMargin).toBeUndefined();
    expect(after.financial.desiredNetMargin).toBeUndefined();
    expect(after.financial.maximumDiscount).toBeUndefined();
    expect(after.financial.unknownLegacy).toBe(UNKNOWN);
    expect(after.canonicalCosts).toEqual(before.canonicalCosts);
    expect(after.crew).toEqual(before.crew);
    expect(after.vehicles).toEqual(before.vehicles);
    expect(after.services).toEqual(before.services);
    expect(after.voiceAssistant).toEqual(before.voiceAssistant);
    expect(after.retell).toEqual(before.retell);

    const reloaded = await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions.owner.headers);
    expect(reloaded.body.data.canonicalPricing.desiredGrossMarginPercent).toBeUndefined();
    expect(reloaded.body.data.canonicalPricing.desiredNetMarginPercent).toBeUndefined();
    expect(reloaded.body.data.canonicalPricing.maximumDiscountPercent).toBeUndefined();

    const draft = await request(app).get('/api/v1/business-profile/financialConfiguration').set(sessions.draftOwner.headers);
    expect(draft.status).toBe(200);
    expect(draft.body.onboardingDraft).toBe(true);
    expect(draft.body.data.canonicalAuthority).toBeNull();
    const firstWrite = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.draftOwner.headers).send({
      expectedVersion: null,
      value: { canonicalPricing: { defaultRangePercent: 0 } },
    });
    expect(firstWrite.status).toBe(200);
    expect(firstWrite.body.data.canonicalAuthority.version).toBe('org-profile-v1');
    const repeatNull = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.draftOwner.headers).send({
      expectedVersion: null,
      value: { canonicalPricing: { defaultRangePercent: 1 } },
    });
    expect(repeatNull.status).toBe(409);
  }, 30000);
});
