'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Pool } = require('pg');
const repository = require('../../src/persistence/v2/repository');
const { stableStringify } = require('../../src/services/businessProfileAdapter');
const simulationPipeline = require('../../src/routes/simulation/pipeline');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');
const {
  GRAPH_STAGES,
  executeCanonicalGraph,
  ingestDemo,
  ingestRetell,
  ingestSimulation,
  ingestVoice,
} = require('../../src/services/canonicalGraphService');

let databaseUrl;
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrationDir = path.resolve(__dirname, '../../migrations');
const migrations = [
  '001_initial_schema.sql', '002_seed_data.sql', '003_voice_sessions.sql',
  '004_canonical_persistence_v2.sql', '005_canonical_organization_authority.sql',
  '006_canonical_voice_sessions.sql',
  '007_canonical_tax_authority.sql',
];
const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '00000000-0000-0000-0000-000000000010';
const artifactTables = [
  'canonical_customers', 'canonical_transcripts', 'canonical_facts',
  'canonical_communications', 'canonical_opportunities', 'canonical_estimates',
  'canonical_appointments', 'canonical_polaris_snapshots',
];

async function applyMigrations(pool) {
  for (const filename of migrations) {
    await pool.query(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
  }
  await pool.query(
    `INSERT INTO organizations (id, name, email)
     VALUES ($1, 'Organization B', 'org-b-graph@m19.test')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_B]
  );
  await putBusinessProfile(pool, { organizationId: ORG_A, profile: graphInput('profile-a').businessProfile });
  await putBusinessProfile(pool, { organizationId: ORG_B, profile: graphInput('profile-b').businessProfile });
}

function graphInput(key, overrides) {
  const input = {
    tenantContext: { organizationId: ORG_A, trusted: true },
    idempotencyKey: key,
    source: 'simulation',
    sourceVersion: 'm19-part3-test-v1',
    external: {
      customerId: 'customer-' + key,
      callId: 'call-' + key,
      transcriptId: 'transcript-' + key,
      communicationId: 'communication-' + key,
      appointmentId: 'appointment-' + key,
    },
    customer: {
      name: 'Avery Smith',
      phone: '+15555550100',
      email: 'avery@example.test',
      address: { line1: '100 Cedar Lane', city: 'Testville', state: 'NY', postalCode: '10001' },
    },
    transcript: [
      { turnId: 'turn-1', speaker: 'customer', text: 'I need a new 100-foot cedar fence and the existing fence removed.' },
      { turnId: 'turn-2', speaker: 'customer', text: 'Include one walk gate. Weekday mornings work best. This is not an emergency.' },
    ],
    facts: [
      { id: 'scope-length', variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { id: 'scope-material', variable: 'material', normalizedValue: 'cedar', evidenceText: 'cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { id: 'scope-removal', variable: 'removalRequired', normalizedValue: true, evidenceText: 'existing fence removed', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { id: 'scope-gate', variable: 'gates', normalizedValue: [{ type: 'walk' }], evidenceText: 'one walk gate', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
    ],
    service: {
      key: 'fence',
      scope: { jobType: 'replace', linearFeet: 100, material: 'cedar', height: 6, removalRequired: true, gates: [{ type: 'walk' }] },
    },
    businessProfileVersion: 'bp-graph-v1',
    businessProfile: {
      version: 'bp-graph-v1',
      company: { currency: 'USD' },
      crew: { defaultCrewSize: 2, averageHourlyRate: 42, overtimeMultiplier: 1.5 },
      financial: { markup: 1.3, emergencyMarkup: 1.5, travelCharge: 0.58 },
      services: [],
    },
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    callDurationSeconds: 242,
    occurredAt: '2026-07-26T12:00:00.000Z',
  };
  return { ...input, ...(overrides || {}) };
}

async function operationForKey(pool, organizationId, key) {
  const rows = await pool.query(
    `SELECT * FROM canonical_operations
      WHERE organization_id = $1
      ORDER BY created_at DESC`,
    [organizationId]
  );
  return rows.rows.find(function (row) {
    return row.result_body && row.result_body.operationId === row.id;
  }) || rows.rows.find(function (row) { return !row.result_body; }) || null;
}

async function artifactCount(pool, organizationId, operationId) {
  let total = 0;
  for (const table of artifactTables) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE organization_id = $1 AND operation_id = $2`,
      [organizationId, operationId]
    );
    total += result.rows[0].count;
  }
  return total;
}

function runWorker(input, count) {
  return new Promise(function (resolve, reject) {
    const child = fork(path.resolve(__dirname, '../helpers/m19-part3-graph-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, M19_PART3_FAILURE_DATABASE_URL: databaseUrl },
      silent: true,
    });
    let stderr = '';
    child.stderr.on('data', function (chunk) { stderr += chunk.toString(); });
    child.on('message', function (message) {
      if (message.type === 'result') resolve({ results: message.results, stderr });
      if (message.type === 'error') reject(new Error(message.code));
    });
    child.on('error', reject);
    child.send({ type: 'run', input, count });
  });
}

