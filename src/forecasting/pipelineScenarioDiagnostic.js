'use strict';

// Unmounted deterministic scenario arithmetic. Assumed weights are not
// observed conversion rates or calibrated probabilities.
const VERSION = 'm26-pipeline-scenario-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MONEY = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
const MAX_OPPORTUNITIES = 256;
const uuid = value => typeof value === 'string' && UUID.test(value);

function invalid() {
  const error = new Error('Pipeline scenario details are invalid.');
  error.code = 'M26_PIPELINE_SCENARIO_INVALID';
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
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function dense(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MAX_OPPORTUNITIES ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function cents(value) {
  return BigInt(value.replace('.', ''));
}
function decimalMicro(value) {
  const micro = (value + 50n) / 100n;
  return `${micro / 1000000n}.${String(micro % 1000000n).padStart(6, '0')}`;
}
function group(count, values, complete) {
  return complete ? Object.freeze({ state: 'deterministic_scenario_only', reason: null,
    count, lower: decimalMicro(values.lower), central: decimalMicro(values.central),
    upper: decimalMicro(values.upper) }) :
    Object.freeze({ state: 'unavailable', reason: 'incomplete_source_coverage',
      count: null, lower: null, central: null, upper: null });
}
function calculatePipelineScenarios(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon', 'currency',
    'sourceSnapshotDigest', 'coverage', 'opportunities']) ||
      input.version !== VERSION || !uuid(input.organizationId) ||
      !instant(input.asOf) || !exact(input.horizon, ['startsAt', 'endsAt']) ||
      !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
      input.horizon.startsAt < input.asOf ||
      input.horizon.startsAt >= input.horizon.endsAt ||
      typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency) ||
      typeof input.sourceSnapshotDigest !== 'string' || !DIGEST.test(input.sourceSnapshotDigest) ||
      !exact(input.coverage, ['state', 'hasMore']) ||
      !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
      typeof input.coverage.hasMore !== 'boolean' || !dense(input.opportunities)) invalid();

  const ids = new Set();
  const totals = { preliminary_estimate: { lower: 0n, central: 0n, upper: 0n },
    approved_unbooked: { lower: 0n, central: 0n, upper: 0n } };
  const counts = { preliminary_estimate: 0, approved_unbooked: 0 };
  for (const item of input.opportunities) {
    if (!exact(item, ['estimateId', 'organizationId', 'priceStatus', 'price',
      'currency', 'assumedWeightPpm']) || !uuid(item.estimateId) ||
        ids.has(item.estimateId) || item.organizationId !== input.organizationId ||
        typeof item.priceStatus !== 'string' ||
        !Object.hasOwn(totals, item.priceStatus) ||
        typeof item.price !== 'string' || !MONEY.test(item.price) ||
        typeof item.currency !== 'string' || item.currency !== input.currency ||
        !exact(item.assumedWeightPpm, ['lower', 'central', 'upper'])) invalid();
    ids.add(item.estimateId);
    const weights = item.assumedWeightPpm;
    if (!Object.values(weights).every(value => Number.isSafeInteger(value) &&
        value >= 0 && value <= 1000000) ||
        weights.lower > weights.central || weights.central > weights.upper) invalid();
    counts[item.priceStatus] += 1;
    for (const name of ['lower', 'central', 'upper']) {
      totals[item.priceStatus][name] += cents(item.price) * BigInt(weights[name]);
    }
  }
  const complete = input.coverage.state === 'complete' && !input.coverage.hasMore;
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    currency: input.currency, sourceSnapshotDigest: input.sourceSnapshotDigest,
    preliminaryEstimate: group(counts.preliminary_estimate,
      totals.preliminary_estimate, complete),
    approvedUnbooked: group(counts.approved_unbooked,
      totals.approved_unbooked, complete),
    bookedWorkIncluded: false, earnedRevenueMeasured: false,
    collectedCashMeasured: false, sourceAuthenticated: false,
    probabilityCalibrated: false, forecastIssued: false });
}

module.exports = { VERSION, MAX_OPPORTUNITIES, calculatePipelineScenarios };
