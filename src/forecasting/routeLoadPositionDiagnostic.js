'use strict';

// Unmounted Part 8C diagnostic. M24 remains the trip/haul calculation authority.
const travel = require('../estimating/travelCalculation');
const VERSION = 'm26-route-load-position-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_RECORDS = 100, MAX_SCALED_DISTANCE = 999999999999999999n;
function invalid() {
  const error = new Error('Route load position details are invalid.');
  error.code = 'M26_ROUTE_LOAD_POSITION_INVALID';
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
function dense(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function id(value) { return typeof value === 'string' && UUID.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function copy(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 5000 || depth > 18) invalid();
  if (value === null || typeof value === 'boolean' ||
      typeof value === 'number' && Number.isFinite(value) ||
      typeof value === 'string' && value.length <= 3000) return value;
  if (Array.isArray(value)) {
    if (!dense(value, 50)) invalid();
    return Array.from({ length: value.length }, (_, i) =>
      copy(Object.getOwnPropertyDescriptor(value, i).value, budget, depth + 1));
  }
  if (!value || typeof value !== 'object' ||
      Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length > 40) invalid();
  const result = {};
  for (const key of own) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    Object.defineProperty(result, key, { enumerable: true, configurable: true,
      writable: true, value: copy(descriptor.value, budget, depth + 1) });
  }
  return result;
}
function quantity(value) {
  const whole = value / 1000000n;
  const fraction = String(value % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return String(whole) + (fraction ? '.' + fraction : '');
}
function summarizeRouteLoadPosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon',
    'sourceSnapshotDigest', 'coverage', 'records']) || input.version !== VERSION ||
    !id(input.organizationId) || !instant(input.asOf) ||
    !exact(input.horizon, ['startsAt', 'endsAt']) ||
    !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
    input.horizon.startsAt < input.asOf ||
    input.horizon.endsAt <= input.horizon.startsAt ||
    Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > 366 * 86400000 ||
    !digest(input.sourceSnapshotDigest) ||
    !exact(input.coverage, ['state', 'hasMore']) ||
    !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
    typeof input.coverage.hasMore !== 'boolean' || !dense(input.records, MAX_RECORDS)) invalid();
  const seen = new Set(), distance = { mi: 0n, km: 0n };
  let tripLegs = 0, vehicleLegs = 0, unresolved = false;
  for (const record of input.records) {
    if (!exact(record, ['estimateId', 'organizationId', 'revision', 'digest',
      'recordedAt', 'plannedStartsAt', 'plannedEndsAt', 'currency', 'inputs']) ||
      !id(record.estimateId) || typeof record.organizationId !== 'string' ||
      record.organizationId !== input.organizationId ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 ||
      !digest(record.digest) || !instant(record.recordedAt) ||
      record.recordedAt > input.asOf ||
      !instant(record.plannedStartsAt) || !instant(record.plannedEndsAt) ||
      record.plannedStartsAt >= record.plannedEndsAt ||
      !['USD', 'CAD', 'EUR'].includes(record.currency)) invalid();
    if (seen.has(record.estimateId.toLowerCase())) invalid();
    seen.add(record.estimateId.toLowerCase());
    if (record.plannedStartsAt < input.horizon.startsAt ||
        record.plannedEndsAt > input.horizon.endsAt) unresolved = true;
    const inputs = copy(record.inputs);
    let result;
    try { result = travel.calculate(inputs, record.currency); }
    catch (_) { invalid(); }
    if (!Array.isArray(result.trips) || result.trips.length !== inputs.trips.length) invalid();
    for (let i = 0; i < result.trips.length; i += 1) {
      const line = inputs.trips[i], calculated = result.trips[i];
      if (!Number.isSafeInteger(calculated.tripLegs) ||
          !Number.isSafeInteger(calculated.vehicleLegs) ||
          calculated.tripLegs < 1 || calculated.vehicleLegs < 1) invalid();
      tripLegs += calculated.tripLegs;
      vehicleLegs += calculated.vehicleLegs;
      if (!Number.isSafeInteger(tripLegs) || !Number.isSafeInteger(vehicleLegs)) invalid();
      if (line.distance.basis === 'straight_line' || line.distance.value === null) {
        unresolved = true;
        continue;
      }
      const measured = travel.qty(line.distance.value);
      if (measured === null || measured < 0n) invalid();
      distance[line.distance.unit] += measured * BigInt(calculated.vehicleLegs);
      if (distance.mi > MAX_SCALED_DISTANCE ||
          distance.km > MAX_SCALED_DISTANCE) invalid();
    }
  }
  if (input.coverage.state !== 'complete' || input.coverage.hasMore) unresolved = true;
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: unresolved ? 'unavailable' : 'deterministic_claimed_plan_only',
    reason: unresolved ? 'incomplete_or_unmeasured_route_coverage' : null,
    tripLegs: unresolved ? null : tripLegs,
    vehicleLegs: unresolved ? null : vehicleLegs,
    declaredVehicleMiles: unresolved ? null : quantity(distance.mi),
    declaredVehicleKilometres: unresolved ? null : quantity(distance.km),
    sourceAuthenticated: false, adoptedPlanVerified: false,
    roadAndOnsiteSeparated: false, routeCapacityVerified: false,
    fuelOrEnergyForecast: null, logisticsCapacityForecast: null,
    forecastIssued: false });
}
module.exports = { VERSION, MAX_RECORDS, summarizeRouteLoadPosition };