realPostgres('Mission 19 Part 3 transactional canonical graph on disposable PostgreSQL', () => {
  let pool;
  let suiteDatabase;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('canonical-graph');
    databaseUrl = suiteDatabase.connectionString;
    pool = new Pool({ connectionString: databaseUrl, max: 32 });
    await applyMigrations(pool);
  }, 30000);

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE canonical_operations CASCADE');
  });

  test('sequential duplicate replays byte-equivalent stable IDs and one graph', async () => {
    const input = graphInput('m19-graph-sequential');
    const first = await ingestSimulation(pool, input);
    const second = await ingestSimulation(pool, input);
    expect(first.status).toBe(201);
    expect(first.replayed).toBe(false);
    expect(second.status).toBe(201);
    expect(second.replayed).toBe(true);
    expect(stableStringify(second.body)).toBe(stableStringify(first.body));
    expect(await artifactCount(pool, ORG_A, first.body.operationId)).toBe(11);
  });

  test('simulation generation is concurrency-safe and deterministic per operation seed', () => {
    function generate(seed) {
      return simulationPipeline.withDeterministicSeed(seed, function () {
        const scenario = simulationPipeline.generateScenario('fence', 'Avery Smith');
        return {
          scenario,
          transcript: simulationPipeline.generateTranscript(scenario),
        };
      });
    }
    expect(stableStringify(generate('operation-seed-a'))).toBe(stableStringify(generate('operation-seed-a')));
    expect(stableStringify(generate('operation-seed-a'))).not.toBe(stableStringify(generate('operation-seed-b')));
  });

  test('32 concurrent requests across two Node processes create exactly one graph', async () => {
    const key = 'm19-graph-multiprocess-32';
    const input = graphInput(key);
    const [workerA, workerB] = await Promise.all([runWorker(input, 16), runWorker(input, 16)]);
    const results = workerA.results.concat(workerB.results);
    expect(results).toHaveLength(32);
    expect(results.every(result => result.status === 201)).toBe(true);
    const bodies = new Set(results.map(result => stableStringify(result.body)));
    expect(bodies.size).toBe(1);
    const operationId = results[0].body.operationId;
    expect(await artifactCount(pool, ORG_A, operationId)).toBe(11);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM canonical_operations
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, operationId]
    );
    expect(count.rows[0].count).toBe(1);
    expect(workerA.stderr + workerB.stderr).not.toContain(key);
  }, 30000);

  test('fingerprint conflict is 409 and the same key is independent across organizations', async () => {
    const key = 'm19-graph-conflict';
    const first = await ingestSimulation(pool, graphInput(key));
    const conflict = await ingestSimulation(pool, graphInput(key, {
      customer: { ...graphInput(key).customer, name: 'Different Customer' },
    }));
    expect(first.status).toBe(201);
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'IDEMPOTENCY_FINGERPRINT_CONFLICT' } } });

    const organizationB = await ingestSimulation(pool, graphInput(key, {
      tenantContext: { organizationId: ORG_B, trusted: true },
    }));
    expect(organizationB.status).toBe(201);
    expect(organizationB.body.graphId).not.toBe(first.body.graphId);
  });

  test('restart after claim takes over the expired lease with the original stable graph ID', async () => {
    const input = graphInput('m19-graph-crash-after-claim');
    await expect(ingestSimulation(pool, input, { crashAfterClaim: true, leaseMs: 1000 })).rejects.toMatchObject({
      code: 'INJECTED_CRASH_AFTER_CLAIM',
    });
    const claimed = await pool.query(
      `SELECT id, graph_id, state, attempt_count FROM canonical_operations
        WHERE organization_id = $1 AND state = 'claimed'
        ORDER BY created_at DESC LIMIT 1`,
      [ORG_A]
    );
    expect(claimed.rows[0].attempt_count).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const restarted = await ingestSimulation(pool, input, { leaseMs: 1000, waitMs: 10, maxWaitMs: 5000 });
    expect(restarted.status).toBe(201);
    expect(restarted.body.graphId).toBe(claimed.rows[0].graph_id);
    const operation = await repository.getOperation(pool, ORG_A, claimed.rows[0].id);
    expect(operation.attempt_count).toBe(2);
  });

  test('restart after commit replays the committed response', async () => {
    const input = graphInput('m19-graph-crash-after-commit');
    await expect(ingestSimulation(pool, input, { crashAfterCommitBeforeResponse: true })).rejects.toMatchObject({
      code: 'INJECTED_CRASH_AFTER_COMMIT',
    });
    const replay = await ingestSimulation(pool, input);
    expect(replay.status).toBe(201);
    expect(replay.replayed).toBe(true);
    expect(await artifactCount(pool, ORG_A, replay.body.operationId)).toBe(11);
  });

  test.each(GRAPH_STAGES)('failure after %s rolls back every graph artifact', async stage => {
    const key = 'm19-graph-failure-' + stage;
    const response = await ingestSimulation(pool, graphInput(key), { failAfterStage: stage });
    expect(response).toMatchObject({ status: 503, body: { error: { code: 'RETRYABLE_GRAPH_FAILURE' } } });
    const operation = await pool.query(
      `SELECT * FROM canonical_operations
        WHERE organization_id = $1 AND state = 'retryable_failed'
        ORDER BY created_at DESC LIMIT 1`,
      [ORG_A]
    );
    expect(operation.rows[0].safe_error_code).toBe('injected_' + stage);
    expect(await artifactCount(pool, ORG_A, operation.rows[0].id)).toBe(0);
  });

  test('active lease is protected and an expired lease has exactly one takeover owner', async () => {
    const input = graphInput('m19-graph-lease-takeover');
    await expect(ingestSimulation(pool, input, { crashAfterClaim: true, leaseMs: 1000 })).rejects.toBeDefined();
    const active = await ingestSimulation(pool, input, { leaseMs: 1000, waitMs: 10, maxWaitMs: 50 });
    expect(active).toMatchObject({ status: 409, body: { error: { code: 'OPERATION_IN_PROGRESS' } } });
    await new Promise(resolve => setTimeout(resolve, 1050));
    const attempts = await Promise.all(Array.from({ length: 8 }, function () {
      return ingestSimulation(pool, input, { leaseMs: 1000, waitMs: 10, maxWaitMs: 5000 });
    }));
    expect(attempts.every(result => result.status === 201)).toBe(true);
    expect(new Set(attempts.map(result => result.body.graphId)).size).toBe(1);
    const operation = await pool.query(
      `SELECT attempt_count, state FROM canonical_operations
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, attempts[0].body.operationId]
    );
    expect(operation.rows[0]).toMatchObject({ attempt_count: 2, state: 'completed' });
  });

  test('permanent failure cannot create or later retry a graph', async () => {
    const input = graphInput('m19-graph-permanent');
    const failed = await ingestSimulation(pool, input, {
      failAfterStage: 'customer', retryableFailure: false,
    });
    expect(failed.status).toBe(422);
    const retry = await ingestSimulation(pool, input);
    expect(retry.status).toBe(422);
    expect(retry.body.error.code).toBe('injected_customer');
  });

  test('all supported ingestion sources use the same transactional service', async () => {
    const cases = [
      ['simulation', ingestSimulation], ['demo', ingestDemo],
      ['retell', ingestRetell], ['voice', ingestVoice],
    ];
    for (const [source, ingest] of cases) {
      const response = await ingest(pool, graphInput('m19-source-' + source, {
        external: {
          customerId: 'customer-source-' + source,
          callId: 'call-source-' + source,
          transcriptId: 'transcript-source-' + source,
          communicationId: 'communication-source-' + source,
          appointmentId: 'appointment-source-' + source,
        },
      }));
      expect(response.status).toBe(201);
      expect(response.body.snapshot.customerFacingPrice).toBe(4510);
    }
  });

  test('raw idempotency keys are absent from database rows and service output', async () => {
    const key = 'm19-raw-key-must-never-persist';
    const response = await ingestSimulation(pool, graphInput(key));
    expect(stableStringify(response)).not.toContain(key);
    const operation = await pool.query(
      `SELECT row_to_json(canonical_operations)::text AS serialized
         FROM canonical_operations WHERE id = $1`,
      [response.body.operationId]
    );
    expect(operation.rows[0].serialized).not.toContain(key);
  });

  test('configured tax is persisted explicitly and unavailable tax remains explicit', async () => {
    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      profile: {
        ...graphInput('tax-profile').businessProfile,
        canonicalPricing: { taxRatePercent: 8.25 },
      },
    });
    const response = await ingestSimulation(pool, graphInput('m19-tax-configured'));
    expect(response.status).toBe(201);
    expect(response.body.snapshot).toMatchObject({
      subtotalBeforeTax: 4510,
      taxRatePercent: 8.25,
      tax: 372.08,
      totalIncludingTax: 4882.08,
      taxDisposition: { status: 'calculated', reason: null },
    });
    const estimate = await pool.query(
      `SELECT tax_rate_percent::float AS tax_rate_percent,
              tax_amount::float AS tax_amount,
              tax_not_calculated_reason,
              total_including_tax::float AS total_including_tax
         FROM canonical_estimates
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, response.body.ids.estimate]
    );
    expect(estimate.rows[0]).toEqual({
      tax_rate_percent: 8.25,
      tax_amount: 372.08,
      tax_not_calculated_reason: null,
      total_including_tax: 4882.08,
    });
  });

  test('database unavailable before claim returns normalized 503 without an INSERT', async () => {
    const sql = [];
    const unavailablePool = {
      query: jest.fn(async function (statement) {
        sql.push(String(statement));
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      }),
    };
    const response = await executeCanonicalGraph(unavailablePool, graphInput('m19-no-database'));
    expect(response).toMatchObject({
      status: 503,
      body: { error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE' } },
    });
    expect(sql.some(statement => /INSERT/i.test(statement))).toBe(false);
  });
});
