'use strict';

const { VERSION, calculatePipelineScenarios } =
  require('../../src/forecasting/pipelineScenarioDiagnostic');

const organizationId = '11111111-1111-4111-8111-111111111111';
const estimateA = '22222222-2222-4222-8222-222222222222';
const estimateB = '33333333-3333-4333-8333-333333333333';
const opportunity = (overrides = {}) => ({ estimateId: estimateA, organizationId,
  priceStatus: 'preliminary_estimate', price: '100.00', currency: 'USD',
  assumedWeightPpm: { lower: 100000, central: 250000, upper: 500000 },
  ...overrides });
const input = (opportunities = [opportunity()], overrides = {}) => ({ version: VERSION,
  organizationId, asOf: '2026-10-01T00:00:00.000Z',
  horizon: { startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-01T00:00:00.000Z' }, currency: 'USD',
  sourceSnapshotDigest: 'a'.repeat(64), coverage: { state: 'complete', hasMore: false },
  opportunities, ...overrides });

test('keeps preliminary and approved open pipeline separate from booked and cash', () => {
  const result = calculatePipelineScenarios(input([opportunity(), opportunity({
    estimateId: estimateB, priceStatus: 'approved_unbooked', price: '200.00',
    assumedWeightPpm: { lower: 250000, central: 500000, upper: 750000 },
  })]));
  expect(result.preliminaryEstimate).toMatchObject({ count: 1, lower: '10.000000',
    central: '25.000000', upper: '50.000000', state: 'deterministic_scenario_only' });
  expect(result.approvedUnbooked).toMatchObject({ count: 1, lower: '50.000000',
    central: '100.000000', upper: '150.000000' });
  expect(result.bookedWorkIncluded).toBe(false);
  expect(result.forecastIssued).toBe(false);
  expect(result.probabilityCalibrated).toBe(false);
  expect(result.sourceAuthenticated).toBe(false);
  expect(Object.isFrozen(result.preliminaryEstimate)).toBe(true);
});

test('sums before rounding and preserves zero assumptions', () => {
  const result = calculatePipelineScenarios(input([opportunity({
    price: '0.01', assumedWeightPpm: { lower: 0, central: 333333, upper: 333333 },
  }), opportunity({ estimateId: estimateB, price: '0.01',
    assumedWeightPpm: { lower: 0, central: 333333, upper: 333333 },
  })]));
  expect(result.preliminaryEstimate).toMatchObject({ lower: '0.000000',
    central: '0.006667', upper: '0.006667' });
});

test('incomplete source coverage is unavailable rather than a zero scenario', () => {
  const result = calculatePipelineScenarios(input([], {
    coverage: { state: 'incomplete', hasMore: true },
  }));
  expect(result.preliminaryEstimate).toMatchObject({ state: 'unavailable',
    reason: 'incomplete_source_coverage', central: null });
  expect(result.approvedUnbooked.central).toBeNull();
});

test('rejects booked work, duplicate identities, currency mixing, and coerced ids', () => {
  const invalid = opportunities => expect(() => calculatePipelineScenarios(input(opportunities)))
    .toThrow(expect.objectContaining({ code: 'M26_PIPELINE_SCENARIO_INVALID' }));
  invalid([opportunity({ priceStatus: 'booked' })]);
  invalid([opportunity(), opportunity()]);
  invalid([opportunity({ currency: 'CAD' })]);
  invalid([opportunity({ estimateId: { toString: () => estimateA } })]);
  invalid([opportunity({ priceStatus: { toString: () => 'preliminary_estimate' } })]);
});

test('rejects reversed weights, invalid precision, and past horizons', () => {
  expect(() => calculatePipelineScenarios(input([opportunity({
    assumedWeightPpm: { lower: 500000, central: 250000, upper: 750000 },
  })]))).toThrow(expect.objectContaining({ code: 'M26_PIPELINE_SCENARIO_INVALID' }));
  expect(() => calculatePipelineScenarios(input([opportunity({ price: '12.345' })])))
    .toThrow(expect.objectContaining({ code: 'M26_PIPELINE_SCENARIO_INVALID' }));
  expect(() => calculatePipelineScenarios(input([], {
    horizon: { startsAt: '2026-09-30T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z' },
  }))).toThrow(expect.objectContaining({ code: 'M26_PIPELINE_SCENARIO_INVALID' }));
});
