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
const SUPPORTED_BCRYPT_PREFIXES = ['a', 'b', 'y'];
const SUPPORTED_BCRYPT_COSTS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_TIMING_MEDIAN_RATIO = 1.15;
const MAX_TIMING_RELATIVE_GAP = 0.13;
const CANONICAL_BCRYPT_WORK_UNITS = 2 * (2 ** 12);

function bcryptPrefix(hash, prefix) {
  return `${hash.slice(0, 2)}${prefix}${hash.slice(3)}`;
}

function bcryptCost(hash, cost) {
  return `${hash.slice(0, 4)}${String(cost).padStart(2, '0')}${hash.slice(6)}`;
}

function currentPasswordMaterial(password) {
  return `northstar-sha512:${crypto.createHash('sha512').update(password, 'utf8').digest('base64')}`;
}

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
  let realBcryptCompare;
  let compareSpy;
  let loginDelays;
  let providerCalls;
  let priorDatabaseUrl;
  let priorFetch;
  const accounts = [];
  const supportedLegacyAccounts = [];
  const inactiveLegacyAccounts = [];

  async function insertAccount(label, options = {}) {
    const { hashPassword } = require('../../src/accounts/service');
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const email = options.email || `${label}-${crypto.randomUUID()}@example.test`;
    const password = options.password || `Timing-${crypto.randomUUID()}!`;
    const passwordHash = options.passwordHash || await hashPassword(password);
    const userStatus = options.userStatus || 'active';
    const membershipStatus = options.membershipStatus || 'active';
    const role = options.role || 'owner';
    await pool.query(
      'INSERT INTO organizations (id, name, owner_name, email, phone) VALUES ($1,$2,$3,$4,$5)',
      [organizationId, `Timing ${label}`, 'Timing Owner', email, '']
    );
    await pool.query(
      `INSERT INTO users
        (id, organization_id, name, email, email_normalized, password_hash, phone, role, status)
       VALUES ($1,$2,'Timing Owner',$3,$3,$4,'',$5,$6)`,
      [userId, organizationId, email, passwordHash, role, userStatus]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,$4,$5)`,
      [membershipId, organizationId, userId, role, membershipStatus]
    );
    await pool.query(
      `INSERT INTO organization_onboarding (organization_id, status)
      VALUES ($1, 'business_profile_required')`,
      [organizationId]
    );
    return {
      email,
      password,
      passwordHash,
      userId,
      prefix: options.prefix,
      cost: options.cost,
    };
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
      compareArguments: compareSpy.mock.calls.slice(callsBefore),
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
    realBcryptCompare = bcrypt.compare.bind(bcrypt);
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
    for (const cost of SUPPORTED_BCRYPT_COSTS) {
      const password = `Supported-legacy-${cost}-password!`;
      const baseHash = await bcrypt.hash(password, cost);
      for (const prefix of SUPPORTED_BCRYPT_PREFIXES) {
        supportedLegacyAccounts.push(await insertAccount(`legacy-${prefix}-${cost}`, {
          password,
          passwordHash: bcryptPrefix(baseHash, prefix),
          prefix,
          cost,
        }));
      }
    }
    const inactivePassword = 'Inactive-legacy-password!';
    const inactiveBase = await bcrypt.hash(inactivePassword, 4);
    inactiveLegacyAccounts.push(await insertAccount('legacy-disabled', {
      password: inactivePassword,
      passwordHash: inactiveBase,
      prefix: 'b',
      cost: 4,
      userStatus: 'disabled',
    }));
    inactiveLegacyAccounts.push(await insertAccount('legacy-membership-inactive', {
      password: inactivePassword,
      passwordHash: bcryptPrefix(inactiveBase, 'a'),
      prefix: 'a',
      cost: 4,
      membershipStatus: 'suspended',
    }));
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
      expect(sample.compareArguments.reduce(
        (total, call) => total + (2 ** bcrypt.getRounds(call[1])), 0
      )).toBe(CANONICAL_BCRYPT_WORK_UNITS);
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

    expect(medianRatio).toBeLessThanOrEqual(MAX_TIMING_MEDIAN_RATIO);
    expect(relativeGap).toBeLessThanOrEqual(MAX_TIMING_RELATIVE_GAP);
  }, 30000);

  test('every supported bcrypt prefix and cost has bounded invalid-credential work and preserves stored hashes', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warningLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const warmupRounds = 2;
      const measuredRounds = 15;
      const baselineClassLabel = 'current-canonical';
      const timingClasses = [
        { label: baselineClassLabel },
        ...SUPPORTED_BCRYPT_COSTS.map(cost => ({ cost, label: `cost-${cost}` })),
      ].map(timingClass => ({
        ...timingClass,
        orderKey: crypto.createHash('sha256')
          .update(`m20-phase7-supported-timing:${timingClass.label}`, 'utf8')
          .digest('hex'),
      })).sort((left, right) => left.orderKey.localeCompare(right.orderKey));
      const orderForRound = round => {
        const rotated = timingClasses.map(
          (_timingClass, index) => timingClasses[(index + round) % timingClasses.length]
        );
        return round % 2 === 0 ? rotated : [...rotated].reverse();
      };
      const allSamples = [];
      const pairedBaselines = [];
      const samples = [];
      const timingPairs = [];
      const measuredOrders = [];
      let attemptIndex = 0;
      for (let executionRound = 0;
        executionRound < warmupRounds + measuredRounds;
        executionRound += 1) {
        const isWarmup = executionRound < warmupRounds;
        const measuredRound = executionRound - warmupRounds;
        const orderedClasses = orderForRound(executionRound);
        const roundSamples = new Map();
        if (!isWarmup) {
          measuredOrders.push(orderedClasses.map(timingClass => timingClass.label));
        }
        for (const timingClass of orderedClasses) {
          const source = `192.0.2.${20 + attemptIndex}`;
          attemptIndex += 1;
          let sample;
          if (timingClass.label === baselineClassLabel) {
            sample = {
              ...await timedWrongLogin(
                accounts[1 + (executionRound % (accounts.length - 1))].email,
                source
              ),
              classLabel: timingClass.label,
              measuredRound,
              warmup: isWarmup,
            };
          } else {
            const costAccounts = supportedLegacyAccounts.filter(
              account => account.cost === timingClass.cost
            );
            const account = costAccounts[executionRound % costAccounts.length];
            sample = {
              ...await timedWrongLogin(account.email, source),
              account,
              classLabel: timingClass.label,
              cost: timingClass.cost,
              measuredRound,
              warmup: isWarmup,
            };
          }
          allSamples.push(sample);
          roundSamples.set(timingClass.label, sample);
        }
        if (!isWarmup) {
          const baseline = roundSamples.get(baselineClassLabel);
          pairedBaselines.push(baseline);
          for (const cost of SUPPORTED_BCRYPT_COSTS) {
            const sample = roundSamples.get(`cost-${cost}`);
            samples.push(sample);
            timingPairs.push({ baseline, cost, measuredRound, sample });
          }
        }
      }

      const costSummaries = SUPPORTED_BCRYPT_COSTS.map(cost => {
        const costPairs = timingPairs.filter(pair => pair.cost === cost);
        const costSamples = costPairs.map(pair => pair.sample);
        const baselineSamples = costPairs.map(pair => pair.baseline);
        expect(costSamples).toHaveLength(measuredRounds);
        expect(baselineSamples).toHaveLength(measuredRounds);
        expect(SUPPORTED_BCRYPT_PREFIXES.map(prefix =>
          costSamples.filter(sample => sample.account.prefix === prefix).length
        )).toEqual([5, 5, 5]);
        const costMedianMs = median(costSamples.map(sample => sample.durationMs));
        const baselineMedianMs = median(baselineSamples.map(sample => sample.durationMs));
        const pairRatios = costPairs.map(pair =>
          Math.max(pair.sample.durationMs, pair.baseline.durationMs) /
          Math.min(pair.sample.durationMs, pair.baseline.durationMs)
        );
        return {
          cost,
          baselineMedianMs,
          medianMs: costMedianMs,
          pairRatios,
          ratio: Math.max(costMedianMs, baselineMedianMs) /
            Math.min(costMedianMs, baselineMedianMs),
          relativeGap: Math.abs(costMedianMs - baselineMedianMs) /
            Math.max(costMedianMs, baselineMedianMs),
          rawBaselineMs: baselineSamples.map(sample => sample.durationMs),
          rawSampleMs: costSamples.map(sample => sample.durationMs),
          compareCalls: costSamples.map(sample => sample.compareCalls),
        };
      });
      console.info('[login-timing-supported-matrix]', JSON.stringify({
        measuredOrders,
        costs: costSummaries.map(summary => ({
          cost: summary.cost,
          baselineMedianMs: Number(summary.baselineMedianMs.toFixed(2)),
          medianMs: Number(summary.medianMs.toFixed(2)),
          ratio: Number(summary.ratio.toFixed(3)),
          relativeGap: Number(summary.relativeGap.toFixed(3)),
          rawBaselineMs: summary.rawBaselineMs.map(value => Number(value.toFixed(2))),
          rawSampleMs: summary.rawSampleMs.map(value => Number(value.toFixed(2))),
          pairRatios: summary.pairRatios.map(value => Number(value.toFixed(3))),
          compareCalls: summary.compareCalls,
        })),
      }));

      expect(pairedBaselines).toHaveLength(measuredRounds);
      expect(samples).toHaveLength(measuredRounds * SUPPORTED_BCRYPT_COSTS.length);
      expect(allSamples).toHaveLength(
        (warmupRounds + measuredRounds) * timingClasses.length
      );
      for (const sample of allSamples) {
        expect(sample.response.status).toBe(401);
        expect(publicBody(sample.response)).toEqual({
          error: 'Invalid email or password', code: 'invalid_credentials',
        });
        expect(sample.response.headers['set-cookie']).toBeUndefined();
      }
      for (const sample of allSamples.filter(item => item.classLabel === baselineClassLabel)) {
        expect(sample.compareCalls).toBe(2);
        expect(sample.compareArguments.reduce(
          (total, call) => total + (2 ** bcrypt.getRounds(call[1])), 0
        )).toBe(CANONICAL_BCRYPT_WORK_UNITS);
      }
      for (const sample of allSamples.filter(item => item.classLabel !== baselineClassLabel)) {
        const expectedCalls = 2 + (12 - sample.account.cost);
        expect(sample.compareCalls).toBe(expectedCalls);
        expect(sample.compareArguments.slice(0, 2).every(call => call[1] === sample.account.passwordHash)).toBe(true);
        expect(sample.compareArguments.slice(2).map(call => bcrypt.getRounds(call[1])))
          .toEqual(SUPPORTED_BCRYPT_COSTS.filter(cost => cost > sample.account.cost));
        expect(sample.compareArguments.reduce(
          (total, call) => total + (2 ** bcrypt.getRounds(call[1])), 0
        )).toBe(CANONICAL_BCRYPT_WORK_UNITS);
      }
      for (const summary of costSummaries) {
        expect(summary.ratio).toBeLessThanOrEqual(MAX_TIMING_MEDIAN_RATIO);
        expect(summary.relativeGap).toBeLessThanOrEqual(MAX_TIMING_RELATIVE_GAP);
      }

      const stored = (await pool.query(
        'SELECT email_normalized, password_hash FROM users WHERE email_normalized = ANY($1::text[])',
        [supportedLegacyAccounts.map(account => account.email)]
      )).rows;
      const storedByEmail = new Map(stored.map(row => [row.email_normalized, row.password_hash]));
      for (const account of supportedLegacyAccounts) {
        expect(storedByEmail.get(account.email)).toBe(account.passwordHash);
      }
      expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(0);
      expect(loginDelays).toEqual(Array(allSamples.length).fill(0));
      expect(providerCalls).toBe(0);
      expect(errorLog).not.toHaveBeenCalled();
      expect(warningLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
      warningLog.mockRestore();
    }
  }, 120000);

  test('every supported bcrypt prefix and cost authenticates and noncanonical material upgrades', async () => {
    const currentMaterialAccounts = [];
    for (const cost of SUPPORTED_BCRYPT_COSTS) {
      const password = `Supported-current-material-${cost}-password!`;
      const baseHash = await bcrypt.hash(currentPasswordMaterial(password), cost);
      for (const prefix of SUPPORTED_BCRYPT_PREFIXES) {
        currentMaterialAccounts.push(await insertAccount(`current-material-${prefix}-${cost}`, {
          password,
          passwordHash: bcryptPrefix(baseHash, prefix),
          prefix,
          cost,
        }));
      }
    }

    for (let index = 0; index < supportedLegacyAccounts.length; index += 1) {
      const account = supportedLegacyAccounts[index];
      const callsBefore = compareSpy.mock.calls.length;
      const response = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `203.0.113.${20 + index}`)
        .send({ email: account.email, password: account.password });
      expect(response.status).toBe(200);
      expect(response.headers['set-cookie']).toHaveLength(3);
      expect(compareSpy.mock.calls.length - callsBefore).toBe(2);
      const upgraded = (await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [account.userId]
      )).rows[0].password_hash;
      expect(upgraded).not.toBe(account.passwordHash);
      expect(upgraded).toMatch(/^\$2b\$12\$/);
      expect(bcrypt.getRounds(upgraded)).toBe(12);
      const { verifyPassword } = require('../../src/accounts/service');
      expect(await verifyPassword(account.password, upgraded)).toEqual({ valid: true, needsUpgrade: false });
    }
    for (let index = 0; index < currentMaterialAccounts.length; index += 1) {
      const account = currentMaterialAccounts[index];
      const callsBefore = compareSpy.mock.calls.length;
      const response = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `203.0.113.${80 + index}`)
        .send({ email: account.email, password: account.password });
      expect(response.status).toBe(200);
      expect(response.headers['set-cookie']).toHaveLength(3);
      expect(compareSpy.mock.calls.length - callsBefore).toBe(1);
      const upgraded = (await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [account.userId]
      )).rows[0].password_hash;
      if (account.prefix === 'b' && account.cost === 12) {
        expect(upgraded).toBe(account.passwordHash);
      } else {
        expect(upgraded).not.toBe(account.passwordHash);
      }
      expect(upgraded).toMatch(/^\$2b\$12\$/);
      expect(bcrypt.getRounds(upgraded)).toBe(12);
      const { verifyPassword } = require('../../src/accounts/service');
      expect(await verifyPassword(account.password, upgraded)).toEqual({ valid: true, needsUpgrade: false });
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count)
      .toBe(supportedLegacyAccounts.length + currentMaterialAccounts.length);
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_rate_limits')).rows[0].count).toBe(0);
    expect(loginDelays).toEqual([]);
    expect(providerCalls).toBe(0);
  }, 90000);

  test('malformed and unsupported cost hashes fail closed through bounded dummy work', async () => {
    const password = 'Unsupported-hash-password!';
    const cost13Base = await bcrypt.hash(password, 13);
    const cost12Base = await bcrypt.hash(password, 12);
    const unsupported = [];
    for (const prefix of SUPPORTED_BCRYPT_PREFIXES) {
      unsupported.push(await insertAccount(`unsupported-${prefix}-13`, {
        password,
        passwordHash: bcryptPrefix(cost13Base, prefix),
        prefix,
        cost: 13,
      }));
      unsupported.push(await insertAccount(`unsupported-${prefix}-31`, {
        password,
        passwordHash: bcryptCost(bcryptPrefix(cost12Base, prefix), 31),
        prefix,
        cost: 31,
      }));
    }
    const malformed = [
      await insertAccount('malformed-short', { password, passwordHash: 'not-a-bcrypt-hash' }),
      await insertAccount('malformed-revision', {
        password,
        passwordHash: `${cost12Base.slice(0, 2)}x${cost12Base.slice(3)}`,
      }),
      await insertAccount('malformed-length', { password, passwordHash: cost12Base.slice(0, 55) }),
    ];

    let selectedCost31 = 0;
    compareSpy.mockImplementation(async (candidate, hash) => {
      if (typeof hash === 'string' && hash.slice(4, 6) === '31') {
        selectedCost31 += 1;
        throw new Error('test guard blocked attacker-selected cost 31 work');
      }
      return realBcryptCompare(candidate, hash);
    });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const timingClasses = {
        unsupported13: unsupported.filter(account => account.cost === 13),
        unsupported31: unsupported.filter(account => account.cost === 31),
        malformed,
      };
      const timingPairs = [];
      for (const [name, accountsForClass] of Object.entries(timingClasses)) {
        expect(accountsForClass).toHaveLength(3);
        for (let index = 0; index < accountsForClass.length; index += 1) {
          const account = accountsForClass[index];
          const pairIndex = timingPairs.length;
          const baselineRequest = () => timedWrongLogin(
            `bounded-absent-${name}-${index}-${crypto.randomUUID()}@example.test`,
            `198.51.100.${150 + pairIndex}`
          );
          const classRequest = async () => ({
            ...await timedWrongLogin(account.email, `198.51.100.${170 + pairIndex}`),
            account,
          });
          let baseline;
          let sample;
          if (pairIndex % 2 === 0) {
            baseline = await baselineRequest();
            sample = await classRequest();
          } else {
            sample = await classRequest();
            baseline = await baselineRequest();
          }
          timingPairs.push({ baseline, name, sample });
        }
      }

      const summaries = Object.keys(timingClasses).map(name => {
        const classPairs = timingPairs.filter(pair => pair.name === name);
        const baselineSamples = classPairs.map(pair => pair.baseline);
        const classSamples = classPairs.map(pair => pair.sample);
        const baselineMedianMs = median(baselineSamples.map(sample => sample.durationMs));
        const medianMs = median(classSamples.map(sample => sample.durationMs));
        return {
          name,
          baselineMedianMs,
          medianMs,
          ratio: Math.max(baselineMedianMs, medianMs) / Math.min(baselineMedianMs, medianMs),
          relativeGap: Math.abs(baselineMedianMs - medianMs) / Math.max(baselineMedianMs, medianMs),
          pairRatios: classPairs.map(pair =>
            Math.max(pair.baseline.durationMs, pair.sample.durationMs) /
            Math.min(pair.baseline.durationMs, pair.sample.durationMs)
          ),
          rawBaselineMs: baselineSamples.map(sample => sample.durationMs),
          rawSampleMs: classSamples.map(sample => sample.durationMs),
        };
      });
      console.info('[login-timing-unsupported-matrix]', JSON.stringify({
        classes: summaries.map(summary => ({
          name: summary.name,
          baselineMedianMs: Number(summary.baselineMedianMs.toFixed(2)),
          medianMs: Number(summary.medianMs.toFixed(2)),
          ratio: Number(summary.ratio.toFixed(3)),
          relativeGap: Number(summary.relativeGap.toFixed(3)),
          pairRatios: summary.pairRatios.map(value => Number(value.toFixed(3))),
          rawBaselineMs: summary.rawBaselineMs.map(value => Number(value.toFixed(2))),
          rawSampleMs: summary.rawSampleMs.map(value => Number(value.toFixed(2))),
        })),
      }));
      for (const summary of summaries) {
        const classPairs = timingPairs.filter(pair => pair.name === summary.name);
        expect(classPairs).toHaveLength(3);
        for (const { baseline, sample } of classPairs) {
          for (const responseSample of [baseline, sample]) {
            expect(responseSample.response.status).toBe(401);
            expect(publicBody(responseSample.response)).toEqual({
              error: 'Invalid email or password', code: 'invalid_credentials',
            });
            expect(responseSample.response.headers['set-cookie']).toBeUndefined();
          }
          expect(baseline.compareCalls).toBe(2);
          expect(baseline.compareArguments.reduce(
            (total, call) => total + (2 ** bcrypt.getRounds(call[1])), 0
          )).toBe(CANONICAL_BCRYPT_WORK_UNITS);
          expect(sample.compareCalls).toBe(2);
          expect(sample.compareArguments).toHaveLength(2);
          expect(sample.compareArguments.every(call => bcrypt.getRounds(call[1]) === 12)).toBe(true);
          expect(sample.compareArguments.reduce(
            (total, call) => total + (2 ** bcrypt.getRounds(call[1])), 0
          )).toBe(CANONICAL_BCRYPT_WORK_UNITS);
          expect(sample.compareArguments.every(call => call[1] !== sample.account.passwordHash)).toBe(true);
        }
        expect(summary.ratio).toBeLessThanOrEqual(MAX_TIMING_MEDIAN_RATIO);
        expect(summary.relativeGap).toBeLessThanOrEqual(MAX_TIMING_RELATIVE_GAP);
      }
      expect(selectedCost31).toBe(0);

      for (let index = 0; index < 2; index += 1) {
        const account = unsupported[index];
        const response = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', `198.51.100.${190 + index}`)
          .send({ email: account.email, password: account.password });
        expect(response.status).toBe(401);
        expect(publicBody(response)).toEqual({
          error: 'Invalid email or password', code: 'invalid_credentials',
        });
      }
      const checked = [...unsupported, ...malformed];
      const rows = (await pool.query(
        'SELECT email_normalized, password_hash FROM users WHERE email_normalized = ANY($1::text[])',
        [checked.map(account => account.email)]
      )).rows;
      const byEmail = new Map(rows.map(row => [row.email_normalized, row.password_hash]));
      for (const account of checked) expect(byEmail.get(account.email)).toBe(account.passwordHash);
      expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(0);
      expect(providerCalls).toBe(0);
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
      compareSpy.mockImplementation(realBcryptCompare);
    }
  }, 30000);

  test('inactive supported legacy authorities and progressive throttle semantics remain intact', async () => {
    for (let index = 0; index < inactiveLegacyAccounts.length; index += 1) {
      const account = inactiveLegacyAccounts[index];
      const response = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `203.0.113.${80 + index}`)
        .send({ email: account.email, password: account.password });
      expect(response.status).toBe(403);
      expect(publicBody(response)).toEqual({
        error: 'This account is not available', code: 'account_inactive',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await pool.query('SELECT password_hash FROM users WHERE id = $1', [account.userId])).rows[0].password_hash)
        .toBe(account.passwordHash);
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(0);

    await pool.query('DELETE FROM auth_rate_limits');
    compareSpy.mockClear();
    const legacyPassword = 'Progressive-legacy-password!';
    const account = await insertAccount('progressive-legacy', {
      password: legacyPassword,
      passwordHash: await bcrypt.hash(legacyPassword, 4),
      prefix: 'b',
      cost: 4,
    });
    const source = '203.0.113.90';
    for (let index = 0; index < 6; index += 1) {
      const wrong = await timedWrongLogin(account.email, source);
      expect(wrong.response.status).toBe(401);
      expect(wrong.compareCalls).toBe(10);
    }
    expect(loginDelays).toEqual([0, 0, 250, 500, 1000, 2000]);
    const correct = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', source)
      .send({ email: account.email, password: account.password });
    expect(correct.status).toBe(200);
    expect(correct.headers['set-cookie']).toHaveLength(3);
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_rate_limits')).rows[0].count).toBe(0);
    expect(providerCalls).toBe(0);
  }, 30000);

  test('a bcrypt failure during lower-cost padding fails closed before failure mutation', async () => {
    const legacyPassword = 'Padding-failure-legacy-password!';
    const account = await insertAccount('padding-failure-legacy', {
      password: legacyPassword,
      passwordHash: bcryptPrefix(await bcrypt.hash(legacyPassword, 4), 'a'),
      prefix: 'a',
      cost: 4,
    });
    let calls = 0;
    compareSpy.mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 3) throw new Error('synthetic padding bcrypt failure');
      return realBcryptCompare(...args);
    });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.100')
        .send({ email: account.email, password: 'definitely-the-wrong-password' });
      expect(response.status).toBe(500);
      expect(publicBody(response)).toEqual({
        error: 'Authentication request failed', code: 'auth_request_failed',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(calls).toBe(3);
      expect(errorLog).toHaveBeenCalledWith('[Auth] Request failed:', {
        requestId: 'unavailable', event: 'login_failed',
      });
      expect((await pool.query('SELECT count(*)::int AS count FROM auth_sessions')).rows[0].count).toBe(0);
      expect((await pool.query(
        'SELECT event_type, attempt_count FROM auth_rate_limits ORDER BY event_type'
      )).rows).toEqual([{ event_type: 'login_ip', attempt_count: 1 }]);
      expect(providerCalls).toBe(0);
    } finally {
      errorLog.mockRestore();
      compareSpy.mockImplementation(realBcryptCompare);
    }
  });

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
