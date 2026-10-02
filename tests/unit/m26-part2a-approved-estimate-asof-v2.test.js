'use strict';

const { captureView, readView } =
  require('../../src/forecasting/approvedEstimateAsOfV2');

const ORG = '11000000-0000-4000-8000-000000000001';
const SNAPSHOT = '12000000-0000-4000-8000-000000000001';
const ESTIMATE = '13000000-0000-4000-8000-000000000001';
const DECISION = '14000000-0000-4000-8000-000000000001';
const NOW = '2026-10-02T05:00:00.000000Z';
const EPOCH = '2026-10-02T04:00:00.000000Z';

function snapshot(sources = []) {
  return { id: SNAPSHOT, version: 'm26-approved-estimate-asof-v2',
    organizationId: ORG, asOf: NOW, capturedAt: NOW,
    purposeKey: 'forecast_pipeline', targetKey: 'pipeline.approved_estimates',
    sources, sourceCount: sources.length, sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', scope: 'northstar_m24_decision_ledger',
      startsAt: EPOCH, providerCoverageVerified: false,
      wholeBusinessCoverageVerified: false },
    historicalBoundary: 'Exact immutable NorthStar M24 state at capture; no arbitrary earlier cutoff or off-platform coverage.' };
}

describe('Mission 26 Part 2A approved-estimate as-of v2 contract', () => {
  test('accepts a complete observed zero without inventing provider coverage', () => {
    expect(captureView({ state: 'complete', snapshot: snapshot(), replayed: false }, ORG))
      .toEqual(expect.objectContaining({ state: 'current', sourceCount: 0,
        targetComplete: true, providerCoverageVerified: false,
        wholeBusinessCoverageVerified: false, forecastIssued: false }));
  });

  test('preserves explicit unavailable coverage without a partial receipt', () => {
    expect(captureView({ state: 'unavailable', reason: 'legacy_order_gap',
      snapshot: null, replayed: false }, ORG)).toEqual(expect.objectContaining({
      state: 'unavailable', reason: 'legacy_order_gap', snapshotId: null,
      sourceAuthenticated: false, targetComplete: false }));
  });

  test('reports later approval, correction or withdrawal as stale', () => {
    const pin = { sourceKind: 'estimate_decision', estimateId: ESTIMATE,
      sourceId: DECISION, revision: 1, digest: 'b'.repeat(64),
      recordedAt: NOW, state: 'active' };
    expect(readView({ snapshot: snapshot([pin]), state: 'stale',
      sourceCurrent: false, eligibleForForecast: false, forecastIssued: false }, ORG))
      .toEqual(expect.objectContaining({ state: 'stale', reason: 'source_changed',
        sourceCount: 1, sourceCurrent: false, eligibleForForecast: false }));
  });

  test.each([
    ['cross-tenant receipt', value => { value.snapshot.organizationId = DECISION; }],
    ['provider completeness escalation', value => {
      value.snapshot.coverage.providerCoverageVerified = true;
    }],
    ['future source pin', value => { value.snapshot.sources[0].recordedAt =
      '2026-10-02T06:00:00.000000Z'; }],
    ['source-count mismatch', value => { value.snapshot.sourceCount = 0; }],
  ])('fails closed on %s', (_name, mutate) => {
    const pin = { sourceKind: 'estimate_decision', estimateId: ESTIMATE,
      sourceId: DECISION, revision: 1, digest: 'b'.repeat(64),
      recordedAt: NOW, state: 'active' };
    const value = { state: 'complete', snapshot: snapshot([pin]), replayed: false };
    mutate(value);
    expect(() => captureView(value, ORG)).toThrow();
  });
});
