/**
 * Database connection for Northstar Solutions.
 * Supports PostgreSQL via Railway's DATABASE_URL env var.
 * Falls back to simple in-memory storage when no DB is available
 * (so the app still runs during development).
 */

const { Pool } = require('pg');

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
    });
    return pool;
  } catch (err) {
    console.warn('[DB] Failed to create pool:', err.message);
    return null;
  }
}

/**
 * Initialize the database — create tables if needed.
 */
async function initDatabase() {
  const p = getPool();
  if (!p) {
    console.log('[DB] No DATABASE_URL set — using in-memory storage');
    dbAvailable = false;
    return false;
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        business_name VARCHAR(255) DEFAULT '',
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(50) DEFAULT '',
        password_hash VARCHAR(255) NOT NULL,
        plan_type VARCHAR(50) DEFAULT 'Trial',
        status VARCHAR(50) DEFAULT 'trial',
        signup_date TIMESTAMP DEFAULT NOW(),
        trial_ends TIMESTAMP DEFAULT NOW() + INTERVAL '14 days',
        last_payment_date TIMESTAMP,
        payment_status VARCHAR(50) DEFAULT 'none',
        forwarding_number VARCHAR(50) DEFAULT '',
        ai_active BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS payment_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'paid',
        period VARCHAR(7),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('[DB] PostgreSQL connected and tables ready');
    dbAvailable = true;
    return true;
  } catch (err) {
    console.warn('[DB] PostgreSQL init failed:', err.message);
    console.log('[DB] Falling back to in-memory storage');
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