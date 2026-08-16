'use strict';

const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';
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
    expect(first.body.data.navigation).toHaveLength(11);
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
    expect(created.body.data.configuration).toEqual(beforeConfiguration);
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

  test('reset is isolated, CAS-fenced, and leaves stable configuration untouched', async () => {
    const first = await request(app).get('/api/demo/command-center').set('Host', 'northstar.test').expect(200);
    const cookie = cookieFrom(first);
    const created = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', 'reset-seed-00000000000000000000001', {
      service: 'plumbing', expectedRevision: 1,
    }).expect(201);
    const reset = await mutation(request(app), cookie, '/api/demo/command-center/reset', 'reset', 'reset-action-000000000000000000001', {
      expectedRevision: 2,
    }).expect(200);
    expect(reset.body.data.integrity).toEqual(expect.objectContaining({ revision: 3, graphCount: 3 }));
    expect(reset.body.data.session.simulationCount).toBe(0);
    expect(reset.body.data.configuration).toEqual(created.body.data.configuration);

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
