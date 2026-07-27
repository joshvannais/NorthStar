'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const { getActiveBusinessProfile, putBusinessProfile } = require('../../src/services/organizationAuthority');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrationDir = path.resolve(__dirname, '../../migrations');
const migrations = [
  '001_initial_schema.sql', '002_seed_data.sql', '003_voice_sessions.sql',
  '004_canonical_persistence_v2.sql', '005_canonical_organization_authority.sql',
];
const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '00000000-0000-0000-0000-000000000010';
const ORG_C = '00000000-0000-0000-0000-000000000020';

const profile = {
  company: { currency: 'USD' },
  headquarters: {},
  crew: { defaultCrewSize: 2, averageHourlyRate: 42, overtimeMultiplier: 1.5 },
  financial: { markup: 1.3, emergencyMarkup: 1.5, travelCharge: 0.58 },
  scheduling: {},
  services: [],
};

function input(key, customer, organizationId, externalCustomerId) {
  return {
    tenantContext: { organizationId: organizationId || ORG_A, trusted: true },
    idempotencyKey: key,
    sourceVersion: 'identity-test-v1',
    external: { customerId: externalCustomerId || null, callId: 'identity-call-' + key },
    customer: { name: customer.name, phone: customer.phone || null, email: customer.email || null, address: null },
    transcript: [{ turnId: 'turn-1', speaker: 'customer', text: 'I need help with a general service request.' }],
    facts: [],
    service: { key: 'general', scope: {} },
  };
}

function runWorker(connectionString, graphInput) {
  return new Promise(function (resolve, reject) {
    const child = fork(path.resolve(__dirname, '../helpers/m19-part3-graph-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, M19_PART3_FAILURE_DATABASE_URL: connectionString },
      silent: true,
    });
    let stderr = '';
    let settled = false;
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('message', message => {
      if (message.type === 'result') {
        settled = true;
        resolve({ result: message.results[0], stderr });
      } else if (message.type === 'error') {
        settled = true;
        reject(new Error(message.code + '\n' + stderr));
      }
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (!settled) reject(new Error('identity worker exited before result: ' + code + '\n' + stderr));
    });
    child.send({ type: 'run', input: graphInput, count: 1 });
  });
}

