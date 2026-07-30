'use strict';

const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const express = require('express');
const request = require('supertest');
const { Client } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

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
  return Object.entries(values)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('; ');
}

function writablePreferences(overrides = {}) {
  return {
    companyName: 'Preference Company',
    companyPhone: '8605550100',
    services: 'Fencing',
    companyInfo: 'Internal profile notes',
    greeting: 'Thank you for calling',
    smartRouting: false,
    contacts: [],
    emailEnabled: false,
    emailCallSummary: false,
    emailAppointment: false,
    smsEnabled: false,
    smsUrgent: false,
    emailAddress: 'alerts@example.test',
    smsNumber: '8605550100',
    ...overrides,
  };
}

function runRefreshWorker(connectionString, secret, material) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, '../helpers/account-refresh-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        AUTH_ACCESS_SECRET: secret,
      },
      silent: true,
    });
    let stderr = '';
    let outcome = null;
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('message', message => {
      if (message.type === 'ready') {
        child.send({
          action: 'refresh',
          refreshToken: material.northstar_refresh,
          csrfToken: material.northstar_csrf,
        });
      } else if (message.type === 'result') {
        outcome = message.outcome;
      } else if (message.type === 'error') {
        outcome = message.code;
      }
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (outcome !== null) resolve(outcome);
      else reject(new Error(`account worker exited before result: ${code}\n${stderr}`));
    });
  });
}

