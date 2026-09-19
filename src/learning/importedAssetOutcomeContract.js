'use strict';
const { normalizeSourceKey } = require('./externalAssetImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE = /^[\x21-\x7e]{1,128}$/;
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const OBSERVATION_KEYS = ['externalJobReference','expectedConsentRevision','expectedConsentDigest','reason','confirmed','confirmationVersion'];
function fail(message) { const error = new Error(message); error.code = 'M25_IMPORTED_ASSET_OUTCOME_INPUT_INVALID'; error.status = 400; throw error; }
function exact(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }
function text(value) { return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') && value.length >= 1 && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function normalizeEstimateId(value) { if (!UUID.test(String(value || ''))) fail('Estimate identity is invalid.'); return value.toLowerCase(); }
function normalizeConsent(sourceKey, body) {
  const source = normalizeSourceKey(sourceKey);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) || ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !text(body.reason) || body.confirmed !== true || body.confirmationVersion !== 'm25-imported-asset-utilization-cost-consent-v1') fail('Imported vehicle and equipment learning consent details are invalid.');
  return Object.freeze({ sourceKey: source, ...body });
}
function normalizeObservation(sourceKey, estimateId, body) {
  const source = normalizeSourceKey(sourceKey), estimate = normalizeEstimateId(estimateId);
  if (!exact(body, OBSERVATION_KEYS) || !OPAQUE.test(String(body.externalJobReference || '')) || !Number.isInteger(body.expectedConsentRevision) || body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) || !text(body.reason) || body.confirmed !== true || body.confirmationVersion !== 'm25-imported-asset-utilization-cost-observation-v1') fail('Imported vehicle and equipment outcome details are invalid.');
  return Object.freeze({ sourceKey: source, estimateId: estimate, ...body });
}
module.exports = { normalizeEstimateId, normalizeConsent, normalizeObservation };
