'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const OPAQUE_KEY = /^[\x21-\x7e]{1,128}$/;
const CONSENT_KEYS = ['action', 'expectedRevision', 'expectedDigest', 'reason', 'confirmed', 'confirmationVersion'];
const BATCH_KEYS = ['schemaVersion', 'mode', 'expectedConsentRevision', 'expectedConsentDigest', 'cursorBefore',
  'cursorAfter', 'complete', 'records', 'reason', 'confirmed', 'confirmationVersion'];
const RECORD_KEYS = ['externalRecordId', 'externalVersion', 'state', 'workerReference', 'jobReference', 'category',
  'observedStart', 'observedEnd', 'sourceUpdatedAt'];
const CATEGORIES = new Set(['setup', 'production', 'cleanup', 'travel', 'other']);

function fail(message) {
  const error = new Error(message);
  error.code = 'M25_IMPORT_INPUT_INVALID';
  error.status = 400;
  throw error;
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function text(value, maximum) {
  return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
    value.length >= 1 && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function normalizeSourceKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (!SOURCE_KEY.test(normalized) || normalized !== value) fail('External labor source identity is invalid.');
  return normalized;
}

function normalizeConsent(sourceKey, body) {
  const normalizedSourceKey = normalizeSourceKey(sourceKey);
  if (!exactObject(body, CONSENT_KEYS) || !['grant', 'revoke'].includes(body.action) ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 10000 ||
      !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-labor-import-consent-v1' || !text(body.reason, 2000)) {
    fail('External labor import consent details are invalid.');
  }
  return Object.freeze({ sourceKey: normalizedSourceKey, action: body.action, expectedRevision: body.expectedRevision,
    expectedDigest: body.expectedDigest, reason: body.reason, confirmed: true,
    confirmationVersion: 'm25-external-labor-import-consent-v1' });
}

function iso(value) {
  if (typeof value !== 'string') return false;
  try { return value === new Date(value).toISOString(); } catch (_error) { return false; }
}

function nullableCursor(value) {
  return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value));
}

function normalizeRecord(value) {
  if (!exactObject(value, RECORD_KEYS) || !OPAQUE_KEY.test(String(value.externalRecordId || '')) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active', 'tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External labor record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External labor source time is invalid.');
  if (value.state === 'tombstone') {
    if (![value.workerReference, value.jobReference, value.category, value.observedStart, value.observedEnd].every(item => item === null)) {
      fail('Removed external labor records cannot retain work details.');
    }
  } else {
    if (!OPAQUE_KEY.test(String(value.workerReference || '')) || !OPAQUE_KEY.test(String(value.jobReference || '')) ||
        !CATEGORIES.has(value.category) || !iso(value.observedStart) || !iso(value.observedEnd)) fail('External labor record is invalid.');
    const duration = Date.parse(value.observedEnd) - Date.parse(value.observedStart);
    if (duration <= 0 || duration > 168 * 3600000) fail('External labor record duration is invalid.');
  }
  return Object.freeze({ ...value });
}

function normalizeBatch(sourceKey, body) {
  const normalizedSourceKey = normalizeSourceKey(sourceKey);
  if (!exactObject(body, BATCH_KEYS) || body.schemaVersion !== 'm25-external-labor-time-v1' ||
      !['historical_backfill', 'continuous_update'].includes(body.mode) ||
      !Number.isInteger(body.expectedConsentRevision) || body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 ||
      !DIGEST.test(String(body.expectedConsentDigest || '')) || !nullableCursor(body.cursorBefore) ||
      !nullableCursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-labor-import-batch-v1' || !text(body.reason, 2000)) {
    fail('External labor import batch is invalid.');
  }
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) {
    fail('External labor import cursor is invalid.');
  }
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) {
    fail('An external labor record appears more than once in this batch.');
  }
  return Object.freeze({ sourceKey: normalizedSourceKey, schemaVersion: body.schemaVersion, mode: body.mode,
    expectedConsentRevision: body.expectedConsentRevision, expectedConsentDigest: body.expectedConsentDigest,
    cursorBefore: body.cursorBefore, cursorAfter: body.cursorAfter, complete: body.complete, records,
    reason: body.reason, confirmed: true, confirmationVersion: 'm25-external-labor-import-batch-v1' });
}

module.exports = { normalizeSourceKey, normalizeConsent, normalizeBatch };
