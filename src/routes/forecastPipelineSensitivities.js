'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MONEY = /^(?:0|[1-9]\d{0,25})\.\d{6}$/;
const REQUEST_MONEY = /^(?:0|[1-9]\d{0,11})\.\d{6}$/;
const SIGNED_MONEY = /^-?(?:0|[1-9]\d{0,25})\.\d{6}$/;
const PRICE = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
const TOKEN = /^[a-z][a-z0-9_]{1,79}$/;
const CATEGORIES = new Set(['preliminary_estimate', 'approved_unbooked']);
const UNAVAILABLE = new Set([
  'no_current_scenario_review', 'scenario_review_revoked', 'clock_reversal',
  'scenario_window_elapsed', 'business_profile_changed', 'scenario_policy_changed',
  'scenario_source_changed', 'named_scenario_unavailable', 'unsupported_target_kind',
  'unsupported_constraint_kind', 'unsupported_target_category',
  'scenario_identity_changed', 'estimate_identity_changed',
  'authenticated_weight_bounds_invalid', 'proposed_weight_outside_authenticated_bounds',
]);
const TOP_KEYS = ['version','state','reason','checkedAt','asOf','horizon','currency',
  'scenario','selectedEstimate','target','constraint','forward','reverse','digests',
  'currentness','sourceAuthenticated','assumptionSourcesAuthenticated',
  'weightsAreScenarioAssumptions','probabilityCalibrated','percentilesIssued',
  'targetIsWhatIfThreshold','earnedRevenueMeasured','cashMeasured','recommendationIssued',
  'researchOnly','realForecastEligible','analysisIssued','paidNumericServing',
  'automaticActionAuthorized'];

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function instant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const millis = Date.parse(value.slice(0, 23) + 'Z');
  return Number.isFinite(millis) &&
    new Date(millis).toISOString().slice(0, 23) === value.slice(0, 23);
}
function id(value, nullable = false) {
  return (nullable && value === null) || (typeof value === 'string' && UUID.test(value));
}
function digest(value, nullable = false) {
  return (nullable && value === null) || (typeof value === 'string' && DIGEST.test(value));
}
function integer(value, nullable = false) {
  return (nullable && value === null) || (Number.isSafeInteger(value) && value >= 0);
}
function horizon(value) {
  return exact(value, ['startsAt','endsAt','upperBoundary','timeZone']) &&
    instant(value.startsAt) && instant(value.endsAt) && value.startsAt < value.endsAt &&
    value.upperBoundary === 'exclusive' && typeof value.timeZone === 'string' &&
    value.timeZone.length > 0 && value.timeZone.length <= 100;
}

function validRequest(value) {
  if (!exact(value, ['version','scenario','estimate','forward','reverse','purpose']) ||
      value.version !== 'm26-pipeline-sensitivity-request-v1' ||
      value.purpose !== 'bounded_open_pipeline_what_if' ||
      !exact(value.scenario, ['reviewId','reviewRevision','reviewDigest',
        'sourceSnapshotDigest','assumptionDigest','currentnessDigest','asOf','horizon']) ||
      !id(value.scenario.reviewId) || !Number.isSafeInteger(value.scenario.reviewRevision) ||
      value.scenario.reviewRevision < 1 || value.scenario.reviewRevision > 10000 ||
      !digest(value.scenario.reviewDigest) || !digest(value.scenario.sourceSnapshotDigest) ||
      !digest(value.scenario.assumptionDigest) || !digest(value.scenario.currentnessDigest) ||
      !instant(value.scenario.asOf) || !horizon(value.scenario.horizon) ||
      value.scenario.asOf >= value.scenario.horizon.startsAt ||
      !exact(value.estimate, ['id','snapshotDigest','category','decisionId',
        'decisionRevision','decisionDigest','issuedVersionId','issuedVersionRevision',
        'issuedDocumentDigest']) || !id(value.estimate.id) ||
      !digest(value.estimate.snapshotDigest) || !CATEGORIES.has(value.estimate.category) ||
      !id(value.estimate.decisionId, true) || !integer(value.estimate.decisionRevision, true) ||
      !digest(value.estimate.decisionDigest, true) || !id(value.estimate.issuedVersionId, true) ||
      !integer(value.estimate.issuedVersionRevision, true) ||
      !digest(value.estimate.issuedDocumentDigest, true) ||
      !exact(value.forward, ['proposedWeightPpm']) ||
      !Number.isSafeInteger(value.forward.proposedWeightPpm) ||
      value.forward.proposedWeightPpm < 0 || value.forward.proposedWeightPpm > 1000000 ||
      !exact(value.reverse, ['target','constraint']) ||
      !exact(value.reverse.target, ['kind','category','minimumAmount']) ||
      typeof value.reverse.target.kind !== 'string' ||
      !TOKEN.test(value.reverse.target.kind) ||
      typeof value.reverse.target.category !== 'string' ||
      !TOKEN.test(value.reverse.target.category) ||
      typeof value.reverse.target.minimumAmount !== 'string' ||
      !REQUEST_MONEY.test(value.reverse.target.minimumAmount) ||
      !exact(value.reverse.constraint, ['kind']) ||
      typeof value.reverse.constraint.kind !== 'string' ||
      !TOKEN.test(value.reverse.constraint.kind)) return false;
  return true;
}

