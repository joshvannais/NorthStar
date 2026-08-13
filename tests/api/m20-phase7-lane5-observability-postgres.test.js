'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { Pool } = require('pg');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.join(__dirname, '..', '..');
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER'];
const EVENT_KEY = 'anonymous_api_not_found';

function childAggregate({ connectionString, count, method, observedAt }) {
  return new Promise((resolve, reject) => {
    const child = fork(
      path.join(__dirname, '..', 'helpers', 'm20-phase7-lane5-observability-worker.js'),
      [],
      {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: 'test' },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        windowsHide: true,
      }
    );
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('message', message => {
      if (message && message.type === 'result') resolve(message);
      else reject(new Error(`Lane 5 worker failed: ${message && message.code || stderr || 'unknown'}`));
    });
    child.once('exit', code => {
      if (code !== 0 && !stderr.includes('Lane 5 worker failed')) {
        reject(new Error(`Lane 5 worker exited ${code}: ${stderr}`));
      }
    });
    child.send({ action: 'aggregate', count, method, observedAt });
  });
}

function copyMigrationDirectoryWithoutLane5() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-lane5-upgrade-'));
  for (const filename of fs.readdirSync(path.join(ROOT, 'migrations'))) {
    if (!filename.endsWith('.sql') || filename === '021_bounded_api_observability.sql') continue;
    fs.copyFileSync(path.join(ROOT, 'migrations', filename), path.join(target, filename));
  }
  return target;
}

