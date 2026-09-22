'use strict';
const crypto = require('node:crypto');
const { fixture } = require('../helpers/m24-travel-input');
const { haul } = require('../helpers/m24-travel-operations-input');
const { VERSION, MAX_RECORDS, summarizeRouteLoadPosition: summarize } =
  require('../../src/forecasting/routeLoadPositionDiagnostic');
const ORG = crypto.randomUUID();
function sample() {
  return { version: VERSION, organizationId: ORG,
    asOf: '2026-09-30T00:00:00.000Z',
    horizon: { startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z' },
    sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', hasMore: false },
    records: [{ estimateId: crypto.randomUUID(), organizationId: ORG,
      revision: 2, digest: 'b'.repeat(64),
      recordedAt: '2026-09-29T00:00:00.000Z',
      plannedStartsAt: '2026-10-02T00:00:00.000Z',
      plannedEndsAt: '2026-10-03T00:00:00.000Z',
      currency: 'USD', inputs: fixture() }] };
}
test('reuses M24 trip legs and multiplies declared distance by vehicle legs', () => {
  expect(summarize(sample())).toMatchObject({
    state: 'deterministic_claimed_plan_only', tripLegs: 4, vehicleLegs: 4,
    declaredVehicleMiles: '40', declaredVehicleKilometres: '0',
    sourceAuthenticated: false, adoptedPlanVerified: false,
    roadAndOnsiteSeparated: false, routeCapacityVerified: false,
    fuelOrEnergyForecast: null, logisticsCapacityForecast: null,
    forecastIssued: false });
});
test('keeps kilometres separate and supports asymmetric one-way legs', () => {
  const input = sample(), row = input.records[0].inputs.trips[0];
  row.distance = { value: '10.125', unit: 'km', basis: 'reported' };
  row.returnIncluded = false; row.vehicles = 2;
  expect(summarize(input)).toMatchObject({ tripLegs: 2, vehicleLegs: 4,
    declaredVehicleMiles: '0', declaredVehicleKilometres: '40.5' });
});
test('incomplete coverage, straight-line or unknown distance withholds footprint', () => {
  for (const change of [
    input => { input.coverage.state = 'revoked'; },
    input => { input.coverage.hasMore = true; },
    input => { input.records[0].inputs.trips[0].distance.basis = 'straight_line'; },
    input => { input.records[0].inputs.trips[0].distance.value = null; },
    input => { input.records[0].plannedEndsAt = '2026-11-02T00:00:00.000Z'; },
  ]) { const input = sample(); change(input);
    expect(summarize(input)).toMatchObject({ state: 'unavailable',
      declaredVehicleMiles: null, vehicleLegs: null }); }
});
test('missing M24 hauling legs withhold all route totals even when distance is known', () => {
  const input = sample();
  input.records[0].inputs.hauls = [haul()];
  expect(summarize(input)).toMatchObject({ state: 'unavailable',
    declaredVehicleMiles: null, tripLegs: null, vehicleLegs: null });
});
test('rejects duplicate or cross-tenant plans, coerced pins and oversize inputs', () => {
  for (const change of [
    input => { input.records.push({ ...input.records[0] }); },
    input => { input.records[0].organizationId = crypto.randomUUID(); },
    input => { input.organizationId = { toString: () => ORG }; },
    input => { input.sourceSnapshotDigest = { toString: () => 'a'.repeat(64) }; },
    input => { input.records[0].estimateId = { toString: () => crypto.randomUUID() }; },
    input => { input.records = Array.from({ length: MAX_RECORDS + 1 },
      () => input.records[0]); },
  ]) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Route load position details are invalid.'); }
});
test('nested accessors cannot run in the M24 calculator', () => {
  const input = sample(); let called = false;
  Object.defineProperty(input.records[0].inputs.trips[0].distance, 'value', {
    enumerable: true, get() { called = true; return '10'; },
  });
  expect(() => summarize(input)).toThrow('Route load position details are invalid.');
  expect(called).toBe(false);
});
test('sparse nested array with an extra property is rejected with a coded error', () => {
  const input = sample(), trips = new Array(1);
  trips.extra = 'looks dense by own-key count';
  input.records[0].inputs.trips = trips;
  try { summarize(input); throw new Error('Expected rejection'); }
  catch (error) {
    expect(error.code).toBe('M26_ROUTE_LOAD_POSITION_INVALID');
  }
});
