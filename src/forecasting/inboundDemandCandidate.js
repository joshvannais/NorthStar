'use strict';

// Pure, unmounted Part 4A candidate. An owning reader must authenticate the
// source and its completeness receipt before supplying these observations.
const { normalizeForecastOutput, VERSION: OUTPUT_VERSION } = require('./outputContract');
const { validateReportingWindow, compareReportingWindows } = require('./timeSeriesWindows');

const VERSION = 'm26-inbound-demand-candidate-v1';
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalid() {
  const error = new Error('Inbound demand candidate details are invalid.');
  error.code = 'M26_INBOUND_DEMAND_INVALID';
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
  if (!Array.isArray(values) || Reflect.ownKeys(values).length !== values.length + 1) return false;
  return values.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    return descriptor?.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function buildInboundDemandCandidate(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon',
    'reportingWindow', 'sourceSnapshotDigest', 'observations']) ||
    input.version !== VERSION || !instant(input.asOf) ||
    !DIGEST.test(input.sourceSnapshotDigest || '') ||
    !dense(input.observations) || input.observations.length > 52) invalid();
  try { validateReportingWindow(input.reportingWindow); }
  catch (_error) { invalid(); }
  const reference = input.reportingWindow;
  if (reference.organizationId !== input.organizationId ||
      reference.serviceKey !== null || reference.areaScope !== 'tenant_all' ||
      !exact(input.horizon, ['startsAt', 'endsAt', 'grain']) ||
      input.horizon.startsAt !== reference.startsAt ||
      input.horizon.endsAt !== reference.endsAt ||
      input.horizon.grain !== reference.grain ||
      input.asOf > reference.startsAt || input.asOf >= reference.endsAt) invalid();

  const seen = new Set();
  let total = 0n;
  let missing = 0;
  let comparable = true;
  for (const item of input.observations) {
    if (!exact(item, ['window', 'count', 'state', 'sourceRecordedThrough',
      'coverageReceiptDigest']) ||
      !['complete', 'incomplete', 'revoked'].includes(item.state) ||
      !instant(item.sourceRecordedThrough) ||
      !DIGEST.test(item.coverageReceiptDigest || '') ||
      (item.state === 'complete' ?
        !Number.isSafeInteger(item.count) || item.count < 0 || item.count > 1000000000 :
        item.count !== null)) invalid();
    try { validateReportingWindow(item.window); }
    catch (_error) { invalid(); }
    if (item.window.organizationId !== input.organizationId ||
        item.window.serviceKey !== null || item.window.areaScope !== 'tenant_all' ||
        item.window.endsAt > input.asOf ||
        item.sourceRecordedThrough > input.asOf ||
        item.sourceRecordedThrough < item.window.endsAt ||
        seen.has(item.window.startsAt)) invalid();
    seen.add(item.window.startsAt);
    if (item.state !== 'complete') missing += 1;
    const comparison = compareReportingWindows(reference, item.window);
    if (!comparison.comparableContext || comparison.normalizationRequired) comparable = false;
    if (item.state === 'complete') total += BigInt(item.count);
  }
  const enough = input.observations.length >= 3;
  // This is an arithmetic mean of complete comparable prior periods only;
  // it is not a trained, calibrated or live demand forecast.
  const ready = enough && missing === 0 && comparable;
  const scale = ready ? (total * 1000000n + BigInt(input.observations.length) / 2n) /
    BigInt(input.observations.length) : null;
  const amount = scale === null ? null : `${scale / 1000000n}${scale % 1000000n === 0n ? '' :
    `.${(scale % 1000000n).toString().padStart(6, '0').replace(/0+$/, '')}`}`;
  return normalizeForecastOutput({
    contractVersion: OUTPUT_VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: input.horizon,
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
    unit: { key: 'count', currency: null },
    value: ready ? { kind: 'point', amount } : {
      kind: 'unavailable', reason: !enough ? 'insufficient_history' :
        missing ? 'incomplete_source_coverage' : 'window_normalization_required',
    },
    confidence: { state: 'unavailable', backtestDigest: null },
    uncertainty: { state: 'unquantified', drivers: ['retell_only', 'uncalibrated'] },
    evidenceCoverage: { included: ready ? input.observations.length : 0,
      excluded: 0, missing, stale: 0, conflicting: 0 },
    applicability: { serviceKey: null, areaKey: null, limits: ['retell_only'] },
    calculationVersion: VERSION, sourceSnapshotDigest: input.sourceSnapshotDigest,
  });
}

module.exports = { VERSION, buildInboundDemandCandidate };
