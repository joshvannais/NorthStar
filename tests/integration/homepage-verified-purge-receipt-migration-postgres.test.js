'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const RECEIPT_MIGRATION = '024_homepage_verified_purge_receipt.sql';

function migrationFiles(directory) {
  return fs.readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Homepage verified-purge receipt migration', () => {
  let suiteDatabase;
  let pool;
  let preReceiptDirectory;
  let db;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('homepage receipt migration');
    pool = new Pool({ connectionString: suiteDatabase.connectionString, max: 4 });
    preReceiptDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-homepage-pre024-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name !== RECEIPT_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preReceiptDirectory, filename));
    }
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.runMigrations({ pool, migrationsDirectory: preReceiptDirectory })).toBe(true);
  }, 60000);

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (preReceiptDirectory && path.resolve(preReceiptDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preReceiptDirectory, { recursive: true, force: true });
      }
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  }, 60000);

  test('upgrades retained purge rows without inventing projection authority and reruns checksum-exact', async () => {
    const now = new Date('2026-08-16T16:00:00.000Z');
    const verifiedCapability = crypto.createHash('sha256').update('retained-verified-purge').digest('hex');
    const inProgressCapability = crypto.createHash('sha256').update('retained-running-purge').digest('hex');
    await pool.query(
      `INSERT INTO homepage_demo_purge_operations
         (capability_hash, state, attempt_count, lease_expires_at, authority_expires_at,
          retire_at, verified_at, created_at, updated_at)
       VALUES
         ($1, 'verified', 1, NULL, $3::timestamptz + INTERVAL '10 minutes',
          $3::timestamptz + INTERVAL '12 minutes', $3, $3 - INTERVAL '1 minute', $3),
         ($2, 'in_progress', 2, $3::timestamptz + INTERVAL '1 minute',
          $3::timestamptz + INTERVAL '10 minutes', $3::timestamptz + INTERVAL '12 minutes',
          NULL, $3 - INTERVAL '1 minute', $3)`,
      [verifiedCapability, inProgressCapability, now]
    );
    expect((await pool.query(
      `SELECT count(*)::int AS count
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'homepage_demo_purge_operations'
          AND column_name = 'projection_permitted'`
    )).rows).toEqual([{ count: 0 }]);

    expect(await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect((await pool.query(
      `SELECT capability_hash, state, projection_permitted
         FROM homepage_demo_purge_operations
        WHERE capability_hash = ANY($1::char(64)[])
        ORDER BY capability_hash`,
      [[verifiedCapability, inProgressCapability]]
    )).rows).toEqual([
      { capability_hash: inProgressCapability, state: 'in_progress', projection_permitted: false },
      { capability_hash: verifiedCapability, state: 'verified', projection_permitted: false },
    ].sort((left, right) => left.capability_hash.localeCompare(right.capability_hash)));

    const { HomepageDemoAdmissionRepository } = require('../../src/services/homepageDemoAdmission');
    const repository = new HomepageDemoAdmissionRepository({ pool, now: () => now });
    await expect(repository.consumeVerifiedPurgeProjection(
      crypto.createHash('sha256').update('retained-source').digest('hex'),
      verifiedCapability,
      now.getTime(),
      now.getTime() + (2 * 60 * 1000)
    )).rejects.toMatchObject({ status: 403, code: 'homepage_verified_purge_required' });

    await expect(pool.query(
      `UPDATE homepage_demo_purge_operations
          SET state = 'consumed'
        WHERE capability_hash = $1`,
      [verifiedCapability]
    )).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      `UPDATE homepage_demo_purge_operations
          SET state = 'consumed', projection_permitted = TRUE
        WHERE capability_hash = $1`,
      [verifiedCapability]
    );
    expect((await pool.query(
      `SELECT state, projection_permitted
         FROM homepage_demo_purge_operations
        WHERE capability_hash = $1`,
      [verifiedCapability]
    )).rows).toEqual([{ state: 'consumed', projection_permitted: true }]);

    const invalidConstraints = await pool.query(
      `SELECT count(*)::int AS count
         FROM pg_constraint
        WHERE conrelid = 'homepage_demo_purge_operations'::regclass
          AND NOT convalidated`
    );
    expect(invalidConstraints.rows).toEqual([{ count: 0 }]);
    const bytes = fs.readFileSync(path.join(MIGRATIONS, RECEIPT_MIGRATION));
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes[bytes.length - 1]).toBe(0x0a);
    const migration = db.loadMigrations(MIGRATIONS).find(item => item.file === RECEIPT_MIGRATION);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(migration.digest);
    expect(await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect((await pool.query(
      'SELECT trim(checksum) AS checksum FROM _migrations WHERE filename = $1',
      [RECEIPT_MIGRATION]
    )).rows).toEqual([{ checksum: migration.digest }]);
  }, 60000);
});
