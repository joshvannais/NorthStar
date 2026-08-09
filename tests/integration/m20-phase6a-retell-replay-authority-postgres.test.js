'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

function digest(label) {
  return crypto.createHash('sha256').update(label).digest('hex');
}

realPostgres('Mission 20 Phase 6A durable Retell replay authority', () => {
  let freshDatabase;
  let upgradeDatabase;
  let pool;
  let upgradePool;
  let preReplayDirectory;
  let db;
  let authority;

  beforeAll(async () => {
    freshDatabase = await createSuiteDatabase('m20-phase6a-replay-fresh');
    upgradeDatabase = await createSuiteDatabase('m20-phase6a-replay-upgrade');
    pool = new Pool({ connectionString: freshDatabase.connectionString, max: 12 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 4 });
    preReplayDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-phase6a-pre017-'));
    for (const filename of fs.readdirSync(MIGRATIONS)
      .filter(name => /^\d+.*\.sql$/.test(name) && name !== '017_retell_webhook_replay_authority.sql')) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preReplayDirectory, filename));
    }
    jest.resetModules();
    db = require('../../src/db');
    await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS });
    authority = require('../../src/retell/webhookReplayAuthority');
  }, 60000);

  afterAll(async () => {
    try {
      if (pool) await pool.end();
      if (upgradePool) await upgradePool.end();
    } finally {
      if (preReplayDirectory && path.resolve(preReplayDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preReplayDirectory, { recursive: true, force: true });
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
    }
  }, 60000);

  test('fresh schema is exact, bounded, non-tenant, and contains no request/provider material', async () => {
    const identity = await pool.query(
      `SELECT current_setting('server_version_num')::int AS version_num,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums,
              current_setting('listen_addresses') AS listen_addresses,
              inet_server_port() AS port`
    );
    expect(Math.floor(identity.rows[0].version_num / 10000)).toBe(18);
    expect(identity.rows[0]).toMatchObject({
      timezone: 'UTC', checksums: 'on', listen_addresses: '127.0.0.1',
      port: Number(process.env.M19_EXPECTED_PG_PORT),
    });

    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'retell_webhook_replay_claims'
        ORDER BY ordinal_position`
    );
    expect(columns.rows.map(row => row.column_name)).toEqual([
      'request_fingerprint', 'state', 'claim_token', 'claimed_at', 'lease_expires_at',
      'accepted_at', 'expires_at', 'created_at', 'updated_at',
    ]);
    expect(columns.rows.map(row => row.column_name).join('|')).not.toMatch(
      /organization|tenant|payload|body|signature|timestamp|api|key|agent|call|phone|provider/i
    );
    const catalog = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM retell_webhook_replay_claims) AS rows,
         (SELECT count(*)::int FROM pg_constraint
           WHERE connamespace = 'public'::regnamespace
             AND conname LIKE 'retell_webhook_replay_%' AND NOT convalidated) AS invalid_constraints,
         (SELECT count(*)::int FROM pg_index index_record
           JOIN pg_class table_record ON table_record.oid = index_record.indrelid
          WHERE table_record.relname = 'retell_webhook_replay_claims'
            AND (NOT index_record.indisvalid OR NOT index_record.indisready)) AS invalid_indexes`
    );
    expect(catalog.rows).toEqual([{ rows: 0, invalid_constraints: 0, invalid_indexes: 0 }]);
  });

  test('upgrade creates empty authority, preserves existing data, and reruns checksum-exact', async () => {
    await db.runMigrations({ pool: upgradePool, migrationsDirectory: preReplayDirectory });
    const organization = '67000000-0000-4000-8000-000000000001';
    await upgradePool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Replay Upgrade Control', 'replay-upgrade@example.test')`,
      [organization]
    );
    expect((await upgradePool.query(
      "SELECT to_regclass('public.retell_webhook_replay_claims') AS authority"
    )).rows).toEqual([{ authority: null }]);

    await db.runMigrations({ pool: upgradePool, migrationsDirectory: MIGRATIONS });
    expect((await upgradePool.query('SELECT id, name FROM organizations WHERE id = $1', [organization])).rows)
      .toEqual([{ id: organization, name: 'Replay Upgrade Control' }]);
    expect((await upgradePool.query('SELECT count(*)::int AS count FROM retell_webhook_replay_claims')).rows)
      .toEqual([{ count: 0 }]);
    await db.runMigrations({ pool: upgradePool, migrationsDirectory: MIGRATIONS });
    const migration = db.loadMigrations(MIGRATIONS)
      .find(item => item.file === '017_retell_webhook_replay_authority.sql');
    expect((await upgradePool.query(
      `SELECT trim(checksum) AS checksum FROM _migrations
        WHERE filename = '017_retell_webhook_replay_authority.sql'`
    )).rows).toEqual([{ checksum: migration.digest }]);
  }, 60000);

  test('one atomic claim wins, acceptance survives a new caller, and token ownership is enforced', async () => {
    const fingerprint = digest('phase6a-atomic-claim');
    const outcomes = await Promise.all([
      authority.claimWebhookDelivery({ requestFingerprint: fingerprint }, { pool }),
      authority.claimWebhookDelivery({ requestFingerprint: fingerprint }, { pool }),
    ]);
    expect(outcomes.map(outcome => outcome.kind).sort()).toEqual(['claimed', 'replay']);
    const winner = outcomes.find(outcome => outcome.kind === 'claimed');
    expect(await authority.releaseWebhookDelivery({
      requestFingerprint: fingerprint,
      claimToken: crypto.randomUUID(),
    }, { pool })).toBe(false);
    expect(await authority.acceptWebhookDelivery({
      requestFingerprint: fingerprint,
      claimToken: winner.claimToken,
    }, { pool })).toBe(true);
    expect(await authority.claimWebhookDelivery({ requestFingerprint: fingerprint }, { pool }))
      .toEqual({ kind: 'replay' });
    const retained = await pool.query(
      `SELECT state, lease_expires_at IS NULL AS lease_cleared,
              accepted_at IS NOT NULL AS accepted,
              expires_at > accepted_at + INTERVAL '23 hours 59 minutes' AS retained
         FROM retell_webhook_replay_claims WHERE request_fingerprint = $1`,
      [fingerprint]
    );
    expect(retained.rows).toEqual([{
      state: 'accepted', lease_cleared: true, accepted: true, retained: true,
    }]);
  });

  test('expired authority is cleaned and a stale in-flight lease is safely taken over', async () => {
    const expired = digest('phase6a-expired');
    await pool.query(
      `INSERT INTO retell_webhook_replay_claims
        (request_fingerprint, state, claim_token, claimed_at, accepted_at, expires_at)
       VALUES ($1, 'accepted', gen_random_uuid(), NOW() - INTERVAL '25 hours',
               NOW() - INTERVAL '25 hours', NOW() - INTERVAL '1 hour')`,
      [expired]
    );
    const freshFingerprint = digest('phase6a-after-cleanup');
    const fresh = await authority.claimWebhookDelivery({ requestFingerprint: freshFingerprint }, { pool });
    expect(fresh.kind).toBe('claimed');
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM retell_webhook_replay_claims WHERE request_fingerprint = $1',
      [expired]
    )).rows).toEqual([{ count: 0 }]);
    expect(await authority.releaseWebhookDelivery({
      requestFingerprint: freshFingerprint, claimToken: fresh.claimToken,
    }, { pool })).toBe(true);

    const staleFingerprint = digest('phase6a-stale-lease');
    const stale = await authority.claimWebhookDelivery({ requestFingerprint: staleFingerprint }, { pool });
    await pool.query(
      `UPDATE retell_webhook_replay_claims
          SET claimed_at = NOW() - INTERVAL '2 minutes',
              lease_expires_at = NOW() - INTERVAL '1 minute'
        WHERE request_fingerprint = $1`,
      [staleFingerprint]
    );
    const takeover = await authority.claimWebhookDelivery({ requestFingerprint: staleFingerprint }, { pool });
    expect(takeover.kind).toBe('claimed');
    expect(takeover.claimToken).not.toBe(stale.claimToken);
    expect(await authority.releaseWebhookDelivery({
      requestFingerprint: staleFingerprint, claimToken: stale.claimToken,
    }, { pool })).toBe(false);
    expect(await authority.releaseWebhookDelivery({
      requestFingerprint: staleFingerprint, claimToken: takeover.claimToken,
    }, { pool })).toBe(true);
  });

  test('the exact 10000-live-row cap fails closed without eviction or mutation', async () => {
    const marker = new Date('2040-01-01T00:00:00.000Z');
    const existing = (await pool.query('SELECT count(*)::int AS count FROM retell_webhook_replay_claims')).rows[0].count;
    await pool.query(
      `INSERT INTO retell_webhook_replay_claims
        (request_fingerprint, state, claim_token, claimed_at, accepted_at, expires_at)
       SELECT md5('phase6a-capacity-a-' || value::text) || md5('phase6a-capacity-b-' || value::text),
              'accepted', gen_random_uuid(), $1::timestamptz, $1::timestamptz,
              $1::timestamptz + INTERVAL '24 hours'
         FROM generate_series(1, $2) value`,
      [marker, authority.MAX_REPLAY_ENTRIES - existing]
    );
    const before = await pool.query(
      `SELECT count(*)::int AS count,
              md5(string_agg(to_jsonb(row_value)::text, '|' ORDER BY request_fingerprint)) AS hash
         FROM retell_webhook_replay_claims row_value`
    );
    expect(before.rows[0].count).toBe(authority.MAX_REPLAY_ENTRIES);
    expect(await authority.claimWebhookDelivery({
      requestFingerprint: digest('phase6a-capacity-overflow'),
    }, { pool })).toEqual({ kind: 'saturated' });
    expect((await pool.query(
      `SELECT count(*)::int AS count,
              md5(string_agg(to_jsonb(row_value)::text, '|' ORDER BY request_fingerprint)) AS hash
         FROM retell_webhook_replay_claims row_value`
    )).rows).toEqual(before.rows);
    await pool.query('DELETE FROM retell_webhook_replay_claims WHERE accepted_at = $1', [marker]);
  }, 60000);

  test('fingerprints are stable, domain-separated, and input validation fails before PostgreSQL', async () => {
    const raw = Buffer.from('{"event":"ping"}', 'utf8');
    const fingerprint = authority.requestFingerprint(raw);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toBe(crypto.createHash('sha256').update(raw).digest('hex'));
    expect(() => authority.requestFingerprint(raw.toString('utf8'))).toThrow('rawBody must be a Buffer');
    await expect(authority.claimWebhookDelivery({ requestFingerprint: 'not-a-hash' }, { pool }))
      .rejects.toThrow('requestFingerprint must be a lowercase SHA-256 digest');
  });
});
