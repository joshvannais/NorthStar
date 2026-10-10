'use strict';

const crypto = require('node:crypto');
const { createInitialDemoState } = require('../../src/commandCenter/workspace');
const journey = require('../../src/forecasting/forecastDemoJourney');

const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const createdAt = new Date('2026-10-09T18:00:00.000Z');
const keyHash = value => crypto.createHash('sha256').update(value).digest('hex');

function initial(seed = 'part12b-demo-seed', generation = 1) {
  return createInitialDemoState(tenant, createdAt, { seed, generation });
}

function issue(state, amount) {
  const source = journey.sourceBasis(state);
  if (amount !== undefined) {
    state = JSON.parse(JSON.stringify(state));
    const graph = state.graphs.find(value => value.ids.estimate === source.approvedPriceOriginId);
    graph.estimate.customerPrice = amount;
  }
  const selected = journey.sourceBasis(state);
  return journey.apply(state, { action: 'issue', approvedPriceOriginId: selected.approvedPriceOriginId,
    reason: 'Review this exact fictional approved-price journey.' }, keyHash('issue'),
  new Date('2026-10-09T18:05:00.000Z'));
}

function capturedError(callback) {
  try { callback(); } catch (error) { return error; }
  throw new Error('Expected callback to fail');
}

describe('Mission 26 Part 12B fictional demo journey', () => {
  test('projects one deterministic fictional source with exact stable identities', () => {
    const state = initial();
    const first = journey.journeyEnvelope(state, 1, createdAt);
    const second = journey.journeyEnvelope(initial(), 1, createdAt);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ version: 'm26-paid-journey-v1', state: 'ready',
      targetKey: 'revenue.approved_price_flow', fictionalDemo: true, accountFree: true,
      resettable: true, providerCallCount: 0, liveValidationAvailable: false,
      automaticActionAuthorized: false, demoWorkspaceRevision: 1,
      sourceCandidate: { fictional: true, currency: 'USD' } });
    expect(first.sourceCandidate.amount).toMatch(/^\d+\.00$/);
    const graph = initial().graphs.find(value =>
      value.ids.estimate === first.sourceCandidate.approvedPriceOriginId);
    expect(first.sourceCandidate.capturedAt).toBe(graph.timestamps.createdAt);
    expect(first.sourceCandidate.cutoffAt).toBe(graph.timestamps.snapshotCreatedAt);
    expect(Date.parse(first.sourceCandidate.capturedAt))
      .toBeLessThanOrEqual(Date.parse(first.sourceCandidate.cutoffAt));
    expect(first.sourceCandidate.positionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/transcript|phone|email|customerName|providerPayload/i);
  });

  test('fails closed when selected fictional source chronology is missing, malformed, or reversed', () => {
    const missing = initial('missing-source-time');
    delete missing.graphs[0].timestamps.createdAt;
    expect(capturedError(() => journey.sourceBasis(missing)))
      .toMatchObject({ status: 503, code: 'DEMO_FORECAST_STATE_INVALID' });

    const malformed = initial('malformed-source-time');
    malformed.graphs[0].timestamps.snapshotCreatedAt = 'not-a-timestamp';
    expect(capturedError(() => journey.sourceBasis(malformed)))
      .toMatchObject({ status: 503, code: 'DEMO_FORECAST_STATE_INVALID' });

    const reversed = initial('reversed-source-time');
    reversed.graphs[0].timestamps.createdAt = '2026-10-09T18:01:00.000Z';
    reversed.graphs[0].timestamps.snapshotCreatedAt = '2026-10-09T18:00:00.000Z';
    expect(capturedError(() => journey.sourceBasis(reversed)))
      .toMatchObject({ status: 503, code: 'DEMO_FORECAST_SOURCE_INVALID' });
  });

  test('issues and reproduces the exact server-calculated immutable receipt', () => {
    const saved = issue(initial());
    const current = journey.journeyEnvelope(saved, 2, new Date('2026-10-09T18:06:00.000Z'));
    expect(current).toMatchObject({ state: 'current', fictionalDemo: true,
      providerCallCount: 0, run: { target: { key: 'revenue.approved_price_flow',
        semantic: 'future_human_approved_commercial_price_decisions' },
      algorithm: { key: 'approved_price_carry_forward', version: 'm26-paid-approved-price-flow-v1' },
      output: { predictionKind: 'deterministic_point', fictional: true,
        uncertainty: { state: 'unquantified', calibratedIntervalAvailable: false } },
      explanation: { fictional: true, customerSafe: true, advisoryOnly: true },
      review: { receiverAvailability: 'unavailable', receiverMutationCount: 0 },
      automaticActionAuthorized: false, outboundCommunicationAuthorized: false } });
    const input = { action: 'rerun', runId: current.run.id, runDigest: current.run.receipt.digest,
      currentnessDigest: current.run.currentness.digest };
    expect(journey.rerunProjection(saved, 3, input)).toMatchObject({ state: 'reproduced',
      sameResults: true, fictionalDemo: true, providerCallCount: 0, demoWorkspaceRevision: 3,
      storedOutputDigest: current.run.output.digest, freshOutputDigest: current.run.output.digest });
    expect(journey.apply(saved, input, keyHash('rerun'))).toEqual(saved);
  });

  test('keeps zero distinct from absent or unavailable', () => {
    const saved = issue(initial('zero-price-demo'), 0);
    const current = journey.journeyEnvelope(saved, 2, createdAt);
    expect(current.state).toBe('current');
    expect(current.run.output.value.amount).toBe('0.00');
    expect(current.run.output.uncertainty.state).toBe('unquantified');
    expect(current.review.availability).toBe('unavailable');
  });

  test('keeps the issued source pinned and projects stale currentness when a newer graph appears', () => {
    const saved = issue(initial('source-transition-demo'));
    const issued = journey.journeyEnvelope(saved, 2, createdAt);
    const changed = JSON.parse(JSON.stringify(saved));
    const newer = JSON.parse(JSON.stringify(changed.graphs[0]));
    newer.ids.estimate = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    newer.ids.polarisSnapshot = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    newer.polaris.snapshotDigest = 'd'.repeat(64);
    newer.estimate.customerPrice += 100;
    newer.timestamps.createdAt = '2026-10-09T18:10:00.000Z';
    newer.timestamps.snapshotCreatedAt = '2026-10-09T18:10:00.000Z';
    changed.graphs.unshift(newer);

    const projected = journey.journeyEnvelope(changed, 3,
      new Date('2026-10-09T18:11:00.000Z'));
    expect(projected).toMatchObject({ state: 'current',
      review: { requestReviewAvailable: false }, run: {
        id: issued.run.id,
        source: { approvedPriceOriginId: issued.run.source.approvedPriceOriginId,
          sourceSnapshotDigest: issued.run.source.sourceSnapshotDigest,
          positionDigest: issued.run.source.positionDigest },
        receipt: { digest: issued.run.receipt.digest },
        output: { digest: issued.run.output.digest },
        currentness: { state: 'stale', revision: 2,
          adviceDisplayAuthorized: false, reason: 'newer_fictional_source' } } });
    expect(projected.run.currentness.digest).not.toBe(issued.run.currentness.digest);
    const rerun = { action: 'rerun', runId: issued.run.id,
      runDigest: issued.run.receipt.digest,
      currentnessDigest: projected.run.currentness.digest };
    expect(journey.rerunProjection(changed, 3, rerun)).toMatchObject({
      state: 'unavailable', reason: 'source_changed', runId: null });
    expect(capturedError(() => journey.apply(changed, rerun, keyHash('stale-source'))))
      .toMatchObject({ status: 409, code: 'DEMO_FORECAST_SOURCE_CHANGED' });
  });

  test('records immutable request, dismissal, and projected expiry without receiver mutation', () => {
    let state = issue(initial());
    let current = journey.journeyEnvelope(state, 2, createdAt);
    const expiry = '2026-10-16T18:10:00.000Z';
    state = journey.apply(state, { action: 'requested', runId: current.run.id,
      runDigest: current.run.receipt.digest, currentnessDigest: current.run.currentness.digest,
      expectedRevision: null, expectedDigest: null, expiresAt: expiry }, keyHash('request'),
    new Date('2026-10-09T18:10:00.000Z'));
    current = journey.journeyEnvelope(state, 3, new Date('2026-10-09T18:11:00.000Z'));
    const requested = current.run.review.history[0];
    expect(requested).toMatchObject({ revision: 1, action: 'requested', recordedAction: 'requested',
      organizationId: state.workspace.tenant.id, actorAccessRole: 'owner', predecessorDigest: null,
      recommendationType: 'review_approved_price_flow',
      receiving: { availability: 'unavailable', reason: 'no_exact_receiving_adapter' } });
    expect(requested.missingInformation).toEqual(expect.arrayContaining([
      'natural_observation_history', 'empirical_calibration', 'live_provider_validation']));
    expect(current.run.review.receiverMutationCount).toBe(0);
    state = journey.apply(state, { action: 'dismissed', runId: current.run.id,
      runDigest: current.run.receipt.digest, currentnessDigest: current.run.currentness.digest,
      expectedRevision: requested.revision, expectedDigest: requested.digest, expiresAt: expiry },
    keyHash('dismiss'), new Date('2026-10-09T18:12:00.000Z'));
    current = journey.journeyEnvelope(state, 4, new Date('2026-10-09T18:13:00.000Z'));
    expect(current.run.review.history).toHaveLength(2);
    expect(current.run.review.history[1]).toMatchObject({ revision: 2, action: 'dismissed',
      predecessorDigest: requested.digest });

    let expiring = issue(initial('expiry-demo'));
    const expiringRun = journey.journeyEnvelope(expiring, 2, createdAt).run;
    expiring = journey.apply(expiring, { action: 'requested', runId: expiringRun.id,
      runDigest: expiringRun.receipt.digest, currentnessDigest: expiringRun.currentness.digest,
      expectedRevision: null, expectedDigest: null, expiresAt: '2026-10-09T20:00:00.000Z' },
    keyHash('expiry'), new Date('2026-10-09T18:15:00.000Z'));
    expect(journey.journeyEnvelope(expiring, 3, new Date('2026-10-09T20:00:01.000Z'))
      .run.review.history[0]).toMatchObject({ action: 'expired', recordedAction: 'requested' });
  });

  test('fails closed on stale identities and a reset clears history with new deterministic identities', () => {
    const state = initial(); const source = journey.sourceBasis(state);
    expect(capturedError(() => journey.apply(state, { action: 'issue',
      approvedPriceOriginId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reason: 'Review wrong source.' },
    keyHash('wrong')))).toMatchObject({ status: 409, code: 'DEMO_FORECAST_SOURCE_CHANGED' });
    const saved = issue(state); const current = journey.journeyEnvelope(saved, 2, createdAt);
    expect(capturedError(() => journey.apply(saved, { action: 'rerun', runId: current.run.id,
      runDigest: 'f'.repeat(64), currentnessDigest: current.run.currentness.digest },
    keyHash('stale')))).toMatchObject({ status: 409, code: 'DEMO_FORECAST_RUN_CHANGED' });
    expect(capturedError(() => journey.apply(saved, { action: 'issue', approvedPriceOriginId: source.approvedPriceOriginId,
      reason: 'Review duplicate source.' }, keyHash('duplicate'))))
      .toMatchObject({ status: 409, code: 'DEMO_FORECAST_ALREADY_ISSUED' });

    const reset = initial('part12b-demo-seed:reset', 2);
    const ready = journey.journeyEnvelope(reset, 1, createdAt);
    expect(ready.state).toBe('ready'); expect(ready.run).toBeNull();
    expect(ready.sourceCandidate.positionId).not.toBe(current.run.source.positionId);
  });
});
