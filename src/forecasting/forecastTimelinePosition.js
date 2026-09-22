'use strict';

// Unmounted display projection of supplied Part 3B comparisons. A saved-run
// inventory and actual-source reader must authenticate the complete population.
const { VERSION: BACKTEST_VERSION, buildRollingBacktest } =
  require('./rollingBacktest');
const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-forecast-timeline-position-v1';
const GRAINS = new Set(['week', 'month', 'quarter']);

function invalid() {
  const error = new Error('Forecast timeline details are invalid.');
  error.code = 'M26_FORECAST_TIMELINE_INVALID';
  throw error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function position(item) {
  return item ? { state: item.forecastValue.kind === 'unavailable' ?
    'unavailable' : 'supplied_forecast',
  runId: item.forecastRunId, asOf: item.predictionAsOf,
  savedAt: item.savedAt, outputDigest: item.forecastOutputDigest,
  value: item.forecastValue.kind === 'unavailable' ? null : { ...item.forecastValue },
  reason: item.forecastValue.kind === 'unavailable' ? item.forecastValue.reason : null } :
    { state: 'unavailable', runId: null, asOf: null, savedAt: null,
      outputDigest: null, value: null, reason: 'prior_run_not_supplied' };
}

function projectForecastTimeline(input) {
  if (!exact(input, ['version', 'runs', 'outcomes']) || input.version !== VERSION) invalid();
  let backtest;
  try { backtest = buildRollingBacktest({ version: BACKTEST_VERSION,
    runs: input.runs, outcomes: input.outcomes }); }
  catch (_error) { invalid(); }
  if (backtest.comparisons.some(item => !GRAINS.has(item.horizon.grain))) invalid();

  const groups = new Map();
  for (const item of backtest.comparisons) {
    const key = `${item.horizon.grain}:${item.horizon.startsAt}:${item.horizon.endsAt}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const periods = [...groups.values()].map(items => {
    const horizon = items[0].horizon;
    const origins = new Set(items.map(item => item.predictionAsOf));
    if (origins.size !== items.length) return {
      horizon: { ...horizon }, suppliedRunCount: items.length,
      state: 'unavailable', reason: 'ambiguous_prediction_origin',
      current: null, prior: null, actual: null,
    };
    const current = items[items.length - 1];
    const prior = items.length > 1 ? items[items.length - 2] : null;
    if (current.windowNormalizationRequired || prior?.windowNormalizationRequired) {
      return { horizon: { ...horizon }, suppliedRunCount: items.length,
        state: 'unavailable', reason: 'window_normalization_required',
        current: null, prior: null, actual: null };
    }
    const comparable = prior && current.status === 'paired' && prior.status === 'paired' &&
      current.outcomeAmount === prior.outcomeAmount &&
      current.outcomeSourceDigest === prior.outcomeSourceDigest &&
      current.outcomeCutoff === prior.outcomeCutoff;
    return { horizon: { ...horizon }, suppliedRunCount: items.length,
      state: prior ? 'supplied_comparison' : 'prior_unavailable',
      reason: prior ? null : 'prior_run_not_supplied',
      current: position(current), prior: position(prior),
      actual: comparable ? { state: 'supplied_actual',
        amount: current.outcomeAmount,
        sourceDigest: current.outcomeSourceDigest,
        observedThrough: current.outcomeCutoff } :
        { state: 'unavailable', amount: null, sourceDigest: null,
          observedThrough: null,
          reason: prior ? 'matching_final_actual_not_supplied' :
            'prior_run_not_supplied' },
    };
  }).sort((a, b) => a.horizon.startsAt.localeCompare(b.horizon.startsAt) ||
    a.horizon.endsAt.localeCompare(b.horizon.endsAt));
  const result = { version: VERSION, organizationId: backtest.organizationId,
    target: { ...backtest.target }, unit: { ...backtest.unit },
    applicability: { ...backtest.applicability },
    calculationVersion: backtest.calculationVersion,
    reportingWindowBasis: { ...backtest.reportingWindowBasis },
    backtestDigest: backtest.digest, periods,
    sourceAuthenticated: false, runInventoryComplete: false,
    actualSourceAuthenticated: false, forecastIssued: false };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, projectForecastTimeline };
