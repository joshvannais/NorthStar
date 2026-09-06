'use strict';

const VERSION = 'm23-completion-authority-v1';
const ACTIONS = Object.freeze([
  'propose_completion',
  'approve_completion',
  'withdraw_completion',
  'cancel_execution',
  'reopen_execution',
  'resume_reopened',
  'correct_completion',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f-\u1160\u17b4-\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ud800-\udfff\ufeff\uffa0\ufff9-\ufffd\u{e0000}-\u{e007f}<>]/u;

function fail(status = 400, code = 'INVALID_COMPLETION_REQUEST') {
  const error = new Error('Completion authority request is invalid or unavailable.');
  Object.assign(error, { status, statusCode: status, code });
  throw error;
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail();
  return value;
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail();
  return value;
}

function hash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) fail();
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail();
  return value;
}

function text(value, maximum = 1000) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() ||
      value !== value.normalize('NFC') || Array.from(value).length > maximum ||
      Buffer.byteLength(value, 'utf8') > maximum * 4 || FORBIDDEN_TEXT.test(value) ||
      /(?:https?:\/\/|data:|javascript:|www\.)/iu.test(value)) fail();
  return value;
}

function instant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value)) ||
      /T24:|:60(?:\.|Z|[+-])/.test(value)) fail();
  return value;
}

function pin(value) {
  exactObject(value, ['id', 'revision', 'digest']);
  return { id: uuid(value.id), revision: revision(value.revision), digest: hash(value.digest) };
}

function pins(value) {
  if (!Array.isArray(value) || value.length > 20) fail();
  const normalized = value.map(pin).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(normalized.map(item => item.id)).size !== normalized.length) fail();
  return normalized;
}

function gateRequirements(value) {
  exactObject(value, ['checklists', 'inspections', 'files']);
  return {
    checklists: pins(value.checklists),
    inspections: pins(value.inspections),
    files: pins(value.files),
  };
}

function common(input, extraFields) {
  const body = input && input.body;
  if (!body || !ACTIONS.includes(body.action)) fail();
  const commonFields = [
    'action',
    'expectedExecutionRevision',
    'expectedExecutionDigest',
    'expectedAssignmentRevision',
    'expectedAssignmentDigest',
    'reason',
  ];
  exactObject(body, [...commonFields, ...extraFields]);
  if (typeof input.idempotencyKey !== 'string' ||
      !/^[!-~]{16,128}$/.test(input.idempotencyKey) ||
      input.idempotencyKey !== input.idempotencyKey.trim()) fail(428, 'COMPLETION_PRECONDITION_REQUIRED');
  return {
    organizationId: uuid(input.organizationId),
    actorUserId: uuid(input.actorUserId),
    actorAccessRole: input.actorAccessRole,
    authSessionId: uuid(input.authSessionId),
    executionId: uuid(input.executionId),
    action: body.action,
    expectedExecutionRevision: revision(body.expectedExecutionRevision),
    expectedExecutionDigest: hash(body.expectedExecutionDigest),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision),
    expectedAssignmentDigest: hash(body.expectedAssignmentDigest),
    reason: text(body.reason),
    idempotencyKey: input.idempotencyKey,
  };
}

function normalizeCompletionAction(input) {
  const body = input && input.body;
  if (!body || !ACTIONS.includes(body.action)) fail();
  let normalized;
  if (body.action === 'propose_completion') {
    normalized = common(input, ['expiresAt', 'gateRequirements']);
    normalized.expiresAt = instant(body.expiresAt);
    normalized.gateRequirements = gateRequirements(body.gateRequirements);
  } else if (body.action === 'approve_completion' || body.action === 'withdraw_completion') {
    normalized = common(input, ['proposal']);
    normalized.proposal = pin(body.proposal);
  } else if (body.action === 'cancel_execution') {
    normalized = common(input, ['proposal']);
    normalized.proposal = body.proposal === null ? null : pin(body.proposal);
  } else if (body.action === 'reopen_execution') {
    normalized = common(input, ['completion', 'nextAction']);
    normalized.completion = pin(body.completion);
    normalized.nextAction = text(body.nextAction);
  } else if (body.action === 'resume_reopened') {
    normalized = common(input, ['reopening']);
    normalized.reopening = pin(body.reopening);
  } else {
    normalized = common(input, ['record', 'annotation']);
    normalized.record = pin(body.record);
    exactObject(body.annotation, ['note', 'nextAction']);
    normalized.annotation = {
      note: text(body.annotation.note, 2000),
      nextAction: body.annotation.nextAction === null ? null : text(body.annotation.nextAction),
    };
  }
  return {
    ...normalized,
    proposal: normalized.proposal || null,
    completion: normalized.completion || null,
    reopening: normalized.reopening || null,
    record: normalized.record || null,
    expiresAt: normalized.expiresAt || null,
    gateRequirements: normalized.gateRequirements || null,
    nextAction: normalized.nextAction || null,
    annotation: normalized.annotation || null,
    contractVersion: VERSION,
  };
}

function normalizeCompletionRead(executionId, query) {
  if (!query || typeof query !== 'object' || Object.keys(query).length !== 0) {
    fail(400, 'COMPLETION_QUERY_FORBIDDEN');
  }
  return uuid(executionId);
}

module.exports = {
  ACTIONS,
  VERSION,
  normalizeCompletionAction,
  normalizeCompletionRead,
};