realPostgres('Mission 20 Phase 7 Lane 5 mounted bounded observability', () => {
  let suiteDatabase;
  let upgradeDatabase;
  let db;
  let pool;
  let app;
  let audit;
  let originalDatabaseUrl;
  let originalFetch;
  let info;
  let warn;
  let error;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-p7-l5-observe');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new Error('external_network_forbidden_lane5'); });
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    audit = require('../../src/audit/client');
    app = require('../../src/server').app;
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  }, 120000);

  afterAll(async () => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    try {
      if (db) await db.close();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (upgradeDatabase) await upgradeDatabase.cleanup();
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  }, 120000);

  test('fresh migration is exact, rerunnable, checksummed, and fixed-cardinality by schema', async () => {
    await expect(db.runMigrations()).resolves.toBe(true);
    await expect(db.runMigrations()).resolves.toBe(true);
    const migrationPath = path.join(ROOT, 'migrations', '021_bounded_api_observability.sql');
    const bytes = fs.readFileSync(migrationPath);
    expect(bytes.includes(Buffer.from('\r'))).toBe(false);
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    const ledger = await pool.query(
      `SELECT filename, checksum, count(*) OVER ()::int AS total
         FROM _migrations WHERE filename = '021_bounded_api_observability.sql'`
    );
    expect(ledger.rows).toEqual([{ filename: '021_bounded_api_observability.sql', checksum: expected, total: 1 }]);

    const shape = await pool.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_observability_hourly'
        ORDER BY ordinal_position`
    );
    expect(shape.rows).toEqual([
      { column_name: 'event_key', data_type: 'character varying', is_nullable: 'NO' },
      { column_name: 'method_class', data_type: 'character varying', is_nullable: 'NO' },
      { column_name: 'bucket_slot', data_type: 'smallint', is_nullable: 'NO' },
      { column_name: 'bucket_started_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'request_count', data_type: 'bigint', is_nullable: 'NO' },
      { column_name: 'last_seen_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'api_observability_hourly'
        ORDER BY indexname`
    );
    expect(indexes.rows).toEqual([{ indexname: 'api_observability_hourly_pkey' }]);
  }, 120000);

  test('upgrade applies only the additive Lane 5 migration and reruns idempotently', async () => {
    upgradeDatabase = await createSuiteDatabase('m20-p7-l5-upgrade');
    const upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 4 });
    const earlierMigrations = copyMigrationDirectoryWithoutLane5();
    try {
      await db.runMigrations({ pool: upgradePool, migrationsDirectory: earlierMigrations });
      const before = await upgradePool.query("SELECT to_regclass('public.api_observability_hourly') AS relation");
      expect(before.rows[0].relation).toBeNull();
      const countBefore = await upgradePool.query('SELECT count(*)::int AS count FROM _migrations');
      await db.runMigrations({ pool: upgradePool });
      await db.runMigrations({ pool: upgradePool });
      const after = await upgradePool.query(
        `SELECT to_regclass('public.api_observability_hourly') AS relation,
                (SELECT count(*)::int FROM _migrations) AS migration_count,
                (SELECT count(*)::int FROM _migrations WHERE filename = '021_bounded_api_observability.sql') AS lane5_count`
      );
      expect(after.rows[0]).toEqual({
        relation: 'api_observability_hourly',
        migration_count: countBefore.rows[0].count + 1,
        lane5_count: 1,
      });
    } finally {
      fs.rmSync(earlierMigrations, { recursive: true, force: true });
      await upgradePool.end();
    }
  }, 120000);

  test('mounted production middleware aggregates adversarial unique and repeated anonymous 404s without audit growth or external calls', async () => {
    const beforeAudit = await pool.query('SELECT count(*)::int AS count FROM audit_logs');
    const requests = [];
    for (let index = 0; index < 80; index += 1) {
      requests.push(request(app).get(`/api/lane5-unique-${index}/private-${index}@example.com/sk_live_${index}`));
      requests.push(request(app).get('/api/lane5-repeated/private@example.com/sk_live_repeated'));
    }
    const responses = await Promise.all(requests);
    expect(responses).toHaveLength(160);
    for (const result of responses) {
      expect(result.status).toBe(404);
      expect(result.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.headers['x-correlation-id']).toBe(result.headers['x-request-id']);
      expect(result.body.error).toEqual(expect.objectContaining({ code: 'not_found', requestId: result.headers['x-request-id'] }));
    }

    let aggregate;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      aggregate = await pool.query(
        `SELECT coalesce(sum(request_count), 0)::int AS count
           FROM api_observability_hourly
          WHERE event_key = $1 AND method_class = 'GET'`,
        [EVENT_KEY]
      );
      if (aggregate.rows[0].count >= 160) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(aggregate.rows[0].count).toBe(160);
    const afterAudit = await pool.query('SELECT count(*)::int AS count FROM audit_logs');
    expect(afterAudit.rows[0].count).toBe(beforeAudit.rows[0].count);
    const memory = await audit.query({ action: 'GET 404', limit: 10000 });
    expect(memory.pagination.total).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();

    const serializedLogs = info.mock.calls.map(call => JSON.stringify(call[0])).join('\n');
    for (const sensitive of ['lane5-unique', 'lane5-repeated', 'private@example.com', 'sk_live_']) {
      expect(serializedLogs).not.toContain(sensitive);
    }
    expect(info.mock.calls.filter(call => call[0] && call[0].event === 'request_completed')).toHaveLength(160);
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'anonymous_not_found_aggregation_failed' }));
    expect(error).not.toHaveBeenCalled();
  }, 120000);

  test('UTC ring, method normalization, concurrent increments, saturation, and storage stay bounded', async () => {
    const observations = [];
    for (const method of METHODS) {
      for (let hour = 0; hour < 24; hour += 1) {
        observations.push(audit.recordAnonymousNotFound({
          method,
          observedAt: new Date(Date.UTC(2030, 0, 2, hour, 30, 0)),
        }));
      }
    }
    await Promise.all(observations);
    for (let day = 3; day <= 12; day += 1) {
      await Promise.all(METHODS.flatMap(method => Array.from({ length: 24 }, (_, hour) =>
        audit.recordAnonymousNotFound({ method, observedAt: new Date(Date.UTC(2030, 0, day, hour, 30, 0)) })
      )));
    }
    const bounded = await pool.query(
      `SELECT count(*)::int AS rows, count(DISTINCT method_class)::int AS methods,
              min(bucket_slot)::int AS minimum_slot, max(bucket_slot)::int AS maximum_slot,
              pg_total_relation_size('api_observability_hourly')::bigint AS bytes
         FROM api_observability_hourly`
    );
    expect(bounded.rows[0].rows).toBeLessThanOrEqual(192);
    expect(bounded.rows[0]).toEqual(expect.objectContaining({ methods: 8, minimum_slot: 0, maximum_slot: 23 }));
    // PostgreSQL retains bounded dead tuples between autovacuum cycles. The
    // relation remains small even after thousands of conflict updates; force
    // one ordinary maintenance pass and prove the steady-state bound too.
    expect(BigInt(bounded.rows[0].bytes)).toBeLessThan(8n * 1024n * 1024n);
    await pool.query('VACUUM (ANALYZE) api_observability_hourly');
    const maintained = await pool.query(
      `SELECT count(*)::int AS rows,
              pg_total_relation_size('api_observability_hourly')::bigint AS bytes
         FROM api_observability_hourly`
    );
    expect(maintained.rows[0].rows).toBeLessThanOrEqual(192);
    expect(BigInt(maintained.rows[0].bytes)).toBeLessThan(8n * 1024n * 1024n);

    const sameHour = new Date('2031-04-05T11:45:00.000Z');
    await Promise.all(Array.from({ length: 160 }, () =>
      audit.recordAnonymousNotFound({ method: 'PATCH', observedAt: sameHour })
    ));
    const concurrent = await pool.query(
      `SELECT request_count::text AS count FROM api_observability_hourly
        WHERE event_key = $1 AND method_class = 'PATCH' AND bucket_slot = 11`,
      [EVENT_KEY]
    );
    expect(concurrent.rows).toEqual([{ count: '160' }]);

    const saturatedAt = new Date('2032-05-06T12:45:00.000Z');
    await audit.recordAnonymousNotFound({ method: 'DELETE', observedAt: saturatedAt });
    await pool.query(
      `UPDATE api_observability_hourly SET request_count = 1000
        WHERE event_key = $1 AND method_class = 'DELETE' AND bucket_slot = 12`,
      [EVENT_KEY]
    );
    const saturatedBefore = await pool.query(
      `SELECT request_count::int AS count, xmin::text AS xmin, ctid::text AS ctid, last_seen_at
         FROM api_observability_hourly
        WHERE event_key = $1 AND method_class = 'DELETE' AND bucket_slot = 12`,
      [EVENT_KEY]
    );
    await audit.recordAnonymousNotFound({ method: 'DELETE', observedAt: saturatedAt });
    const saturatedAfter = await pool.query(
      `SELECT request_count::int AS count, xmin::text AS xmin, ctid::text AS ctid, last_seen_at
         FROM api_observability_hourly
        WHERE event_key = $1 AND method_class = 'DELETE' AND bucket_slot = 12`,
      [EVENT_KEY]
    );
    expect(saturatedBefore.rows).toHaveLength(1);
    expect(saturatedAfter.rows).toEqual(saturatedBefore.rows);
    expect(saturatedAfter.rows[0].count).toBe(1000);

    // A delayed worker with an older wall clock must not replace the current
    // slot window or its count after a newer process has advanced the ring.
    await audit.recordAnonymousNotFound({
      method: 'HEAD',
      observedAt: new Date('2035-01-02T14:45:00.000Z'),
    });
    await audit.recordAnonymousNotFound({
      method: 'HEAD',
      observedAt: new Date('2034-12-31T14:45:00.000Z'),
    });
    const monotonic = await pool.query(
      `SELECT bucket_started_at, request_count::int AS count, last_seen_at
         FROM api_observability_hourly
        WHERE event_key = $1 AND method_class = 'HEAD' AND bucket_slot = 14`,
      [EVENT_KEY]
    );
    expect(monotonic.rows).toHaveLength(1);
    expect(monotonic.rows[0].bucket_started_at.toISOString()).toBe('2035-01-02T14:00:00.000Z');
    expect(monotonic.rows[0].last_seen_at.toISOString()).toBe('2035-01-02T14:45:00.000Z');
    expect(monotonic.rows[0].count).toBe(1);
  }, 120000);

  test('independent processes share one exact aggregate without lost increments', async () => {
    const observedAt = '2033-06-07T13:30:00.000Z';
    const results = await Promise.all(Array.from({ length: 3 }, () => childAggregate({
      connectionString: suiteDatabase.connectionString,
      count: 50,
      method: 'OPTIONS',
      observedAt,
    })));
    expect(results.map(result => result.count)).toEqual([50, 50, 50]);
    const row = await pool.query(
      `SELECT request_count::int AS count, bucket_started_at
         FROM api_observability_hourly
        WHERE event_key = $1 AND method_class = 'OPTIONS' AND bucket_slot = 13`,
      [EVENT_KEY]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].count).toBe(150);
    expect(row.rows[0].bucket_started_at.toISOString()).toBe('2033-06-07T13:00:00.000Z');
    expect(global.fetch).not.toHaveBeenCalled();
  }, 120000);
});
