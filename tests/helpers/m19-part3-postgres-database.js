'use strict';

const crypto = require('crypto');
const { Client } = require('pg');

let allocationSequence = 0;

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function slug(value, maximum) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.slice(0, maximum) || 'missing';
}

function quotedIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function adminConfiguration() {
  const raw = process.env.M19_PG_ADMIN_URL;
  const expectedDataDirectory = process.env.M19_EXPECTED_PG_DATA_DIR;
  const expectedPort = Number(process.env.M19_EXPECTED_PG_PORT);
  const runId = process.env.M19_TEST_RUN_ID;
  if (!raw || !expectedDataDirectory || !runId || !Number.isInteger(expectedPort)) {
    throw new Error('M19 disposable PostgreSQL identity environment is incomplete');
  }
  const parsed = new URL(raw);
  const port = Number(parsed.port || 5432);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1' ||
      port === 5432 || port !== expectedPort || parsed.pathname.replace(/^\//, '') !== 'postgres') {
    throw new Error('M19 PostgreSQL admin URL is not the approved loopback maintenance database');
  }
  return { raw, parsed, expectedDataDirectory, expectedPort, runId };
}

async function verifyDisposableServer(client, configuration) {
  const result = await client.query(
    `SELECT current_database() AS database,
            current_setting('data_directory') AS data_directory,
            current_setting('port')::int AS port,
            current_setting('listen_addresses') AS listen_addresses,
            host(inet_server_addr()) AS server_address`
  );
  const identity = result.rows[0];
  if (identity.database !== 'postgres' || identity.port !== configuration.expectedPort ||
      identity.listen_addresses !== '127.0.0.1' || identity.server_address !== '127.0.0.1' ||
      normalizedPath(identity.data_directory) !== normalizedPath(configuration.expectedDataDirectory)) {
    throw new Error('M19 disposable PostgreSQL server identity mismatch');
  }
  return identity;
}

function databaseUrl(configuration, databaseName) {
  const parsed = new URL(configuration.parsed.toString());
  parsed.pathname = '/' + databaseName;
  return parsed.toString();
}

async function createSuiteDatabase(suiteName) {
  const configuration = adminConfiguration();
  const run = slug(configuration.runId, 12);
  const suite = slug(suiteName, 18);
  const worker = slug(process.env.JEST_WORKER_ID || 'standalone', 6);
  allocationSequence += 1;
  const suffix = crypto.createHash('sha256').update([
    configuration.runId, suiteName, worker, process.pid, allocationSequence,
  ].join('|')).digest('hex').slice(0, 8);
  const databaseName = `northstar_m19_${run}_${suite}_w${worker}_p${process.pid}_${allocationSequence}_${suffix}`.slice(0, 63);
  const requiredPrefix = `northstar_m19_${run}_${suite}_w${worker}_p${process.pid}_`;
  if (!databaseName.startsWith(requiredPrefix) || databaseName === 'postgres') {
    throw new Error('Unsafe M19 suite database identity');
  }

  const admin = new Client({ connectionString: configuration.raw });
  await admin.connect();
  try {
    await verifyDisposableServer(admin, configuration);
    await admin.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }

  let cleaned = false;
  return {
    databaseName,
    connectionString: databaseUrl(configuration, databaseName),
    identity: { run: configuration.runId, suite: suiteName, worker, processId: process.pid },
    async cleanup() {
      if (cleaned) return;
      if (!databaseName.startsWith(requiredPrefix) || databaseName === 'postgres') {
        throw new Error('Refusing unsafe M19 suite database cleanup');
      }
      const cleanupAdmin = new Client({ connectionString: configuration.raw });
      await cleanupAdmin.connect();
      try {
        await verifyDisposableServer(cleanupAdmin, configuration);
        await cleanupAdmin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [databaseName]
        );
        await cleanupAdmin.query(`DROP DATABASE ${quotedIdentifier(databaseName)}`);
        cleaned = true;
      } finally {
        await cleanupAdmin.end();
      }
    },
  };
}

module.exports = { createSuiteDatabase };
