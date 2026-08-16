'use strict';

const crypto = require('crypto');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Homepage Web Call durable admission', () => {
  let suiteDatabase;
  let db;
  let pool;
  let HomepageDemoAdmissionHousekeepingWorker;
  let HomepageDemoAdmissionRepository;
  let PROJECTION_CALLS_GLOBAL_PER_MINUTE;
  let PROJECTION_CALLS_PER_SOURCE_MINUTE;
  let PURGE_CALLS_GLOBAL_PER_MINUTE;
  let PURGE_CALLS_PER_SOURCE_MINUTE;
  let PURGE_ATTEMPTS_PER_CAPABILITY;
  let sourceHash;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('homepage_admission');
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    ({
      HomepageDemoAdmissionHousekeepingWorker,
      HomepageDemoAdmissionRepository,
      PROJECTION_CALLS_GLOBAL_PER_MINUTE,
      PROJECTION_CALLS_PER_SOURCE_MINUTE,
      PURGE_CALLS_GLOBAL_PER_MINUTE,
      PURGE_CALLS_PER_SOURCE_MINUTE,
      PURGE_ATTEMPTS_PER_CAPABILITY,
      sourceHash,
    } = require('../../src/services/homepageDemoAdmission'));
  }, 60000);

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (suiteDatabase) await suiteDatabase.cleanup();
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }, 60000);

  test('source limit is atomic and stores only a keyed digest', async () => {
    const now = new Date('2026-08-16T12:15:00.000Z');
    const secret = 'homepage-admission-test-secret-'.padEnd(64, 'x');
    const rawSource = '203.0.113.42';
    const digest = sourceHash(rawSource, secret);
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });

    await expect(repository.admit(digest)).resolves.toBe(true);
    await expect(repository.admit(digest)).resolves.toBe(true);
    await expect(repository.admit(digest)).resolves.toBe(true);
    await expect(repository.admit(digest)).rejects.toMatchObject({
      status: 429,
      code: 'homepage_web_call_rate_limited',
    });

    const rows = await pool.query(
      `SELECT scope, subject_hash, request_count
         FROM homepage_demo_admission_windows
        WHERE window_start IN (date_trunc('hour', $1::timestamptz), date_trunc('minute', $1::timestamptz))
        ORDER BY scope`,
      [now]
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({ scope: 'global_minute', request_count: 3 }),
      { scope: 'source_hour', subject_hash: digest, request_count: 3 },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain(rawSource);
  });

  test('concurrent distinct sources share one PostgreSQL-global ceiling and rejected source rows roll back', async () => {
    const now = new Date('2026-08-16T13:20:00.000Z');
    const secret = 'homepage-admission-concurrency-'.padEnd(64, 'y');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    const digests = Array.from({ length: 20 }, (_value, index) => sourceHash('198.51.100.' + (index + 1), secret));

    const outcomes = await Promise.allSettled(digests.map(digest => repository.admit(digest)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(12);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(8);
    outcomes.filter(outcome => outcome.status === 'rejected').forEach(outcome => {
      expect(outcome.reason).toMatchObject({ status: 429, code: 'homepage_web_call_rate_limited' });
    });

    const rows = await pool.query(
      `SELECT scope, count(*)::int AS rows, sum(request_count)::int AS requests
         FROM homepage_demo_admission_windows
        WHERE window_start IN (date_trunc('hour', $1::timestamptz), date_trunc('minute', $1::timestamptz))
        GROUP BY scope ORDER BY scope`,
      [now]
    );
    expect(rows.rows).toEqual([
      { scope: 'global_minute', rows: 1, requests: 12 },
      { scope: 'source_hour', rows: 12, requests: 12 },
    ]);
  });

  test('Polaris projection is bounded per source and across concurrent sources', async () => {
    let now = new Date('2026-08-16T14:20:00.000Z');
    const secret = 'homepage-projection-concurrency-'.padEnd(64, 'p');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    const oneSource = sourceHash('192.0.2.10', secret);

    for (let index = 0; index < PROJECTION_CALLS_PER_SOURCE_MINUTE; index += 1) {
      await expect(repository.admitProjection(oneSource)).resolves.toBe(true);
    }
    await expect(repository.admitProjection(oneSource)).rejects.toMatchObject({
      status: 429,
      code: 'homepage_web_call_rate_limited',
    });

    now = new Date('2026-08-16T14:21:00.000Z');
    const digests = Array.from({ length: PROJECTION_CALLS_GLOBAL_PER_MINUTE + 8 }, (_value, index) =>
      sourceHash('projection-source-' + index, secret));
    const outcomes = await Promise.allSettled(digests.map(digest => repository.admitProjection(digest)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled'))
      .toHaveLength(PROJECTION_CALLS_GLOBAL_PER_MINUTE);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(8);

    const rows = await pool.query(
      `SELECT scope, count(*)::int AS rows, sum(request_count)::int AS requests
         FROM homepage_demo_admission_windows
        WHERE window_start = date_trunc('minute', $1::timestamptz)
          AND scope LIKE 'projection_%'
        GROUP BY scope ORDER BY scope`,
      [now]
    );
    expect(rows.rows).toEqual([
      { scope: 'projection_global_minute', rows: 1, requests: PROJECTION_CALLS_GLOBAL_PER_MINUTE },
      {
        scope: 'projection_source_minute', rows: PROJECTION_CALLS_GLOBAL_PER_MINUTE,
        requests: PROJECTION_CALLS_GLOBAL_PER_MINUTE,
      },
    ]);
  });

  test('one purge capability executes once across concurrent sources and verified replay is free', async () => {
    let now = new Date('2026-08-16T14:30:00.000Z');
    const secret = 'homepage-purge-concurrency-'.padEnd(64, 'q');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    const capability = crypto.createHash('sha256').update('one-capability').digest('hex');
    const expiresAt = now.getTime() + (10 * 60 * 1000);
    const digests = Array.from({ length: 10 }, (_value, index) =>
      sourceHash('purge-replay-source-' + index, secret));
    const outcomes = await Promise.allSettled(digests.map(digest =>
      repository.beginPurge(digest, capability, expiresAt)));
    const granted = outcomes.filter(outcome => outcome.status === 'fulfilled');
    expect(granted).toHaveLength(1);
    expect(granted[0].value).toEqual({ execute: true, verified: false, attemptCount: 1 });
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    expect(rejected).toHaveLength(9);
    rejected.forEach(outcome => {
      expect(outcome.reason).toMatchObject({ status: 409, code: 'homepage_purge_in_progress' });
    });
    await expect(repository.completePurge(capability, 1)).resolves.toBe(true);
    await expect(repository.completePurge(capability, 1)).resolves.toBe(true);
    await expect(repository.beginPurge(digests[9], capability, expiresAt)).resolves.toEqual({
      execute: false,
      verified: true,
      attemptCount: 1,
    });
    await expect(repository.releasePurge(capability, 1)).resolves.toBe(false);

    const rows = await pool.query(
      `SELECT scope, count(*)::int AS rows, sum(request_count)::int AS requests
         FROM homepage_demo_admission_windows
        WHERE window_start = date_trunc('minute', $1::timestamptz)
          AND scope LIKE 'purge_%'
        GROUP BY scope ORDER BY scope`,
      [now]
    );
    expect(rows.rows).toEqual([
      { scope: 'purge_global_minute', rows: 1, requests: 1 },
      { scope: 'purge_source_minute', rows: 1, requests: 1 },
    ]);
    const operations = await pool.query(
      `SELECT state, attempt_count
         FROM homepage_demo_purge_operations
        WHERE capability_hash = $1`,
      [capability]
    );
    expect(operations.rows).toEqual([{ state: 'verified', attempt_count: 1 }]);
  });

  test('failed purge leases retry across source changes only to the durable capability cap', async () => {
    let now = new Date('2026-08-16T14:35:00.000Z');
    const secret = 'homepage-purge-retry-'.padEnd(64, 'r');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    const capability = crypto.createHash('sha256').update('bounded-retry-capability').digest('hex');
    const expiresAt = now.getTime() + (10 * 60 * 1000);

    await expect(repository.beginPurge(
      sourceHash('purge-retry-source-1', secret), capability, expiresAt
    )).resolves.toEqual({ execute: true, verified: false, attemptCount: 1 });
    await expect(repository.releasePurge(capability, 1)).resolves.toBe(true);
    now = new Date(now.getTime() + 1000);
    await expect(repository.beginPurge(
      sourceHash('purge-retry-source-2', secret), capability, expiresAt
    )).resolves.toEqual({ execute: true, verified: false, attemptCount: 2 });
    await expect(repository.completePurge(capability, 1)).rejects.toMatchObject({
      status: 503,
      code: 'homepage_admission_unavailable',
    });
    await expect(repository.releasePurge(capability, 1)).resolves.toBe(false);
    await expect(repository.releasePurge(capability, 2)).resolves.toBe(true);
    now = new Date(now.getTime() + 1000);
    await expect(repository.beginPurge(
      sourceHash('purge-retry-source-3', secret), capability, expiresAt
    )).resolves.toEqual({ execute: true, verified: false, attemptCount: 3 });
    await expect(repository.releasePurge(capability, 3)).resolves.toBe(true);
    now = new Date(now.getTime() + 1000);
    await expect(repository.beginPurge(
      sourceHash('purge-retry-source-exhausted', secret), capability, expiresAt
    )).rejects.toMatchObject({ status: 429, code: 'homepage_purge_retry_limit_reached' });
    const operation = await pool.query(
      `SELECT state, attempt_count
         FROM homepage_demo_purge_operations
        WHERE capability_hash = $1`,
      [capability]
    );
    expect(operation.rows).toEqual([{
      state: 'in_progress',
      attempt_count: PURGE_ATTEMPTS_PER_CAPABILITY,
    }]);
  });

  test('distinct purge capabilities retain source and PostgreSQL-global ceilings', async () => {
    let now = new Date('2026-08-16T14:40:00.000Z');
    const secret = 'homepage-purge-ceilings-'.padEnd(64, 's');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    const oneSource = sourceHash('192.0.2.20', secret);
    const expiresAt = now.getTime() + (10 * 60 * 1000);
    for (let index = 0; index < PURGE_CALLS_PER_SOURCE_MINUTE; index += 1) {
      const capability = crypto.createHash('sha256').update('source-capability-' + index).digest('hex');
      await expect(repository.beginPurge(oneSource, capability, expiresAt)).resolves.toMatchObject({ execute: true });
    }
    await expect(repository.beginPurge(
      oneSource,
      crypto.createHash('sha256').update('source-capability-over-limit').digest('hex'),
      expiresAt
    )).rejects.toMatchObject({ status: 429, code: 'homepage_web_call_rate_limited' });

    now = new Date('2026-08-16T14:41:00.000Z');
    const globalExpiresAt = now.getTime() + (10 * 60 * 1000);
    const candidates = Array.from({ length: PURGE_CALLS_GLOBAL_PER_MINUTE + 8 }, (_value, index) => ({
      capability: crypto.createHash('sha256').update('global-capability-' + index).digest('hex'),
      source: sourceHash('purge-global-source-' + index, secret),
    }));
    const outcomes = await Promise.allSettled(candidates.map(candidate =>
      repository.beginPurge(candidate.source, candidate.capability, globalExpiresAt)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled'))
      .toHaveLength(PURGE_CALLS_GLOBAL_PER_MINUTE);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(8);
    const globalOperations = await pool.query(
      `SELECT count(*)::int AS count
         FROM homepage_demo_purge_operations
        WHERE capability_hash = ANY($1::char(64)[])`,
      [candidates.map(candidate => candidate.capability)]
    );
    expect(globalOperations.rows[0].count).toBe(PURGE_CALLS_GLOBAL_PER_MINUTE);
  });

  test('housekeeping removes expired operation state without a later public mutation', async () => {
    const now = new Date('2026-08-16T15:00:00.000Z');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    const capability = crypto.createHash('sha256').update('expired-operation').digest('hex');
    await pool.query(
      `INSERT INTO homepage_demo_purge_operations
         (capability_hash, state, attempt_count, lease_expires_at, authority_expires_at,
          retire_at, verified_at, created_at, updated_at)
       VALUES ($1, 'verified', 1, NULL, $2::timestamptz - INTERVAL '3 minutes',
               $2::timestamptz - INTERVAL '1 minute', $2::timestamptz - INTERVAL '2 minutes',
               $2::timestamptz - INTERVAL '20 minutes', $2::timestamptz - INTERVAL '2 minutes')`,
      [capability, now]
    );
    const worker = new HomepageDemoAdmissionHousekeepingWorker({
      repository,
      batchSize: 10,
      maxBatches: 25,
    });
    const expired = await worker.drainOnce();
    expect(expired.purgeOperations).toBeGreaterThanOrEqual(1);
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM homepage_demo_purge_operations WHERE capability_hash = $1',
      [capability]
    )).rows[0].count).toBe(0);
  });
});
