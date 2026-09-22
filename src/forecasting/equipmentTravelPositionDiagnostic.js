'use strict';

// Bounded Part 7C inspection of claimed M24 v3 cost-composition results.
// It does not recalculate equipment/travel plans or authenticate their source.
const VERSION = 'm26-equipment-travel-position-v1';
const COMPOSITION_VERSION = 'estimate-cost-adoption-v3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MONEY = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
const MAX_RECORDS = 100, MAX_CENTS = 99999999999999n;
function invalid() { const error = new Error('Equipment and travel position details are invalid.');
  error.code = 'M26_EQUIPMENT_TRAVEL_POSITION_INVALID'; throw error; }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function dense(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MAX_RECORDS || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function instant(value) { return typeof value === 'string' && INSTANT.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function cents(value) { if (typeof value !== 'string' || !MONEY.test(value)) invalid();
  return BigInt(value.replace('.', '')); }
function money(value) { return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }
function output(input, reason, totals, count) {
  const ready = reason === null;
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    currency: input.currency, sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: ready ? 'deterministic_composition_only' : 'unavailable', reason,
    equipmentCost: ready ? money(totals.equipment) : null,
    grossTravelCost: ready ? money(totals.grossTravel) : null,
    travelOverlapDeduction: ready ? money(totals.deduction) : null,
    netTravelCost: ready ? money(totals.netTravel) : null,
    equipmentAndNetTravelCost: ready ? money(totals.equipment + totals.netTravel) : null,
    recordCount: ready ? count : null, sourceAuthenticated: false,
    categoryBreakdownVerified: false, laborOverlapAcrossForecastsVerified: false,
    transportAndOnsiteUseSeparated: false, forecastIssued: false });
}
function summarizeEquipmentTravelPosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon', 'currency',
    'sourceSnapshotDigest', 'coverage', 'records']) || input.version !== VERSION ||
      typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
      !instant(input.asOf) || !exact(input.horizon, ['startsAt', 'endsAt']) ||
      !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
      input.horizon.startsAt < input.asOf || input.horizon.startsAt >= input.horizon.endsAt ||
      Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > 366 * 86400000 ||
      !['USD', 'CAD', 'EUR'].includes(input.currency) ||
      typeof input.sourceSnapshotDigest !== 'string' || !DIGEST.test(input.sourceSnapshotDigest) ||
      !exact(input.coverage, ['state', 'hasMore']) ||
      !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
      typeof input.coverage.hasMore !== 'boolean' || !dense(input.records)) invalid();

  const seen = new Set();
  const total = { equipment: 0n, grossTravel: 0n, deduction: 0n, netTravel: 0n };
  let unresolved = null;
  for (const record of input.records) {
    if (!exact(record, ['estimateId', 'organizationId', 'revision', 'digest',
      'recordedAt', 'currency', 'compositionVersion', 'coverageDigest',
      'plannedStartsAt', 'plannedEndsAt', 'equipmentCost', 'grossTravelCost',
      'travelOverlapDeduction', 'netTravelCost', 'directCost']) ||
        typeof record.estimateId !== 'string' || !UUID.test(record.estimateId) ||
        seen.has(record.estimateId) || record.organizationId !== input.organizationId ||
        record.currency !== input.currency || record.compositionVersion !== COMPOSITION_VERSION ||
        !Number.isSafeInteger(record.revision) || record.revision < 1 ||
        typeof record.digest !== 'string' || !DIGEST.test(record.digest) ||
        typeof record.coverageDigest !== 'string' || !DIGEST.test(record.coverageDigest) ||
        !instant(record.recordedAt) || record.recordedAt > input.asOf ||
        !(record.plannedStartsAt === null || instant(record.plannedStartsAt)) ||
        !(record.plannedEndsAt === null || instant(record.plannedEndsAt)) ||
        (record.plannedStartsAt !== null && record.plannedEndsAt !== null &&
          record.plannedStartsAt >= record.plannedEndsAt)) invalid();
    seen.add(record.estimateId);
    if (record.plannedStartsAt === null || record.plannedEndsAt === null ||
        record.plannedStartsAt < input.horizon.startsAt ||
        record.plannedEndsAt > input.horizon.endsAt) unresolved ||= 'unresolved_work_window';
    const fields = ['equipmentCost', 'grossTravelCost', 'travelOverlapDeduction',
      'netTravelCost', 'directCost'];
    if (fields.some(key => record[key] === null)) { unresolved ||= 'incomplete_cost_composition'; continue; }
    const equipment = cents(record.equipmentCost), gross = cents(record.grossTravelCost),
      deduction = cents(record.travelOverlapDeduction), net = cents(record.netTravelCost),
      direct = cents(record.directCost);
    if (deduction > gross || gross - deduction !== net ||
        equipment + net > direct) invalid();
    total.equipment += equipment; total.grossTravel += gross;
    total.deduction += deduction; total.netTravel += net;
    if (Object.values(total).some(value => value > MAX_CENTS) ||
        total.equipment + total.netTravel > MAX_CENTS) invalid();
  }
  if (input.coverage.state !== 'complete' || input.coverage.hasMore) {
    return output(input, 'incomplete_source_coverage', null, null);
  }
  if (unresolved) return output(input, unresolved, null, null);
  return output(input, null, total, input.records.length);
}
module.exports = { VERSION, COMPOSITION_VERSION, MAX_RECORDS,
  summarizeEquipmentTravelPosition };
