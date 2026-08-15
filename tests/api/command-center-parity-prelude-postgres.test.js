'use strict';

const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';

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

    const rejected = await request(app).post('/api/demo/command-center/simulations/leads')
      .set('Host', 'northstar.test')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'missing-origin-0000000000000000')
      .set('X-NorthStar-Demo-Intent', 'simulate-lead')
      .send({ service: 'fence', expectedRevision: 1 })
      .expect(403);
    expect(rejected.body.error.code).toBe('demo_same_origin_required');
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(0);
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
      service: 'fence',
      expectedRevision: 1,
    }).expect(201);

    expect(created.body.replayed).toBe(false);
    expect(created.body.data.integrity).toEqual(expect.objectContaining({ revision: 2, graphCount: 4 }));
    expect(created.body.data.session).toEqual(expect.objectContaining({ durable: true, simulationCount: 1 }));
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_command_center_sessions')).rows[0].count).toBe(1);
    expect(created.body.data.configuration).toEqual(beforeConfiguration);
    const graph = created.body.data.graphs[0];
    expect(graph).toEqual(expect.objectContaining({
      customer: expect.objectContaining({ fictional: true }),
      lead: expect.objectContaining({ serviceType: 'fence' }),
      work: expect.objectContaining({ id: expect.any(String) }),
      polaris: expect.objectContaining({ completeDetail: true, snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    }));

    const replay = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', key, {
      service: 'fence',
      expectedRevision: 1,
    }).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.data.integrity.revision).toBe(2);
    expect(replay.body.data.graphs).toHaveLength(4);

    const conflictingReplay = await mutation(request(app), cookie, '/api/demo/command-center/simulations/leads', 'simulate-lead', key, {
      service: 'roofing',
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
      service: 'fence',
      expectedRevision: 1,
    }).expect(409);
    expect(staleReplay.body.error.code).toBe('demo_idempotency_stale');
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

  test('paid namespace has no demo mutation surface', async () => {
    const response = await request(app).post('/api/v1/command-center/simulations/leads')
      .send({ service: 'fence', expectedRevision: 1 });
    expect([401, 404, 405]).toContain(response.status);
    expect(response.status).not.toBe(201);
  });
});
