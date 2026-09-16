'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const ACTION_KEYS = ['action', 'expectedRevision', 'expectedDigest', 'reason', 'confirmed', 'confirmationVersion'];
const OBSERVATION_KEYS = ['expectedConsentRevision', 'expectedConsentDigest', 'reason', 'confirmed', 'confirmationVersion'];

function fail(message) {
  const error = new Error(message);
  error.code = 'M25_LEARNING_INPUT_INVALID';
  error.status = 400;
  throw error;
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function text(value, maximum) {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function revision(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10000;
}

function normalizeConsent(body) {
  if (!exactObject(body, ACTION_KEYS) || !['grant', 'revoke'].includes(body.action) ||
      !revision(body.expectedRevision) || !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest)) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
      body.confirmed !== true || body.confirmationVersion !== 'm25-labor-duration-consent-v1' ||
      !text(body.reason, 2000)) fail('Learning consent details are invalid.');
  return {
    action: body.action,
    expectedRevision: body.expectedRevision,
    expectedDigest: body.expectedDigest,
    reason: body.reason,
    confirmed: true,
    confirmationVersion: 'm25-labor-duration-consent-v1',
  };
}

function normalizeObservation(estimateId, body) {
  if (!UUID.test(String(estimateId || '')) || !exactObject(body, OBSERVATION_KEYS) ||
      !revision(body.expectedConsentRevision) || body.expectedConsentRevision < 1 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-labor-duration-observation-v1' || !text(body.reason, 2000)) {
    fail('Labor outcome review details are invalid.');
  }
  return {
    estimateId: String(estimateId).toLowerCase(),
    expectedConsentRevision: body.expectedConsentRevision,
    expectedConsentDigest: body.expectedConsentDigest,
    reason: body.reason,
    confirmed: true,
    confirmationVersion: 'm25-labor-duration-observation-v1',
  };
}

function normalizeEstimateId(value) {
  if (!UUID.test(String(value || ''))) fail('Estimate identity is invalid.');
  return String(value).toLowerCase();
}

module.exports = { normalizeConsent, normalizeObservation, normalizeEstimateId };
