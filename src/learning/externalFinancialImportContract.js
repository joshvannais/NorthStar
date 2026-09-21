'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const OPAQUE_REFERENCE = /^ref_[0-9a-f]{64}$/;
const OPAQUE_CURSOR = /^cur_[0-9a-f]{64}$/;
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const CONSENT_VERSION = 'm25-external-financial-import-consent-v1';
const BATCH_VERSION = 'm25-external-financial-import-batch-v1';
const SCHEMA_VERSION = 'm25-external-financial-evidence-v1';
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const BATCH_KEYS = ['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore',
  'cursorAfter','complete','records','reason','confirmed','confirmationVersion'];
const RECORD_KEYS = ['externalRecordId','externalVersion','state','recordType','customerReference','jobReference',
  'estimateReference','executionReference','projectReference','changeOrderReference','invoiceReference',
  'paymentReference','collectionReference','accountingReference','recordState','amountClaim','occurredAt',
  'timeZone','evidenceClass','providerEvidenceDigest','sourceUpdatedAt'];
const AMOUNT_KEYS = ['status','amount','currency','basis'];
const RECORD_STATES = Object.freeze({
  invoice: new Set(['draft','issued','partially_paid','paid','overdue','voided','written_off','unknown']),
  payment: new Set(['pending','authorized','succeeded','failed','refunded','partially_refunded','canceled','unknown']),
  collection: new Set(['open','in_progress','promised','settled','closed','failed','written_off','unknown']),
  accounting_entry: new Set(['draft','posted','reversed','voided','unknown']),
});
const AMOUNT_BASES = Object.freeze({
  invoice: new Set(['invoice_total','invoice_balance']),
  payment: new Set(['payment_received','refund_issued']),
  collection: new Set(['amount_collected','outstanding_balance','write_off']),
  accounting_entry: new Set(['revenue','direct_cost','overhead_cost','other_income','other_cost','unknown']),
});

function fail(message) {
  throw Object.assign(new Error(message), { code: 'M25_FINANCIAL_IMPORT_INPUT_INVALID', status: 400 });
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
function cursor(value) { return value === null || (typeof value === 'string' && OPAQUE_CURSOR.test(value)); }
function optionalReference(value) { return value === null || (typeof value === 'string' && OPAQUE_REFERENCE.test(value)); }
function sourceKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized !== value || !SOURCE_KEY.test(normalized)) fail('External financial source identity is invalid.');
  return normalized;
}
function normalizeAmount(value, recordType) {
  if (!exact(value, AMOUNT_KEYS) || !['recorded','unavailable'].includes(value.status)) {
    fail('External financial amount evidence is invalid.');
  }
  if (value.status === 'unavailable') {
    if (value.amount !== null || value.currency !== null || value.basis !== null) {
      fail('Unavailable financial evidence cannot contain an amount, currency, or basis.');
    }
  } else if (typeof value.amount !== 'string' || !DECIMAL.test(value.amount) ||
      typeof value.currency !== 'string' || !CURRENCY.test(value.currency) || !AMOUNT_BASES[recordType].has(value.basis)) {
    fail('Recorded financial evidence requires an exact nonnegative amount, currency, and allowed basis.');
  }
  return Object.freeze({ ...value });
}
function normalizeRecord(value) {
  if (!exact(value, RECORD_KEYS) || typeof value.externalRecordId !== 'string' || !OPAQUE_REFERENCE.test(value.externalRecordId) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active','tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External financial record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External financial source time is invalid.');
  if (value.state === 'tombstone') {
    for (const key of RECORD_KEYS.filter(key => !['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key))) {
      if (value[key] !== null) fail('Removed external financial records cannot retain business details.');
    }
    return Object.freeze({ ...value });
  }
  if (!Object.hasOwn(RECORD_STATES, value.recordType) ||
      !['customerReference','jobReference','estimateReference','executionReference','projectReference','changeOrderReference',
        'invoiceReference','paymentReference','collectionReference','accountingReference'].every(key => optionalReference(value[key])) ||
      !RECORD_STATES[value.recordType].has(value.recordState) || !iso(value.occurredAt) ||
      !TIME_ZONE.test(String(value.timeZone || '')) || Date.parse(value.occurredAt) > Date.parse(value.sourceUpdatedAt) ||
      !['provider_recorded','documented','owner_confirmed'].includes(value.evidenceClass) ||
      !DIGEST.test(String(value.providerEvidenceDigest || ''))) fail('External financial record is invalid.');

  const required = { invoice: 'invoiceReference', payment: 'paymentReference', collection: 'collectionReference',
    accounting_entry: 'accountingReference' }[value.recordType];
  if (value[required] === null ||
      (value.recordType === 'invoice' && [value.paymentReference,value.collectionReference,value.accountingReference].some(item => item !== null)) ||
      (value.recordType === 'payment' && [value.collectionReference,value.accountingReference].some(item => item !== null)) ||
      (value.recordType === 'collection' && value.accountingReference !== null) ||
      (value.recordType === 'accounting_entry' && value.collectionReference !== null)) {
    fail('External financial references do not match the record type.');
  }
  normalizeAmount(value.amountClaim, value.recordType);
  return Object.freeze({ ...value, amountClaim: Object.freeze({ ...value.amountClaim }) });
}
function normalizeConsent(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== CONSENT_VERSION || !text(body.reason, 2000)) fail('External financial import permission details are invalid.');
  return Object.freeze({ sourceKey: normalized, ...body });
}
function normalizeBatch(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, BATCH_KEYS) || body.schemaVersion !== SCHEMA_VERSION ||
      !['historical_backfill','continuous_update'].includes(body.mode) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) ||
      !cursor(body.cursorBefore) || !cursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== BATCH_VERSION || !text(body.reason, 2000)) fail('External financial import batch is invalid.');
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) {
    fail('External financial import position is invalid.');
  }
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) {
    fail('An external financial record appears more than once in this batch.');
  }
  return Object.freeze({ sourceKey: normalized, ...body, records });
}

module.exports = { CONSENT_VERSION, BATCH_VERSION, SCHEMA_VERSION, OPAQUE_REFERENCE, OPAQUE_CURSOR,
  RECORD_STATES, AMOUNT_BASES, normalizeSourceKey: sourceKey, normalizeConsent, normalizeBatch,
  normalizeRecord, normalizeAmount };
