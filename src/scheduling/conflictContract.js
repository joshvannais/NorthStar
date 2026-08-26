'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const schedulingTime = require('../../public/js/scheduling-time-contract');

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_KINDS = new Set(['unassigned', 'profile', 'crew']);
const INTERVAL_KINDS = new Set(['available', 'unavailable']);
const MAXIMUM_BODY_BYTES = 256 * 1024;
const MAXIMUM_INTERVALS = 512;
const MAXIMUM_WINDOW_MILLISECONDS = 366 * 86400000;
const MAXIMUM_APPOINTMENT_MILLISECONDS = 31 * 86400000;

class ConflictContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ConflictContractError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ConflictContractError(status, code, message);
}

function has(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.has(key))) {
    fail(400, code, 'Scheduling conflict request is invalid.');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > MAXIMUM_BODY_BYTES) fail(400, code, 'Scheduling conflict request is too large.');
  return value;
}

function uuid(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || !UUID.test(value)) {
    fail(400, code, label + ' is invalid.');
  }
  return value.toLowerCase();
}

function expectedPins(body, code) {
  const revision = body.expectedRevision;
  const digest = body.expectedDigest;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 ||
      (revision === 0 ? digest !== null : typeof digest !== 'string' || !DIGEST.test(digest))) {
    fail(400, code, 'The expected revision or digest is invalid.');
  }
  return { expectedRevision: revision, expectedDigest: digest };
}

function timeZone(value, code) {
  if (!schedulingTime.isValidTimeZone(value)) {
    fail(400, code, 'A current authoritative tenant IANA time zone is required.');
  }
  return value;
}

function exactInstant(value, zone, code, label) {
  try {
    return schedulingTime.validateRfc3339InZone(value, zone);
  } catch (_error) {
    fail(400, code, label + ' must be an exact RFC3339 timestamp that agrees with the tenant time zone.');
  }
}

function boundedReason(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value ||
      Array.from(value).length > 1000 || Buffer.byteLength(value, 'utf8') > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(400, 'INVALID_AVAILABILITY_REASON', 'Availability reason is invalid.');
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

function normalizeAvailabilityMutation(input) {
  const body = exactObject(input && input.body, new Set([
    'expectedRevision', 'expectedDigest', 'expectedTimeZone',
    'coverageStart', 'coverageEnd', 'intervals', 'reason',
  ]), 'INVALID_AVAILABILITY_WRITE');
  if (!has(body, 'expectedRevision') || !has(body, 'expectedDigest') ||
      !has(body, 'expectedTimeZone') || !has(body, 'coverageStart') ||
      !has(body, 'coverageEnd') || !has(body, 'intervals') || !has(body, 'reason')) {
    fail(428, 'M22_AVAILABILITY_PRECONDITION_REQUIRED', 'Exact availability revision, digest, time zone, interval, reason, and idempotency evidence is required.');
  }
  const pins = expectedPins(body, 'INVALID_AVAILABILITY_PRECONDITION');
  const zone = timeZone(body.expectedTimeZone, 'INVALID_AVAILABILITY_TIME_ZONE');
  const coverageStart = exactInstant(body.coverageStart, zone, 'INVALID_AVAILABILITY_INTERVAL', 'Coverage start');
  const coverageEnd = exactInstant(body.coverageEnd, zone, 'INVALID_AVAILABILITY_INTERVAL', 'Coverage end');
  if (coverageEnd.epochMilliseconds <= coverageStart.epochMilliseconds ||
      coverageEnd.epochMilliseconds - coverageStart.epochMilliseconds > MAXIMUM_WINDOW_MILLISECONDS) {
    fail(400, 'INVALID_AVAILABILITY_INTERVAL', 'Availability coverage must be positive and at most 366 days.');
  }
  if (!Array.isArray(body.intervals) || body.intervals.length > MAXIMUM_INTERVALS) {
    fail(400, 'INVALID_AVAILABILITY_INTERVAL', 'Availability intervals are invalid or exceed the bounded limit.');
  }
  const intervals = body.intervals.map(function (raw, index) {
    exactObject(raw, new Set(['kind', 'start', 'end']), 'INVALID_AVAILABILITY_INTERVAL');
    if (!INTERVAL_KINDS.has(raw.kind)) {
      fail(400, 'INVALID_AVAILABILITY_INTERVAL', 'Availability interval kind is invalid.');
    }
    const start = exactInstant(raw.start, zone, 'INVALID_AVAILABILITY_INTERVAL', 'Availability interval start');
    const end = exactInstant(raw.end, zone, 'INVALID_AVAILABILITY_INTERVAL', 'Availability interval end');
    if (end.epochMilliseconds <= start.epochMilliseconds ||
        end.epochMilliseconds - start.epochMilliseconds > MAXIMUM_APPOINTMENT_MILLISECONDS ||
        start.epochMilliseconds < coverageStart.epochMilliseconds ||
        end.epochMilliseconds > coverageEnd.epochMilliseconds) {
      fail(400, 'INVALID_AVAILABILITY_INTERVAL', 'Availability intervals must be positive, bounded, and inside coverage.');
    }
    return Object.freeze({
      ordinal: index,
      kind: raw.kind,
      rawStart: raw.start,
      rawEnd: raw.end,
      start: start.instant,
      end: end.instant,
      startMilliseconds: start.epochMilliseconds,
      endMilliseconds: end.epochMilliseconds,
    });
  });
  intervals.sort(function (left, right) {
    return left.startMilliseconds - right.startMilliseconds || left.endMilliseconds - right.endMilliseconds ||
      left.kind.localeCompare(right.kind) || left.ordinal - right.ordinal;
  });
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (previous.kind === current.kind && previous.start === current.start && previous.end === current.end) {
      fail(400, 'INVALID_AVAILABILITY_INTERVAL', 'Availability intervals contain a duplicate.');
    }
  }
  const canonicalIntervals = intervals.map(function (interval, ordinal) {
    return Object.freeze({ ordinal, kind: interval.kind, start: interval.start, end: interval.end });
  });
  const submittedIntervals = intervals.map(function (interval, ordinal) {
    return Object.freeze({ ordinal, kind: interval.kind, start: interval.rawStart, end: interval.rawEnd });
  });
  const key = idempotencyKey(input && input.idempotencyKey);
  const profileId = uuid(input && input.profileId, 'INVALID_AVAILABILITY_PROFILE', 'Workforce profile');
  const canonical = Object.freeze({
    profileId,
    coverageStart: coverageStart.instant,
    coverageEnd: coverageEnd.instant,
    intervals: canonicalIntervals,
  });
  const requestEvidence = Object.freeze({
    expectedRevision: pins.expectedRevision,
    expectedDigest: pins.expectedDigest,
    expectedTimeZone: zone,
    profileId,
    coverageStart: body.coverageStart,
    coverageEnd: body.coverageEnd,
    intervals: submittedIntervals,
    reason: boundedReason(body.reason),
  });
  return Object.freeze({
    ...pins,
    profileId,
    expectedTimeZone: zone,
    coverageStart: canonical.coverageStart,
    coverageEnd: canonical.coverageEnd,
    intervals: canonicalIntervals,
    submittedIntervals,
    submittedCoverage: Object.freeze({ start: body.coverageStart, end: body.coverageEnd }),
    reason: requestEvidence.reason,
    idempotencyKey: key,
    idempotencyKeyHash: sha256(key),
    requestDigest: sha256(requestEvidence),
    canonical,
  });
}

