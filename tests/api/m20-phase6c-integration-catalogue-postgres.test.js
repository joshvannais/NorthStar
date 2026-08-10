'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '6c000000-0000-4000-8000-000000000001';
const ORG_B = '6c000000-0000-4000-8000-000000000002';
const OWNER_A = '6d000000-0000-4000-8000-000000000001';
const ADMIN_A = '6d000000-0000-4000-8000-000000000002';
const MEMBER_A = '6d000000-0000-4000-8000-000000000003';
const VIEWER_A = '6d000000-0000-4000-8000-000000000004';
const OWNER_B = '6d000000-0000-4000-8000-000000000005';

const ROLE_USERS = Object.freeze([
  ['owner', OWNER_A],
  ['admin', ADMIN_A],
  ['member', MEMBER_A],
  ['viewer', VIEWER_A],
]);

const TABLE_ORDER = Object.freeze({
  organizations: 'id',
  users: 'id',
  organization_memberships: 'id',
  organization_onboarding: 'organization_id',
  auth_sessions: 'id',
  subscriptions: 'id',
  notification_preferences: 'id',
  canonical_business_profiles: 'id',
  canonical_integration_ownership: 'id',
  oauth_authorization_states: 'id',
  integration_credentials: 'id',
});

function profileFor(name) {
  const profile = canonicalFenceProfile({ companyName: name });
  profile.voiceAssistant = {
    name: '  <img src=x onerror=never()>  ',
    greeting: '  PRIVATE VOICE CONFIG\r\nMUST NOT LEAK  ',
  };
  profile.integrations = {
    retell: { enabled: false, providerId: 'LEGACY PRIVATE RETELL ID' },
    stripe: { enabled: true, token: 'LEGACY FAKE TOKEN MUST NOT LEAK' },
    googleCalendar: { enabled: true, calendar: 'LEGACY PRIVATE CALENDAR' },
  };
  return profile;
}

function flattenProviders(body) {
  return body.data.categories.flatMap(category => category.providers);
}

function provider(body, key) {
  return flattenProviders(body).find(entry => entry.key === key);
}

function stableJson(value) {
  return JSON.stringify(value, (_key, child) => child instanceof Date ? child.toISOString() : child);
}

async function tableDigests(pool) {
  const result = {};
  for (const [table, order] of Object.entries(TABLE_ORDER)) {
    const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
    result[table] = crypto.createHash('sha256').update(stableJson(rows), 'utf8').digest('hex');
  }
  return result;
}

