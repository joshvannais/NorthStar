'use strict';

// Static candidate identity only. A digest here does not authenticate code,
// training data, a source reader, a tenant promotion or an active forecast.
const { VERSION: OUTPUT_VERSION } = require('./outputContract');
const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-algorithm-catalog-v1';
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);

function invalid() {
  const error = new Error('Forecast algorithm catalog details are invalid.');
  error.code = 'M26_ALGORITHM_CATALOG_INVALID';
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

function dense(values, limit) {
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype ||
      values.length > limit ||
      Reflect.ownKeys(values).length !== values.length + 1) return false;
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor || !descriptor.enumerable ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
  }
  return true;
}

function token(value) { return typeof value === 'string' && value.length <= 80 && TOKEN.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }

function definition(input) {
  if (!exact(input, ['key', 'algorithmVersion', 'target', 'kind',
    'implementationDigest', 'parametersDigest', 'featureDefinitionDigests',
    'horizonGrains', 'outputContractVersion', 'trainingReceiptDigest',
    'trainingPolicyVersion']) || !token(input.key) || !token(input.algorithmVersion) ||
      !exact(input.target, ['key', 'definitionVersion']) ||
      !token(input.target.key) || !token(input.target.definitionVersion) ||
      !['deterministic', 'statistical'].includes(input.kind) ||
      !digest(input.implementationDigest) ||
      !(input.parametersDigest === null || digest(input.parametersDigest)) ||
      !dense(input.featureDefinitionDigests, 16) ||
      !input.featureDefinitionDigests.every(digest) ||
      new Set(input.featureDefinitionDigests).size !== input.featureDefinitionDigests.length ||
      !dense(input.horizonGrains, 5) || input.horizonGrains.length === 0 ||
      !input.horizonGrains.every(grain => GRAINS.has(grain)) ||
      new Set(input.horizonGrains).size !== input.horizonGrains.length ||
      input.outputContractVersion !== OUTPUT_VERSION ||
      (input.kind === 'deterministic' ?
        input.trainingReceiptDigest !== null || input.trainingPolicyVersion !== null :
        !digest(input.trainingReceiptDigest) || !token(input.trainingPolicyVersion))) invalid();
  return {
    key: input.key, algorithmVersion: input.algorithmVersion,
    target: { key: input.target.key, definitionVersion: input.target.definitionVersion },
    kind: input.kind, implementationDigest: input.implementationDigest,
    parametersDigest: input.parametersDigest,
    featureDefinitionDigests: [...input.featureDefinitionDigests],
    horizonGrains: [...input.horizonGrains].sort(),
    outputContractVersion: OUTPUT_VERSION,
    trainingReceiptDigest: input.trainingReceiptDigest,
    trainingPolicyVersion: input.trainingPolicyVersion,
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function buildAlgorithmCatalog(input) {
  if (!exact(input, ['version', 'organizationId', 'definitions']) ||
      input.version !== VERSION || typeof input.organizationId !== 'string' ||
      !UUID.test(input.organizationId) ||
      !dense(input.definitions, 32)) invalid();
  const definitions = input.definitions.map(definition);
  const identities = new Set();
  for (const item of definitions) {
    const key = `${item.key}\u0000${item.algorithmVersion}`;
    if (identities.has(key)) invalid();
    identities.add(key);
  }
  definitions.sort((left, right) => left.key.localeCompare(right.key) ||
    left.algorithmVersion.localeCompare(right.algorithmVersion));
  const result = { version: VERSION, organizationId: input.organizationId.toLowerCase(),
    definitions };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, buildAlgorithmCatalog };
