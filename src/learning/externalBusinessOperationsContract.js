'use strict';

const { normalizeSourceKey } = require('./externalFinancialImportContract');
const DIGEST = /^[0-9a-f]{64}$/;
const CLASSES = new Set(['crm_field_service', 'project_change_order', 'communication', 'financial']);

function fail(message = 'Source operation details are invalid.') {
  throw Object.assign(new Error(message), { code: 'M25_EXTERNAL_BUSINESS_OPERATIONS_INPUT_INVALID', status: 400 });
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function identity(sourceClass, sourceKey) {
  if (!CLASSES.has(sourceClass)) fail();
  return { sourceClass, sourceKey: normalizeSourceKey(sourceKey) };
}
function pair(body) {
  return Number.isInteger(body.expectedRevision) && body.expectedRevision >= 0 && body.expectedRevision <= 10000 &&
    (body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) &&
    ((body.expectedRevision === 0) === (body.expectedDigest === 'none'));
}
function normalizeAdapter(sourceClass, sourceKey, body) {
  if (!exact(body, ['action','adapterKind','cadence','expectedRevision','expectedDigest','confirmed']) ||
      !['connect','pause','resume','disconnect'].includes(body.action) ||
      !['file_import','provider_api'].includes(body.adapterKind) || !['manual','hourly','daily'].includes(body.cadence) ||
      !pair(body) || body.confirmed !== true) fail('Source connection details are invalid.');
  return Object.freeze({ ...identity(sourceClass, sourceKey), body: Object.freeze({ ...body }) });
}
function normalizeRetention(sourceClass, sourceKey, body) {
  if (!exact(body, ['action','retentionDays','expectedRevision','expectedDigest','confirmed']) ||
      !['set','disable'].includes(body.action) || !pair(body) || body.confirmed !== true ||
      !(body.action === 'disable' ? body.retentionDays === null : Number.isInteger(body.retentionDays) && body.retentionDays >= 30 && body.retentionDays <= 3650)) fail('Retention settings are invalid.');
  return Object.freeze({ ...identity(sourceClass, sourceKey), body: Object.freeze({ ...body }) });
}
function normalizeDeletion(sourceClass, sourceKey, body) {
  if (!exact(body, ['action','expectedRevision','expectedDigest','confirmed']) ||
      !['request','cancel'].includes(body.action) || !pair(body) || body.confirmed !== true) fail('Deletion request details are invalid.');
  return Object.freeze({ ...identity(sourceClass, sourceKey), body: Object.freeze({ ...body }) });
}
function normalizeHold(sourceClass, sourceKey, body) {
  if (!exact(body, ['action','holdKind','expectedRevision','expectedDigest','confirmed']) ||
      !['place','release'].includes(body.action) || !['legal','audit'].includes(body.holdKind) ||
      !pair(body) || body.confirmed !== true) fail('Hold details are invalid.');
  return Object.freeze({ ...identity(sourceClass, sourceKey), body: Object.freeze({ ...body }) });
}
function normalizeCleanup(sourceClass, sourceKey, body) {
  if (!exact(body, ['operation','expectedRevision','expectedDigest','cursorBefore','limit','confirmed']) ||
      !['retention','deletion'].includes(body.operation) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 1 || body.expectedRevision > 10000 || !DIGEST.test(String(body.expectedDigest || '')) ||
      !(body.cursorBefore === null || typeof body.cursorBefore === 'string' && /^[\x21-\x7e]{1,128}$/.test(body.cursorBefore)) ||
      !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100 || body.confirmed !== true) fail('Cleanup details are invalid.');
  return Object.freeze({ ...identity(sourceClass, sourceKey), body: Object.freeze({ ...body }) });
}

module.exports = { identity, normalizeAdapter, normalizeRetention, normalizeDeletion, normalizeHold, normalizeCleanup };
