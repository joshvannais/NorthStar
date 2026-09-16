'use strict';

const { normalizeSourceKey } = require('./externalLaborImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const OPAQUE = /^[\x21-\x7e]{1,128}$/;
const KEYS = ['referenceKind', 'externalReference', 'action', 'targetId', 'expectedRevision', 'expectedDigest',
  'expectedSourceDigest', 'expectedTargetDigest', 'reason', 'confirmed', 'confirmationVersion'];

function fail() { const error = new Error('External labor reference match details are invalid.');
  error.code = 'M25_MATCH_INPUT_INVALID'; error.status = 400; throw error; }
function exact(value) { return value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...KEYS].sort().join('|'); }
function validText(value) { return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
  value.length >= 1 && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

function normalizeMatch(sourceKey, body) {
  const source = normalizeSourceKey(sourceKey);
  if (!exact(body) || !['worker', 'job'].includes(body.referenceKind) || !OPAQUE.test(String(body.externalReference || '')) ||
      !['link', 'unlink'].includes(body.action) || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
      !(body.expectedSourceDigest === 'unavailable' || DIGEST.test(String(body.expectedSourceDigest || ''))) ||
      !(body.expectedTargetDigest === 'unavailable' || DIGEST.test(String(body.expectedTargetDigest || ''))) ||
      !validText(body.reason) || body.confirmed !== true || body.confirmationVersion !== 'm25-external-labor-reference-match-v1' ||
      (body.action === 'link' ? (!uuid(body.targetId) || !DIGEST.test(body.expectedSourceDigest) || !DIGEST.test(body.expectedTargetDigest))
        : (body.targetId !== null || body.expectedTargetDigest !== 'unavailable'))) fail();
  return Object.freeze({ sourceKey: source, ...body });
}

module.exports = { normalizeMatch };
