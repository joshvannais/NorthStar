'use strict';

const crypto = require('node:crypto');
const { lineageReplayView } =
  require('../../src/forecasting/approvedEstimateLineageReplayV2');

const organizationId = crypto.randomUUID();
const snapshotId = crypto.randomUUID();
const instant = '2026-10-02T10:00:00.000000Z';
const epoch = '2026-10-01T00:00:00.000000Z';

function snapshot(sources = []) {
  return { id: snapshotId, version: 'm26-approved-estimate-asof-v2',
    organizationId, asOf: instant, capturedAt: instant,
    purposeKey: 'forecast_pipeline', targetKey: 'pipeline.approved_estimates',
    sources, sourceCount: sources.length, sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', scope: 'northstar_m24_decision_ledger',
      startsAt: epoch, providerCoverageVerified: false,
      wholeBusinessCoverageVerified: false },
    historicalBoundary: 'Exact immutable NorthStar M24 state at capture; no arbitrary earlier cutoff or off-platform coverage.' };
}

function page(changes = {}) {
  return { version: 'm26-approved-estimate-lineage-replay-v2',
    items: [{ snapshot: snapshot(), state: 'current', sourceCurrent: true,
      eligibleForForecast: false, forecastIssued: false }],
    nextCursor: { version: 'm26-approved-estimate-lineage-replay-v2', offset: 1,
      requestDigest: 'b'.repeat(64), currentGenerationDigest: 'c'.repeat(64) },
    sourceAuthenticated: true, targetComplete: true, forecastIssued: false,
    ...changes };
}

describe('Mission 26 Part 2D target-complete lineage replay projection', () => {
  test('projects bounded current and stale pages without issuing a forecast', () => {
    const current = lineageReplayView(page(), organizationId);
    expect(current).toMatchObject({
      version: 'm26-approved-estimate-lineage-replay-v2',
      sourceAuthenticated: true, targetComplete: true,
      recovery: { mode: 'bounded_pull', restartOnSourceChange: true,
        durableForecastCheckpoint: false },
      lifecycleCoverage: { correction: true, withdrawalTombstone: true,
        currentAccessRevocation: true, retentionPolicyImplemented: false,
        deletionEventImplemented: false },
      eligibleForForecast: false, forecastIssued: false,
      results: [{ sourceCurrent: true, feature: { state: 'known', amount: '0' } }],
    });
    const stale = lineageReplayView(page({ items: [{ snapshot: snapshot(),
      state: 'stale', sourceCurrent: false, eligibleForForecast: false,
      forecastIssued: false }], nextCursor: null }), organizationId);
    expect(stale.results[0]).toMatchObject({ sourceCurrent: false,
      feature: { state: 'stale', amount: null, reason: 'source_changed' } });
  });

  test('rejects malformed pages, sparse results, tenants and recovery cursors', () => {
    const sparse = new Array(1);
    for (const invalid of [
      page({ sourceAuthenticated: false }),
      page({ items: sparse }),
      page({ nextCursor: { version: 'm26-approved-estimate-lineage-replay-v2',
        offset: 0, requestDigest: 'b'.repeat(64),
        currentGenerationDigest: 'c'.repeat(64) } }),
      page({ items: [{ snapshot: { ...snapshot(), organizationId: crypto.randomUUID() },
        state: 'current', sourceCurrent: true, eligibleForForecast: false,
        forecastIssued: false }] }),
    ]) expect(() => lineageReplayView(invalid, organizationId))
      .toThrow('Approved-estimate lineage replay is invalid.');
  });
});
