'use strict';

const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Homepage Web Call durable admission', () => {
  let suiteDatabase;
  let db;
  let pool;
  let HomepageDemoAdmissionRepository;
  let PROJECTION_CALLS_GLOBAL_PER_MINUTE;
  let PROJECTION_CALLS_PER_SOURCE_MINUTE;
  let PURGE_CALLS_GLOBAL_PER_MINUTE;
  let PURGE_CALLS_PER_SOURCE_MINUTE;
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
      HomepageDemoAdmissionRepository,
      PROJECTION_CALLS_GLOBAL_PER_MINUTE,
      PROJECTION_CALLS_PER_SOURCE_MINUTE,
      PURGE_CALLS_GLOBAL_PER_MINUTE,
      PURGE_CALLS_PER_SOURCE_MINUTE,
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

  test('verified deletion is bounded per source and across concurrent sources', async () => {
    let now = new Date('2026-08-16T14:30:00.000Z');
    const secret = 'homepage-purge-concurrency-'.padEnd(64, 'q');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    const oneSource = sourceHash('192.0.2.20', secret);

    for (let index = 0; index < PURGE_CALLS_PER_SOURCE_MINUTE; index += 1) {
      await expect(repository.admitPurge(oneSource)).resolves.toBe(true);
    }
    await expect(repository.admitPurge(oneSource)).rejects.toMatchObject({
      status: 429,
      code: 'homepage_web_call_rate_limited',
    });

    now = new Date('2026-08-16T14:31:00.000Z');
    const digests = Array.from({ length: PURGE_CALLS_GLOBAL_PER_MINUTE + 8 }, (_value, index) =>
      sourceHash('purge-source-' + index, secret));
    const outcomes = await Promise.allSettled(digests.map(digest => repository.admitPurge(digest)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled'))
      .toHaveLength(PURGE_CALLS_GLOBAL_PER_MINUTE);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(8);

    const rows = await pool.query(
      `SELECT scope, count(*)::int AS rows, sum(request_count)::int AS requests
         FROM homepage_demo_admission_windows
        WHERE window_start = date_trunc('minute', $1::timestamptz)
          AND scope LIKE 'purge_%'
        GROUP BY scope ORDER BY scope`,
      [now]
    );
    expect(rows.rows).toEqual([
      { scope: 'purge_global_minute', rows: 1, requests: PURGE_CALLS_GLOBAL_PER_MINUTE },
      {
        scope: 'purge_source_minute', rows: PURGE_CALLS_GLOBAL_PER_MINUTE,
        requests: PURGE_CALLS_GLOBAL_PER_MINUTE,
      },
    ]);
  });
});
