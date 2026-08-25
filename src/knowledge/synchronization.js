'use strict';

const crypto = require('crypto');
const {
  canonicalStringify,
  normalizeUuid,
} = require('./contract');
const {
  CONSUMER_PROFILES,
  normalizeProjectionRequest,
} = require('./projection');

const EXTERNAL_CONSUMERS = Object.freeze(['integration_adapter', 'voice_runtime']);
const TARGET_STATUSES = Object.freeze(['active', 'suspended']);
const TRIGGER_TYPES = Object.freeze([
  'publication', 'target_config', 'reconciliation', 'drift', 'staleness',
]);
const PROVIDER_KEY = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const DIAGNOSTIC_CATEGORY = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const MAX_TARGETS_PER_PUBLICATION = 32;
const MAX_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const RETRY_SECONDS = Object.freeze([15, 60, 300, 900]);

class KnowledgeSynchronizationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'KnowledgeSynchronizationError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new KnowledgeSynchronizationError(code, message, status);
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedInteger(value, field, minimum, maximum, fallback) {
  const candidate = value === undefined ? fallback : value;
  const number = Number(candidate);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail('knowledge_sync_invalid_request', `${field} is outside its allowed bounds`);
  }
  return number;
}

function normalizeProviderKey(value) {
  if (typeof value !== 'string') {
    fail('knowledge_sync_invalid_provider', 'providerKey must be provider-neutral text');
  }
  const normalized = value.normalize('NFC').trim().toLowerCase();
  if (normalized.length < 1 || normalized.length > 64 ||
      Buffer.byteLength(normalized, 'utf8') > 64 ||
      CONTROL_OR_FORMAT.test(normalized) || !PROVIDER_KEY.test(normalized)) {
    fail('knowledge_sync_invalid_provider', 'providerKey is outside its allowed contract');
  }
  return normalized;
}

function normalizeTargetStatus(value) {
  const status = value === undefined ? 'active' : value;
  if (!TARGET_STATUSES.includes(status)) {
    fail('knowledge_sync_invalid_request', 'status is not supported');
  }
  return status;
}

function targetConfigurationDocument(target) {
  return {
    audience: target.audience,
    capabilities: target.capabilities,
    consumer: target.consumer,
    maximumBytes: target.maximumBytes,
    maximumEntries: target.maximumEntries,
    providerKey: target.providerKey,
    revision: target.targetRevision,
    staleAfterSeconds: target.staleAfterSeconds,
    status: target.status,
  };
}

function digestCanonical(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex');
}

function normalizeSyncTargetInput(input, options = {}) {
  if (!plainObject(input)) {
    fail('knowledge_sync_invalid_request', 'Synchronization target input must be an object');
  }
  const organizationId = normalizeUuid(input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input.actorUserId, 'actorUserId');
  const providerKey = normalizeProviderKey(input.providerKey);
  if (!EXTERNAL_CONSUMERS.includes(input.consumer)) {
    fail('knowledge_sync_invalid_consumer', 'Only an external provider-neutral consumer is supported');
  }
  const profile = CONSUMER_PROFILES[input.consumer];
  const projection = normalizeProjectionRequest({
    organizationId,
    actorUserId,
    consumer: input.consumer,
    audience: input.audience,
    capabilities: input.capabilities,
    maximumEntries: input.maximumEntries,
    maximumBytes: input.maximumBytes,
  });
  const targetRevision = boundedInteger(
    input.targetRevision,
    'targetRevision',
    1,
    2147483647,
    options.defaultRevision || 1
  );
  const staleAfterSeconds = boundedInteger(
    input.staleAfterSeconds,
    'staleAfterSeconds',
    300,
    604800,
    86400
  );
  const status = normalizeTargetStatus(input.status);
  const target = {
    actorUserId,
    audience: projection.audience,
    capabilities: projection.capabilities,
    consumer: projection.consumer,
    maximumBytes: projection.maximumBytes,
    maximumEntries: projection.maximumEntries,
    organizationId,
    providerKey,
    staleAfterSeconds,
    status,
    targetRevision,
  };
  if (!profile.requiresAdministrator || !profile.requiresCompleteProjection) {
    fail('knowledge_sync_invalid_consumer', 'Synchronization requires a complete administrator projection');
  }
  return Object.freeze({
    ...target,
    configurationDigest: digestCanonical(targetConfigurationDocument(target)),
  });
}

