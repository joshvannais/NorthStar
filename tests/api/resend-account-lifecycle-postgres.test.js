'use strict';

const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

function cookieHeader(response) {
  return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
}

function csrf(response) {
  const value = (response.headers['set-cookie'] || []).find(item => item.startsWith('northstar_csrf='));
  return value ? decodeURIComponent(value.split(';')[0].split('=').slice(1).join('=')) : '';
}

function tokenFrom(call, pathname) {
  const body = JSON.parse(call.options.body);
  const match = body.text.match(/https:\/\/[^\s]+/);
  expect(match).not.toBeNull();
  const link = new URL(match[0]);
  expect(link.origin).toBe('https://www.northstar-os.ai');
  expect(link.pathname).toBe(pathname);
  return link.searchParams.get('token');
}

describe('mounted Account Lifecycle B1 delivery through the production Resend adapter', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let priorDatabaseUrl;
  let providerStatus;
  let providerCalls;
  let warningSpy;
  const testKey = 're_disposable_capture_boundary_only';

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) throw new Error('Disposable PostgreSQL 18 identity is required');
    allocation = await createSuiteDatabase('resend account lifecycle');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    providerStatus = 200;
    providerCalls = [];
    warningSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const fetchImpl = async (url, options) => {
      providerCalls.push({ url: String(url), options });
      return new Response(JSON.stringify(providerStatus >= 200 && providerStatus < 300
        ? { id: `capture-message-${providerCalls.length}` }
        : { message: 'capture-only provider rejection' }), {
        status: providerStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const { createProductionTransactionalEmail } = require('../../src/email/transactional');
    const transactionalEmail = createProductionTransactionalEmail({
      PUBLIC_ORIGIN: 'https://www.northstar-os.ai',
      TRANSACTIONAL_EMAIL_FROM: 'notifications@northstar-os.ai',
      RESEND_API_KEY: testKey,
      SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587',
      SMTP_USER: 'retired-user', SMTP_PASS: 'retired-password',
    }, { fetchImpl, timeoutMs: 250 });
    expect(transactionalEmail).not.toBeNull();
    app = require('../helpers/account-test-app').createDisposableAccountApp({ transactionalEmail });
  });

  afterAll(async () => {
    if (warningSpy) warningSpy.mockRestore();
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  });

  test('signup, resend, verification, forgot, and reset preserve authority through one-attempt Resend delivery', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    const email = 'resend.lifecycle@example.test';
    const password = 'Resend-lifecycle-original-123!';

    let before = providerCalls.length;
    const signup = await request(app).post('/api/auth/signup').send({
      name: 'Resend Owner', businessName: 'Resend Company', email: `  ${email.toUpperCase()}  `,
      password, phone: '',
    });
    expect(signup.status).toBe(202);
    expect(signup.headers['set-cookie']).toBeUndefined();
    expect(providerCalls.length).toBe(before);
    await app.drainAccountEmailOutbox();
    expect(providerCalls.length - before).toBe(1);
    const firstVerification = tokenFrom(providerCalls.at(-1), '/verify-email');
    const pending = (await pool.query(
      `SELECT u.status AS user_status, s.status AS subscription_status,
              s.trial_started_at, s.trial_ends_at
         FROM users u JOIN subscriptions s ON s.organization_id = u.organization_id
        WHERE u.email_normalized = $1`, [email]
    )).rows[0];
    expect(pending).toEqual({
      user_status: 'pending_verification', subscription_status: 'pending_verification',
      trial_started_at: null, trial_ends_at: null,
    });

    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const auth = { Cookie: cookieHeader(login), 'X-CSRF-Token': csrf(login) };

    providerStatus = 422;
    before = providerCalls.length;
    const rejectedResend = await request(app).post('/api/auth/resend-verification').set(auth);
    expect(rejectedResend.status).toBe(503);
    expect(rejectedResend.body.code).toBe('verification_delivery_failed');
    expect(providerCalls.length - before).toBe(1);
    const rejectedVerification = tokenFrom(providerCalls.at(-1), '/verify-email');
    expect(rejectedVerification).not.toBe(firstVerification);

    providerStatus = 200;
    before = providerCalls.length;
    const resend = await request(app).post('/api/auth/resend-verification').set(auth);
    expect(resend.status).toBe(200);
    expect(providerCalls.length - before).toBe(1);
    const currentVerification = tokenFrom(providerCalls.at(-1), '/verify-email');
    expect(currentVerification).not.toBe(rejectedVerification);
    expect((await request(app).post('/api/auth/verify-email').send({ token: firstVerification })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: rejectedVerification })).status).toBe(400);
    before = providerCalls.length;
    const verified = await request(app).post('/api/auth/verify-email').send({ token: currentVerification });
    expect(verified.status).toBe(200);
    expect(providerCalls.length).toBe(before);
    expect(new Date(verified.body.trialEndsAt).getTime() - new Date(verified.body.trialStartedAt).getTime())
      .toBe(14 * 86400000);
    expect((await request(app).post('/api/auth/verify-email').send({ token: currentVerification })).status).toBe(400);

    providerStatus = 200;
    before = providerCalls.length;
    const forgotAccepted = await request(app).post('/api/auth/forgot-password').send({ email: email.toUpperCase() });
    expect(forgotAccepted.status).toBe(202);
    expect(forgotAccepted.body.code).toBe('recovery_requested');
    expect(providerCalls.length).toBe(before);
    await app.drainAccountEmailOutbox();
    expect(providerCalls.length - before).toBe(1);

    providerStatus = 422;
    before = providerCalls.length;
    const forgotRejected = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(forgotRejected.status).toBe(forgotAccepted.status);
    expect(forgotRejected.body.code).toBe(forgotAccepted.body.code);
    expect(forgotRejected.body.message).toBe(forgotAccepted.body.message);
    expect(providerCalls.length).toBe(before);
    await app.drainAccountEmailOutbox();
    expect(providerCalls.length - before).toBe(1);

    providerStatus = 200;
    before = providerCalls.length;
    const forgotCurrent = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(forgotCurrent.status).toBe(202);
    expect(providerCalls.length).toBe(before);
    await app.drainAccountEmailOutbox();
    expect(providerCalls.length - before).toBe(1);
    const resetToken = tokenFrom(providerCalls.at(-1), '/reset-password');
    const reset = await request(app).post('/api/auth/reset-password').send({
      token: resetToken, password: 'Resend-lifecycle-replacement-456!',
    });
    expect(reset.status).toBe(200);
    expect(reset.body.redirect).toBe('/login');
    expect(providerCalls.length).toBe(before + 1);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookieHeader(login))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({
      email, password: 'Resend-lifecycle-replacement-456!',
    })).status).toBe(200);

    const authority = (await pool.query(
      `SELECT s.status, s.trial_started_at, s.trial_ends_at,
              (SELECT count(*)::int FROM account_action_tokens t
                WHERE t.user_id = u.id AND t.purpose = 'email_verification'
                  AND t.consumed_at IS NULL AND t.revoked_at IS NULL) AS verification_tokens,
              (SELECT count(*)::int FROM auth_sessions a
                WHERE a.user_id = u.id AND a.status = 'active') AS active_sessions
         FROM users u JOIN subscriptions s ON s.organization_id = u.organization_id
        WHERE u.email_normalized = $1`, [email]
    )).rows[0];
    expect(authority.status).toBe('trialing');
    expect(authority.trial_started_at).not.toBeNull();
    expect(authority.trial_ends_at).not.toBeNull();
    expect(authority.verification_tokens).toBe(0);
    expect(authority.active_sessions).toBe(1);
  }, 60000);

  test('provider rejection after accepted signup stays off the public path and leaves bounded retry authority', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    providerStatus = 403;
    const email = 'resend.rejected@example.test';
    const before = providerCalls.length;
    const response = await request(app).post('/api/auth/signup').send({
      name: 'Rejected Owner', businessName: 'Rejected Company', email,
      password: 'Resend-rejected-password-123!', phone: '',
    });
    expect(response.status).toBe(202);
    expect(response.body.code).toBe('verification_required');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(providerCalls.length).toBe(before);
    await expect(app.drainAccountEmailOutbox()).resolves.toEqual({
      claimed: 1, delivered: 0, configurationUnavailable: false,
    });
    expect(providerCalls.length - before).toBe(1);
    const durable = (await pool.query(
      `SELECT u.status AS user_status, s.status AS subscription_status,
              s.trial_started_at, s.trial_ends_at,
              (SELECT count(*)::int FROM account_action_tokens t WHERE t.user_id = u.id) AS tokens,
              (SELECT state FROM account_email_outbox outbox WHERE outbox.user_id = u.id) AS delivery_state,
              (SELECT attempt_count FROM account_email_outbox outbox WHERE outbox.user_id = u.id) AS delivery_attempts,
              (SELECT count(*)::int FROM auth_sessions a WHERE a.user_id = u.id) AS sessions
         FROM users u JOIN subscriptions s ON s.organization_id = u.organization_id
        WHERE u.email_normalized = $1`, [email]
    )).rows;
    expect(durable).toEqual([{
      user_status: 'pending_verification', subscription_status: 'pending_verification',
      trial_started_at: null, trial_ends_at: null, tokens: 1,
      delivery_state: 'retry', delivery_attempts: 1, sessions: 0,
    }]);
    const diagnostics = JSON.stringify(warningSpy.mock.calls);
    expect(diagnostics).toContain('provider_access_rejected');
    for (const forbidden of [testKey, email, 'notifications@northstar-os.ai', 'Bearer ', 'token=',
      'Idempotency-Key', 'capture-only provider rejection']) {
      expect(diagnostics).not.toContain(forbidden);
    }
  }, 30000);

  test('the production adapter emits only fixed Resend requests and never adds reply or recipient-controlled fields', () => {
    expect(providerCalls.length).toBeGreaterThan(0);
    for (const call of providerCalls) {
      const body = JSON.parse(call.options.body);
      expect(call.url).toBe('https://api.resend.com/emails');
      expect(call.options.method).toBe('POST');
      expect(call.options.redirect).toBe('manual');
      expect(Object.keys(call.options.headers).sort()).toEqual(['Authorization', 'Content-Type', 'Idempotency-Key']);
      expect(call.options.headers.Authorization).toBe(`Bearer ${testKey}`);
      expect(call.options.headers['Content-Type']).toBe('application/json');
      expect(call.options.headers['Idempotency-Key']).toMatch(/^northstar-b1-(email-verification|password-reset)-[0-9a-f]{64}$/);
      expect(call.options.headers['Idempotency-Key'].length).toBeLessThanOrEqual(256);
      expect(body.from).toBe('NorthStar Notifications <notifications@northstar-os.ai>');
      expect(body.to).toHaveLength(1);
      expect(body.to[0]).toBe(body.to[0].trim().toLowerCase());
      expect(body).toEqual(expect.objectContaining({ subject: expect.any(String), text: expect.any(String), html: expect.any(String) }));
      for (const field of ['reply_to', 'cc', 'bcc', 'headers']) expect(body).not.toHaveProperty(field);
      expect(JSON.stringify(body)).not.toContain('http://');
    }
  });
});
