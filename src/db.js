/**
 * PostgreSQL lifecycle and migration authority.
 *
 * A configured database is either fully migrated and ready or unavailable.
 * Authenticated/account traffic never falls back to files or process memory.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;
let dbAvailable = false;
let readinessFailure = null;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('railway') ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (error) => {
    dbAvailable = false;
    readinessFailure = 'postgres_pool_error';
    console.error('[DB] Pool error:', error.message);
  });
  return pool;
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function stripOuterTransaction(sql) {
  const normalized = String(sql).replace(/^\uFEFF/, '').trim();
  const match = normalized.match(/^BEGIN\s*;([\s\S]*)COMMIT\s*;\s*$/i);
  return match ? match[1].trim() : normalized;
}

async function runMigrations() {
  const targetPool = getPool();
  if (!targetPool) throw new Error('DATABASE_URL is required for PostgreSQL authority');

  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      checksum CHAR(64),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await targetPool.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)');

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) throw new Error('migrations directory is required');

  const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
  const appliedResult = await targetPool.query('SELECT filename, checksum FROM _migrations');
  const applied = new Map(appliedResult.rows.map(row => [row.filename, row.checksum]));

  for (const file of files) {
    const rawSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const digest = checksum(rawSql);
    if (applied.has(file)) {
      const recorded = applied.get(file);
      if (recorded && recorded !== digest) {
        throw new Error(`Applied migration checksum mismatch: ${file}`);
      }
      if (!recorded) {
        await targetPool.query(
          'UPDATE _migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL',
          [file, digest]
        );
      }
      continue;
    }

    const client = await targetPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(stripOuterTransaction(rawSql));
      await client.query(
        'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)',
        [file, digest]
      );
      await client.query('COMMIT');
      console.log(`[DB] Migration applied: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }

  return true;
}

async function initDatabase() {
  dbAvailable = false;
  readinessFailure = null;
  const targetPool = getPool();
  if (!targetPool) {
    readinessFailure = 'database_url_missing';
    return false;
  }

  try {
    await targetPool.query('SELECT 1');
    await runMigrations();
    dbAvailable = true;
    return true;
  } catch (error) {
    readinessFailure = 'postgres_initialization_failed';
    console.error('[DB] PostgreSQL initialization failed:', error.message);
    dbAvailable = false;
    return false;
  }
}

function isAvailable() {
  return dbAvailable;
}

function readiness() {
  return Object.freeze({ ready: dbAvailable, failure: readinessFailure });
}

async function query(text, params) {
  const targetPool = getPool();
  if (!targetPool || !dbAvailable) return null;
  return targetPool.query(text, params);
}

async function close() {
  const targetPool = pool;
  pool = null;
  dbAvailable = false;
  readinessFailure = null;
  if (targetPool) await targetPool.end();
}

function resetForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('resetForTests is test-only');
  pool = null;
  dbAvailable = false;
  readinessFailure = null;
}

module.exports = {
  close,
  getPool,
  initDatabase,
  isAvailable,
  query,
  readiness,
  resetForTests,
  runMigrations,
  stripOuterTransaction,
};
