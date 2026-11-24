'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';
const HIGH_VOLUME_SESSIONS = 24;
const PREVIEW = Object.freeze({
  templateId: 'owner-work-review',
  name: 'Review recorded owner work',
  sourceClassId: 'mission23_work_execution',
  actionFamily: 'internal_read_digest_task',
  recipientClass: 'tenant_owner',
  channelId: 'in_app_passive',
  timing: 'review_now',
  dailyLimit: 1,
});

function cookie(response) {
  const values = response.headers['set-cookie'];
  if (!Array.isArray(values) || !values.length) throw new Error('The isolated demo cookie is unavailable');
  return values[0].split(';')[0];
}

function sameOrigin(agent) {
  return agent.set('Host', 'northstar.test').set('Origin', ORIGIN)
    .set('Sec-Fetch-Site', 'same-origin');
}

function action(app, savedCookie, expectedRevision, automationAction, idempotencyKey) {
  return sameOrigin(request(app).post('/api/demo/automation-center/actions'))
    .set('Cookie', savedCookie)
    .set('Idempotency-Key', idempotencyKey)
    .set('X-NorthStar-Demo-Intent', 'automation-center-action')
    .send({ action: automationAction, expectedRevision });
}

function milliseconds(startedAt) {
  return Number((performance.now() - startedAt).toFixed(3));
}

async function inBatches(values, size, operation) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(...await Promise.all(values.slice(index, index + size)
      .map((value, offset) => operation(value, index + offset))));
  }
  return output;
}

