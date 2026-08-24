'use strict';

const {
  buildCanonicalKnowledgeDocument,
  normalizeInitialDraft,
  normalizeUuid,
} = require('./contract');

const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

class KnowledgeLifecycleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'KnowledgeLifecycleError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new KnowledgeLifecycleError(code, message, status);
}

function normalizePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail('knowledge_lifecycle_invalid_version', `${field} must be a positive integer`);
  }
  return number;
}

function normalizeDigest(value, field) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256.test(normalized)) {
    fail('knowledge_lifecycle_invalid_digest', `${field} must be a SHA-256 hex digest`);
  }
  return normalized;
}

function normalizeReason(value) {
  if (typeof value !== 'string') fail('knowledge_lifecycle_invalid_reason', 'reason must be text');
  const normalized = value.normalize('NFC').trim();
  if (normalized.length < 1 || normalized.length > 500 ||
      Buffer.byteLength(normalized, 'utf8') > 2000 || CONTROL_OR_FORMAT.test(normalized)) {
    fail('knowledge_lifecycle_invalid_reason', 'reason is outside its allowed bounds');
  }
  return normalized;
}

function normalizeLifecycleTarget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('knowledge_lifecycle_invalid_input', 'Lifecycle input must be an object');
  }
  return Object.freeze({
    organizationId: normalizeUuid(input.organizationId, 'organizationId'),
    actorUserId: normalizeUuid(input.actorUserId, 'actorUserId'),
    entryId: normalizeUuid(input.entryId, 'entryId'),
    expectedVersionId: normalizeUuid(input.expectedVersionId, 'expectedVersionId'),
    expectedVersionNumber: normalizePositiveInteger(
      input.expectedVersionNumber,
      'expectedVersionNumber'
    ),
    expectedCanonicalDigest: normalizeDigest(
      input.expectedCanonicalDigest,
      'expectedCanonicalDigest'
    ),
    reason: normalizeReason(input.reason),
  });
}

function normalizeRevisionInput(input) {
  const target = normalizeLifecycleTarget(input);
  const draft = normalizeInitialDraft(input);
  if (draft.organizationId !== target.organizationId || draft.actorUserId !== target.actorUserId) {
    fail('knowledge_lifecycle_identity_mismatch', 'Revision identity is inconsistent');
  }
  if (draft.provenance.length > 1023) {
    fail('knowledge_lifecycle_provenance_too_large', 'Revision provenance exceeds its limit');
  }
  return Object.freeze({ ...target, draft });
}

function normalizeTombstoneInput(input) {
  return normalizeLifecycleTarget(input);
}

function normalizeRollbackInput(input) {
  const target = normalizeLifecycleTarget(input);
  return Object.freeze({
    ...target,
    rollbackVersionId: normalizeUuid(input.rollbackVersionId, 'rollbackVersionId'),
    rollbackVersionNumber: normalizePositiveInteger(
      input.rollbackVersionNumber,
      'rollbackVersionNumber'
    ),
    rollbackCanonicalDigest: normalizeDigest(
      input.rollbackCanonicalDigest,
      'rollbackCanonicalDigest'
    ),
  });
}

function buildTombstoneDocument(entry, parent) {
  return buildCanonicalKnowledgeDocument({
    applicability: parent.applicability,
    canonicalKey: entry.canonical_key,
    content: { state: 'tombstoned' },
    entryType: entry.entry_type,
    label: parent.label,
    origin: 'human',
    reviewRequirement: parent.review_requirement,
    sensitivity: parent.sensitivity,
  });
}

module.exports = {
  KnowledgeLifecycleError,
  buildTombstoneDocument,
  normalizeLifecycleTarget,
  normalizeRevisionInput,
  normalizeRollbackInput,
  normalizeTombstoneInput,
};
