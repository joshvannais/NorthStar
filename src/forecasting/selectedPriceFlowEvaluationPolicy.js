'use strict';

// A versioned, deliberately non-promoting policy for the one registered M24
// point target. Its counts describe guarded saved origins, not a real forecast.
const VERSION = 'm26-selected-m24-evaluation-policy-v1';

function invalid() {
  const error = new Error('Guarded price-flow evaluation policy input is invalid.');
  error.code = 'M26_EVALUATION_POLICY_INVALID';
  error.status = 400;
  throw error;
}

function assessSelectedPriceFlowEvaluation(backtest, measurement, population) {
  if (!backtest || !measurement || !population ||
      backtest.target?.key !== 'revenue.approved_price_flow' ||
      backtest.unit?.key !== 'money' ||
      backtest.calculationVersion !== 'm26_price_flow_carry_forward_v1' ||
      !Array.isArray(backtest.comparisons) ||
      backtest.comparisons.length !== 2 ||
      measurement.backtestDigest !== backtest.digest ||
      measurement.originCount !== 2 ||
      (population.state !== 'evaluation_population_unavailable' &&
        !Array.isArray(population.origins)) ||
      !['bounded_saved_origin_inventory_verified',
        'evaluation_selection_incomplete',
        'evaluation_population_unavailable'].includes(population.state)) invalid();

  const comparisons = [...backtest.comparisons].sort((a, b) =>
    a.horizon.startsAt.localeCompare(b.horizon.startsAt));
  const temporalNonoverlap = comparisons[0].horizon.endsAt <=
    comparisons[1].horizon.startsAt;
  const selected = (population.origins || []).filter(item => item.selected);
  const currentSourceCount = selected.filter(item =>
    item.sourceState === 'pair_source_verified').length;
  const currentOutcomeCount = selected.filter(item =>
    item.actualState === 'pair_actual_known').length;
  const paired = measurement.statusCounts.paired;
  const denominator = measurement.originCount;
  const inventoryComplete = population.state ===
    'bounded_saved_origin_inventory_verified' &&
    population.matchingContextCount === denominator &&
    population.omittedMatchingCount === 0 && selected.length === denominator;
  const pointOnly = measurement.valueKinds.pointCount === paired &&
    measurement.valueKinds.scenarioEnvelopeCount === 0 &&
    measurement.valueKinds.calibratedIntervalCount === 0;

  return Object.freeze({
    version: VERSION,
    scope: 'selected_northstar_m24_saved_price_flow_only',
    applicability: Object.freeze({
      state: 'supported_source_only', targetKey: backtest.target.key,
      currency: backtest.unit.currency,
      calculationVersion: backtest.calculationVersion,
      horizonGrain: backtest.reportingWindowBasis.grain,
      timeZone: backtest.reportingWindowBasis.timeZone,
      areaScope: backtest.reportingWindowBasis.areaScope,
      serviceKey: backtest.reportingWindowBasis.serviceKey,
      wholeBusinessCoverageVerified: false,
    }),
    denominator: Object.freeze({
      selectedOriginCount: denominator,
      storedMatchingContextCount: population.matchingContextCount ?? null,
      excludedContextCount: population.excludedContextCount ?? null,
      omittedMatchingCount: population.omittedMatchingCount ?? null,
      boundedSavedOriginInventoryVerified: inventoryComplete,
      unsavedOriginCoverageVerified: false,
      pairedCount: paired,
      pairedFraction: Object.freeze({ numerator: paired, denominator }),
      currentSourceCount,
      currentOutcomeCount,
    }),
    independence: Object.freeze({
      temporalNonoverlapVerified: temporalNonoverlap,
      statisticalIndependenceVerified: false,
      concentration: 'unavailable_without_broader_origin_population',
    }),
    observationLag: Object.freeze({ state: 'unavailable',
      reason: 'actual_capture_commit_lag_not_pinned' }),
    intervalCoverage: Object.freeze(pointOnly ?
      { state: 'not_applicable', reason: 'point_only_target' } :
      { state: 'descriptive_only',
        scenarioEnvelopeCount: measurement.valueKinds.scenarioEnvelopeCount,
        scenarioEnvelopeHits: measurement.valueKinds.scenarioEnvelopeHits,
        calibratedIntervalCount: measurement.valueKinds.calibratedIntervalCount,
        calibratedIntervalHits: measurement.valueKinds.calibratedIntervalHits,
        nominalCoverageAvailable: false }),
    sampleSufficiency: Object.freeze({ state: 'unavailable',
      reason: !inventoryComplete ? 'selected_origin_population_incomplete' :
        currentSourceCount !== denominator ? 'current_source_evidence_incomplete' :
          currentOutcomeCount !== denominator ? 'current_outcome_evidence_incomplete' :
          paired !== denominator ? 'paired_outcome_coverage_incomplete' :
            !temporalNonoverlap ? 'overlapping_horizons' :
              'unsaved_origin_and_empirical_independence_unverified' }),
    calibration: Object.freeze({ state: 'unavailable',
      reason: 'point_only_no_nominal_interval' }),
    drift: Object.freeze({ state: 'unavailable',
      reason: 'comparable_reference_and_later_windows_insufficient' }),
    realAccuracyAvailable: false,
    realForecastEligible: false,
  });
}

module.exports = { VERSION, assessSelectedPriceFlowEvaluation };
