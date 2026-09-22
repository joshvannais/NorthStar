'use strict';

const { VERSION: PIPELINE_VERSION } = require('../../src/forecasting/pipelineScenarioDiagnostic');
const { VERSION, buildNamedPipelineScenarioCandidate: build } =
  require('../../src/forecasting/namedPipelineScenarioCandidate');

const organizationId = '11111111-1111-4111-8111-111111111111';
const estimateId = '22222222-2222-4222-8222-222222222222';
const anotherId = '33333333-3333-4333-8333-333333333333';
function opportunity(id = estimateId, status = 'preliminary_estimate') {
  return { estimateId: id, organizationId, priceStatus: status,
    price: '100.00', currency: 'USD',
    assumedWeightPpm: { lower: 100000, central: 250000, upper: 500000 } };
}
function attribution(id = estimateId) {
  return { estimateId: id, variations: Object.fromEntries(
    ['adverse', 'base', 'favorable'].map(name => [name, {
      reasonCode: `${name}_conversion_assumption`,
      sourceKind: 'estimator_declared', sourceDigest: 'b'.repeat(64),
      sourceRecordedAt: '2026-09-30T00:00:00.000Z',
    }])) };
}
function fixture(changes = {}) {
  return { version: VERSION, pipelineInput: { version: PIPELINE_VERSION,
    organizationId, asOf: '2026-10-01T00:00:00.000Z',
    horizon: { startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z' },
    currency: 'USD', sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', hasMore: false },
    opportunities: [opportunity()],
  }, assumptions: [attribution()], ...changes };
}

test('names exact per-opportunity scenario weights with claimed provenance', () => {
  const result = build(fixture());
  expect(result.scenarios).toEqual({
    adverse: { preliminaryEstimate: '10.000000', approvedUnbooked: '0.000000',
      state: 'assumption_only' },
    base: { preliminaryEstimate: '25.000000', approvedUnbooked: '0.000000',
      state: 'assumption_only' },
    favorable: { preliminaryEstimate: '50.000000', approvedUnbooked: '0.000000',
      state: 'assumption_only' },
  });
  expect(result.assumptions[0].variations.adverse).toMatchObject({
    weightPpm: 100000, sourceKind: 'estimator_declared',
    reasonCode: 'adverse_conversion_assumption' });
  expect(result).toMatchObject({ sourceAuthenticated: false,
    assumptionSourcesAuthenticated: false, probabilityCalibrated: false,
    forecastIssued: false, bookedWorkIncluded: false,
    earnedRevenueMeasured: false });
  expect(Object.isFrozen(result.assumptions[0].variations)).toBe(true);
});

test('scenario identity is stable across input order and changes with a claim', () => {
  const first = fixture();
  first.pipelineInput.opportunities.push(opportunity(anotherId, 'approved_unbooked'));
  first.assumptions.push(attribution(anotherId));
  const original = build(first);
  first.pipelineInput.opportunities.reverse();
  first.assumptions.reverse();
  expect(build(first)).toEqual(original);
  first.assumptions[0].variations.base.sourceDigest = 'c'.repeat(64);
  expect(build(first).digest).not.toBe(original.digest);
});

test('incomplete coverage withholds even claimed zero scenarios', () => {
  const input = fixture();
  input.pipelineInput.coverage = { state: 'incomplete', hasMore: true };
  const result = build(input);
  expect(result.scenarios.base).toEqual({ preliminaryEstimate: null,
    approvedUnbooked: null, state: 'unavailable',
    reason: 'incomplete_source_coverage' });
});

test('rejects missing or duplicate attribution, extra fields, and invalid weights', () => {
  const inputs = [];
  const missing = fixture(); missing.assumptions = []; inputs.push(missing);
  const duplicate = fixture(); duplicate.assumptions.push(attribution());
  duplicate.pipelineInput.opportunities.push(opportunity(anotherId)); inputs.push(duplicate);
  const extra = fixture(); extra.assumptions[0].variations.base.confidence = 'high';
  inputs.push(extra);
  const invalidWeight = fixture();
  invalidWeight.pipelineInput.opportunities[0].assumedWeightPpm.lower = 600000;
  inputs.push(invalidWeight);
  const unknownId = fixture(); unknownId.assumptions[0].estimateId = anotherId;
  inputs.push(unknownId);
  const futureClaim = fixture();
  futureClaim.assumptions[0].variations.base.sourceRecordedAt =
    '2026-10-02T00:00:00.000Z';
  inputs.push(futureClaim);
  for (const input of inputs) {
    expect(() => build(input)).toThrow(expect.objectContaining({
      code: 'M26_NAMED_SCENARIO_INVALID',
    }));
  }
});
