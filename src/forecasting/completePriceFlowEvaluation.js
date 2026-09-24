'use strict';

// Fixed, non-promoting selected-M24 UTC-day evaluation policy. A complete
// registered run inventory is not proof that every business source was seen.
const VERSION = 'm26-selected-m24-complete-window-v1';
const DAY = 86400000;
const DECIMAL = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/;

function invalid() {
  const error = new Error('Guarded price-flow evaluation window is invalid.');
  error.code = 'M26_EVALUATION_WINDOW_INVALID';
  error.status = 400;
  throw error;
}

function scaled(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) invalid();
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0') || '0');
}

function assessCompletePriceFlowEvaluation(window, backtest, measurement,
  referenceMeasurement, laterMeasurement) {
  if (window?.state !== 'complete_saved_origin_window_observed' ||
      window.expectedUtcDays !== 60 ||
      !Array.isArray(window.origins) || window.origins.length > 100 ||
      !backtest || backtest.target?.key !== 'revenue.approved_price_flow' ||
      backtest.unit?.key !== 'money' ||
      backtest.calculationVersion !== 'm26_price_flow_carry_forward_v1' ||
      !Array.isArray(backtest.comparisons) ||
      measurement?.backtestDigest !== backtest.digest ||
      !referenceMeasurement || !laterMeasurement) invalid();
  const startsAt = Date.parse(window.windowStart);
  const endsAt = Date.parse(window.windowEnd);
  if (!Number.isFinite(startsAt) || endsAt - startsAt !== 60 * DAY) invalid();
  const eligibleRows = window.origins.filter(item =>
    item.eligibility === 'matching_context');
  if (eligibleRows.length !== backtest.comparisons.length ||
      eligibleRows.length !== window.matchingContextCount) invalid();
  const dayCounts = Array(60).fill(0);
  const pairedByHalf = [0, 0];
  const seenRuns = new Set();
  for (const item of backtest.comparisons) {
    const day = (Date.parse(item.horizon.startsAt) - startsAt) / DAY;
    if (!Number.isInteger(day) || day < 0 || day >= 60 ||
        seenRuns.has(item.forecastRunId)) invalid();
    seenRuns.add(item.forecastRunId);
    dayCounts[day] += 1;
    if (item.status === 'paired') pairedByHalf[day < 30 ? 0 : 1] += 1;
  }
  const referenceDays = dayCounts.slice(0, 30).filter(count => count > 0).length;
  const laterDays = dayCounts.slice(30).filter(count => count > 0).length;
  const duplicateDays = dayCounts.filter(count => count > 1).length;
  const missingDays = dayCounts.filter(count => count === 0).length;
  const contextChanged = window.excludedContextCount > 0;
  const completeRegisteredWindow = missingDays === 0 && duplicateDays === 0 &&
    !contextChanged && eligibleRows.length === 60 &&
    measurement.originCount === 60;
  const everyOutcomePaired = pairedByHalf[0] === 30 && pairedByHalf[1] === 30;
  let drift = { state: 'unavailable', reason:
    completeRegisteredWindow && everyOutcomePaired ?
      'empirical_reference_policy_unavailable' :
      'comparable_reference_and_later_windows_incomplete' };
  if (completeRegisteredWindow && everyOutcomePaired &&
      referenceMeasurement.descriptiveError.state === 'descriptive_only' &&
      laterMeasurement.descriptiveError.state === 'descriptive_only') {
    const reference = scaled(referenceMeasurement.descriptiveError.meanAbsolute);
    const later = scaled(laterMeasurement.descriptiveError.meanAbsolute);
    drift = { state: 'descriptive_only', direction:
      later > reference ? 'higher_error' :
        later < reference ? 'lower_error' : 'unchanged_error',
      empiricalDriftVerdictAvailable: false };
  }
  const reason = missingDays > 0 ? 'saved_origin_days_missing' :
    duplicateDays > 0 ? 'duplicate_daily_origins' :
      contextChanged ? 'source_context_changed' :
        !everyOutcomePaired ? 'finalized_outcomes_incomplete' :
          'unsaved_and_off_platform_coverage_unverified';
  return Object.freeze({
    version: VERSION, scope: 'northstar_m24_registered_saved_origins_only',
    applicability: Object.freeze({ state: 'supported_source_only',
      targetKey: backtest.target.key, currency: backtest.unit.currency,
      calculationVersion: backtest.calculationVersion,
      horizonGrain: backtest.reportingWindowBasis.grain,
      timeZone: backtest.reportingWindowBasis.timeZone,
      areaScope: backtest.reportingWindowBasis.areaScope,
      wholeBusinessCoverageVerified: false }),
    denominator: Object.freeze({ expectedUtcDays: 60,
      storedOriginCount: window.storedOriginCount,
      matchingContextCount: window.matchingContextCount,
      excludedContextCount: window.excludedContextCount,
      missingSavedOriginDays: missingDays,
      duplicateSavedOriginDays: duplicateDays,
      registeredWindowComplete: completeRegisteredWindow,
      unsavedOriginCoverageVerified: false,
      pairedCount: measurement.statusCounts.paired,
      pairedFraction: Object.freeze({ numerator: measurement.statusCounts.paired,
        denominator: 60 }) }),
    reference: Object.freeze({ expectedUtcDays: 30,
      observedSavedOriginDays: referenceDays, pairedCount: pairedByHalf[0] }),
    later: Object.freeze({ expectedUtcDays: 30,
      observedSavedOriginDays: laterDays, pairedCount: pairedByHalf[1] }),
    observationLag: Object.freeze({ state: 'unavailable',
      reason: 'actual_commit_lag_not_pinned_for_population' }),
    intervalCoverage: Object.freeze({ state: 'not_applicable',
      reason: 'point_only_target', calibratedIntervalCount: 0 }),
    sampleSufficiency: Object.freeze({ state: 'unavailable', reason }),
    calibration: Object.freeze({ state: 'unavailable',
      reason: 'point_only_no_nominal_interval' }),
    drift: Object.freeze(drift),
    realAccuracyAvailable: false, realForecastEligible: false,
  });
}

module.exports = { VERSION, assessCompletePriceFlowEvaluation };