realPostgres('Mission 19 Part 3 canonical customer strong identity', () => {
  let suiteDatabase;
  let pool;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('canonical-identity');
    pool = new Pool({ connectionString: suiteDatabase.connectionString, max: 24 });
    for (const migration of migrations) {
      await pool.query(fs.readFileSync(path.join(migrationDir, migration), 'utf8'));
    }
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Identity Organization B', 'identity-b@m19.test')
       ON CONFLICT (id) DO NOTHING`,
      [ORG_B]
    );
    await putBusinessProfile(pool, { organizationId: ORG_A, profile });
    await putBusinessProfile(pool, { organizationId: ORG_B, profile });
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

  test('phone and email formatting variants reuse one customer and preserve a continuous timeline', async () => {
    const first = await ingestLead(pool, input('format-a', {
      name: 'Avery Original', phone: '(555) 555-0100', email: ' Avery@Example.Test ',
    }));
    const second = await ingestLead(pool, input('format-b', {
      name: 'Avery Later', phone: '+1 555-555-0100', email: 'avery@example.test',
    }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.ids.customer).toBe(first.body.ids.customer);
    expect(second.body.graphId).not.toBe(first.body.graphId);
    const timeline = await pool.query(
      `SELECT t.id FROM canonical_transcripts t
        WHERE t.organization_id = $1 AND t.customer_id = $2
        ORDER BY t.created_at`,
      [ORG_A, first.body.ids.customer]
    );
    expect(timeline.rows).toHaveLength(2);
  });

  test('names alone never merge, same strong phone does merge, and missing identities create distinct customers', async () => {
    const sameNameA = await ingestLead(pool, input('name-a', { name: 'Same Name', phone: '+15555550101' }));
    const sameNameB = await ingestLead(pool, input('name-b', { name: 'Same Name', phone: '+15555550102' }));
    const samePhone = await ingestLead(pool, input('phone-reuse', { name: 'Different Name', phone: '555-555-0101' }));
    const missingA = await ingestLead(pool, input('missing-a', { name: 'No Identity' }));
    const missingB = await ingestLead(pool, input('missing-b', { name: 'No Identity' }));
    expect(sameNameA.body.ids.customer).not.toBe(sameNameB.body.ids.customer);
    expect(samePhone.body.ids.customer).toBe(sameNameA.body.ids.customer);
    expect(missingA.body.ids.customer).not.toBe(missingB.body.ids.customer);
  });

  test('one resolved identifier safely binds the other unused identifier', async () => {
    const first = await ingestLead(pool, input('bind-a', { name: 'Bind A', phone: '+15555550103' }));
    const second = await ingestLead(pool, input('bind-b', { name: 'Bind B', phone: '(555) 555-0103', email: 'bind@example.test' }));
    const third = await ingestLead(pool, input('bind-c', { name: 'Bind C', email: ' BIND@EXAMPLE.TEST ' }));
    expect(second.body.ids.customer).toBe(first.body.ids.customer);
    expect(third.body.ids.customer).toBe(first.body.ids.customer);
  });

  test('conflicting phone and email fail deterministically and roll back every graph artifact', async () => {
    const phoneOwner = await ingestLead(pool, input('conflict-phone', { name: 'Phone Owner', phone: '+15555550104', email: 'phone@example.test' }));
    const emailOwner = await ingestLead(pool, input('conflict-email', { name: 'Email Owner', phone: '+15555550105', email: 'email@example.test' }));
    const conflict = await ingestLead(pool, input('conflict-request', { name: 'Conflict', phone: '+15555550104', email: 'email@example.test' }));
    expect(phoneOwner.status).toBe(201);
    expect(emailOwner.status).toBe(201);
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'CANONICAL_CUSTOMER_IDENTITY_CONFLICT' } } });
    const operation = await pool.query(
      `SELECT id, state, safe_error_code FROM canonical_operations
        WHERE organization_id = $1 AND state = 'permanent_failed'`,
      [ORG_A]
    );
    expect(operation.rows).toHaveLength(1);
    expect(operation.rows[0].safe_error_code).toBe('customer_identity_conflict');
    const artifacts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM canonical_transcripts WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_communications WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_opportunities WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_estimates WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_appointments WHERE operation_id = $1) +
        (SELECT count(*)::int FROM canonical_polaris_snapshots WHERE operation_id = $1) AS count`,
      [operation.rows[0].id]
    );
    expect(artifacts.rows[0].count).toBe(0);
  });

  test('authoritative external customer ID reuses safely and organizations remain independent', async () => {
    const first = await ingestLead(pool, input('external-a', { name: 'External A' }, ORG_A, 'crm-123'));
    const second = await ingestLead(pool, input('external-b', { name: 'External B' }, ORG_A, 'crm-123'));
    const otherOrg = await ingestLead(pool, input('external-c', { name: 'External C', phone: '+15555550106' }, ORG_B, 'crm-123'));
    const orgAPhone = await ingestLead(pool, input('external-d', { name: 'External D', phone: '+15555550106' }, ORG_A));
    expect(second.body.ids.customer).toBe(first.body.ids.customer);
    expect(otherOrg.body.ids.customer).not.toBe(first.body.ids.customer);
    expect(orgAPhone.body.ids.customer).not.toBe(otherOrg.body.ids.customer);
  });

  test('separate processes race on one strong identity and converge on one customer', async () => {
    const firstInput = input('process-a', { name: 'Process A', phone: '(555) 555-0107' });
    const secondInput = input('process-b', { name: 'Process B', phone: '+1-555-555-0107' });
    const [first, second] = await Promise.all([
      runWorker(suiteDatabase.connectionString, firstInput),
      runWorker(suiteDatabase.connectionString, secondInput),
    ]);
    expect(first.result.status).toBe(201);
    expect(second.result.status).toBe(201);
    expect(first.result.body.ids.customer).toBe(second.result.body.ids.customer);
    const customers = await pool.query('SELECT count(*)::int AS count FROM canonical_customers WHERE organization_id = $1', [ORG_A]);
    const graphs = await pool.query("SELECT count(*)::int AS count FROM canonical_operations WHERE organization_id = $1 AND state = 'completed'", [ORG_A]);
    expect(customers.rows[0].count).toBe(1);
    expect(graphs.rows[0].count).toBe(2);
  }, 30000);

  test('idempotent replay retains the same graph and customer', async () => {
    const request = input('replay', { name: 'Replay', email: 'replay@example.test' });
    const first = await ingestLead(pool, request);
    const replay = await ingestLead(pool, request);
    expect(replay).toMatchObject({ status: 201, replayed: true });
    expect(replay.body.graphId).toBe(first.body.graphId);
    expect(replay.body.ids.customer).toBe(first.body.ids.customer);
  });

  test('missing profile authority fails explicitly and becomes safely retryable after configuration', async () => {
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Missing Profile Organization', 'missing-profile@m19.test')
       ON CONFLICT (id) DO NOTHING`,
      [ORG_C]
    );
    const request = input('missing-profile', { name: 'Missing Profile', email: 'missing-profile@example.test' }, ORG_C);
    const missing = await ingestLead(pool, request);
    expect(missing).toMatchObject({
      status: 503,
      body: { error: { code: 'CANONICAL_BUSINESS_PROFILE_REQUIRED' } },
    });
    const failed = await pool.query(
      'SELECT state, safe_error_code FROM canonical_operations WHERE organization_id = $1',
      [ORG_C]
    );
    expect(failed.rows).toEqual([{ state: 'retryable_failed', safe_error_code: 'canonical_business_profile_required' }]);
    await putBusinessProfile(pool, { organizationId: ORG_C, profile });
    const retry = await ingestLead(pool, request);
    expect(retry.status).toBe(201);
  });

  test('caller-supplied profile data is ignored and replay preserves the original persisted profile provenance', async () => {
    const originalAuthority = await getActiveBusinessProfile(pool, ORG_A);
    const request = {
      ...input('profile-replay', { name: 'Profile Replay', email: 'profile-replay@example.test' }),
      businessProfile: { version: 'caller-controlled', company: { currency: 'ZZZ' }, hash: 'caller-controlled' },
    };
    const first = await ingestLead(pool, request);
    expect(first.status).toBe(201);
    expect(first.body.businessProfile).toEqual({
      id: originalAuthority.id,
      version: originalAuthority.versionLabel,
      hash: originalAuthority.profileHash,
    });
    const replacement = await putBusinessProfile(pool, {
      organizationId: ORG_A,
      profile: { ...profile, company: { currency: 'EUR' } },
    });
    expect(replacement.id).not.toBe(originalAuthority.id);
    const replay = await ingestLead(pool, request);
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(first.body);
    const persisted = await pool.query(
      `SELECT business_profile_id, business_profile_version, business_profile_hash
         FROM canonical_polaris_snapshots WHERE id = $1`,
      [first.body.ids.polarisSnapshot]
    );
    expect(persisted.rows[0]).toEqual({
      business_profile_id: originalAuthority.id,
      business_profile_version: originalAuthority.versionLabel,
      business_profile_hash: originalAuthority.profileHash,
    });
  });
});
