'use strict';

const { VERSION, projectForecastDrilldown: project } =
  require('../../src/forecasting/forecastDrilldownPosition');
const { VERSION: OUTPUT_VERSION } = require('../../src/forecasting/outputContract');
const { VERSION: WINDOW_VERSION } = require('../../src/forecasting/timeSeriesWindows');
const { sha256 } = require('../../src/services/businessProfileAdapter');

const tenant = '55555555-5555-4555-8555-555555555555';
function run(index, value) {
  const asOf = `2026-02-${String(10 + index)}T00:00:00.000Z`;
  const startsAt = '2026-03-01T00:00:00.000Z';
  const endsAt = '2026-04-01T00:00:00.000Z';
  const output = { contractVersion: OUTPUT_VERSION, organizationId: tenant,
    asOf, horizon: { startsAt, endsAt, grain: 'month' },
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
    unit: { key: 'count', currency: null },
    value: { kind: 'point', amount: value },
    confidence: { state: 'unavailable', backtestDigest: null },
    uncertainty: { state: 'unquantified', drivers: ['access'] },
    evidenceCoverage: { included: 5, excluded: 0, missing: 1,
      stale: index, conflicting: 0 },
    applicability: { serviceKey: null, areaKey: null, limits: [] },
    calculationVersion: 'm26-fixture-v1', sourceSnapshotDigest: 'a'.repeat(64) };
  const reportingWindow = { version: WINDOW_VERSION, organizationId: tenant,
    businessProfileId: '77777777-7777-4777-8777-777777777777',
    businessProfileVersion: 1, businessProfileHash: 'c'.repeat(64),
    timeZone: 'UTC', grain: 'month', serviceKey: null, areaScope: 'tenant_all',
    areaDigest: null, calendarState: 'known', calendarDigest: 'd'.repeat(64),
    localStartDate: '2026-03-01', localEndDate: '2026-04-01',
    startsAt, endsAt, elapsedMinutes: 44640, openMinutes: 0,
    openMinutesBasis: 'opening_local_date' };
  return { id: `${index + 1}`.repeat(8) + '-1111-4111-8111-111111111111',
    savedAt: asOf, outputDigest: sha256(output), sourceSnapshotAsOf: asOf,
    latestSourceRecordedAt: asOf, reportingWindow, output };
}
function actual(saved, index, amount = '8') {
  return { id: `${index + 3}`.repeat(8) + '-3333-4333-8333-333333333333',
    forecastRunId: saved.id, organizationId: tenant,
    target: { ...saved.output.target }, horizon: { ...saved.output.horizon },
    unit: { ...saved.output.unit }, applicability: { ...saved.output.applicability },
    observedThrough: saved.output.horizon.endsAt,
    capturedAt: saved.output.horizon.endsAt, sourceDigest: 'b'.repeat(64),
    state: 'known', amount, reason: null };
}
function input(runs, outcomes = []) { return { version: VERSION, runs, outcomes }; }

test('explains supplied delta and signed error without claiming cause or source authority', () => {
  const older = run(0, '9'), newer = run(1, '10');
  const result = project(input([newer, older], [actual(newer, 1), actual(older, 0)]));
  expect(result.periods[0]).toMatchObject({ state: 'supplied_comparison',
    current: { runId: newer.id, claimedCoverage: { missing: 1, stale: 1 },
      assumptions: { state: 'unavailable' } },
    change: { state: 'supplied_delta', amount: '1',
      reason: 'change_cause_not_supplied' },
    error: { state: 'supplied_signed_error', amount: '2' } });
  expect(result).toMatchObject({ sourceAuthenticated: false,
    runInventoryComplete: false, actualSourceAuthenticated: false,
    forecastIssued: false });
  expect(Object.isFrozen(result.periods[0].current.claimedCoverage)).toBe(true);
});

test('missing actual or prior does not produce zero error or a claimed change', () => {
  const newer = run(1, '10');
  const period = project(input([newer])).periods[0];
  expect(period.change).toMatchObject({ state: 'unavailable', amount: null,
    reason: 'prior_run_not_supplied' });
  expect(period.error).toMatchObject({ state: 'unavailable', amount: null });
});

test('signed decline is exact and a range is not silently scored as a point', () => {
  const older = run(0, '10'), newer = run(1, '9');
  expect(project(input([older, newer], [actual(older, 0), actual(newer, 1)]))
    .periods[0].change.amount).toBe('-1');
  newer.output.value = { kind: 'range', lower: '8', central: '9',
    upper: '10', basis: 'deterministic_scenario' };
  newer.output.uncertainty.state = 'deterministic_scenario';
  newer.outputDigest = sha256(newer.output);
  const period = project(input([older, newer], [actual(older, 0), actual(newer, 1)]))
    .periods[0];
  expect(period.change).toMatchObject({ state: 'unavailable', amount: null,
    reason: 'point_comparison_not_available' });
  expect(period.error).toMatchObject({ state: 'unavailable', amount: null });
});

test('changed calendar withholds the whole drilldown comparison', () => {
  const older = run(0, '9'), newer = run(1, '10');
  newer.reportingWindow.calendarDigest = 'e'.repeat(64);
  expect(project(input([older, newer])).periods[0]).toMatchObject({
    state: 'unavailable', reason: 'window_normalization_required',
    current: null, change: null, error: null });
});

test('tampered supplied output digest and cross-tenant run are rejected', () => {
  const tampered = run(0, '9');
  tampered.output.evidenceCoverage.missing = 9;
  expect(() => project(input([tampered]))).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_DRILLDOWN_INVALID' }));
  const other = run(1, '10');
  other.output.organizationId = '66666666-6666-4666-8666-666666666666';
  other.outputDigest = sha256(other.output);
  expect(() => project(input([run(0, '9'), other]))).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_DRILLDOWN_INVALID' }));
});
