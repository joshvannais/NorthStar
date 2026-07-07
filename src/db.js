/**
 * Database connection for Northstar Solutions.
 * Supports PostgreSQL via Railway's DATABASE_URL env var.
 * Falls back to simple in-memory storage when no DB is available.
 *
 * Implements V3-28 Database Architecture specification:
 * - Versioned SQL migrations in migrations/
 * - Connection pooling (pg-pool, max 20 connections)
 * - UUID primary keys, organization_id on all tenant tables
 * - Proper indexes on query access patterns
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;
let dbAvailable = false;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  try {
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('railway')
        ? { rejectUnauthorized: false }
        : false,
      // Connection management per V3-28 §7
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Pool error:', err.message);
    });
    return pool;
  } catch (err) {
    console.warn('[DB] Failed to create pool:', err.message);
    return null;
  }
}

/**
 * Run all pending SQL migrations from the migrations/ directory.
 * Migrations are run in filename order, wrapped in transactions.
 * Tracks completed migrations in a `_migrations` table.
 */
async function runMigrations() {
  const p = getPool();
  if (!p) return false;

  try {
    // Create migrations tracking table if it doesn't exist
    await p.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('[DB] No migrations directory found');
      return true;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const { rows: applied } = await p.query('SELECT filename FROM _migrations');
    const appliedSet = new Set(applied.map(r => r.filename));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[DB] Migration ${file} already applied, skipping`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`[DB] Running migration: ${file}...`);

      try {
        await p.query('BEGIN');
        await p.query(sql);
        await p.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await p.query('COMMIT');
        console.log(`[DB] Migration ${file} applied successfully`);
      } catch (err) {
        await p.query('ROLLBACK');
        console.error(`[DB] Migration ${file} failed:`, err.message);
        throw err;
      }
    }

    return true;
  } catch (err) {
    console.warn('[DB] Migration runner error:', err.message);
    return false;
  }
}

/**
 * Initialize the database — run migrations.
 */
async function initDatabase() {
  const p = getPool();
  if (!p) {
    console.log('[DB] No DATABASE_URL set — using in-memory/file storage');
    dbAvailable = false;
    return false;
  }

  try {
    // Test connection
    await p.query('SELECT 1');
    console.log('[DB] PostgreSQL connected');

    // Run migrations
    await runMigrations();

    console.log('[DB] PostgreSQL ready');
    dbAvailable = true;
    return true;
  } catch (err) {
    console.warn('[DB] PostgreSQL init failed:', err.message);
    console.log('[DB] Falling back to in-memory/file storage');
    dbAvailable = false;
    return false;
  }
}

/**
 * Check if database is available.
 */
function isAvailable() {
  return dbAvailable;
}

/**
 * Execute a query (if database is available).
 */
async function query(text, params) {
  const p = getPool();
  if (!p || !dbAvailable) return null;
  try {
    return await p.query(text, params);
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

module.exports = {
  initDatabase,
  isAvailable,
  query,
  getPool,
};