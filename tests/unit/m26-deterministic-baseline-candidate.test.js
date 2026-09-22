'use strict';

const { deriveReportingWindow } = require('../../src/forecasting/timeSeriesWindows');
const { VERSION: DEMAND_VERSION } = require('../../src/forecasting/inboundDemandCandidate');
const { VERSION, CONFIGURATION, buildDeterministicBaselineCandidate: build } =
  require('../../src/forecasting/deterministicBaselineCandidate');

const organizationId = '11111111-1111-4111-8111-111111111111';
const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday'].map(day =>
  [day, { open: '09:00', close: '17:00' }]));
hours.holidays = [];
function window(date) {
  return deriveReportingWindow({ organizationId,
    businessProfileId: '22222222-2222-4222-8222-222222222222',
    businessProfileVersion: 3, businessProfileHash: 'a'.repeat(64),
    rawProfile: { company: { timeZone: 'UTC' }, hours },
    grain: 'day', localStartDate: date, serviceKey: null, areaScope: 'tenant_all' });
}
function observation(date, count, changes = {}) {
  const period = window(date);
  return { window: period, count, state: 'complete',
    sourceRecordedThrough: period.endsAt,
    coverageReceiptDigest: 'b'.repeat(64), ...changes };
}
function fixture(changes = {}) {
  const future = window('2026-09-21');
  return { version: VERSION, configuration: { ...CONFIGURATION }, demandInput: {
    version: DEMAND_VERSION, organizationId, asOf: '2026-09-20T00:00:00.000Z',
    horizon: { startsAt: future.startsAt, endsAt: future.endsAt, grain: 'day' },
    reportingWindow: future, sourceSnapshotDigest: 'c'.repeat(64),
    observations: [observation('2026-09-17', 1),
      observation('2026-09-18', 2), observation('2026-09-19', 0)],
    ...changes,
  } };
}

describe('Mission 26 Part 9A unmounted baseline reproducibility', () => {
  test('same input and different observation order produce the same pinned candidate', () => {
    const first = build(fixture());
    const reordered = fixture();
    reordered.demandInput.observations.reverse();
    const second = build(reordered);
    expect(first).toEqual(second);
    expect(first.output.value).toEqual({ kind: 'point', amount: '1' });
    expect(first).toMatchObject({ sourceAuthenticated: false,
      forecastIssued: false, probabilityCalibrated: false });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.output)).toBe(true);
    expect(first.candidateDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('changed count, coverage receipt or snapshot changes the candidate identity', () => {
    const original = build(fixture());
    const changedCount = fixture();
    changedCount.demandInput.observations[0].count = 2;
    const changedReceipt = fixture();
    changedReceipt.demandInput.observations[0].coverageReceiptDigest = 'd'.repeat(64);
    const changedSnapshot = fixture({ sourceSnapshotDigest: 'e'.repeat(64) });
    for (const changed of [changedCount, changedReceipt, changedSnapshot]) {
      expect(build(changed).candidateDigest).not.toBe(original.candidateDigest);
    }
    expect(build(changedReceipt).outputDigest).toBe(original.outputDigest);
  });

  test('missing coverage remains unavailable even with zero in other periods', () => {
    const input = fixture({ observations: [observation('2026-09-17', 0),
      observation('2026-09-18', null, { state: 'incomplete' }),
      observation('2026-09-19', 0)] });
    expect(build(input).output.value).toEqual({ kind: 'unavailable',
      reason: 'incomplete_source_coverage' });
  });

  test('does not accept an alternate policy, future record or extra input', () => {
    const policy = fixture();
    policy.configuration.minimumPeriods = 1;
    const future = fixture();
    future.demandInput.observations[0].sourceRecordedThrough =
      '2026-09-21T00:00:00.000Z';
    const extra = fixture();
    extra.demandInput.opportunisticValue = 7;
    for (const input of [policy, future, extra]) {
      expect(() => build(input)).toThrow(expect.objectContaining({
        code: 'M26_DETERMINISTIC_BASELINE_INVALID',
      }));
    }
  });
});
