'use strict';

// Pull-based, unmounted Mission 26 Part 2D projection. A future caller must
// supply freshly authorized source receipts and enforce retention at read time.
const { sha256 } = require('../services/businessProfileAdapter');
const { normalizeAsOfSourceManifest } = require('./asOfSourceManifest');
const { normalizeRegisteredFeatureValue, registeredFeatureDefinition } =
  require('./featureDefinitions');

const DIGEST = /^[0-9a-f]{64}$/;
const VERSION = 'm26-feature-lineage-v1';

function invalid() {
  const error = new Error('Forecast feature lineage details are invalid.');
  error.code = 'M26_FEATURE_LINEAGE_INVALID';
  error.status = 400;
  throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' &&
    keys.includes(key) && Object.getOwnPropertyDescriptor(value, key).enumerable &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function instantKey(value) {
  return value.replace(/\.(\d{3})(\d{3})?Z$/, (_, millis, micros) =>
    `.${millis}${micros || '000'}Z`);
}

function normalizeReceipt(receipt) {
  if (!exact(receipt, ['manifest', 'digest']) ||
      typeof receipt.digest !== 'string' || !DIGEST.test(receipt.digest)) invalid();
  let manifest;
  try { manifest = normalizeAsOfSourceManifest(receipt.manifest); }
  catch (_error) { invalid(); }
  return { manifest, digest: receipt.digest };
}

function validatePair(feature, captured, current) {
  let value;
  try { value = normalizeRegisteredFeatureValue(feature); }
  catch (_error) { invalid(); }
  const definition = registeredFeatureDefinition(value.definitionKey,
    value.definitionVersion);
  const historical = normalizeReceipt(captured);
  const latest = normalizeReceipt(current);
  if (historical.manifest.organizationId !== value.organizationId ||
      latest.manifest.organizationId !== value.organizationId ||
      historical.manifest.purposeKey !== definition.sourcePurposeKey ||
      latest.manifest.purposeKey !== definition.sourcePurposeKey ||
      historical.manifest.targetKey !== definition.sourceTargetKey ||
      latest.manifest.targetKey !== definition.sourceTargetKey ||
      historical.digest !== value.sourceSnapshotDigest ||
      instantKey(historical.manifest.asOf) !== instantKey(value.asOf) ||
      instantKey(latest.manifest.asOf) < instantKey(historical.manifest.asOf) ||
      [...historical.manifest.sources, ...latest.manifest.sources].some(source =>
        !definition.sourceKinds.includes(source.sourceKind))) invalid();
  return { value, historical, latest };
}

function reconcileFeatureLineage(input) {
  if (!exact(input, ['feature', 'captured', 'current', 'sourceAccess', 'retention']) ||
      !['granted', 'revoked'].includes(input.sourceAccess) ||
      !['current', 'expired', 'deleted'].includes(input.retention)) invalid();
  // Revocation and deletion mask before reading or revealing saved source data.
  if (input.sourceAccess === 'revoked' || input.retention !== 'current') {
    return Object.freeze({ version: VERSION, lineageState: 'unavailable',
      reason: input.sourceAccess === 'revoked' ? 'source_access_revoked' :
        input.retention === 'deleted' ? 'source_deleted' : 'source_retention_expired',
      featureState: null, amount: null });
  }
  const { value, historical, latest } = validatePair(input.feature,
    input.captured, input.current);
  const sameSources = JSON.stringify(historical.manifest.sources) ===
    JSON.stringify(latest.manifest.sources);
  return Object.freeze({ version: VERSION,
    lineageState: sameSources ? 'current' : 'stale',
    reason: sameSources ? null : 'source_set_changed',
    featureState: sameSources ? value.state : null,
    amount: sameSources && value.state === 'known' ? value.amount : null });
}

function replayFeatureLineage(input) {
  if (!exact(input, ['items', 'current', 'cursor', 'limit', 'sourceAccess', 'retention']) ||
      !['granted', 'revoked'].includes(input.sourceAccess) ||
      !['current', 'expired', 'deleted'].includes(input.retention) ||
      !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100 ||
      !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25) invalid();
  if (input.sourceAccess !== 'granted' || input.retention !== 'current') {
    const error = new Error('Forecast feature lineage is unavailable.');
    error.code = 'M26_FEATURE_LINEAGE_UNAVAILABLE';
    error.status = 403;
    throw error;
  }
  const latest = normalizeReceipt(input.current);
  const items = input.items.map(item => {
    if (!exact(item, ['feature', 'captured'])) invalid();
    // Validate every item before returning any page or computing the replay pin.
    return validatePair(item.feature, item.captured, latest);
  });
  const inputDigest = sha256(items.map(item => ({
    feature: item.value, captured: item.historical,
  })));
  let offset = 0;
  if (input.cursor !== null) {
    if (!exact(input.cursor, ['version', 'offset', 'currentDigest', 'inputDigest']) ||
        input.cursor.version !== VERSION || !Number.isInteger(input.cursor.offset) ||
        input.cursor.offset <= 0 || input.cursor.offset >= items.length ||
        input.cursor.currentDigest !== latest.digest ||
        input.cursor.inputDigest !== inputDigest) invalid();
    offset = input.cursor.offset;
  }
  const page = items.slice(offset, offset + input.limit).map(item => {
    const sameSources = JSON.stringify(item.historical.manifest.sources) ===
      JSON.stringify(item.latest.manifest.sources);
    return Object.freeze({ version: VERSION,
      lineageState: sameSources ? 'current' : 'stale',
      reason: sameSources ? null : 'source_set_changed',
      featureState: sameSources ? item.value.state : null,
      amount: sameSources && item.value.state === 'known' ? item.value.amount : null });
  });
  const nextOffset = offset + page.length;
  return Object.freeze({ results: Object.freeze(page),
    nextCursor: nextOffset === items.length ? null : Object.freeze({
      version: VERSION, offset: nextOffset, currentDigest: latest.digest,
      inputDigest,
    }) });
}

module.exports = { VERSION, reconcileFeatureLineage, replayFeatureLineage };
