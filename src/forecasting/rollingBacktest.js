'use strict';

// A bounded, unmounted comparison contract. The future owning readers must
// authenticate saved runs and actual receipts before supplying either array.
const { normalizeForecastOutput } = require('./outputContract');
const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-rolling-backtest-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SOURCE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/;
const REASON = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_RUNS = 100;
// These targets need no dimension/cohort identity beyond output v1's declared
// tenant, target, horizon, service, area, unit and currency. Their actual
// readers do not exist yet; inclusion here confers no source authorization.
const UNSCOPED_TARGETS = new Set([
  'demand.inbound_leads', 'workload.accepted_person_hours',
  'workload.end_backlog_hours', 'revenue.approved_price_flow',
  'revenue.booked_work_value', 'revenue.earned_value',
  'revenue.collected_cash', 'cost.accepted_labor',
  'cost.accepted_material', 'cost.accepted_asset_travel',
  'cost.accepted_overhead', 'profit.operating_margin',
]);

function invalid() {
  const error = new Error('Rolling backtest comparison details are invalid.');
  error.code = 'M26_BACKTEST_COMPARISON_INVALID';
  error.status = 400;
  throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key =>
    typeof key === 'string' && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key).enumerable &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function dense(values) {
  if (!Array.isArray(values) || values.length > MAX_RUNS ||
      Reflect.ownKeys(values).length !== values.length + 1) return false;
  return values.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    return descriptor && descriptor.enumerable &&
      Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function sourceInstant(value) {
  return typeof value === 'string' && SOURCE_INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === `${value.slice(0, 23)}Z`;
}

function instantKey(value) {
  return value.replace(/\.(\d{3})(\d{3})?Z$/, (_, millis, micros) =>
    `.${millis}${micros || '000'}Z`);
}

function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function reason(value) { return typeof value === 'string' && value.length <= 80 && REASON.test(value); }

function amount(value, unit) {
  if (typeof value !== 'string' || !DECIMAL.test(value) ||
      /^-0(?:\.0+)?$/.test(value)) return false;
  if (unit.key !== 'money' && value.startsWith('-')) return false;
  if (unit.key === 'count' && value.includes('.')) return false;
  if (unit.key === 'ratio' && Number(value) > 1) return false;
  return true;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeRun(input) {
  if (!exact(input, ['id', 'savedAt', 'outputDigest', 'sourceSnapshotAsOf',
    'latestSourceRecordedAt', 'output']) ||
      !uuid(input.id) || !instant(input.savedAt) || !digest(input.outputDigest) ||
      !(input.sourceSnapshotAsOf === null || sourceInstant(input.sourceSnapshotAsOf)) ||
      !(input.latestSourceRecordedAt === null || sourceInstant(input.latestSourceRecordedAt))) invalid();
  let output;
  try { output = normalizeForecastOutput(input.output); }
  catch (_error) { invalid(); }
  if (output.target.definitionVersion !== 'v1' ||
      !UNSCOPED_TARGETS.has(output.target.key) ||
      output.asOf > input.savedAt || input.savedAt > output.horizon.startsAt ||
      (output.sourceSnapshotDigest === null ?
        input.sourceSnapshotAsOf !== null || input.latestSourceRecordedAt !== null :
        input.sourceSnapshotAsOf === null ||
        instantKey(input.sourceSnapshotAsOf) > instantKey(output.asOf) ||
        (input.latestSourceRecordedAt !== null &&
          instantKey(input.latestSourceRecordedAt) > instantKey(input.sourceSnapshotAsOf))) ||
      sha256(output) !== input.outputDigest) invalid();
  return freeze({ id: input.id.toLowerCase(), savedAt: input.savedAt,
    outputDigest: input.outputDigest, sourceSnapshotAsOf: input.sourceSnapshotAsOf,
    latestSourceRecordedAt: input.latestSourceRecordedAt, output });
}

function normalizeOutcome(input, run) {
  if (!exact(input, ['id', 'forecastRunId', 'organizationId', 'target',
    'horizon', 'unit', 'applicability', 'observedThrough', 'capturedAt',
    'sourceDigest', 'state', 'amount', 'reason']) ||
    !uuid(input.id) || !uuid(input.forecastRunId) || !uuid(input.organizationId) ||
    !instant(input.capturedAt) ||
    !(input.observedThrough === null || instant(input.observedThrough)) ||
    !(input.sourceDigest === null || digest(input.sourceDigest)) ||
    !['known', 'missing', 'stale', 'conflicting', 'revoked', 'pending'].includes(input.state) ||
    input.forecastRunId.toLowerCase() !== run.id ||
    input.organizationId.toLowerCase() !== run.output.organizationId ||
    !exact(input.target, ['key', 'definitionVersion']) ||
    input.target.key !== run.output.target.key ||
    input.target.definitionVersion !== run.output.target.definitionVersion ||
    !exact(input.horizon, ['startsAt', 'endsAt', 'grain']) ||
    !exact(input.unit, ['key', 'currency']) ||
    !exact(input.applicability, ['serviceKey', 'areaKey', 'limits']) ||
    input.horizon.startsAt !== run.output.horizon.startsAt ||
    input.horizon.endsAt !== run.output.horizon.endsAt ||
    input.horizon.grain !== run.output.horizon.grain ||
    input.unit.key !== run.output.unit.key ||
    input.unit.currency !== run.output.unit.currency ||
    input.applicability.serviceKey !== run.output.applicability.serviceKey ||
    input.applicability.areaKey !== run.output.applicability.areaKey ||
    !Array.isArray(input.applicability.limits) ||
    Reflect.ownKeys(input.applicability.limits).length !==
      input.applicability.limits.length + 1 ||
    input.applicability.limits.length !== run.output.applicability.limits.length ||
    !input.applicability.limits.every((limit, index) =>
      Object.prototype.hasOwnProperty.call(input.applicability.limits, index) &&
      Object.prototype.hasOwnProperty.call(
        Object.getOwnPropertyDescriptor(input.applicability.limits, index), 'value') &&
      limit === run.output.applicability.limits[index])) invalid();
  if (input.state === 'known') {
    if (!amount(input.amount, run.output.unit) || input.reason !== null ||
        !digest(input.sourceDigest) || input.observedThrough === null ||
        input.observedThrough < run.output.horizon.endsAt ||
        input.capturedAt < input.observedThrough) invalid();
  } else if (input.amount !== null || !reason(input.reason) ||
      (input.observedThrough !== null && input.capturedAt < input.observedThrough)) invalid();
  return freeze({
    id: input.id.toLowerCase(), forecastRunId: run.id,
    organizationId: run.output.organizationId,
    target: { ...run.output.target }, horizon: { ...run.output.horizon },
    unit: { ...run.output.unit }, applicability: { ...run.output.applicability },
    observedThrough: input.observedThrough, capturedAt: input.capturedAt,
    sourceDigest: input.sourceDigest, state: input.state,
    amount: input.amount, reason: input.reason,
  });
}

function buildRollingBacktest(input) {
  if (!exact(input, ['version', 'runs', 'outcomes']) ||
      input.version !== VERSION || !dense(input.runs) || !dense(input.outcomes) ||
      input.runs.length === 0) invalid();
  const runs = input.runs.map(normalizeRun);
  const byId = new Map();
  for (const run of runs) {
    if (byId.has(run.id)) invalid();
    byId.set(run.id, run);
  }
  const first = runs[0].output;
  if (runs.some(run => run.output.organizationId !== first.organizationId ||
      run.output.target.key !== first.target.key ||
      run.output.target.definitionVersion !== first.target.definitionVersion ||
      sha256(run.output.unit) !== sha256(first.unit) ||
      sha256(run.output.applicability) !== sha256(first.applicability))) invalid();
  const outcomes = new Map();
  const outcomeIds = new Set();
  for (const raw of input.outcomes) {
    const runId = raw && typeof raw === 'object' &&
      Object.getOwnPropertyDescriptor(raw, 'forecastRunId');
    if (!runId || !Object.prototype.hasOwnProperty.call(runId, 'value') ||
        !uuid(runId.value)) invalid();
    const run = byId.get(runId.value.toLowerCase());
    if (!run) invalid();
    const outcome = normalizeOutcome(raw, run);
    if (outcomes.has(run.id) || outcomeIds.has(outcome.id)) invalid();
    outcomes.set(run.id, outcome);
    outcomeIds.add(outcome.id);
  }
  runs.sort((left, right) => left.output.asOf.localeCompare(right.output.asOf) ||
    left.id.localeCompare(right.id));
  const comparisons = runs.map(run => {
    const outcome = outcomes.get(run.id) || null;
    const status = run.output.value.kind === 'unavailable' ? 'forecast_unavailable' :
      outcome === null ? 'outcome_unavailable' :
        outcome.state === 'known' ? 'paired' : 'outcome_unavailable';
    const comparison = {
      forecastRunId: run.id, forecastOutputDigest: run.outputDigest,
      predictionAsOf: run.output.asOf, savedAt: run.savedAt,
      sourceSnapshotAsOf: run.sourceSnapshotAsOf,
      latestSourceRecordedAt: run.latestSourceRecordedAt,
      horizon: { ...run.output.horizon },
      forecastValue: { ...run.output.value },
      outcomeReceiptId: outcome?.id || null,
      outcomeSourceDigest: outcome?.sourceDigest || null,
      outcomeCutoff: outcome?.observedThrough || null,
      outcomeAmount: status === 'paired' ? outcome.amount : null,
      status,
      reason: status === 'paired' ? null :
        status === 'forecast_unavailable' ? run.output.value.reason :
          outcome?.reason || 'outcome_not_supplied',
    };
    return freeze({ ...comparison, digest: sha256(comparison) });
  });
  const result = {
    version: VERSION,
    organizationId: first.organizationId,
    target: { ...first.target }, unit: { ...first.unit },
    applicability: { ...first.applicability },
    originCount: new Set(runs.map(run => run.output.asOf)).size,
    comparisons,
  };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, buildRollingBacktest };
