'use strict';

const crypto = require('crypto');
const { performance } = require('perf_hooks');
const express = require('express');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const PROVIDER_ENVIRONMENT = [
  'RETELL_API_KEY',
  'RETELL_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
];

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function publicBody(response) {
  const { requestId: _requestId, ...body } = response.body;
  return body;
}

describe('Mission 20 Phase 7 mounted login timing safety', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let bcrypt;
  let compareSpy;
  let loginDelays;
  let providerCalls;
  let priorDatabaseUrl;
  let priorFetch;
  const accounts = [];

  async function insertAccount(label) {
    const { hashPassword } = require('../../src/accounts/service');
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const email = `${label}-${crypto.randomUUID()}@example.test`;
    const password = `Timing-${crypto.randomUUID()}!`;
    await pool.query(
      'INSERT INTO organizations (id, name, owner_name, email, phone) VALUES ($1,$2,$3,$4,$5)',
      [organizationId, `Timing ${label}`, 'Timing Owner', email, '']
    );
    await pool.query(
      `INSERT INTO users
        (id, organization_id, name, email, email_normalized, password_hash, phone, role, status)
       VALUES ($1,$2,'Timing Owner',$3,$3,$4,'','owner','active')`,
      [userId, organizationId, email, await hashPassword(password)]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'owner','active')`,
      [membershipId, organizationId, userId]
    );
    await pool.query(
      `INSERT INTO organization_onboarding (organization_id, status)
       VALUES ($1, 'business_profile_required')`,
      [organizationId]
    );
    return { email, password, userId };
  }

  async function timedWrongLogin(email, source) {
    const callsBefore = compareSpy.mock.calls.length;
    const started = performance.now();
    const response = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', source)
      .send({ email, password: 'definitely-the-wrong-password' });
    return {
      response,
      durationMs: performance.now() - started,
      compareCalls: compareSpy.mock.calls.length - callsBefore,
    };
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Task-owned PostgreSQL 18.4 identity is required for login timing safety');
    }
    for (const name of PROVIDER_ENVIRONMENT) expect(process.env[name]).toBeUndefined();
    allocation = await createSuiteDatabase('m20 phase7 login timing');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    bcrypt = require('bcryptjs');
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    expect((await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums,
              current_setting('max_connections')::int AS max_connections`
    )).rows[0]).toEqual({
      version: '18.4', timezone: 'UTC', checksums: 'on', max_connections: 100,
    });

    const { AccountRepository } = require('../../src/accounts/repository');
    const { AccountService } = require('../../src/accounts/service');
    const { createAuthRouter } = require('../../src/routes/auth');
    loginDelays = [];
    providerCalls = 0;
    priorFetch = global.fetch;
    global.fetch = async () => {
      providerCalls += 1;
      throw new Error('Provider network access is forbidden in login timing tests');
    };
    compareSpy = jest.spyOn(bcrypt, 'compare');
    const service = new AccountService(new AccountRepository(pool), {
      sleep: async milliseconds => { loginDelays.push(milliseconds); },
    });
    app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({ service }));

    for (let index = 0; index < 7; index += 1) {
      accounts.push(await insertAccount(`existing-${index}`));
    }
  }, 60000);

  afterAll(async () => {
    if (compareSpy) compareSpy.mockRestore();
    global.fetch = priorFetch;
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  }, 60000);

  beforeEach(async () => {
    compareSpy.mockClear();
    loginDelays.length = 0;
    providerCalls = 0;
    await pool.query('DELETE FROM auth_refresh_tokens');
    await pool.query('DELETE FROM auth_sessions');
    await pool.query('DELETE FROM auth_rate_limits');
  });

  test('missing and existing wrong credentials have equal verification work and indistinguishable distributions', async () => {
    await timedWrongLogin(`warmup-missing-${crypto.randomUUID()}@example.test`, '198.51.100.1');
    await timedWrongLogin(accounts[0].email, '198.51.100.2');
    await pool.query('DELETE FROM auth_rate_limits');
    compareSpy.mockClear();
    loginDelays.length = 0;

    const missing = [];
    const existing = [];
    for (let index = 0; index < 6; index += 1) {
      const missingRequest = () => timedWrongLogin(
        `missing-${index}-${crypto.randomUUID()}@example.test`,
        `198.51.100.${20 + (index * 2)}`
      );
      const existingRequest = () => timedWrongLogin(
        accounts[index + 1].email,
        `198.51.100.${21 + (index * 2)}`
      );
      if (index % 2 === 0) {
        missing.push(await missingRequest());
        existing.push(await existingRequest());
      } else {
        existing.push(await existingRequest());
        missing.push(await missingRequest());
      }
    }

    const missingMedianMs = median(missing.map(sample => sample.durationMs));
    const existingMedianMs = median(existing.map(sample => sample.durationMs));
    const medianRatio = Math.max(missingMedianMs, existingMedianMs) /
      Math.min(missingMedianMs, existingMedianMs);
    const relativeGap = Math.abs(missingMedianMs - existingMedianMs) /
      Math.max(missingMedianMs, existingMedianMs);
    console.info('[login-timing-regression]', JSON.stringify({
      missing: missing.map(sample => Number(sample.durationMs.toFixed(2))),
      existing: existing.map(sample => Number(sample.durationMs.toFixed(2))),
      missingMedianMs: Number(missingMedianMs.toFixed(2)),
      existingMedianMs: Number(existingMedianMs.toFixed(2)),
      medianRatio: Number(medianRatio.toFixed(3)),
      relativeGap: Number(relativeGap.toFixed(3)),
      missingCompareCalls: missing.map(sample => sample.compareCalls),
      existingCompareCalls: existing.map(sample => sample.compareCalls),
    }));

    for (const sample of [...missing, ...existing]) {
      expect(sample.response.status).toBe(401);
      expect(publicBody(sample.response)).toEqual({
        error: 'Invalid email or password', code: 'invalid_credentials',
      });
      expect(sample.response.headers['set-cookie']).toBeUndefined();
      expect(sample.compareCalls).toBe(2);
    }
    expect(loginDelays).toEqual(Array(12).fill(0));
    expect(providerCalls).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(0);
    const limits = (await pool.query(
      `SELECT event_type, key_hash, attempt_count
         FROM auth_rate_limits
        ORDER BY event_type, key_hash`
    )).rows;
    expect(limits).toHaveLength(24);
    expect(limits.every(row => ['login_ip', 'login_source_email'].includes(row.event_type))).toBe(true);
    expect(limits.every(row => /^[0-9a-f]{64}$/.test(row.key_hash) && row.attempt_count === 1)).toBe(true);

    expect(medianRatio).toBeLessThanOrEqual(1.5);
    expect(relativeGap).toBeLessThanOrEqual(0.3);
  }, 30000);

  test('a correct login still succeeds, creates one session, and clears only its own throttle keys', async () => {
    const source = '198.51.100.80';
    const account = accounts[0];
    const wrong = await timedWrongLogin(account.email, source);
    expect(wrong.response.status).toBe(401);
    expect(wrong.compareCalls).toBe(2);
    const callsBeforeCorrect = compareSpy.mock.calls.length;
    const correct = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', source)
      .send({ email: account.email, password: account.password });
    expect(correct.status).toBe(200);
    expect(compareSpy.mock.calls.length - callsBeforeCorrect).toBe(1);
    expect(correct.headers['set-cookie']).toHaveLength(3);
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM auth_sessions WHERE user_id = $1',
      [account.userId]
    )).rows[0].count).toBe(1);
    const { rateLimitKey } = require('../../src/auth/credentials');
    const keys = [
      rateLimitKey('login_ip', source),
      rateLimitKey('login_source_email', `${source}\0${account.email}`),
    ];
    expect((await pool.query(
      `SELECT event_type, key_hash FROM auth_rate_limits
        WHERE key_hash = ANY($1::text[])`,
      [keys]
    )).rows).toEqual([]);
    expect(loginDelays).toEqual([0]);
    expect(providerCalls).toBe(0);
  }, 30000);

  test('the source limiter caps expensive missing-account work before an eleventh bcrypt verification', async () => {
    const source = '198.51.100.90';
    const statuses = [];
    const compareCalls = [];
    for (let index = 0; index < 11; index += 1) {
      const sample = await timedWrongLogin(
        `bounded-missing-${index}-${crypto.randomUUID()}@example.test`,
        source
      );
      statuses.push(sample.response.status);
      compareCalls.push(sample.compareCalls);
    }
    expect(statuses).toEqual([...Array(10).fill(401), 429]);
    expect(compareCalls).toEqual([...Array(10).fill(2), 0]);
    expect(loginDelays).toEqual(Array(10).fill(0));
    expect((await pool.query(
      `SELECT attempt_count, blocked_until > NOW() AS blocked
         FROM auth_rate_limits
        WHERE event_type = 'login_ip'`
    )).rows).toEqual([{ attempt_count: 11, blocked: true }]);
    expect((await pool.query(
      `SELECT count(*)::int AS count
         FROM auth_rate_limits
        WHERE event_type = 'login_source_email'`
    )).rows[0].count).toBe(10);
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(0);
    expect(providerCalls).toBe(0);
  }, 30000);

  test('a bcrypt failure on the missing-account path fails closed without a session or credential response', async () => {
    compareSpy.mockRejectedValueOnce(new Error('synthetic bcrypt failure'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '198.51.100.100')
        .send({ email: `bcrypt-failure-${crypto.randomUUID()}@example.test`, password: 'wrong password' });
      expect(response.status).toBe(500);
      expect(publicBody(response)).toEqual({
        error: 'Authentication request failed', code: 'auth_request_failed',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith('[Auth] Request failed:', {
        requestId: 'unavailable', event: 'login_failed',
      });
      expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(0);
      expect((await pool.query(
        `SELECT event_type, attempt_count
           FROM auth_rate_limits
          ORDER BY event_type`
      )).rows).toEqual([{ event_type: 'login_ip', attempt_count: 1 }]);
      expect(providerCalls).toBe(0);
    } finally {
      errorLog.mockRestore();
    }
  });
});
