'use strict';

const { normalizeSourceKey } = require('./externalAssetImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const SERVICE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const CONSENT_KEYS = ['action', 'expectedRevision', 'expectedDigest', 'reason', 'confirmed', 'confirmationVersion'];
const PROPOSAL_KEYS = ['expectedConsentRevision', 'expectedConsentDigest', 'reason', 'confirmed', 'confirmationVersion'];

function fail() {
  const error = new Error('Vehicle and equipment calibration details are invalid.');
  error.code = 'M25_IMPORTED_ASSET_CALIBRATION_INPUT_INVALID';
  error.status = 400;
  throw error;
}

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
    value.length >= 1 && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function normalizeServiceKey(value) {
  if (typeof value !== 'string' || !SERVICE.test(value)) fail();
  return value;
}

function normalizeConsent(sourceKey, body) {
  const source = normalizeSourceKey(sourceKey);
  if (!exact(body, CONSENT_KEYS) || !['grant', 'revoke'].includes(body.action) ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !text(body.reason) ||
      body.confirmed !== true || body.confirmationVersion !== 'm25-imported-asset-calibration-consent-v1') fail();
  return Object.freeze({ sourceKey: source, ...body });
}

function normalizeProposal(sourceKey, serviceKey, body) {
  const source = normalizeSourceKey(sourceKey);
  const service = normalizeServiceKey(serviceKey);
  if (!exact(body, PROPOSAL_KEYS) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || !text(body.reason) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-imported-asset-calibration-proposal-v1') fail();
  return Object.freeze({ sourceKey: source, serviceKey: service, ...body });
}

module.exports = { normalizeServiceKey, normalizeConsent, normalizeProposal };
