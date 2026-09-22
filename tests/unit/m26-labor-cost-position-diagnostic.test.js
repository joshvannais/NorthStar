'use strict';
const crypto = require('node:crypto');
const { line, inputs } = require('../helpers/m24-labor-input');
const { VERSION, MAX_PLANS, summarizeLaborCostPosition: summarize } =
  require('../../src/forecasting/laborCostPositionDiagnostic');
const ORG = crypto.randomUUID(), ESTIMATE = crypto.randomUUID();
const START = '2026-10-01T00:00:00.000Z', END = '2026-11-01T00:00:00.000Z';
function sample() {
  const task = line({ rateSource: {
    kind: 'company_reference', reference: 'Recorded owner rate', note: '',
    effectiveOn: '2026-09-01', endsOn: '2026-11-01', geography: 'NC',
  } });
  return { version: VERSION, organizationId: ORG,
    asOf: '2026-09-30T00:00:00.000Z', horizon: { startsAt: START, endsAt: END },
    currency: 'USD', sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', hasMore: false }, plans: [{ estimateId: ESTIMATE,
      organizationId: ORG, revision: 1, digest: 'b'.repeat(64),
      recordedAt: '2026-09-29T00:00:00.000Z', currency: 'USD',
      plannedStartsAt: '2026-10-02T00:00:00.000Z',
      plannedEndsAt: '2026-10-03T00:00:00.000Z', inputs: inputs([task]) }] };
}
test('uses existing M24 per-task cents and labels planned cost as unauthenticated', () => {
  const result = summarize(sample());
  expect(result).toMatchObject({ state: 'deterministic_plan_only',
    plannedLaborCost: '960.00', planCount: 1, sourceAuthenticated: false,
    capacityVerified: false, learnedRateApplied: false, forecastIssued: false });
});
test('missing rate, burden, expired provenance and unknown job window do not turn into zero', () => {
  for (const change of [
    input => { input.plans[0].inputs.lines[0].hourlyCost = null; },
    input => { input.plans[0].inputs.lines[0].burdenPercent = null; },
    input => { input.plans[0].inputs.lines[0].rateSource.endsOn = '2026-09-30'; },
    input => { input.plans[0].plannedStartsAt = null; },
    input => { input.plans[0].plannedEndsAt = '2026-11-02T00:00:00.000Z'; },
  ]) { const input = sample(); change(input); expect(summarize(input)).toMatchObject({
    state: 'unavailable', plannedLaborCost: null, planCount: null }); }
});
test('truncation and revoked coverage withhold even a zero-plan result', () => {
  for (const coverage of [{ state: 'complete', hasMore: true },
    { state: 'revoked', hasMore: false }, { state: 'incomplete', hasMore: false }]) {
    const input = sample(); input.plans = []; input.coverage = coverage;
    expect(summarize(input)).toMatchObject({ state: 'unavailable',
      reason: 'incomplete_source_coverage', plannedLaborCost: null });
  }
});
test('rejects tenant mismatch, duplicate estimates, later evidence and invalid source plans', () => {
  const variants = [
    input => { input.plans[0].organizationId = crypto.randomUUID(); },
    input => { input.plans.push({ ...input.plans[0] }); },
    input => { input.plans[0].recordedAt = '2026-10-01T00:00:00.000Z'; },
    input => { input.plans[0].inputs.lines[0].rateMode = 'all_in'; },
    input => { input.plans[0].digest = 'wrong'; },
    input => { input.plans[0].currency = 'CAD'; },
    input => { input.plans[0].plannedEndsAt = input.plans[0].plannedStartsAt; },
  ];
  for (const change of variants) { const input = sample(); change(input);
    expect(() => summarize(input)).toThrow('Labor cost position details are invalid.'); }
});
test('cannot relabel persisted CAD labor arithmetic as USD', () => {
  const input = sample(); input.currency = 'CAD';
  expect(() => summarize(input)).toThrow('Labor cost position details are invalid.');
  input.plans[0].currency = 'CAD';
  expect(summarize(input)).toMatchObject({ currency: 'CAD',
    plannedLaborCost: '960.00', forecastIssued: false });
});
test('does not reinterpret a partial or oversized set of records as complete', () => {
  const input = sample(); input.plans = Array.from({ length: MAX_PLANS + 1 }, () => input.plans[0]);
  expect(() => summarize(input)).toThrow();
  const sparse = sample(); sparse.plans = Array(2); sparse.plans[0] = sample().plans[0];
  expect(() => summarize(sparse)).toThrow();
});
test('complete claimed empty set stays descriptive, never a measured zero-cost forecast', () => {
  const input = sample(); input.plans = [];
  expect(summarize(input)).toMatchObject({ state: 'deterministic_plan_only',
    plannedLaborCost: '0.00', planCount: 0, sourceAuthenticated: false,
    forecastIssued: false });
});
test('nested getters and oversized payloads cannot run through sealed labor arithmetic', () => {
  const input = sample(); let executed = false;
  Object.defineProperty(input.plans[0].inputs.lines[0], 'hourlyCost', {
    enumerable: true, get() { executed = true; return '50.00'; },
  });
  expect(() => summarize(input)).toThrow('Labor cost position details are invalid.');
  expect(executed).toBe(false);
  const oversized = sample(); oversized.plans[0].inputs.lines[0].task = 'x'.repeat(3001);
  expect(() => summarize(oversized)).toThrow();
});
