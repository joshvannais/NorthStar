'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../..');

function stripOuterTransaction(sql) {
  const normalized = String(sql).replace(/^\uFEFF/, '').trim();
  const match = normalized.match(/^BEGIN\s*;([\s\S]*)COMMIT\s*;\s*$/i);
  return match ? match[1].trim() : normalized;
}

async function applyLegacyMigrations(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )`);
    const files = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(file => /^00[1-9]_.*\.sql$/.test(file))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(stripOuterTransaction(sql));
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

async function initialize(connectionString) {
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = connectionString;
  jest.resetModules();
  const db = require('../../src/db');
  const ready = await db.initDatabase();
  await db.close();
  if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
  return ready;
}

async function schemaSnapshot(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const tables = [
      'users', 'organization_memberships', 'subscriptions', 'notification_preferences',
      'organization_account_preferences', 'organization_onboarding', 'auth_sessions',
      'auth_refresh_tokens', 'auth_rate_limits', 'admin_users',
    ];
    const columns = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable, COALESCE(column_default, '') AS column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position`,
      [tables]
    );
    const constraints = await client.query(
      `SELECT conrelid::regclass::text AS table_name, conname, contype, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid::regclass::text = ANY($1::text[])
        ORDER BY table_name, conname`,
      [tables]
    );
    const indexes = await client.query(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])
        ORDER BY tablename, indexname`,
      [tables]
    );
    return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
  } finally {
    await client.end();
  }
}

realPostgres('Account migration 010 fresh and upgrade safety', () => {
  const allocations = [];

  afterAll(async () => {
    for (const allocation of allocations) await allocation.cleanup();
  }, 60000);

  async function database(name) {
    const allocation = await createSuiteDatabase(name);
    allocations.push(allocation);
    return allocation;
  }

  test('fresh and pre-010 upgrade paths converge on the same account schema', async () => {
    const fresh = await database('account-fresh');
    const upgrade = await database('account-upgrade');
    expect(await initialize(fresh.connectionString)).toBe(true);
    await applyLegacyMigrations(upgrade.connectionString);
    expect(await initialize(upgrade.connectionString)).toBe(true);
    expect(await schemaSnapshot(upgrade.connectionString)).toEqual(await schemaSnapshot(fresh.connectionString));

    const client = new Client({ connectionString: upgrade.connectionString });
    await client.connect();
    try {
      const state = await client.query(
        `SELECT
           (SELECT count(*)::int FROM refresh_tokens WHERE revoked_at IS NULL) AS live_legacy_refresh,
           (SELECT status FROM admin_users WHERE email = 'admin@northstarsolutions.app') AS seeded_admin_status,
           (SELECT status FROM users WHERE id = '00000000-0000-0000-0000-000000000002') AS seeded_demo_status,
           (SELECT count(*)::int FROM _migrations WHERE checksum IS NULL) AS missing_checksums`
      );
      expect(state.rows[0]).toMatchObject({
        live_legacy_refresh: 0,
        seeded_admin_status: 'disabled',
        seeded_demo_status: 'disabled',
        missing_checksums: 0,
      });
    } finally {
      await client.end();
    }
  }, 120000);

  test('case-folding collisions abort atomically with a diagnostic and readiness stays false', async () => {
    const collision = await database('account-collision');
    await applyLegacyMigrations(collision.connectionString);
    const client = new Client({ connectionString: collision.connectionString });
    await client.connect();
    try {
      const organizationId = '71000000-0000-0000-0000-000000000001';
      await client.query("INSERT INTO organizations (id, name, email) VALUES ($1, 'Collision Org', 'collision-org@example.test')", [organizationId]);
      await client.query(
        `INSERT INTO users (organization_id, name, email, password_hash, role, status) VALUES
          ($1, 'First', 'Collision@Example.Test', 'not-used', 'owner', 'active'),
          ($1, 'Second', 'collision@example.test', 'not-used', 'member', 'active')`,
        [organizationId]
      );
    } finally {
      await client.end();
    }

    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await initialize(collision.connectionString)).toBe(false);
    expect(JSON.stringify(errorLog.mock.calls)).toContain('account email normalization collision');
    errorLog.mockRestore();

    const verifier = new Client({ connectionString: collision.connectionString });
    await verifier.connect();
    try {
      expect((await verifier.query("SELECT count(*)::int AS count FROM _migrations WHERE filename = '010_account_session_authority.sql'")).rows[0].count).toBe(0);
      expect((await verifier.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_normalized'")).rows[0].count).toBe(0);
    } finally {
      await verifier.end();
    }
  }, 120000);
});
