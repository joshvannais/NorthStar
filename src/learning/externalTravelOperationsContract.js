'use strict';

const importContract = require('./externalTravelImportContract');
const DIGEST = /^[0-9a-f]{64}$/;

function fail(message) {
  const error = new Error(message);
  error.code = 'M25_TRAVEL_IMPORT_OPERATIONS_INPUT_INVALID';
  error.status = 400;
  throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function pair(body) {
  return Number.isInteger(body.expectedRevision) && body.expectedRevision >= 0 && body.expectedRevision <= 10000 &&
    (body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) &&
    ((body.expectedRevision === 0) === (body.expectedDigest === 'none'));
}

function normalizeAdapter(sourceKey, body) {
  const keys = ['action', 'adapterKind', 'cadence', 'expectedRevision', 'expectedDigest', 'confirmed'];
  if (!exact(body, keys) || !['connect', 'pause', 'resume', 'disconnect'].includes(body.action) || !pair(body) ||
      body.confirmed !== true || !['csv', 'provider_api'].includes(body.adapterKind) ||
      !['manual', 'hourly', 'daily'].includes(body.cadence)) {
    fail('Adapter lifecycle details are invalid.');
  }
  return Object.freeze({ sourceKey: importContract.normalizeSourceKey(sourceKey), ...body });
}

function normalizeRetention(sourceKey, body) {
  const keys = ['action', 'retentionDays', 'expectedRevision', 'expectedDigest', 'confirmed'];
  if (!exact(body, keys) || !['set', 'disable'].includes(body.action) || !pair(body) || body.confirmed !== true ||
      !(body.action === 'disable' ? body.retentionDays === null : Number.isInteger(body.retentionDays) && body.retentionDays >= 30 && body.retentionDays <= 3650)) {
    fail('Retention policy details are invalid.');
  }
  return Object.freeze({ sourceKey: importContract.normalizeSourceKey(sourceKey), ...body });
}

function normalizeDeletion(sourceKey, body) {
  const keys = ['action', 'expectedRevision', 'expectedDigest', 'confirmed'];
  if (!exact(body, keys) || !['request', 'cancel'].includes(body.action) || !pair(body) || body.confirmed !== true) {
    fail('Deletion request details are invalid.');
  }
  return Object.freeze({ sourceKey: importContract.normalizeSourceKey(sourceKey), ...body });
}

function normalizeCleanup(sourceKey, body) {
  const keys = ['operation', 'expectedRevision', 'expectedDigest', 'cursorBefore', 'limit', 'confirmed'];
  if (!exact(body, keys) || !['retention', 'deletion'].includes(body.operation) || !pair(body) ||
      !(body.cursorBefore === null || (typeof body.cursorBefore === 'string' && /^[\x21-\x7e]{1,128}$/.test(body.cursorBefore))) ||
      !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100 || body.confirmed !== true) {
    fail('Cleanup execution details are invalid.');
  }
  return Object.freeze({ sourceKey: importContract.normalizeSourceKey(sourceKey), ...body });
}

module.exports = { normalizeAdapter, normalizeRetention, normalizeDeletion, normalizeCleanup };
