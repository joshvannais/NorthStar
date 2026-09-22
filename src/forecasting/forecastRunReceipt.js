'use strict';

const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-forecast-run-receipt-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalid() {
  const error = new Error('Forecast run receipt details are invalid.');
  error.code = 'M26_FORECAST_RUN_RECEIPT_INVALID';
  throw error;
}
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) return null;
  const captured = {};
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    captured[key] = descriptor.value;
  }
  return captured;
}
function arrayValues(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || !Number.isInteger(length.value) ||
      length.value < 1 || length.value > max) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length.value + 1 || keys.some(key => key !== 'length' &&
      (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) ||
        Number(key) >= length.value))) return null;
  const result = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result.push(descriptor.value);
  }
  return result;
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function token(value) { return typeof value === 'string' && value.length <= 80 && TOKEN.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeForecastRunReceipt(input) {
  const root = record(input, ['version', 'id', 'organizationId', 'asOf', 'createdAt',
    'settings', 'sourceSnapshotDigest', 'reportingWindowDigest', 'featureSetDigest',
    'algorithm', 'calculationVersion', 'outputContractVersion', 'outputs',
    'supersedes', 'supersessionReason']);
  const settings = root && record(root.settings, ['revision', 'digest']);
  const algorithm = root && record(root.algorithm,
    ['key', 'version', 'definitionDigest', 'implementationDigest']);
  const rawOutputs = root && arrayValues(root.outputs, 24);
  const supersedes = root && root.supersedes !== null ?
    record(root.supersedes, ['runId', 'runDigest']) : null;
  if (!root || root.version !== VERSION || !uuid(root.id) || !uuid(root.organizationId) ||
    !instant(root.asOf) || !instant(root.createdAt) || root.asOf > root.createdAt ||
    !settings || !Number.isInteger(settings.revision) || settings.revision < 0 ||
    settings.revision > 1000000000 || !digest(settings.digest) ||
    !digest(root.sourceSnapshotDigest) || !digest(root.reportingWindowDigest) ||
    !digest(root.featureSetDigest) || !algorithm || !token(algorithm.key) ||
    !token(algorithm.version) || !digest(algorithm.definitionDigest) ||
    !digest(algorithm.implementationDigest) || !token(root.calculationVersion) ||
    !token(root.outputContractVersion) || !rawOutputs ||
    !(root.supersedes === null || supersedes) ||
    (supersedes && (!uuid(supersedes.runId) || !digest(supersedes.runDigest) ||
      supersedes.runId.toLowerCase() === root.id.toLowerCase())) ||
    (supersedes ? !token(root.supersessionReason) : root.supersessionReason !== null)) invalid();
  const outputs = rawOutputs.map(value => record(value,
    ['targetKey', 'targetVersion', 'outputDigest']));
  if (outputs.some(value => !value || !token(value.targetKey) ||
      !token(value.targetVersion) || !digest(value.outputDigest))) invalid();
  const identities = outputs.map(value => `${value.targetKey}@${value.targetVersion}`);
  if (new Set(identities).size !== identities.length) invalid();
  outputs.sort((left, right) => left.targetKey.localeCompare(right.targetKey) ||
    left.targetVersion.localeCompare(right.targetVersion));
  const inputIdentity = {
    organizationId: root.organizationId.toLowerCase(), asOf: root.asOf,
    settings: { revision: settings.revision, digest: settings.digest },
    sourceSnapshotDigest: root.sourceSnapshotDigest,
    reportingWindowDigest: root.reportingWindowDigest,
    featureSetDigest: root.featureSetDigest,
    algorithm: { ...algorithm }, calculationVersion: root.calculationVersion,
    outputContractVersion: root.outputContractVersion,
    targets: outputs.map(({ targetKey, targetVersion }) => ({ targetKey, targetVersion })),
  };
  const resultIdentity = { outputs: outputs.map(value => ({ ...value })) };
  const normalized = { version: VERSION, id: root.id.toLowerCase(),
    organizationId: root.organizationId.toLowerCase(), asOf: root.asOf,
    createdAt: root.createdAt, settings: { ...settings },
    sourceSnapshotDigest: root.sourceSnapshotDigest,
    reportingWindowDigest: root.reportingWindowDigest,
    featureSetDigest: root.featureSetDigest, algorithm: { ...algorithm },
    calculationVersion: root.calculationVersion,
    outputContractVersion: root.outputContractVersion, outputs,
    supersedes: supersedes ? { runId: supersedes.runId.toLowerCase(),
      runDigest: supersedes.runDigest } : null,
    supersessionReason: root.supersessionReason,
    inputDigest: sha256(inputIdentity), resultDigest: sha256(resultIdentity),
  };
  return freeze({ ...normalized, digest: sha256(normalized) });
}

function compareForecastRuns(leftInput, rightInput) {
  const left = normalizeForecastRunReceipt(leftInput);
  const right = normalizeForecastRunReceipt(rightInput);
  if (left.organizationId !== right.organizationId || left.id === right.id) invalid();
  const state = left.inputDigest !== right.inputDigest ? 'input_changed' :
    left.resultDigest === right.resultDigest ? 'reproduced' : 'result_mismatch';
  const result = { version: VERSION, leftRunId: left.id, rightRunId: right.id,
    leftRunDigest: left.digest, rightRunDigest: right.digest, state,
    sameInputs: left.inputDigest === right.inputDigest,
    sameResults: left.resultDigest === right.resultDigest };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, normalizeForecastRunReceipt, compareForecastRuns };
