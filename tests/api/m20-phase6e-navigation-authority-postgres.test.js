'use strict';

const crypto = require('crypto');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '7e000000-0000-4000-8000-000000000001';
const ORG_B = '7e000000-0000-4000-8000-000000000002';
const USERS = Object.freeze([
  Object.freeze({ id: '7f000000-0000-4000-8000-000000000001', organizationId: ORG_A, role: 'owner' }),
  Object.freeze({ id: '7f000000-0000-4000-8000-000000000002', organizationId: ORG_A, role: 'admin' }),
  Object.freeze({ id: '7f000000-0000-4000-8000-000000000003', organizationId: ORG_A, role: 'member' }),
  Object.freeze({ id: '7f000000-0000-4000-8000-000000000004', organizationId: ORG_A, role: 'viewer' }),
  Object.freeze({ id: '7f000000-0000-4000-8000-000000000005', organizationId: ORG_B, role: 'owner' }),
]);

function graphInput(organizationId, suffix, address) {
  return {
    tenantContext: { organizationId, trusted: true },
    idempotencyKey: `phase6e-${suffix}`,
    source: 'lead',
    sourceVersion: 'm20-phase6e-test-v1',
    external: {
      customerId: `phase6e-${suffix}-customer`,
      callId: `phase6e-${suffix}-call`,
      transcriptId: `phase6e-${suffix}-transcript`,
      communicationId: `phase6e-${suffix}-communication`,
      appointmentId: `phase6e-${suffix}-appointment`,
    },
    customer: {
      name: `Phase 6E ${suffix}`,
      phone: suffix === 'a' ? '+15555550701' : '+15555550702',
      email: `phase6e-${suffix}@example.test`,
      address,
    },
    transcript: [
      { turnId: 'turn-1', speaker: 'customer', text: 'I need a new 100-foot cedar fence and the existing fence removed.' },
      { turnId: 'turn-2', speaker: 'customer', text: 'Include one walk gate. Permits are required. Weekday mornings work best.' },
    ],
    facts: [
      { variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'height', normalizedValue: 6, evidenceText: 'six-foot', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'material', normalizedValue: 'cedar', evidenceText: 'cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'removalRequired', normalizedValue: true, evidenceText: 'existing fence removed', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'gates', normalizedValue: [{ type: 'walk' }], evidenceText: 'one walk gate', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'permitsRequired', normalizedValue: true, evidenceText: 'Permits are required', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
    ],
    service: {
      key: 'fence',
      scope: {
        jobType: 'replace', linearFeet: 100, height: 6, material: 'cedar',
        removalRequired: true, gates: [{ type: 'walk' }], permitsRequired: true,
      },
    },
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    scheduledAppointment: {
      start: '2026-08-12T13:00:00.000Z', end: '2026-08-12T15:00:00.000Z', status: 'scheduled',
    },
    callDurationSeconds: 180,
  };
}

function stableJson(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item);
}

async function persistenceDigest(pool) {
  const tables = {
    canonical_operations: 'organization_id, id',
    canonical_customers: 'organization_id, id',
    canonical_estimates: 'organization_id, id',
    canonical_appointments: 'organization_id, id',
    organization_map_preferences: 'organization_id',
    user_map_preferences: 'organization_id, user_id',
    organization_account_preferences: 'organization_id',
    notification_preferences: 'organization_id',
  };
  const digest = {};
  for (const [table, order] of Object.entries(tables)) {
    const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
    digest[table] = crypto.createHash('sha256').update(stableJson(rows), 'utf8').digest('hex');
  }
  return digest;
}

