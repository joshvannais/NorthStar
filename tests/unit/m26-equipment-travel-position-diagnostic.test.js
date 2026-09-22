'use strict';
const crypto = require('node:crypto');
const { VERSION, COMPOSITION_VERSION, MAX_RECORDS,
  summarizeEquipmentTravelPosition: summarize } =
  require('../../src/forecasting/equipmentTravelPositionDiagnostic');
const ORG = crypto.randomUUID(), ESTIMATE = crypto.randomUUID();
function sample() {
  return { version: VERSION, organizationId: ORG,
    asOf: '2026-09-30T00:00:00.000Z',
    horizon: { startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z' }, currency: 'USD',
    sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', hasMore: false }, records: [{
      estimateId: ESTIMATE, organizationId: ORG, revision: 2,
      digest: 'b'.repeat(64), recordedAt: '2026-09-29T00:00:00.000Z',
      currency: 'USD', compositionVersion: COMPOSITION_VERSION,
      coverageDigest: 'c'.repeat(64),
      plannedStartsAt: '2026-10-02T00:00:00.000Z',
      plannedEndsAt: '2026-10-03T00:00:00.000Z',
      equipmentCost: '500.00', grossTravelCost: '100.00',
      travelOverlapDeduction: '20.00', netTravelCost: '80.00',
      directCost: '900.00',
    }] };
}
test('keeps M24 equipment, gross travel and overlap-adjusted net travel distinct', () => {
  expect(summarize(sample())).toMatchObject({ state: 'deterministic_composition_only',
    equipmentCost: '500.00', grossTravelCost: '100.00',
    travelOverlapDeduction: '20.00', netTravelCost: '80.00',
    equipmentAndNetTravelCost: '580.00', sourceAuthenticated: false,
    categoryBreakdownVerified: false, laborOverlapAcrossForecastsVerified: false,
    transportAndOnsiteUseSeparated: false, forecastIssued: false });
});
test('missing original cost, cross-period allocation and incomplete coverage withhold costs', () => {
  for (const change of [
    input => { input.records[0].netTravelCost = null; },
    input => { input.records[0].plannedStartsAt = null; },
    input => { input.records[0].plannedEndsAt = '2026-11-02T00:00:00.000Z'; },
    input => { input.coverage.hasMore = true; },
    input => { input.coverage.state = 'revoked'; },
  ]) { const input = sample(); change(input);
    expect(summarize(input)).toMatchObject({ state: 'unavailable',
      equipmentAndNetTravelCost: null, recordCount: null }); }
});
test('rejects incompatible money, impossible overlap and direct-total inconsistency', () => {
  for (const change of [
    input => { input.records[0].grossTravelCost = '10.00'; },
    input => { input.records[0].netTravelCost = '90.00'; },
    input => { input.records[0].directCost = '579.99'; },
    input => { input.records[0].equipmentCost = '-1.00'; },
    input => { input.records[0].equipmentCost = 500; },
  ]) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Equipment and travel position details are invalid.'); }
});
test('rejects mixed currencies, different tenants, duplicates, later records and old composition', () => {
  for (const change of [
    input => { input.currency = 'CAD'; },
    input => { input.records[0].organizationId = crypto.randomUUID(); },
    input => { input.records.push({ ...input.records[0] }); },
    input => { input.records[0].recordedAt = '2026-10-01T00:00:00.000Z'; },
    input => { input.records[0].compositionVersion = 'estimate-cost-adoption-v2'; },
    input => { input.records[0].coverageDigest = 'wrong'; },
  ]) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Equipment and travel position details are invalid.'); }
});
test('a complete claimed empty set is descriptive zero, never source proof', () => {
  const input = sample(); input.records = [];
  expect(summarize(input)).toMatchObject({ state: 'deterministic_composition_only',
    equipmentAndNetTravelCost: '0.00', recordCount: 0,
    sourceAuthenticated: false, forecastIssued: false });
  input.records = Array(MAX_RECORDS + 1).fill(sample().records[0]);
  expect(() => summarize(input)).toThrow();
});
