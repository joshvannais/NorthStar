'use strict';

// Bounded Part 7A prerequisite. Reuses the sealed M24 labor arithmetic; a
// source-owned as-of reader must authenticate all pins before forecast use.
const labor = require('../estimating/laborPlanContract');
const VERSION = 'm26-labor-cost-position-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_PLANS = 100;
const MAX_TOTAL_CENTS = 99999999999999n;

function invalid() {
  const error = new Error('Labor cost position details are invalid.');
  error.code = 'M26_LABOR_COST_POSITION_INVALID';
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
      value.length > MAX_PLANS || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function moneyCents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value)) invalid();
  return BigInt(value.replace('.', ''));
}
function money(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
function plainCopy(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 1000 || depth > 8) invalid();
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
  const result = {};
  const keys = Reflect.ownKeys(value);
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
function unavailable(input, reason) {
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    currency: input.currency, sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: 'unavailable', reason, plannedLaborCost: null, planCount: null,
    sourceAuthenticated: false, capacityVerified: false,
    learnedRateApplied: false, forecastIssued: false });
}
function summarizeLaborCostPosition(input) {
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

  const seen = new Set();
  let total = 0n, unresolved = null;
  for (const plan of input.plans) {
    if (!exact(plan, ['estimateId', 'organizationId', 'revision', 'digest',
      'recordedAt', 'currency', 'plannedStartsAt', 'plannedEndsAt', 'inputs']) ||
        typeof plan.estimateId !== 'string' || !UUID.test(plan.estimateId) ||
        seen.has(plan.estimateId) || plan.organizationId !== input.organizationId ||
        plan.currency !== input.currency ||
        !Number.isSafeInteger(plan.revision) || plan.revision < 1 ||
        typeof plan.digest !== 'string' || !DIGEST.test(plan.digest) ||
        !instant(plan.recordedAt) || plan.recordedAt > input.asOf ||
        !(plan.plannedStartsAt === null || instant(plan.plannedStartsAt)) ||
        !(plan.plannedEndsAt === null || instant(plan.plannedEndsAt)) ||
        (plan.plannedStartsAt !== null && plan.plannedEndsAt !== null &&
          plan.plannedStartsAt >= plan.plannedEndsAt)) invalid();
    seen.add(plan.estimateId);
    // Do not assign a whole-job cost to a calendar period from an unknown or
    // cross-period schedule. A future allocation policy must own that split.
    if (plan.plannedStartsAt === null || plan.plannedEndsAt === null ||
        plan.plannedStartsAt < input.horizon.startsAt ||
        plan.plannedEndsAt > input.horizon.endsAt) unresolved ||= 'unresolved_work_window';
    const safeInputs = plainCopy(plan.inputs);
    let calculated;
    try { calculated = labor.calculate(safeInputs, input.currency); }
    catch (error) { invalid(); }
    if (!calculated.complete) unresolved ||= 'missing_labor_rate_or_burden';
    // An expired, not-yet-effective or undated cost source is not a current
    // quote. The original M24 provenance remains on the pinned plan.
    for (const line of safeInputs.lines) {
      const source = line.rateSource;
      const lastServiceDate = plan.plannedEndsAt === null ? null :
        new Date(Date.parse(plan.plannedEndsAt) - 1).toISOString().slice(0, 10);
      if (!source.effectiveOn || !source.endsOn || !source.geography.trim() ||
          (plan.plannedStartsAt !== null && source.effectiveOn > plan.plannedStartsAt.slice(0, 10)) ||
          (lastServiceDate !== null && source.endsOn < lastServiceDate)) {
        unresolved ||= 'unverified_rate_applicability';
      }
    }
    if (calculated.total !== null) total += moneyCents(calculated.total);
    if (total > MAX_TOTAL_CENTS) invalid();
  }
  if (input.coverage.state !== 'complete' || input.coverage.hasMore) {
    return unavailable(input, 'incomplete_source_coverage');
  }
  if (unresolved) return unavailable(input, unresolved);
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    currency: input.currency, sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: 'deterministic_plan_only', reason: null, plannedLaborCost: money(total),
    planCount: input.plans.length, sourceAuthenticated: false,
    capacityVerified: false, learnedRateApplied: false, forecastIssued: false });
}

module.exports = { VERSION, MAX_PLANS, summarizeLaborCostPosition };
