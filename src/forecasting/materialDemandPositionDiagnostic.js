'use strict';

// An unmounted, caller-supplied Part 8A quantity projection. It has no stock ledger.
const material = require('../estimating/materialPlanContract');
const VERSION = 'm26-material-demand-position-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const QUANTITY = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
const MAX_ROWS = 200;
const MAX_TOTAL = 999999999999999999n;
function invalid() {
  const error = new Error('Material demand position details are invalid.');
  error.code = 'M26_MATERIAL_DEMAND_POSITION_INVALID';
  throw error;
}
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
      Reflect.ownKeys(value).length !== value.length + 1 ||
      value.length > MAX_ROWS) return false;
  return value.every((_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function instant(value) { return typeof value === 'string' && INSTANT.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function label(value) { return typeof value === 'string' && value.length > 0 &&
  value.length <= 160 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
function units(value) {
  if (typeof value !== 'string' || !QUANTITY.test(value)) invalid();
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (!result) invalid();
  return result;
}
function quantity(value) {
  const whole = value / 1000000n;
  const fraction = String(value % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return String(whole) + (fraction ? `.${fraction}` : '');
}
function summarizeMaterialDemandPosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon',
    'sourceSnapshotDigest', 'coverage', 'rows']) || input.version !== VERSION ||
    typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
    !instant(input.asOf) ||
    !exact(input.horizon, ['startsAt', 'endsAt']) ||
    !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
    input.horizon.startsAt < input.asOf || input.horizon.endsAt <= input.horizon.startsAt ||
    Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > 366 * 86400000 ||
    typeof input.sourceSnapshotDigest !== 'string' ||
    !DIGEST.test(input.sourceSnapshotDigest) ||
    !exact(input.coverage, ['state', 'hasMore']) ||
    !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
    typeof input.coverage.hasMore !== 'boolean' || !dense(input.rows)) invalid();

  const seen = new Set(), estimateVersions = new Map(), grouped = new Map();
  for (const row of input.rows) {
    if (!exact(row, ['estimateId', 'revision', 'digest', 'lineId', 'organizationId',
      'recordedAt', 'requiredAt', 'materialSpecification', 'procurementLocation',
      'unit', 'plannedQuantity']) || typeof row.estimateId !== 'string' ||
      !UUID.test(row.estimateId) || typeof row.lineId !== 'string' ||
      !UUID.test(row.lineId) || typeof row.organizationId !== 'string' ||
      row.organizationId !== input.organizationId ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      typeof row.digest !== 'string' || !DIGEST.test(row.digest) ||
      !instant(row.recordedAt) ||
      row.recordedAt > input.asOf || !instant(row.requiredAt) ||
      !label(row.materialSpecification) || !label(row.procurementLocation) ||
      !label(row.unit) || !Object.hasOwn(material.UNITS, row.unit)) invalid();
    const amount = units(row.plannedQuantity);
    if (row.unit === 'ea' && amount % 1000000n !== 0n) invalid();
    const identity = JSON.stringify([row.estimateId.toLowerCase(), row.lineId.toLowerCase()]);
    if (seen.has(identity)) invalid();
    seen.add(identity);
    const estimate = row.estimateId.toLowerCase();
    const revisionPin = JSON.stringify([row.revision, row.digest]);
    if (estimateVersions.has(estimate) && estimateVersions.get(estimate) !== revisionPin) invalid();
    estimateVersions.set(estimate, revisionPin);
    // Never combine different units, dates, locations, or specifications.
    const key = JSON.stringify([row.materialSpecification, row.procurementLocation,
      row.unit, row.requiredAt]);
    const total = (grouped.get(key) || 0n) + amount;
    if (total > MAX_TOTAL) invalid();
    grouped.set(key, total);
  }
  const unavailable = input.coverage.state !== 'complete' || input.coverage.hasMore ||
    input.rows.some(row => row.requiredAt < input.horizon.startsAt ||
      row.requiredAt >= input.horizon.endsAt);
  const requirements = unavailable ? null : Array.from(grouped, ([key, amount]) => {
    const [materialSpecification, procurementLocation, unit, requiredAt] = JSON.parse(key);
    return Object.freeze({ materialSpecification, procurementLocation, unit,
      requiredAt, plannedQuantity: quantity(amount) });
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: unavailable ? 'unavailable' : 'deterministic_claimed_plan_only',
    reason: unavailable ? 'incomplete_or_out_of_window_coverage' : null,
    requirements: requirements === null ? null : Object.freeze(requirements),
    sourceAuthenticated: false, approvedPlanVerified: false,
    inventoryVerified: false, receiptsVerified: false,
    reorderDate: null, stockoutRisk: null, purchasingRisk: null,
    forecastIssued: false });
}
module.exports = { VERSION, MAX_ROWS, summarizeMaterialDemandPosition };
