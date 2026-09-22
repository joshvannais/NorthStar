'use strict';

// A bounded what-if on one declared open-pipeline weight. Part 6B retains
// arithmetic authority; neither source claims nor weights are authenticated.
const { sha256 } = require('../services/businessProfileAdapter');
const { calculatePipelineScenarios } = require('./pipelineScenarioDiagnostic');
const { buildNamedPipelineScenarioCandidate } = require('./namedPipelineScenarioCandidate');

const VERSION = 'm26-pipeline-sensitivity-candidate-v1';
const MONEY = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid() {
  const error = new Error('Pipeline sensitivity details are invalid.');
  error.code = 'M26_PIPELINE_SENSITIVITY_INVALID';
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
function micro(value) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0') || '0');
}
function decimal(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = String(absolute % 1000000n).padStart(6, '0');
  return `${negative ? '-' : ''}${absolute / 1000000n}.${fraction}`;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function analyzePipelineSensitivity(input) {
  if (!exact(input, ['version', 'namedInput', 'estimateId',
    'proposedBaseWeightPpm', 'desiredMinimumAmount']) ||
    input.version !== VERSION || typeof input.estimateId !== 'string' ||
    !UUID.test(input.estimateId) || !Number.isSafeInteger(input.proposedBaseWeightPpm) ||
    input.proposedBaseWeightPpm < 0 || input.proposedBaseWeightPpm > 1000000 ||
    typeof input.desiredMinimumAmount !== 'string' ||
    !MONEY.test(input.desiredMinimumAmount)) invalid();
  let named;
  try { named = buildNamedPipelineScenarioCandidate(input.namedInput); }
  catch (_error) { invalid(); }
  const pipeline = input.namedInput.pipelineInput;
  const selected = pipeline.opportunities.find(item => item.estimateId === input.estimateId);
  if (!selected || input.proposedBaseWeightPpm < selected.assumedWeightPpm.lower ||
      input.proposedBaseWeightPpm > selected.assumedWeightPpm.upper) invalid();
  const category = selected.priceStatus === 'preliminary_estimate' ?
    'preliminaryEstimate' : 'approvedUnbooked';
  const baseWeight = selected.assumedWeightPpm.central;
  const common = { version: VERSION, organizationId: pipeline.organizationId,
    asOf: pipeline.asOf, horizon: { ...pipeline.horizon },
    currency: pipeline.currency, sourceSnapshotDigest: pipeline.sourceSnapshotDigest,
    namedScenarioDigest: named.digest, estimateId: input.estimateId,
    category, baseWeightPpm: baseWeight,
    proposedBaseWeightPpm: input.proposedBaseWeightPpm,
    desiredMinimumAmount: input.desiredMinimumAmount,
    sourceAuthenticated: false, probabilityCalibrated: false,
    forecastIssued: false };
  if (named.scenarios.base.state === 'unavailable') {
    const unavailable = { ...common, state: 'unavailable',
      reason: 'incomplete_source_coverage', baselineAmount: null,
      proposedAmount: null, changeAmount: null,
      reverse: { state: 'unavailable', reason: 'incomplete_source_coverage',
        requiredWeightPpm: null, attainedAmount: null,
        bindingConstraint: null } };
    return freeze({ ...unavailable, digest: sha256(unavailable) });
  }

  function atWeight(weight) {
    const opportunities = pipeline.opportunities.map(item => ({
      estimateId: item.estimateId, organizationId: item.organizationId,
      priceStatus: item.priceStatus, price: item.price, currency: item.currency,
      assumedWeightPpm: { lower: item.assumedWeightPpm.lower,
        central: item.estimateId === input.estimateId ? weight : item.assumedWeightPpm.central,
        upper: item.assumedWeightPpm.upper },
    }));
    const result = calculatePipelineScenarios({ version: pipeline.version,
      organizationId: pipeline.organizationId, asOf: pipeline.asOf,
      horizon: { ...pipeline.horizon }, currency: pipeline.currency,
      sourceSnapshotDigest: pipeline.sourceSnapshotDigest,
      coverage: { ...pipeline.coverage }, opportunities });
    return result[category].central;
  }
  const baselineAmount = named.scenarios.base[category];
  const proposedAmount = atWeight(input.proposedBaseWeightPpm);
  const target = micro(input.desiredMinimumAmount);
  const maximum = atWeight(selected.assumedWeightPpm.upper);
  let reverse;
  if (micro(maximum) < target) {
    reverse = { state: 'unavailable', reason: 'target_exceeds_selected_weight_bound',
      requiredWeightPpm: null, attainedAmount: null,
      bindingConstraint: 'selected_weight_upper_bound' };
  } else {
    let low = selected.assumedWeightPpm.lower;
    let high = selected.assumedWeightPpm.upper;
    while (low < high) {
      const midpoint = Math.floor((low + high) / 2);
      if (micro(atWeight(midpoint)) >= target) high = midpoint;
      else low = midpoint + 1;
    }
    reverse = { state: 'assumption_only', reason: null,
      requiredWeightPpm: low, attainedAmount: atWeight(low),
      bindingConstraint: low === selected.assumedWeightPpm.upper ?
        'selected_weight_upper_bound' : null };
  }
  const result = { ...common, state: 'assumption_only', reason: null,
    baselineAmount, proposedAmount,
    changeAmount: decimal(micro(proposedAmount) - micro(baselineAmount)), reverse };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, analyzePipelineSensitivity };
