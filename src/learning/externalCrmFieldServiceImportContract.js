'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const OPAQUE_KEY = /^[\x21-\x7e]{1,128}$/;
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/;
const CONSENT_VERSION = 'm25-external-crm-field-service-import-consent-v1';
const BATCH_VERSION = 'm25-external-crm-field-service-import-batch-v1';
const SCHEMA_VERSION = 'm25-external-crm-field-service-v1';
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const BATCH_KEYS = ['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore',
  'cursorAfter','complete','records','reason','confirmed','confirmationVersion'];
const RECORD_KEYS = ['externalRecordId','externalVersion','state','recordType','customerReference','leadReference',
  'jobReference','appointmentReference','estimateReference','recordState','occurredAt','endedAt','timeZone',
  'evidenceClass','providerEvidenceDigest','sourceUpdatedAt'];
const RECORD_STATES = Object.freeze({
  customer: new Set(['active','inactive','unknown']),
  lead: new Set(['new','qualified','unqualified','won','lost','unknown']),
  job: new Set(['proposed','scheduled','in_progress','completed','canceled','unknown']),
  appointment: new Set(['requested','scheduled','completed','canceled','no_show','unknown']),
  issued_estimate: new Set(['issued','accepted','declined','questioned','expired','revoked','unknown']),
});

function fail(message) {
  throw Object.assign(new Error(message), { code: 'M25_CRM_FIELD_SERVICE_IMPORT_INPUT_INVALID', status: 400 });
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
function optionalReference(value) { return value === null || OPAQUE_KEY.test(String(value || '')); }
function sourceKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized !== value || !SOURCE_KEY.test(normalized)) fail('External CRM or field-service source identity is invalid.');
  return normalized;
}
function normalizeRecord(value) {
  if (!exact(value, RECORD_KEYS) || !OPAQUE_KEY.test(String(value.externalRecordId || '')) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active','tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External CRM or field-service record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External CRM or field-service source time is invalid.');
  if (value.state === 'tombstone') {
    for (const key of RECORD_KEYS.filter(key => !['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key))) {
      if (value[key] !== null) fail('Removed external CRM or field-service records cannot retain business details.');
    }
    return Object.freeze({ ...value });
  }
  if (!Object.hasOwn(RECORD_STATES, value.recordType) || !optionalReference(value.customerReference) ||
      !optionalReference(value.leadReference) || !optionalReference(value.jobReference) ||
      !optionalReference(value.appointmentReference) || !optionalReference(value.estimateReference) ||
      !RECORD_STATES[value.recordType].has(value.recordState) || !iso(value.occurredAt) ||
      !(value.endedAt === null || iso(value.endedAt)) || !TIME_ZONE.test(String(value.timeZone || '')) ||
      Date.parse(value.occurredAt) > Date.parse(value.sourceUpdatedAt) ||
      (value.endedAt !== null && (Date.parse(value.endedAt) < Date.parse(value.occurredAt) || Date.parse(value.endedAt) > Date.parse(value.sourceUpdatedAt))) ||
      !['provider_recorded','documented','owner_confirmed'].includes(value.evidenceClass) ||
      !DIGEST.test(String(value.providerEvidenceDigest || ''))) fail('External CRM or field-service record is invalid.');

  const required = {
    customer: ['customerReference'], lead: ['leadReference'], job: ['jobReference'],
    appointment: ['appointmentReference'], issued_estimate: ['estimateReference'],
  }[value.recordType];
  if (required.some(key => value[key] === null)) fail('External CRM or field-service identity is incomplete.');
  if ((value.recordType === 'customer' && [value.leadReference,value.jobReference,value.appointmentReference,value.estimateReference].some(item => item !== null)) ||
      (value.recordType === 'lead' && [value.jobReference,value.appointmentReference,value.estimateReference].some(item => item !== null)) ||
      (value.recordType === 'job' && [value.appointmentReference,value.estimateReference].some(item => item !== null)) ||
      (value.recordType === 'appointment' && value.estimateReference !== null)) fail('External CRM or field-service references do not match the record type.');
  return Object.freeze({ ...value });
}
function normalizeConsent(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== CONSENT_VERSION || !text(body.reason, 2000)) fail('External CRM or field-service import permission details are invalid.');
  return Object.freeze({ sourceKey: normalized, ...body });
}
function normalizeBatch(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, BATCH_KEYS) || body.schemaVersion !== SCHEMA_VERSION ||
      !['historical_backfill','continuous_update'].includes(body.mode) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) ||
      !cursor(body.cursorBefore) || !cursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== BATCH_VERSION || !text(body.reason, 2000)) fail('External CRM or field-service import batch is invalid.');
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) {
    fail('External CRM or field-service import position is invalid.');
  }
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) fail('An external CRM or field-service record appears more than once in this batch.');
  return Object.freeze({ sourceKey: normalized, ...body, records });
}

module.exports = { CONSENT_VERSION, BATCH_VERSION, SCHEMA_VERSION, RECORD_STATES,
  normalizeSourceKey: sourceKey, normalizeConsent, normalizeBatch, normalizeRecord };
