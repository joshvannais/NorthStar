'use strict';

const { normalizeSourceKey } = require('./externalCrmFieldServiceImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const PRINTABLE = /^[\x21-\x7e]{1,128}$/;
const TOKEN = /^ref_[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const OBSERVATION_KEYS = ['estimateId','crmEstimateReference','communicationEstimateReference','expectedConsentRevision','expectedConsentDigest','reason','confirmed','confirmationVersion'];

function fail(message = 'Customer outcome details are invalid.') {
  throw Object.assign(new Error(message), { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_INPUT_INVALID', status: 400 });
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function text(value) {
  return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
    value.length >= 1 && value.length <= 2000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function normalizeSources(crmSourceKey, communicationSourceKey) {
  return Object.freeze({
    crmSourceKey: normalizeSourceKey(crmSourceKey),
    communicationSourceKey: normalizeSourceKey(communicationSourceKey),
  });
}
function normalizeConsent(crmSourceKey, communicationSourceKey, body) {
  const sources = normalizeSources(crmSourceKey, communicationSourceKey);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !text(body.reason) ||
      body.confirmed !== true || body.confirmationVersion !== 'm25-external-customer-outcome-consent-v1') fail();
  return Object.freeze({ ...sources, ...body });
}
function normalizeObservation(crmSourceKey, communicationSourceKey, body) {
  const sources = normalizeSources(crmSourceKey, communicationSourceKey);
  if (!exact(body, OBSERVATION_KEYS) || !UUID.test(String(body.estimateId || '')) ||
      !PRINTABLE.test(String(body.crmEstimateReference || '')) ||
      !TOKEN.test(String(body.communicationEstimateReference || '')) ||
      !Number.isInteger(body.expectedConsentRevision) || body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || !text(body.reason) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-customer-outcome-observation-v1') fail();
  return Object.freeze({ ...sources, ...body });
}
function normalizeRead(crmSourceKey, communicationSourceKey, estimateId, crmEstimateReference, communicationEstimateReference) {
  const sources = normalizeSources(crmSourceKey, communicationSourceKey);
  if (!UUID.test(String(estimateId || '')) || !PRINTABLE.test(String(crmEstimateReference || '')) ||
      !TOKEN.test(String(communicationEstimateReference || ''))) fail();
  return Object.freeze({ ...sources, estimateId, crmEstimateReference, communicationEstimateReference });
}

module.exports = { normalizeConsent, normalizeObservation, normalizeRead, normalizeSources };
