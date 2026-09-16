'use strict';
const { normalizeSourceKey } = require('./externalTravelImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const OPAQUE = /^[\x21-\x7e]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = ['action', 'referenceKind', 'externalReference', 'targetId', 'expectedRevision', 'expectedDigest',
  'expectedSourceDigest', 'expectedTargetDigest', 'reason', 'confirmed', 'confirmationVersion'];
function fail() { const error = new Error('External travel reference match details are invalid.'); error.code = 'M25_TRAVEL_MATCH_INPUT_INVALID'; error.status = 400; throw error; }
function exact(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...KEYS].sort().join('|'); }
function text(value, max) { return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function normalizeMatch(source, body) {
  const sourceKey = normalizeSourceKey(source);
  if (!exact(body) || !['link', 'unlink'].includes(body.action) || !['job', 'vehicle'].includes(body.referenceKind) ||
      !OPAQUE.test(String(body.externalReference || '')) || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) || ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
      !(body.expectedSourceDigest === 'unavailable' || DIGEST.test(String(body.expectedSourceDigest || ''))) ||
      !(body.expectedTargetDigest === 'unavailable' || DIGEST.test(String(body.expectedTargetDigest || ''))) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-travel-reference-match-v1' || !text(body.reason, 2000)) fail();
  if (body.action === 'link') { if (!UUID.test(String(body.targetId || '')) || body.expectedSourceDigest === 'unavailable' || body.expectedTargetDigest === 'unavailable') fail(); }
  else if (body.targetId !== null || body.expectedTargetDigest !== 'unavailable') fail();
  return Object.freeze({ sourceKey, ...body, targetId: body.targetId && body.targetId.toLowerCase() });
}
module.exports = { normalizeMatch };
