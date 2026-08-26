'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');

const DIGEST = /^[0-9a-f]{64}$/;
const ACTIONS = new Set(['calendar_drag_drop', 'calendar_resize', 'calendar_edit']);
const STATUSES = new Set(['preferred', 'scheduled', 'cancelled', 'completed']);

class ScheduleContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ScheduleContractError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ScheduleContractError(status, code, message);
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function exactTimestamp(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length < 20 || value.length > 40 || value !== value.trim()) {
    fail(400, 'INVALID_APPOINTMENT_SCHEDULE', field + ' must be an exact RFC3339 timestamp.');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(400, 'INVALID_APPOINTMENT_SCHEDULE', field + ' must include an RFC3339 UTC offset.');
  }
  return parsed.toISOString();
}

function normalizeReason(value, action) {
  if (value === undefined) {
    return action === 'calendar_drag_drop'
      ? 'Human-approved calendar drag and drop.'
      : action === 'calendar_resize'
        ? 'Human-approved calendar resize.'
        : 'Human-approved calendar edit.';
  }
  if (typeof value !== 'string') fail(400, 'INVALID_APPROVAL_REASON', 'Approval reason is invalid.');
  const normalized = value.trim();
  if (!normalized || normalized.length > 1000 || Buffer.byteLength(normalized, 'utf8') > 4000) {
    fail(400, 'INVALID_APPROVAL_REASON', 'Approval reason is invalid.');
  }
  return normalized;
}

function requireApprovalPins(body, idempotencyKey, authSessionId) {
  const missing = !has(body, 'expectedRevision') || !has(body, 'expectedDigest') ||
    !has(body, 'action') || typeof idempotencyKey !== 'string' || !idempotencyKey || !authSessionId;
  if (missing) {
    fail(428, 'M22_APPROVAL_REQUIRED', 'Current revision, digest, action, idempotency, and session approval evidence are required.');
  }
}

function normalizeScheduleMutation(input) {
  const body = input && input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? input.body : {};
  requireApprovalPins(body, input && input.idempotencyKey, input && input.authSessionId);

  const expectedRevision = Number(body.expectedRevision);
  const expectedDigest = typeof body.expectedDigest === 'string' ? body.expectedDigest.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !DIGEST.test(expectedDigest)) {
    fail(400, 'INVALID_APPROVAL_PRECONDITION', 'Schedule revision or digest is invalid.');
  }
  if (!ACTIONS.has(action)) fail(400, 'INVALID_APPROVAL_ACTION', 'Schedule approval action is invalid.');

  const idempotencyKey = input.idempotencyKey;
  if (idempotencyKey !== idempotencyKey.trim() || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    fail(400, 'INVALID_IDEMPOTENCY_KEY', 'A bounded canonical Idempotency-Key is required.');
  }

  const status = has(body, 'status') ? String(body.status) : undefined;
  if (status !== undefined && !STATUSES.has(status)) {
    fail(400, 'INVALID_APPOINTMENT_STATUS', 'Appointment status is invalid.');
  }
  const scheduledStart = has(body, 'scheduledStart') ? exactTimestamp(body.scheduledStart, 'scheduledStart') : undefined;
  const scheduledEnd = has(body, 'scheduledEnd') ? exactTimestamp(body.scheduledEnd, 'scheduledEnd') : undefined;
  if (scheduledStart !== undefined && scheduledEnd !== undefined &&
      ((scheduledStart === null) !== (scheduledEnd === null) ||
       (scheduledStart !== null && new Date(scheduledEnd).getTime() <= new Date(scheduledStart).getTime()))) {
    fail(400, 'INVALID_APPOINTMENT_SCHEDULE', 'Appointment schedule must be absent or have a strictly positive interval.');
  }

  const reason = normalizeReason(body.reason, action);
  const normalized = {
    organizationId: String(input.organizationId),
    actorUserId: String(input.actorUserId),
    actorAccessRole: String(input.actorAccessRole),
    authSessionId: String(input.authSessionId),
    appointmentId: String(input.appointmentId),
    explicitSession: input.explicitSession ? String(input.explicitSession) : null,
    expectedRevision,
    expectedDigest,
    action,
    reason,
    scheduledStart,
    scheduledEnd,
    status,
    idempotencyKeyHash: sha256(idempotencyKey),
  };
  normalized.requestDigest = sha256(stableValue({
    organizationId: normalized.organizationId,
    actorUserId: normalized.actorUserId,
    actorAccessRole: normalized.actorAccessRole,
    authSessionId: normalized.authSessionId,
    appointmentId: normalized.appointmentId,
    explicitSession: normalized.explicitSession,
    expectedRevision: normalized.expectedRevision,
    expectedDigest: normalized.expectedDigest,
    action: normalized.action,
    reason: normalized.reason,
    hasScheduledStart: normalized.scheduledStart !== undefined,
    hasScheduledEnd: normalized.scheduledEnd !== undefined,
    hasStatus: normalized.status !== undefined,
    scheduledStart: normalized.scheduledStart === undefined ? null : normalized.scheduledStart,
    scheduledEnd: normalized.scheduledEnd === undefined ? null : normalized.scheduledEnd,
    status: normalized.status === undefined ? null : normalized.status,
  }));
  return Object.freeze(normalized);
}

module.exports = {
  ACTIONS,
  DIGEST,
  STATUSES,
  ScheduleContractError,
  normalizeScheduleMutation,
};
