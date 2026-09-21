'use strict';

// A shape boundary only. Source authorization, target/unit registration,
// snapshot creation and calibration are owned by later Mission 26 slices.
const VERSION = 'm26-forecast-output-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GRAINS = new Set(['hour', 'day', 'week', 'month', 'quarter', 'year']);

function invalid() {
  const error = new Error('Forecast output details are invalid.');
  error.code = 'M26_FORECAST_OUTPUT_INVALID';
  error.status = 400;
  throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length &&
    own.every(key => typeof key === 'string' && keys.includes(key) &&
      Object.getOwnPropertyDescriptor(value, key).enumerable &&
      Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function token(value) {
  return typeof value === 'string' && value.length <= 80 && TOKEN.test(value);
}

function instant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function decimal(value) {
  return typeof value === 'string' && DECIMAL.test(value) && !/^-0(?:\.0+)?$/.test(value);
}

function scaled(value) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fractional = ''] = unsigned.split('.');
  const result = BigInt(whole) * 1000000n + BigInt(fractional.padEnd(6, '0') || '0');
  return negative ? -result : result;
}

function boundedCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000000000;
}

function codeList(values) {
  return Array.isArray(values) && values.length <= 12 &&
    values.every(token) && new Set(values).size === values.length;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeForecastOutput(input) {
  if (!exact(input, ['contractVersion', 'organizationId', 'asOf', 'horizon',
    'target', 'unit', 'value', 'confidence', 'uncertainty', 'evidenceCoverage',
    'applicability', 'calculationVersion', 'sourceSnapshotDigest']) ||
    input.contractVersion !== VERSION || typeof input.organizationId !== 'string' ||
    !UUID.test(input.organizationId) ||
    !instant(input.asOf) || !token(input.calculationVersion) ||
    !(input.sourceSnapshotDigest === null ||
      (typeof input.sourceSnapshotDigest === 'string' && DIGEST.test(input.sourceSnapshotDigest)))) invalid();

  const horizon = input.horizon;
  if (!exact(horizon, ['startsAt', 'endsAt', 'grain']) ||
    !instant(horizon.startsAt) || !instant(horizon.endsAt) ||
    !GRAINS.has(horizon.grain) || horizon.startsAt >= horizon.endsAt ||
    input.asOf >= horizon.endsAt) invalid();

  const target = input.target;
  if (!exact(target, ['key', 'definitionVersion']) ||
    !token(target.key) || !token(target.definitionVersion)) invalid();

  const unit = input.unit;
  if (!exact(unit, ['key', 'currency']) || !token(unit.key) ||
    (unit.key === 'money' ?
      !(typeof unit.currency === 'string' && /^[A-Z]{3}$/.test(unit.currency)) :
      unit.currency !== null)) invalid();

  const coverage = input.evidenceCoverage;
  if (!exact(coverage, ['included', 'excluded', 'missing', 'stale', 'conflicting']) ||
    !Object.values(coverage).every(boundedCount)) invalid();

  const applicability = input.applicability;
  if (!exact(applicability, ['serviceKey', 'areaKey', 'limits']) ||
    !(applicability.serviceKey === null || token(applicability.serviceKey)) ||
    !(applicability.areaKey === null || token(applicability.areaKey)) ||
    !codeList(applicability.limits)) invalid();

  const confidence = input.confidence;
  if (!exact(confidence, ['state', 'backtestDigest']) ||
    !['unavailable', 'calibrated'].includes(confidence.state) ||
    (confidence.state === 'unavailable' ? confidence.backtestDigest !== null :
      !(typeof confidence.backtestDigest === 'string' &&
        DIGEST.test(confidence.backtestDigest)))) invalid();

  const uncertainty = input.uncertainty;
  if (!exact(uncertainty, ['state', 'drivers']) ||
    !['unquantified', 'deterministic_scenario', 'calibrated_interval'].includes(uncertainty.state) ||
    !codeList(uncertainty.drivers)) invalid();

  const value = input.value;
  if (exact(value, ['kind', 'reason']) && value.kind === 'unavailable') {
    if (!token(value.reason) || confidence.state !== 'unavailable' ||
      uncertainty.state !== 'unquantified') invalid();
  } else if (exact(value, ['kind', 'amount']) && value.kind === 'point') {
    if (!decimal(value.amount) || input.sourceSnapshotDigest === null ||
      uncertainty.state !== 'unquantified' || confidence.state !== 'unavailable') invalid();
  } else if (exact(value, ['kind', 'lower', 'central', 'upper', 'basis']) && value.kind === 'range') {
    if (![value.lower, value.central, value.upper].every(decimal) ||
      scaled(value.lower) > scaled(value.central) || scaled(value.central) > scaled(value.upper) ||
      input.sourceSnapshotDigest === null ||
      !['deterministic_scenario', 'calibrated_interval'].includes(value.basis) ||
      value.basis !== uncertainty.state ||
      (value.basis === 'calibrated_interval') !== (confidence.state === 'calibrated')) invalid();
  } else invalid();

  // The caller cannot mutate an accepted output after it has been checked.
  return deepFreeze(JSON.parse(JSON.stringify(input)));
}

module.exports = { VERSION, normalizeForecastOutput };
