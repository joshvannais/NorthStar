'use strict';

const { captureFeatureView, readFeatureView } =
  require('../../src/forecasting/approvedEstimateStockFeatureV2');

const ORG = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = '22222222-2222-4222-8222-222222222222';
const ESTIMATE = '33333333-3333-4333-8333-333333333333';
const DECISION = '44444444-4444-4444-8444-444444444444';
const AT = '2026-10-02T10:00:00.000000Z';

function source() {
  return { sourceKind: 'estimate_decision', estimateId: ESTIMATE,
    sourceId: DECISION, revision: 1, digest: 'a'.repeat(64),
    recordedAt: '2026-10-02T09:59:00.000000Z', state: 'active' };
}

function snapshot(sources = [source()]) {
  return { id: SNAPSHOT, version: 'm26-approved-estimate-asof-v2',
    organizationId: ORG, asOf: AT, capturedAt: AT,
    purposeKey: 'forecast_pipeline', targetKey: 'pipeline.approved_estimates',
    sources, sourceCount: sources.length, sourceSnapshotDigest: 'b'.repeat(64),
    coverage: { state: 'complete', scope: 'northstar_m24_decision_ledger',
      startsAt: '2026-10-01T00:00:00.000000Z',
      providerCoverageVerified: false, wholeBusinessCoverageVerified: false },
    historicalBoundary: 'Exact immutable NorthStar M24 state at capture; no arbitrary earlier cutoff or off-platform coverage.' };
}

function captured(sources = [source()], changes = {}) {
  return { state: 'complete', snapshot: snapshot(sources), replayed: false,
    sourceCurrent: true, ...changes };
}

function read(sources = [source()], changes = {}) {
  return { snapshot: snapshot(sources), state: 'current', sourceCurrent: true,
    eligibleForForecast: false, forecastIssued: false, ...changes };
}

test('emits an exact authenticated known feature for positive and complete-zero receipts', () => {
  const positive = captureFeatureView(captured(), ORG, AT);
  expect(positive).toMatchObject({
    version: 'm26-approved-estimate-stock-feature-v2', snapshotId: SNAPSHOT,
    sourceAuthenticated: true, targetComplete: true, sourceCurrent: true,
    eligibleForForecast: false, forecastIssued: false,
    coverage: { state: 'complete', scope: 'northstar_m24_decision_ledger',
      providerCoverageVerified: false, wholeBusinessCoverageVerified: false },
    feature: { contractVersion: 'm26-feature-value-v2',
      definitionKey: 'pipeline.approved_estimate_stock', definitionVersion: 'v1',
      state: 'known', amount: '1',
      latestSourceRecordedAt: '2026-10-02T09:59:00.000000Z',
      unit: { key: 'count', currency: null, scale: 0 } },
  });
  expect(captureFeatureView(captured([]), ORG, AT).feature).toMatchObject({
    state: 'known', amount: '0', latestSourceRecordedAt: null });
});

test('withholds stale positive and stale complete-zero values without inventing a timestamp', () => {
  const stalePositive = readFeatureView(read([source()], {
    state: 'stale', sourceCurrent: false }), ORG);
  expect(stalePositive.feature).toMatchObject({ state: 'stale', amount: null,
    reason: 'source_changed', latestSourceRecordedAt: source().recordedAt });
  const staleZero = readFeatureView(read([], {
    state: 'stale', sourceCurrent: false }), ORG);
  expect(staleZero.feature).toMatchObject({ state: 'stale', amount: null,
    reason: 'source_changed', latestSourceRecordedAt: null });
});

test('maps exact coverage refusal to a missing value without claiming source authority', () => {
  const value = captureFeatureView({ state: 'unavailable', reason: 'legacy_order_gap',
    snapshot: null, replayed: false }, ORG, AT);
  expect(value).toMatchObject({ replayed: false,
    sourceAuthenticated: false, targetComplete: false, sourceCurrent: false,
    coverage: { state: 'unavailable', startsAt: null },
    feature: { contractVersion: 'm26-feature-value-v2', state: 'missing',
      amount: null, reason: 'legacy_order_gap', sourceSnapshotDigest: null,
      latestSourceRecordedAt: null } });
});

test('rejects unregistered refusal reasons and malformed authenticated receipts', () => {
  expect(() => captureFeatureView({ state: 'unavailable', reason: 'invented_gap',
    snapshot: null, replayed: false }, ORG, AT)).toThrow();
  const wrongTenant = captured();
  wrongTenant.snapshot.organizationId =
    '55555555-5555-4555-8555-555555555555';
  expect(() => captureFeatureView(wrongTenant, ORG, AT)).toThrow();
  const wrongCount = read();
  wrongCount.snapshot.sourceCount = 2;
  expect(() => readFeatureView(wrongCount, ORG)).toThrow();
});
