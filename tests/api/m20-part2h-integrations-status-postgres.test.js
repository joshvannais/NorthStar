'use strict';

const crypto = require('crypto');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '8b000000-0000-4000-8000-000000000001';
const ORG_B = '8b000000-0000-4000-8000-000000000002';
const OWNER_A = '8c000000-0000-4000-8000-000000000001';
const VIEWER_A = '8c000000-0000-4000-8000-000000000002';
const OWNER_B = '8c000000-0000-4000-8000-000000000003';

const LEGACY_INTEGRATIONS = Object.freeze({
  retell: Object.freeze({ enabled: false, label: '  </span><img src=x onerror=never()>  ' }),
  stripe: Object.freeze({ enabled: true, label: '  LEGACY STRIPE MUST NOT CONNECT  ' }),
  googleCalendar: Object.freeze({ enabled: true, calendar: '  legacy-calendar\r\nbytes  ' }),
});

function profileFor(name) {
  const profile = canonicalFenceProfile({ companyName: name });
  profile.integrations = JSON.parse(JSON.stringify(LEGACY_INTEGRATIONS));
  return profile;
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

realPostgres('Mission 20 Part 2H mounted canonical integration status', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let db;
  let pool;
  let app;
  let auth;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-part2h-integration-status');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1,'Integration Status Organization A','integration-status-a@example.test'),
        ($2,'Integration Status Organization B','integration-status-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, userId + '@m20-part2h.test', role]
      );
    }

    const { putBusinessProfile, bindIntegrationOwner } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, profile: profileFor('Integration Status A'),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, profile: profileFor('Integration Status B'),
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'retell',
      externalIntegrationId: 'tenant-a-retell-private-id',
      metadata: { privateMarker: 'TENANT A PRIVATE METADATA' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'voice', status: 'inactive',
      externalIntegrationId: 'tenant-a-voice-private-id',
      metadata: { privateMarker: 'TENANT A INACTIVE METADATA' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_B, userId: OWNER_B, provider: 'retell',
      externalIntegrationId: 'tenant-b-retell-private-id',
      metadata: { privateMarker: 'TENANT B PRIVATE METADATA' },
    });

    auth = new Map();
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      auth.set(userId, (await provisionDurableSession(pool, { userId, organizationId, role })).headers);
    }
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

  test('mounted status is tenant scoped, read-only for every role, and independent of Business Profile flags', async () => {
    const expected = {
      authority: 'canonical_integration_ownership',
      connectors: [
        { provider: 'retell', status: 'active' },
        { provider: 'voice', status: 'inactive' },
      ],
    };
    for (const userId of [OWNER_A, VIEWER_A]) {
      const response = await request(app)
        .get('/api/v1/integrations/status')
        .query({ organizationId: ORG_B, provider: 'stripe', connected: true })
        .set(auth.get(userId));
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(expected);
      expect(response.body.requestId).toEqual(expect.any(String));
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toMatch(/private-id|PRIVATE METADATA|LEGACY STRIPE|calendar|external|metadata/i);
    }

    const otherTenant = await request(app)
      .get('/api/v1/integrations/status')
      .set(auth.get(OWNER_B));
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body.data.connectors).toEqual([
      { provider: 'retell', status: 'active' },
      { provider: 'voice', status: 'not_provisioned' },
    ]);

    const unauthenticated = await request(app).get('/api/v1/integrations/status');
    expect(unauthenticated.status).toBe(401);

    const jobber = await request(app)
      .get('/api/integrations/jobber/status')
      .set(auth.get(VIEWER_A));
    expect(jobber.status).toBe(200);
    expect(jobber.body).toMatchObject({ available: false, configured: false, connected: false });
  });

  test('multiple active ownership rows fail closed as ambiguous without affecting another tenant', async () => {
    const { bindIntegrationOwner } = require('../../src/services/organizationAuthority');
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'retell',
      externalIntegrationId: 'tenant-a-second-retell-private-id',
      metadata: { privateMarker: 'SECOND PRIVATE METADATA' },
    });

    const tenantA = await request(app).get('/api/v1/integrations/status').set(auth.get(OWNER_A));
    expect(tenantA.status).toBe(200);
    expect(tenantA.body.data.connectors).toEqual([
      { provider: 'retell', status: 'ambiguous' },
      { provider: 'voice', status: 'inactive' },
    ]);
    expect(JSON.stringify(tenantA.body)).not.toMatch(/second-retell|SECOND PRIVATE/);

    const tenantB = await request(app).get('/api/v1/integrations/status').set(auth.get(OWNER_B));
    expect(tenantB.status).toBe(200);
    expect(tenantB.body.data.connectors[0]).toEqual({ provider: 'retell', status: 'active' });
  });

  test('full-profile save preserves legacy integration bytes while canonical status ignores them and performs no provider request', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new Error('provider boundary must remain unused'); });
    try {
      const loaded = await request(app).get('/api/v1/business-profile').set(auth.get(OWNER_A));
      expect(loaded.status).toBe(200);
      expect(loaded.body.data.integrations).toEqual(LEGACY_INTEGRATIONS);
      loaded.body.data.company.dba = 'Canonical status save';
      const saved = await request(app)
        .put('/api/v1/business-profile')
        .set(auth.get(OWNER_A))
        .send(loaded.body.data);
      expect(saved.status).toBe(200);
      expect(saved.body.data.integrations).toEqual(LEGACY_INTEGRATIONS);

      const bytes = await pool.query(
        `SELECT
           encode(convert_to(raw_profile #>> '{integrations,retell,label}', 'UTF8'), 'hex') AS retell_hex,
           encode(convert_to(raw_profile #>> '{integrations,stripe,label}', 'UTF8'), 'hex') AS stripe_hex,
           encode(convert_to(raw_profile #>> '{integrations,googleCalendar,calendar}', 'UTF8'), 'hex') AS calendar_hex
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
        [ORG_A]
      );
      expect(bytes.rows).toEqual([{
        retell_hex: hex(LEGACY_INTEGRATIONS.retell.label),
        stripe_hex: hex(LEGACY_INTEGRATIONS.stripe.label),
        calendar_hex: hex(LEGACY_INTEGRATIONS.googleCalendar.calendar),
      }]);

      const status = await request(app).get('/api/v1/integrations/status').set(auth.get(OWNER_A));
      expect(status.status).toBe(200);
      expect(status.body.data.connectors[0].status).toBe('ambiguous');
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
