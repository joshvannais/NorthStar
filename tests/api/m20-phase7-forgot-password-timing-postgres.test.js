'use strict';

const crypto = require('crypto');
const { performance } = require('perf_hooks');
const express = require('express');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const PROVIDER_ENVIRONMENT = [
  'RETELL_API_KEY',
  'RETELL_WEBHOOK_SECRET',
  'RETELL_AGENT_ID',
  'RETELL_PHONE_NUMBER',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
];
const WARMUP_ROUNDS = 2;
const MEASURED_ROUNDS = 15;
const MAX_TIMING_MEDIAN_RATIO = 1.15;
const MAX_TIMING_RELATIVE_GAP = 0.13;
const EXPECTED_RESPONSE = {
  success: true,
  code: 'recovery_requested',
  message: 'If the account is eligible and delivery succeeds, a reset link will be sent.',
};

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function probabilityGreater(left, right) {
  let score = 0;
  for (const leftValue of left) {
    for (const rightValue of right) {
      if (leftValue > rightValue) score += 1;
      else if (leftValue === rightValue) score += 0.5;
    }
  }
  return score / (left.length * right.length);
}

function publicBody(response) {
  const { requestId: _requestId, ...body } = response.body;
  return body;
}

describe('Mission 20 Phase 7 mounted forgot-password timing safety', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let AccountService;
  let providerCalls;
  let priorDatabaseUrl;
  let priorAuthAccessSecret;
  let priorFetch;
  let consoleError;
  let consoleWarn;
  let sharedPasswordHash;
  const eligibleAccounts = [];
  let disabledAccount;
  let inactiveMembershipAccount;

  async function insertAuthority(label, options = {}) {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const email = `${label}-${crypto.randomUUID()}@example.test`;
    const userStatus = options.userStatus || 'active';
    const membershipStatus = options.membershipStatus || 'active';
    await pool.query(
      'INSERT INTO organizations (id, name, owner_name, email, phone) VALUES ($1,$2,$3,$4,$5)',
      [organizationId, `Recovery ${label}`, 'Recovery Owner', email, '']
    );
    await pool.query(
      `INSERT INTO users
        (id, organization_id, name, email, email_normalized, password_hash, phone, role, status)
       VALUES ($1,$2,'Recovery Owner',$3,$3,$4,'','owner',$5)`,
      [userId, organizationId, email, sharedPasswordHash, userStatus]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'owner',$4)`,
      [membershipId, organizationId, userId, membershipStatus]
    );
    return { email, organizationId, passwordHash: sharedPasswordHash, userId };
  }

  async function timedForgot(kind, email, source, phase, round, baselineFirst) {
    const startedAt = performance.now();
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', source)
      .send({ email });
    return {
      baselineFirst,
      durationMs: performance.now() - startedAt,
      kind,
      phase,
      response,
      round,
    };
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Task-owned PostgreSQL 18.4 identity is required for recovery timing safety');
    }
    for (const name of PROVIDER_ENVIRONMENT) expect(process.env[name]).toBeUndefined();
    allocation = await createSuiteDatabase('m20 phase7 forgot timing');
    priorDatabaseUrl = process.env.DATABASE_URL;
    priorAuthAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    jest.resetModules();
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

    const accountService = require('../../src/accounts/service');
    const { AccountRepository } = require('../../src/accounts/repository');
    const { createAuthRouter } = require('../../src/routes/auth');
    AccountService = accountService.AccountService;
    sharedPasswordHash = await accountService.hashPassword('Recovery-timing-only-password!');
    for (let index = 0; index <
      4 * (WARMUP_ROUNDS + MEASURED_ROUNDS); index += 1) {
      eligibleAccounts.push(await insertAuthority(`eligible-${index}`));
    }
    disabledAccount = await insertAuthority('disabled', { userStatus: 'disabled' });
    inactiveMembershipAccount = await insertAuthority('membership-inactive', {
      membershipStatus: 'suspended',
    });

    providerCalls = 0;
    priorFetch = global.fetch;
    global.fetch = async () => {
      providerCalls += 1;
      throw new Error('Provider network access is forbidden in recovery timing tests');
    };
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new AccountService(new AccountRepository(pool));
    app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({ service }));
  }, 60000);

  afterAll(async () => {
    if (consoleError) consoleError.mockRestore();
    if (consoleWarn) consoleWarn.mockRestore();
    global.fetch = priorFetch;
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (priorAuthAccessSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
    else process.env.AUTH_ACCESS_SECRET = priorAuthAccessSecret;
    if (allocation) await allocation.cleanup();
  }, 60000);

  beforeEach(async () => {
    providerCalls = 0;
    consoleError.mockClear();
    consoleWarn.mockClear();
    await pool.query('DELETE FROM account_email_outbox');
    await pool.query("DELETE FROM account_action_tokens WHERE purpose = 'password_reset'");
    await pool.query('DELETE FROM auth_refresh_tokens');
    await pool.query('DELETE FROM auth_sessions');
    await pool.query('DELETE FROM auth_rate_limits');
  });

  test('eligible and every non-authoritative outcome have adjacent indistinguishable distributions', async () => {
    const timingClasses = [
      {
        name: 'absent',
        email: round => `absent-${round}-${crypto.randomUUID()}@example.test`,
      },
      { name: 'disabled', email: () => disabledAccount.email },
      { name: 'membership-inactive', email: () => inactiveMembershipAccount.email },
      { name: 'malformed', email: round => `malformed-${round}` },
    ].map(timingClass => ({
      ...timingClass,
      orderKey: crypto.createHash('sha256')
        .update(`m20-phase7-recovery-timing:${timingClass.name}`, 'utf8')
        .digest('hex'),
    })).sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    const allPairs = [];
    let eligibleIndex = 0;
    let sourceIndex = 10;
    for (let executionRound = 0;
      executionRound < WARMUP_ROUNDS + MEASURED_ROUNDS;
      executionRound += 1) {
      const offset = executionRound % timingClasses.length;
      const rotated = timingClasses.slice(offset).concat(timingClasses.slice(0, offset));
      const orderedClasses = executionRound % 2 === 0 ? rotated : [...rotated].reverse();
      for (const timingClass of orderedClasses) {
        const classIndex = timingClasses.indexOf(timingClass);
        const phase = executionRound < WARMUP_ROUNDS ? 'warmup' : 'measured';
        const measuredRound = executionRound - WARMUP_ROUNDS;
        const baselineFirst = (executionRound + classIndex) % 2 === 0;
        const baselineRequest = () => timedForgot(
          'eligible',
          eligibleAccounts[eligibleIndex++].email,
          `198.51.100.${sourceIndex++}`,
          phase,
          measuredRound,
          baselineFirst
        );
        const classRequest = () => timedForgot(
          timingClass.name,
          timingClass.email(executionRound),
          `198.51.100.${sourceIndex++}`,
          phase,
          measuredRound,
          baselineFirst
        );
        let baseline;
        let sample;
        if (baselineFirst) {
          baseline = await baselineRequest();
          sample = await classRequest();
        } else {
          sample = await classRequest();
          baseline = await baselineRequest();
        }
        allPairs.push({ baseline, baselineFirst, name: timingClass.name, phase, sample });
      }
    }

    const measuredPairs = allPairs.filter(pair => pair.phase === 'measured');
    const summaries = timingClasses.map(({ name }) => {
      const classPairs = measuredPairs.filter(pair => pair.name === name);
      const baselineDurations = classPairs.map(pair => pair.baseline.durationMs);
      const classDurations = classPairs.map(pair => pair.sample.durationMs);
      const logRatios = classPairs.map(
        pair => Math.log(pair.sample.durationMs / pair.baseline.durationMs)
      );
      const medianLogRatio = median(logRatios);
      const pairedMagnitude = Math.abs(medianLogRatio);
      const baselineMedianMs = median(baselineDurations);
      const classMedianMs = median(classDurations);
      const probabilityClassSlower = probabilityGreater(classDurations, baselineDurations);
      const baselineFirstCount = classPairs.filter(pair => pair.baselineFirst).length;
      expect(classPairs).toHaveLength(MEASURED_ROUNDS);
      expect([7, 8]).toContain(baselineFirstCount);
      return {
        baselineFirstCount,
        baselineMedianMs,
        classMedianMs,
        cliffsDelta: (2 * probabilityClassSlower) - 1,
        logRatios,
        marginalRatio: Math.max(baselineMedianMs, classMedianMs) /
          Math.min(baselineMedianMs, classMedianMs),
        medianLogRatio,
        name,
        probabilityClassSlower,
        ratio: Math.exp(pairedMagnitude),
        relativeGap: 1 - Math.exp(-pairedMagnitude),
        rawBaselineMs: baselineDurations,
        rawClassMs: classDurations,
      };
    });
    console.info('[forgot-password-timing-matrix]', JSON.stringify({
      measuredRounds: MEASURED_ROUNDS,
      summaries: summaries.map(summary => ({
        ...summary,
        baselineMedianMs: Number(summary.baselineMedianMs.toFixed(3)),
        classMedianMs: Number(summary.classMedianMs.toFixed(3)),
        cliffsDelta: Number(summary.cliffsDelta.toFixed(3)),
        logRatios: summary.logRatios.map(value => Number(value.toFixed(6))),
        marginalRatio: Number(summary.marginalRatio.toFixed(3)),
        medianLogRatio: Number(summary.medianLogRatio.toFixed(6)),
        probabilityClassSlower: Number(summary.probabilityClassSlower.toFixed(3)),
        ratio: Number(summary.ratio.toFixed(3)),
        relativeGap: Number(summary.relativeGap.toFixed(3)),
        rawBaselineMs: summary.rawBaselineMs.map(value => Number(value.toFixed(3))),
        rawClassMs: summary.rawClassMs.map(value => Number(value.toFixed(3))),
      })),
    }));

    const allSamples = allPairs.flatMap(pair => [pair.baseline, pair.sample]);
    for (const sample of allSamples) {
      expect(sample.response.status).toBe(202);
      expect(publicBody(sample.response)).toEqual(EXPECTED_RESPONSE);
      expect(sample.response.headers['set-cookie']).toBeUndefined();
    }
    const measuredDurations = measuredPairs.flatMap(
      pair => [pair.baseline.durationMs, pair.sample.durationMs]
    );
    expect(median(measuredDurations)).toBeGreaterThanOrEqual(90);
    expect(Math.max(...measuredDurations)).toBeLessThan(500);
    for (const summary of summaries) {
      expect(summary.ratio).toBeLessThanOrEqual(MAX_TIMING_MEDIAN_RATIO);
      expect(summary.relativeGap).toBeLessThanOrEqual(MAX_TIMING_RELATIVE_GAP);
      expect(summary.probabilityClassSlower).toBeGreaterThanOrEqual(0.10);
      expect(summary.probabilityClassSlower).toBeLessThanOrEqual(0.90);
      expect(Math.abs(summary.cliffsDelta)).toBeLessThanOrEqual(0.80);
    }

    const durable = (await pool.query(
      `SELECT
         (SELECT count(*)::int FROM account_action_tokens WHERE purpose = 'password_reset') AS reset_tokens,
         (SELECT count(*)::int FROM account_email_outbox WHERE purpose = 'password_reset') AS reset_outbox,
         (SELECT count(*)::int FROM auth_rate_limits WHERE event_type = 'forgot_ip') AS source_limits,
         (SELECT count(*)::int FROM auth_sessions) AS sessions,
         (SELECT count(*)::int FROM auth_refresh_tokens) AS refresh_tokens`
    )).rows[0];
    expect(durable).toEqual({
      reset_tokens: allPairs.length,
      reset_outbox: allPairs.length,
      source_limits: allSamples.length,
      sessions: 0,
      refresh_tokens: 0,
    });
    const eligibleIds = eligibleAccounts.map(account => account.userId);
    expect((await pool.query(
      `SELECT count(*)::int AS count,
              count(DISTINCT user_id)::int AS distinct_users
         FROM account_action_tokens
        WHERE purpose = 'password_reset' AND user_id = ANY($1::uuid[])`,
      [eligibleIds]
    )).rows[0]).toEqual({ count: allPairs.length, distinct_users: allPairs.length });
    expect((await pool.query(
      `SELECT count(*)::int AS count
         FROM account_action_tokens
        WHERE purpose = 'password_reset' AND NOT (user_id = ANY($1::uuid[]))`,
      [eligibleIds]
    )).rows[0].count).toBe(0);
    const storedHashes = (await pool.query(
      'SELECT id, password_hash FROM users WHERE id = ANY($1::uuid[])',
      [[...eligibleIds, disabledAccount.userId, inactiveMembershipAccount.userId]]
    )).rows;
    expect(storedHashes).toHaveLength(eligibleAccounts.length + 2);
    expect(storedHashes.every(row => row.password_hash === sharedPasswordHash)).toBe(true);
    expect(providerCalls).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  }, 30000);

  test('source throttling bounds recovery delay and creates no dummy authority', async () => {
    const source = '203.0.113.220';
    const acceptedDurations = [];
    for (let index = 0; index < 8; index += 1) {
      const startedAt = performance.now();
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', source)
        .send({ email: `malformed-${index}` });
      acceptedDurations.push(performance.now() - startedAt);
      expect(response.status).toBe(202);
      expect(publicBody(response)).toEqual(EXPECTED_RESPONSE);
    }
    const blocked = await request(app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', source)
      .send({ email: 'malformed-blocked' });
    expect(blocked.status).toBe(429);
    expect(publicBody(blocked)).toEqual({
      error: 'Too many requests. Try again later.', code: 'rate_limited',
    });
    expect(median(acceptedDurations)).toBeGreaterThanOrEqual(90);
    expect(Math.max(...acceptedDurations)).toBeLessThan(500);
    expect((await pool.query(
      `SELECT attempt_count, blocked_until > NOW() AS blocked
         FROM auth_rate_limits WHERE event_type = 'forgot_ip'`
    )).rows).toEqual([{ attempt_count: 9, blocked: true }]);
    expect((await pool.query(
      `SELECT
         (SELECT count(*)::int FROM account_action_tokens WHERE purpose = 'password_reset') AS tokens,
         (SELECT count(*)::int FROM account_email_outbox WHERE purpose = 'password_reset') AS outbox`
    )).rows[0]).toEqual({ tokens: 0, outbox: 0 });
    expect(providerCalls).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  }, 10000);

  test('bounded equalization preserves repository errors and never runs after a denied limit', async () => {
    const persistenceFailure = new Error('task-owned persistence failure');
    const delays = [];
    const repository = {
      consumeRateLimit: jest.fn(async () => ({ allowed: true })),
      findRecoveryAuthority: jest.fn(async () => { throw persistenceFailure; }),
    };
    const service = new AccountService(repository, {
      sleep: async milliseconds => { delays.push(milliseconds); },
    });
    await expect(service.forgotPassword(
      { email: 'error@example.test' }, '198.51.100.240'
    )).rejects.toBe(persistenceFailure);
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThan(0);
    expect(delays[0]).toBeLessThanOrEqual(100);

    repository.findRecoveryAuthority.mockClear();
    await expect(service.forgotPassword(
      { email: 'malformed' }, '198.51.100.241'
    )).resolves.toEqual({ accepted: true });
    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(0);
    expect(delays[1]).toBeLessThanOrEqual(100);
    expect(repository.findRecoveryAuthority).not.toHaveBeenCalled();

    repository.findRecoveryAuthority.mockResolvedValueOnce({
      user_id: crypto.randomUUID(),
      organization_id: crypto.randomUUID(),
      user_status: 'active',
      membership_status: 'active',
    });
    repository.replaceResetToken = jest.fn(async () => null);
    await expect(service.forgotPassword(
      { email: 'race-invalidated@example.test' }, '198.51.100.242'
    )).resolves.toEqual({ accepted: true });
    expect(delays).toHaveLength(3);
    expect(delays[2]).toBeGreaterThan(0);
    expect(delays[2]).toBeLessThanOrEqual(100);
    expect(repository.replaceResetToken).toHaveBeenCalledTimes(1);

    repository.consumeRateLimit.mockResolvedValueOnce({ allowed: false });
    await expect(service.forgotPassword(
      { email: 'blocked@example.test' }, '198.51.100.243'
    )).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    expect(delays).toHaveLength(3);
    expect(repository.findRecoveryAuthority).toHaveBeenCalledTimes(1);
    expect(providerCalls).toBe(0);
  });
});
