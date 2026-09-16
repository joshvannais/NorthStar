'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const OPAQUE_KEY = /^[\x21-\x7e]{1,128}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/;
const CONSENT_KEYS = ['action', 'expectedRevision', 'expectedDigest', 'reason', 'confirmed', 'confirmationVersion'];
const BATCH_KEYS = ['schemaVersion', 'mode', 'expectedConsentRevision', 'expectedConsentDigest', 'cursorBefore',
  'cursorAfter', 'complete', 'records', 'reason', 'confirmed', 'confirmationVersion'];
const RECORD_KEYS = ['externalRecordId', 'externalVersion', 'state', 'recordType', 'jobReference', 'assetReference',
  'assetCategory', 'periodStartedAt', 'periodEndedAt', 'timeZone', 'utilization', 'cost', 'maintenance', 'downtime',
  'evidenceClass', 'providerEvidenceDigest', 'sourceUpdatedAt'];
const UTILIZATION_KEYS = ['value', 'unit', 'basis'];
const COST_KEYS = ['amount', 'currency', 'costClass', 'basis'];
const MAINTENANCE_KEYS = ['kind', 'status', 'workOrderReference', 'meter'];
const DOWNTIME_KEYS = ['reasonClass', 'scheduled'];

function fail(message) { const error = new Error(message); error.code = 'M25_ASSET_IMPORT_INPUT_INVALID'; error.status = 400; throw error; }
function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const actual = Object.keys(value).sort(), expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function text(value, maximum) { return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') && value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function iso(value) { if (typeof value !== 'string') return false; try { return value === new Date(value).toISOString(); } catch (_error) { return false; } }
function cursor(value) { return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value)); }
function decimal(value, positive = false) { return typeof value === 'string' && DECIMAL.test(value) && (!positive || Number(value) > 0); }
function sourceKey(value) { const normalized = String(value || '').toLowerCase(); if (normalized !== value || !SOURCE_KEY.test(normalized)) fail('External vehicle and equipment source identity is invalid.'); return normalized; }

function normalizeUtilization(value) {
  if (value === null) return null;
  if (!exact(value, UTILIZATION_KEYS) || !decimal(value.value, true) ||
      !['engine_hour', 'machine_hour', 'mile', 'km', 'cycle', 'job'].includes(value.unit) ||
      !['meter', 'telematics', 'provider_recorded', 'owner_confirmed'].includes(value.basis)) fail('External utilization evidence is invalid.');
  return Object.freeze({ ...value });
}

function normalizeCost(value) {
  if (value === null) return null;
  if (!exact(value, COST_KEYS) || !decimal(value.amount) || !['USD', 'CAD', 'EUR'].includes(value.currency) ||
      !['fuel_energy', 'consumables', 'maintenance', 'repair', 'lease_finance', 'insurance', 'rental', 'other'].includes(value.costClass) ||
      !['invoice', 'receipt', 'fuel_card', 'work_order', 'provider_recorded', 'owner_confirmed'].includes(value.basis)) fail('External operating cost evidence is invalid.');
  return Object.freeze({ ...value });
}

function normalizeMaintenance(value) {
  if (value === null) return null;
  if (!exact(value, MAINTENANCE_KEYS) || !['preventive', 'corrective', 'inspection', 'scheduled_service'].includes(value.kind) ||
      !['completed', 'deferred', 'cancelled'].includes(value.status) ||
      !(value.workOrderReference === null || OPAQUE_KEY.test(String(value.workOrderReference || '')))) fail('External maintenance evidence is invalid.');
  const meter = normalizeUtilization(value.meter);
  if (meter && ['job'].includes(meter.unit)) fail('Maintenance meter evidence is invalid.');
  return Object.freeze({ ...value, meter });
}

function normalizeDowntime(value) {
  if (value === null) return null;
  if (!exact(value, DOWNTIME_KEYS) || !['maintenance', 'fault', 'damage', 'inspection', 'unavailable', 'other'].includes(value.reasonClass) || typeof value.scheduled !== 'boolean') fail('External downtime evidence is invalid.');
  return Object.freeze({ ...value });
}

function normalizeRecord(value) {
  if (!exact(value, RECORD_KEYS) || !OPAQUE_KEY.test(String(value.externalRecordId || '')) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active', 'tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External vehicle or equipment record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External vehicle or equipment source time is invalid.');
  if (value.state === 'tombstone') {
    for (const key of RECORD_KEYS.filter(key => !['externalRecordId', 'externalVersion', 'state', 'sourceUpdatedAt'].includes(key))) if (value[key] !== null) fail('Removed external vehicle or equipment records cannot retain operational details.');
    return Object.freeze({ ...value });
  }
  if (!['utilization', 'operating_cost', 'maintenance', 'downtime'].includes(value.recordType) ||
      !(value.jobReference === null || OPAQUE_KEY.test(String(value.jobReference || ''))) ||
      !OPAQUE_KEY.test(String(value.assetReference || '')) || !['vehicle', 'equipment'].includes(value.assetCategory) ||
      !iso(value.periodStartedAt) || !iso(value.periodEndedAt) || !TIME_ZONE.test(String(value.timeZone || '')) ||
      !['measured', 'provider_recorded', 'owner_confirmed'].includes(value.evidenceClass) || !DIGEST.test(String(value.providerEvidenceDigest || ''))) fail('External vehicle or equipment record is invalid.');
  const duration = Date.parse(value.periodEndedAt) - Date.parse(value.periodStartedAt);
  if (duration <= 0 || duration > 366 * 86400000 || Date.parse(value.periodEndedAt) > Date.parse(value.sourceUpdatedAt)) fail('External vehicle or equipment period is invalid.');
  const utilization = normalizeUtilization(value.utilization), cost = normalizeCost(value.cost);
  const maintenance = normalizeMaintenance(value.maintenance), downtime = normalizeDowntime(value.downtime);
  if ((value.recordType === 'utilization' && (!utilization || cost || maintenance || downtime)) ||
      (value.recordType === 'operating_cost' && (!cost || utilization || maintenance || downtime)) ||
      (value.recordType === 'maintenance' && (!maintenance || utilization || downtime || (cost && !['maintenance', 'repair'].includes(cost.costClass)))) ||
      (value.recordType === 'downtime' && (!downtime || utilization || cost || maintenance))) fail('External vehicle or equipment evidence does not match its record type.');
  return Object.freeze({ ...value, utilization, cost, maintenance, downtime });
}

function normalizeConsent(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, CONSENT_KEYS) || !['grant', 'revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-asset-import-consent-v1' || !text(body.reason, 2000)) fail('External vehicle and equipment import consent details are invalid.');
  return Object.freeze({ sourceKey: normalized, ...body });
}

function normalizeBatch(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, BATCH_KEYS) || body.schemaVersion !== 'm25-external-asset-actual-v1' ||
      !['historical_backfill', 'continuous_update'].includes(body.mode) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) ||
      !cursor(body.cursorBefore) || !cursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-asset-import-batch-v1' || !text(body.reason, 2000)) fail('External vehicle and equipment import batch is invalid.');
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) fail('External vehicle and equipment import cursor is invalid.');
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) fail('An external vehicle or equipment record appears more than once in this batch.');
  return Object.freeze({ sourceKey: normalized, ...body, records });
}

module.exports = { normalizeSourceKey: sourceKey, normalizeConsent, normalizeBatch, normalizeRecord };
