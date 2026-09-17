'use strict';
const { normalizeSourceKey } = require('./externalAssetImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const OPAQUE = /^[\x21-\x7e]{1,128}$/;
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const OBSERVATION_KEYS = ['assetCategory','externalAssetReference','expectedConsentRevision','expectedConsentDigest','reason','confirmed','confirmationVersion'];
function fail(message) { const error = new Error(message); error.code = 'M25_IMPORTED_ASSET_HEALTH_INPUT_INVALID'; error.status = 400; throw error; }
function exact(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }
function text(value) { return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') && value.length >= 1 && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function normalizeAsset(sourceKey, assetCategory, externalAssetReference) {
  const source = normalizeSourceKey(sourceKey);
  if (!['vehicle','equipment'].includes(assetCategory) || !OPAQUE.test(String(externalAssetReference || ''))) fail('Imported asset health identity is invalid.');
  return Object.freeze({ sourceKey: source, assetCategory, externalAssetReference });
}
function normalizeConsent(sourceKey, body) {
  const source = normalizeSourceKey(sourceKey);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) || ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !text(body.reason) || body.confirmed !== true || body.confirmationVersion !== 'm25-imported-asset-health-consent-v1') fail('Imported asset health consent details are invalid.');
  return Object.freeze({ sourceKey: source, ...body });
}
function normalizeObservation(sourceKey, body) {
  if (!exact(body, OBSERVATION_KEYS) || !['vehicle','equipment'].includes(body.assetCategory) || !OPAQUE.test(String(body.externalAssetReference || '')) || !Number.isInteger(body.expectedConsentRevision) || body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) || !text(body.reason) || body.confirmed !== true || body.confirmationVersion !== 'm25-imported-asset-health-observation-v1') fail('Imported asset health outcome details are invalid.');
  return Object.freeze({ ...normalizeAsset(sourceKey, body.assetCategory, body.externalAssetReference), ...body });
}
module.exports = { normalizeAsset, normalizeConsent, normalizeObservation };