function normalizeClaimOptions(input = {}) {
  if (!plainObject(input)) fail('knowledge_sync_invalid_request', 'Claim options must be an object');
  return Object.freeze({
    batchSize: boundedInteger(input.batchSize, 'batchSize', 1, MAX_BATCH_SIZE, 10),
    leaseSeconds: boundedInteger(input.leaseSeconds, 'leaseSeconds', 5, 300, 30),
  });
}

function normalizeDiagnosticCategory(value, fallback = 'provider_failure') {
  const candidate = typeof value === 'string' ? value : fallback;
  const normalized = candidate.normalize('NFC').trim().toLowerCase();
  if (!DIAGNOSTIC_CATEGORY.test(normalized)) return fallback;
  return normalized;
}

function normalizeObservedDigest(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('knowledge_sync_malformed_response', 'Provider acknowledgement omitted its digest', 502);
    return null;
  }
  if (typeof value !== 'string' || !SHA256.test(value.toLowerCase())) {
    fail('knowledge_sync_malformed_response', 'Provider acknowledgement digest is malformed', 502);
  }
  return value.toLowerCase();
}

function normalizeTransportResult(value) {
  if (!plainObject(value)) {
    fail('knowledge_sync_malformed_response', 'Provider transport returned a malformed acknowledgement', 502);
  }
  const allowed = new Set(['accepted', 'diagnosticCategory', 'observedProjectionDigest']);
  if (Object.keys(value).some(key => !allowed.has(key)) || typeof value.accepted !== 'boolean') {
    fail('knowledge_sync_malformed_response', 'Provider transport returned a malformed acknowledgement', 502);
  }
  const observedProjectionDigest = normalizeObservedDigest(
    value.observedProjectionDigest,
    value.accepted
  );
  return Object.freeze({
    accepted: value.accepted,
    diagnosticCategory: value.accepted
      ? null
      : normalizeDiagnosticCategory(value.diagnosticCategory),
    observedProjectionDigest,
  });
}

function normalizeTrigger(value) {
  if (!plainObject(value) || !TRIGGER_TYPES.includes(value.type)) {
    fail('knowledge_sync_invalid_trigger', 'Synchronization trigger is invalid');
  }
  if (value.type === 'publication') {
    const digest = typeof value.canonicalDigest === 'string'
      ? value.canonicalDigest.toLowerCase() : '';
    if (!SHA256.test(digest)) {
      fail('knowledge_sync_invalid_trigger', 'Publication trigger digest is invalid');
    }
    return Object.freeze({
      type: value.type,
      publicationId: normalizeUuid(value.publicationId, 'publicationId'),
      entryId: normalizeUuid(value.entryId, 'entryId'),
      versionId: normalizeUuid(value.versionId, 'versionId'),
      canonicalDigest: digest,
    });
  }
  return Object.freeze({ type: value.type });
}

function retryDelaySeconds(attemptCount) {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || attemptCount > MAX_ATTEMPTS) {
    fail('knowledge_sync_invalid_attempt', 'Synchronization attempt count is invalid');
  }
  return RETRY_SECONDS[Math.min(attemptCount - 1, RETRY_SECONDS.length - 1)] || 900;
}

module.exports = {
  EXTERNAL_CONSUMERS,
  KnowledgeSynchronizationError,
  MAX_ATTEMPTS,
  MAX_BATCH_SIZE,
  MAX_TARGETS_PER_PUBLICATION,
  RETRY_SECONDS,
  TARGET_STATUSES,
  TRIGGER_TYPES,
  digestCanonical,
  normalizeClaimOptions,
  normalizeDiagnosticCategory,
  normalizeObservedDigest,
  normalizeProviderKey,
  normalizeSyncTargetInput,
  normalizeTransportResult,
  normalizeTrigger,
  retryDelaySeconds,
  targetConfigurationDocument,
};
