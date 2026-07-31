'use strict';

const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '41000000-0000-0000-0000-000000000001';
const ORG_B = '41000000-0000-0000-0000-000000000002';
const OWNER_A = '42000000-0000-0000-0000-000000000001';
const VIEWER_A = '42000000-0000-0000-0000-000000000002';
const OWNER_B = '42000000-0000-0000-0000-000000000003';

function profileFor(companyName, overrides) {
  const profile = canonicalFenceProfile({
    companyName,
    materialRates: { cedar: 123, pine: 71, vinyl: 83, 'chain-link': 47 },
    ...(overrides || {}),
  });
  profile.financial = {
    desiredGrossMargin: 40,
    desiredNetMargin: 20,
    markup: 9.99,
    taxRate: 77,
    emergencyMarkup: 8.88,
    travelCharge: 7.77,
    minimumJobPrice: 999,
  };
  return profile;
}

realPostgres('Mission 19 Part 3 canonical Business Profile mounted authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let db;
  let app;
  let authHeaders;
  let putBusinessProfile;
  let getActiveBusinessProfile;
  let baselineA;

  function auth(userId) {
    return authHeaders.get(userId);
  }

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('business-profile');
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Profile Organization A', 'profile-a@m19.test'),
        ($2, 'Profile Organization B', 'profile-b@m19.test')`,
      [ORG_A, ORG_B]
    );
    for (const user of [
      [OWNER_A, ORG_A, 'owner'],
      [VIEWER_A, ORG_A, 'viewer'],
      [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [user[0], user[1], user[0], user[0] + '@profile.test', user[2]]
      );
    }
    ({ putBusinessProfile, getActiveBusinessProfile } = require('../../src/services/organizationAuthority'));
    ({ app } = require('../../src/server'));
  }, 60000);

  beforeEach(async () => {
    const pool = db.getPool();
    await pool.query('TRUNCATE TABLE canonical_operations CASCADE');
    baselineA = await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: OWNER_A,
      profile: profileFor('Canonical Editor A'),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B,
      userId: OWNER_B,
      profile: profileFor('Canonical Editor B', { taxRatePercent: 4, emergencyMultiplier: 2, travelCustomerChargePerMile: 3 }),
    });
    authHeaders = new Map();
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'],
      [VIEWER_A, ORG_A, 'viewer'],
      [OWNER_B, ORG_B, 'owner'],
    ]) {
      const session = await provisionDurableSession(pool, { userId, organizationId, role });
      authHeaders.set(userId, session.headers);
    }
  });

  afterAll(async () => {
    try {
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('explicit 9 percent tax and zero emergency/travel round-trip and drive the next canonical calculation', async () => {
    const loaded = await request(app).get('/api/v1/business-profile').set(auth(OWNER_A));
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.canonicalPricing).toMatchObject({
      taxRatePercent: 0,
      emergencyMultiplier: 1,
      travelCustomerChargePerMile: 0,
    });
    expect(loaded.body.data.financial).toMatchObject({
      markup: 1,
      taxRate: 0,
      emergencyMarkup: 1,
      travelCharge: 0,
    });
    const body = loaded.body.data;
    body.canonicalPricing = {
      ...body.canonicalPricing,
      customerMarkupPercent: 0,
      taxRatePercent: 9,
      emergencyMultiplier: 0,
      travelCustomerChargePerMile: 0,
      minimumJobPrice: 0,
    };
    body.canonicalCosts = { ...body.canonicalCosts, overheadPercent: 0, travelCostPerMile: 0 };
    body.financial = { ...body.financial, markup: 9.99, taxRate: 77, emergencyMarkup: 8.88, travelCharge: 7.77, minimumJobPrice: 999 };

    const saved = await request(app).put('/api/v1/business-profile').set(auth(OWNER_A)).send(body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.canonicalPricing).toMatchObject({
      customerMarkupPercent: 0,
      taxRatePercent: 9,
      emergencyMultiplier: 0,
      travelCustomerChargePerMile: 0,
      minimumJobPrice: 0,
    });
    expect(saved.body.data.financial).toMatchObject({
      markup: 1,
      taxRate: 9,
      emergencyMarkup: 0,
      travelCharge: 0,
      minimumJobPrice: 0,
    });
    expect(saved.body.data.canonicalAuthority.id).not.toBe(baselineA.id);
    expect(saved.body.data.canonicalAuthority.version).not.toBe(baselineA.versionLabel);
    expect(saved.body.data.canonicalAuthority.hash).not.toBe(baselineA.profileHash);

    const reloaded = await request(app).get('/api/v1/business-profile').set(auth(OWNER_A));
    expect(reloaded.body.data.canonicalPricing).toEqual(saved.body.data.canonicalPricing);
    expect(reloaded.body.data.canonicalCosts).toEqual(saved.body.data.canonicalCosts);

    const graph = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(OWNER_A))
      .set('Idempotency-Key', 'profile-editor-nine-zero')
      .send({ name: 'Nine Percent Customer', service: 'fence', phone: '+15555554101' });
    expect(graph.status).toBe(201);
    expect(graph.body.polaris.taxRatePercent).toBe(9);
    expect(graph.body.polaris.tax).toBe(Math.round(graph.body.polaris.customerFacingPrice * 9) / 100);
    expect(graph.body.polaris.totalIncludingTax).toBe(
      Math.round((graph.body.polaris.customerFacingPrice + graph.body.polaris.tax) * 100) / 100
    );
    expect(graph.body.polaris.businessProfileInputId).toBe(saved.body.data.canonicalAuthority.id);
    expect(graph.body.polaris.businessProfileInputHash).toBe(saved.body.data.canonicalAuthority.hash);
    expect(graph.body.polaris.businessProfileFieldsUsed).toEqual(expect.arrayContaining([
      'canonicalPricing.taxRatePercent',
      'canonicalPricing.emergencyMultiplier',
      'canonicalPricing.travelCustomerChargePerMile',
    ]));
  });

  test('missing remains unavailable, malformed input is rejected, and organizations remain isolated', async () => {
    const loaded = await request(app).get('/api/v1/business-profile').set(auth(OWNER_A));
    const missingBody = loaded.body.data;
    missingBody.canonicalPricing = { customerMarkupPercent: 0 };
    missingBody.canonicalCosts = {};
    const missing = await request(app).put('/api/v1/business-profile').set(auth(OWNER_A)).send(missingBody);
    expect(missing.status).toBe(200);
    expect(missing.body.data.canonicalPricing).toEqual({ customerMarkupPercent: 0 });
    expect(missing.body.data.financial).not.toHaveProperty('taxRate');
    expect(missing.body.data.financial).not.toHaveProperty('emergencyMarkup');
    expect(missing.body.data.financial).not.toHaveProperty('travelCharge');

    const graph = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(OWNER_A))
      .set('Idempotency-Key', 'profile-editor-missing')
      .send({ name: 'Missing Configuration', service: 'fence', phone: '+15555554102' });
    expect(graph.status).toBe(201);
    expect(graph.body.polaris.taxRatePercent).toBeNull();
    expect(graph.body.polaris.tax).toBeNull();
    expect(graph.body.polaris.notCalculated).toContainEqual(expect.objectContaining({ field: 'tax' }));

    const activeBeforeMalformed = await getActiveBusinessProfile(db.getPool(), ORG_A);
    const malformed = await request(app).put('/api/v1/business-profile').set(auth(OWNER_A)).send({
      ...missing.body.data,
      canonicalPricing: { taxRatePercent: '9', emergencyMultiplier: -1 },
      canonicalCosts: { materialCostByService: { 'fence:cedar': 'invalid' } },
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('canonicalPricing.taxRatePercent'),
      expect.stringContaining('canonicalPricing.emergencyMultiplier'),
      expect.stringContaining('canonicalCosts.materialCostByService.fence:cedar'),
    ]));
    expect((await getActiveBusinessProfile(db.getPool(), ORG_A)).id).toBe(activeBeforeMalformed.id);

    const other = await request(app).get('/api/v1/business-profile').set(auth(OWNER_B));
    expect(other.status).toBe(200);
    expect(other.body.data.company.name).toBe('Canonical Editor B');
    expect(other.body.data.canonicalPricing).toMatchObject({
      taxRatePercent: 4,
      emergencyMultiplier: 2,
      travelCustomerChargePerMile: 3,
    });
    expect(other.body.data.canonicalAuthority.id).not.toBe(activeBeforeMalformed.id);

    const viewer = await request(app).put('/api/v1/business-profile').set(auth(VIEWER_A)).send(loaded.body.data);
    expect(viewer.status).toBe(403);
  });
});