describe('mounted PostgreSQL notification preferences and durable logout', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let secret;
  const originals = {};

  function mountApplication(targetPool) {
    const { AccountRepository } = require('../../src/accounts/repository');
    const { AccountService } = require('../../src/accounts/service');
    const { createAuthRouter } = require('../../src/routes/auth');
    const service = new AccountService(new AccountRepository(targetPool));
    const mounted = express();
    mounted.use(express.json({ limit: '64kb' }));
    mounted.use((req, _res, next) => {
      req.requestId = `account-preferences-${crypto.randomUUID()}`;
      next();
    });
    mounted.use('/api/auth', createAuthRouter({
      service,
      signup: service.signup.bind(service),
    }));
    mounted.use('/api/account', require('../../src/routes/account'));
    return mounted;
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for account preference/logout ratification');
    }
    allocation = await createSuiteDatabase('account-preferences-logout');
    for (const key of ['DATABASE_URL', 'AUTH_ACCESS_SECRET']) originals[key] = process.env[key];
    secret = crypto.randomBytes(48).toString('hex');
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = secret;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();

    app = mountApplication(pool);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (allocation) await allocation.cleanup();
    Object.entries(originals).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }, 60000);

  async function signup(email, phone = '8605550100') {
    await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
    return request(app).post('/api/auth/signup').send({
      name: 'Preference Owner',
      businessName: `Preference ${email}`,
      phone,
      email,
      password: 'preference password 123',
    });
  }

  test('signup creates exactly one opt-in notification row and pending accounts receive the server projection', async () => {
    const response = await signup('preference-defaults@example.test', '8605550199');
    expect(response.status).toBe(201);
    const jar = cookieMap(response);
    const state = await pool.query(
      `SELECT count(*)::int AS row_count,
              bool_or(email_new_lead) AS email_new_lead,
              bool_or(email_call_summary) AS email_call_summary,
              bool_or(email_appointment) AS email_appointment,
              bool_or(sms_new_lead) AS sms_new_lead,
              bool_or(sms_urgent) AS sms_urgent,
              max(notification_email) AS notification_email,
              max(notification_phone) AS notification_phone
         FROM notification_preferences preference
         JOIN users account ON account.organization_id = preference.organization_id
        WHERE account.email_normalized = $1`,
      ['preference-defaults@example.test']
    );
    expect(state.rows[0]).toEqual({
      row_count: 1,
      email_new_lead: false,
      email_call_summary: false,
      email_appointment: false,
      sms_new_lead: false,
      sms_urgent: false,
      notification_email: 'preference-defaults@example.test',
      notification_phone: '8605550199',
    });

    const loaded = await request(app)
      .get('/api/account/preferences')
      .set('Cookie', cookieHeader(jar));
    expect(loaded.status).toBe(200);
    expect(loaded.body.preferences).toMatchObject({
      emailEnabled: false,
      emailCallSummary: false,
      emailAppointment: false,
      smsEnabled: false,
      smsUrgent: false,
      emailAddress: 'preference-defaults@example.test',
      smsNumber: '8605550199',
      securityEmailMandatory: true,
      securityEmailAddress: 'preference-defaults@example.test',
    });
  });

  test('owner updates are tenant-scoped while malformed, security-email, foreign-tenant, and viewer writes fail closed', async () => {
    const ownerA = cookieMap(await signup('preference-owner-a@example.test'));
    await signup('preference-owner-b@example.test');
    const saved = await request(app)
      .put('/api/account/preferences')
      .set('Cookie', cookieHeader(ownerA))
      .set('X-CSRF-Token', ownerA.northstar_csrf)
      .send(writablePreferences({ emailEnabled: true, smsEnabled: true }));
    expect(saved.status).toBe(200);
    expect(saved.body.preferences).toMatchObject({
      emailEnabled: true,
      smsEnabled: true,
      securityEmailMandatory: true,
    });

    const stored = await pool.query(
      `SELECT account.email_normalized, account.organization_id,
              preference.email_new_lead, preference.sms_new_lead,
              internal.preferences
         FROM users account
         JOIN notification_preferences preference ON preference.organization_id = account.organization_id
         JOIN organization_account_preferences internal ON internal.organization_id = account.organization_id
        WHERE account.email_normalized IN ($1, $2)
        ORDER BY account.email_normalized`,
      ['preference-owner-a@example.test', 'preference-owner-b@example.test']
    );
    expect(stored.rows[0]).toMatchObject({
      email_normalized: 'preference-owner-a@example.test',
      email_new_lead: true,
      sms_new_lead: true,
    });
    expect(stored.rows[0].preferences).not.toHaveProperty('emailEnabled');
    expect(stored.rows[0].preferences).not.toHaveProperty('smsEnabled');
    expect(stored.rows[1]).toMatchObject({
      email_normalized: 'preference-owner-b@example.test',
      email_new_lead: false,
      sms_new_lead: false,
    });

    for (const body of [
      writablePreferences({ emailEnabled: 'true' }),
      { ...writablePreferences(), securityEmailMandatory: false },
      { ...writablePreferences(), organizationId: stored.rows[1].organization_id },
      { ...writablePreferences(), unexpectedPreference: true },
    ]) {
      const rejected = await request(app)
        .put('/api/account/preferences')
        .set('Cookie', cookieHeader(ownerA))
        .set('X-CSRF-Token', ownerA.northstar_csrf)
        .send(body);
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('invalid_preferences');
    }

    const userA = await pool.query(
      "SELECT id FROM users WHERE email_normalized = 'preference-owner-a@example.test'"
    );
    await pool.query("UPDATE organization_memberships SET role = 'viewer' WHERE user_id = $1", [userA.rows[0].id]);
    expect((await request(app).get('/api/account/preferences').set('Cookie', cookieHeader(ownerA))).status).toBe(200);
    const viewerWrite = await request(app)
      .put('/api/account/preferences')
      .set('Cookie', cookieHeader(ownerA))
      .set('X-CSRF-Token', ownerA.northstar_csrf)
      .send(writablePreferences());
    expect(viewerWrite.status).toBe(403);
  });

  test('logout commits session and family revocation before clearing cookies and another process rejects the captured refresh', async () => {
    const jar = cookieMap(await signup('durable-logout@example.test'));
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', jar.northstar_csrf);
    expect(logout.status).toBe(200);
    const cleared = (logout.headers['set-cookie'] || []).filter(value => /northstar_(?:access|refresh|csrf)=/.test(value));
    expect(cleared).toHaveLength(3);
    expect(cleared.every(value => /Path=\//i.test(value) && /SameSite=Lax/i.test(value))).toBe(true);
    expect(cleared.every(value => /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(value))).toBe(true);

    const state = await pool.query(
      `SELECT session.status AS session_status,
              count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
              count(*) FILTER (WHERE token.status = 'revoked')::int AS revoked_tokens
         FROM auth_sessions session
         JOIN auth_refresh_tokens token ON token.session_id = session.id
         JOIN users account ON account.id = session.user_id
        WHERE account.email_normalized = 'durable-logout@example.test'
        GROUP BY session.id`
    );
    expect(state.rows).toEqual([{ session_status: 'revoked', active_tokens: 0, revoked_tokens: 1 }]);
    const staleAccess = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(jar));
    expect(staleAccess.status).toBe(401);
    expect(await runRefreshWorker(allocation.connectionString, secret, jar)).toBe('csrf_invalid');

    const repeated = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', jar.northstar_csrf);
    expect(repeated.status).toBe(200);
    expect((repeated.headers['set-cookie'] || []).filter(value =>
      /northstar_(?:access|refresh|csrf)=/.test(value)
    )).toHaveLength(3);
  }, 60000);

  test('a refresh-token revocation fault rolls back the earlier session update and a retry succeeds exactly once', async () => {
    const jar = cookieMap(await signup('rollback-logout@example.test'));
    await pool.query(`
      CREATE FUNCTION account_test_reject_logout() RETURNS trigger AS $$
      BEGIN
        IF NEW.revoke_reason = 'logout' THEN
          RAISE EXCEPTION 'injected logout revocation failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER account_test_reject_logout_trigger
        BEFORE UPDATE ON auth_refresh_tokens
        FOR EACH ROW EXECUTE FUNCTION account_test_reject_logout();
    `);
    const failed = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', jar.northstar_csrf);
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({
      code: 'account_authority_unavailable',
      error: 'Account service is temporarily unavailable',
    });
    expect(failed.headers['set-cookie']).toBeUndefined();

    const afterFailure = await pool.query(
      `SELECT session.status AS session_status, token.status AS token_status
         FROM auth_sessions session
         JOIN auth_refresh_tokens token ON token.session_id = session.id
         JOIN users account ON account.id = session.user_id
        WHERE account.email_normalized = 'rollback-logout@example.test'`
    );
    expect(afterFailure.rows).toEqual([{ session_status: 'active', token_status: 'active' }]);

    await pool.query('DROP TRIGGER account_test_reject_logout_trigger ON auth_refresh_tokens');
    await pool.query('DROP FUNCTION account_test_reject_logout()');
    const retry = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', jar.northstar_csrf);
    expect(retry.status).toBe(200);
    const afterRetry = await pool.query(
      `SELECT session.status AS session_status, token.status AS token_status
         FROM auth_sessions session
         JOIN auth_refresh_tokens token ON token.session_id = session.id
         JOIN users account ON account.id = session.user_id
        WHERE account.email_normalized = 'rollback-logout@example.test'`
    );
    expect(afterRetry.rows).toEqual([{ session_status: 'revoked', token_status: 'revoked' }]);
  });

  test('missing and wrong CSRF leave durable state active and clear no cookies', async () => {
    const jar = cookieMap(await signup('csrf-logout-focused@example.test'));
    for (const csrf of [null, 'wrong-csrf']) {
      let operation = request(app).post('/api/auth/logout').set('Cookie', cookieHeader(jar));
      if (csrf) operation = operation.set('X-CSRF-Token', csrf);
      const response = await operation;
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('csrf_invalid');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    const state = await pool.query(
      `SELECT session.status AS session_status, token.status AS token_status
         FROM auth_sessions session
         JOIN auth_refresh_tokens token ON token.session_id = session.id
         JOIN users account ON account.id = session.user_id
        WHERE account.email_normalized = 'csrf-logout-focused@example.test'`
    );
    expect(state.rows).toEqual([{ session_status: 'active', token_status: 'active' }]);
  });

  test('PostgreSQL unavailability returns bounded failure without cookies or durable false success', async () => {
    const jar = cookieMap(await signup('unavailable-logout@example.test'));
    await db.close();
    try {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookieHeader(jar))
        .set('X-CSRF-Token', jar.northstar_csrf);
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: 'account_authority_unavailable',
        error: 'Account service is temporarily unavailable',
      });
      expect(response.headers['set-cookie']).toBeUndefined();

      const verifier = new Client({ connectionString: allocation.connectionString });
      await verifier.connect();
      try {
        const state = await verifier.query(
          `SELECT session.status AS session_status, token.status AS token_status
             FROM auth_sessions session
             JOIN auth_refresh_tokens token ON token.session_id = session.id
             JOIN users account ON account.id = session.user_id
            WHERE account.email_normalized = 'unavailable-logout@example.test'`
        );
        expect(state.rows).toEqual([{ session_status: 'active', token_status: 'active' }]);
      } finally {
        await verifier.end();
      }
    } finally {
      expect(await db.initDatabase()).toBe(true);
      pool = db.getPool();
      app = mountApplication(pool);
    }
  });
});
