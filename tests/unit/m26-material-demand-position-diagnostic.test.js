'use strict';
const crypto = require('node:crypto');
const { VERSION, MAX_ROWS, summarizeMaterialDemandPosition: summarize } =
  require('../../src/forecasting/materialDemandPositionDiagnostic');
const ORG = crypto.randomUUID();
function sample() {
  return { version: VERSION, organizationId: ORG,
    asOf: '2026-09-30T00:00:00.000Z',
    horizon: { startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z' },
    sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', hasMore: false },
    rows: [{ estimateId: crypto.randomUUID(), revision: 2,
      digest: 'b'.repeat(64), lineId: crypto.randomUUID(), organizationId: ORG,
      recordedAt: '2026-09-29T00:00:00.000Z',
      requiredAt: '2026-10-07T00:00:00.000Z',
      materialSpecification: 'Specified board', procurementLocation: 'NC warehouse',
      unit: 'ft', plannedQuantity: '110' }] };
}
test('groups only matching claimed requirements without issuing stockout or reorder forecasts', () => {
  const input = sample();
  input.rows.push({ ...input.rows[0], estimateId: crypto.randomUUID(),
    lineId: crypto.randomUUID(), plannedQuantity: '0.000001' });
  expect(summarize(input)).toMatchObject({ state: 'deterministic_claimed_plan_only',
    requirements: [{ unit: 'ft', plannedQuantity: '110.000001' }],
    sourceAuthenticated: false, approvedPlanVerified: false,
    inventoryVerified: false, receiptsVerified: false,
    reorderDate: null, stockoutRisk: null, purchasingRisk: null,
    forecastIssued: false });
});
test('keeps units, locations, specifications and demand dates distinct', () => {
  const input = sample();
  for (const change of [
    { unit: 'm' }, { procurementLocation: 'Jobsite' },
    { materialSpecification: 'Different board' },
    { requiredAt: '2026-10-08T00:00:00.000Z' },
  ]) input.rows.push({ ...input.rows[0], ...change,
    estimateId: crypto.randomUUID(), lineId: crypto.randomUUID() });
  expect(summarize(input).requirements).toHaveLength(5);
});
test('incomplete, revoked, truncated or out-of-window coverage withholds all quantities', () => {
  for (const change of [
    input => { input.coverage.state = 'incomplete'; },
    input => { input.coverage.state = 'revoked'; },
    input => { input.coverage.hasMore = true; },
    input => { input.rows[0].requiredAt = '2026-11-01T00:00:00.000Z'; },
  ]) { const input = sample(); change(input);
    expect(summarize(input)).toMatchObject({ state: 'unavailable', requirements: null }); }
});
test('rejects tenant mismatch, duplicate identity, future record, fractional items and excessive rows', () => {
  for (const change of [
    input => { input.rows[0].organizationId = crypto.randomUUID(); },
    input => { input.rows.push({ ...input.rows[0] }); },
    input => { input.rows[0].recordedAt = '2026-10-01T00:00:00.000Z'; },
    input => { input.rows[0].unit = 'ea'; input.rows[0].plannedQuantity = '1.5'; },
    input => { input.rows[0].unit = 'widgets'; },
    input => { input.rows.push({ ...input.rows[0], lineId: crypto.randomUUID(),
      revision: 3 }); },
    input => { input.rows = Array.from({ length: MAX_ROWS + 1 }, () => input.rows[0]); },
  ]) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Material demand position details are invalid.'); }
});
test('does not execute accessor input', () => {
  const input = sample(); let called = false;
  Object.defineProperty(input.rows[0], 'plannedQuantity', {
    enumerable: true, get() { called = true; return '110'; },
  });
  expect(() => summarize(input)).toThrow('Material demand position details are invalid.');
  expect(called).toBe(false);
});
test('rejects object values even when they stringify to a valid identity or digest', () => {
  for (const change of [
    input => { const forged = { toString: () => ORG }; input.organizationId = forged;
      input.rows[0].organizationId = forged; },
    input => { input.sourceSnapshotDigest = { toString: () => 'a'.repeat(64) }; },
    input => { input.rows[0].estimateId = { toString: () => crypto.randomUUID() }; },
    input => { input.rows[0].lineId = { toString: () => crypto.randomUUID() }; },
    input => { input.rows[0].digest = { toString: () => 'b'.repeat(64) }; },
  ]) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Material demand position details are invalid.'); }
});