realPostgres('Mission 20 Phase 6E mounted canonical navigation authority', () => {
  let suiteDatabase;
  let db;
  let pool;
  let app;
  let sessions;
  let graphA;
  let graphB;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let originalFetch;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-phase6e-navigation');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
      'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
    ]) delete process.env[name];

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    expect((await pool.query('SHOW server_version')).rows[0].server_version).toMatch(/^18\.4(?:\D|$)/);
    expect((await pool.query('SHOW timezone')).rows[0].TimeZone).toBe('UTC');
    expect((await pool.query('SHOW data_checksums')).rows[0].data_checksums).toBe('on');

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 6E Tenant A','phase6e-a@example.test'),
       ($2,'Phase 6E Tenant B','phase6e-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const user of USERS) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [user.id, user.organizationId, `Phase 6E ${user.role}`, `${user.id}@phase6e.test`, user.role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: USERS[0].id, expectedVersion: null,
      profile: canonicalFenceProfile({ version: 'phase6e-profile-a' }),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: USERS[4].id, expectedVersion: null,
      profile: canonicalFenceProfile({ version: 'phase6e-profile-b' }),
    });
    const { ingestLead } = require('../../src/services/canonicalGraphService');
    graphA = await ingestLead(pool, graphInput(ORG_A, 'a', {
      line1: '100 Cedar Lane', city: 'Testville', state: 'NY', postalCode: '10001', country: 'US',
    }));
    graphB = await ingestLead(pool, graphInput(ORG_B, 'b', '900 Other Tenant Way, Elsewhere, WA 98000'));
    expect(graphA.status).toBe(201);
    expect(graphB.status).toBe(201);

    sessions = new Map();
    for (const user of USERS) {
      sessions.set(user.id, await provisionDurableSession(pool, {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      }));
    }
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new Error('provider boundary must remain unused'); });
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
    global.fetch = originalFetch;
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

  test('all four roles receive same-user preferences plus only their tenant canonical location using GETs with zero writes', async () => {
    const contract = require('../../public/js/navigation-launcher');
    const before = await persistenceDigest(pool);
    for (const user of USERS.slice(0, 4)) {
      const session = sessions.get(user.id);
      const preference = await request(app)
        .get('/api/account/map-preferences')
        .query({ organizationId: ORG_B, tenantId: ORG_B, userId: USERS[4].id })
        .set(session.headers);
      expect(preference.status).toBe(200);
      const parsed = contract.parsePreferenceResponse(preference.body);
      expect(contract.selectLaunchPolicy(parsed)).toEqual({
        defaultProvider: 'google_maps',
        usableProviders: ['google_maps', 'apple_maps', 'waze'],
        chooserProviders: ['apple_maps', 'waze'],
      });

      const locations = await request(app)
        .get('/api/v1/canonical/compat/customer-detail')
        .query({ customerId: graphA.body.ids.customer, organizationId: ORG_B, userId: USERS[4].id })
        .set({ ...session.headers, 'X-NorthStar-Session-ID': session.sessionId });
      expect(locations.status).toBe(200);
      expect(locations.body.success).toBe(true);
      expect(locations.body.data.authority).toMatchObject({
        organizationId: ORG_A, userId: user.id, sessionId: session.sessionId,
      });
      expect(locations.body.data.records).toHaveLength(1);
      expect(locations.body.data.records[0].address).toEqual({
        line1: '100 Cedar Lane', city: 'Testville', state: 'NY', postalCode: '10001', country: 'US',
      });
      const destination = contract.normalizeDestination({ address: locations.body.data.records[0].address });
      expect(destination.address).toBe('100 Cedar Lane, Testville, NY 10001, US');
      expect(JSON.stringify(locations.body)).not.toMatch(/900 Other Tenant Way|phase6e-b@example\.test/i);
    }
    expect(await persistenceDigest(pool)).toEqual(before);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('tenant B receives only tenant B bytes and no request-supplied user or tenant override is honored', async () => {
    const user = USERS[4];
    const session = sessions.get(user.id);
    const response = await request(app)
      .get('/api/v1/canonical/compat/customer-detail')
      .query({ customerId: graphB.body.ids.customer, organizationId: ORG_A, userId: USERS[0].id })
      .set({ ...session.headers, 'X-NorthStar-Session-ID': session.sessionId });
    expect(response.status).toBe(200);
    expect(response.body.data.authority).toMatchObject({ organizationId: ORG_B, userId: user.id });
    expect(response.body.data.records).toHaveLength(1);
    expect(response.body.data.records[0].address).toBe('900 Other Tenant Way, Elsewhere, WA 98000');
    expect(JSON.stringify(response.body)).not.toMatch(/100 Cedar Lane|phase6e-a@example\.test/i);
  });

  test('missing sessions and malformed canonical filters fail closed without provider or persistence action', async () => {
    const before = await persistenceDigest(pool);
    expect((await request(app).get('/api/account/map-preferences')).status).toBe(401);
    expect((await request(app).get('/api/v1/canonical/compat/customer-detail')).status).toBe(401);
    const session = sessions.get(USERS[0].id);
    const malformed = await request(app)
      .get('/api/v1/canonical/compat/customer-detail')
      .query({ customerId: '<img src=x onerror=never()>' })
      .set({ ...session.headers, 'X-NorthStar-Session-ID': session.sessionId });
    expect(malformed.status).toBe(400);
    expect(await persistenceDigest(pool)).toEqual(before);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