function normalizeConflictEvaluation(input) {
  const body = exactObject(input && input.body, new Set([
    'expectedRevision', 'expectedDigest', 'expectedTimeZone', 'target',
    'scheduledStart', 'scheduledEnd',
  ]), 'INVALID_CONFLICT_EVALUATION');
  if (!has(body, 'expectedRevision') || !has(body, 'expectedDigest') ||
      !has(body, 'expectedTimeZone') || !has(body, 'target') ||
      !has(body, 'scheduledStart') || !has(body, 'scheduledEnd')) {
    fail(428, 'M22_EVALUATION_PRECONDITION_REQUIRED', 'Exact assignment, target, schedule, and time-zone pins are required.');
  }
  const pins = expectedPins(body, 'INVALID_EVALUATION_PRECONDITION');
  if (pins.expectedRevision < 1) fail(400, 'INVALID_EVALUATION_PRECONDITION', 'The assignment revision is invalid.');
  const zone = timeZone(body.expectedTimeZone, 'INVALID_EVALUATION_TIME_ZONE');
  const target = exactObject(body.target, new Set(['kind', 'id']), 'INVALID_EVALUATION_TARGET');
  if (!TARGET_KINDS.has(target.kind) ||
      (target.kind === 'unassigned' ? target.id !== null : typeof target.id !== 'string')) {
    fail(400, 'INVALID_EVALUATION_TARGET', 'The proposed target is invalid.');
  }
  const targetId = target.kind === 'unassigned' ? null
    : uuid(target.id, 'INVALID_EVALUATION_TARGET', 'Proposed target');
  const start = exactInstant(body.scheduledStart, zone, 'INVALID_EVALUATION_INTERVAL', 'Scheduled start');
  const end = exactInstant(body.scheduledEnd, zone, 'INVALID_EVALUATION_INTERVAL', 'Scheduled end');
  if (end.epochMilliseconds <= start.epochMilliseconds ||
      end.epochMilliseconds - start.epochMilliseconds > MAXIMUM_APPOINTMENT_MILLISECONDS) {
    fail(400, 'INVALID_EVALUATION_INTERVAL', 'The proposed schedule must be positive and at most 31 days.');
  }
  const proposal = stableValue({
    target: { kind: target.kind, id: targetId },
    scheduledStart: start.instant,
    scheduledEnd: end.instant,
    submittedScheduledStart: body.scheduledStart,
    submittedScheduledEnd: body.scheduledEnd,
    timeZone: zone,
  });
  return Object.freeze({
    ...pins,
    appointmentId: uuid(input && input.appointmentId, 'INVALID_EVALUATION_APPOINTMENT', 'Appointment'),
    expectedTimeZone: zone,
    proposal: Object.freeze(proposal),
    requestDigest: sha256({ ...pins, proposal }),
  });
}

module.exports = {
  ConflictContractError,
  MAXIMUM_INTERVALS,
  normalizeAvailabilityMutation,
  normalizeConflictEvaluation,
};
