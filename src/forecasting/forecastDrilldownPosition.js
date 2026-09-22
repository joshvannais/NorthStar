'use strict';

// Bounded, unmounted explanation of caller-supplied timeline receipts. Neither
// the run inventory nor its outcome/source authority is established here.
const { projectForecastTimeline } = require('./forecastTimelinePosition');
const { normalizeForecastOutput } = require('./outputContract');
const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-forecast-drilldown-position-v1';
const SCALE = 1000000n;

function invalid() {
  const error = new Error('Forecast drilldown details are invalid.');
  error.code = 'M26_FORECAST_DRILLDOWN_INVALID';
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
function scaled(value) {
  const negative = value.startsWith('-');
  const [whole, fractional = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fractional.padEnd(6, '0') || '0');
  return negative ? -result : result;
}
function decimal(value) {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE;
  const fractional = String(magnitude % SCALE).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fractional ? `.${fractional}` : ''}`;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function projectForecastDrilldown(input) {
  if (!exact(input, ['version', 'runs', 'outcomes']) || input.version !== VERSION) invalid();
  let timeline;
  try { timeline = projectForecastTimeline({ version: 'm26-forecast-timeline-position-v1',
    runs: input.runs, outcomes: input.outcomes }); }
  catch (_error) { invalid(); }
  const outputs = new Map();
  for (const run of input.runs) {
    let output;
    try { output = normalizeForecastOutput(run.output); }
    catch (_error) { invalid(); }
    if (sha256(output) !== run.outputDigest) invalid();
    outputs.set(run.id.toLowerCase(), output);
  }
  const periods = timeline.periods.map(period => {
    if (!period.current) return { horizon: { ...period.horizon },
      state: 'unavailable', reason: period.reason, current: null,
      change: null, error: null };
    const current = outputs.get(period.current.runId);
    const prior = period.prior?.runId ? outputs.get(period.prior.runId) : null;
    if (!current || sha256(current) !== period.current.outputDigest ||
        (period.prior?.runId && (!prior ||
          sha256(prior) !== period.prior.outputDigest))) invalid();
    const currentValue = period.current.value;
    const priorValue = period.prior?.value;
    const change = currentValue?.kind === 'point' && priorValue?.kind === 'point' ?
      { state: 'supplied_delta', amount: decimal(scaled(currentValue.amount) -
        scaled(priorValue.amount)), reason: 'change_cause_not_supplied' } :
      { state: 'unavailable', amount: null,
        reason: priorValue ? 'point_comparison_not_available' : 'prior_run_not_supplied' };
    const error = currentValue?.kind === 'point' &&
      period.actual?.state === 'supplied_actual' ?
      { state: 'supplied_signed_error', amount: decimal(scaled(currentValue.amount) -
        scaled(period.actual.amount)), actualSourceDigest: period.actual.sourceDigest } :
      { state: 'unavailable', amount: null, actualSourceDigest: null,
        reason: 'matching_point_actual_not_supplied' };
    return { horizon: { ...period.horizon }, state: period.state,
      reason: period.reason,
      current: { runId: period.current.runId,
        outputDigest: period.current.outputDigest,
        sourceSnapshotDigest: current.sourceSnapshotDigest,
        claimedCoverage: { ...current.evidenceCoverage },
        claimedUncertainty: { state: current.uncertainty.state,
          drivers: [...current.uncertainty.drivers] },
        claimedConfidence: { ...current.confidence },
        assumptions: { state: 'unavailable', reason: 'structured_assumptions_not_supplied' } },
      change, error };
  });
  const result = { version: VERSION, timelineDigest: timeline.digest,
    organizationId: timeline.organizationId, target: { ...timeline.target },
    unit: { ...timeline.unit }, periods,
    sourceAuthenticated: false, runInventoryComplete: false,
    actualSourceAuthenticated: false, forecastIssued: false };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, projectForecastDrilldown };
