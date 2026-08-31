'use strict';

const childProcess = require('child_process');
const Module = require('module');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';
const ROOT = path.resolve(__dirname, '../..');
const P5_BASE = '41bc295542dcb57b6b8af3aee73affba76d76411';
const RICH_SCENARIO = Object.freeze({
  business: 'multi_crew',
  service: 'roofing',
  intent: 'second_opinion',
  urgency: 'safety_emergency',
  context: 'insurance_claim',
  scheduling: 'weather_window',
  outcome: 'needs_information',
});

function cookieFrom(response) {
  const header = response.headers['set-cookie'];
  expect(Array.isArray(header)).toBe(true);
  return header[0].split(';')[0];
}

function mutation(agent, cookie, path, intent, key, body) {
  return agent.post(path)
    .set('Host', 'northstar.test')
    .set('Origin', ORIGIN)
    .set('Sec-Fetch-Site', 'same-origin')
    .set('Cookie', cookie)
    .set('Idempotency-Key', key)
    .set('X-NorthStar-Demo-Intent', intent)
    .send(body);
}

function settleAuditLogger() {
  return new Promise(resolve => setTimeout(resolve, 25));
}

function deepKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach(item => deepKeys(item, keys));
  else if (value && typeof value === 'object') Object.keys(value).forEach(key => {
    keys.push(key);
    deepKeys(value[key], keys);
  });
  return keys;
}

