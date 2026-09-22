'use strict';

// Additive output shape for future dimension-scoped M26 targets. It authenticates
// no source and cannot issue or calibrate a forecast by itself.
const { sha256 } = require('../services/businessProfileAdapter');
const base = require('./outputContract');

const VERSION = 'm26-forecast-output-v2';
const SCOPE_VERSION = 'm26-dimension-scope-v1';
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DIMENSIONS = Object.freeze({
  roleKey: 'token',
  crewId: 'uuid',
  locationKey: 'token',
  materialItemId: 'uuid',
  materialState: 'token',
  unitBasis: 'token',
  assetId: 'uuid',
  assetConfigurationDigest: 'digest',
  movementClass: 'token',
  routeClass: 'token',
  operatingClass: 'token',
  resourceKind: 'token',
});

function invalid() {
  const error = new Error('Forecast dimension scope is invalid.');
  error.code = 'M26_FORECAST_SCOPE_INVALID';
  error.status = 400;
  throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
}

function validValue(value, kind) {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  if (kind === 'uuid') return UUID.test(value) && value === value.toLowerCase();
  if (kind === 'digest') return DIGEST.test(value);
  return value.length <= 80 && TOKEN.test(value);
}

function normalizeScopedForecastOutput(input) {
  const baseKeys = ['contractVersion', 'organizationId', 'asOf', 'horizon',
    'target', 'unit', 'value', 'confidence', 'uncertainty', 'evidenceCoverage',
    'applicability', 'calculationVersion', 'sourceSnapshotDigest'];
  if (!exact(input, [...baseKeys, 'dimensionScope']) || input.contractVersion !== VERSION ||
      !exact(input.dimensionScope, ['version', 'dimensions', 'digest']) ||
      input.dimensionScope.version !== SCOPE_VERSION ||
      !exact(input.dimensionScope.dimensions, Object.keys(DIMENSIONS)) ||
      typeof input.dimensionScope.digest !== 'string' ||
      !DIGEST.test(input.dimensionScope.digest)) invalid();

  const dimensions = input.dimensionScope.dimensions;
  if (Object.keys(DIMENSIONS).every(key => dimensions[key] === null) ||
      Object.entries(DIMENSIONS).some(([key, kind]) => !validValue(dimensions[key], kind))) invalid();
  const canonicalScope = { version: SCOPE_VERSION, dimensions };
  if (sha256(canonicalScope) !== input.dimensionScope.digest) invalid();

  const { dimensionScope: _scope, ...unscoped } = input;
  const checked = base.normalizeForecastOutput({ ...unscoped, contractVersion: base.VERSION });
  // The existing v1 validator retains all amount, evidence and uncertainty
  // rules. Only this new, exact scope field is added to its accepted envelope.
  return Object.freeze({
    ...checked,
    contractVersion: VERSION,
    dimensionScope: Object.freeze({
      version: SCOPE_VERSION,
      dimensions: Object.freeze({ ...dimensions }),
      digest: input.dimensionScope.digest,
    }),
  });
}

module.exports = { VERSION, SCOPE_VERSION, DIMENSIONS, normalizeScopedForecastOutput };
