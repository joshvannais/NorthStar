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

const DEFAULT_MIGRATIONS_DIRECTORY = path.join(__dirname, '..', 'migrations');
const MIGRATION_LOCK_KEY = '5643944089238424905';
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;
const LEGACY_TRANSACTION_MIGRATIONS = Object.freeze({
  '001_initial_schema.sql': 'dbbcad4947474777a61a3b230aa8aca54b9a3ef4257301368e39731fa05307e9',
  '002_seed_data.sql': '4b124ac5713caaddc4f2316e8c055c6235eb17881c5b4ba5d0edef481a8a63ff',
  '003_voice_sessions.sql': 'd37d402df2792a015b6d1f9d3e0f72226298f9a4d9ec7551f629e52c677f41c2',
  '004_canonical_persistence_v2.sql': '946b1819dd4c5205637e9fae91f3b36c28c1688e401f1f2f5b67ffba7d2e1651',
  '005_canonical_organization_authority.sql': '4065d873dd204935cfbd8ea8abe45d2b0b44e80df38ef203359d2863d37c5379',
  '006_canonical_voice_sessions.sql': '236809d3b87367804bbd6c28ccaaca27408fa340020ab3d3b48e3e81da203ec2',
  '007_canonical_tax_authority.sql': 'a5f2c8c78fc339790f2993c997ea2cd50134a9ed97de93267cd470b18ea408a6',
  '008_canonical_demo_authority.sql': 'c157ac2c10f07bf933b4774ac14584ecc580f93108926b5e53acbfed28263ef2',
  '009_canonical_voice_provider_identity.sql': '6ec531dbb385607818c4a70ae69bab7f5d85ff98565d61ad8026c20ef68634fe',
});

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

