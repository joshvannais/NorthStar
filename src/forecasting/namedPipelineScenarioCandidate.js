'use strict';

// Named, unmounted variations of Part 6B's explicit per-opportunity weights.
// A source citation here is a caller claim, not verified provenance or a rate.
const { sha256 } = require('../services/businessProfileAdapter');
const { VERSION: PIPELINE_VERSION, calculatePipelineScenarios } =
  require('./pipelineScenarioDiagnostic');

const VERSION = 'm26-named-pipeline-scenarios-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NAMES = Object.freeze({ adverse: 'lower', base: 'central', favorable: 'upper' });
const KINDS = new Set(['estimator_declared', 'owner_declared',
  'company_rule_claim', 'historical_claim', 'researched_claim']);

function invalid() {
  const error = new Error('Named pipeline scenario details are invalid.');
  error.code = 'M26_NAMED_SCENARIO_INVALID';
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
function dense(value, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}
function token(value) { return typeof value === 'string' && value.length <= 80 && TOKEN.test(value); }
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function buildNamedPipelineScenarioCandidate(input) {
  if (!exact(input, ['version', 'pipelineInput', 'assumptions']) ||
      input.version !== VERSION || !dense(input.assumptions, 256)) invalid();
  let projection;
  try { projection = calculatePipelineScenarios(input.pipelineInput); }
  catch (_error) { invalid(); }
  const pipeline = input.pipelineInput;
  if (pipeline.version !== PIPELINE_VERSION ||
      input.assumptions.length !== pipeline.opportunities.length) invalid();
  const opportunityById = new Map(pipeline.opportunities.map(item =>
    [item.estimateId, item]));
  const seen = new Set();
  const assumptions = input.assumptions.map(item => {
    if (!exact(item, ['estimateId', 'variations']) ||
        typeof item.estimateId !== 'string' || !UUID.test(item.estimateId) ||
        !opportunityById.has(item.estimateId) || seen.has(item.estimateId) ||
        !exact(item.variations, Object.keys(NAMES))) invalid();
    seen.add(item.estimateId);
    const variations = {};
    for (const name of Object.keys(NAMES)) {
      const claim = item.variations[name];
      if (!exact(claim, ['reasonCode', 'sourceKind', 'sourceDigest',
        'sourceRecordedAt']) ||
          !token(claim.reasonCode) || !KINDS.has(claim.sourceKind) ||
          typeof claim.sourceDigest !== 'string' || !DIGEST.test(claim.sourceDigest) ||
          typeof claim.sourceRecordedAt !== 'string' ||
          !INSTANT.test(claim.sourceRecordedAt) ||
          !Number.isFinite(Date.parse(claim.sourceRecordedAt)) ||
          new Date(claim.sourceRecordedAt).toISOString() !== claim.sourceRecordedAt ||
          claim.sourceRecordedAt > pipeline.asOf) invalid();
      variations[name] = { weightPpm:
        opportunityById.get(item.estimateId).assumedWeightPpm[NAMES[name]],
      reasonCode: claim.reasonCode, sourceKind: claim.sourceKind,
      sourceDigest: claim.sourceDigest,
      sourceRecordedAt: claim.sourceRecordedAt };
    }
    return { estimateId: item.estimateId,
      priceStatus: opportunityById.get(item.estimateId).priceStatus, variations };
  }).sort((a, b) => a.estimateId.localeCompare(b.estimateId));

  const opportunities = pipeline.opportunities.map(item => ({
    estimateId: item.estimateId, organizationId: item.organizationId,
    priceStatus: item.priceStatus, price: item.price, currency: item.currency,
    assumedWeightPpm: { lower: item.assumedWeightPpm.lower,
      central: item.assumedWeightPpm.central, upper: item.assumedWeightPpm.upper },
  })).sort((a, b) => a.estimateId.localeCompare(b.estimateId));
  const inputDigest = sha256({ version: PIPELINE_VERSION,
    organizationId: pipeline.organizationId, asOf: pipeline.asOf,
    horizon: { startsAt: pipeline.horizon.startsAt, endsAt: pipeline.horizon.endsAt },
    currency: pipeline.currency, sourceSnapshotDigest: pipeline.sourceSnapshotDigest,
    coverage: { state: pipeline.coverage.state, hasMore: pipeline.coverage.hasMore },
    opportunities });
  const assumptionDigest = sha256(assumptions);
  const scenarios = Object.fromEntries(Object.entries(NAMES).map(([name, key]) =>
    [name, { preliminaryEstimate: projection.preliminaryEstimate[key],
      approvedUnbooked: projection.approvedUnbooked[key],
      state: projection.preliminaryEstimate.state === 'deterministic_scenario_only' ?
        'assumption_only' : 'unavailable' }]));
  if (scenarios.base.state === 'unavailable') {
    for (const value of Object.values(scenarios)) {
      value.preliminaryEstimate = null;
      value.approvedUnbooked = null;
      value.reason = 'incomplete_source_coverage';
    }
  }
  const result = { version: VERSION, organizationId: pipeline.organizationId,
    asOf: pipeline.asOf, horizon: { ...projection.horizon },
    currency: pipeline.currency, sourceSnapshotDigest: pipeline.sourceSnapshotDigest,
    inputDigest, assumptionDigest, scenarios, assumptions,
    sourceAuthenticated: false, assumptionSourcesAuthenticated: false,
    probabilityCalibrated: false, forecastIssued: false,
    bookedWorkIncluded: false, earnedRevenueMeasured: false };
  return freeze({ ...result, digest: sha256(result) });
}

module.exports = { VERSION, buildNamedPipelineScenarioCandidate };
