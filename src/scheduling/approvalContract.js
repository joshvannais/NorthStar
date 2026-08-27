'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const schedulingTime = require('../../public/js/scheduling-time-contract');

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['assign', 'reassign', 'unassign', 'schedule', 'reschedule', 'dispatch']);
const TARGET_KINDS = new Set(['unassigned', 'profile', 'crew']);
const APPOINTMENT_STATUSES = new Set(['preferred', 'scheduled', 'cancelled', 'completed']);
const MAXIMUM_BODY_BYTES = 64 * 1024;
const MAXIMUM_APPOINTMENT_MILLISECONDS = 31 * 86400000;

class ApprovalContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApprovalContractError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ApprovalContractError(status, code, message);
}

function has(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.has(key))) {
    fail(400, code, 'Human approval request is invalid.');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > MAXIMUM_BODY_BYTES) fail(413, 'M22_APPROVAL_BODY_TOO_LARGE', 'Human approval request exceeds the 65536-byte limit.');
  return value;
}

function uuid(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || !UUID.test(value)) {
    fail(400, code, label + ' is invalid.');
  }
  return value.toLowerCase();
}

function digest(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || !DIGEST.test(value)) {
    fail(400, code, label + ' is invalid.');
  }
  return value;
}

function boundedReason(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value ||
      Array.from(value).length > 1000 || Buffer.byteLength(value, 'utf8') > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(400, 'INVALID_APPROVAL_REASON', 'Human approval reason is invalid.');
  }
  return value;
}

function idempotencyKey(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 16 || value.length > 128 ||
      /[^\x21-\x7e]/.test(value)) {
    fail(400, 'INVALID_IDEMPOTENCY_KEY', 'A bounded canonical Idempotency-Key is required.');
  }
  return value;
}

function timeZone(value) {
  if (!schedulingTime.isValidTimeZone(value)) {
    fail(400, 'INVALID_APPROVAL_TIME_ZONE', 'A current authoritative tenant IANA time zone is required.');
  }
  return value;
}

function instantOrNull(value, zone, label) {
  if (value === null) return null;
  try {
    return schedulingTime.validateRfc3339InZone(value, zone);
  } catch (_error) {
    fail(400, 'INVALID_APPROVAL_SCHEDULE', label + ' must be an exact RFC3339 timestamp that agrees with the tenant time zone.');
  }
}

function target(value) {
  const raw = exactObject(value, new Set(['kind', 'id']), 'INVALID_APPROVAL_TARGET');
  if (!TARGET_KINDS.has(raw.kind) ||
      (raw.kind === 'unassigned' ? raw.id !== null : typeof raw.id !== 'string')) {
    fail(400, 'INVALID_APPROVAL_TARGET', 'The proposed assignment target is invalid.');
  }
  return Object.freeze({
    kind: raw.kind,
    id: raw.kind === 'unassigned' ? null : uuid(raw.id, 'INVALID_APPROVAL_TARGET', 'Proposed target'),
  });
}

function exactDigestList(value, code) {
  if (!Array.isArray(value) || value.length > 256) {
    fail(400, code, 'Approval acknowledgements are invalid.');
  }
  const normalized = value.map(item => digest(item, code, 'Acknowledgement digest')).sort();
  if (normalized.some((item, index) => index > 0 && item === normalized[index - 1])) {
    fail(400, code, 'Approval acknowledgements contain a duplicate.');
  }
  return Object.freeze(normalized);
}

