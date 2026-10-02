'use strict';

// Validates the purpose-fixed database replay page and projects each immutable
// source receipt through the accepted Part 2C feature contract. The database,
// not this module, owns tenant authority and the exact current-generation pin.
const { readFeatureView } = require('./approvedEstimateStockFeatureV2');

const VERSION = 'm26-approved-estimate-lineage-replay-v2';
const DIGEST = /^[0-9a-f]{64}$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) &&
      Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function invalid() {
  const error = new Error('Approved-estimate lineage replay is invalid.');
  error.code = 'M26_APPROVED_ESTIMATE_LINEAGE_REPLAY_INVALID';
  throw error;
}

function dense(value, maximum) {
  return Array.isArray(value) && value.length >= 1 && value.length <= maximum &&
    Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    }).every(Boolean);
}

function cursor(value) {
  if (value === null) return null;
  if (!exact(value, ['version', 'offset', 'requestDigest', 'currentGenerationDigest']) ||
      value.version !== VERSION || !Number.isSafeInteger(value.offset) || value.offset <= 0 ||
      !DIGEST.test(value.requestDigest || '') ||
      !DIGEST.test(value.currentGenerationDigest || '')) invalid();
  return Object.freeze({ ...value });
}

function lineageReplayView(value, organizationId) {
  if (!exact(value, ['version', 'items', 'nextCursor', 'sourceAuthenticated',
    'targetComplete', 'forecastIssued']) || value.version !== VERSION ||
    value.sourceAuthenticated !== true || value.targetComplete !== true ||
    value.forecastIssued !== false || !dense(value.items, 25)) invalid();
  let results;
  try {
    results = value.items.map(item => readFeatureView(item, organizationId));
  } catch (_error) { invalid(); }
  return Object.freeze({
    version: VERSION,
    results: Object.freeze(results),
    nextCursor: cursor(value.nextCursor),
    sourceAuthenticated: true,
    targetComplete: true,
    recovery: Object.freeze({ mode: 'bounded_pull', restartOnSourceChange: true,
      durableForecastCheckpoint: false }),
    lifecycleCoverage: Object.freeze({ correction: true,
      withdrawalTombstone: true, currentAccessRevocation: true,
      retentionPolicyImplemented: false, deletionEventImplemented: false }),
    eligibleForForecast: false,
    forecastIssued: false,
  });
}

module.exports = { VERSION, lineageReplayView };
