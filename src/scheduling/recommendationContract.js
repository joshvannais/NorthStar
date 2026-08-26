'use strict';

const schedulingTime = require('../../public/js/scheduling-time-contract');

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_BODY_BYTES = 64 * 1024;

class RecommendationContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'RecommendationContractError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new RecommendationContractError(status, code, message);
}

function has(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeRecommendationEvaluation(input) {
  const appointmentId = input && input.appointmentId;
  if (typeof appointmentId !== 'string' || !UUID.test(appointmentId)) {
    fail(404, 'NOT_FOUND', 'Appointment not found.');
  }
  const body = input && input.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['expectedRevision', 'expectedDigest', 'expectedTimeZone'].includes(key))) {
    fail(400, 'INVALID_RECOMMENDATION_REQUEST', 'Recommendation request is invalid.');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(body), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > MAXIMUM_BODY_BYTES) {
    fail(400, 'INVALID_RECOMMENDATION_REQUEST', 'Recommendation request is too large.');
  }
  if (!has(body, 'expectedRevision') || !has(body, 'expectedDigest') || !has(body, 'expectedTimeZone')) {
    fail(428, 'M22_RECOMMENDATION_PRECONDITION_REQUIRED',
      'Exact assignment revision, digest, and tenant time-zone pins are required.');
  }
  if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 1 || typeof body.expectedDigest !== 'string' ||
      body.expectedDigest !== body.expectedDigest.trim() || !DIGEST.test(body.expectedDigest)) {
    fail(400, 'INVALID_RECOMMENDATION_PRECONDITION', 'Recommendation authority pins are invalid.');
  }
  if (typeof body.expectedTimeZone !== 'string' ||
      !schedulingTime.isValidTimeZone(body.expectedTimeZone)) {
    fail(400, 'INVALID_RECOMMENDATION_TIME_ZONE',
      'A current authoritative tenant IANA time zone is required.');
  }
  return Object.freeze({
    appointmentId: appointmentId.toLowerCase(),
    expectedRevision: body.expectedRevision,
    expectedDigest: body.expectedDigest,
    expectedTimeZone: body.expectedTimeZone,
  });
}

module.exports = {
  DIGEST,
  MAXIMUM_BODY_BYTES,
  RecommendationContractError,
  normalizeRecommendationEvaluation,
};