realPostgres('Mission 20 Phase 6C mounted integration catalogue', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let originalFetch;
  let db;
  let pool;
  let app;
  let auth;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-phase6c-integration-catalogue');
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
        ($1,'Catalogue Organization A','catalogue-a@example.test'),
        ($2,'Catalogue Organization B','catalogue-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [role, userId, organizationId] of [
      ...ROLE_USERS.map(([role, userId]) => [role, userId, ORG_A]),
      ['owner', OWNER_B, ORG_B],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, `${role} catalogue user`, `${userId}@phase6c.test`, role]
      );
    }

    const { putBusinessProfile, bindIntegrationOwner } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, profile: profileFor('Catalogue Organization A'),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, profile: profileFor('Catalogue Organization B'),
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'retell',
      externalIntegrationId: 'tenant-a-private-retell-one',
      metadata: { privateMarker: 'TENANT A PRIVATE OWNERSHIP ONE' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'retell',
      externalIntegrationId: 'tenant-a-private-retell-two',
      metadata: { privateMarker: 'TENANT A PRIVATE OWNERSHIP TWO' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'voice', status: 'inactive',
      externalIntegrationId: 'tenant-a-private-voice',
      metadata: { privateMarker: 'TENANT A PRIVATE VOICE OWNERSHIP' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_B, userId: OWNER_B, provider: 'retell',
      externalIntegrationId: 'tenant-b-private-retell',
      metadata: { privateMarker: 'TENANT B PRIVATE OWNERSHIP' },
    });

    auth = new Map();
    for (const [role, userId] of ROLE_USERS) {
      auth.set(userId, await provisionDurableSession(pool, { userId, organizationId: ORG_A, role }));
    }
    auth.set(OWNER_B, await provisionDurableSession(pool, {
      userId: OWNER_B, organizationId: ORG_B, role: 'owner',
    }));

    await pool.query(
      `INSERT INTO notification_preferences
         (organization_id, notification_email, notification_phone, email_new_lead, sms_new_lead)
       VALUES ($1,'private-notify-a@example.test','+15555550111',TRUE,TRUE),
              ($2,'private-notify-b@example.test','+15555550222',TRUE,FALSE)`,
      [ORG_A, ORG_B]
    );
    await pool.query(
      `INSERT INTO integration_credentials
         (organization_id, provider, access_token, refresh_token, metadata)
       VALUES ($1,'jobber','DISPOSABLE_FAKE_ACCESS_TOKEN','DISPOSABLE_FAKE_REFRESH_TOKEN',
               '{"private":"DISPOSABLE PRIVATE CREDENTIAL METADATA"}'::jsonb)`,
      [ORG_A]
    );
    await pool.query(
      `INSERT INTO oauth_authorization_states
         (provider, organization_id, user_id, auth_session_id, state_hash)
       VALUES ('jobber',$1,$2,$3,$4)`,
      [ORG_A, OWNER_A, auth.get(OWNER_A).sessionId, crypto.createHash('sha256').update('phase6c-oauth').digest('hex')]
    );

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

  test('all four roles receive one deterministic tenant-scoped catalogue and hostile overrides are ignored', async () => {
    const before = await tableDigests(pool);
    let exactDataBytes = null;
    for (const [_role, userId] of ROLE_USERS) {
      const response = await request(app)
        .get('/api/v1/integrations/catalogue')
        .query({ organizationId: ORG_B, tenantId: ORG_B, provider: 'stripe', connected: true })
        .set(auth.get(userId).headers)
        .send({ organizationId: ORG_B, provider: 'retell', status: 'active' });
      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toEqual(['success', 'data', 'requestId']);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        authority: 'northstar_integration_catalogue_v1', version: 1, readOnly: true,
      });
      expect(response.body.data.categories).toHaveLength(7);
      expect(flattenProviders(response.body)).toHaveLength(26);
      expect(provider(response.body, 'retell').presentation.label).toBe('Needs attention');
      expect(provider(response.body, 'voice').presentation.label).toBe('Disconnected');
      expect(provider(response.body, 'stripe').presentation.label).toBe('Requires provider approval');
      expect(provider(response.body, 'jobber').presentation.label).toBe('Coming soon');
      expect(provider(response.body, 'google_maps').authority.basis).toBe('catalogue_only_navigation_deferred');
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toMatch(/tenant-a-private|tenant-b-private|PRIVATE OWNERSHIP|PRIVATE VOICE CONFIG|LEGACY PRIVATE|DISPOSABLE_FAKE|DISPOSABLE PRIVATE|private-notify|\+1555555/i);
      exactDataBytes = exactDataBytes || JSON.stringify(response.body.data);
      expect(JSON.stringify(response.body.data)).toBe(exactDataBytes);
    }

    const otherTenant = await request(app)
      .get('/api/v1/integrations/catalogue')
      .set(auth.get(OWNER_B).headers);
    expect(otherTenant.status).toBe(200);
    expect(provider(otherTenant.body, 'retell').presentation.label).toBe('Connected');
    expect(provider(otherTenant.body, 'voice').presentation.label).toBe('Requires provider approval');
    expect(JSON.stringify(otherTenant.body)).not.toContain('Needs attention');

    expect(await tableDigests(pool)).toEqual(before);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('authentication, tenant membership, and the existing status byte/order contract remain exact', async () => {
    expect((await request(app).get('/api/v1/integrations/catalogue')).status).toBe(401);
    const catalogue = await request(app)
      .get('/api/v1/integrations/catalogue')
      .set(auth.get(VIEWER_A).headers);
    expect(catalogue.status).toBe(200);

    const legacyStatus = await request(app)
      .get('/api/v1/integrations/status')
      .set(auth.get(VIEWER_A).headers);
    expect(legacyStatus.status).toBe(200);
    expect(Object.keys(legacyStatus.body)).toEqual(['success', 'data', 'requestId']);
    expect(Object.keys(legacyStatus.body.data)).toEqual(['authority', 'connectors']);
    expect(JSON.stringify(legacyStatus.body.data)).toBe(JSON.stringify({
      authority: 'canonical_integration_ownership',
      connectors: [
        { provider: 'retell', status: 'ambiguous' },
        { provider: 'voice', status: 'inactive' },
      ],
    }));
  });

  test('a catalogue persistence outage fails closed after real session authorization and performs no write', async () => {
    const { createIntegrationStatusRouter } = require('../../src/routes/integrationStatus');
    const failingApp = express();
    failingApp.use(express.json());
    failingApp.use('/api/v1/integrations', createIntegrationStatusRouter({
      poolProvider: () => ({ query: async () => { throw new Error('disposable outage'); } }),
    }));
    const before = await tableDigests(pool);
    const response = await request(failingApp)
      .get('/api/v1/integrations/catalogue')
      .set(auth.get(OWNER_A).headers);
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'CANONICAL_PERSISTENCE_UNAVAILABLE',
        message: 'Canonical PostgreSQL persistence is unavailable.',
      },
    });
    expect(await tableDigests(pool)).toEqual(before);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
