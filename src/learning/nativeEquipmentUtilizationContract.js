'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const CONSENT_VERSION = 'm25-native-equipment-utilization-consent-v1';
const OBSERVATION_VERSION = 'm25-native-equipment-utilization-observation-v1';

function fail(message) { throw Object.assign(new Error(message), { code: 'M25_NATIVE_EQUIPMENT_INPUT_INVALID', status: 400 }); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function text(value, maximum) {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function revision(value) { return Number.isInteger(value) && value >= 0 && value <= 10000; }
function normalizeConsent(body) {
  if (!exact(body, ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) ||
      !['grant','revoke'].includes(body.action) || !revision(body.expectedRevision) ||
      !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest)) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== CONSENT_VERSION || !text(body.reason, 2000)) fail('Equipment utilization consent details are invalid.');
  return { ...body, confirmationVersion: CONSENT_VERSION };
}
function normalizeObservation(estimateId, body) {
  if (!UUID.test(String(estimateId || '')) ||
      !exact(body, ['expectedConsentRevision','expectedConsentDigest','reason','confirmed','confirmationVersion']) ||
      !revision(body.expectedConsentRevision) || body.expectedConsentRevision < 1 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || body.confirmed !== true ||
      body.confirmationVersion !== OBSERVATION_VERSION || !text(body.reason, 2000)) fail('Equipment utilization outcome details are invalid.');
  return { estimateId: String(estimateId).toLowerCase(), ...body, confirmationVersion: OBSERVATION_VERSION };
}
function normalizeEstimateId(value) {
  if (!UUID.test(String(value || ''))) fail('Estimate identity is invalid.');
  return String(value).toLowerCase();
}
module.exports = { CONSENT_VERSION, OBSERVATION_VERSION, normalizeConsent, normalizeObservation, normalizeEstimateId };