function validCurrentness(value, current) {
  return exact(value, ['scenarioCurrent','sourceCurrent','assumptionsCurrent','policyCurrent',
    'profileCurrent','refreshRequired','correctionOrRevocationApplied']) &&
    ['scenarioCurrent','sourceCurrent','assumptionsCurrent','policyCurrent','profileCurrent']
      .every(key => value[key] === current) && value.refreshRequired === !current &&
    value.correctionOrRevocationApplied === !current;
}

function validDigests(value, current) {
  if (!exact(value, ['input','output','source','assumptions','review','currentness'])) return false;
  return Object.values(value).every(item => current ? digest(item) : item === null);
}

function validBinding(value) {
  return value === null || (exact(value, ['kind','weightPpm']) &&
    ['selected_weight_lower_bound','selected_weight_upper_bound'].includes(value.kind) &&
    integer(value.weightPpm) && value.weightPpm <= 1000000);
}

function validBaseAssumption(value, selected) {
  return exact(value, ['weightPpm','changedAssumption','reason','author','source',
    'recordedAt','applicability','revision']) && integer(value.weightPpm) &&
    value.weightPpm <= 1000000 &&
    exact(value.changedAssumption, ['field','fromWeightPpm','toWeightPpm']) &&
    value.changedAssumption.field === 'conversion_weight_ppm' &&
    value.changedAssumption.fromWeightPpm === value.weightPpm &&
    value.changedAssumption.toWeightPpm === value.weightPpm &&
    typeof value.reason === 'string' && value.reason.trim().length >= 10 &&
    exact(value.author, ['userId','membershipId']) && id(value.author.userId) &&
    id(value.author.membershipId) && exact(value.source, ['kind','digest']) &&
    value.source.kind === 'owner_approved_scenario_assumption' && digest(value.source.digest) &&
    instant(value.recordedAt) && integer(value.revision) && value.revision >= 1 &&
    value.applicability && value.applicability.estimateId === selected.id &&
    value.applicability.estimateSnapshotDigest === selected.snapshotDigest &&
    value.applicability.category === selected.category;
}

function validForward(value, selected, constraint) {
  if (!exact(value, ['state','reason','changedAssumption','selectedEstimate','categoryTotal',
    'bindingConstraint']) || value.state !== 'assumption_only' || value.reason !== null ||
      !exact(value.changedAssumption, ['field','fromWeightPpm','toWeightPpm']) ||
      value.changedAssumption.field !== 'conversion_weight_ppm' ||
      value.changedAssumption.fromWeightPpm !== constraint.bounds.basePpm ||
      !integer(value.changedAssumption.toWeightPpm) ||
      value.changedAssumption.toWeightPpm < constraint.bounds.lowerPpm ||
      value.changedAssumption.toWeightPpm > constraint.bounds.upperPpm ||
      !validBinding(value.bindingConstraint)) return false;
  for (const item of [value.selectedEstimate, value.categoryTotal]) {
    if (!exact(item, ['baselineAmount','proposedAmount','changeAmount']) ||
        !MONEY.test(item.baselineAmount || '') || !MONEY.test(item.proposedAmount || '') ||
        !SIGNED_MONEY.test(item.changeAmount || '')) return false;
  }
  return selected.baseAssumption.weightPpm === constraint.bounds.basePpm;
}

