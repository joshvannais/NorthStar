'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const ITEM_KEY = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const CONSENT_VERSION = 'm25-native-material-outcome-consent-v1';
const OBSERVATION_VERSION = 'm25-native-material-outcome-observation-v1';

function fail(message) {
  throw Object.assign(new Error(message), { code: 'M25_NATIVE_MATERIAL_INPUT_INVALID', status: 400 });
}
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
function id(value, label) {
  if (!UUID.test(String(value || ''))) fail(`${label} is invalid.`);
  return String(value).toLowerCase();
}
function bindings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail('Material line bindings are invalid.');
  const lineIds = new Set(), itemKeys = new Set();
  const normalized = value.map(binding => {
    if (!exact(binding, ['lineId', 'itemKey']) || !UUID.test(String(binding.lineId || '')) ||
        !ITEM_KEY.test(String(binding.itemKey || ''))) fail('Each material line needs one exact recorded item reference.');
    const lineId = String(binding.lineId).toLowerCase(), itemKey = String(binding.itemKey);
    if (lineIds.has(lineId) || itemKeys.has(itemKey)) fail('Material line and item references must be unique.');
    lineIds.add(lineId); itemKeys.add(itemKey);
    return { lineId, itemKey };
  });
  return normalized.sort((a, b) => a.lineId.localeCompare(b.lineId));
}
function normalizeConsent(body) {
  if (!exact(body, ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) ||
      !['grant','revoke'].includes(body.action) || !revision(body.expectedRevision) ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== CONSENT_VERSION || !text(body.reason, 2000)) fail('Material outcome consent details are invalid.');
  return { ...body, confirmationVersion: CONSENT_VERSION };
}
function normalizeObservation(estimateId, executionId, body) {
  const estimate = id(estimateId, 'Estimate identity'), execution = id(executionId, 'Job identity');
  if (!exact(body, ['expectedConsentRevision','expectedConsentDigest','bindings','reason','confirmed','confirmationVersion']) ||
      !revision(body.expectedConsentRevision) || body.expectedConsentRevision < 1 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || body.confirmed !== true ||
      body.confirmationVersion !== OBSERVATION_VERSION || !text(body.reason, 2000)) fail('Material outcome details are invalid.');
  return { estimateId: estimate, executionId: execution, ...body, bindings: bindings(body.bindings), confirmationVersion: OBSERVATION_VERSION };
}
function normalizeIds(estimateId, executionId) {
  return { estimateId: id(estimateId, 'Estimate identity'), executionId: id(executionId, 'Job identity') };
}

module.exports = { CONSENT_VERSION, OBSERVATION_VERSION, normalizeConsent, normalizeObservation, normalizeIds, normalizeBindings: bindings };
