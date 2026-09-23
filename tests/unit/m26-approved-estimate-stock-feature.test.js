'use strict';

const { deriveApprovedEstimateStockFeature } =
  require('../../src/forecasting/approvedEstimateStockFeature');

const ORG = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const FIRST = '2026-09-21T12:00:00.000000Z';
const LATER = '2026-09-21T13:00:00.000000Z';
const source = (state = 'active', changes = {}) => ({
  sourceKind: 'estimate_decision', sourceId: ID, revision: 1,
  digest: 'a'.repeat(64), recordedAt: '2026-09-21T11:59:00.000000Z',
  eventAt: null, state, ...changes,
});
const receipt = (at, sources, digest = 'c'.repeat(64)) => ({ digest,
  manifest: { version: 'm26-as-of-source-manifest-v1', organizationId: ORG,
    asOf: at, capturedAt: at, purposeKey: 'forecast_pipeline',
    targetKey: 'pipeline.approved_estimates', sources } });
const pair = (historical, current) => ({
  captured: receipt(FIRST, historical),
  current: receipt(LATER, current, 'd'.repeat(64)),
});

test('counts active latest decisions, including a proven empty source', () => {
  expect(deriveApprovedEstimateStockFeature(pair([source()], [source()]), ORG))
    .toMatchObject({ state: 'known', amount: '1',
      unit: { key: 'count', currency: null, scale: 0 },
      sourceAuthenticated: false, forecastIssued: false });
  expect(deriveApprovedEstimateStockFeature(pair([], []), ORG))
    .toMatchObject({ state: 'known', amount: '0',
      sourceAuthenticated: false, forecastIssued: false });
  expect(deriveApprovedEstimateStockFeature(pair([source('tombstone')],
    [source('tombstone')]), ORG)).toMatchObject({ state: 'known', amount: '0' });
});

test('later amendment or withdrawal masks current stock rather than updating history', () => {
  const next = source('tombstone', { revision: 2,
    sourceId: '33333333-3333-4333-8333-333333333333',
    recordedAt: '2026-09-21T12:30:00.000000Z' });
  expect(deriveApprovedEstimateStockFeature(pair([source()], [next]), ORG))
    .toMatchObject({ state: 'stale', amount: null,
      reason: 'source_set_changed', forecastIssued: false });
});

test('rejects wrong tenant, source kind, shape and cutoff', () => {
  const otherTenant = pair([], []);
  otherTenant.current.manifest.organizationId =
    '44444444-4444-4444-8444-444444444444';
  const wrongKind = pair([source()], [source()]);
  wrongKind.captured.manifest.sources[0].sourceKind = 'appointment';
  const brokenCutoff = pair([], []);
  brokenCutoff.captured.manifest.capturedAt = LATER;
  for (const input of [otherTenant, wrongKind, brokenCutoff,
    { captured: receipt(FIRST, []), current: receipt(LATER, []), extra: true }]) {
    expect(() => deriveApprovedEstimateStockFeature(input, ORG)).toThrow();
  }
});
