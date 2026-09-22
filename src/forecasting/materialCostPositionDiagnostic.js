'use strict';

// Pure Part 7B prerequisite. M24 owns the quantity/waste/price arithmetic;
// the caller's historical coverage and plan pins are not authenticated here.
const material = require('../estimating/materialPlanContract');
const source = require('../estimating/materialSourceContract');
const availability = require('../estimating/materialAvailabilityContract');
const VERSION = 'm26-material-cost-position-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_PLANS = 100, MAX_CENTS = 99999999999999n;
function invalid() { const error = new Error('Material cost position details are invalid.');
  error.code = 'M26_MATERIAL_COST_POSITION_INVALID'; throw error; }
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
      value.length > MAX_PLANS || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function instant(value) { return typeof value === 'string' && INSTANT.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function plainCopy(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 3000 || depth > 10) invalid();
  if (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 3000)) return value;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 20 ||
        Reflect.ownKeys(value).length !== value.length + 1) invalid();
    return Array.from({ length: value.length }, (_, index) => {
      const property = Object.getOwnPropertyDescriptor(value, index);
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) invalid();
      return plainCopy(property.value, budget, depth + 1);
    });
  }
  if (!value || typeof value !== 'object' ||
      Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const result = {}, keys = Reflect.ownKeys(value);
  if (keys.length > 30) invalid();
  for (const key of keys) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) invalid();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) invalid();
    Object.defineProperty(result, key, { enumerable: true, configurable: true,
      writable: true, value: plainCopy(property.value, budget, depth + 1) });
  }
  return result;
}
function cents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value)) invalid();
  return BigInt(value.replace('.', ''));
}
function money(value) { return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }
function position(input, reason, amount, count) {
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    currency: input.currency, sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: reason === null ? 'deterministic_plan_only' : 'unavailable', reason,
    plannedMaterialLineCost: reason === null ? money(amount) : null,
    planCount: reason === null ? count : null, deliveryFeesIncluded: false,
    taxTreatmentVerified: false, inventoryVerified: false,
    supplierAvailabilityVerified: false, sourceAuthenticated: false,
    learnedWasteApplied: false, forecastIssued: false });
}
function summarizeMaterialCostPosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon', 'currency',
    'sourceSnapshotDigest', 'coverage', 'plans']) || input.version !== VERSION ||
      typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
      !instant(input.asOf) || !exact(input.horizon, ['startsAt', 'endsAt']) ||
      !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
      input.horizon.startsAt < input.asOf || input.horizon.startsAt >= input.horizon.endsAt ||
      Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > 366 * 86400000 ||
      !['USD', 'CAD', 'EUR'].includes(input.currency) ||
      typeof input.sourceSnapshotDigest !== 'string' || !DIGEST.test(input.sourceSnapshotDigest) ||
      !exact(input.coverage, ['state', 'hasMore']) ||
      !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
      typeof input.coverage.hasMore !== 'boolean' || !dense(input.plans)) invalid();

  const ids = new Set(); let total = 0n, unresolved = null;
  for (const plan of input.plans) {
    if (!exact(plan, ['estimateId', 'organizationId', 'revision', 'digest',
      'recordedAt', 'currency', 'calculationVersion', 'serviceKey',
      'plannedStartsAt', 'plannedEndsAt', 'inputs']) ||
        typeof plan.estimateId !== 'string' || !UUID.test(plan.estimateId) ||
        ids.has(plan.estimateId) || plan.organizationId !== input.organizationId ||
        plan.currency !== input.currency ||
        !Number.isSafeInteger(plan.revision) || plan.revision < 1 ||
        typeof plan.digest !== 'string' || !DIGEST.test(plan.digest) ||
        !instant(plan.recordedAt) || plan.recordedAt > input.asOf ||
        ![material.V3, material.V4].includes(plan.calculationVersion) ||
        typeof plan.serviceKey !== 'string' || plan.serviceKey.length < 1 ||
        plan.serviceKey.length > 160 ||
        !(plan.plannedStartsAt === null || instant(plan.plannedStartsAt)) ||
        !(plan.plannedEndsAt === null || instant(plan.plannedEndsAt)) ||
        (plan.plannedStartsAt !== null && plan.plannedEndsAt !== null &&
          plan.plannedStartsAt >= plan.plannedEndsAt)) invalid();
    ids.add(plan.estimateId);
    if (plan.plannedStartsAt === null || plan.plannedEndsAt === null ||
        plan.plannedStartsAt < input.horizon.startsAt ||
        plan.plannedEndsAt > input.horizon.endsAt) unresolved ||= 'unresolved_work_window';

    const safeInputs = plainCopy(plan.inputs);
    let calculated, assessed, supply;
    try {
      calculated = material.calculate(safeInputs, input.currency, plan.calculationVersion);
      assessed = source.assess(safeInputs, input.currency,
        { now: new Date(input.asOf), serviceKey: plan.serviceKey });
      if (plan.calculationVersion === material.V4) supply = availability.assess(
        safeInputs, calculated, { now: new Date(input.asOf) });
    } catch (error) { invalid(); }
    const lastDay = plan.plannedEndsAt === null ? null :
      new Date(Date.parse(plan.plannedEndsAt) - 1).toISOString().slice(0, 10);
    for (let index = 0; index < safeInputs.lines.length; index += 1) {
      const line = safeInputs.lines[index], evidence = line.evidence;
      const flags = assessed.lines[index].flags;
      if ((line.priceDate !== null && line.priceDate > input.asOf.slice(0, 10)) ||
          flags.length || evidence.effectiveOn > plan.plannedStartsAt?.slice(0, 10) ||
          (lastDay !== null && evidence.validThrough < lastDay)) {
        unresolved ||= 'unverified_material_price';
      }
      if (supply) {
        const row = supply.lines[index], available = safeInputs.lines[index].availability;
        if (row.currentStatus !== 'reported_sufficient' ||
            available.observedOn > plan.plannedStartsAt?.slice(0, 10) ||
            (lastDay !== null && available.validThrough < lastDay)) {
          unresolved ||= 'unverified_material_availability';
        }
      }
    }
    total += cents(calculated.total);
    if (total > MAX_CENTS) invalid();
  }
  if (input.coverage.state !== 'complete' || input.coverage.hasMore) {
    return position(input, 'incomplete_source_coverage', null, null);
  }
  if (unresolved) return position(input, unresolved, null, null);
  return position(input, null, total, input.plans.length);
}
module.exports = { VERSION, MAX_PLANS, summarizeMaterialCostPosition };
