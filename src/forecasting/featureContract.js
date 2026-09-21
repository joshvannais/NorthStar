'use strict';

// Internal Mission 26 Part 2C shape boundary. A normalized feature is not
// evidence that a reader, source snapshot, freshness rule or calculation is authorized.
const { validateReportingWindow } = require('./timeSeriesWindows');
const { sha256 } = require('../services/businessProfileAdapter');

const DEFINITION_VERSION = 'm26-feature-definition-v1';
const VALUE_VERSION = 'm26-feature-value-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/;
const STATES = new Set(['known', 'missing', 'stale', 'conflicting', 'inapplicable']);

function invalid() {
  const error = new Error('Forecast feature details are invalid.');
  error.code = 'M26_FEATURE_INVALID';
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

function token(value) {
  return typeof value === 'string' && value.length <= 80 && TOKEN.test(value);
}

function instant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) &&
    date.toISOString() === `${value.slice(0, 23)}Z`;
}

function instantKey(value) {
  return value.replace(/\.(\d{3})(\d{3})?Z$/, (_, millis, micros) =>
    `.${millis}${micros || '000'}Z`);
}

function digest(value) {
  return typeof value === 'string' && DIGEST.test(value);
}

function decimal(value, scale, allowsNegative) {
  if (typeof value !== 'string' || !DECIMAL.test(value) ||
      /^-0(?:\.0+)?$/.test(value) || (!allowsNegative && value.startsWith('-'))) return false;
  return (value.split('.')[1] || '').length <= scale;
}

function freeze(value) {
  Object.values(value).forEach(item => {
    if (item && typeof item === 'object') freeze(item);
  });
  return Object.freeze(value);
}

function normalizeFeatureDefinition(input) {
  if (!exact(input, ['contractVersion', 'key', 'definitionVersion', 'sourceKinds',
    'sourcePurposeKey', 'sourceTargetKey', 'derivationKey', 'temporalBasis',
    'unit', 'allowsNegative']) || input.contractVersion !== DEFINITION_VERSION ||
    !token(input.key) || !token(input.definitionVersion) ||
    !Array.isArray(input.sourceKinds) || input.sourceKinds.length < 1 ||
    input.sourceKinds.length > 8 ||
    Reflect.ownKeys(input.sourceKinds).length !== input.sourceKinds.length + 1 ||
    !input.sourceKinds.every((kind, index) =>
      Object.prototype.hasOwnProperty.call(input.sourceKinds, index) &&
      Object.prototype.hasOwnProperty.call(
        Object.getOwnPropertyDescriptor(input.sourceKinds, index), 'value') && token(kind)) ||
    new Set(input.sourceKinds).size !== input.sourceKinds.length ||
    !token(input.sourcePurposeKey) || !token(input.sourceTargetKey) ||
    !token(input.derivationKey) ||
    !['as_of_stock', 'observed_window'].includes(input.temporalBasis) ||
    typeof input.allowsNegative !== 'boolean' ||
    !exact(input.unit, ['key', 'currency', 'scale']) || !token(input.unit.key) ||
    !Number.isInteger(input.unit.scale) || input.unit.scale < 0 ||
    input.unit.scale > 6 ||
    (input.unit.key === 'money' ?
      !(typeof input.unit.currency === 'string' && /^[A-Z]{3}$/.test(input.unit.currency)) :
      input.unit.currency !== null)) invalid();
  return freeze({
    contractVersion: DEFINITION_VERSION,
    key: input.key, definitionVersion: input.definitionVersion,
    sourceKinds: [...input.sourceKinds].sort(),
    sourcePurposeKey: input.sourcePurposeKey,
    sourceTargetKey: input.sourceTargetKey,
    derivationKey: input.derivationKey,
    temporalBasis: input.temporalBasis,
    unit: { key: input.unit.key, currency: input.unit.currency, scale: input.unit.scale },
    allowsNegative: input.allowsNegative,
  });
}

function normalizeFeatureValue(input, definition) {
  // The definition is only structurally checked here; an owning, versioned
  // registry must authorize it before a future reader calculates a value.
  const declared = normalizeFeatureDefinition(definition);
  if (!exact(input, ['contractVersion', 'organizationId', 'definitionKey',
    'definitionVersion', 'definitionDigest', 'asOf', 'reportingWindow', 'sourceSnapshotDigest',
    'latestSourceRecordedAt', 'state', 'amount', 'reason', 'unit']) ||
    input.contractVersion !== VALUE_VERSION ||
    typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
    input.definitionKey !== declared.key ||
    input.definitionVersion !== declared.definitionVersion ||
    input.definitionDigest !== sha256(declared) ||
    !instant(input.asOf) || !STATES.has(input.state) ||
    !(input.sourceSnapshotDigest === null || digest(input.sourceSnapshotDigest)) ||
    !(input.latestSourceRecordedAt === null || instant(input.latestSourceRecordedAt)) ||
    (input.latestSourceRecordedAt !== null &&
      instantKey(input.latestSourceRecordedAt) > instantKey(input.asOf)) ||
    !exact(input.unit, ['key', 'currency', 'scale']) ||
    input.unit.key !== declared.unit.key ||
    input.unit.currency !== declared.unit.currency ||
    input.unit.scale !== declared.unit.scale) invalid();

  if (declared.temporalBasis === 'as_of_stock') {
    if (input.reportingWindow !== null) invalid();
  } else {
    try { validateReportingWindow(input.reportingWindow); }
    catch (_error) { invalid(); }
    if (input.reportingWindow.organizationId.toLowerCase() !==
        input.organizationId.toLowerCase() ||
        instantKey(input.reportingWindow.endsAt) > instantKey(input.asOf)) invalid();
  }

  if (input.state === 'known') {
    if (!decimal(input.amount, declared.unit.scale, declared.allowsNegative) ||
      input.reason !== null || !digest(input.sourceSnapshotDigest)) invalid();
  } else {
    // Stale and conflicting numbers cannot be used as current known values.
    if (input.amount !== null || !token(input.reason)) invalid();
    if (input.state === 'stale' || input.state === 'conflicting') {
      if (!digest(input.sourceSnapshotDigest) ||
          input.latestSourceRecordedAt === null) invalid();
    } else if (input.state === 'inapplicable' &&
        (input.sourceSnapshotDigest !== null || input.latestSourceRecordedAt !== null)) invalid();
    else if (input.state === 'missing' && input.latestSourceRecordedAt !== null) invalid();
  }

  return freeze({
    contractVersion: VALUE_VERSION,
    organizationId: input.organizationId.toLowerCase(),
    definitionKey: declared.key, definitionVersion: declared.definitionVersion,
    definitionDigest: input.definitionDigest,
    asOf: input.asOf,
    reportingWindow: input.reportingWindow === null ? null : { ...input.reportingWindow },
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    latestSourceRecordedAt: input.latestSourceRecordedAt,
    state: input.state, amount: input.amount, reason: input.reason,
    unit: { ...declared.unit },
  });
}

module.exports = {
  DEFINITION_VERSION, VALUE_VERSION, normalizeFeatureDefinition, normalizeFeatureValue,
};