function loadGitBlobModule(revision, relativePath) {
  const source = childProcess.execFileSync(
    'git', ['show', revision + ':' + relativePath],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  const filename = path.join(ROOT, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

function tokenCookie(token) {
  return 'northstar_demo_workspace=' + encodeURIComponent(token.token);
}

function resignGraph(graph) {
  const { sha256 } = require('../../src/services/businessProfileAdapter');
  const projection = { ...graph };
  delete projection.projectionDigest;
  graph.projectionDigest = sha256(projection);
}

async function insertPersistedDemoState(pool, token, state, options = {}) {
  const revision = options.revision || 1;
  const simulationCount = options.simulationCount || 0;
  const mutationCount = options.mutationCount || 0;
  await pool.query(
    `INSERT INTO demo_command_center_sessions
       (id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
        last_simulated_at, created_at, updated_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)`,
    [
      token.sessionId, token.tenantId, token.tokenHash, state, revision,
      simulationCount, mutationCount, options.lastSimulatedAt || null,
      token.issuedAt, token.expiresAt,
    ]
  );
}

realPostgres('Demo/Paid Command Center Parity Prelude mounted PostgreSQL authority', () => {
  let suiteDatabase;
  let db;
  let pool;
  let app;
  let originalDatabaseUrl;
  let originalFetch;
  const providerVariables = [
    'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
  ];
  const originalProviders = new Map();

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('command-center-demo');
    originalDatabaseUrl = process.env.DATABASE_URL;
    for (const name of providerVariables) {
      originalProviders.set(name, process.env[name]);
      delete process.env[name];
    }
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new Error('provider boundary must remain unused'); });
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
    global.fetch = originalFetch;
    try {
      if (db) await db.close();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      for (const [name, value] of originalProviders) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  }, 60000);

  test('GET is account-free and projection-only until an explicit same-origin mutation', async () => {
    const first = await request(app).get('/api/demo/command-center').set('Host', 'northstar.test').expect(200);
    const cookie = cookieFrom(first);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.data).toEqual(expect.objectContaining({
      contract: 'northstar_command_center_workspace_v1',
      mode: 'demo',
      capabilities: { simulateLead: true, reset: true, scenarioControls: true, realTenantData: false },
      navigation: expect.any(Array),
      graphs: expect.any(Array),
      configuration: expect.any(Object),
      integrity: expect.objectContaining({ revision: 1, graphCount: 3 }),
      session: expect.objectContaining({ durable: false, simulationCount: 0 }),
    }));
    expect(first.body.data.navigation).toHaveLength(9);
    expect(first.body.data.graphs).toHaveLength(3);
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_admission_windows')).rows[0].count).toBe(0);

    const rejected = await request(app).post('/api/demo/command-center/simulations/leads')
      .set('Host', 'northstar.test')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'missing-origin-0000000000000000')
      .set('X-NorthStar-Demo-Intent', 'simulate-lead')
      .send({ service: 'fence', expectedRevision: 1 })
      .expect(403);
    expect(rejected.body.error.code).toBe('demo_same_origin_required');
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(0);
    await settleAuditLogger();
    expect((await pool.query('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count).toBe(0);
  });

  test('independent cookie sessions stay isolated while reload and same-session route reads stay byte-consistent', async () => {
    const first = await request(app).get('/api/demo/command-center').set('Host', 'northstar.test').expect(200);
    const second = await request(app).get('/api/demo/command-center').set('Host', 'northstar.test').expect(200);
    const firstCookie = cookieFrom(first);
    const secondCookie = cookieFrom(second);

    expect(firstCookie).not.toBe(secondCookie);
    expect(first.body.data.tenant.id).not.toBe(second.body.data.tenant.id);
    expect(first.body.data.integrity.digest).not.toBe(second.body.data.integrity.digest);
    expect(deepKeys(first.body.data).some(key => /seed/i.test(key))).toBe(false);
    expect(deepKeys(second.body.data).some(key => /seed/i.test(key))).toBe(false);

    const reloaded = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', firstCookie).expect(200);
    expect(reloaded.body.data).toEqual(first.body.data);

    for (const surface of ['leads', 'communications', 'calendar']) {
      const projected = await request(app)
        .get('/api/demo/command-center/canonical/compat/' + surface)
        .set('Host', 'northstar.test').set('Cookie', firstCookie).expect(200);
      expect(projected.body.data.authority.organizationId).toBe(first.body.data.tenant.id);
      expect(projected.body.data.metrics.graphCount).toBe(first.body.data.graphs.length);
      expect(projected.body.data.records[0].canonical.ids.graph).toBe(first.body.data.graphs[0].ids.graph);
    }
  });

  test('persisted legacy state migrates once while corrupt schema-v2 graph authority fails closed', async () => {
    const { issueToken } = require('../../src/commandCenter/demoRepository');
    const { createInitialDemoState } = require('../../src/commandCenter/workspace');
    const baseWorkspace = loadGitBlobModule(P5_BASE, 'src/commandCenter/workspace.js');
    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');

    const legacyToken = issueToken(new Date());
    const authenticLegacy = baseWorkspace.createInitialDemoState(legacyToken.tenantId, legacyToken.issuedAt);
    expect(authenticLegacy.schemaVersion).toBe(1);
    expect(authenticLegacy.graphs[0].customer.email).toBe('maria@example.demo');
    await insertPersistedDemoState(pool, legacyToken, authenticLegacy, {
      revision: 4,
      simulationCount: 2,
      mutationCount: 3,
      lastSimulatedAt: legacyToken.issuedAt,
    });
    await pool.query(
      `INSERT INTO demo_command_center_mutations
         (session_id, idempotency_hash, operation, request_digest, response_revision, response_digest)
       VALUES ($1,$2,'simulate_lead',$3,4,$4)`,
      [legacyToken.sessionId, '1'.repeat(64), '2'.repeat(64), '3'.repeat(64)]
    );

    const legacyCookie = tokenCookie(legacyToken);
    const [firstRead, concurrentRead] = await Promise.all([
      request(app).get('/api/demo/command-center').set('Host', 'northstar.test').set('Cookie', legacyCookie),
      request(app).get('/api/demo/command-center').set('Host', 'northstar.test').set('Cookie', legacyCookie),
    ]);
    expect(firstRead.status).toBe(200);
    expect(concurrentRead.status).toBe(200);
    expect(firstRead.body.data).toEqual(concurrentRead.body.data);
    expect(firstRead.body.data.integrity.revision).toBe(5);
    expect(firstRead.body.data.session).toEqual(expect.objectContaining({
      durable: true,
      simulationCount: 0,
      workspaceGeneration: 1,
    }));
    expect(firstRead.body.data.graphs).toHaveLength(3);
    expect(firstRead.body.data.graphs.every(graph =>
      /^[a-z0-9.-]+@example\.com$/.test(graph.customer.email) &&
      /^\([2-9][0-9]{2}\) 555-01[0-9]{2}$/.test(graph.customer.phone) &&
      / (?:Demo|Example|Fixture|Sample)$/.test(graph.customer.name)
    )).toBe(true);
    expect(JSON.stringify(firstRead.body.data)).not.toMatch(/example\.demo|Maria Rivera|Dev Patel|Avery Lewis/);

    const migrated = (await pool.query(
      `SELECT state, revision, simulation_count, mutation_count, last_simulated_at
         FROM demo_command_center_sessions WHERE id = $1`,
      [legacyToken.sessionId]
    )).rows[0];
    expect(migrated.state).toEqual(expect.objectContaining({ schemaVersion: 2, generation: 1 }));
    expect(migrated.revision).toBe('5');
    expect(migrated.simulation_count).toBe(0);
    expect(migrated.mutation_count).toBe(3);
    expect(migrated.last_simulated_at).toBeNull();
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM demo_command_center_mutations WHERE session_id = $1',
      [legacyToken.sessionId]
    )).rows[0].count).toBe(0);

    const stale = await mutation(
      request(app), legacyCookie, '/api/demo/command-center/simulations/leads',
      'simulate-lead', 'legacy-migration-stale-0000000001',
      { scenario: RICH_SCENARIO, expectedRevision: 4 }
    ).expect(409);
    expect(stale.body.error.code).toBe('demo_revision_conflict');
    const created = await mutation(
      request(app), legacyCookie, '/api/demo/command-center/simulations/leads',
      'simulate-lead', 'legacy-migration-current-000000001',
      { scenario: RICH_SCENARIO, expectedRevision: 5 }
    ).expect(201);
    expect(created.body.data.integrity.revision).toBe(6);
    const replay = await mutation(
      request(app), legacyCookie, '/api/demo/command-center/simulations/leads',
      'simulate-lead', 'legacy-migration-current-000000001',
      { scenario: RICH_SCENARIO, expectedRevision: 5 }
    ).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.data.integrity.digest).toBe(created.body.data.integrity.digest);

    const directMutationToken = issueToken(new Date());
    const directMutationLegacy = baseWorkspace.createInitialDemoState(
      directMutationToken.tenantId, directMutationToken.issuedAt
    );
    await insertPersistedDemoState(pool, directMutationToken, directMutationLegacy);
    const migratedConflict = await mutation(
      request(app), tokenCookie(directMutationToken),
      '/api/demo/command-center/simulations/leads', 'simulate-lead',
      'legacy-direct-mutation-00000000001',
      { scenario: RICH_SCENARIO, expectedRevision: 1 }
    ).expect(409);
    expect(migratedConflict.body.error.code).toBe('demo_revision_conflict');
    const directReadback = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', tokenCookie(directMutationToken)).expect(200);
    expect(directReadback.body.data.integrity.revision).toBe(2);
    expect(directReadback.body.data.session.simulationCount).toBe(0);
    expect(directReadback.body.data.graphs.every(graph => graph.customer.email.endsWith('@example.com'))).toBe(true);

    const validToken = issueToken(new Date());
    const validState = createInitialDemoState(validToken.tenantId, validToken.issuedAt, {
      seed: require('../../src/commandCenter/demoRepository').workspaceSeedForToken(validToken.tokenHash),
    });
    await insertPersistedDemoState(pool, validToken, validState);
    const validRead = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', tokenCookie(validToken)).expect(200);
    expect(validRead.body.data.graphs).toHaveLength(3);

    const corruptGraphToken = issueToken(new Date());
    const corruptGraphState = createInitialDemoState(corruptGraphToken.tenantId, corruptGraphToken.issuedAt, {
      seed: require('../../src/commandCenter/demoRepository').workspaceSeedForToken(corruptGraphToken.tokenHash),
    });
    corruptGraphState.graphs[0].customer.name = 'Real Person';
    corruptGraphState.graphs[0].customer.email = 'real.person@gmail.com';
    resignGraph(corruptGraphState.graphs[0]);
    await insertPersistedDemoState(pool, corruptGraphToken, corruptGraphState);
    const corruptGraphRead = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', tokenCookie(corruptGraphToken)).expect(503);
    expect(corruptGraphRead.body.error.code).toBe('demo_state_invalid');

    const corruptReferenceToken = issueToken(new Date());
    const corruptReferenceState = createInitialDemoState(corruptReferenceToken.tenantId, corruptReferenceToken.issuedAt, {
      seed: require('../../src/commandCenter/demoRepository').workspaceSeedForToken(corruptReferenceToken.tokenHash),
    });
    corruptReferenceState.graphs[0].lead.serviceType = 'unsupported-private-service';
    resignGraph(corruptReferenceState.graphs[0]);
    await insertPersistedDemoState(pool, corruptReferenceToken, corruptReferenceState);
    const corruptReferenceRead = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', tokenCookie(corruptReferenceToken)).expect(503);
    expect(corruptReferenceRead.body.error.code).toBe('demo_state_invalid');

    const corruptWorkspaceToken = issueToken(new Date());
    const corruptWorkspaceState = createInitialDemoState(corruptWorkspaceToken.tenantId, corruptWorkspaceToken.issuedAt, {
      seed: require('../../src/commandCenter/demoRepository').workspaceSeedForToken(corruptWorkspaceToken.tokenHash),
    });
    corruptWorkspaceState.workspace.company.email = 'not-reserved@example.net';
    await insertPersistedDemoState(pool, corruptWorkspaceToken, corruptWorkspaceState);
    const corruptWorkspaceRead = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', tokenCookie(corruptWorkspaceToken)).expect(503);
    expect(corruptWorkspaceRead.body.error.code).toBe('demo_state_invalid');
    expect(global.fetch).not.toHaveBeenCalled();

    await settleAuditLogger();
    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');
    await pool.query('TRUNCATE audit_logs');
  });

  test('a re-signed schema-v2 graph cannot bypass its canonical Polaris snapshot digest', async () => {
    const { issueToken, workspaceSeedForToken } = require('../../src/commandCenter/demoRepository');
    const { createInitialDemoState } = require('../../src/commandCenter/workspace');
    const { validateDemoGraphAgainstWorkspace } = require('../../src/commandCenter/demoWorkspaceGenerator');
    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');

    const token = issueToken(new Date());
    const state = createInitialDemoState(token.tenantId, token.issuedAt, {
      seed: workspaceSeedForToken(token.tokenHash),
    });
    state.graphs[0].polaris.snapshotDigest = '0'.repeat(64);
    resignGraph(state.graphs[0]);

    expect(() => validateDemoGraphAgainstWorkspace(state.graphs[0], state.workspace))
      .toThrow('Polaris snapshot digest');
    await insertPersistedDemoState(pool, token, state);

    for (const route of [
      '/api/demo/command-center',
      '/api/demo/command-center/canonical/compat/leads',
    ]) {
      const response = await request(app).get(route)
        .set('Host', 'northstar.test')
        .set('Cookie', tokenCookie(token))
        .expect(503);
      expect(response.body.error.code).toBe('demo_state_invalid');
    }
    expect(global.fetch).not.toHaveBeenCalled();

    await settleAuditLogger();
    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');
    await pool.query('TRUNCATE audit_logs');
  });

  test('one durable CAS graph updates all relevant surfaces and replays without duplication', async () => {
    const first = await request(app).get('/api/demo/command-center').set('Host', 'northstar.test').expect(200);
    const cookie = cookieFrom(first);
    const beforeConfiguration = first.body.data.configuration;
    await pool.query(
      `INSERT INTO demo_command_center_sessions
         (id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
          created_at, updated_at, expires_at)
       VALUES
         ('00000000-0000-4000-8000-000000000091',
          '00000000-0000-4000-8000-000000000092', $1, '{}'::jsonb, 1, 0, 0,
          NOW() - INTERVAL '25 hours', NOW() - INTERVAL '25 hours', NOW() - INTERVAL '1 hour')`,
      ['f'.repeat(64)]
    );
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(1);
    const key = 'simulate-command-center-demo-00000001';
    const created = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', key, {
      scenario: RICH_SCENARIO,
      expectedRevision: 1,
    }).expect(201);

    expect(created.body.replayed).toBe(false);
    expect(created.body.data.integrity).toEqual(expect.objectContaining({ revision: 2, graphCount: 4 }));
    expect(created.body.data.session).toEqual(expect.objectContaining({ durable: true, simulationCount: 1 }));
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(1);
    expect(created.body.data.configuration.businessProfile)
      .toEqual(created.body.data.graphs[0].businessProfile);
    expect(created.body.data.configuration.businessProfile)
      .toEqual(beforeConfiguration.businessProfile);
    expect(created.body.data.configuration.scenarioSpace).toEqual(beforeConfiguration.scenarioSpace);
    expect(created.body.data.configuration.workforce).toEqual(beforeConfiguration.workforce);
    expect(created.body.data.configuration.integrations).toEqual(beforeConfiguration.integrations);
    const admissionRows = (await pool.query(
      `SELECT scope, trim(subject_hash) AS subject_hash, request_count
         FROM demo_command_center_admission_windows
        ORDER BY scope`
    )).rows;
    expect(admissionRows).toEqual([
      { scope: 'global', subject_hash: '0'.repeat(64), request_count: 1 },
      { scope: 'source', subject_hash: expect.stringMatching(/^[0-9a-f]{64}$/), request_count: 1 },
    ]);
    expect(admissionRows[1].subject_hash).not.toContain('127.0.0.1');
    const graph = created.body.data.graphs[0];
    expect(graph).toEqual(expect.objectContaining({
      customer: expect.objectContaining({ fictional: true }),
      lead: expect.objectContaining({
        serviceType: 'roofing',
        callerIntent: 'Get a second opinion',
        urgency: 'Safety or active-damage emergency',
        outcome: 'More information needed',
      }),
      work: expect.objectContaining({
        id: expect.any(String),
        schedulingConstraint: 'Weather-dependent window',
      }),
      scenario: expect.objectContaining({
        signature: 'multi_crew:roofing:second_opinion:safety_emergency:insurance_claim:weather_window:needs_information',
        selection: RICH_SCENARIO,
      }),
      polaris: expect.objectContaining({
        completeDetail: true,
        snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        snapshot: expect.objectContaining({
          risk: expect.objectContaining({ emergency: true }),
          missingInformation: expect.arrayContaining([expect.any(String)]),
        }),
      }),
    }));

    for (const surface of ['customer-detail', 'leads', 'communications', 'calendar']) {
      const projected = await request(app)
        .get('/api/demo/command-center/canonical/compat/' + surface)
        .set('Host', 'northstar.test')
        .set('Cookie', cookie)
        .expect(200);
      expect(projected.body.data).toEqual(expect.objectContaining({
        surface,
        authority: expect.objectContaining({
          organizationId: created.body.data.tenant.id,
          userId: created.body.data.viewer.id,
          sessionId: created.body.data.session.id,
        }),
        records: expect.any(Array),
        items: expect.any(Array),
        metrics: expect.objectContaining({ graphCount: 4 }),
      }));
      expect(projected.body.data.records).toHaveLength(4);
      expect(projected.body.data.items).toHaveLength(4);
      expect(projected.body.data.records[0]).toEqual(expect.objectContaining({
        canonical: expect.objectContaining({
          ids: expect.objectContaining({ graph: graph.ids.graph, customer: graph.ids.customer }),
          snapshotDigest: graph.polaris.snapshotDigest,
        }),
      }));
      if (surface === 'customer-detail') {
        expect(projected.body.data.records[0].name).toBe(graph.customer.name);
      } else {
        expect(projected.body.data.records[0].customer.name).toBe(graph.customer.name);
      }
      if (surface === 'communications') {
        const transcript = JSON.parse(projected.body.data.records[0].transcript.text);
        expect(transcript.length).toBeGreaterThan(1);
        expect(transcript[0]).toEqual(expect.objectContaining({ speaker: 'ai', text: expect.any(String) }));
        expect(transcript.some(turn => turn.speaker === 'customer')).toBe(true);
      }
    }

    const replay = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', key, {
      scenario: RICH_SCENARIO,
      expectedRevision: 1,
    }).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.data.integrity.revision).toBe(2);
    expect(replay.body.data.graphs).toHaveLength(4);

    const conflictingReplay = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', key, {
      scenario: { ...RICH_SCENARIO, outcome: 'booked' },
      expectedRevision: 1,
    }).expect(409);
    expect(conflictingReplay.body.error.code).toBe('demo_idempotency_conflict');

    const refreshed = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', cookie).expect(200);
    expect(refreshed.body.data.integrity).toEqual(created.body.data.integrity);
    expect(refreshed.body.data.graphs).toEqual(created.body.data.graphs);

    for (const [kind, objectId] of [['customer', graph.ids.customer], ['lead', graph.ids.lead], ['work', graph.ids.work]]) {
      const detail = await request(app).get(`/api/demo/command-center/polaris/${kind}/${objectId}`)
        .set('Host', 'northstar.test').set('Cookie', cookie).expect(200);
      expect(detail.body.data.ids.graph).toBe(graph.ids.graph);
      expect(detail.body.data.polaris.completeDetail).toBe(true);
      expect(detail.body.integrity.digest).toBe(created.body.data.integrity.digest);
    }

    const stored = (await pool.query(
      `SELECT id, tenant_id, token_hash, revision, simulation_count, mutation_count,
              jsonb_array_length(state -> 'graphs') AS graph_count
         FROM demo_command_center_sessions`
    )).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(expect.objectContaining({
      token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      revision: '2',
      simulation_count: 1,
      mutation_count: 1,
      graph_count: 4,
    }));
    expect(stored[0].token_hash).not.toContain(cookie.split('=')[1]);
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_mutations')).rows[0].count).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();

    await mutation(request(app), cookie, '/api/demo/command-center/reset', 'reset', 'advance-after-replay-00000000000001', {
      expectedRevision: 2,
    }).expect(200);
    const staleReplay = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', key, {
      scenario: RICH_SCENARIO,
      expectedRevision: 1,
    }).expect(409);
    expect(staleReplay.body.error.code).toBe('demo_idempotency_stale');
    await settleAuditLogger();
    expect((await pool.query('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count).toBe(0);
  });

  test('reset is isolated, CAS-fenced, and atomically creates a new fictional tenant authority', async () => {
    const first = await request(app).get('/api/demo/command-center').set('Host', 'northstar.test').expect(200);
    const cookie = cookieFrom(first);
    const initialConfiguration = first.body.data.configuration;
    const initialTenant = first.body.data.tenant;
    const created = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', 'reset-seed-00000000000000000000001', {
      service: 'plumbing', expectedRevision: 1,
    }).expect(201);
    const reset = await mutation(request(app), cookie, '/api/demo/command-center/reset', 'reset', 'reset-action-000000000000000000001', {
      expectedRevision: 2,
    }).expect(200);
    expect(reset.body.data.integrity).toEqual(expect.objectContaining({ revision: 3, graphCount: 3 }));
    expect(reset.body.data.session.simulationCount).toBe(0);
    expect(reset.body.data.session.workspaceGeneration).toBe(2);
    expect(created.body.data.tenant).toEqual(initialTenant);
    expect(created.body.data.configuration).toEqual(initialConfiguration);
    expect(reset.body.data.tenant.id).not.toBe(initialTenant.id);
    expect(reset.body.data.configuration.businessProfile)
      .not.toEqual(initialConfiguration.businessProfile);

    const stale = await mutation(request(app), cookie, '/api/demo/command-center/reset', 'reset', 'stale-reset-0000000000000000000001', {
      expectedRevision: 2,
    }).expect(409);
    expect(stale.body.error.code).toBe('demo_revision_conflict');
    const refreshed = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', cookie).expect(200);
    expect(refreshed.body.data.integrity.revision).toBe(3);
    expect(refreshed.body.data.graphs).toHaveLength(3);
  });

  test('PostgreSQL admission survives process boundaries and hard-bounds aggregate allocation', async () => {
    const {
      DemoCommandCenterRepository,
    } = require('../../src/commandCenter/demoRepository');
    const now = new Date('2026-08-15T22:10:00.000Z');
    let sequence = 0;
    const create = (repository, sourceHash) => {
      sequence += 1;
      return repository.mutate(repository.issue(), {
        operation: 'simulate_lead',
        expectedRevision: 1,
        serviceKey: 'fence',
        idempotencyKey: 'durable-admission-' + String(sequence).padStart(4, '0') + '-0000000000000000',
      }, { sourceHash });
    };

    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');
    await pool.query('TRUNCATE demo_command_center_admission_windows');
    const sourceBound = new DemoCommandCenterRepository(() => pool, {
      clock: () => now,
      maxActiveSessions: 10,
      maxGlobalCreationsPerMinute: 10,
      maxSourceCreationsPerMinute: 2,
    });
    const sourceBoundPeer = new DemoCommandCenterRepository(() => pool, {
      clock: () => now,
      maxActiveSessions: 10,
      maxGlobalCreationsPerMinute: 10,
      maxSourceCreationsPerMinute: 2,
    });
    await create(sourceBound, 'a'.repeat(64));
    await create(sourceBoundPeer, 'a'.repeat(64));
    await expect(create(sourceBound, 'a'.repeat(64))).rejects.toMatchObject({
      status: 429,
      code: 'DEMO_SOURCE_RATE_LIMIT',
    });
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(2);
    expect((await pool.query(
      `SELECT request_count FROM demo_command_center_admission_windows
        WHERE scope = 'source' AND subject_hash = $1`, ['a'.repeat(64)]
    )).rows[0].request_count).toBe(2);

    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');
    await pool.query('TRUNCATE demo_command_center_admission_windows');
    const globalBound = new DemoCommandCenterRepository(() => pool, {
      clock: () => now,
      maxActiveSessions: 10,
      maxGlobalCreationsPerMinute: 2,
      maxSourceCreationsPerMinute: 3,
    });
    await create(globalBound, 'a'.repeat(64));
    await create(globalBound, 'b'.repeat(64));
    await expect(create(globalBound, 'c'.repeat(64))).rejects.toMatchObject({
      status: 429,
      code: 'DEMO_GLOBAL_RATE_LIMIT',
    });
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(2);

    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');
    await pool.query('TRUNCATE demo_command_center_admission_windows');
    const capacityBound = new DemoCommandCenterRepository(() => pool, {
      clock: () => now,
      maxActiveSessions: 2,
      maxGlobalCreationsPerMinute: 10,
      maxSourceCreationsPerMinute: 3,
    });
    const capacityResults = await Promise.allSettled([
      create(capacityBound, 'a'.repeat(64)),
      create(capacityBound, 'b'.repeat(64)),
      create(capacityBound, 'c'.repeat(64)),
    ]);
    expect(capacityResults.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    const capacityFailure = capacityResults.find(result => result.status === 'rejected');
    expect(capacityFailure.reason).toMatchObject({ status: 429, code: 'DEMO_CAPACITY_LIMIT' });
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(2);
  });

  test('the bounded housekeeping worker reclaims expired sessions and admission windows without a public mutation', async () => {
    const {
      DemoCommandCenterHousekeepingWorker,
      DemoCommandCenterRepository,
    } = require('../../src/commandCenter/demoRepository');
    const now = new Date('2026-08-15T23:00:00.000Z');
    await pool.query('TRUNCATE demo_command_center_sessions CASCADE');
    await pool.query('TRUNCATE demo_command_center_admission_windows');
    await pool.query(
      `INSERT INTO demo_command_center_sessions
         (id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
          created_at, updated_at, expires_at)
       VALUES
         ('00000000-0000-4000-8000-0000000000a1',
          '00000000-0000-4000-8000-0000000000a2', $1, '{}'::jsonb, 1, 0, 0,
          $2::timestamptz - INTERVAL '25 hours', $2::timestamptz - INTERVAL '25 hours',
          $2::timestamptz - INTERVAL '1 hour')`,
      ['d'.repeat(64), now]
    );
    await pool.query(
      `INSERT INTO demo_command_center_admission_windows
         (window_start, scope, subject_hash, request_count, created_at, updated_at)
       VALUES ($1::timestamptz - INTERVAL '3 hours', 'source', $2, 1,
               $1::timestamptz - INTERVAL '3 hours', $1::timestamptz - INTERVAL '3 hours')`,
      [now, 'e'.repeat(64)]
    );
    const worker = new DemoCommandCenterHousekeepingWorker({
      repository: new DemoCommandCenterRepository(() => pool, { clock: () => now }),
      batchSize: 10,
      maxBatches: 2,
    });
    await expect(worker.drainOnce()).resolves.toEqual({ sessions: 1, admissionWindows: 1 });
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_admission_windows')).rows[0].count).toBe(0);
  });

  test('paid namespace has no demo mutation surface', async () => {
    const response = await request(app).post('/api/v1/command-center/simulations/leads')
      .send({ service: 'fence', expectedRevision: 1 });
    expect([401, 404, 405]).toContain(response.status);
    expect(response.status).not.toBe(201);
  });

  test('production proxy metadata accepts only the exact public NorthStar origins', async () => {
    const config = require('../../src/config');
    const priorSecureCookies = config.auth.secureCookies;
    config.auth.secureCookies = true;
    try {
      const internalHost = 'northstar-production.up.railway.app';
      const first = await request(app).get('/api/demo/command-center')
        .set('Host', internalHost)
        .expect(200);
      const cookie = cookieFrom(first);
      const accepted = await request(app).post('/api/demo/command-center/simulations/leads')
        .set('Host', internalHost)
        .set('Origin', 'https://northstar-os.ai')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Cookie', cookie)
        .set('Idempotency-Key', 'production-proxy-origin-000000000001')
        .set('X-NorthStar-Demo-Intent', 'simulate-lead')
        .send({ scenario: RICH_SCENARIO, expectedRevision: 1 })
        .expect(201);
      expect(accepted.body.data.integrity.revision).toBe(2);
      expect(accepted.body.data.graphs[0].scenario.selection).toEqual(RICH_SCENARIO);

      const attackerFirst = await request(app).get('/api/demo/command-center')
        .set('Host', internalHost)
        .expect(200);
      const rejected = await request(app).post('/api/demo/command-center/simulations/leads')
        .set('Host', internalHost)
        .set('Origin', 'https://northstar-os.ai.attacker.example')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Cookie', cookieFrom(attackerFirst))
        .set('Idempotency-Key', 'production-proxy-origin-000000000002')
        .set('X-NorthStar-Demo-Intent', 'simulate-lead')
        .send({ scenario: RICH_SCENARIO, expectedRevision: 1 })
        .expect(403);
      expect(rejected.body.error.code).toBe('demo_same_origin_required');
    } finally {
      config.auth.secureCookies = priorSecureCookies;
    }
  });
});
