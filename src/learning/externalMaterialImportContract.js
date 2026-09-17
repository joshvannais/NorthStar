'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const OPAQUE_KEY = /^[\x21-\x7e]{1,128}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/;
const UNITS = new Set(['ea','m','m2','m3','ft','ft2','ft3','yd3','kg','lb','l','gal']);
const CONSENT_VERSION = 'm25-external-material-import-consent-v1';
const BATCH_VERSION = 'm25-external-material-import-batch-v1';
const SCHEMA_VERSION = 'm25-external-material-actual-v1';
const CONSENT_KEYS = ['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const BATCH_KEYS = ['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore',
  'cursorAfter','complete','records','reason','confirmed','confirmationVersion'];
const RECORD_KEYS = ['externalRecordId','externalVersion','state','recordType','jobReference','materialReference',
  'vendorReference','locationReference','occurredAt','timeZone','movementKind','quantity','cost','evidenceClass',
  'providerEvidenceDigest','sourceUpdatedAt'];
const QUANTITY_KEYS = ['value','unit','basis'];
const COST_KEYS = ['amount','currency','valuation','basis'];

function fail(message) {
  throw Object.assign(new Error(message), { code: 'M25_MATERIAL_IMPORT_INPUT_INVALID', status: 400 });
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
function decimal(value, positive) {
  return typeof value === 'string' && DECIMAL.test(value) && (!positive || Number(value) > 0);
}
function optionalReference(value) { return value === null || OPAQUE_KEY.test(String(value || '')); }
function sourceKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized !== value || !SOURCE_KEY.test(normalized)) fail('External material source identity is invalid.');
  return normalized;
}
function normalizeQuantity(value, positive = true) {
  if (value === null) return null;
  if (!exact(value, QUANTITY_KEYS) || !decimal(value.value, positive) || !UNITS.has(value.unit) ||
      !['counted','provider_recorded','owner_confirmed','invoice','receipt','purchase_order','vendor_quote','catalog'].includes(value.basis)) {
    fail('External material quantity evidence is invalid.');
  }
  if (value.unit === 'ea' && Number(value.value) !== Math.trunc(Number(value.value))) fail('External item quantity must be a whole number.');
  return Object.freeze({ ...value });
}
function normalizeCost(value) {
  if (value === null) return null;
  if (!exact(value, COST_KEYS) || !decimal(value.amount, true) || !['USD','CAD','EUR'].includes(value.currency) ||
      !['unit_cost','line_total','shipping','tax','discount'].includes(value.valuation) ||
      !['invoice','receipt','purchase_order','vendor_quote','catalog','provider_recorded','owner_confirmed'].includes(value.basis)) {
    fail('External material cost evidence is invalid.');
  }
  return Object.freeze({ ...value });
}
function normalizeRecord(value) {
  if (!exact(value, RECORD_KEYS) || !OPAQUE_KEY.test(String(value.externalRecordId || '')) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active','tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External material record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External material source time is invalid.');
  if (value.state === 'tombstone') {
    for (const key of RECORD_KEYS.filter(key => !['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key))) {
      if (value[key] !== null) fail('Removed external material records cannot retain business details.');
    }
    return Object.freeze({ ...value });
  }
  if (!['inventory_balance','inventory_movement','purchase','vendor_cost'].includes(value.recordType) ||
      !optionalReference(value.jobReference) || !OPAQUE_KEY.test(String(value.materialReference || '')) ||
      !optionalReference(value.vendorReference) || !optionalReference(value.locationReference) ||
      !iso(value.occurredAt) || !TIME_ZONE.test(String(value.timeZone || '')) ||
      Date.parse(value.occurredAt) > Date.parse(value.sourceUpdatedAt) ||
      !['measured','documented','provider_recorded','owner_confirmed'].includes(value.evidenceClass) ||
      !DIGEST.test(String(value.providerEvidenceDigest || ''))) fail('External material record is invalid.');
  const quantity = normalizeQuantity(value.quantity, value.recordType !== 'inventory_balance');
  const cost = normalizeCost(value.cost), movement = value.movementKind;
  if ((value.recordType === 'inventory_balance' && (!quantity || cost || movement !== null || value.locationReference === null || value.jobReference !== null || value.vendorReference !== null)) ||
      (value.recordType === 'inventory_movement' && (!quantity || cost || value.locationReference === null ||
        !['received','consumed','waste','returned','transfer_in','transfer_out','adjustment_increase','adjustment_decrease'].includes(movement))) ||
      (value.recordType === 'purchase' && (!quantity || !cost || movement !== null || value.vendorReference === null ||
        !['unit_cost','line_total'].includes(cost && cost.valuation))) ||
      (value.recordType === 'vendor_cost' && (!quantity || !cost || movement !== null || value.vendorReference === null))) {
    fail('External material evidence does not match its record type.');
  }
  return Object.freeze({ ...value, quantity, cost });
}
function normalizeConsent(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, CONSENT_KEYS) || !['grant','revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== CONSENT_VERSION || !text(body.reason, 2000)) fail('External material import permission details are invalid.');
  return Object.freeze({ sourceKey: normalized, ...body });
}
function normalizeBatch(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, BATCH_KEYS) || body.schemaVersion !== SCHEMA_VERSION ||
      !['historical_backfill','continuous_update'].includes(body.mode) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) ||
      !cursor(body.cursorBefore) || !cursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== BATCH_VERSION || !text(body.reason, 2000)) fail('External material import batch is invalid.');
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) {
    fail('External material import position is invalid.');
  }
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) fail('An external material record appears more than once in this batch.');
  return Object.freeze({ sourceKey: normalized, ...body, records });
}

module.exports = { CONSENT_VERSION, BATCH_VERSION, SCHEMA_VERSION, normalizeSourceKey: sourceKey,
  normalizeConsent, normalizeBatch, normalizeRecord };
