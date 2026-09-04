'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TRANSITIONS = new Set(['start', 'pause', 'resume']);
const MAXIMUM_BODY_BYTES = 32 * 1024;

class FieldExecutionContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'FieldExecutionContractError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new FieldExecutionContractError(status, code, message);
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.has(key))) {
    fail(400, code, 'Field execution request is invalid.');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > MAXIMUM_BODY_BYTES) {
    fail(413, 'M23_EXECUTION_BODY_TOO_LARGE', 'Field execution request exceeds the 32768-byte limit.');
  }
  return value;
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function uuid(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || !UUID.test(value)) {
    fail(400, code, `${label} is invalid.`);
  }
  return value.toLowerCase();
}

function digest(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || !DIGEST.test(value)) {
    fail(400, code, `${label} is invalid.`);
  }
  return value;
}

function revision(value, code, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(400, code, `${label} is invalid.`);
  }
  return value;
}

function reason(value) {
  if (typeof value !== 'string') {
    fail(400, 'INVALID_EXECUTION_REASON', 'Field execution reason is invalid.');
  }
  const normalized = value.normalize('NFC');
  if (normalized !== value || value !== value.trim() || !value ||
      Array.from(value).length > 1000 || Buffer.byteLength(value, 'utf8') > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(400, 'INVALID_EXECUTION_REASON', 'Field execution reason is invalid.');
  }
  return value;
}

function idempotencyKey(value) {
  if (typeof value !== 'string' || value !== value.trim() ||
      value.length < 16 || value.length > 128 || /[^\x21-\x7e]/.test(value)) {
    fail(400, 'INVALID_IDEMPOTENCY_KEY', 'A bounded canonical Idempotency-Key is required.');
  }
  return value;
}

function trustedActor(input) {
  return Object.freeze({
    organizationId: uuid(input && input.organizationId, 'INVALID_EXECUTION_ORGANIZATION', 'Organization'),
    actorUserId: uuid(input && input.actorUserId, 'INVALID_EXECUTION_ACTOR', 'Execution actor'),
    actorAccessRole: String(input && input.actorAccessRole || ''),
    authSessionId: uuid(input && input.authSessionId, 'INVALID_EXECUTION_SESSION', 'Execution session'),
  });
}

function normalizeInitialization(input) {
  const body = exactObject(input && input.body, new Set([
    'expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason',
  ]), 'INVALID_EXECUTION_INITIALIZATION');
  if (['expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason'].some(key => !has(body, key))) {
    fail(428, 'M23_EXECUTION_PRECONDITION_REQUIRED',
      'Exact assignment revision, assignment digest, reason, and idempotency evidence are required.');
  }
  return Object.freeze({
    ...trustedActor(input),
    appointmentId: uuid(input && input.appointmentId, 'INVALID_EXECUTION_APPOINTMENT', 'Appointment'),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment revision'),
    expectedAssignmentDigest: digest(body.expectedAssignmentDigest,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment digest'),
    reason: reason(body.reason),
    idempotencyKey: idempotencyKey(input && input.idempotencyKey),
  });
}

function normalizeTransition(input) {
  const body = exactObject(input && input.body, new Set([
    'action', 'expectedRevision', 'expectedDigest',
    'expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason',
  ]), 'INVALID_EXECUTION_TRANSITION');
  if (['action', 'expectedRevision', 'expectedDigest', 'expectedAssignmentRevision',
    'expectedAssignmentDigest', 'reason'].some(key => !has(body, key))) {
    fail(428, 'M23_EXECUTION_PRECONDITION_REQUIRED',
      'Exact execution and assignment pins, action, reason, and idempotency evidence are required.');
  }
  if (!TRANSITIONS.has(body.action)) {
    fail(400, 'INVALID_EXECUTION_ACTION', 'Field execution action is invalid.');
  }
  return Object.freeze({
    ...trustedActor(input),
    executionId: uuid(input && input.executionId, 'INVALID_EXECUTION_ID', 'Field execution'),
    action: body.action,
    expectedRevision: revision(body.expectedRevision,
      'INVALID_EXECUTION_PRECONDITION', 'Expected execution revision'),
    expectedDigest: digest(body.expectedDigest,
      'INVALID_EXECUTION_PRECONDITION', 'Expected execution digest'),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment revision'),
    expectedAssignmentDigest: digest(body.expectedAssignmentDigest,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment digest'),
    reason: reason(body.reason),
    idempotencyKey: idempotencyKey(input && input.idempotencyKey),
  });
}

function normalizeExecutionId(value) {
  return uuid(value, 'INVALID_EXECUTION_ID', 'Field execution');
}

module.exports = {
  DIGEST,
  FieldExecutionContractError,
  MAXIMUM_BODY_BYTES,
  TRANSITIONS,
  UUID,
  normalizeExecutionId,
  normalizeInitialization,
  normalizeTransition,
};
