'use strict';

const crypto = require('crypto');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

function cookieMap(response) {
  const result = {};
  for (const value of response.headers['set-cookie'] || []) {
    const pair = value.split(';')[0];
    const separator = pair.indexOf('=');
    result[pair.slice(0, separator)] = decodeURIComponent(pair.slice(separator + 1));
  }
  return result;
}

function cookieHeader(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; ');
}

realPostgres('Account Lifecycle PR A mounted PostgreSQL authority', () => {
  let suiteDatabase;
  let db;
  let pool;
  let app;
  let putBusinessProfile;
  const originals = {};

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('account-lifecycle');
    for (const key of ['DATABASE_URL', 'AUTH_ACCESS_SECRET', 'ACCOUNT_SIGNUP_ENABLED', 'ACCOUNT_VERIFICATION_DELIVERY_READY']) {
      originals[key] = process.env[key];
    }
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
    process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'false';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    ({ app } = require('../../src/server'));
    ({ putBusinessProfile } = require('../../src/services/organizationAuthority'));
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (suiteDatabase) await suiteDatabase.cleanup();
    Object.entries(originals).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }, 60000);

  async function signup(email, password = 'twelve chars!') {
    await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
    return request(app).post('/api/auth/signup').send({
      name: 'Account Owner',
      businessName: `Business ${email}`,
      phone: '8605550100',
      email,
      password,
    });
  }

  test('signup atomically creates the restricted canonical graph and cookie-only credentials', async () => {
    const response = await signup('  OWNER.One@Example.Test  ');
    expect(response.status).toBe(201);
    expect(response.body.account.user).toMatchObject({ email: 'owner.one@example.test', status: 'pending_verification' });
    expect(response.body.account.membership).toMatchObject({ role: 'owner', status: 'active' });
    expect(response.body.account.onboarding.status).toBe('pending_verification');
    expect(JSON.stringify(response.body)).not.toMatch(/accessToken|refreshToken|passwordHash|northstar_access/);

    const setCookies = response.headers['set-cookie'];
    const accessCookie = setCookies.find(value => value.startsWith('northstar_access='));
    const refreshCookie = setCookies.find(value => value.startsWith('northstar_refresh='));
    const csrfCookie = setCookies.find(value => value.startsWith('northstar_csrf='));
    for (const value of [accessCookie, refreshCookie, csrfCookie]) {
      expect(value).toMatch(/Path=\//i);
      expect(value).toMatch(/SameSite=Lax/i);
    }
    expect(accessCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(csrfCookie).not.toMatch(/HttpOnly/i);

    const graph = await pool.query(
      `SELECT u.id AS user_id, u.email_normalized, u.status AS user_status,
              membership.id AS membership_id, membership.role,
              subscription.status AS subscription_status, subscription.trial_ends,
              onboarding.status AS onboarding_status,
              preferences.organization_id AS preferences_org,
              account_preferences.organization_id AS account_preferences_org
         FROM users u
         JOIN organization_memberships membership ON membership.user_id = u.id
         JOIN subscriptions subscription ON subscription.organization_id = u.organization_id
         JOIN organization_onboarding onboarding ON onboarding.organization_id = u.organization_id
         JOIN notification_preferences preferences ON preferences.organization_id = u.organization_id
         JOIN organization_account_preferences account_preferences ON account_preferences.organization_id = u.organization_id
        WHERE u.email_normalized = $1`,
      ['owner.one@example.test']
    );
    expect(graph.rows).toHaveLength(1);
    expect(graph.rows[0]).toMatchObject({
      email_normalized: 'owner.one@example.test', user_status: 'pending_verification',
      role: 'owner', subscription_status: 'trial', onboarding_status: 'pending_verification',
    });
    const trialDays = (new Date(graph.rows[0].trial_ends).getTime() - Date.now()) / 86400000;
    expect(trialDays).toBeGreaterThan(13.9);
    expect(trialDays).toBeLessThanOrEqual(14.01);

    const sessions = await pool.query(
      `SELECT session.status, session.csrf_token_hash, token.token_hash, token.family_id
         FROM auth_sessions session JOIN auth_refresh_tokens token ON token.session_id = session.id
        WHERE session.user_id = $1`,
      [graph.rows[0].user_id]
    );
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].csrf_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);

    const jar = cookieMap(response);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(jar));
    expect(me.status).toBe(200);
    expect(me.body.account.user.status).toBe('pending_verification');
    const protectedResponse = await request(app).get('/api/v1/canonical/status').set('Cookie', cookieHeader(jar));
    expect(protectedResponse.status).toBe(403);
    expect(protectedResponse.body.code).toBe('onboarding_required');
  });

  test('case variants collide after normalization and validation enforces frozen boundaries', async () => {
    expect((await signup('Case.Owner@Example.Test')).status).toBe(201);
    const duplicate = await signup('  case.owner@example.test ');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('account_exists');
    const count = await pool.query("SELECT count(*)::int AS count FROM users WHERE email_normalized = 'case.owner@example.test'");
    expect(count.rows[0].count).toBe(1);

    expect((await signup('short@example.test', '12345678901')).status).toBe(400);
    expect((await signup('long@example.test', 'x'.repeat(129))).status).toBe(400);
    expect((await signup(`${'a'.repeat(244)}@example.test`)).status).toBe(400);
  });

  test('missing, wrong, and cross-session CSRF are rejected before mutation', async () => {
    const first = cookieMap(await signup('csrf-one@example.test'));
    const second = cookieMap(await signup('csrf-two@example.test'));
    const firstHeader = cookieHeader(first);

    const missing = await request(app).post('/api/auth/logout').set('Cookie', firstHeader);
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe('csrf_invalid');

    const wrong = await request(app).post('/api/auth/logout').set('Cookie', firstHeader).set('X-CSRF-Token', 'wrong');
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('csrf_invalid');

    const cross = await request(app).post('/api/auth/logout').set('Cookie', firstHeader).set('X-CSRF-Token', second.northstar_csrf);
    expect(cross.status).toBe(403);
    expect(cross.body.code).toBe('csrf_invalid');
  });

  test('refresh rotates once, replay revokes the family, and the replacement cannot continue', async () => {
    const original = cookieMap(await signup('rotate@example.test'));
    const rotatedResponse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(original))
      .set('X-CSRF-Token', original.northstar_csrf);
    expect(rotatedResponse.status).toBe(200);
    const replacement = cookieMap(rotatedResponse);
    expect(replacement.northstar_refresh).not.toBe(original.northstar_refresh);
    expect(replacement.northstar_csrf).not.toBe(original.northstar_csrf);

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(original))
      .set('X-CSRF-Token', original.northstar_csrf);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('refresh_replay');

    const rejectedReplacement = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(replacement))
      .set('X-CSRF-Token', replacement.northstar_csrf);
    expect(rejectedReplacement.status).toBe(403);

    const family = await pool.query(
      `SELECT session.status AS session_status, array_agg(token.status ORDER BY token.created_at) AS token_statuses
         FROM auth_sessions session JOIN auth_refresh_tokens token ON token.session_id = session.id
        JOIN users u ON u.id = session.user_id
        WHERE u.email_normalized = 'rotate@example.test'
        GROUP BY session.id`
    );
    expect(family.rows[0].session_status).toBe('revoked');
    expect(family.rows[0].token_statuses).toEqual(expect.arrayContaining(['reused', 'revoked']));
  });

  test('logout revokes the session and clears all browser credentials', async () => {
    const jar = cookieMap(await signup('logout@example.test'));
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', jar.northstar_csrf);
    expect(logout.status).toBe(200);
    expect(logout.headers['set-cookie'].filter(value => /northstar_(access|refresh|csrf)=/.test(value))).toHaveLength(3);
    expect(logout.headers['set-cookie'].every(value => /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(value))).toBe(true);
    const status = await pool.query(
      `SELECT session.status FROM auth_sessions session JOIN users u ON u.id = session.user_id
        WHERE u.email_normalized = 'logout@example.test'`
    );
    expect(status.rows[0].status).toBe('revoked');
  });

  test('an active Business Profile satisfies onboarding and later suspension fails closed', async () => {
    const signupResponse = await signup('active-profile@example.test');
    const jar = cookieMap(signupResponse);
    const user = await pool.query("SELECT id, organization_id FROM users WHERE email_normalized = 'active-profile@example.test'");
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [user.rows[0].id]);
    await putBusinessProfile(pool, {
      organizationId: user.rows[0].organization_id,
      userId: user.rows[0].id,
      profile: canonicalFenceProfile({ companyName: 'Active Profile Company' }),
    });

    const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(jar));
    expect(me.status).toBe(200);
    expect(me.body.account.onboarding.status).toBe('complete');
    expect((await request(app).get('/api/account/preferences').set('Cookie', cookieHeader(jar))).status).toBe(200);

    await pool.query("UPDATE organization_memberships SET status = 'suspended' WHERE user_id = $1", [user.rows[0].id]);
    const suspended = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(jar));
    expect(suspended.status).toBe(403);
    expect(suspended.body.code).toBe('organization_membership_required');
  });

  test('login abuse limits persist in PostgreSQL without recording raw email or IP keys', async () => {
    await signup('rate-limit@example.test');
    await pool.query("DELETE FROM auth_rate_limits WHERE event_type IN ('login_ip', 'login_email')");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({ email: 'RATE-LIMIT@example.test', password: 'wrong password value' });
      expect(response.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'rate-limit@example.test', password: 'wrong password value' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');
    const limits = await pool.query("SELECT event_type, key_hash FROM auth_rate_limits WHERE event_type IN ('login_ip', 'login_email')");
    expect(limits.rows.length).toBeGreaterThanOrEqual(2);
    expect(limits.rows.every(row => /^[0-9a-f]{64}$/.test(row.key_hash))).toBe(true);
    expect(JSON.stringify(limits.rows)).not.toContain('rate-limit@example.test');
  });
});
