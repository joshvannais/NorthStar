'use strict';
const crypto = require('node:crypto');
const material = require('../../src/estimating/materialPlanContract');
const { VERSION, MAX_PLANS, summarizeMaterialCostPosition: summarize } =
  require('../../src/forecasting/materialCostPositionDiagnostic');
const ORG = crypto.randomUUID(), ESTIMATE = crypto.randomUUID();
function sample(version = material.V3) {
  const line = { lineId: crypto.randomUUID(), material: 'Boards', quantity: '100',
    unit: 'ft', wastePercent: '10', unitPrice: '3.25', sourceType: 'entered_price',
    sourceNote: 'Recorded supplier price', priceDate: '2026-09-20', evidence: {
      kind: 'supplier_quote', issuer: 'Fixture Supplier', reference: 'Q-100',
      effectiveOn: '2026-09-01', validThrough: '2026-11-01', countryCode: 'US',
      region: 'NC', locality: null, serviceKey: 'fencing',
      materialSpecification: 'Boards', statedUnit: 'ft', statedCurrency: 'USD',
      statedUnitPrice: '3.25', appliesToReviewedJob: true, exceptionReason: null,
    } };
  if (version === material.V4) Object.assign(line, { availability: {
    kind: 'supplier_statement', issuer: 'Fixture Supplier', reference: 'A-100',
    observedOn: '2026-09-29', validThrough: '2026-11-01', location: 'NC',
    availableQuantity: '120', statedUnit: 'ft', leadTimeDays: 2,
    appliesToReviewedJob: true, exceptionReason: null,
  }, replacement: null });
  const inputs = { lines: [line], sourceAssessment: null };
  if (version === material.V4) inputs.availabilityAssessment = null;
  return { version: VERSION, organizationId: ORG, asOf: '2026-09-30T00:00:00.000Z',
    horizon: { startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' },
    currency: 'USD', sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', hasMore: false }, plans: [{ estimateId: ESTIMATE,
      organizationId: ORG, revision: 1, digest: 'b'.repeat(64),
      recordedAt: '2026-09-29T00:00:00.000Z', currency: 'USD',
      calculationVersion: version, serviceKey: 'fencing',
      plannedStartsAt: '2026-10-02T00:00:00.000Z',
      plannedEndsAt: '2026-10-03T00:00:00.000Z', inputs }] };
}
test('reuses M24 waste-inclusive cents and labels all purchasing gaps', () => {
  expect(summarize(sample())).toMatchObject({ state: 'deterministic_plan_only',
    plannedMaterialLineCost: '357.50', planCount: 1,
    deliveryFeesIncluded: false, taxTreatmentVerified: false,
    inventoryVerified: false, supplierAvailabilityVerified: false,
    sourceAuthenticated: false, learnedWasteApplied: false, forecastIssued: false });
});
test('current V4 reported sufficient availability supports only a claimed plan cost', () => {
  expect(summarize(sample(material.V4))).toMatchObject({
    state: 'deterministic_plan_only', plannedMaterialLineCost: '357.50',
    supplierAvailabilityVerified: false, forecastIssued: false });
});
test('unknown, short, expired or not-yet-observed V4 supply withholds amount', () => {
  for (const change of [
    input => { input.plans[0].inputs.lines[0].availability.availableQuantity = null;
      input.plans[0].inputs.lines[0].availability.statedUnit = null; },
    input => { input.plans[0].inputs.lines[0].availability.availableQuantity = '100'; },
    input => { input.plans[0].inputs.lines[0].availability.validThrough = '2026-10-01'; },
    input => { input.plans[0].inputs.lines[0].availability.observedOn = '2026-10-01'; },
  ]) { const input = sample(material.V4); change(input);
    const inspect = () => summarize(input);
    if (input.plans[0].inputs.lines[0].availability.observedOn === '2026-10-01') {
      expect(inspect).toThrow('Material cost position details are invalid.');
    } else expect(inspect()).toMatchObject({ state: 'unavailable',
      plannedMaterialLineCost: null }); }
});
test('missing or expired price, conflicting service and cross-month job withhold amount', () => {
  for (const change of [
    input => { input.plans[0].inputs.lines[0].evidence.validThrough = null; },
    input => { input.plans[0].inputs.lines[0].evidence.validThrough = '2026-10-01'; },
    input => { input.plans[0].inputs.lines[0].priceDate = '2026-10-01'; },
    input => { input.plans[0].serviceKey = 'roofing'; },
    input => { input.plans[0].plannedStartsAt = null; },
    input => { input.plans[0].plannedEndsAt = '2026-11-02T00:00:00.000Z'; },
  ]) { const input = sample(); change(input);
    expect(summarize(input)).toMatchObject({ state: 'unavailable', plannedMaterialLineCost: null }); }
});
test('rejects currency relabel, tenant mismatch, duplicate, future evidence and legacy plan', () => {
  for (const change of [
    input => { input.currency = 'CAD'; },
    input => { input.plans[0].organizationId = crypto.randomUUID(); },
    input => { input.plans.push({ ...input.plans[0] }); },
    input => { input.plans[0].recordedAt = '2026-10-01T00:00:00.000Z'; },
    input => { input.plans[0].calculationVersion = material.VERSION; },
    input => { input.plans[0].inputs.lines[0].evidence.statedCurrency = 'CAD'; },
  ]) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Material cost position details are invalid.'); }
});
test('truncation, revoked coverage and oversized lists never become a cost position', () => {
  const input = sample(); input.plans = [];
  input.coverage.hasMore = true;
  expect(summarize(input)).toMatchObject({ state: 'unavailable', plannedMaterialLineCost: null });
  input.coverage.hasMore = false; input.coverage.state = 'revoked';
  expect(summarize(input)).toMatchObject({ state: 'unavailable', plannedMaterialLineCost: null });
  input.plans = Array.from({ length: MAX_PLANS + 1 }, () => sample().plans[0]);
  expect(() => summarize(input)).toThrow();
});
test('nested getters cannot run through the sealed material calculator', () => {
  const input = sample(); let executed = false;
  Object.defineProperty(input.plans[0].inputs.lines[0], 'unitPrice', {
    enumerable: true, get() { executed = true; return '3.25'; },
  });
  expect(() => summarize(input)).toThrow('Material cost position details are invalid.');
  expect(executed).toBe(false);
});
