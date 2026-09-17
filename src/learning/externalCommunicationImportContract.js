'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
// A Part 12C source adapter must replace every provider identity with a source-scoped,
// non-reversible token before the value reaches NorthStar. Raw provider IDs and business
// text are never accepted as lineage.
const OPAQUE_REFERENCE = /^ref_[0-9a-f]{64}$/;
const OPAQUE_CURSOR = /^cur_[0-9a-f]{64}$/;
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/;
const CONSENT_VERSION = 'm25-external-communication-import-consent-v1';
const BATCH_VERSION = 'm25-external-communication-import-batch-v1';
const SCHEMA_VERSION = 'm25-external-communication-evidence-v1';
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const BATCH_KEYS = ['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore',
  'cursorAfter','complete','records','reason','confirmed','confirmationVersion'];
const RECORD_KEYS = ['externalRecordId','externalVersion','state','recordType','customerReference','leadReference',
  'jobReference','appointmentReference','estimateReference','projectReference','communicationReference','channel',
  'direction','intentClaim','deliveryState','satisfactionClaim','occurredAt','timeZone','evidenceClass',
  'providerEvidenceDigest','sourceUpdatedAt'];
const CLAIM_KEYS = ['status','value','basis'];
const CHANNELS = new Set(['phone','sms','email','chat','portal','other','unknown']);
const DIRECTIONS = new Set(['inbound','outbound','internal','unknown']);
const INTENTS = new Set(['request_estimate','schedule','reschedule','cancel','question','status_request','complaint','compliment','other','unknown']);
const INTENT_BASES = new Set(['customer_explicit','human_reviewed','provider_classified']);
const DELIVERY_STATES = new Set(['queued','sent','delivered','failed','bounced','read','unknown']);
const SATISFACTION_VALUES = new Set(['satisfied','neutral','dissatisfied','unknown']);
const SATISFACTION_BASES = new Set(['explicit_customer_feedback','human_reviewed_explicit_feedback']);

function fail(message) {
  throw Object.assign(new Error(message), { code: 'M25_COMMUNICATION_IMPORT_INPUT_INVALID', status: 400 });
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
  return value === null || (typeof value === 'string' && OPAQUE_CURSOR.test(value));
}
function optionalReference(value) { return value === null || (typeof value === 'string' && OPAQUE_REFERENCE.test(value)); }
function sourceKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized !== value || !SOURCE_KEY.test(normalized)) fail('External communication source identity is invalid.');
  return normalized;
}
function normalizeClaim(value, values, bases, label) {
  if (!exact(value, CLAIM_KEYS) || !['recorded','unavailable'].includes(value.status)) fail(`External ${label} evidence is invalid.`);
  if (value.status === 'unavailable') {
    if (value.value !== null || value.basis !== null) fail(`Unavailable ${label} evidence cannot contain a value or basis.`);
  } else if (!values.has(value.value) || !bases.has(value.basis)) {
    fail(`Recorded ${label} evidence requires an allowed value and evidence basis.`);
  }
  return Object.freeze({ ...value });
}
function normalizeRecord(value) {
  if (!exact(value, RECORD_KEYS) || typeof value.externalRecordId !== 'string' || !OPAQUE_REFERENCE.test(value.externalRecordId) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active','tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External communication record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External communication source time is invalid.');
  if (value.state === 'tombstone') {
    for (const key of RECORD_KEYS.filter(key => !['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key))) {
      if (value[key] !== null) fail('Removed external communication records cannot retain business details.');
    }
    return Object.freeze({ ...value });
  }
  if (!['communication','delivery','satisfaction'].includes(value.recordType) ||
      !optionalReference(value.customerReference) || !optionalReference(value.leadReference) ||
      !optionalReference(value.jobReference) || !optionalReference(value.appointmentReference) ||
      !optionalReference(value.estimateReference) || !optionalReference(value.projectReference) ||
      typeof value.communicationReference !== 'string' || !OPAQUE_REFERENCE.test(value.communicationReference) ||
      !iso(value.occurredAt) || !TIME_ZONE.test(String(value.timeZone || '')) ||
      Date.parse(value.occurredAt) > Date.parse(value.sourceUpdatedAt) ||
      !['provider_recorded','documented','owner_confirmed'].includes(value.evidenceClass) ||
      !DIGEST.test(String(value.providerEvidenceDigest || ''))) fail('External communication record is invalid.');

  if (value.recordType === 'communication') {
    if (!CHANNELS.has(value.channel) || !DIRECTIONS.has(value.direction) || value.deliveryState !== null || value.satisfactionClaim !== null) {
      fail('External communication details do not match the record type.');
    }
    normalizeClaim(value.intentClaim, INTENTS, INTENT_BASES, 'communication intent');
  } else if (value.recordType === 'delivery') {
    if (value.channel !== null || value.direction !== null || value.intentClaim !== null ||
        !DELIVERY_STATES.has(value.deliveryState) || value.satisfactionClaim !== null) {
      fail('External delivery details do not match the record type.');
    }
  } else {
    if (value.channel !== null || value.direction !== null || value.intentClaim !== null || value.deliveryState !== null) {
      fail('External satisfaction details do not match the record type.');
    }
    normalizeClaim(value.satisfactionClaim, SATISFACTION_VALUES, SATISFACTION_BASES, 'customer satisfaction');
  }
  return Object.freeze({ ...value,
    intentClaim: value.intentClaim === null ? null : Object.freeze({ ...value.intentClaim }),
    satisfactionClaim: value.satisfactionClaim === null ? null : Object.freeze({ ...value.satisfactionClaim }),
  });
}
function normalizeConsent(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== CONSENT_VERSION || !text(body.reason, 2000)) fail('External communication import permission details are invalid.');
  return Object.freeze({ sourceKey: normalized, ...body });
}
function normalizeBatch(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, BATCH_KEYS) || body.schemaVersion !== SCHEMA_VERSION ||
      !['historical_backfill','continuous_update'].includes(body.mode) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) ||
      !cursor(body.cursorBefore) || !cursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== BATCH_VERSION || !text(body.reason, 2000)) fail('External communication import batch is invalid.');
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) {
    fail('External communication import position is invalid.');
  }
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) fail('An external communication record appears more than once in this batch.');
  return Object.freeze({ sourceKey: normalized, ...body, records });
}

module.exports = { CONSENT_VERSION, BATCH_VERSION, SCHEMA_VERSION, OPAQUE_REFERENCE, OPAQUE_CURSOR, CHANNELS, DIRECTIONS, INTENTS,
  INTENT_BASES, DELIVERY_STATES, SATISFACTION_VALUES, SATISFACTION_BASES,
  normalizeSourceKey: sourceKey, normalizeConsent, normalizeBatch, normalizeRecord };