function normalizeMutationPreview(input) {
  const body = exactObject(input && input.body, new Set([
    'expectedRevision', 'expectedDigest', 'expectedTimeZone', 'action', 'target',
    'scheduledStart', 'scheduledEnd', 'appointmentStatus', 'reason',
  ]), 'INVALID_MUTATION_PREVIEW');
  const required = ['expectedRevision', 'expectedDigest', 'expectedTimeZone', 'action', 'target',
    'scheduledStart', 'scheduledEnd', 'appointmentStatus', 'reason'];
  if (required.some(key => !has(body, key))) {
    fail(428, 'M22_PREVIEW_PRECONDITION_REQUIRED',
      'Exact assignment, target, schedule, time-zone, action, status, and reason evidence is required.');
  }
  if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
    fail(400, 'INVALID_PREVIEW_PRECONDITION', 'The expected assignment revision is invalid.');
  }
  const expectedDigest = digest(body.expectedDigest, 'INVALID_PREVIEW_PRECONDITION', 'Expected assignment digest');
  const expectedTimeZone = timeZone(body.expectedTimeZone);
  if (!ACTIONS.has(body.action)) fail(400, 'INVALID_APPROVAL_ACTION', 'The requested human approval action is invalid.');
  const proposedTarget = target(body.target);
  const start = instantOrNull(body.scheduledStart, expectedTimeZone, 'Scheduled start');
  const end = instantOrNull(body.scheduledEnd, expectedTimeZone, 'Scheduled end');
  if ((start === null) !== (end === null) ||
      (start && (end.epochMilliseconds <= start.epochMilliseconds ||
        end.epochMilliseconds - start.epochMilliseconds > MAXIMUM_APPOINTMENT_MILLISECONDS))) {
    fail(400, 'INVALID_APPROVAL_SCHEDULE', 'The proposed schedule must be absent or positive and at most 31 days.');
  }
  if (typeof body.appointmentStatus !== 'string' || !APPOINTMENT_STATUSES.has(body.appointmentStatus)) {
    fail(400, 'INVALID_APPOINTMENT_STATUS', 'Appointment compatibility status is invalid.');
  }
  const reason = boundedReason(body.reason);
  const proposal = stableValue({
    target: proposedTarget,
    scheduledStart: start === null ? null : start.instant,
    scheduledEnd: end === null ? null : end.instant,
    submittedScheduledStart: body.scheduledStart,
    submittedScheduledEnd: body.scheduledEnd,
    timeZone: expectedTimeZone,
    appointmentStatus: body.appointmentStatus,
  });
  const normalized = {
    appointmentId: uuid(input && input.appointmentId, 'INVALID_APPROVAL_APPOINTMENT', 'Appointment'),
    expectedRevision: body.expectedRevision,
    expectedDigest,
    expectedTimeZone,
    action: body.action,
    target: proposedTarget,
    scheduledStart: proposal.scheduledStart,
    scheduledEnd: proposal.scheduledEnd,
    rawScheduledStart: body.scheduledStart,
    rawScheduledEnd: body.scheduledEnd,
    appointmentStatus: body.appointmentStatus,
    reason,
    proposal: Object.freeze(proposal),
  };
  normalized.requestDigest = sha256(stableValue({
    actorUserId: String(input.actorUserId),
    authSessionId: String(input.authSessionId),
    organizationId: String(input.organizationId),
    ...normalized,
  }));
  return Object.freeze(normalized);
}

function normalizeMutationApproval(input) {
  const body = exactObject(input && input.body, new Set([
    'previewId', 'previewDigest', 'acknowledgedWarningDigests',
    'acknowledgedReviewReasonDigests', 'reason',
  ]), 'INVALID_MUTATION_APPROVAL');
  const required = ['previewId', 'previewDigest', 'acknowledgedWarningDigests',
    'acknowledgedReviewReasonDigests', 'reason'];
  if (required.some(key => !has(body, key))) {
    fail(428, 'M22_APPROVAL_PRECONDITION_REQUIRED',
      'Exact preview, acknowledgement, reason, idempotency, and current session evidence is required.');
  }
  const key = idempotencyKey(input && input.idempotencyKey);
  const normalized = {
    appointmentId: uuid(input && input.appointmentId, 'INVALID_APPROVAL_APPOINTMENT', 'Appointment'),
    previewId: uuid(body.previewId, 'INVALID_MUTATION_APPROVAL', 'Mutation preview'),
    previewDigest: digest(body.previewDigest, 'INVALID_MUTATION_APPROVAL', 'Mutation preview digest'),
    acknowledgedWarningDigests: exactDigestList(body.acknowledgedWarningDigests, 'INVALID_WARNING_ACKNOWLEDGEMENT'),
    acknowledgedReviewReasonDigests: exactDigestList(body.acknowledgedReviewReasonDigests, 'INVALID_REVIEW_ACKNOWLEDGEMENT'),
    reason: boundedReason(body.reason),
    idempotencyKeyHash: sha256(key),
  };
  normalized.requestDigest = sha256(stableValue({
    actorUserId: String(input.actorUserId),
    authSessionId: String(input.authSessionId),
    organizationId: String(input.organizationId),
    ...normalized,
  }));
  return Object.freeze(normalized);
}

module.exports = {
  ACTIONS,
  ApprovalContractError,
  DIGEST,
  MAXIMUM_BODY_BYTES,
  normalizeMutationApproval,
  normalizeMutationPreview,
};
