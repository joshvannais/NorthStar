'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrationDir = path.resolve(__dirname, '../../migrations');
const migrations = [
  '001_initial_schema.sql', '002_seed_data.sql', '003_voice_sessions.sql',
  '004_canonical_persistence_v2.sql', '005_canonical_organization_authority.sql',
];
const ORG_A = '00000000-0000-0000-0000-000000000001';

function graphInput() {
  return {
    tenantContext: { organizationId: ORG_A, trusted: true },
    idempotencyKey: 'checked-client-termination',
    sourceVersion: 'termination-probe-v1',
    external: { callId: 'termination-call' },
    customer: { name: 'Termination Probe', phone: '+15555551300', email: 'termination@example.test' },
    transcript: [{ turnId: 'turn-1', speaker: 'customer', text: 'I need a general service estimate.' }],
    facts: [],
    service: { key: 'general', scope: {} },
  };
}

function waitForMessage(child, type) {
  return new Promise(function (resolve, reject) {
    const onMessage = function (message) {
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.code));
      } else if (message.type === type) {
        cleanup();
        resolve(message);
      }
    };
    const onExit = function (code) {
      cleanup();
      reject(new Error('termination worker exited early: ' + code));
    };
    function cleanup() {
      child.off('message', onMessage);
      child.off('exit', onExit);
    }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

async function activeTranscriptInsert(pool) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT pid, query FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND query LIKE 'INSERT INTO canonical_transcripts%'`
    );
    if (result.rows.length) return result.rows[0];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('checked-out transcript insert was not observed');
}

realPostgres('Persistence V2 checked-out client termination containment', () => {
  let suiteDatabase;
  let pool;
  let child;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('client-termination');
    pool = new Pool({ connectionString: suiteDatabase.connectionString, max: 8 });
    for (const migration of migrations) {
      await pool.query(fs.readFileSync(path.join(migrationDir, migration), 'utf8'));
    }
    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      profile: {
        company: { currency: 'USD' }, headquarters: {}, scheduling: {}, services: [],
        crew: { defaultCrewSize: 2, averageHourlyRate: 42, overtimeMultiplier: 1.5 },
        financial: { markup: 1.3, emergencyMarkup: 1.5, travelCharge: 0.58 },
      },
    });
  }, 30000);

  afterAll(async () => {
    try {
      if (child && child.connected) {
        const closed = waitForMessage(child, 'closed');
        child.send({ type: 'close' });
        await closed;
      }
      if (pool) await pool.end();
    } finally {
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('real pg_terminate_backend cannot kill Node and a later retry creates exactly one graph', async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION m19_delay_canonical_transcript()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_sleep(10);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER m19_delay_canonical_transcript_trigger
        BEFORE INSERT ON canonical_transcripts
        FOR EACH ROW EXECUTE FUNCTION m19_delay_canonical_transcript();
    `);

    child = fork(path.resolve(__dirname, '../helpers/m19-part3-client-termination-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, M19_CLIENT_TERMINATION_DATABASE_URL: suiteDatabase.connectionString },
      silent: true,
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const firstMessage = waitForMessage(child, 'first');
    child.send({ type: 'run', input: graphInput() });
    const active = await activeTranscriptInsert(pool);
    const terminated = await pool.query('SELECT pg_terminate_backend($1) AS terminated', [active.pid]);
    expect(terminated.rows[0].terminated).toBe(true);

    const first = await firstMessage;
    expect(first.processId).toBe(child.pid);
    expect(first.healthy).toBe(1);
    expect(first.result).toMatchObject({
      status: 503,
      body: { error: { code: 'RETRYABLE_GRAPH_FAILURE' } },
    });
    expect(child.exitCode).toBeNull();
    expect(stderr).not.toMatch(/uncaught|Unhandled 'error' event/i);

    const failed = await pool.query(
      `SELECT id, state, safe_error_code FROM canonical_operations
        WHERE organization_id = $1 AND idempotency_key_hash IS NOT NULL`,
      [ORG_A]
    );
    expect(failed.rows).toHaveLength(1);
    expect(failed.rows[0].state).toBe('retryable_failed');
    const partial = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM canonical_customers WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_transcripts WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_communications WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_opportunities WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_estimates WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_appointments WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_polaris_snapshots WHERE operation_id = $1) AS count`,
      [failed.rows[0].id]
    );
    expect(partial.rows[0].count).toBe(0);

    await pool.query('DROP TRIGGER m19_delay_canonical_transcript_trigger ON canonical_transcripts');
    await pool.query('DROP FUNCTION m19_delay_canonical_transcript()');
    const retryMessage = waitForMessage(child, 'retry');
    child.send({ type: 'retry' });
    const retry = await retryMessage;
    expect(retry.result.status).toBe(201);
    const complete = await pool.query(
      `SELECT count(*)::int AS operations,
              (SELECT count(*)::int FROM canonical_polaris_snapshots WHERE organization_id = $1) AS graphs
         FROM canonical_operations
        WHERE organization_id = $1 AND state = 'completed'`,
      [ORG_A]
    );
    expect(complete.rows[0]).toEqual({ operations: 1, graphs: 1 });
  }, 30000);
});