realPostgres('Mission 28 Part 14E fresh PostgreSQL, mounted routes, worker restart and measurements', () => {
  let fixture;
  const measurement = {
    environment: 'local_disposable_postgresql_functional_measurement_not_sla',
    sessions: HIGH_VOLUME_SESSIONS,
    providerFixtureActions: HIGH_VOLUME_SESSIONS * 2,
    realRecipients: 0,
    realProviderCalls: 0,
    externalEffects: 0,
    financialEffects: 0,
    moneyEffects: 0,
  };

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
  }, 300000);

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
    // A single machine observation is useful diagnostic evidence only. No
    // duration in this record is a production benchmark, capacity promise or SLA.
    process.stdout.write(`M28_PART14E_MEASUREMENT=${JSON.stringify(measurement)}\n`);
  }, 180000);

  test('applies every source migration with separated runtime and migration roles', async () => {
    const applied = (await fixture.ownerPool.query(
      `SELECT count(*)::integer total,
              max(substring(filename,1,3)::integer)::integer latest
         FROM public._migrations`
    )).rows[0];
    expect(applied).toEqual({ total: 285, latest: 289 });
    expect((await fixture.ownerPool.query(
      "SELECT count(*)::integer count FROM public._migrations WHERE filename LIKE '290_%'"
    )).rows[0].count).toBe(0);
    expect(fixture.roles.owner).not.toBe(fixture.roles.runtime);
    expect(process.env.DATABASE_URL).not.toBe(process.env.MIGRATION_DATABASE_URL);
  });

  test('uses real paid session, capability, CSRF, route and database boundaries', async () => {
    const owner = fixture.actors.owner;
    const member = fixture.actors.member;
    await require('../../src/automationCenter/repository').readAutomationCenter(
      fixture.db.getPool(), {
        organizationId: owner.organizationId,
        actorUserId: owner.actorUserId,
        actorAccessRole: owner.actorAccessRole,
        authSessionId: owner.authSessionId,
      });
    const read = await request(fixture.app).get('/api/v1/automation-center')
      .set(owner.session.headers);
    if (read.status !== 200) throw new Error(`Mounted paid read failed: ${JSON.stringify(read.body)}`);
    expect(read.headers['cache-control']).toMatch(/private, no-store/);
    expect(read.body).toMatchObject({ success: true, data: {
      version: 'mission28.automation-center.v2',
      status: { id: 'ready_to_set_up' },
    } });

    await expect(fixture.runtimePool.query(
      'SELECT count(*) FROM public.canonical_automation_policy_versions_v1'
    )).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_automation_center_v1_read($1,$2,$3,$4)',
      [crypto.randomUUID(),owner.actorUserId,owner.actorAccessRole,owner.authSessionId]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_automation_center_v1_read($1,$2,$3,$4)',
      [owner.organizationId,crypto.randomUUID(),owner.actorAccessRole,owner.authSessionId]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_automation_center_v1_read($1,$2,$3,$4)',
      [owner.organizationId,owner.actorUserId,owner.actorAccessRole,crypto.randomUUID()]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_automation_center_v1_read($1,$2,$3,$4)',
      [owner.organizationId,owner.actorUserId,'member',owner.authSessionId]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      "SELECT public.canonical_automation_store_policy_v1('{}')"
    )).rejects.toMatchObject({ code: '42501' });

    await request(fixture.app).get('/api/v1/automation-center').expect(401);
    await request(fixture.app).get('/api/v1/automation-center')
      .set(member.session.headers).expect(403);
    await request(fixture.app).get('/api/v1/automation-center')
      .set(fixture.actors.viewer.session.headers).expect(403);
    await request(fixture.app).post('/api/v1/automation-center/preview')
      .set('Cookie', owner.session.headers.Cookie).send(PREVIEW).expect(403);

    const preview = await request(fixture.app).post('/api/v1/automation-center/preview')
      .set(owner.session.headers).send(PREVIEW).expect(200);
    expect(preview.headers['cache-control']).toMatch(/private, no-store/);
    expect(preview.body.data).toMatchObject({ previewOnly: true, saved: false,
      activated: false, recipientContacted: false, providerAttemptCreated: false,
      externalEffectCreated: false, financialEffectCreated: false, moneyEffectCreated: false });
  });

  test('measures bounded high-volume deterministic provider-fixture work with zero effects', async () => {
    const startedAt = performance.now();
    const indexes = Array.from({ length: HIGH_VOLUME_SESSIONS }, (_value, index) => index);
    const initial = await inBatches(indexes, 6, index => request(fixture.app)
      .get('/api/demo/automation-center')
      .set('Host', 'northstar.test').set('User-Agent', `m28-part14e-${index}`)
      .expect(200));
    const cookies = initial.map(cookie);
    expect(initial.every(response => response.body.demo.workspaceRevision === 1)).toBe(true);

    const first = await inBatches(cookies, 6, (savedCookie, index) =>
      action(fixture.app, savedCookie, 1, 'provider_step',
        crypto.createHash('sha256').update(`m28-part14e-first-${index}`).digest('hex'))
        .expect(201));
    expect(first.every(response => response.body.demo.workspaceRevision === 2 &&
      response.body.demo.providerMode === 'deterministic_local_simulation_no_provider')).toBe(true);
    expect(first.every(response => Object.values(response.body.demo.zeroEffects).every(value => value === 0))).toBe(true);

    const second = await inBatches(cookies, 6, (savedCookie, index) =>
      action(fixture.app, savedCookie, 2, 'provider_step',
        crypto.createHash('sha256').update(`m28-part14e-second-${index}`).digest('hex'))
        .expect(201));
    expect(second.every(response => response.body.demo.workspaceRevision === 3)).toBe(true);
    expect(second.every(response => Object.values(response.body.demo.zeroEffects).every(value => value === 0))).toBe(true);

    const persisted = (await fixture.ownerPool.query(
      `SELECT count(DISTINCT sessions.id)::integer sessions,
              count(*)::integer mutations
         FROM public.demo_command_center_sessions sessions
         JOIN public.demo_command_center_mutations mutations
           ON mutations.session_id = sessions.id
        WHERE mutations.operation = 'automation_action'`
    )).rows[0];
    expect(persisted).toEqual({ sessions: HIGH_VOLUME_SESSIONS,
      mutations: HIGH_VOLUME_SESSIONS * 2 });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM public.canonical_automation_action_transactions_v1'
    )).rows[0].count).toBe(0);
    measurement.highVolumeMountedMilliseconds = milliseconds(startedAt);
  }, 180000);

  test('preserves exact provider-fixture state and idempotency across a database-pool restart', async () => {
    const initial = await request(fixture.app).get('/api/demo/automation-center')
      .set('Host', 'northstar.test').expect(200);
    const savedCookie = cookie(initial);
    const idempotencyKey = crypto.randomUUID();
    await action(fixture.app, savedCookie, 1, 'provider_step', idempotencyKey).expect(201);

    const startedAt = performance.now();
    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    measurement.databasePoolRestartMilliseconds = milliseconds(startedAt);

    const afterRestart = await request(fixture.app).get('/api/demo/automation-center')
      .set('Host', 'northstar.test').set('Cookie', savedCookie).expect(200);
    expect(afterRestart.body).toMatchObject({ success: true,
      demo: { workspaceRevision: 2, providerMode: 'deterministic_local_simulation_no_provider' } });
    const replay = await action(fixture.app, savedCookie, 1, 'provider_step', idempotencyKey).expect(200);
    expect(replay.body).toMatchObject({ success: true, replayed: true,
      demo: { workspaceRevision: 2 } });
    expect(Object.values(replay.body.demo.zeroEffects).every(value => value === 0)).toBe(true);
    const paidAfterRestart = await request(fixture.app).get('/api/v1/automation-center')
      .set(fixture.actors.owner.session.headers).expect(200);
    expect(paidAfterRestart.body).toMatchObject({ success: true,
      data: { version: 'mission28.automation-center.v2' } });
  }, 120000);

  test('fails closed during a database outage and recovers without changing saved authority', async () => {
    const initial = await request(fixture.app).get('/api/demo/automation-center')
      .set('Host', 'northstar.test').expect(200);
    const savedCookie = cookie(initial);
    await action(fixture.app, savedCookie, 1, 'provider_step', crypto.randomUUID()).expect(201);
    const savedDatabaseUrl = fixture.runtimeProcess.env.DATABASE_URL;
    const unavailableUrl = new URL(savedDatabaseUrl);
    unavailableUrl.hostname = '127.0.0.1';
    unavailableUrl.port = '1';
    const degradedAt = performance.now();
    await fixture.db.close();
    fixture.runtimeProcess.env.DATABASE_URL = unavailableUrl.toString();
    try {
      const unavailable = await request(fixture.app).get('/api/demo/automation-center')
        .set('Host', 'northstar.test').set('Cookie', savedCookie).expect(503);
      expect(unavailable.body).toMatchObject({ success: false });
      measurement.degradedFailureMilliseconds = milliseconds(degradedAt);
    } finally {
      await fixture.db.close();
      fixture.runtimeProcess.env.DATABASE_URL = savedDatabaseUrl;
    }

    const recoveredAt = performance.now();
    expect(await fixture.db.initDatabase()).toBe(true);
    const recovered = await request(fixture.app).get('/api/demo/automation-center')
      .set('Host', 'northstar.test').set('Cookie', savedCookie).expect(200);
    measurement.degradedRecoveryMilliseconds = milliseconds(recoveredAt);
    expect(recovered.body).toMatchObject({ success: true,
      demo: { workspaceRevision: 2, providerMode: 'deterministic_local_simulation_no_provider' } });
    expect(Object.values(recovered.body.demo.zeroEffects).every(value => value === 0)).toBe(true);
  }, 120000);

  test('drains expired fictional sessions through the production housekeeping worker and restarts cleanly', async () => {
    const api = require('../../src/commandCenter/demoRepository');
    const before = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM public.demo_command_center_sessions')).rows[0].count);
    expect(before).toBeGreaterThanOrEqual(HIGH_VOLUME_SESSIONS);
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const repository = new api.DemoCommandCenterRepository(() => fixture.runtimePool,
      { clock: () => future });
    const worker = new api.DemoCommandCenterHousekeepingWorker({ repository,
      batchSize: 7, maxBatches: 10, intervalMs: 10000 });
    const startedAt = performance.now();
    const drained = await worker.drainOnce();
    worker.stop();
    measurement.housekeepingWorkerMilliseconds = milliseconds(startedAt);
    measurement.housekeepingSessionsDrained = drained.sessions;
    expect(drained.sessions).toBe(before);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM public.demo_command_center_sessions'
    )).rows[0].count).toBe(0);

    const restarted = new api.DemoCommandCenterHousekeepingWorker({ repository,
      batchSize: 7, maxBatches: 10, intervalMs: 10000 });
    await expect(restarted.drainOnce()).resolves.toEqual({ sessions: 0, admissionWindows: 0 });
    restarted.stop();
  }, 120000);
});
