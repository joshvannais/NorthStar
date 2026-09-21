'use strict';

const { normalizeSourceKey } = require('./externalFinancialImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const SERVICE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const KINDS = new Set(['customer', 'project', 'financial']);
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const PROPOSAL_KEYS = ['expectedConsentRevision','expectedConsentDigest','reason','confirmed','confirmationVersion'];

function fail() {
  throw Object.assign(new Error('Business calibration details are invalid.'), {
    code: 'M25_EXTERNAL_BUSINESS_CALIBRATION_INPUT_INVALID', status: 400,
  });
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function text(value) {
  return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
    value.length >= 1 && value.length <= 2000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function normalizeIdentity(kind, sourceKey, secondarySourceKey) {
  if (!KINDS.has(kind)) fail();
  const source = normalizeSourceKey(sourceKey);
  if (kind === 'customer') {
    if (typeof secondarySourceKey !== 'string') fail();
    return Object.freeze({ kind, sourceKey: source, secondarySourceKey: normalizeSourceKey(secondarySourceKey) });
  }
  if (secondarySourceKey !== undefined && secondarySourceKey !== null && secondarySourceKey !== '') fail();
  return Object.freeze({ kind, sourceKey: source, secondarySourceKey: null });
}
function normalizeServiceKey(value) { if (typeof value !== 'string' || !SERVICE.test(value)) fail(); return value; }
function normalizeConsent(kind, sourceKey, secondarySourceKey, body) {
  const identity = normalizeIdentity(kind, sourceKey, secondarySourceKey);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !text(body.reason) ||
      body.confirmed !== true || body.confirmationVersion !== 'm25-external-business-calibration-consent-v1') fail();
  return Object.freeze({ ...identity, body: Object.freeze({ ...body }) });
}
function normalizeProposal(kind, sourceKey, secondarySourceKey, serviceKey, body) {
  const identity = normalizeIdentity(kind, sourceKey, secondarySourceKey);
  const service = normalizeServiceKey(serviceKey);
  if (!exact(body, PROPOSAL_KEYS) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || !text(body.reason) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-business-calibration-proposal-v1') fail();
  return Object.freeze({ ...identity, serviceKey: service, ...body });
}
function normalizeRead(kind, sourceKey, secondarySourceKey, serviceKey) {
  return Object.freeze({ ...normalizeIdentity(kind, sourceKey, secondarySourceKey),
    ...(serviceKey === undefined ? {} : { serviceKey: normalizeServiceKey(serviceKey) }) });
}

module.exports = { normalizeConsent, normalizeIdentity, normalizeProposal, normalizeRead, normalizeServiceKey };
