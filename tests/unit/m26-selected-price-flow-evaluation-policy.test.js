'use strict';

const { assessSelectedPriceFlowEvaluation } = require(
  '../../src/forecasting/selectedPriceFlowEvaluationPolicy');

const backtest = {
  digest: 'a'.repeat(64),
  target: { key: 'revenue.approved_price_flow' },
  unit: { key: 'money', currency: 'USD' },
  calculationVersion: 'm26_price_flow_carry_forward_v1',
  reportingWindowBasis: { grain: 'day', timeZone: 'UTC', areaScope: 'tenant_all',
    serviceKey: null },
  comparisons: [
    { horizon: { startsAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-03-02T00:00:00.000Z' } },
    { horizon: { startsAt: '2026-03-02T00:00:00.000Z',
      endsAt: '2026-03-03T00:00:00.000Z' } },
  ],
};
const measurement = {
  backtestDigest: backtest.digest, originCount: 2,
  statusCounts: { paired: 2 },
  valueKinds: { pointCount: 2, scenarioEnvelopeCount: 0,
    scenarioEnvelopeHits: 0, calibratedIntervalCount: 0,
    calibratedIntervalHits: 0 },
};
const population = {
  state: 'bounded_saved_origin_inventory_verified',
  matchingContextCount: 2, excludedContextCount: 0,
  omittedMatchingCount: 0,
  origins: [
    { selected: true, sourceState: 'pair_source_verified',
      actualState: 'pair_actual_known' },
    { selected: true, sourceState: 'pair_source_verified',
      actualState: 'pair_actual_known' },
  ],
};

describe('Mission 26 Part 3C selected-M24 non-promoting policy', () => {
  test('reports a bounded two-origin denominator but no empirical sufficiency', () => {
    const result = assessSelectedPriceFlowEvaluation(backtest, measurement, population);
    expect(result.denominator).toMatchObject({
      boundedSavedOriginInventoryVerified: true,
      pairedFraction: { numerator: 2, denominator: 2 },
      currentSourceCount: 2,
      currentOutcomeCount: 2,
    });
    expect(result.independence).toMatchObject({
      temporalNonoverlapVerified: true, statisticalIndependenceVerified: false,
    });
    expect(result.intervalCoverage).toMatchObject({
      state: 'not_applicable', reason: 'point_only_target',
    });
    expect(result.sampleSufficiency).toMatchObject({
      state: 'unavailable',
      reason: 'unsaved_origin_and_empirical_independence_unverified',
    });
    expect(result.realAccuracyAvailable).toBe(false);
  });

  test('prioritizes omitted origin, then missing current source and paired outcome', () => {
    const omitted = assessSelectedPriceFlowEvaluation(backtest, measurement, {
      ...population, state: 'evaluation_selection_incomplete',
      matchingContextCount: 3, omittedMatchingCount: 1,
      origins: [...population.origins,
        { selected: false, sourceState: 'pair_source_unavailable' }],
    });
    expect(omitted.sampleSufficiency.reason).toBe('selected_origin_population_incomplete');
    const stale = assessSelectedPriceFlowEvaluation(backtest, measurement, {
      ...population, origins: [population.origins[0],
        { selected: true, sourceState: 'pair_source_unavailable' }],
    });
    expect(stale.sampleSufficiency.reason).toBe('current_source_evidence_incomplete');
    const revoked = assessSelectedPriceFlowEvaluation(backtest, measurement, {
      ...population, origins: [population.origins[0],
        { ...population.origins[1], actualState: 'pair_actual_revoked' }],
    });
    expect(revoked.sampleSufficiency.reason).toBe('current_outcome_evidence_incomplete');
    const missing = assessSelectedPriceFlowEvaluation(backtest,
      { ...measurement, statusCounts: { paired: 1 },
        valueKinds: { ...measurement.valueKinds, pointCount: 1 } }, population);
    expect(missing.sampleSufficiency.reason).toBe('paired_outcome_coverage_incomplete');
  });
});
