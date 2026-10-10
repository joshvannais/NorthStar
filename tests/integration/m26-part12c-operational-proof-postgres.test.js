'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { MAX_MUTATIONS, MAX_STATE_BYTES } = require('../../src/commandCenter/demoRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';
const ROOT = '/api/demo/forecast/journey';
const REQUEST_CEILING_MS = 8000;

function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
function tokenHash(savedCookie) {
  const token = decodeURIComponent(savedCookie.slice(savedCookie.indexOf('=') + 1));
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
function action(app, savedCookie, requestKey, body) {
  return request(app).post(`${ROOT}/actions`).set('Host', 'northstar.test')
    .set('Origin', ORIGIN).set('Sec-Fetch-Site', 'same-origin').set('Cookie', savedCookie)
    .set('Idempotency-Key', requestKey).set('X-NorthStar-Demo-Intent', 'forecast-journey')
    .send(body);
}
function issueBody(source) {
  return { action: 'issue', expectedRevision: 1, details: {
    approvedPriceOriginId: source.approvedPriceOriginId,
    reason: 'Prove the bounded fictional operational journey.' } };
}
function rerunBody(run, expectedRevision) {
  return { action: 'rerun', expectedRevision, details: { runId: run.id,
    runDigest: run.receipt.digest, currentnessDigest: run.currentness.digest } };
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); }
async function protectedCounts(pool) {
  return (await pool.query(`SELECT
    (SELECT count(*)::int FROM canonical_forecast_paid_journey_runs_v1) paid_runs,
    (SELECT count(*)::int FROM canonical_forecast_paid_journey_reviews_v1) paid_reviews,
    (SELECT count(*)::int FROM canonical_schedule_assignments) schedules,
    (SELECT count(*)::int FROM canonical_estimate_decisions) estimate_decisions,
    (SELECT count(*)::int FROM canonical_customer_estimate_versions) customer_estimates`)).rows[0];
}

