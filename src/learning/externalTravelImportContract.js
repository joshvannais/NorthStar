'use strict';

const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const OPAQUE_KEY = /^[\x21-\x7e]{1,128}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/;
const CONSENT_KEYS = ['action', 'expectedRevision', 'expectedDigest', 'reason', 'confirmed', 'confirmationVersion'];
const BATCH_KEYS = ['schemaVersion', 'mode', 'expectedConsentRevision', 'expectedConsentDigest', 'cursorBefore',
  'cursorAfter', 'complete', 'records', 'reason', 'confirmed', 'confirmationVersion'];
const RECORD_KEYS = ['externalRecordId', 'externalVersion', 'state', 'jobReference', 'vehicleReference',
  'routeStartedAt', 'routeEndedAt', 'timeZone', 'distance', 'fuel', 'evidenceClass', 'sourceUpdatedAt'];
const DISTANCE_KEYS = ['value', 'unit', 'basis'];
const FUEL_KEYS = ['quantity', 'unit', 'costAmount', 'currency', 'basis'];

function fail(message) { const error = new Error(message); error.code = 'M25_TRAVEL_IMPORT_INPUT_INVALID'; error.status = 400; throw error; }
function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const actual = Object.keys(value).sort(), expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function text(value, maximum) { return typeof value === 'string' && value === value.trim() && value === value.normalize('NFC') && value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function iso(value) { if (typeof value !== 'string') return false; try { return value === new Date(value).toISOString(); } catch (_error) { return false; } }
function cursor(value) { return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value)); }
function sourceKey(value) { const normalized = String(value || '').toLowerCase(); if (normalized !== value || !SOURCE_KEY.test(normalized)) fail('External travel source identity is invalid.'); return normalized; }
function decimal(value, positive = false) { return typeof value === 'string' && DECIMAL.test(value) && (!positive || Number(value) > 0); }

function normalizeDistance(value) {
  if (value === null) return null;
  if (!exact(value, DISTANCE_KEYS) || !decimal(value.value, true) || !['mi', 'km'].includes(value.unit) ||
      !['gps', 'odometer', 'provider_recorded', 'owner_confirmed'].includes(value.basis)) fail('External travel distance is invalid.');
  return Object.freeze({ ...value });
}

function normalizeFuel(value) {
  if (value === null) return null;
  if (!exact(value, FUEL_KEYS) || !decimal(value.quantity, true) || !['us_gal', 'litre', 'kwh'].includes(value.unit) ||
      !['receipt', 'fuel_card', 'meter', 'provider_recorded', 'owner_confirmed'].includes(value.basis) ||
      !((value.costAmount === null && value.currency === null) || (decimal(value.costAmount) && ['USD', 'CAD', 'EUR'].includes(value.currency)))) {
    fail('External travel fuel evidence is invalid.');
  }
  return Object.freeze({ ...value });
}

function normalizeRecord(value) {
  if (!exact(value, RECORD_KEYS) || !OPAQUE_KEY.test(String(value.externalRecordId || '')) ||
      !Number.isInteger(value.externalVersion) || value.externalVersion < 1 || value.externalVersion > 1000000000 ||
      !['active', 'tombstone'].includes(value.state) || !iso(value.sourceUpdatedAt)) fail('External travel record is invalid.');
  if (Date.parse(value.sourceUpdatedAt) > Date.now() + 300000) fail('External travel source time is invalid.');
  if (value.state === 'tombstone') {
    for (const key of RECORD_KEYS.filter(key => !['externalRecordId', 'externalVersion', 'state', 'sourceUpdatedAt'].includes(key))) if (value[key] !== null) fail('Removed external travel records cannot retain route details.');
    return Object.freeze({ ...value });
  }
  if (!OPAQUE_KEY.test(String(value.jobReference || '')) || !OPAQUE_KEY.test(String(value.vehicleReference || '')) ||
      !iso(value.routeStartedAt) || !iso(value.routeEndedAt) || !TIME_ZONE.test(String(value.timeZone || '')) ||
      !['measured', 'provider_recorded', 'owner_confirmed'].includes(value.evidenceClass)) fail('External travel record is invalid.');
  const duration = Date.parse(value.routeEndedAt) - Date.parse(value.routeStartedAt);
  if (duration <= 0 || duration > 168 * 3600000) fail('External travel duration is invalid.');
  if (Date.parse(value.routeEndedAt) > Date.parse(value.sourceUpdatedAt)) fail('External travel cannot be recorded before the route ended.');
  const distance = normalizeDistance(value.distance), fuel = normalizeFuel(value.fuel);
  if (distance === null && fuel === null) fail('External travel evidence must include measured distance or fuel.');
  return Object.freeze({ ...value, distance, fuel });
}

function normalizeConsent(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, CONSENT_KEYS) || !['grant', 'revoke'].includes(body.action) || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision > 10000 || !(body.expectedDigest === 'none' || DIGEST.test(String(body.expectedDigest || ''))) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-travel-import-consent-v1' || !text(body.reason, 2000)) fail('External travel import consent details are invalid.');
  return Object.freeze({ sourceKey: normalized, ...body });
}

function normalizeBatch(key, body) {
  const normalized = sourceKey(key);
  if (!exact(body, BATCH_KEYS) || body.schemaVersion !== 'm25-external-travel-actual-v1' ||
      !['historical_backfill', 'continuous_update'].includes(body.mode) || !Number.isInteger(body.expectedConsentRevision) ||
      body.expectedConsentRevision < 1 || body.expectedConsentRevision > 10000 || !DIGEST.test(String(body.expectedConsentDigest || '')) ||
      !cursor(body.cursorBefore) || !cursor(body.cursorAfter) || typeof body.complete !== 'boolean' || !Array.isArray(body.records) ||
      body.records.length < 1 || body.records.length > 100 || body.confirmed !== true ||
      body.confirmationVersion !== 'm25-external-travel-import-batch-v1' || !text(body.reason, 2000)) fail('External travel import batch is invalid.');
  if ((body.mode === 'continuous_update' && (body.complete || body.cursorAfter === null)) ||
      (body.mode === 'historical_backfill' && ((body.complete && body.cursorAfter !== null) || (!body.complete && body.cursorAfter === null)))) fail('External travel import cursor is invalid.');
  const records = body.records.map(normalizeRecord);
  if (new Set(records.map(record => record.externalRecordId)).size !== records.length) fail('An external travel record appears more than once in this batch.');
  return Object.freeze({ sourceKey: normalized, ...body, records });
}

module.exports = { normalizeSourceKey: sourceKey, normalizeConsent, normalizeBatch, normalizeRecord };
