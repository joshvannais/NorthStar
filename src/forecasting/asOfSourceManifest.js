'use strict';

// Mission 26 Part 2A's temporal and identity boundary. Only a trusted,
// source-specific reader may supply pins; this module grants no source access.
const VERSION = 'm26-as-of-source-manifest-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/;

function invalid() {
  const error = new Error('Forecast source snapshot details are invalid.');
  error.code = 'M26_AS_OF_SOURCE_INVALID';
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

function token(value) {
  return typeof value === 'string' && value.length <= 80 && TOKEN.test(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeAsOfSourceManifest(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'capturedAt', 'purposeKey', 'targetKey', 'sources']) ||
    input.version !== VERSION || typeof input.organizationId !== 'string' ||
    !UUID.test(input.organizationId) || !instant(input.asOf) ||
    !instant(input.capturedAt) || instantKey(input.asOf) > instantKey(input.capturedAt) ||
    !token(input.purposeKey) || !token(input.targetKey) ||
    !Array.isArray(input.sources) || input.sources.length > 1000) invalid();

  const identities = new Set();
  for (let index = 0; index < input.sources.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input.sources, index);
    if (!descriptor || !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalid();
    const source = descriptor.value;
    if (!exact(source, ['sourceKind', 'sourceId', 'revision', 'digest', 'recordedAt', 'eventAt', 'state']) ||
      !token(source.sourceKind) || typeof source.sourceId !== 'string' ||
      !UUID.test(source.sourceId) || !Number.isSafeInteger(source.revision) ||
      source.revision < 1 || source.revision > 1000000000 ||
      typeof source.digest !== 'string' || !DIGEST.test(source.digest) ||
      !instant(source.recordedAt) || instantKey(source.recordedAt) > instantKey(input.asOf) ||
      !(source.eventAt === null || instant(source.eventAt)) ||
      !['active', 'tombstone'].includes(source.state)) invalid();
    const identity = `${source.sourceKind}:${source.sourceId.toLowerCase()}`;
    if (identities.has(identity)) invalid();
    identities.add(identity);
  }

  // Copy only validated fields; custom toJSON methods cannot alter a pin.
  const result = {
    version: VERSION,
    organizationId: input.organizationId.toLowerCase(),
    asOf: input.asOf,
    capturedAt: input.capturedAt,
    purposeKey: input.purposeKey,
    targetKey: input.targetKey,
    sources: input.sources.map(source => ({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId.toLowerCase(),
      revision: source.revision,
      digest: source.digest,
      recordedAt: source.recordedAt,
      eventAt: source.eventAt,
      state: source.state,
    })),
  };
  result.sources.sort((left, right) => {
    const leftKey = `${left.sourceKind}:${left.sourceId}`;
    const rightKey = `${right.sourceKind}:${right.sourceId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return deepFreeze(result);
}

module.exports = { VERSION, normalizeAsOfSourceManifest };
