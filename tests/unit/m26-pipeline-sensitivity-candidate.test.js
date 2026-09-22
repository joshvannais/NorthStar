'use strict';

const { VERSION: PIPELINE_VERSION } = require('../../src/forecasting/pipelineScenarioDiagnostic');
const { VERSION: NAMED_VERSION } = require('../../src/forecasting/namedPipelineScenarioCandidate');
const { VERSION, analyzePipelineSensitivity: analyze } =
  require('../../src/forecasting/pipelineSensitivityCandidate');

const organizationId = '11111111-1111-4111-8111-111111111111';
const estimateId = '22222222-2222-4222-8222-222222222222';
function fixture(changes = {}) {
  return { version: VERSION, estimateId, proposedBaseWeightPpm: 300000,
    desiredMinimumAmount: '40.000000', namedInput: {
      version: NAMED_VERSION,
      pipelineInput: { version: PIPELINE_VERSION, organizationId,
        asOf: '2026-10-01T00:00:00.000Z',
        horizon: { startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2026-11-01T00:00:00.000Z' },
        currency: 'USD', sourceSnapshotDigest: 'a'.repeat(64),
        coverage: { state: 'complete', hasMore: false },
        opportunities: [{ estimateId, organizationId,
          priceStatus: 'preliminary_estimate', price: '100.00', currency: 'USD',
          assumedWeightPpm: { lower: 100000, central: 250000, upper: 500000 } }],
      },
      assumptions: [{ estimateId, variations: Object.fromEntries(
        ['adverse', 'base', 'favorable'].map(name => [name, {
          reasonCode: `${name}_assumption`, sourceKind: 'estimator_declared',
          sourceDigest: 'b'.repeat(64),
          sourceRecordedAt: '2026-09-30T00:00:00.000Z',
        }])) }],
    }, ...changes };
}

test('uses Part 6B arithmetic for forward and reverse assumption sensitivity', () => {
  const result = analyze(fixture());
  expect(result).toMatchObject({ category: 'preliminaryEstimate',
    state: 'assumption_only', baselineAmount: '25.000000',
    proposedAmount: '30.000000', changeAmount: '5.000000',
    reverse: { state: 'assumption_only', requiredWeightPpm: 400000,
      attainedAmount: '40.000000', bindingConstraint: null },
    sourceAuthenticated: false, probabilityCalibrated: false,
    forecastIssued: false });
  expect(analyze(fixture()).digest).toBe(result.digest);
  expect(Object.isFrozen(result.reverse)).toBe(true);
});

test('reports a binding bound when the desired target is impossible', () => {
  const result = analyze(fixture({ desiredMinimumAmount: '60.00' }));
  expect(result.reverse).toEqual({ state: 'unavailable',
    reason: 'target_exceeds_selected_weight_bound', requiredWeightPpm: null,
    attainedAmount: null, bindingConstraint: 'selected_weight_upper_bound' });
});

test('source incompleteness withholds baseline, change and reverse answer', () => {
  const input = fixture();
  input.namedInput.pipelineInput.coverage = { state: 'incomplete', hasMore: true };
  const result = analyze(input);
  expect(result).toMatchObject({ state: 'unavailable', baselineAmount: null,
    proposedAmount: null, changeAmount: null,
    reverse: { state: 'unavailable', requiredWeightPpm: null } });
});

test('rejects unsupported identity, out-of-bounds weight and invalid target', () => {
  const inputs = [
    fixture({ estimateId: '33333333-3333-4333-8333-333333333333' }),
    fixture({ proposedBaseWeightPpm: 750000 }),
    fixture({ desiredMinimumAmount: '-1' }),
    fixture({ desiredMinimumAmount: '1.1234567' }),
  ];
  for (const input of inputs) {
    expect(() => analyze(input)).toThrow(expect.objectContaining({
      code: 'M26_PIPELINE_SENSITIVITY_INVALID',
    }));
  }
});
