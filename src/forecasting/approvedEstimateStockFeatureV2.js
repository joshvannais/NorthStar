'use strict';

// Target-complete Part 2C projection over the purpose-fixed Part 2A v2
// authority. The database authenticates and fences the source receipt; this
// module only validates that exact projection and emits the registered value.
const { sha256 } = require('../services/businessProfileAdapter');
const { VALUE_VERSION_V2 } = require('./featureContract');
const { registeredFeatureDefinition, normalizeRegisteredFeatureValueV2 } =
  require('./featureDefinitions');
const { normalizeSnapshot, captureView, readView } =
  require('./approvedEstimateAsOfV2');

const VERSION = 'm26-approved-estimate-stock-feature-v2';
const MISSING_REASONS = new Set(['coverage_epoch_missing', 'baseline_pin_limit',
  'baseline_size_limit', 'legacy_order_gap']);

function definition() {
  const value = registeredFeatureDefinition('pipeline.approved_estimate_stock', 'v1');
  if (!value) throw new Error('Approved-estimate feature definition is unavailable.');
  return value;
}

function latestRecordedAt(snapshot) {
  return snapshot.sources.reduce((latest, source) =>
    latest === null || source.recordedAt > latest ? source.recordedAt : latest, null);
}

function envelope(feature, options) {
  return Object.freeze({
    version: VERSION,
    feature,
    coverage: Object.freeze({
      state: options.targetComplete ? 'complete' : 'unavailable',
      scope: 'northstar_m24_decision_ledger',
      startsAt: options.startsAt,
      providerCoverageVerified: false,
      wholeBusinessCoverageVerified: false,
    }),
    sourceAuthenticated: options.sourceAuthenticated,
    targetComplete: options.targetComplete,
    sourceCurrent: options.sourceCurrent,
    eligibleForForecast: false,
    forecastIssued: false,
  });
}

function normalizedFeature(snapshot, state) {
  const declared = definition();
  return normalizeRegisteredFeatureValueV2({
    contractVersion: VALUE_VERSION_V2,
    organizationId: snapshot.organizationId,
    definitionKey: declared.key,
    definitionVersion: declared.definitionVersion,
    definitionDigest: sha256(declared),
    asOf: snapshot.asOf,
    reportingWindow: null,
    sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
    latestSourceRecordedAt: latestRecordedAt(snapshot),
    state,
    amount: state === 'known' ? String(snapshot.sourceCount) : null,
    reason: state === 'stale' ? 'source_changed' : null,
    unit: { ...declared.unit },
  });
}

function missingFeature(organizationId, evaluatedAt, reason) {
  if (!MISSING_REASONS.has(reason)) {
    throw new Error('Approved-estimate feature coverage reason is invalid.');
  }
  const declared = definition();
  return envelope(normalizeRegisteredFeatureValueV2({
    contractVersion: VALUE_VERSION_V2,
    organizationId,
    definitionKey: declared.key,
    definitionVersion: declared.definitionVersion,
    definitionDigest: sha256(declared),
    asOf: evaluatedAt,
    reportingWindow: null,
    sourceSnapshotDigest: null,
    latestSourceRecordedAt: null,
    state: 'missing',
    amount: null,
    reason,
    unit: { ...declared.unit },
  }), { sourceAuthenticated: false, targetComplete: false,
    sourceCurrent: false, startsAt: null });
}

function captureFeatureView(value, organizationId, evaluatedAt) {
  const source = captureView(value, organizationId);
  if (source.state === 'unavailable') {
    return Object.freeze({ ...missingFeature(organizationId, evaluatedAt, source.reason),
      replayed: false });
  }
  const snapshot = normalizeSnapshot(value.snapshot, organizationId);
  return Object.freeze({
    ...envelope(normalizedFeature(snapshot,
      source.sourceCurrent ? 'known' : 'stale'), {
      sourceAuthenticated: true,
      targetComplete: true,
      sourceCurrent: source.sourceCurrent,
      startsAt: snapshot.coverage.startsAt,
    }),
    snapshotId: snapshot.id,
    replayed: source.replayed,
  });
}

function readFeatureView(value, organizationId) {
  const source = readView(value, organizationId);
  const snapshot = normalizeSnapshot(value.snapshot, organizationId);
  return Object.freeze({
    ...envelope(normalizedFeature(snapshot,
      source.sourceCurrent ? 'known' : 'stale'), {
      sourceAuthenticated: true,
      targetComplete: true,
      sourceCurrent: source.sourceCurrent,
      startsAt: snapshot.coverage.startsAt,
    }),
    snapshotId: snapshot.id,
  });
}

module.exports = { VERSION, captureFeatureView, readFeatureView };
