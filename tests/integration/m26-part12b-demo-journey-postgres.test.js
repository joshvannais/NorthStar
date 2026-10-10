'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { DEFAULT_SELECTION } = require('../../src/commandCenter/scenarioSpace');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';
const ROOT = '/api/demo/forecast/journey';

function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
function action(app, savedCookie, key, body, intent = 'forecast-journey') {
  return request(app).post(`${ROOT}/actions`).set('Host', 'northstar.test')
    .set('Origin', ORIGIN).set('Sec-Fetch-Site', 'same-origin').set('Cookie', savedCookie)
    .set('Idempotency-Key', key).set('X-NorthStar-Demo-Intent', intent).send(body);
}
async function protectedCounts(pool) {
  return (await pool.query(`SELECT
    (SELECT count(*)::int FROM canonical_forecast_paid_journey_runs_v1) paid_runs,
    (SELECT count(*)::int FROM canonical_forecast_paid_journey_reviews_v1) paid_reviews,
    (SELECT count(*)::int FROM canonical_schedule_assignments) schedules,
    (SELECT count(*)::int FROM canonical_estimate_decisions) estimate_decisions,
    (SELECT count(*)::int FROM canonical_customer_estimate_versions) customer_estimates`)).rows[0];
}

realPostgres('Mission 26 Part 12B mounted fictional demo journey', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('persists, replays, restarts and resets one isolated journey without paid or receiver mutation', async () => {
    const before = await protectedCounts(fixture.ownerPool);
    const first = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    expect(first.status).toBe(200); const firstCookie = cookie(first);
    expect(first.body.data).toMatchObject({ state: 'ready', fictionalDemo: true,
      accountFree: true, resettable: true, providerCallCount: 0, demoWorkspaceRevision: 1,
      sourceCandidate: { fictional: true } });
    const originalSource = first.body.data.sourceCandidate;
    const issueKey = crypto.randomUUID();
    const issueBody = { action: 'issue', expectedRevision: 1, details: {
      approvedPriceOriginId: originalSource.approvedPriceOriginId,
      reason: 'Review the exact fictional approved-price journey.' } };
    const issued = await action(fixture.app, firstCookie, issueKey, issueBody);
    expect(issued.status).toBe(201);
    expect(issued.body).toMatchObject({ success: true, replayed: false, data: {
      state: 'current', fictionalDemo: true, providerCallCount: 0, demoWorkspaceRevision: 2,
      run: { source: { approvedPriceOriginId: originalSource.approvedPriceOriginId,
        positionDigest: originalSource.positionDigest, fictional: true },
      output: { predictionKind: 'deterministic_point', fictional: true },
      review: { receiverMutationCount: 0 }, automaticActionAuthorized: false,
      outboundCommunicationAuthorized: false } } });
    const run = issued.body.data.run;
    const replay = await action(fixture.app, firstCookie, issueKey, issueBody);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, data: { run: { id: run.id,
      receipt: { digest: run.receipt.digest }, output: { digest: run.output.digest } } } });

    const rerun = await action(fixture.app, firstCookie, crypto.randomUUID(), {
      action: 'rerun', expectedRevision: 2, details: { runId: run.id,
        runDigest: run.receipt.digest, currentnessDigest: run.currentness.digest } });
    expect(rerun.status).toBe(201);
    expect(rerun.body.data).toMatchObject({ state: 'reproduced', sameResults: true,
      storedOutputDigest: run.output.digest, freshOutputDigest: run.output.digest,
      fictionalDemo: true, providerCallCount: 0, demoWorkspaceRevision: 3 });

    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const requested = await action(fixture.app, firstCookie, crypto.randomUUID(), {
      action: 'requested', expectedRevision: 3, details: { runId: run.id,
        runDigest: run.receipt.digest, currentnessDigest: run.currentness.digest,
        expectedRevision: null, expectedDigest: null, expiresAt } });
    expect(requested.status).toBe(201);
    const event = requested.body.data.run.review.history[0];
    expect(event).toMatchObject({ revision: 1, action: 'requested', recordedAction: 'requested',
      recommendationType: 'review_approved_price_flow', receiving: { availability: 'unavailable' } });
    expect(requested.body.data.run.review.receiverMutationCount).toBe(0);

    const dismissed = await action(fixture.app, firstCookie, crypto.randomUUID(), {
      action: 'dismissed', expectedRevision: 4, details: { runId: run.id,
        runDigest: run.receipt.digest, currentnessDigest: run.currentness.digest,
        expectedRevision: event.revision, expectedDigest: event.digest, expiresAt } });
    expect(dismissed.status).toBe(201);
    expect(dismissed.body.data.run.review.history).toHaveLength(2);
    expect(dismissed.body.data.run.review.history[1]).toMatchObject({ action: 'dismissed',
      predecessorDigest: event.digest });

    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    const recovered = await request(fixture.app).get(ROOT).set('Host', 'northstar.test')
      .set('Cookie', firstCookie);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.run).toMatchObject({ id: run.id,
      receipt: { digest: run.receipt.digest }, output: { digest: run.output.digest },
      review: { history: [{ action: 'requested' }, { action: 'dismissed' }] } });

    const reset = await request(fixture.app).post('/api/demo/command-center/reset')
      .set('Host', 'northstar.test').set('Origin', ORIGIN).set('Sec-Fetch-Site', 'same-origin')
      .set('Cookie', firstCookie).set('Idempotency-Key', crypto.randomUUID())
      .set('X-NorthStar-Demo-Intent', 'reset').send({ expectedRevision: 5 });
    expect(reset.status).toBe(200);
    const afterReset = await request(fixture.app).get(ROOT).set('Host', 'northstar.test')
      .set('Cookie', firstCookie);
    expect(afterReset.body.data).toMatchObject({ state: 'ready', run: null,
      fictionalDemo: true, providerCallCount: 0 });
    expect(afterReset.body.data.sourceCandidate.positionId).not.toBe(run.source.positionId);

    const second = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    expect(second.status).toBe(200);
    expect(cookie(second)).not.toBe(firstCookie);
    expect(second.body.data.state).toBe('ready'); expect(second.body.data.run).toBeNull();
    expect(second.body.data.sourceCandidate.positionId)
      .not.toBe(afterReset.body.data.sourceCandidate.positionId);

    expect(await protectedCounts(fixture.ownerPool)).toEqual(before);
    const operations = (await fixture.ownerPool.query(
      `SELECT operation FROM demo_command_center_mutations ORDER BY created_at`)).rows
      .map(value => value.operation);
    expect(operations).toEqual(['forecast_journey','forecast_journey','forecast_journey','forecast_journey','reset']);
    const migration = await fixture.ownerPool.query(
      `SELECT 1 FROM _migrations WHERE filename='259_demo_forecast_journey.sql'`);
    expect(migration.rowCount).toBe(1);
  }, 120000);

  test('keeps the issued source pinned and marks it stale after a newer fictional lead graph', async () => {
    const before = await protectedCounts(fixture.ownerPool);
    const first = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    expect(first.status).toBe(200);
    const savedCookie = cookie(first); const source = first.body.data.sourceCandidate;
    const issued = await action(fixture.app, savedCookie, crypto.randomUUID(), {
      action: 'issue', expectedRevision: 1, details: {
        approvedPriceOriginId: source.approvedPriceOriginId,
        reason: 'Review the pinned source across a newer fictional lead.' } });
    expect(issued.status).toBe(201);
    const original = issued.body.data.run;

    const simulated = await request(fixture.app)
      .post('/api/demo/command-center/simulations/leads')
      .set('Host', 'northstar.test').set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin').set('Cookie', savedCookie)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('X-NorthStar-Demo-Intent', 'simulate-lead')
      .send({ expectedRevision: 2, scenario: DEFAULT_SELECTION });
    expect(simulated.status).toBe(201);
    expect(simulated.body.data.integrity.revision).toBe(3);

    const reread = await request(fixture.app).get(ROOT).set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(reread.status).toBe(200);
    expect(reread.body.data).toMatchObject({ state: 'current', demoWorkspaceRevision: 3,
      review: { requestReviewAvailable: false }, run: {
        id: original.id,
        source: { approvedPriceOriginId: source.approvedPriceOriginId,
          positionDigest: original.source.positionDigest,
          sourceSnapshotDigest: original.source.sourceSnapshotDigest },
        receipt: { digest: original.receipt.digest },
        output: { digest: original.output.digest },
        currentness: { state: 'stale', revision: 2,
          adviceDisplayAuthorized: false, reason: 'newer_fictional_source' } } });
    expect(reread.body.data.run.currentness.digest).not.toBe(original.currentness.digest);

    const rejected = await action(fixture.app, savedCookie, crypto.randomUUID(), {
      action: 'rerun', expectedRevision: 3, details: { runId: original.id,
        runDigest: original.receipt.digest,
        currentnessDigest: reread.body.data.run.currentness.digest } });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('demo_forecast_source_changed');
    const afterFailure = await request(fixture.app).get(ROOT).set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(afterFailure.status).toBe(200);
    expect(afterFailure.body.data).toMatchObject({ demoWorkspaceRevision: 3, run: {
      id: original.id, receipt: { digest: original.receipt.digest },
      currentness: { state: 'stale', digest: reread.body.data.run.currentness.digest } } });
    expect(await protectedCounts(fixture.ownerPool)).toEqual(before);
  }, 120000);

  test('uses the selected simulated graph chronology when simulation precedes issuance', async () => {
    const before = await protectedCounts(fixture.ownerPool);
    const first = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    expect(first.status).toBe(200);
    const savedCookie = cookie(first);

    const simulated = await request(fixture.app)
      .post('/api/demo/command-center/simulations/leads')
      .set('Host', 'northstar.test').set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin').set('Cookie', savedCookie)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('X-NorthStar-Demo-Intent', 'simulate-lead')
      .send({ expectedRevision: 1, scenario: DEFAULT_SELECTION });
    expect(simulated.status).toBe(201);
    expect(simulated.body.data.integrity.revision).toBe(2);

    const reread = await request(fixture.app).get(ROOT).set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(reread.status).toBe(200);
    expect(reread.body.data).toMatchObject({ state: 'ready', demoWorkspaceRevision: 2,
      sourceCandidate: { fictional: true } });
    const candidate = reread.body.data.sourceCandidate;
    const selectedGraph = simulated.body.data.graphs.find(graph =>
      graph.ids.estimate === candidate.approvedPriceOriginId);
    expect(selectedGraph).toBeDefined();
    expect(candidate.capturedAt).toBe(selectedGraph.timestamps.createdAt);
    expect(candidate.cutoffAt).toBe(selectedGraph.timestamps.snapshotCreatedAt);
    expect(Date.parse(selectedGraph.timestamps.createdAt))
      .toBeLessThanOrEqual(Date.parse(candidate.capturedAt));
    expect(Date.parse(selectedGraph.timestamps.snapshotCreatedAt))
      .toBeLessThanOrEqual(Date.parse(candidate.cutoffAt));
    expect(Date.parse(candidate.capturedAt)).toBeLessThanOrEqual(Date.parse(candidate.cutoffAt));

    const issued = await action(fixture.app, savedCookie, crypto.randomUUID(), {
      action: 'issue', expectedRevision: 2, details: {
        approvedPriceOriginId: candidate.approvedPriceOriginId,
        reason: 'Review the exact simulated fictional source chronology.' } });
    expect(issued.status).toBe(201);
    const run = issued.body.data.run;
    expect(run).toMatchObject({ source: {
      approvedPriceOriginId: candidate.approvedPriceOriginId,
      sourceSnapshotDigest: candidate.sourceSnapshotDigest,
      positionDigest: candidate.positionDigest,
      capturedAt: candidate.capturedAt,
      cutoffAt: candidate.cutoffAt,
    }, currentness: { state: 'unchanged_candidate', revision: 1 } });
    expect(run.source.reportingWindowDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(run.receipt.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(run.currentness.digest).toMatch(/^[a-f0-9]{64}$/);

    const recovered = await request(fixture.app).get(ROOT).set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data).toMatchObject({ state: 'current', demoWorkspaceRevision: 3,
      sourceCandidate: null, run: {
        id: run.id,
        source: {
          approvedPriceOriginId: candidate.approvedPriceOriginId,
          sourceSnapshotDigest: candidate.sourceSnapshotDigest,
          positionDigest: candidate.positionDigest,
          reportingWindowDigest: run.source.reportingWindowDigest,
          capturedAt: candidate.capturedAt,
          cutoffAt: candidate.cutoffAt,
        },
        receipt: { digest: run.receipt.digest },
        currentness: { state: 'unchanged_candidate', revision: 1,
          digest: run.currentness.digest } } });
    expect(await protectedCounts(fixture.ownerPool)).toEqual(before);
  }, 120000);

  test('denies cross-origin, wrong intent, stale revisions, conflicting replay and stale run identities', async () => {
    const entry = await request(fixture.app).get(ROOT).set('Host', 'northstar.test');
    const savedCookie = cookie(entry); const source = entry.body.data.sourceCandidate;
    const body = { action: 'issue', expectedRevision: 1, details: {
      approvedPriceOriginId: source.approvedPriceOriginId,
      reason: 'Review fictional denial boundary evidence.' } };
    expect((await request(fixture.app).post(`${ROOT}/actions`).set('Host', 'northstar.test')
      .set('Origin', 'https://attacker.example').set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', savedCookie).set('Idempotency-Key', crypto.randomUUID())
      .set('X-NorthStar-Demo-Intent', 'forecast-journey').send(body)).status).toBe(403);
    expect((await action(fixture.app, savedCookie, crypto.randomUUID(), body, 'reset')).status).toBe(403);
    const key = crypto.randomUUID();
    const concurrent = await Promise.all([
      action(fixture.app, savedCookie, key, body),
      action(fixture.app, savedCookie, crypto.randomUUID(), body),
    ]);
    expect(concurrent.map(value => value.status).sort()).toEqual([201, 409]);
    const issued = concurrent.find(value => value.status === 201); const run = issued.body.data.run;
    const conflict = await action(fixture.app, savedCookie, key, { ...body,
      details: { ...body.details, reason: 'A different fictional reason must conflict.' } });
    expect(conflict.status).toBe(409);
    const staleRevision = await action(fixture.app, savedCookie, crypto.randomUUID(), {
      action: 'rerun', expectedRevision: 1, details: { runId: run.id,
        runDigest: run.receipt.digest, currentnessDigest: run.currentness.digest } });
    expect(staleRevision.status).toBe(409);
    const staleRun = await action(fixture.app, savedCookie, crypto.randomUUID(), {
      action: 'rerun', expectedRevision: 2, details: { runId: run.id,
        runDigest: 'f'.repeat(64), currentnessDigest: run.currentness.digest } });
    expect(staleRun.status).toBe(409);
    expect(await protectedCounts(fixture.ownerPool)).toMatchObject({ paid_runs: 0, paid_reviews: 0 });
  }, 120000);
});
