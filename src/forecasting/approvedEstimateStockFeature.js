'use strict';

// Part 2C: calculate only the registered historical stock from a guarded
// Mission 24 lineage read. Calling this pure function does not authenticate a
// caller-provided object; the paid route owns that source boundary.
const { sha256 } = require('../services/businessProfileAdapter');
const { normalizeAsOfSourceManifest } = require('./asOfSourceManifest');
const { registeredFeatureDefinition, normalizeRegisteredFeatureValue } =
  require('./featureDefinitions');
const { reconcileFeatureLineage } = require('./lineageCurrentness');

const VERSION = 'm26-approved-estimate-stock-source-v1';
const DIGEST = /^[0-9a-f]{64}$/;

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const names = Reflect.ownKeys(value);
  return names.length === keys.length && names.every(name =>
    typeof name === 'string' && keys.includes(name) &&
    Object.getOwnPropertyDescriptor(value, name)?.enumerable &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
}

function invalid() {
  const error = new Error('Approved-estimate source is unavailable.');
  error.code = 'M26_APPROVED_ESTIMATE_SOURCE_INVALID';
  throw error;
}

function deriveApprovedEstimateStockFeature(readback, organizationId) {
  if (!exact(readback, ['captured', 'current']) ||
      !exact(readback.captured, ['manifest', 'digest']) ||
      !exact(readback.current, ['manifest', 'digest']) ||
      !DIGEST.test(readback.captured.digest || '') ||
      !DIGEST.test(readback.current.digest || '')) invalid();
  let captured, current;
  try {
    captured = normalizeAsOfSourceManifest(readback.captured.manifest);
    current = normalizeAsOfSourceManifest(readback.current.manifest);
  } catch (_error) { invalid(); }
  const definition = registeredFeatureDefinition('pipeline.approved_estimate_stock', 'v1');
  if (!definition || captured.organizationId !== organizationId ||
      current.organizationId !== organizationId ||
      captured.asOf !== captured.capturedAt ||
      current.asOf !== current.capturedAt ||
      [captured, current].some(manifest =>
        manifest.purposeKey !== definition.sourcePurposeKey ||
        manifest.targetKey !== definition.sourceTargetKey ||
        manifest.sources.some(source => source.sourceKind !== 'estimate_decision')) ||
      current.asOf < captured.asOf) invalid();

  const active = captured.sources.filter(source => source.state === 'active');
  const latest = captured.sources.reduce((value, source) =>
    value === null || source.recordedAt > value ? source.recordedAt : value, null);
  const feature = normalizeRegisteredFeatureValue({
    contractVersion: 'm26-feature-value-v1',
    organizationId, definitionKey: definition.key,
    definitionVersion: definition.definitionVersion,
    definitionDigest: sha256(definition), asOf: captured.asOf,
    reportingWindow: null, sourceSnapshotDigest: readback.captured.digest,
    latestSourceRecordedAt: latest, state: 'known',
    amount: String(active.length), reason: null, unit: { ...definition.unit },
  });
  const lineage = reconcileFeatureLineage({
    feature, captured: readback.captured, current: readback.current,
    sourceAccess: 'granted', retention: 'current',
  });
  return Object.freeze({ version: VERSION,
    state: lineage.lineageState === 'current' ? 'known' : 'stale',
    reason: lineage.reason, amount: lineage.amount,
    unit: Object.freeze({ ...definition.unit }),
    asOf: captured.asOf, sourceSnapshotDigest: readback.captured.digest,
    definitionDigest: sha256(definition),
    sourceAuthenticated: false, forecastIssued: false });
}

module.exports = { VERSION, deriveApprovedEstimateStockFeature };
