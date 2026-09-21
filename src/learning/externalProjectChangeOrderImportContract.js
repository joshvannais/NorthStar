'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const OPAQUE_KEY = /^[\x21-\x7e]{1,128}$/;
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
const ZERO = /^0(?:\.0{1,6})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const CONSENT_VERSION = 'm25-external-project-change-order-import-consent-v1';
const BATCH_VERSION = 'm25-external-project-change-order-import-batch-v1';
const SCHEMA_VERSION = 'm25-external-project-change-order-v1';
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const BATCH_KEYS = ['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore',
  'cursorAfter','complete','records','reason','confirmed','confirmationVersion'];
const RECORD_KEYS = ['externalRecordId','externalVersion','state','recordType','customerReference','jobReference',
  'estimateReference','projectReference','changeOrderReference','recordState','originalContract','currentContract',
  'changeOrderValue','occurredAt','endedAt','timeZone','evidenceClass','providerEvidenceDigest','sourceUpdatedAt'];
const VALUE_KEYS = ['status','amount','currency'];
const CHANGE_VALUE_KEYS = ['status','effect','amount','currency'];
const RECORD_STATES = Object.freeze({
  project: new Set(['proposed','active','on_hold','completed','canceled','unknown']),
  change_order: new Set(['proposed','approved','rejected','voided','completed','unknown']),
});

function fail(message) {
  throw Object.assign(new Error(message), { code: 'M25_PROJECT_CHANGE_ORDER_IMPORT_INPUT_INVALID', status: 400 });
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function text(value, maximum) {
  return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') &&
    value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}
function iso(value) {
  if (typeof value !== 'string') return false;
  try { return value === new Date(value).toISOString(); } catch (_error) { return false; }
}
function cursor(value) {
  return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value));
}
function optionalReference(value) { return value === null || (typeof value === 'string' && OPAQUE_KEY.test(value)); }
function sourceKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized !== value || !SOURCE_KEY.test(normalized)) fail('External project source identity is invalid.');
  return normalized;
}
function normalizeValue(value) {
  if (!exact(value, VALUE_KEYS) || !['recorded','unavailable'].includes(value.status)) fail('External contract value is invalid.');
  if (value.status === 'unavailable') {
    if (value.amount !== null || value.currency !== null) fail('Unavailable contract values cannot contain an amount or currency.');
  } else if (typeof value.amount !== 'string' || !DECIMAL.test(value.amount) ||
      typeof value.currency !== 'string' || !CURRENCY.test(value.currency)) {
    fail('Recorded contract values require an exact nonnegative amount and currency.');
  }
  return Object.freeze({ ...value });
}
function normalizeChangeOrderValue(value) {
  if (!exact(value, CHANGE_VALUE_KEYS) || !['recorded','unavailable'].includes(value.status)) fail('External change-order value is invalid.');
  if (value.status === 'unavailable') {
    if (value.effect !== null || value.amount !== null || value.currency !== null) fail('Unavailable change-order values cannot contain an effect, amount or currency.');
  } else if (!['increase','decrease','no_change'].includes(value.effect) || typeof value.amount !== 'string' ||
      !DECIMAL.test(value.amount) || typeof value.currency !== 'string' || !CURRENCY.test(value.currency) ||
      ((value.effect === 'no_change') !== ZERO.test(value.amount))) {
    fail('Recorded change-order values require an exact effect, nonnegative amount and currency.');
  }
  return Object.freeze({ ...value });
}
function normalizeRecord(value) {
  if (!exact(value, RECORD_KEYS) || typeof value.externalRecordId !== 'string' || !OPAQUE_KEY.test(value.externalRecordId) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active','tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External project or change-order record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External project source time is invalid.');
  if (value.state === 'tombstone') {
    for (const key of RECORD_KEYS.filter(key => !['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key))) {
      if (value[key] !== null) fail('Removed external project records cannot retain business details.');
    }
    return Object.freeze({ ...value });
  }
  if (!Object.hasOwn(RECORD_STATES, value.recordType) || !optionalReference(value.customerReference) ||
      !optionalReference(value.jobReference) || !optionalReference(value.estimateReference) ||
      !optionalReference(value.projectReference) || !optionalReference(value.changeOrderReference) ||
      !RECORD_STATES[value.recordType].has(value.recordState) || !iso(value.occurredAt) ||
      !(value.endedAt === null || iso(value.endedAt)) || !TIME_ZONE.test(String(value.timeZone || '')) ||
      Date.parse(value.occurredAt) > Date.parse(value.sourceUpdatedAt) ||
      (value.endedAt !== null && (Date.parse(value.endedAt) < Date.parse(value.occurredAt) || Date.parse(value.endedAt) > Date.parse(value.sourceUpdatedAt))) ||
      !['provider_recorded','documented','owner_confirmed'].includes(value.evidenceClass) ||
      !DIGEST.test(String(value.providerEvidenceDigest || ''))) fail('External project or change-order record is invalid.');

  if (value.recordType === 'project') {
    if (value.projectReference === null || value.changeOrderReference !== null || value.changeOrderValue !== null) {
      fail('External project references do not match the record type.');
    }
    normalizeValue(value.originalContract); normalizeValue(value.currentContract);
  } else {
    if (value.projectReference === null || value.changeOrderReference === null || value.originalContract !== null || value.currentContract !== null) {
      fail('External change-order references do not match the record type.');
    }
    normalizeChangeOrderValue(value.changeOrderValue);
  }
  return Object.freeze({ ...value,
    originalContract: value.originalContract === null ? null : Object.freeze({ ...value.originalContract }),
    currentContract: value.currentContract === null ? null : Object.freeze({ ...value.currentContract }),
    changeOrderValue: value.changeOrderValue === null ? null : Object.freeze({ ...value.changeOrderValue }),
  });
}
function normalizeConsent(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== CONSENT_VERSION || !text(body.reason, 2000)) fail('External project import permission details are invalid.');
  return Object.freeze({ sourceKey: normalized, ...body });
}
function normalizeBatch(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, BATCH_KEYS) || body.schemaVersion !== SCHEMA_VERSION ||
      !['historical_backfill','continuous_update'].includes(body.mode) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) ||
      !cursor(body.cursorBefore) || !cursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== BATCH_VERSION || !text(body.reason, 2000)) fail('External project import batch is invalid.');
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) {
    fail('External project import position is invalid.');
  }
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) fail('An external project record appears more than once in this batch.');
  return Object.freeze({ sourceKey: normalized, ...body, records });
}

module.exports = { CONSENT_VERSION, BATCH_VERSION, SCHEMA_VERSION, RECORD_STATES,
  normalizeSourceKey: sourceKey, normalizeConsent, normalizeBatch, normalizeRecord, normalizeValue, normalizeChangeOrderValue };
