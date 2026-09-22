'use strict';

// Unmounted Part 11C projection. The owning source and algorithm readers must
// authenticate these supplied statuses before any saved run can be displayed.
const { sha256 } = require('../services/businessProfileAdapter');
const { normalizeForecastRunReceipt } = require('./forecastRunReceipt');

const VERSION = 'm26-forecast-run-currentness-v1';
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SOURCE_STATES = new Set(['current', 'changed', 'revoked', 'deleted',
  'retention_expired', 'unknown']);
const ALGORITHM_STATES = new Set(['current', 'replaced', 'withdrawn', 'unknown']);

function invalid() {
  const error = new Error('Forecast run currentness details are invalid.');
  error.code = 'M26_FORECAST_RUN_CURRENTNESS_INVALID';
  throw error;
}
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) return null;
  const result = {};
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }

function projectForecastRunCurrentness(input) {
  const root = record(input, ['run', 'source', 'algorithm']);
  const source = root && record(root.source,
    ['capturedDigest', 'status', 'currentDigest']);
  const algorithm = root && record(root.algorithm, ['status', 'current']);
  if (!root || !source || !algorithm) invalid();
  let run;
  try { run = normalizeForecastRunReceipt(root.run); }
  catch (_error) { invalid(); }
  if (source.capturedDigest !== run.sourceSnapshotDigest ||
      !SOURCE_STATES.has(source.status) ||
      !ALGORITHM_STATES.has(algorithm.status)) invalid();
  if (source.status === 'current' && source.currentDigest !== source.capturedDigest) invalid();
  if (source.status === 'changed' && (!digest(source.currentDigest) ||
      source.currentDigest === source.capturedDigest)) invalid();
  if (!['current', 'changed'].includes(source.status) && source.currentDigest !== null) invalid();

  const activeAlgorithm = algorithm.current === null ? null : record(algorithm.current,
    ['key', 'version', 'definitionDigest', 'implementationDigest']);
  if (['current', 'replaced'].includes(algorithm.status)) {
    if (!activeAlgorithm || typeof activeAlgorithm.key !== 'string' ||
        activeAlgorithm.key.length > 80 || !TOKEN.test(activeAlgorithm.key) ||
        typeof activeAlgorithm.version !== 'string' ||
        activeAlgorithm.version.length > 80 || !TOKEN.test(activeAlgorithm.version) ||
        !digest(activeAlgorithm.definitionDigest) ||
        !digest(activeAlgorithm.implementationDigest)) invalid();
    const sameIdentity = activeAlgorithm.key === run.algorithm.key &&
      activeAlgorithm.version === run.algorithm.version;
    const sameDefinition = sameIdentity &&
      ['definitionDigest', 'implementationDigest']
        .every(key => activeAlgorithm[key] === run.algorithm[key]);
    if (algorithm.status === 'current' ? !sameDefinition : sameIdentity) invalid();
  } else if (algorithm.current !== null) invalid();

  const reasons = [];
  if (source.status !== 'current') reasons.push(`source_${source.status}`);
  if (algorithm.status !== 'current') reasons.push(`algorithm_${algorithm.status}`);
  const state = ['revoked', 'deleted', 'retention_expired', 'unknown'].includes(source.status) ||
    ['withdrawn', 'unknown'].includes(algorithm.status) ? 'unavailable' :
    reasons.length ? 'stale' : 'unchanged_candidate';
  const result = { version: VERSION,
    runId: state === 'unavailable' ? null : run.id,
    runDigest: state === 'unavailable' ? null : run.digest,
    state, reasons };
  Object.freeze(reasons);
  return Object.freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, projectForecastRunCurrentness };
