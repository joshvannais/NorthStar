'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

function cookies(response) {
  return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
}

function csrf(response) {
  const value = (response.headers['set-cookie'] || []).find(item => item.startsWith('northstar_csrf='));
  return value ? decodeURIComponent(value.split(';')[0].split('=').slice(1).join('=')) : '';
}

function linkToken(message, pathname) {
  const match = String(message && message.text || '').match(/https?:\/\/[^\s]+/);
  expect(match).not.toBeNull();
  const link = new URL(match[0]);
  expect(link.pathname).toBe(pathname);
  return link.searchParams.get('token');
}

function expectSourceOwnedSender(message, address = 'security@account-b1.example.test') {
  expect(message).toEqual(expect.objectContaining({
    from: { name: 'NorthStar Notifications', address },
  }));
  expect(message).not.toHaveProperty('replyTo');
}

function runActionWorker(connectionString, message) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, '../helpers/account-b1-action-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: connectionString },
      silent: true,
    });
    let result = null;
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('message', value => { result = value; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0 && result && result.type === 'result') return resolve(result);
      reject(new Error(`Account B1 worker failed: ${code}; ${stderr}`));
    });
    child.send(message);
  });
}

describe('Account Lifecycle PR B1 mounted PostgreSQL authority', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let capture;
  let priorDatabaseUrl;
  let controlledNow = null;

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for Account Lifecycle PR B1');
    }
    allocation = await createSuiteDatabase('account lifecycle b1');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();

    const { AccountRepository } = require('../../src/accounts/repository');
    const { AccountService } = require('../../src/accounts/service');
    const { TransactionalEmail } = require('../../src/email/transactional');
    const { createAuthRouter } = require('../../src/routes/auth');
    capture = {
      messages: [],
      async send(message) {
        this.messages.push(JSON.parse(JSON.stringify(message)));
        return { accepted: true, id: 'capture-' + this.messages.length };
      },
    };
    const repository = new AccountRepository(pool, { testClock: () => controlledNow });
    const service = new AccountService(repository, {
      transactionalEmail: new TransactionalEmail({
        adapter: capture,
        publicOrigin: 'https://account-b1.example.test',
        from: 'security@account-b1.example.test',
        production: false,
      }),
    });
    app = express();
    app.locals.accountRepository = repository;
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({
      service,
      signup: service.signup.bind(service),
    }));
    app.use('/api/account', require('../../src/routes/account'));
  });

  afterAll(async () => {
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  });

  test('signup commits pending authority and one hash-only verification token without session cookies', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'B1 Owner',
        businessName: 'B1 Company',
        email: '  Owner.B1@Example.Test ',
        password: 'B1-authentic-password-123!',
        phone: '+1 555 010 1010',
      });

    if (response.status !== 202) {
      throw new Error(`Unexpected signup response: ${response.status} ${JSON.stringify(response.body)}`);
    }
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      code: 'verification_required',
    }));
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(capture.messages).toHaveLength(1);
    expectSourceOwnedSender(capture.messages[0]);

    const durable = await pool.query(
      `SELECT u.email, u.email_normalized, u.status AS user_status,
              s.status AS subscription_status, s.trial_started_at, s.trial_ends_at,
              (SELECT count(*)::int FROM account_action_tokens t
                WHERE t.user_id = u.id AND t.organization_id = u.organization_id
                  AND t.purpose = 'email_verification' AND t.consumed_at IS NULL
                  AND t.revoked_at IS NULL) AS current_tokens,
              (SELECT count(*)::int FROM auth_sessions a WHERE a.user_id = u.id) AS sessions,
              (SELECT count(*)::int FROM auth_refresh_tokens r
                JOIN auth_sessions a ON a.id = r.session_id WHERE a.user_id = u.id) AS refresh_tokens
         FROM users u
         JOIN subscriptions s ON s.organization_id = u.organization_id
        WHERE u.email_normalized = 'owner.b1@example.test'`
    );
    expect(durable.rows).toEqual([expect.objectContaining({
      email: 'owner.b1@example.test',
      email_normalized: 'owner.b1@example.test',
      user_status: 'pending_verification',
      subscription_status: 'pending_verification',
      trial_started_at: null,
      trial_ends_at: null,
      current_tokens: 1,
      sessions: 0,
      refresh_tokens: 0,
    })]);

    const tokenProjection = await pool.query(
      `SELECT token_hash, octet_length(token_hash) AS hash_length
         FROM account_action_tokens
        WHERE purpose = 'email_verification'`
    );
    expect(tokenProjection.rows).toHaveLength(1);
    expect(tokenProjection.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(tokenProjection.rows[0])).not.toContain('token=');
  });

  test('mounted recovery and subscription contracts replace the PR A unavailable stubs', async () => {
    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'missing@example.test' });
    expect(forgot.status).toBe(202);
    expect(forgot.body).toEqual(expect.objectContaining({ code: 'recovery_requested' }));

    const policy = require('../../src/accounts/subscriptionPolicy');
    const now = new Date('2026-08-01T12:00:00.000Z');
    expect(policy.projectSubscription({
      subscription_status: 'trialing',
      trial_started_at: '2026-08-01T12:00:00.000Z',
      trial_ends_at: '2026-08-15T12:00:00.000Z',
      server_now: now.toISOString(),
    })).toEqual(expect.objectContaining({
      state: 'trialing',
      daysRemaining: 14,
      readOnly: false,
      showTrialBanner: true,
    }));
  });

  test('resend supersedes the prior token and verification starts exactly one 14-day trial', async () => {
    await pool.query("DELETE FROM auth_rate_limits WHERE event_type IN ('signup_ip','login_ip','login_email','verification_ip','verification_user')");
    const signup = await request(app).post('/api/auth/signup').send({
      name: 'Verification Owner', businessName: 'Verification Company',
      email: 'verify.b1@example.test', password: 'Verification-password-123!', phone: '',
    });
    expect(signup.status).toBe(202);
    const originalToken = linkToken(capture.messages.at(-1), '/verify-email');
    expectSourceOwnedSender(capture.messages.at(-1));

    const login = await request(app).post('/api/auth/login').send({
      email: 'verify.b1@example.test', password: 'Verification-password-123!',
    });
    expect(login.status).toBe(200);
    const resend = await request(app)
      .post('/api/auth/resend-verification')
      .set('Cookie', cookies(login))
      .set('X-CSRF-Token', csrf(login));
    expect(resend.status).toBe(200);
    const currentToken = linkToken(capture.messages.at(-1), '/verify-email');
    expectSourceOwnedSender(capture.messages.at(-1));
    expect(currentToken).not.toBe(originalToken);

    const superseded = await request(app).post('/api/auth/verify-email').send({ token: originalToken });
    expect(superseded.status).toBe(400);
    expect(superseded.body.code).toBe('verification_invalid');

    const verified = await request(app).post('/api/auth/verify-email').send({ token: currentToken });
    expect(verified.status).toBe(200);
    const start = new Date(verified.body.trialStartedAt).getTime();
    const end = new Date(verified.body.trialEndsAt).getTime();
    expect(end - start).toBe(14 * 86400000);

    const replay = await request(app).post('/api/auth/verify-email').send({ token: currentToken });
    expect(replay.status).toBe(400);
    const authority = await pool.query(
      `SELECT u.status AS user_status, s.status AS subscription_status,
              s.trial_started_at, s.trial_ends_at,
              (SELECT count(*)::int FROM account_action_tokens t
                WHERE t.user_id = u.id AND t.purpose = 'email_verification'
                  AND t.consumed_at IS NOT NULL) AS consumed_tokens
         FROM users u JOIN subscriptions s ON s.organization_id = u.organization_id
        WHERE u.email_normalized = 'verify.b1@example.test'`
    );
    expect(authority.rows[0]).toEqual(expect.objectContaining({
      user_status: 'active', subscription_status: 'trialing', consumed_tokens: 1,
    }));
    expect(new Date(authority.rows[0].trial_started_at).getTime()).toBe(start);
    expect(new Date(authority.rows[0].trial_ends_at).getTime()).toBe(end);
  });

  test('verification rejects malformed, expired, wrong-purpose tokens and succeeds once across two processes', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    await request(app).post('/api/auth/signup').send({
      name: 'Race Verify', businessName: 'Race Verify Company',
      email: 'verify-race.b1@example.test', password: 'Verify-race-password-123!', phone: '',
    });
    const rawToken = linkToken(capture.messages.at(-1), '/verify-email');
    expect((await request(app).post('/api/auth/verify-email').send({})).body.code).toBe('invalid_token');
    expect((await request(app).post('/api/auth/verify-email').send({ token: 'not-a-token' })).body.code).toBe('invalid_token');

    const identity = (await pool.query(
      "SELECT id, organization_id FROM users WHERE email_normalized = 'verify-race.b1@example.test'"
    )).rows[0];
    const { actionToken } = require('../../src/accounts/service');
    const wrongPurpose = actionToken();
    await pool.query(
      `INSERT INTO account_action_tokens
         (id, user_id, organization_id, purpose, token_hash, expires_at)
       VALUES ($1,$2,$3,'password_reset',$4,clock_timestamp() + INTERVAL '30 minutes')`,
      [wrongPurpose.id, identity.id, identity.organization_id, wrongPurpose.tokenHash]
    );
    expect((await request(app).post('/api/auth/verify-email').send({ token: wrongPurpose.rawToken })).body.code)
      .toBe('verification_invalid');

    const [first, second] = await Promise.all([
      runActionWorker(allocation.connectionString, { action: 'verify', token: rawToken }),
      runActionWorker(allocation.connectionString, { action: 'verify', token: rawToken }),
    ]);
    expect(new Set([first.processId, second.processId, process.pid]).size).toBe(3);
    expect([first.outcome, second.outcome].sort()).toEqual(['success', 'verification_invalid']);

    const trial = (await pool.query(
      `SELECT status, trial_started_at, trial_ends_at
         FROM subscriptions WHERE organization_id = $1`,
      [identity.organization_id]
    )).rows[0];
    expect(trial.status).toBe('trialing');
    expect(new Date(trial.trial_ends_at).getTime() - new Date(trial.trial_started_at).getTime())
      .toBe(14 * 86400000);

    await request(app).post('/api/auth/signup').send({
      name: 'Expired Verify', businessName: 'Expired Verify Company',
      email: 'verify-expired.b1@example.test', password: 'Verify-expired-password-123!', phone: '',
    });
    const expiredToken = linkToken(capture.messages.at(-1), '/verify-email');
    await pool.query(
      `UPDATE account_action_tokens SET expires_at = created_at + INTERVAL '1 millisecond'
        WHERE token_hash = $1`,
      [require('../../src/auth/credentials').hashToken(expiredToken)]
    );
    expect((await request(app).post('/api/auth/verify-email').send({ token: expiredToken })).body.code)
      .toBe('verification_invalid');
  }, 60000);

  test('a failed delivery preserves recoverable pending authority and resend reports recovery truthfully', async () => {
    const { AccountRepository } = require('../../src/accounts/repository');
    const { AccountService } = require('../../src/accounts/service');
    const { TransactionalEmail } = require('../../src/email/transactional');
    const { createAuthRouter } = require('../../src/routes/auth');
    let attempts = 0;
    const recoveryCapture = { messages: [], async send(message) {
      attempts += 1;
      if (attempts === 1) throw new Error('captured delivery rejection');
      this.messages.push(message);
      return { accepted: true };
    } };
    const service = new AccountService(new AccountRepository(pool), {
      transactionalEmail: new TransactionalEmail({
        adapter: recoveryCapture, publicOrigin: 'http://127.0.0.1',
        from: 'security@northstar.example.test', production: false,
      }),
    });
    const recoveryApp = express();
    recoveryApp.use(express.json());
    recoveryApp.use('/api/auth', createAuthRouter({ service, signup: service.signup.bind(service) }));
    await pool.query('DELETE FROM auth_rate_limits');
    const failed = await request(recoveryApp).post('/api/auth/signup').send({
      name: 'Recovery Owner', businessName: 'Recovery Company',
      email: 'delivery-recovery.b1@example.test', password: 'Delivery-recovery-password-123!', phone: '',
    });
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('verification_delivery_failed');
    expect(failed.headers['set-cookie']).toBeUndefined();
    const login = await request(recoveryApp).post('/api/auth/login').send({
      email: 'delivery-recovery.b1@example.test', password: 'Delivery-recovery-password-123!',
    });
    expect(login.status).toBe(200);
    const resent = await request(recoveryApp).post('/api/auth/resend-verification')
      .set('Cookie', cookies(login)).set('X-CSRF-Token', csrf(login));
    expect(resent.status).toBe(200);
    expect(recoveryCapture.messages).toHaveLength(1);
    const recoveredToken = linkToken(recoveryCapture.messages[0], '/verify-email');
    expect((await request(recoveryApp).post('/api/auth/verify-email').send({ token: recoveredToken })).status)
      .toBe(200);
  });

  test('a verification transaction fault preserves pending authority and the same token retries once', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    await request(app).post('/api/auth/signup').send({
      name: 'Verify Rollback', businessName: 'Verify Rollback Company',
      email: 'verify-rollback.b1@example.test', password: 'Verify-rollback-password-123!', phone: '',
    });
    const token = linkToken(capture.messages.at(-1), '/verify-email');
    await pool.query(`
      CREATE FUNCTION b1_reject_trial_start() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected verification rollback'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER b1_reject_trial_start_trigger AFTER UPDATE ON subscriptions
      FOR EACH ROW WHEN (NEW.status = 'trialing') EXECUTE FUNCTION b1_reject_trial_start();
    `);
    let failed;
    try {
      failed = await request(app).post('/api/auth/verify-email').send({ token });
    } finally {
      await pool.query('DROP TRIGGER b1_reject_trial_start_trigger ON subscriptions; DROP FUNCTION b1_reject_trial_start()');
    }
    expect(failed.status).toBe(500);
    expect(failed.text).not.toContain('injected verification rollback');
    const pending = (await pool.query(
      `SELECT u.status AS user_status, s.status AS subscription_status,
              s.trial_started_at, s.trial_ends_at, t.consumed_at
         FROM users u JOIN subscriptions s ON s.organization_id = u.organization_id
         JOIN account_action_tokens t ON t.user_id = u.id AND t.purpose = 'email_verification'
        WHERE u.email_normalized = 'verify-rollback.b1@example.test'`
    )).rows[0];
    expect(pending).toEqual(expect.objectContaining({
      user_status: 'pending_verification', subscription_status: 'pending_verification',
      trial_started_at: null, trial_ends_at: null, consumed_at: null,
    }));
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(200);
  });

  test('password reset is single-use and transactionally revokes every session and refresh family', async () => {
    await pool.query("DELETE FROM auth_rate_limits");
    await request(app).post('/api/auth/signup').send({
      name: 'Reset Owner', businessName: 'Reset Company', email: 'reset.b1@example.test',
      password: 'Original-password-123!', phone: '',
    });
    const verificationToken = linkToken(capture.messages.at(-1), '/verify-email');
    expect((await request(app).post('/api/auth/verify-email').send({ token: verificationToken })).status).toBe(200);

    const first = await request(app).post('/api/auth/login').send({
      email: 'reset.b1@example.test', password: 'Original-password-123!',
    });
    const second = await request(app).post('/api/auth/login').send({
      email: 'reset.b1@example.test', password: 'Original-password-123!',
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'RESET.B1@example.test' });
    expect(forgot.status).toBe(202);
    const resetToken = linkToken(capture.messages.at(-1), '/reset-password');
    expectSourceOwnedSender(capture.messages.at(-1));
    const reset = await request(app).post('/api/auth/reset-password').send({
      token: resetToken, password: 'Replacement-password-456!',
    });
    expect(reset.status).toBe(200);
    expect(reset.body.redirect).toBe('/login');
    expect(reset.headers['set-cookie'].filter(value => /northstar_(access|refresh|csrf)=/.test(value))).toHaveLength(3);

    expect((await request(app).get('/api/auth/me').set('Cookie', cookies(first))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookies(second))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({
      email: 'reset.b1@example.test', password: 'Original-password-123!',
    })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({
      email: 'reset.b1@example.test', password: 'Replacement-password-456!',
    })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({
      token: resetToken, password: 'Another-password-789!',
    })).status).toBe(400);

    const remaining = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM auth_sessions s JOIN users u ON u.id = s.user_id
           WHERE u.email_normalized = 'reset.b1@example.test' AND s.status = 'active') AS sessions,
         (SELECT count(*)::int FROM auth_refresh_tokens t JOIN auth_sessions s ON s.id = t.session_id
           JOIN users u ON u.id = s.user_id
           WHERE u.email_normalized = 'reset.b1@example.test' AND t.status = 'active') AS refresh_tokens`
    );
    expect(remaining.rows[0]).toEqual({ sessions: 1, refresh_tokens: 1 });
  });

  test('a reset transaction fault preserves the old password, active session, and retryable token', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    await request(app).post('/api/auth/signup').send({
      name: 'Reset Rollback', businessName: 'Reset Rollback Company', email: 'reset-rollback.b1@example.test',
      password: 'Reset-rollback-original-123!', phone: '',
    });
    await request(app).post('/api/auth/verify-email')
      .send({ token: linkToken(capture.messages.at(-1), '/verify-email') });
    const login = await request(app).post('/api/auth/login').send({
      email: 'reset-rollback.b1@example.test', password: 'Reset-rollback-original-123!',
    });
    await request(app).post('/api/auth/forgot-password').send({ email: 'reset-rollback.b1@example.test' });
    const token = linkToken(capture.messages.at(-1), '/reset-password');
    const before = (await pool.query(
      "SELECT password_hash FROM users WHERE email_normalized = 'reset-rollback.b1@example.test'"
    )).rows[0];
    await pool.query(`
      CREATE FUNCTION b1_reject_reset_consumption() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected reset rollback'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER b1_reject_reset_consumption_trigger AFTER UPDATE ON account_action_tokens
      FOR EACH ROW WHEN (NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL)
      EXECUTE FUNCTION b1_reject_reset_consumption();
    `);
    let failed;
    try {
      failed = await request(app).post('/api/auth/reset-password').send({
        token, password: 'Reset-rollback-replacement-456!',
      });
    } finally {
      await pool.query(
        'DROP TRIGGER b1_reject_reset_consumption_trigger ON account_action_tokens; DROP FUNCTION b1_reject_reset_consumption()'
      );
    }
    expect(failed.status).toBe(500);
    expect(failed.text).not.toContain('injected reset rollback');
    const after = (await pool.query(
      `SELECT u.password_hash,
              (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id = u.id AND s.status = 'active') AS sessions,
              (SELECT count(*)::int FROM account_action_tokens t
                WHERE t.user_id = u.id AND t.purpose = 'password_reset' AND t.consumed_at IS NULL
                  AND t.revoked_at IS NULL) AS current_tokens
         FROM users u WHERE u.email_normalized = 'reset-rollback.b1@example.test'`
    )).rows[0];
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.sessions).toBe(1);
    expect(after.current_tokens).toBe(1);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookies(login))).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({
      token, password: 'Reset-rollback-replacement-456!',
    })).status).toBe(200);
  });

  test('reset supersession, weak-password rejection, and two-process concurrency preserve trial authority', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    await request(app).post('/api/auth/signup').send({
      name: 'Reset Race', businessName: 'Reset Race Company', email: 'reset-race.b1@example.test',
      password: 'Reset-race-original-123!', phone: '',
    });
    const verifyToken = linkToken(capture.messages.at(-1), '/verify-email');
    await request(app).post('/api/auth/verify-email').send({ token: verifyToken });
    const before = (await pool.query(
      `SELECT s.status, s.trial_started_at, s.trial_ends_at
         FROM subscriptions s JOIN users u ON u.organization_id = s.organization_id
        WHERE u.email_normalized = 'reset-race.b1@example.test'`
    )).rows[0];
    await request(app).post('/api/auth/login').send({
      email: 'reset-race.b1@example.test', password: 'Reset-race-original-123!',
    });
    await request(app).post('/api/auth/forgot-password').send({ email: 'reset-race.b1@example.test' });
    const firstReset = linkToken(capture.messages.at(-1), '/reset-password');
    const sevenCharacterReset = await request(app).post('/api/auth/reset-password')
      .send({ token: firstReset, password: 'short7!' });
    expect(sevenCharacterReset.status).toBe(400);
    expect(sevenCharacterReset.body.code).toBe('invalid_password');
    expect((await request(app).post('/api/auth/reset-password').send({
      token: firstReset, password: 'Exact8!!',
    })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({
      email: 'reset-race.b1@example.test', password: 'Exact8!!',
    })).status).toBe(200);
    await request(app).post('/api/auth/forgot-password').send({ email: 'reset-race.b1@example.test' });
    const supersededReset = linkToken(capture.messages.at(-1), '/reset-password');
    await request(app).post('/api/auth/forgot-password').send({ email: ' RESET-RACE.B1@EXAMPLE.TEST ' });
    const currentReset = linkToken(capture.messages.at(-1), '/reset-password');
    expect(currentReset).not.toBe(supersededReset);
    expect((await request(app).post('/api/auth/reset-password').send({
      token: supersededReset, password: 'Superseded-reset-password-123!',
    })).body.code).toBe('reset_invalid');

    const [first, second] = await Promise.all([
      runActionWorker(allocation.connectionString, {
        action: 'reset', token: currentReset, password: 'Concurrent-reset-password-456!', requestIp: '198.51.100.20',
      }),
      runActionWorker(allocation.connectionString, {
        action: 'reset', token: currentReset, password: 'Concurrent-reset-password-456!', requestIp: '198.51.100.21',
      }),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(['reset_invalid', 'success']);
    const after = (await pool.query(
      `SELECT s.status, s.trial_started_at, s.trial_ends_at,
              (SELECT count(*)::int FROM auth_sessions a JOIN users account ON account.id = a.user_id
                WHERE account.email_normalized = 'reset-race.b1@example.test' AND a.status = 'active') AS sessions
         FROM subscriptions s JOIN users u ON u.organization_id = s.organization_id
        WHERE u.email_normalized = 'reset-race.b1@example.test'`
    )).rows[0];
    expect(after.status).toBe(before.status);
    expect(after.trial_started_at).toEqual(before.trial_started_at);
    expect(after.trial_ends_at).toEqual(before.trial_ends_at);
    expect(after.sessions).toBe(0);
  }, 60000);

  test('two members read one organization trial while alternate membership creation fails closed', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    await request(app).post('/api/auth/signup').send({
      name: 'Shared Trial Owner', businessName: 'Shared Trial Company', email: 'shared-owner.b1@example.test',
      password: 'Shared-owner-password-123!', phone: '',
    });
    const verificationToken = linkToken(capture.messages.at(-1), '/verify-email');
    await request(app).post('/api/auth/verify-email').send({ token: verificationToken });
    const owner = (await pool.query(
      "SELECT id, organization_id FROM users WHERE email_normalized = 'shared-owner.b1@example.test'"
    )).rows[0];
    const memberId = crypto.randomUUID();
    const { hashPassword } = require('../../src/accounts/service');
    await pool.query(
      `INSERT INTO users
         (id, organization_id, name, email, email_normalized, password_hash, role, status)
       VALUES ($1,$2,'Shared Member','shared-member.b1@example.test','shared-member.b1@example.test',$3,'viewer','active')`,
      [memberId, owner.organization_id, await hashPassword('Shared-member-password-123!')]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'viewer','active')`,
      [crypto.randomUUID(), owner.organization_id, memberId]
    );
    const ownerLogin = await request(app).post('/api/auth/login').send({
      email: 'shared-owner.b1@example.test', password: 'Shared-owner-password-123!',
    });
    const memberLogin = await request(app).post('/api/auth/login').send({
      email: 'shared-member.b1@example.test', password: 'Shared-member-password-123!',
    });
    const ownerStatus = (await request(app).get('/api/account/subscription').set('Cookie', cookies(ownerLogin)))
      .body.subscription;
    const memberStatus = (await request(app)
      .get('/api/account/subscription?organizationId=foreign&state=active')
      .set('Cookie', cookies(memberLogin))).body.subscription;
    for (const key of [
      'state', 'trialStart', 'trialEnd', 'daysRemaining', 'readOnly',
      'showTrialBanner', 'upgradeAvailable',
    ]) {
      expect(memberStatus[key]).toEqual(ownerStatus[key]);
    }
    expect(ownerStatus.upgradeAvailable).toBe(false);
    expect(memberStatus.upgradeAvailable).toBe(false);

    const foreignOrganization = crypto.randomUUID();
    await pool.query(
      "INSERT INTO organizations (id, name, email) VALUES ($1,'Unsupported alternate organization','alternate@example.test')",
      [foreignOrganization]
    );
    await expect(pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'owner','active')`,
      [crypto.randomUUID(), foreignOrganization, owner.id]
    )).rejects.toMatchObject({ code: '23505' });
  });

  test('subscription reads are organization-owned and expiration makes mutations read-only at current server time', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    await request(app).post('/api/auth/signup').send({
      name: 'Trial Owner', businessName: 'Trial Company', email: 'trial.b1@example.test',
      password: 'Trial-password-123!', phone: '',
    });
    const verificationToken = linkToken(capture.messages.at(-1), '/verify-email');
    await request(app).post('/api/auth/verify-email').send({ token: verificationToken });
    const login = await request(app).post('/api/auth/login').send({
      email: 'trial.b1@example.test', password: 'Trial-password-123!',
    });
    const jar = cookies(login);
    const status = await request(app)
      .get('/api/account/subscription?organizationId=00000000-0000-0000-0000-000000000000&state=active')
      .set('Cookie', jar);
    expect(status.status).toBe(200);
    expect(status.body.subscription).toEqual(expect.objectContaining({
      state: 'trialing', daysRemaining: 14, readOnly: false,
      showTrialBanner: true, safe: true, upgradeAvailable: false,
    }));

    const owner = await pool.query(
      "SELECT organization_id FROM users WHERE email_normalized = 'trial.b1@example.test'"
    );
    controlledNow = new Date(new Date(status.body.subscription.trialEnd).getTime() - 1);
    const finalInstant = await request(app).get('/api/account/subscription').set('Cookie', jar);
    expect(finalInstant.body.subscription).toEqual(expect.objectContaining({
      state: 'trialing', daysRemaining: 1, endsToday: true, readOnly: false,
      upgradeAvailable: false,
    }));
    controlledNow = new Date(status.body.subscription.trialEnd);
    const expired = await request(app).get('/api/account/subscription').set('Cookie', jar);
    expect(expired.status).toBe(200);
    expect(expired.body.subscription).toEqual(expect.objectContaining({
      state: 'expired', daysRemaining: 0, readOnly: true,
      upgradeAvailable: false, showTrialBanner: false,
    }));
    expect((await request(app).get('/api/auth/me').set('Cookie', jar)).status).toBe(200);
    expect((await request(app).get('/api/account/preferences').set('Cookie', jar)).status).toBe(200);
    const mutation = await request(app)
      .put('/api/account/preferences')
      .set('Cookie', jar)
      .set('X-CSRF-Token', csrf(login))
      .send({});
    expect(mutation.status).toBe(403);
    expect(mutation.body.code).toBe('subscription_read_only');

    await pool.query(
      `UPDATE subscriptions
          SET status = 'active', plan_type = 'Starter', billing_plan_key = 'starter',
              billing_authority_verified = TRUE,
              stripe_customer_id = $2, stripe_subscription_id = $3,
              current_period_start = $4, current_period_end = $5
        WHERE organization_id = $1`,
      [
        owner.rows[0].organization_id,
        `cus_b1_${owner.rows[0].organization_id.replace(/-/g, '')}`,
        `sub_b1_${owner.rows[0].organization_id.replace(/-/g, '')}`,
        new Date(controlledNow.getTime() - 86400000),
        new Date(controlledNow.getTime() + 30 * 86400000),
      ]
    );
    const active = await request(app).get('/api/account/subscription').set('Cookie', jar);
    expect(active.body.subscription).toEqual(expect.objectContaining({
      state: 'active', readOnly: false, showTrialBanner: false, upgradeAvailable: false,
    }));
    controlledNow = null;
  });

  test('mounted subscription projection keeps B1 upgrade capability false for every durable state and forgery', async () => {
    await pool.query('DELETE FROM auth_rate_limits');
    await request(app).post('/api/auth/signup').send({
      name: 'No Upgrade Owner', businessName: 'No Upgrade Company',
      email: 'no-upgrade.b1@example.test', password: 'No-upgrade-password-123!', phone: '',
    });
    const login = await request(app).post('/api/auth/login').send({
      email: 'no-upgrade.b1@example.test', password: 'No-upgrade-password-123!',
    });
    const jar = cookies(login);
    const organizationId = (await pool.query(
      "SELECT organization_id FROM users WHERE email_normalized = 'no-upgrade.b1@example.test'"
    )).rows[0].organization_id;

    const states = [
      ['pending_verification', null, null],
      ['trialing', '2026-08-01T00:00:00.000Z', '2026-08-15T00:00:00.000Z'],
      ['expired', null, null], ['active', null, null],
      ['past_due', null, null], ['canceled', null, null],
    ];
    for (const [state, start, end] of states) {
      const paid = ['active', 'past_due', 'canceled'].includes(state);
      await pool.query(
        `UPDATE subscriptions
            SET status = $2, trial_started_at = $3, trial_ends_at = $4,
                plan_type = $5, billing_plan_key = $6,
                billing_authority_verified = $7,
                stripe_customer_id = $8, stripe_subscription_id = $9,
                current_period_start = $10, current_period_end = $11
          WHERE organization_id = $1`,
        [
          organizationId, state, start, end,
          paid ? 'Starter' : 'Trial', paid ? 'starter' : null, paid,
          paid ? `cus_b1_matrix_${organizationId.replace(/-/g, '')}` : null,
          paid ? `sub_b1_matrix_${organizationId.replace(/-/g, '')}` : null,
          paid ? '2026-08-01T00:00:00.000Z' : null,
          paid ? '2026-09-01T00:00:00.000Z' : null,
        ]
      );
      const response = await request(app)
        .get('/api/account/subscription?upgrade=true&paid=true&success=true&organizationId=foreign')
        .set('Cookie', jar)
        .set('X-Upgrade-Available', 'true');
      expect(response.status).toBe(200);
      expect(response.body.subscription.state).toBe(state);
      expect(response.body.subscription.upgradeAvailable).toBe(false);
    }

    await expect(pool.query(
      `UPDATE subscriptions
          SET status = 'trialing', trial_started_at = NULL, trial_ends_at = NULL
        WHERE organization_id = $1`,
      [organizationId]
    )).rejects.toMatchObject({ code: '23514' });

    await pool.query('DELETE FROM subscriptions WHERE organization_id = $1', [organizationId]);
    const missing = await request(app)
      .get('/api/account/subscription?upgrade=true&paid=true&success=true')
      .set('Cookie', jar);
    expect(missing.status).toBe(200);
    expect(missing.body.subscription).toEqual(expect.objectContaining({
      state: 'unavailable', safe: false, upgradeAvailable: false,
    }));
  });
});
