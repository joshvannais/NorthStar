'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const OUTBOX_MIGRATION = '019_account_email_outbox.sql';

function migrationFiles(directory) {
  return fs.readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

function copyMigrations(destination, filter = () => true) {
  for (const filename of migrationFiles(MIGRATIONS).filter(filter)) {
    fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(destination, filename));
  }
}

async function rawDigest(pool, table, order) {
  const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
  return crypto.createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

describe('Mission 20 Phase 7 Lane 2 account email migration authority', () => {
  let freshDatabase;
  let upgradeDatabase;
  let freshPool;
  let upgradePool;
  let preOutboxDirectory;
  let tamperedDirectory;
  let db;

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for Phase 7 Lane 2 migration tests');
    }
    freshDatabase = await createSuiteDatabase('m20 lane2 migration fresh');
    upgradeDatabase = await createSuiteDatabase('m20 lane2 migration upgrade');
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 4 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 4 });
    preOutboxDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-lane2-pre019-'));
    tamperedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-lane2-tampered019-'));
    copyMigrations(preOutboxDirectory, filename => filename !== OUTBOX_MIGRATION);
    copyMigrations(tamperedDirectory);
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: preOutboxDirectory })).toBe(true);
  }, 60000);

  afterAll(async () => {
    try {
      if (freshPool) await freshPool.end();
      if (upgradePool) await upgradePool.end();
    } finally {
      for (const directory of [preOutboxDirectory, tamperedDirectory]) {
        if (directory && path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
    }
  }, 60000);

  test('fresh PG18.4 UTC/checksum schema is exact, validated, bounded, and LF source-sealed', async () => {
    const identity = (await freshPool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums,
              current_setting('listen_addresses') AS listen_addresses,
              inet_server_port() AS port`
    )).rows[0];
    expect(identity).toEqual({
      version: '18.4', timezone: 'UTC', checksums: 'on', listen_addresses: '127.0.0.1',
      port: Number(process.env.M19_EXPECTED_PG_PORT),
    });

    const bytes = fs.readFileSync(path.join(MIGRATIONS, OUTBOX_MIGRATION));
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes[bytes.length - 1]).toBe(0x0a);
    const migration = db.loadMigrations(MIGRATIONS).find(item => item.file === OUTBOX_MIGRATION);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(migration.digest);

    const columns = (await freshPool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'account_email_outbox'
        ORDER BY ordinal_position`
    )).rows.map(row => row.column_name);
    expect(columns).toEqual([
      'id', 'user_id', 'organization_id', 'purpose', 'recipient', 'raw_token', 'state',
      'attempt_count', 'available_at', 'claimed_at', 'claim_token', 'lease_expires_at',
      'delivered_at', 'dead_at', 'last_error_category', 'created_at', 'updated_at',
    ]);
    const catalog = (await freshPool.query(
      `SELECT
         (SELECT count(*)::int FROM pg_constraint
           WHERE connamespace = 'public'::regnamespace
             AND (conname LIKE 'account_email_outbox_%'
                  OR conname = 'account_action_tokens_outbox_identity')
             AND NOT convalidated) AS invalid_constraints,
         (SELECT count(*)::int FROM pg_index index_record
           JOIN pg_class table_record ON table_record.oid = index_record.indrelid
          WHERE table_record.relname = 'account_email_outbox'
            AND (NOT index_record.indisvalid OR NOT index_record.indisready)) AS invalid_indexes`
    )).rows[0];
    expect(catalog).toEqual({ invalid_constraints: 0, invalid_indexes: 0 });
    expect((await freshPool.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'account_email_outbox'
        ORDER BY indexname`
    )).rows.map(row => row.indexname)).toEqual([
      'account_email_outbox_available',
      'account_email_outbox_expired_claims',
      'account_email_outbox_pkey',
      'account_email_outbox_user_purpose',
    ]);
  });

  test('upgrade preserves pre-019 authority, adds no invented delivery, and reruns checksum-exact', async () => {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update('retained-login-email').digest('hex');
    await upgradePool.query(
      "INSERT INTO organizations (id, name, email) VALUES ($1, 'Lane 2 Upgrade', 'lane2-upgrade@example.test')",
      [organizationId]
    );
    await upgradePool.query(
      `INSERT INTO users
         (id, organization_id, name, email, email_normalized, password_hash, role, status)
       VALUES ($1,$2,'Upgrade Owner','lane2-upgrade@example.test','lane2-upgrade@example.test',
               'retained-hash','owner','pending_verification')`,
      [userId, organizationId]
    );
    await upgradePool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$1,'owner','active')`,
      [userId, organizationId]
    );
    await upgradePool.query(
      `INSERT INTO account_action_tokens
         (id, user_id, organization_id, purpose, token_hash, expires_at)
       VALUES ($1,$2,$3,'email_verification',$4,NOW() + INTERVAL '1 day')`,
      [tokenId, userId, organizationId, crypto.createHash('sha256').update('retained-token').digest('hex')]
    );
    await upgradePool.query(
      `INSERT INTO auth_rate_limits
         (event_type, key_hash, window_started_at, attempt_count, blocked_until)
       VALUES ('login_email',$1,NOW(),4,NOW() + INTERVAL '5 minutes')`,
      [keyHash]
    );
    const before = {
      organizations: await rawDigest(upgradePool, 'organizations', 'id'),
      users: await rawDigest(upgradePool, 'users', 'id'),
      memberships: await rawDigest(upgradePool, 'organization_memberships', 'organization_id, user_id'),
      tokens: await rawDigest(upgradePool, 'account_action_tokens', 'id'),
      rateLimits: await rawDigest(upgradePool, 'auth_rate_limits', 'event_type, key_hash'),
    };
    expect((await upgradePool.query(
      "SELECT to_regclass('public.account_email_outbox') AS authority"
    )).rows).toEqual([{ authority: null }]);

    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect({
      organizations: await rawDigest(upgradePool, 'organizations', 'id'),
      users: await rawDigest(upgradePool, 'users', 'id'),
      memberships: await rawDigest(upgradePool, 'organization_memberships', 'organization_id, user_id'),
      tokens: await rawDigest(upgradePool, 'account_action_tokens', 'id'),
      rateLimits: await rawDigest(upgradePool, 'auth_rate_limits', 'event_type, key_hash'),
    }).toEqual(before);
    expect((await upgradePool.query('SELECT count(*)::int AS count FROM account_email_outbox')).rows)
      .toEqual([{ count: 0 }]);
    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: MIGRATIONS })).toBe(true);
    const migration = db.loadMigrations(MIGRATIONS).find(item => item.file === OUTBOX_MIGRATION);
    expect((await upgradePool.query(
      'SELECT trim(checksum) AS checksum FROM _migrations WHERE filename = $1',
      [OUTBOX_MIGRATION]
    )).rows).toEqual([{ checksum: migration.digest }]);
  }, 60000);

  test('fixed negative controls reject cross-token identity and invalid bounded lifecycle states', async () => {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const recipient = 'lane2-negative@example.test';
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await freshPool.query(
      "INSERT INTO organizations (id, name, email) VALUES ($1, 'Lane 2 Negative', $2)",
      [organizationId, recipient]
    );
    for (const [id, email] of [[userId, recipient], [otherUserId, 'lane2-other@example.test']]) {
      await freshPool.query(
        `INSERT INTO users
           (id, organization_id, name, email, email_normalized, password_hash, role, status)
         VALUES ($1,$2,'Negative User',$3,$3,'not-used','owner','active')`,
        [id, organizationId, email]
      );
      await freshPool.query(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
         VALUES ($1,$2,$1,'owner','active')`,
        [id, organizationId]
      );
    }
    await freshPool.query(
      `INSERT INTO account_action_tokens
         (id, user_id, organization_id, purpose, token_hash, expires_at)
       VALUES ($1,$2,$3,'email_verification',$4,NOW() + INTERVAL '1 day')`,
      [tokenId, userId, organizationId, crypto.createHash('sha256').update(rawToken).digest('hex')]
    );
    const insert = (overrides = {}) => freshPool.query(
      `INSERT INTO account_email_outbox
         (id, user_id, organization_id, purpose, recipient, raw_token,
          state, attempt_count, claimed_at, claim_token, lease_expires_at,
          delivered_at, dead_at, last_error_category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        tokenId,
        overrides.userId || userId,
        organizationId,
        overrides.purpose || 'email_verification',
        overrides.recipient || recipient,
        overrides.rawToken === undefined ? rawToken : overrides.rawToken,
        overrides.state || 'pending',
        overrides.attemptCount === undefined ? 0 : overrides.attemptCount,
        overrides.claimedAt || null,
        overrides.claimToken || null,
        overrides.leaseExpiresAt || null,
        overrides.deliveredAt || null,
        overrides.deadAt || null,
        overrides.category || null,
      ]
    );
    await expect(insert({ userId: otherUserId })).rejects.toMatchObject({
      code: '23503', constraint: 'account_email_outbox_token_identity_fk',
    });
    await expect(insert({ purpose: 'password_reset' })).rejects.toMatchObject({
      code: '23503', constraint: 'account_email_outbox_token_identity_fk',
    });
    await expect(insert({ recipient: 'UPPER@example.test' })).rejects.toMatchObject({
      code: '23514', constraint: 'account_email_outbox_recipient_check',
    });
    await expect(insert({ rawToken: 'not-a-token' })).rejects.toMatchObject({
      code: '23514', constraint: 'account_email_outbox_token_check',
    });
    await expect(insert({ state: 'claimed' })).rejects.toMatchObject({
      code: '23514', constraint: 'account_email_outbox_lifecycle_check',
    });
    await expect(insert({ attemptCount: 6 })).rejects.toMatchObject({
      code: '23514', constraint: 'account_email_outbox_attempt_check',
    });
    await expect(insert({ category: 'unsafe detail' })).rejects.toMatchObject({
      code: '23514', constraint: 'account_email_outbox_error_check',
    });
    await insert();
    await expect(freshPool.query(
      "UPDATE account_email_outbox SET state = 'delivered', delivered_at = NOW() WHERE id = $1",
      [tokenId]
    )).rejects.toMatchObject({ code: '23514', constraint: 'account_email_outbox_lifecycle_check' });
  });

  test('an altered applied migration is rejected by the immutable checksum ledger', async () => {
    fs.appendFileSync(path.join(tamperedDirectory, OUTBOX_MIGRATION), '-- fixed negative checksum control\n');
    await expect(db.runMigrations({ pool: freshPool, migrationsDirectory: tamperedDirectory }))
      .rejects.toThrow(/checksum mismatch/i);
  });
});
