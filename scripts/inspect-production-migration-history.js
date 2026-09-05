'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;
const MAX_MIGRATIONS = 512;
const MAX_MIGRATION_BYTES = 8 * 1024 * 1024;

function canonicalBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('migration bytes must be a Buffer');
  if (bytes.length > MAX_MIGRATION_BYTES) throw new Error('migration source exceeds inspection bound');
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] !== 0x0a) throw new Error('migration contains a lone carriage return');
      crlf += 1;
      index += 1;
    } else if (bytes[index] === 0x0a) {
      lf += 1;
    }
  }
  if (crlf > 0 && lf > 0) throw new Error('migration contains mixed line endings');
  return crlf === 0 ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function sourceMigrations(directory = MIGRATIONS) {
  const names = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  if (names.length === 0 || names.length > MAX_MIGRATIONS) {
    throw new Error('migration source count is outside inspection bounds');
  }
  const ordinals = new Set();
  return names.map((filename) => {
    const match = MIGRATION_FILENAME.exec(filename);
    if (!match || ordinals.has(match[1])) throw new Error('migration source identity is invalid');
    ordinals.add(match[1]);
    const raw = fs.readFileSync(path.join(directory, filename));
    const canonical = canonicalBytes(raw);
    return Object.freeze({
      filename,
      bytes: raw.length,
      checksum: crypto.createHash('sha256').update(canonical).digest('hex'),
    });
  });
}

function reconcile(sources, appliedRows) {
  if (!Array.isArray(appliedRows) || appliedRows.length > MAX_MIGRATIONS) {
    throw new Error('applied migration count is outside inspection bounds');
  }
  const sourceByName = new Map(sources.map((item) => [item.filename, item]));
  const appliedByName = new Map();
  const duplicateApplied = [];
  for (const row of appliedRows) {
    const filename = String(row.filename || '');
    if (appliedByName.has(filename)) duplicateApplied.push(filename);
    appliedByName.set(filename, row.checksum === null ? null : String(row.checksum).trim());
  }
  const appliedWithoutSource = [...appliedByName.keys()]
    .filter((filename) => !sourceByName.has(filename)).sort();
  const mismatches = sources.flatMap((source) => {
    if (!appliedByName.has(source.filename)) return [];
    const recorded = appliedByName.get(source.filename);
    return recorded === source.checksum ? [] : [{
      filename: source.filename,
      recordedChecksum: recorded,
      sourceChecksum: source.checksum,
    }];
  });
  const pendingMigrations = sources
    .filter((source) => !appliedByName.has(source.filename))
    .map(({ filename, bytes, checksum }) => ({ filename, bytes, checksum }));
  return Object.freeze({
    appliedWithoutSource,
    duplicateApplied: [...new Set(duplicateApplied)].sort(),
    mismatches,
    pendingMigrations,
  });
}

async function inspect(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const sources = sourceMigrations();
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('railway') ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
    application_name: 'northstar_migration_history_inspector',
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    const metadata = (await client.query(`
      SELECT current_setting('server_version') AS pg_version,
             current_setting('TimeZone') AS timezone,
             pg_catalog.pg_encoding_to_char(database.encoding) AS encoding,
             database.datcollate AS collation,
             database.datctype AS ctype
        FROM pg_catalog.pg_database database
       WHERE database.datname = current_database()
    `)).rows[0];
    const applied = (await client.query(`
      SELECT filename, checksum
        FROM public._migrations
       ORDER BY filename
       LIMIT ${MAX_MIGRATIONS + 1}
    `)).rows;
    if (applied.length > MAX_MIGRATIONS) throw new Error('applied migration count exceeds inspection bound');
    await client.query('ROLLBACK');
    transactionOpen = false;
    const comparison = reconcile(sources, applied);
    return Object.freeze({
      pgVersion: metadata.pg_version,
      timezone: metadata.timezone,
      encoding: metadata.encoding,
      collation: metadata.collation,
      ctype: metadata.ctype,
      sourceMigrationCount: sources.length,
      appliedMigrationCount: applied.length,
      ...comparison,
    });
  } finally {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_) { /* best-effort read-only cleanup */ }
    }
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  inspect().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(() => {
    process.stderr.write('Production migration-history inspection failed.\n');
    process.exitCode = 1;
  });
}

module.exports = { canonicalBytes, sourceMigrations, reconcile, inspect };
