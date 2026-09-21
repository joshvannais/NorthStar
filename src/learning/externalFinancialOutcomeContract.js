'use strict';

const { normalizeSourceKey } = require('./externalFinancialImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const OBSERVATION_KEYS = ['estimateId','expectedConsentRevision','expectedConsentDigest','reason','confirmed','confirmationVersion'];

function fail() {
  throw Object.assign(new Error('Financial outcome details are invalid.'), { code: 'M25_EXTERNAL_FINANCIAL_OUTCOME_INPUT_INVALID', status: 400 });
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function text(value) {
  return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
    value.length >= 1 && value.length <= 2000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function normalizeSource(sourceKey) { return Object.freeze({ sourceKey: normalizeSourceKey(sourceKey) }); }
function normalizeConsent(sourceKey, body) {
  const source = normalizeSourceKey(sourceKey);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !text(body.reason) ||
      body.confirmed !== true || body.confirmationVersion !== 'm25-external-financial-outcome-consent-v1') fail();
  return Object.freeze({ sourceKey: source, ...body });
}
function normalizeObservation(sourceKey, body) {
  const source = normalizeSourceKey(sourceKey);
  if (!exact(body, OBSERVATION_KEYS) || !UUID.test(String(body.estimateId || '')) ||
      !Number.isInteger(body.expectedConsentRevision) || body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || !text(body.reason) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-financial-outcome-observation-v1') fail();
  return Object.freeze({ sourceKey: source, ...body });
}
function normalizeRead(sourceKey, estimateId) {
  const source = normalizeSourceKey(sourceKey);
  if (!UUID.test(String(estimateId || ''))) fail();
  return Object.freeze({ sourceKey: source, estimateId });
}

module.exports = { normalizeConsent, normalizeObservation, normalizeRead, normalizeSource };
