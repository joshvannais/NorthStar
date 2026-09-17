'use strict';

const SOURCE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PRINTABLE = /^[\x21-\x7e]{1,128}$/;
const TOKEN = /^ref_[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLASSES = Object.freeze({
  crm_field_service: new Set(['customer', 'job', 'estimate']),
  project_change_order: new Set(['customer', 'job', 'estimate', 'project', 'change_order']),
  communication: new Set(['customer', 'job', 'estimate', 'project']),
  financial: new Set(['customer', 'job', 'estimate', 'execution', 'project', 'change_order', 'invoice', 'payment', 'collection', 'accounting_entry']),
});
const TARGETS = Object.freeze({ customer: 'customer', execution: 'execution', job: 'estimate', estimate: 'estimate', project: 'estimate', change_order: 'estimate', invoice: 'estimate', payment: 'estimate', collection: 'estimate', accounting_entry: 'estimate' });
const KEYS = ['action','referenceKind','externalReference','targetKind','targetId','expectedRevision','expectedDigest','expectedSourceDigest','expectedTargetDigest','reason','confirmed','confirmationVersion'];

function fail() { throw Object.assign(new Error('External business reference match details are invalid.'), { code: 'M25_BUSINESS_MATCH_INPUT_INVALID', status: 400 }); }
function exact(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...KEYS].sort().join('|'); }
function text(value, maximum) { return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') && value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
function normalizeSourceClass(value) { if (typeof value !== 'string' || !CLASSES[value]) fail(); return value; }
function normalizeSourceKey(value) { if (typeof value !== 'string' || value !== value.toLowerCase() || !SOURCE.test(value)) fail(); return value; }
function normalizeMatch(sourceClassValue, sourceKeyValue, body) {
  const sourceClass = normalizeSourceClass(sourceClassValue), sourceKey = normalizeSourceKey(sourceKeyValue);
  if (!exact(body) || !['link','unlink'].includes(body.action) || !CLASSES[sourceClass].has(body.referenceKind) ||
      !PRINTABLE.test(String(body.externalReference || '')) || (['communication','financial'].includes(sourceClass) && !TOKEN.test(body.externalReference)) ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) || ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
      !(body.expectedSourceDigest === 'unavailable' || DIGEST.test(String(body.expectedSourceDigest || ''))) ||
      !(body.expectedTargetDigest === 'unavailable' || DIGEST.test(String(body.expectedTargetDigest || ''))) ||
      !text(body.reason, 2000) || body.confirmed !== true || body.confirmationVersion !== 'm25-external-business-reference-match-v1') fail();
  if (body.action === 'link') {
    if (body.targetKind !== TARGETS[body.referenceKind] || typeof body.targetId !== 'string' || !UUID.test(body.targetId) || body.expectedSourceDigest === 'unavailable' || body.expectedTargetDigest === 'unavailable') fail();
  } else if (body.targetKind !== null || body.targetId !== null || body.expectedTargetDigest !== 'unavailable') fail();
  return Object.freeze({ sourceClass, sourceKey, ...body });
}

module.exports = { CLASSES, TARGETS, normalizeMatch, normalizeSourceClass, normalizeSourceKey };
