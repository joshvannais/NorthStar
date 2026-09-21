'use strict';

// Descriptive arithmetic only. No caller-supplied threshold or retrospective
// fixture can authorize a calibration, promotion or production accuracy claim.
const { VERSION: BACKTEST_VERSION, buildRollingBacktest } = require('./rollingBacktest');
const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-evaluation-gates-v1';
const SCALE = 1000000n;
const STATUSES = ['paired', 'forecast_unavailable', 'outcome_unavailable',
  'window_normalization_required'];

function invalid() {
  const error = new Error('Forecast evaluation details are invalid.');
  error.code = 'M26_EVALUATION_INVALID';
  error.status = 400;
  throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key =>
    typeof key === 'string' && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key).enumerable &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function scaled(value) {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0') || '0');
  return negative ? -result : result;
}

function decimal(value) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}

function mean(sum, count) {
  const absolute = sum < 0n ? -sum : sum;
  const rounded = (absolute + BigInt(count) / 2n) / BigInt(count);
  return decimal(sum < 0n ? -rounded : rounded);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function measureEvaluation(input) {
  if (!exact(input, ['version', 'runs', 'outcomes']) || input.version !== VERSION) invalid();
  // Rebuild the complete bounded comparison rather than accepting a copied
  // digest or a caller-selected subset of its difficult origins.
  const backtest = buildRollingBacktest({
    version: BACKTEST_VERSION,
    runs: input.runs, outcomes: input.outcomes,
  });
  const statusCounts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  let totalAbsolute = 0n;
  let totalSigned = 0n;
  let pointCount = 0;
  let scenarioEnvelopeCount = 0;
  let scenarioEnvelopeHits = 0;
  let calibratedIntervalCount = 0;
  let calibratedIntervalHits = 0;
  for (const pair of backtest.comparisons) {
    statusCounts[pair.status] += 1;
    if (pair.status !== 'paired') continue;
    const actual = scaled(pair.outcomeAmount);
    const value = pair.forecastValue;
    const predicted = scaled(value.kind === 'point' ? value.amount : value.central);
    const error = predicted - actual;
    totalAbsolute += error < 0n ? -error : error;
    totalSigned += error;
    if (value.kind === 'point') pointCount += 1;
    else {
      const hit = scaled(value.lower) <= actual && actual <= scaled(value.upper);
      if (value.basis === 'deterministic_scenario') {
        scenarioEnvelopeCount += 1;
        if (hit) scenarioEnvelopeHits += 1;
      } else if (value.basis === 'calibrated_interval') {
        calibratedIntervalCount += 1;
        if (hit) calibratedIntervalHits += 1;
      } else invalid();
    }
  }
  const pairedCount = statusCounts.paired;
  const result = {
    version: VERSION,
    backtestDigest: backtest.digest,
    organizationId: backtest.organizationId,
    target: { ...backtest.target }, unit: { ...backtest.unit },
    applicability: { ...backtest.applicability },
    calculationVersion: backtest.calculationVersion,
    reportingWindowBasis: { ...backtest.reportingWindowBasis },
    originCount: backtest.originCount,
    comparisonCount: backtest.comparisons.length,
    statusCounts,
    descriptiveError: pairedCount === 0 ?
      { state: 'unavailable', reason: 'no_paired_actuals', pairedCount: 0,
        totalAbsolute: null, meanAbsolute: null, meanSigned: null } :
      { state: 'descriptive_only', reason: null, pairedCount,
        totalAbsolute: decimal(totalAbsolute), meanAbsolute: mean(totalAbsolute, pairedCount),
        meanSigned: mean(totalSigned, pairedCount) },
    valueKinds: { pointCount, scenarioEnvelopeCount, scenarioEnvelopeHits,
      calibratedIntervalCount, calibratedIntervalHits },
    sampleSufficiency: { state: 'unavailable', reason: 'reviewed_policy_missing' },
    calibration: { state: 'unavailable', reason: 'nominal_coverage_and_source_evidence_missing' },
    drift: { state: 'unavailable', reason: 'reviewed_reference_window_missing' },
  };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, measureEvaluation };