function checksum(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function dollarQuoteAt(sql, offset) {
  if (sql[offset] !== '$') return null;
  const match = sql.slice(offset).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match ? match[0] : null;
}

function scanTopLevelStatements(sql) {
  const statements = [];
  let tokens = [];
  let index = 0;

  function addToken(value, start, end) {
    tokens.push({ value, start, end });
  }

  while (index < sql.length) {
    const character = sql[index];

    if ((index === 0 && character === '\uFEFF') || /\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }

    if (character === '/' && sql[index + 1] === '*') {
      let depth = 1;
      const start = index;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) throw new Error(`Unterminated SQL block comment at offset ${start}`);
      continue;
    }

    if (character === "'") {
      const start = index;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === '\\') {
          index += Math.min(2, sql.length - index);
        } else if (sql[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error(`Unterminated SQL string at offset ${start}`);
      addToken('<string>', start, index);
      continue;
    }

    if (character === '"') {
      const start = index;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
        } else if (sql[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error(`Unterminated SQL identifier at offset ${start}`);
      addToken('<identifier>', start, index);
      continue;
    }

    const dollarQuote = dollarQuoteAt(sql, index);
    if (dollarQuote) {
      const start = index;
      const closing = sql.indexOf(dollarQuote, index + dollarQuote.length);
      if (closing === -1) throw new Error(`Unterminated SQL dollar quote at offset ${start}`);
      index = closing + dollarQuote.length;
      addToken('<dollar-quote>', start, index);
      continue;
    }

    if (character === ';') {
      if (tokens.length > 0) {
        statements.push({
          start: tokens[0].start,
          end: index + 1,
          terminated: true,
          tokens: tokens.map(token => token.value),
        });
        tokens = [];
      }
      index += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index += 1;
      addToken(sql.slice(start, index).toUpperCase(), start, index);
      continue;
    }

    addToken(character, index, index + 1);
    index += 1;
  }

  if (tokens.length > 0) {
    statements.push({
      start: tokens[0].start,
      end: sql.length,
      terminated: false,
      tokens: tokens.map(token => token.value),
    });
  }
  return statements;
}

function isExactStatement(statement, keyword) {
  return Boolean(statement && statement.terminated &&
    statement.tokens.length === 1 && statement.tokens[0] === keyword);
}

function isTransactionControl(statement) {
  const first = statement && statement.tokens[0];
  if (['BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE'].includes(first)) {
    return true;
  }
  return first === 'PREPARE' && statement.tokens[1] === 'TRANSACTION' ||
    first === 'SET' && statement.tokens[1] === 'TRANSACTION';
}

function stripOuterTransaction(sql) {
  const source = String(sql);
  const statements = scanTopLevelStatements(source);
  const first = statements[0];
  const last = statements[statements.length - 1];
  const beginsTransaction = isExactStatement(first, 'BEGIN');
  const commitsTransaction = isExactStatement(last, 'COMMIT');

  if (beginsTransaction !== commitsTransaction) {
    throw new Error('Migration has an incomplete outer transaction envelope');
  }

  let body = source;
  let bodyStatements = statements;
  if (beginsTransaction) {
    if (statements.length < 2) throw new Error('Migration transaction envelope has no body');
    body = source.slice(0, first.start) + source.slice(first.end, last.start) + source.slice(last.end);
    bodyStatements = statements.slice(1, -1);
  }

  if (bodyStatements.some(isTransactionControl)) {
    throw new Error('Migration body contains top-level transaction control');
  }

  return {
    hadOuterTransaction: beginsTransaction,
    sql: body.replace(/^\uFEFF/, ''),
  };
}

function loadMigrations(migrationsDirectory) {
  if (!fs.existsSync(migrationsDirectory)) throw new Error('migrations directory is required');
  const files = fs.readdirSync(migrationsDirectory).filter(file => file.endsWith('.sql')).sort();
  const identities = new Set();

  return files.map(file => {
    const match = file.match(MIGRATION_FILENAME);
    if (!match) throw new Error(`Invalid migration filename: ${file}`);
    if (identities.has(match[1])) throw new Error(`Duplicate migration identity: ${match[1]}`);
    identities.add(match[1]);

    const contents = fs.readFileSync(path.join(migrationsDirectory, file));
    const digest = checksum(contents);
    const legacyDigest = LEGACY_TRANSACTION_MIGRATIONS[file];
    if (legacyDigest && digest !== legacyDigest) {
      throw new Error(`Protected legacy migration checksum mismatch: ${file}`);
    }

    const prepared = stripOuterTransaction(contents.toString('utf8'));
    if (legacyDigest && !prepared.hadOuterTransaction) {
      throw new Error(`Protected legacy migration envelope missing: ${file}`);
    }
    if (!legacyDigest && prepared.hadOuterTransaction) {
      throw new Error(`Migration must rely on the production transaction owner: ${file}`);
    }
    return { digest, file, sql: prepared.sql };
  });
}

async function runMigrations(options = {}) {
  const targetPool = options.pool || getPool();
  if (!targetPool) throw new Error('DATABASE_URL is required for PostgreSQL authority');
  const migrationsDirectory = options.migrationsDirectory || DEFAULT_MIGRATIONS_DIRECTORY;
  const migrations = loadMigrations(migrationsDirectory);
  const migrationNames = new Set(migrations.map(migration => migration.file));
  const appliedNow = [];
  const client = await targetPool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        checksum CHAR(64),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)');
    await client.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ');
    await client.query(`
      DO $migration_ledger$
      DECLARE
        applied_at_type REGTYPE;
      BEGIN
        SELECT attribute.atttypid::regtype
          INTO applied_at_type
          FROM pg_attribute attribute
         WHERE attribute.attrelid = 'public._migrations'::regclass
           AND attribute.attname = 'applied_at'
           AND NOT attribute.attisdropped;

        IF applied_at_type = 'timestamp without time zone'::regtype THEN
          ALTER TABLE _migrations
            ALTER COLUMN applied_at TYPE TIMESTAMPTZ
            USING applied_at AT TIME ZONE current_setting('TimeZone');
        ELSIF applied_at_type <> 'timestamp with time zone'::regtype THEN
          RAISE EXCEPTION 'Unsupported _migrations.applied_at type: %', applied_at_type;
        END IF;
      END
      $migration_ledger$
    `);
    await client.query('UPDATE _migrations SET applied_at = NOW() WHERE applied_at IS NULL');
    await client.query(`
      ALTER TABLE _migrations
        ALTER COLUMN applied_at SET DEFAULT NOW(),
        ALTER COLUMN applied_at SET NOT NULL
    `);

    const appliedResult = await client.query('SELECT filename, checksum FROM _migrations ORDER BY filename');
    const applied = new Map();
    for (const row of appliedResult.rows) {
      if (!migrationNames.has(row.filename)) {
        throw new Error(`Applied migration source is missing: ${row.filename}`);
      }
      if (applied.has(row.filename)) throw new Error(`Duplicate applied migration: ${row.filename}`);
      applied.set(row.filename, row.checksum === null ? null : String(row.checksum).trim());
    }

    for (const migration of migrations) {
      if (applied.has(migration.file)) {
        const recorded = applied.get(migration.file);
        if (recorded === null) {
          if (!LEGACY_TRANSACTION_MIGRATIONS[migration.file] ||
              LEGACY_TRANSACTION_MIGRATIONS[migration.file] !== migration.digest) {
            throw new Error(`Applied migration checksum is missing: ${migration.file}`);
          }
          const updated = await client.query(
            'UPDATE _migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL',
            [migration.file, migration.digest]
          );
          if (updated.rowCount !== 1) throw new Error(`Migration checksum backfill failed: ${migration.file}`);
        } else if (!/^[0-9a-f]{64}$/.test(recorded) || recorded !== migration.digest) {
          throw new Error(`Applied migration checksum mismatch: ${migration.file}`);
        }
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)',
        [migration.file, migration.digest]
      );
      appliedNow.push(migration.file);
    }

    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        // The original migration failure remains authoritative if the connection died.
      }
    }
    throw new Error(`Migration run failed: ${error.message}`);
  } finally {
    client.release();
  }

  for (const file of appliedNow) console.log(`[DB] Migration applied: ${file}`);
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
