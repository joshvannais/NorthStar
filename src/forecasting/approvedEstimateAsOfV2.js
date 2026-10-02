'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DIGEST = /^[0-9a-f]{64}$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function normalizeSnapshot(snapshot, organizationId) {
  if (!exact(snapshot, ['id', 'version', 'organizationId', 'asOf', 'capturedAt',
    'purposeKey', 'targetKey', 'sources', 'sourceCount', 'sourceSnapshotDigest',
    'coverage', 'historicalBoundary']) ||
    snapshot.version !== 'm26-approved-estimate-asof-v2' ||
    snapshot.organizationId !== organizationId ||
    snapshot.purposeKey !== 'forecast_pipeline' ||
    snapshot.targetKey !== 'pipeline.approved_estimates' ||
    !UUID.test(snapshot.id || '') || !INSTANT.test(snapshot.asOf || '') ||
    snapshot.asOf !== snapshot.capturedAt || !Array.isArray(snapshot.sources) ||
    !Number.isSafeInteger(snapshot.sourceCount) ||
    snapshot.sourceCount !== snapshot.sources.length || snapshot.sourceCount > 1000 ||
    !DIGEST.test(snapshot.sourceSnapshotDigest || '') ||
    !exact(snapshot.coverage, ['state', 'scope', 'startsAt',
      'providerCoverageVerified', 'wholeBusinessCoverageVerified']) ||
    snapshot.coverage.state !== 'complete' ||
    snapshot.coverage.scope !== 'northstar_m24_decision_ledger' ||
    !INSTANT.test(snapshot.coverage.startsAt || '') ||
    snapshot.coverage.startsAt > snapshot.asOf ||
    snapshot.coverage.providerCoverageVerified !== false ||
    snapshot.coverage.wholeBusinessCoverageVerified !== false) {
    throw new Error('Invalid approved-estimate v2 receipt');
  }
  for (const source of snapshot.sources) {
    if (!exact(source, ['sourceKind', 'estimateId', 'sourceId', 'revision',
      'digest', 'recordedAt', 'state']) ||
      source.sourceKind !== 'estimate_decision' || source.state !== 'active' ||
      !UUID.test(source.estimateId || '') || !UUID.test(source.sourceId || '') ||
      !Number.isSafeInteger(source.revision) || source.revision < 1 ||
      !DIGEST.test(source.digest || '') || !INSTANT.test(source.recordedAt || '') ||
      source.recordedAt > snapshot.asOf) {
      throw new Error('Invalid approved-estimate v2 source pin');
    }
  }
  return snapshot;
}

function captureView(value, organizationId) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state', 'reason', 'snapshot', 'replayed']) ||
      typeof value.reason !== 'string' || !value.reason || value.snapshot !== null ||
      value.replayed !== false) throw new Error('Invalid unavailable v2 receipt');
    return { state: 'unavailable', reason: value.reason, snapshotId: null,
      asOf: null, sourceSnapshotDigest: null, sourceCount: null,
      replayed: false, sourceAuthenticated: false, targetComplete: false,
      providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
      forecastIssued: false };
  }
  if (!exact(value, ['state', 'snapshot', 'replayed']) || value.state !== 'complete' ||
    (value.replayed !== true && value.replayed !== false)) {
    throw new Error('Invalid complete v2 capture');
  }
  const snapshot = normalizeSnapshot(value.snapshot, organizationId);
  return { state: 'current', reason: null, snapshotId: snapshot.id,
    asOf: snapshot.asOf, sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
    sourceCount: snapshot.sourceCount, replayed: value.replayed,
    sourceAuthenticated: true, targetComplete: true,
    providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
    forecastIssued: false };
}

function readView(value, organizationId) {
  if (!exact(value, ['snapshot', 'state', 'sourceCurrent',
    'eligibleForForecast', 'forecastIssued']) ||
    !['current', 'stale'].includes(value.state) ||
    value.sourceCurrent !== (value.state === 'current') ||
    value.eligibleForForecast !== false || value.forecastIssued !== false) {
    throw new Error('Invalid approved-estimate v2 currentness');
  }
  const snapshot = normalizeSnapshot(value.snapshot, organizationId);
  return { state: value.state, reason: value.state === 'stale' ? 'source_changed' : null,
    snapshotId: snapshot.id, asOf: snapshot.asOf,
    sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
    sourceCount: snapshot.sourceCount, sourceAuthenticated: true,
    targetComplete: true, sourceCurrent: value.sourceCurrent,
    providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
    eligibleForForecast: false, forecastIssued: false };
}

module.exports = { captureView, readView };