realPostgres('Mission 26 Part 12C operational proof', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('proves migration, concurrent issue, exact replay, restart and minimized telemetry', async () => {
    const initial = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    expect(initial.status).toBe(200);
    const savedCookie = cookie(initial); const body = issueBody(initial.body.data.sourceCandidate);
    const beforeProtected = await protectedCounts(fixture.ownerPool);
    const beforeAudit = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM audit_logs')).rows[0].count);
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const requestKeys = Array.from({ length: 5 }, () => crypto.randomUUID());
    const startedAt = performance.now();
    const concurrent = await Promise.all(requestKeys.map(value =>
      action(fixture.app, savedCookie, value, body)));
    const elapsedMs = performance.now() - startedAt;
    expect(concurrent.map(value => value.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(elapsedMs).toBeLessThan(REQUEST_CEILING_MS);
    const winnerIndex = concurrent.findIndex(value => value.status === 201);
    const winner = concurrent[winnerIndex]; const run = winner.body.data.run;
    const replay = await action(fixture.app, savedCookie, requestKeys[winnerIndex], body);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBeUndefined();
    expect(replay.body).toMatchObject({ replayed: true,
      data: { run: { id: run.id, receipt: { digest: run.receipt.digest } } } });

    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    const recovered = await request(fixture.app).get(ROOT).set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.run).toMatchObject({ id: run.id,
      receipt: { digest: run.receipt.digest }, output: { digest: run.output.digest } });

    await settle();
    const emitted = info.mock.calls.map(value => value[0]).filter(value =>
      value && value.component === 'http' && value.event === 'request_completed' &&
      concurrent.concat(replay).some(response => response.headers['x-request-id'] === value.requestId));
    expect(emitted).toHaveLength(6);
    for (const record of emitted) {
      expect(Object.keys(record).sort()).toEqual(
        ['component','durationMs','event','methodClass','requestId','statusCode'].sort());
      expect(record.methodClass).toBe('POST');
      expect(record.durationMs).toBeLessThan(REQUEST_CEILING_MS);
    }
    const serialized = JSON.stringify(emitted);
    for (const value of [...requestKeys, savedCookie, run.id, fixture.org]) {
      expect(serialized).not.toContain(value);
    }
    info.mockRestore();
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM audit_logs')).rows[0].count)).toBe(beforeAudit);
    expect(await protectedCounts(fixture.ownerPool)).toEqual(beforeProtected);
    expect((await fixture.ownerPool.query(
      "SELECT filename FROM _migrations WHERE filename IN ('258_canonical_forecast_paid_journey_v1.sql','259_demo_forecast_journey.sql') ORDER BY filename"
    )).rows.map(value => value.filename)).toEqual([
      '258_canonical_forecast_paid_journey_v1.sql', '259_demo_forecast_journey.sql']);
    expect((await fixture.ownerPool.query(
      "SELECT 1 FROM _migrations WHERE filename LIKE '260\\_%' ESCAPE '\\'"
    )).rowCount).toBe(0);
  }, 120000);

  test('bounds lock contention, rolls back the failed attempt and recovers with the same request', async () => {
    const initial = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    const savedCookie = cookie(initial); const issue = await action(fixture.app, savedCookie,
      crypto.randomUUID(), issueBody(initial.body.data.sourceCandidate));
    expect(issue.status).toBe(201);
    const run = issue.body.data.run; const requestKey = crypto.randomUUID();
    const body = rerunBody(run, 2);
    const before = (await fixture.ownerPool.query(
      'SELECT revision,mutation_count FROM demo_command_center_sessions WHERE token_hash=$1',
    [tokenHash(savedCookie)])).rows[0];
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM demo_command_center_sessions WHERE token_hash=$1 FOR UPDATE',
        [tokenHash(savedCookie)]);
      const startedAt = performance.now();
      const unavailable = await action(fixture.app, savedCookie, requestKey, body);
      const elapsedMs = performance.now() - startedAt;
      expect(unavailable.status).toBe(503);
      expect(unavailable.body).toMatchObject({ success: false,
        error: { code: 'demo_command_center_unavailable' } });
      expect(elapsedMs).toBeLessThan(5000);
      await blocker.query('COMMIT');
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
    expect((await fixture.ownerPool.query(
      'SELECT revision,mutation_count FROM demo_command_center_sessions WHERE token_hash=$1',
    [tokenHash(savedCookie)])).rows[0]).toEqual(before);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM demo_command_center_mutations WHERE session_id=(SELECT id FROM demo_command_center_sessions WHERE token_hash=$1)',
    [tokenHash(savedCookie)])).rows[0].count).toBe(1);

    const recovered = await action(fixture.app, savedCookie, requestKey, body);
    expect(recovered.status).toBe(201);
    expect(recovered.body.data).toMatchObject({ state: 'reproduced', runId: run.id,
      runDigest: run.receipt.digest, sameResults: true, providerCallCount: 0 });
    const replay = await action(fixture.app, savedCookie, requestKey, body);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true,
      data: { state: 'reproduced', runId: run.id, sameResults: true } });
  }, 120000);

  test('enforces the exact 24-action and 2 MiB bounds while retaining the last replay', async () => {
    expect(MAX_MUTATIONS).toBe(24); expect(MAX_STATE_BYTES).toBe(2097152);
    const initial = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    const savedCookie = cookie(initial); const issued = await action(fixture.app, savedCookie,
      crypto.randomUUID(), issueBody(initial.body.data.sourceCandidate));
    expect(issued.status).toBe(201);
    const run = issued.body.data.run; let lastKey; let lastBody; const durations = [];
    for (let index = 0; index < MAX_MUTATIONS - 1; index += 1) {
      lastKey = crypto.randomUUID(); lastBody = rerunBody(run, index + 2);
      const startedAt = performance.now();
      const response = await action(fixture.app, savedCookie, lastKey, lastBody);
      durations.push(performance.now() - startedAt);
      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ state: 'reproduced', sameResults: true,
        providerCallCount: 0, demoWorkspaceRevision: index + 3 });
    }
    expect(Math.max(...durations)).toBeLessThan(REQUEST_CEILING_MS);
    const atLimit = (await fixture.ownerPool.query(
      `SELECT revision::int revision,mutation_count,octet_length(state::text)::int state_bytes
         FROM demo_command_center_sessions WHERE token_hash=$1`,
    [tokenHash(savedCookie)])).rows[0];
    expect(atLimit).toMatchObject({ revision: 25, mutation_count: MAX_MUTATIONS });
    expect(atLimit.state_bytes).toBeLessThanOrEqual(MAX_STATE_BYTES);
    const mutationCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM demo_command_center_mutations WHERE session_id=(SELECT id FROM demo_command_center_sessions WHERE token_hash=$1)',
    [tokenHash(savedCookie)])).rows[0].count);
    expect(mutationCount).toBe(MAX_MUTATIONS);

    const replay = await action(fixture.app, savedCookie, lastKey, lastBody);
    expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    const denied = await action(fixture.app, savedCookie, crypto.randomUUID(),
      rerunBody(run, 25));
    expect(denied.status).toBe(429);
    expect(denied.body).toMatchObject({ success: false,
      error: { code: 'demo_session_limit' } });
    expect((await fixture.ownerPool.query(
      'SELECT revision::int revision,mutation_count FROM demo_command_center_sessions WHERE token_hash=$1',
    [tokenHash(savedCookie)])).rows[0]).toMatchObject({ revision: 25,
      mutation_count: MAX_MUTATIONS });
  }, 120000);
});
