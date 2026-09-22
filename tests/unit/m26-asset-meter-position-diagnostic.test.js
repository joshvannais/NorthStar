'use strict';
const crypto = require('node:crypto');
const { VERSION, MAX_USES, summarizeAssetMeterPosition: summarize } =
  require('../../src/forecasting/assetMeterPositionDiagnostic');
const ORG = crypto.randomUUID();
function sample() {
  return { version: VERSION, organizationId: ORG,
    asOf: '2026-09-30T00:00:00.000Z',
    horizon: { startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z' },
    sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', hasMore: false },
    asset: { assetId: crypto.randomUUID(), organizationId: ORG,
      meterKey: 'engine hours', unit: 'hours', reading: '492.5',
      readingObservedAt: '2026-09-30T00:00:00.000Z', threshold: '500',
      thresholdSourceDigest: 'b'.repeat(64), meterResetSinceReading: false,
      plannedUses: [{ useId: crypto.randomUUID(), jobId: crypto.randomUUID(),
        planDigest: 'c'.repeat(64),
        startsAt: '2026-10-02T08:00:00.000Z',
        endsAt: '2026-10-02T20:00:00.000Z',
        claimedOperatingHours: '8.125' }] } };
}
test('adds only claimed operating hours on a matching hours meter', () => {
  expect(summarize(sample())).toMatchObject({ state: 'deterministic_claimed_plan_only',
    claimedOperatingHours: '8.125', projectedReading: '500.625',
    claimedThresholdReached: true, thresholdCrossingDate: null,
    sourceAuthenticated: false, meterCurrentnessVerified: false,
    planCoverageVerified: false, maintenanceDueVerified: false,
    downtimeRisk: null, forecastIssued: false });
});
test('separate non-overlapping uses may belong to the same job', () => {
  const input = sample();
  input.asset.plannedUses.push({ ...input.asset.plannedUses[0],
    useId: crypto.randomUUID(), startsAt: '2026-10-03T08:00:00.000Z',
    endsAt: '2026-10-03T20:00:00.000Z', claimedOperatingHours: '2.5' });
  expect(summarize(input)).toMatchObject({ state: 'deterministic_claimed_plan_only',
    claimedOperatingHours: '10.625', projectedReading: '503.125' });
});
test('incomplete or conflicting observations withhold the projection', () => {
  for (const change of [
    input => { input.coverage.state = 'revoked'; },
    input => { input.coverage.hasMore = true; },
    input => { input.asset.meterResetSinceReading = true; },
    input => { input.asset.readingObservedAt = '2026-09-29T00:00:00.000Z'; },
    input => { input.asset.plannedUses[0].claimedOperatingHours = '13'; },
    input => { input.asset.plannedUses[0].endsAt = '2026-11-02T00:00:00.000Z'; },
    input => { input.asset.plannedUses.push({ ...input.asset.plannedUses[0],
      useId: crypto.randomUUID(), startsAt: '2026-10-02T10:00:00.000Z' }); },
  ]) { const input = sample(); change(input);
    expect(summarize(input)).toMatchObject({ state: 'unavailable',
      projectedReading: null, claimedThresholdReached: null }); }
});
test('rejects tenant mismatch, coerced identities, mixed units, duplicate jobs and excessive uses', () => {
  for (const change of [
    input => { input.asset.organizationId = crypto.randomUUID(); },
    input => { input.organizationId = { toString: () => ORG }; },
    input => { input.asset.assetId = { toString: () => crypto.randomUUID() }; },
    input => { input.sourceSnapshotDigest = { toString: () => 'a'.repeat(64) }; },
    input => { input.asset.thresholdSourceDigest = { toString: () => 'b'.repeat(64) }; },
    input => { input.asset.plannedUses[0].planDigest = { toString: () => 'c'.repeat(64) }; },
    input => { input.asset.unit = 'mi'; },
    input => { input.asset.threshold = '0'; },
    input => { input.asset.plannedUses.push({ ...input.asset.plannedUses[0] }); },
    input => { input.asset.plannedUses = Array.from({ length: MAX_USES + 1 },
      () => input.asset.plannedUses[0]); },
  ]) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Asset meter position details are invalid.'); }
});
test('rejects accessor-backed nested values before executing them', () => {
  const input = sample(); let called = false;
  Object.defineProperty(input.asset.plannedUses[0], 'claimedOperatingHours', {
    enumerable: true, get() { called = true; return '8.125'; },
  });
  expect(() => summarize(input)).toThrow('Asset meter position details are invalid.');
  expect(called).toBe(false);
});