function validReverse(value, target, constraint) {
  if (!exact(value, ['state','reason','requiredWeightPpm','selectedEstimateAmount',
    'categoryTotal','bindingConstraint'])) return false;
  if (value.state === 'impossible') return value.reason ===
      'target_exceeds_selected_weight_bound' && value.requiredWeightPpm === null &&
      value.selectedEstimateAmount === null && value.categoryTotal === null &&
      exact(value.bindingConstraint, ['kind','weightPpm']) &&
      value.bindingConstraint.kind === 'selected_weight_upper_bound' &&
      value.bindingConstraint.weightPpm === constraint.bounds.upperPpm;
  return value.state === 'assumption_only' && value.reason === null &&
    integer(value.requiredWeightPpm) && value.requiredWeightPpm >= constraint.bounds.lowerPpm &&
    value.requiredWeightPpm <= constraint.bounds.upperPpm &&
    MONEY.test(value.selectedEstimateAmount || '') &&
    exact(value.categoryTotal, ['minimumAmount','attainedAmount','changeFromBaselineAmount']) &&
    value.categoryTotal.minimumAmount === target.minimumAmount &&
    MONEY.test(value.categoryTotal.attainedAmount || '') &&
    SIGNED_MONEY.test(value.categoryTotal.changeFromBaselineAmount || '') &&
    validBinding(value.bindingConstraint);
}

