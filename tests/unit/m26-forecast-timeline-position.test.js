'use strict';

const { VERSION, projectForecastTimeline: project } =
  require('../../src/forecasting/forecastTimelinePosition');
const { VERSION: OUTPUT_VERSION } = require('../../src/forecasting/outputContract');
const { VERSION: WINDOW_VERSION } = require('../../src/forecasting/timeSeriesWindows');
const { sha256 } = require('../../src/services/businessProfileAdapter');

const tenant = '55555555-5555-4555-8555-555555555555';
const ids = ['11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'];
const outcomeIds = ['33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'];
const periods = {
  week: ['2026-03-02', '2026-03-09', 10080],
  month: ['2026-03-01', '2026-04-01', 44640],
  quarter: ['2026-04-01', '2026-07-01', 131040],
};
function run(index, grain = 'month', value = '10') {
  const [localStartDate, localEndDate, elapsedMinutes] = periods[grain];
  const startsAt = `${localStartDate}T00:00:00.000Z`;
  const endsAt = `${localEndDate}T00:00:00.000Z`;
  const asOf = `2026-02-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`;
  const output = { contractVersion: OUTPUT_VERSION, organizationId: tenant,
    asOf, horizon: { startsAt, endsAt, grain },
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
    unit: { key: 'count', currency: null }, value: { kind: 'point', amount: value },
    confidence: { state: 'unavailable', backtestDigest: null },
    uncertainty: { state: 'unquantified', drivers: [] },
    evidenceCoverage: { included: 5, excluded: 0, missing: 0,
      stale: 0, conflicting: 0 },
    applicability: { serviceKey: null, areaKey: null, limits: [] },
    calculationVersion: 'm26-fixture-v1', sourceSnapshotDigest: 'a'.repeat(64) };
  const reportingWindow = { version: WINDOW_VERSION, organizationId: tenant,
    businessProfileId: '77777777-7777-4777-8777-777777777777',
    businessProfileVersion: 1, businessProfileHash: 'c'.repeat(64),
    timeZone: 'UTC', grain, serviceKey: null, areaScope: 'tenant_all',
    areaDigest: null, calendarState: 'known', calendarDigest: 'd'.repeat(64),
    localStartDate, localEndDate, startsAt, endsAt, elapsedMinutes,
    openMinutes: 0, openMinutesBasis: 'opening_local_date' };
  return { id: ids[index], savedAt: asOf, outputDigest: sha256(output),
    sourceSnapshotAsOf: asOf, latestSourceRecordedAt: asOf,
    reportingWindow, output };
}
function actual(saved, index, amount = '8', sourceDigest = 'b'.repeat(64)) {
  return { id: outcomeIds[index], forecastRunId: saved.id, organizationId: tenant,
    target: { ...saved.output.target }, horizon: { ...saved.output.horizon },
    unit: { ...saved.output.unit }, applicability: { ...saved.output.applicability },
    observedThrough: saved.output.horizon.endsAt,
    capturedAt: saved.output.horizon.endsAt, sourceDigest,
    state: 'known', amount, reason: null };
}
function input(runs, outcomes = []) { return { version: VERSION, runs, outcomes }; }

test.each(['week', 'month', 'quarter'])(
  'projects supplied current, prior and matching actual in %s grain', grain => {
    const older = run(0, grain, '9');
    const newer = run(1, grain, '10');
    const result = project(input([newer, older], [actual(newer, 1), actual(older, 0)]));
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]).toMatchObject({ state: 'supplied_comparison',
      suppliedRunCount: 2, horizon: { grain },
      current: { runId: newer.id, value: { amount: '10' } },
      prior: { runId: older.id, value: { amount: '9' } },
      actual: { state: 'supplied_actual', amount: '8' } });
    expect(result).toMatchObject({ sourceAuthenticated: false,
      runInventoryComplete: false, actualSourceAuthenticated: false,
      forecastIssued: false });
    expect(project(input([older, newer], [actual(older, 0), actual(newer, 1)])).digest)
      .toBe(result.digest);
    expect(Object.isFrozen(result.periods[0].current.value)).toBe(true);
  });

test('missing prior or matching supplied actual remains unavailable, not zero', () => {
  const older = run(0), newer = run(1);
  expect(project(input([newer], [actual(newer, 1)])).periods[0])
    .toMatchObject({ state: 'prior_unavailable', actual: { state: 'unavailable',
      amount: null } });
  const conflicting = project(input([older, newer], [actual(older, 0, '8'),
    actual(newer, 1, '7')]));
  expect(conflicting.periods[0]).toMatchObject({ state: 'supplied_comparison',
    actual: { state: 'unavailable', amount: null,
      reason: 'matching_actual_not_supplied' } });
});

test('duplicate prediction origin cannot silently choose a current run', () => {
  const older = run(0), duplicate = run(1);
  duplicate.output.asOf = older.output.asOf;
  duplicate.savedAt = older.savedAt;
  duplicate.sourceSnapshotAsOf = older.sourceSnapshotAsOf;
  duplicate.latestSourceRecordedAt = older.latestSourceRecordedAt;
  duplicate.outputDigest = sha256(duplicate.output);
  expect(project(input([older, duplicate])).periods[0]).toMatchObject({
    state: 'unavailable', reason: 'ambiguous_prediction_origin',
    current: null, prior: null, actual: null });
});

test('changed operating calendar withholds the forecast comparison itself', () => {
  const older = run(0), newer = run(1);
  newer.reportingWindow.calendarDigest = 'e'.repeat(64);
  const result = project(input([older, newer], [actual(older, 0), actual(newer, 1)]));
  expect(result.periods[0]).toMatchObject({ state: 'unavailable',
    reason: 'window_normalization_required', current: null, prior: null,
    actual: null });
});

test('rejects unsupported grain and cross-tenant supplied receipts', () => {
  const daily = run(0);
  daily.output.horizon.grain = 'day';
  daily.reportingWindow.grain = 'day';
  daily.outputDigest = sha256(daily.output);
  expect(() => project(input([daily]))).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_TIMELINE_INVALID' }));
  const other = run(1);
  other.output.organizationId = '66666666-6666-4666-8666-666666666666';
  other.outputDigest = sha256(other.output);
  expect(() => project(input([run(0), other]))).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_TIMELINE_INVALID' }));
});
