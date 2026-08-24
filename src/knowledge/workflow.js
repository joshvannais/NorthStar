'use strict';

const crypto = require('crypto');
const {
  MAX_DOCUMENT_BYTES,
  canonicalObject,
  canonicalStringify,
  normalizeUuid,
} = require('./contract');

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const MAX_DIFF_OPERATIONS = 512;
const APPROVAL_ACTIONS = Object.freeze({
  standard: 'standard_approved',
  high_risk: 'high_risk_approved',
  attorney_gated: 'attorney_gated_approved',
});

class KnowledgeWorkflowError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'KnowledgeWorkflowError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new KnowledgeWorkflowError(code, message, status);
}

function boundedText(value, field, options) {
  if (typeof value !== 'string') fail('knowledge_workflow_invalid_text', `${field} must be text`);
  const normalized = value.normalize('NFC').trim();
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (normalized.length < options.min || normalized.length > options.max || bytes > options.maxBytes) {
    fail('knowledge_workflow_invalid_text', `${field} is outside its allowed length`);
  }
  if (CONTROL_OR_FORMAT.test(normalized)) {
    fail('knowledge_workflow_invalid_text', `${field} contains control or formatting characters`);
  }
  return normalized;
}

function normalizeDigest(value, field = 'canonicalDigest') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256.test(normalized)) fail('knowledge_workflow_invalid_digest', `${field} must be a SHA-256 digest`);
  return normalized;
}

function normalizeOptionalUuid(value, field) {
  if (value === undefined || value === null) return null;
  return normalizeUuid(value, field);
}

function normalizePositiveInteger(value, field) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail('knowledge_workflow_invalid_version', `${field} must be a positive integer`);
  }
  return value;
}

function normalizeNonNegativeInteger(value, field) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('knowledge_workflow_invalid_sequence', `${field} must be a non-negative integer`);
  }
  return value;
}

function normalizeWorkflowTarget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('knowledge_workflow_invalid_input', 'Knowledge workflow input must be an object');
  }
  return Object.freeze({
    organizationId: normalizeUuid(input.organizationId, 'organizationId'),
    actorUserId: normalizeUuid(input.actorUserId, 'actorUserId'),
    entryId: normalizeUuid(input.entryId, 'entryId'),
    versionId: normalizeUuid(input.versionId, 'versionId'),
    versionNumber: normalizePositiveInteger(input.versionNumber, 'versionNumber'),
    canonicalDigest: normalizeDigest(input.canonicalDigest),
    expectedReviewEventId: normalizeOptionalUuid(input.expectedReviewEventId, 'expectedReviewEventId'),
    reason: boundedText(input.reason, 'reason', { min: 1, max: 500, maxBytes: 2000 }),
  });
}

function normalizePublicationTarget(input) {
  const target = normalizeWorkflowTarget(input);
  return Object.freeze({
    ...target,
    expectedPublicationId: normalizeOptionalUuid(input.expectedPublicationId, 'expectedPublicationId'),
    expectedPublicationNumber: normalizeNonNegativeInteger(
      input.expectedPublicationNumber === undefined ? 0 : input.expectedPublicationNumber,
      'expectedPublicationNumber'
    ),
  });
}

function normalizeAttorneyReviewEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'knowledge_attorney_review_required',
      'Attorney-gated knowledge requires recorded external attorney-review evidence',
      409
    );
  }
  const reviewedAt = new Date(value.reviewedAt);
  if (typeof value.reviewedAt !== 'string' || !ISO_TIMESTAMP.test(value.reviewedAt) ||
      Number.isNaN(reviewedAt.getTime())) {
    fail('knowledge_attorney_review_invalid', 'reviewedAt must be an ISO-8601 timestamp');
  }
  return Object.freeze({
    reviewReference: boundedText(value.reviewReference, 'reviewReference', {
      min: 1, max: 128, maxBytes: 512,
    }),
    evidenceDigest: normalizeDigest(value.evidenceDigest, 'evidenceDigest'),
    reviewedAt: reviewedAt.toISOString(),
  });
}

function escapePointer(value) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function equalCanonical(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function collectDiff(base, target, path, operations) {
  if (equalCanonical(base, target)) return;
  const baseObject = base !== null && typeof base === 'object' && !Array.isArray(base);
  const targetObject = target !== null && typeof target === 'object' && !Array.isArray(target);
  if (baseObject && targetObject) {
    const baseKeys = Object.keys(base).sort(compareUtf8);
    const targetKeys = Object.keys(target).sort(compareUtf8);
    const targetSet = new Set(targetKeys);
    for (const key of baseKeys) {
      if (!targetSet.has(key)) operations.push({ op: 'remove', path: `${path}/${escapePointer(key)}` });
    }
    const baseSet = new Set(baseKeys);
    for (const key of targetKeys) {
      const nestedPath = `${path}/${escapePointer(key)}`;
      if (!baseSet.has(key)) operations.push({ op: 'add', path: nestedPath, value: target[key] });
      else collectDiff(base[key], target[key], nestedPath, operations);
    }
    return;
  }
  operations.push({ op: 'replace', path, value: target });
}

function buildKnowledgeDiff(baseDocument, targetDocument) {
  const target = canonicalObject(targetDocument, 'targetDocument', MAX_DOCUMENT_BYTES);
  let operations;
  if (baseDocument === null || baseDocument === undefined) {
    operations = [{ op: 'add', path: '', value: target }];
  } else {
    const base = canonicalObject(baseDocument, 'baseDocument', MAX_DOCUMENT_BYTES);
    operations = [];
    collectDiff(base, target, '', operations);
  }
  if (operations.length > MAX_DIFF_OPERATIONS) {
    fail('knowledge_diff_too_complex', 'Knowledge diff exceeds the operation limit', 409);
  }
  if (operations.length === 0) {
    fail('knowledge_diff_empty', 'The exact version does not differ from the current publication', 409);
  }
  const document = canonicalObject({ operations, schemaVersion: 1 }, 'diff', MAX_DOCUMENT_BYTES);
  const canonicalDiff = canonicalStringify(document);
  const diffDigest = crypto.createHash('sha256').update(canonicalDiff, 'utf8').digest('hex');
  return Object.freeze({ document, canonicalDiff, diffDigest });
}

function approvalActionForRequirement(reviewRequirement) {
  const action = APPROVAL_ACTIONS[reviewRequirement];
  if (!action) fail('knowledge_workflow_invalid_requirement', 'Review requirement is unsupported', 409);
  return action;
}

module.exports = {
  APPROVAL_ACTIONS,
  KnowledgeWorkflowError,
  MAX_DIFF_OPERATIONS,
  approvalActionForRequirement,
  buildKnowledgeDiff,
  normalizeAttorneyReviewEvidence,
  normalizeDigest,
  normalizeOptionalUuid,
  normalizePublicationTarget,
  normalizeWorkflowTarget,
};