function sanitizePipelineSensitivity(value) {
  if (!exact(value, TOP_KEYS) || value.version !== 'm26-pipeline-sensitivity-v1' ||
      !['unavailable','assumption_only'].includes(value.state) || !instant(value.checkedAt) ||
      value.weightsAreScenarioAssumptions !== true || value.probabilityCalibrated !== false ||
      value.percentilesIssued !== false || value.targetIsWhatIfThreshold !== true ||
      value.earnedRevenueMeasured !== false || value.cashMeasured !== false ||
      value.recommendationIssued !== false || value.researchOnly !== true ||
      value.realForecastEligible !== false || value.paidNumericServing !== false ||
      value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!UNAVAILABLE.has(value.reason) || value.asOf !== null || value.horizon !== null ||
        value.currency !== null || value.scenario !== null || value.selectedEstimate !== null ||
        value.target !== null || value.constraint !== null || value.forward !== null ||
        value.reverse !== null || !validDigests(value.digests, false) ||
        !validCurrentness(value.currentness, false) || value.sourceAuthenticated !== false ||
        value.assumptionSourcesAuthenticated !== false || value.analysisIssued !== false) return null;
    return value;
  }
  if (value.reason !== null || !instant(value.asOf) || value.checkedAt < value.asOf ||
      !horizon(value.horizon) || value.asOf >= value.horizon.startsAt ||
      typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) ||
      !exact(value.scenario, ['reviewId','reviewRevision','reviewDigest',
        'sourceSnapshotDigest','assumptionDigest','currentnessDigest']) ||
      !id(value.scenario.reviewId) || !integer(value.scenario.reviewRevision) ||
      value.scenario.reviewRevision < 1 || !digest(value.scenario.reviewDigest) ||
      !digest(value.scenario.sourceSnapshotDigest) || !digest(value.scenario.assumptionDigest) ||
      !digest(value.scenario.currentnessDigest) ||
      !exact(value.selectedEstimate, ['id','snapshotDigest','category','decision',
        'issuedVersion','priceBeforeTax','currency','baseAssumption']) ||
      !id(value.selectedEstimate.id) || !digest(value.selectedEstimate.snapshotDigest) ||
      !CATEGORIES.has(value.selectedEstimate.category) ||
      !exact(value.selectedEstimate.decision, ['id','revision','digest']) ||
      !id(value.selectedEstimate.decision.id, true) ||
      !integer(value.selectedEstimate.decision.revision, true) ||
      !digest(value.selectedEstimate.decision.digest, true) ||
      !exact(value.selectedEstimate.issuedVersion, ['id','revision','digest']) ||
      !id(value.selectedEstimate.issuedVersion.id, true) ||
      !integer(value.selectedEstimate.issuedVersion.revision, true) ||
      !digest(value.selectedEstimate.issuedVersion.digest, true) ||
      !PRICE.test(value.selectedEstimate.priceBeforeTax || '') ||
      value.selectedEstimate.currency !== value.currency ||
      !validBaseAssumption(value.selectedEstimate.baseAssumption, value.selectedEstimate) ||
      !exact(value.target, ['kind','category','minimumAmount','definition','provenance',
        'interpretation']) || value.target.kind !== 'minimum_category_total' ||
      value.target.category !== value.selectedEstimate.category ||
      !REQUEST_MONEY.test(value.target.minimumAmount || '') ||
      !exact(value.target.definition, ['key','version','digest']) ||
      value.target.definition.key !== 'pipeline.minimum_category_total' ||
      value.target.definition.version !== 'v1' || !digest(value.target.definition.digest) ||
      !exact(value.target.provenance, ['kind','actorUserId','digest']) ||
      value.target.provenance.kind !== 'authorized_user_input' ||
      !id(value.target.provenance.actorUserId) || !digest(value.target.provenance.digest) ||
      value.target.interpretation !== 'user_selected_what_if_threshold' ||
      !exact(value.constraint, ['kind','bounds','definition','provenance']) ||
      value.constraint.kind !== 'selected_estimate_conversion_weight' ||
      !exact(value.constraint.bounds, ['lowerPpm','basePpm','upperPpm']) ||
      ![value.constraint.bounds.lowerPpm,value.constraint.bounds.basePpm,
        value.constraint.bounds.upperPpm].every(item => integer(item) && item <= 1000000) ||
      value.constraint.bounds.lowerPpm > value.constraint.bounds.basePpm ||
      value.constraint.bounds.basePpm > value.constraint.bounds.upperPpm ||
      !exact(value.constraint.definition, ['key','version','digest']) ||
      value.constraint.definition.key !== 'pipeline.selected_estimate_conversion_weight' ||
      value.constraint.definition.version !== 'v1' ||
      !digest(value.constraint.definition.digest) ||
      !exact(value.constraint.provenance, ['kind','id','revision','digest']) ||
      value.constraint.provenance.kind !== 'owner_approved_pipeline_policy' ||
      !id(value.constraint.provenance.id) || !integer(value.constraint.provenance.revision) ||
      value.constraint.provenance.revision < 1 ||
      !digest(value.constraint.provenance.digest) ||
      !validForward(value.forward, value.selectedEstimate, value.constraint) ||
      !validReverse(value.reverse, value.target, value.constraint) ||
      !validDigests(value.digests, true) ||
      value.digests.source !== value.scenario.sourceSnapshotDigest ||
      value.digests.assumptions !== value.scenario.assumptionDigest ||
      value.digests.review !== value.scenario.reviewDigest ||
      value.digests.currentness !== value.scenario.currentnessDigest ||
      !validCurrentness(value.currentness, true) || value.sourceAuthenticated !== true ||
      value.assumptionSourcesAuthenticated !== true || value.analysisIssued !== true) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 :
      ['40001','40P01','55P03'].includes(error?.code) ? 409 :
        error?.code === '54000' ? 413 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'PIPELINE_SENSITIVITY_FORBIDDEN' :
      status === 400 ? 'PIPELINE_SENSITIVITY_REQUEST_INVALID' :
        status === 409 ? 'PIPELINE_SENSITIVITY_CHANGED' :
          status === 413 ? 'PIPELINE_SENSITIVITY_EVIDENCE_TOO_LARGE' :
            'PIPELINE_SENSITIVITY_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this sensitivity analysis.' :
      status === 400 ? 'Check the sensitivity request and try again.' :
        status === 409 ? 'The sensitivity evidence changed. Refresh and try again.' :
          status === 413 ? 'The sensitivity evidence exceeds the supported limit.' :
            'The pipeline sensitivity analysis is temporarily unavailable.',
  } });
}

function createForecastPipelineSensitivitiesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-pipeline-sensitivity:${req.tenantContext.organizationId}:` +
      req.tenantContext.userId);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });
  router.post('/analyze', auth, permission, throttle, async (req, res) => {
    if (!validRequest(req.body)) return failure(res, { code: '22023' });
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const raw = (await client.query(
        `SELECT public.canonical_forecast_pipeline_sensitivity_v1_read(
         $1,$2,$3,$4,$5::jsonb) value`, [req.tenantContext.organizationId,
          req.tenantContext.userId, req.userRole, req.authSession.id,
          JSON.stringify(req.body)])).rows[0]?.value;
      const safe = sanitizePipelineSensitivity(raw);
      if (!safe) throw new Error('Invalid guarded pipeline sensitivity projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: safe });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = {
  createForecastPipelineSensitivitiesRouter,
  sanitizePipelineSensitivity,
  validRequest,
};
