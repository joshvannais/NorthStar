'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

function cookies(response) {
  const result = {};
  for (const value of response.headers['set-cookie'] || []) {
    const pair = value.split(';')[0];
    const separator = pair.indexOf('=');
    result[pair.slice(0, separator)] = decodeURIComponent(pair.slice(separator + 1));
  }
  return result;
}

function cookieHeader(values) {
  return Object.entries(values).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
}

describe('mounted account authority gates on required PostgreSQL 18', () => {
  let allocation;
  let db;
  let pool;
  let app;
  const original = {};

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) throw new Error('Disposable PostgreSQL 18 identity is required');
    allocation = await createSuiteDatabase('account-authority-gates');
    for (const key of [
      'DATABASE_URL', 'AUTH_ACCESS_SECRET', 'ACCOUNT_SIGNUP_ENABLED',
      'ACCOUNT_VERIFICATION_DELIVERY_READY', 'AUTH_BEARER_COMPAT_ENABLED',
    ]) original[key] = process.env[key];
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
    process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'true';
    process.env.AUTH_BEARER_COMPAT_ENABLED = 'true';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    app = require('../helpers/account-test-app').createDisposableAccountApp();
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (allocation) await allocation.cleanup();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }, 60000);

  async function signup(email) {
    await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
    return request(app).post('/api/auth/signup').send({
      name: 'Gate Owner', businessName: `Gate ${email}`, phone: '8605550101',
      email, password: 'durable gate password',
    });
  }

  test('production mount rejects signup despite every environment boolean and performs zero writes/cookies', async () => {
    const before = await pool.query('SELECT count(*)::int AS count FROM organizations');
    const productionApp = require('../../src/server').app;
    const querySpy = jest.spyOn(pool, 'query');
    const response = await request(productionApp).post('/api/auth/signup').send({
      name: 'No Write', businessName: 'No Write', phone: '8605550102',
      email: 'production-disabled@example.test', password: 'durable gate password',
    });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('signup_disabled');
    expect(response.headers['set-cookie']).toBeUndefined();
    await new Promise(resolve => setImmediate(resolve));
    const writes = querySpy.mock.calls.filter(([statement]) => (
      /^(?:\s|\/\*[\s\S]*?\*\/)*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(String(statement))
    ));
    querySpy.mockRestore();
    expect(writes).toEqual([]);
    const after = await pool.query('SELECT count(*)::int AS count FROM organizations');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  test('pending user reads its tenant dashboard, opens/saves onboarding, and remains unverified', async () => {
    const created = await signup('pending-gates@example.test');
    expect(created.status).toBe(201);
    const jar = cookies(created);
    const headers = { Cookie: cookieHeader(jar), 'X-CSRF-Token': jar.northstar_csrf };

    const dashboard = await request(app).get('/api/v1/canonical/status').set(headers);
    expect(dashboard.status).toBe(200);
    const initial = await request(app).get('/api/v1/business-profile').set(headers);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ success: true, onboardingDraft: true });
    expect(initial.body.data.company.email).toBe('pending-gates@example.test');

    const saved = await request(app).put('/api/v1/business-profile').set(headers)
      .send(canonicalFenceProfile({ companyName: 'Pending Gate Company' }));
    expect(saved.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set(headers);
    expect(me.status).toBe(200);
    expect(me.body.account.user.status).toBe('pending_verification');
    expect(me.body.account.onboarding.status).toBe('complete');

    const internal = await request(app).post('/api/v1/simulations/leads').set(headers).send({});
    expect(internal.status).toBe(422);
    expect(internal.body.error.code).toBe('service_required');

    const external = await request(app).put('/api/v1/canonical/integrations/retell').set(headers).send({
      externalIntegrationId: 'pending-must-not-bind', organizationId: crypto.randomUUID(), role: 'owner',
    });
    expect(external.status).toBe(403);
    expect(external.body.code).toBe('verification_required');
    const bound = await pool.query("SELECT count(*)::int AS count FROM canonical_integration_ownership WHERE external_integration_id = 'pending-must-not-bind'");
    expect(bound.rows[0].count).toBe(0);
  });

  test('verified incomplete user is directed by the onboarding gate while tenant reads remain available', async () => {
    const created = await signup('verified-incomplete@example.test');
    const jar = cookies(created);
    const headers = { Cookie: cookieHeader(jar), 'X-CSRF-Token': jar.northstar_csrf };
    const user = await pool.query("SELECT id FROM users WHERE email_normalized = 'verified-incomplete@example.test'");
    // Test provisioning only; this is not verification-flow evidence (PR B owns that flow).
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [user.rows[0].id]);
    expect((await request(app).get('/api/v1/canonical/status').set(headers)).status).toBe(200);
    const denied = await request(app).post('/api/v1/voice/call').set(headers).send({ phoneNumber: '8605550103' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('onboarding_required');
  });

  test('verified completed authority is PostgreSQL-owned and ignores forged tenant/role fields', async () => {
    const created = await signup('verified-complete-gates@example.test');
    expect(created.status).toBe(201);
    const createdJar = cookies(created);
    const saved = await request(app).put('/api/v1/business-profile')
      .set({ Cookie: cookieHeader(createdJar), 'X-CSRF-Token': createdJar.northstar_csrf })
      .send(canonicalFenceProfile({ companyName: 'Verified Complete Gate Company' }));
    expect(saved.status).toBe(200);
    const user = await pool.query("SELECT id, organization_id FROM users WHERE email_normalized = 'verified-complete-gates@example.test'");
    expect(user.rows).toHaveLength(1);
    // Test provisioning only; this is not verification-flow evidence (PR B owns that flow).
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [user.rows[0].id]);
    const login = await request(app).post('/api/auth/login').send({
      email: 'verified-complete-gates@example.test', password: 'durable gate password',
    });
    const jar = cookies(login);
    const externalId = `verified-${crypto.randomUUID()}`;
    const allowed = await request(app).put('/api/v1/canonical/integrations/retell')
      .set({ Cookie: cookieHeader(jar), 'X-CSRF-Token': jar.northstar_csrf })
      .send({ externalIntegrationId: externalId, organizationId: crypto.randomUUID(), role: 'owner' });
    expect(allowed.status).toBe(200);
    const stored = await pool.query(
      'SELECT organization_id FROM canonical_integration_ownership WHERE external_integration_id = $1',
      [externalId]
    );
    expect(stored.rows).toEqual([{ organization_id: user.rows[0].organization_id }]);
  });

  test('Bearer is retired regardless of flags or forged claims and browser source never constructs it', async () => {
    const jar = cookies(await signup('bearer-retired-gates@example.test'));
    for (const token of [
      jar.northstar_access,
      jwt.sign({ sub: crypto.randomUUID(), sid: crypto.randomUUID(), role: 'owner', organizationId: crypto.randomUUID(), onboardingStatus: 'complete' }, process.env.AUTH_ACCESS_SECRET),
      'missing-session',
    ]) {
      const response = await request(app).get('/api/v1/canonical/status').set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('unauthorized');
    }
    const browser = fs.readFileSync(path.resolve(__dirname, '../../public/js/auth-session.js'), 'utf8');
    expect(browser).not.toMatch(/Authorization|Bearer/);
  });

  test('current membership and session revocation invalidate cookie authority immediately', async () => {
    const jar = cookies(await signup('revocation-gates@example.test'));
    const decoded = jwt.decode(jar.northstar_access);
    await pool.query("UPDATE organization_memberships SET status = 'suspended' WHERE user_id = $1", [decoded.sub]);
    const inactive = await request(app).get('/api/v1/canonical/status').set('Cookie', cookieHeader(jar));
    expect(inactive.status).toBe(403);
    expect(inactive.body.code).toBe('organization_membership_required');
    await pool.query("UPDATE organization_memberships SET status = 'active' WHERE user_id = $1", [decoded.sub]);
    await pool.query("UPDATE auth_sessions SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'test_revocation' WHERE id = $1", [decoded.sid]);
    const revoked = await request(app).get('/api/v1/canonical/status').set('Cookie', cookieHeader(jar));
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe('session_inactive');
  });

  test('public demo outbound action is retired before provider creation', async () => {
    const response = await request(app).post('/api/demo/call').send({ phoneNumber: '8605550199' });
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('demo_external_action_retired');
  });
});
