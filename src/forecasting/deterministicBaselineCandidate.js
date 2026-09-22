'use strict';

// Reproducibility receipt for the existing, unmounted Retell-only arithmetic
// candidate. A digest does not authenticate a caller's snapshot or issue a run.
const { sha256 } = require('../services/businessProfileAdapter');
const { VERSION: DEMAND_VERSION, buildInboundDemandCandidate } =
  require('./inboundDemandCandidate');

const VERSION = 'm26-deterministic-baseline-candidate-v1';
const CONFIGURATION = Object.freeze({
  targetKey: 'demand.inbound_leads', targetVersion: 'v1',
  algorithmVersion: DEMAND_VERSION,
  method: 'arithmetic_mean_comparable_prior_periods', minimumPeriods: 3,
  sourceScope: 'retell_only',
});

function invalid() {
  const error = new Error('Deterministic baseline candidate details are invalid.');
  error.code = 'M26_DETERMINISTIC_BASELINE_INVALID';
  throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function copyWindow(window) {
  // The demand candidate first validates the exact reporting-window contract.
  return Object.fromEntries(Object.keys(window).sort().map(key => [key, window[key]]));
}

function buildDeterministicBaselineCandidate(input) {
  if (!exact(input, ['version', 'configuration', 'demandInput']) ||
      input.version !== VERSION ||
      !exact(input.configuration, Object.keys(CONFIGURATION)) ||
      Object.keys(CONFIGURATION).some(key => input.configuration[key] !== CONFIGURATION[key])) invalid();

  let output;
  try { output = buildInboundDemandCandidate(input.demandInput); }
  catch (_error) { invalid(); }
  const demand = input.demandInput;
  // Copy only validated fields. Do not hash caller methods, hidden properties,
  // prototype state or an order-sensitive enumeration of comparable periods.
  const normalizedInput = {
    version: demand.version, organizationId: demand.organizationId,
    asOf: demand.asOf, horizon: { ...demand.horizon },
    reportingWindow: copyWindow(demand.reportingWindow),
    sourceSnapshotDigest: demand.sourceSnapshotDigest,
    observations: demand.observations.map(item => ({
      window: copyWindow(item.window), count: item.count, state: item.state,
      sourceRecordedThrough: item.sourceRecordedThrough,
      coverageReceiptDigest: item.coverageReceiptDigest,
    })).sort((left, right) => left.window.startsAt.localeCompare(right.window.startsAt)),
  };
  const configurationDigest = sha256(CONFIGURATION);
  const inputDigest = sha256(normalizedInput);
  const outputDigest = sha256(output);
  const candidateDigest = sha256({ version: VERSION, configurationDigest,
    inputDigest, outputDigest });
  return Object.freeze({
    version: VERSION, configurationDigest, inputDigest, outputDigest,
    candidateDigest, output, sourceAuthenticated: false,
    forecastIssued: false, probabilityCalibrated: false,
  });
}

module.exports = { VERSION, CONFIGURATION, buildDeterministicBaselineCandidate };
