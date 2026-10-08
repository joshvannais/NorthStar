'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MONEY = /^(?:0|[1-9]\d{0,25})\.\d{6}$/;
const PRICE = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
const VERSION = 'named-pipeline-scenario-review-v1';
const NAMES = ['adverse', 'base', 'favorable'];
const CATEGORIES = new Set(['preliminary_estimate', 'approved_unbooked']);
const UNAVAILABLE = new Set([
  'no_current_scenario_review', 'scenario_review_revoked', 'clock_reversal',
  'scenario_window_elapsed', 'business_profile_changed', 'scenario_policy_changed',
  'scenario_source_changed',
]);

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

function dense(value, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function instant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const milliseconds = Date.parse(value.slice(0, 23) + 'Z');
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 23) === value.slice(0, 23);
}

function safeId(value, nullable = false) {
  return (nullable && value === null) || (typeof value === 'string' && UUID.test(value));
}

function safeInteger(value, nullable = false) {
  return (nullable && value === null) || (Number.isSafeInteger(value) && value >= 0);
}

function safeApplicability(value, assumption) {
  const keys = ['targetKey','targetVersion','estimateId','category','estimateSnapshotDigest',
    'decisionId','decisionRevision','decisionDigest','issuedVersionId',
    'issuedVersionRevision','issuedDocumentDigest','priceBeforeTax','currency',
    'horizonRuleVersion'];
  return exact(value, keys) && value.targetKey === 'pipeline.open_value_scenario' &&
    value.targetVersion === 'v1' && value.estimateId === assumption.estimateId &&
    value.category === assumption.category &&
    value.estimateSnapshotDigest === assumption.estimateSnapshotDigest &&
    safeId(value.decisionId, true) && safeInteger(value.decisionRevision, true) &&
    (value.decisionDigest === null || DIGEST.test(value.decisionDigest || '')) &&
    safeId(value.issuedVersionId, true) && safeInteger(value.issuedVersionRevision, true) &&
    (value.issuedDocumentDigest === null || DIGEST.test(value.issuedDocumentDigest || '')) &&
    value.priceBeforeTax === assumption.priceBeforeTax && value.currency === assumption.currency &&
    value.horizonRuleVersion === 'next-complete-tenant-local-month-v1';
}

function safeAssumptions(value, review) {
  if (!dense(value, 256)) return false;
  const seen = new Set();
  for (const assumption of value) {
    if (!exact(assumption, ['estimateId','estimateSnapshotDigest','category','priceBeforeTax',
      'currency','applicability','variations']) || !UUID.test(assumption.estimateId || '') ||
      !DIGEST.test(assumption.estimateSnapshotDigest || '') ||
      !CATEGORIES.has(assumption.category) || !PRICE.test(assumption.priceBeforeTax || '') ||
      typeof assumption.currency !== 'string' || !/^[A-Z]{3}$/.test(assumption.currency) ||
      seen.has(assumption.estimateId) || !safeApplicability(assumption.applicability, assumption) ||
      !exact(assumption.variations, NAMES)) return false;
    seen.add(assumption.estimateId);
    const weights = [];
    for (const name of NAMES) {
      const variation = assumption.variations[name];
      if (!exact(variation, ['weightPpm','changedAssumption','reason','author','source',
        'recordedAt','applicability','revision']) || !Number.isSafeInteger(variation.weightPpm) ||
        variation.weightPpm < 0 || variation.weightPpm > 1000000 ||
        !exact(variation.changedAssumption, ['field','fromWeightPpm','toWeightPpm']) ||
        variation.changedAssumption.field !== 'conversion_weight_ppm' ||
        !Number.isSafeInteger(variation.changedAssumption.fromWeightPpm) ||
        variation.changedAssumption.fromWeightPpm < 0 ||
        variation.changedAssumption.fromWeightPpm > 1000000 ||
        variation.changedAssumption.toWeightPpm !== variation.weightPpm ||
        typeof variation.reason !== 'string' || variation.reason.trim().length < 10 ||
        variation.reason.trim().length > 1000 || Buffer.byteLength(variation.reason) > 4000 ||
        !exact(variation.author, ['userId','membershipId']) ||
        !UUID.test(variation.author.userId || '') || !UUID.test(variation.author.membershipId || '') ||
        !exact(variation.source, ['kind','digest']) ||
        variation.source.kind !== 'owner_approved_scenario_assumption' ||
        !DIGEST.test(variation.source.digest || '') || !instant(variation.recordedAt) ||
        variation.revision !== review.revision ||
        !safeApplicability(variation.applicability, assumption) ||
        JSON.stringify(variation.applicability) !== JSON.stringify(assumption.applicability)) {
        return false;
      }
      weights.push(variation.weightPpm);
    }
    if (weights[0] > weights[1] || weights[1] > weights[2] ||
        assumption.variations.base.changedAssumption.fromWeightPpm !== weights[1]) return false;
  }
  return true;
}

function safeScenario(value, state, reason) {
  if (!exact(value, ['state','reason','preliminaryEstimate','approvedUnbooked','total']) ||
      value.state !== state || value.reason !== reason) return false;
  if (state === 'unavailable') return value.preliminaryEstimate === null &&
    value.approvedUnbooked === null && value.total === null;
  return [value.preliminaryEstimate, value.approvedUnbooked, value.total]
    .every(item => typeof item === 'string' && MONEY.test(item));
}

function safeUnavailable(value) {
  if (!UNAVAILABLE.has(value.reason) || value.checkedAt == null || !instant(value.checkedAt) ||
      value.asOf !== null || value.horizon !== null || value.currency !== null ||
      value.sourceSnapshot !== null || value.scenarioReview !== null ||
      !dense(value.assumptions, 0) || !NAMES.every(name =>
        safeScenario(value.scenarios[name], 'unavailable', value.reason)) ||
      !exact(value.digests, ['source','assumptions','output','review','currentness']) ||
      !Object.values(value.digests).every(item => item === null) ||
      !exact(value.currentness, ['reviewCurrent','sourceCurrent','policyCurrent',
        'profileCurrent','refreshRequired','correctionOrRevocationApplied']) ||
      value.currentness.reviewCurrent !== false || value.currentness.sourceCurrent !== false ||
      value.currentness.policyCurrent !== false || value.currentness.profileCurrent !== false ||
      value.currentness.refreshRequired !== true ||
      typeof value.currentness.correctionOrRevocationApplied !== 'boolean' ||
      value.sourceAuthenticated !== false || value.assumptionSourcesAuthenticated !== false ||
      value.forecastIssued !== false) return false;
  return true;
}

function safeCurrent(value) {
  if (value.reason !== null || !instant(value.checkedAt) || !instant(value.asOf) ||
      value.checkedAt < value.asOf ||
      !exact(value.horizon, ['startsAt','endsAt','upperBoundary','timeZone']) ||
      !instant(value.horizon.startsAt) || !instant(value.horizon.endsAt) ||
      value.asOf >= value.horizon.startsAt || value.horizon.startsAt >= value.horizon.endsAt ||
      value.horizon.upperBoundary !== 'exclusive' || typeof value.horizon.timeZone !== 'string' ||
      !/^[A-Z]{3}$/.test(value.currency || '') ||
      !exact(value.sourceSnapshot, ['state','digest','profile','pipelinePolicy','statuses',
        'estimateHighWaterOrder','pipelineEpochId','pipelineEpochDigest','openRiskDigest',
        'integratedCommercialSourceDigest','completeAsOf','hasMore']) ||
      value.sourceSnapshot.state !== 'complete_as_of' ||
      !DIGEST.test(value.sourceSnapshot.digest || '') ||
      !exact(value.sourceSnapshot.profile, ['id','version','hash','anchorId','timeZone']) ||
      !UUID.test(value.sourceSnapshot.profile.id || '') ||
      !Number.isSafeInteger(value.sourceSnapshot.profile.version) ||
      value.sourceSnapshot.profile.version < 1 || !DIGEST.test(value.sourceSnapshot.profile.hash || '') ||
      !UUID.test(value.sourceSnapshot.profile.anchorId || '') ||
      value.sourceSnapshot.profile.timeZone !== value.horizon.timeZone ||
      !exact(value.sourceSnapshot.pipelinePolicy, ['id','revision','digest']) ||
      !UUID.test(value.sourceSnapshot.pipelinePolicy.id || '') ||
      !Number.isSafeInteger(value.sourceSnapshot.pipelinePolicy.revision) ||
      value.sourceSnapshot.pipelinePolicy.revision < 1 ||
      !DIGEST.test(value.sourceSnapshot.pipelinePolicy.digest || '') ||
      !exact(value.sourceSnapshot.statuses, ['estimateCount','authoritativeOpenRiskCount',
        'scenarioMemberCount','preliminaryEstimateCount','approvedUnbookedCount',
        'withdrawnExcludedCount','reviewedUnconfirmedExcludedCount',
        'confirmedBookedExcludedCount','correctedExcludedCount','cancelledExcludedCount',
        'outsideAuthoritativeOpenRiskExcludedCount']) ||
      !Object.values(value.sourceSnapshot.statuses).every(item =>
        Number.isSafeInteger(item) && item >= 0) ||
      !Number.isSafeInteger(value.sourceSnapshot.estimateHighWaterOrder) ||
      value.sourceSnapshot.estimateHighWaterOrder < 0 ||
      !UUID.test(value.sourceSnapshot.pipelineEpochId || '') ||
      ![value.sourceSnapshot.pipelineEpochDigest,value.sourceSnapshot.openRiskDigest,
        value.sourceSnapshot.integratedCommercialSourceDigest].every(item => DIGEST.test(item || '')) ||
      value.sourceSnapshot.completeAsOf !== true || value.sourceSnapshot.hasMore !== false ||
      !exact(value.scenarioReview, ['id','revision','authorUserId','membershipId','recordedAt',
        'digest']) || !UUID.test(value.scenarioReview.id || '') ||
      !Number.isSafeInteger(value.scenarioReview.revision) || value.scenarioReview.revision < 1 ||
      !UUID.test(value.scenarioReview.authorUserId || '') ||
      !UUID.test(value.scenarioReview.membershipId || '') ||
      !instant(value.scenarioReview.recordedAt) || !DIGEST.test(value.scenarioReview.digest || '') ||
      !safeAssumptions(value.assumptions, value.scenarioReview) ||
      !NAMES.every(name => safeScenario(value.scenarios[name], 'assumption_only', null)) ||
      !['preliminaryEstimate','approvedUnbooked','total'].every(key =>
        BigInt(value.scenarios.adverse[key].replace('.', '')) <=
          BigInt(value.scenarios.base[key].replace('.', '')) &&
        BigInt(value.scenarios.base[key].replace('.', '')) <=
          BigInt(value.scenarios.favorable[key].replace('.', ''))) ||
      !exact(value.digests, ['source','assumptions','output','review','currentness']) ||
      !Object.values(value.digests).every(item => DIGEST.test(item || '')) ||
      value.digests.source !== value.sourceSnapshot.digest ||
      value.digests.review !== value.scenarioReview.digest ||
      !exact(value.currentness, ['reviewCurrent','sourceCurrent','policyCurrent',
        'profileCurrent','refreshRequired','correctionOrRevocationApplied']) ||
      !['reviewCurrent','sourceCurrent','policyCurrent','profileCurrent']
        .every(key => value.currentness[key] === true) ||
      value.currentness.refreshRequired !== false ||
      value.currentness.correctionOrRevocationApplied !== false ||
      value.sourceAuthenticated !== true || value.assumptionSourcesAuthenticated !== true ||
      value.forecastIssued !== true) return false;
  return true;
}

function sanitizeNamedPipelineScenario(value) {
  const keys = ['version','state','reason','checkedAt','asOf','horizon','currency','target',
    'sourceSnapshot','scenarioReview','scenarios','assumptions','digests','currentness',
    'sourceAuthenticated','assumptionSourcesAuthenticated','weightsAreScenarioAssumptions',
    'probabilityCalibrated','percentilesIssued','earnedRevenueMeasured','cashMeasured',
    'researchOnly','realForecastEligible','forecastIssued','paidNumericServing',
    'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-named-pipeline-scenario-v1' ||
      !['current','unavailable'].includes(value.state) ||
      !exact(value.target, ['key','version']) ||
      value.target.key !== 'pipeline.open_value_scenario' || value.target.version !== 'v1' ||
      !exact(value.scenarios, NAMES) || value.weightsAreScenarioAssumptions !== true ||
      value.probabilityCalibrated !== false || value.percentilesIssued !== false ||
      value.earnedRevenueMeasured !== false || value.cashMeasured !== false ||
      value.researchOnly !== true || value.realForecastEligible !== false ||
      value.paidNumericServing !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable' ? !safeUnavailable(value) : !safeCurrent(value)) return null;
  return value;
}

function sanitizeReview(value) {
  const keys = ['state','reason','reviewId','revision','action','digest','replayed',
    'valuesWithheld','forecastIssued','automaticActionAuthorized'];
  if (!exact(value, keys) || !['named_scenario_review_saved',
    'named_scenario_review_unavailable'].includes(value.state) ||
    typeof value.replayed !== 'boolean' || value.valuesWithheld !== true ||
    value.forecastIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'named_scenario_review_unavailable') {
    if (typeof value.reason !== 'string' || value.reason.length < 1 ||
        value.reviewId !== null || value.revision !== null || value.action !== null ||
        value.digest !== null || value.replayed !== false) return null;
  } else if (value.reason !== null || !UUID.test(value.reviewId || '') ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !['approve','revoke'].includes(value.action) || !DIGEST.test(value.digest || '')) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 :
      ['23505','40001','40P01','55P03'].includes(error?.code) ? 409 :
        error?.code === '54000' ? 413 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'NAMED_SCENARIO_FORBIDDEN' :
      status === 400 ? 'NAMED_SCENARIO_REQUEST_INVALID' :
        status === 409 ? 'NAMED_SCENARIO_CHANGED' :
          status === 413 ? 'NAMED_SCENARIO_EVIDENCE_TOO_LARGE' :
            'NAMED_SCENARIO_UNAVAILABLE',
    message: status === 403 ? 'You cannot manage these forecast scenarios.' :
      status === 400 ? 'Check the scenario assumptions and try again.' :
        status === 409 ? 'The scenario evidence changed. Refresh and try again.' :
          status === 413 ? 'The scenario evidence exceeds the supported limit.' :
            'The named forecast scenarios are temporarily unavailable.',
  } });
}

function validReason(value) {
  return typeof value === 'string' && value.trim().length >= 10 &&
    value.trim().length <= 1000 && Buffer.byteLength(value) <= 4000;
}

function validInputAssumptions(value) {
  if (!dense(value, 256)) return false;
  const seen = new Set();
  return value.every(item => {
    if (!exact(item, ['estimateId','estimateSnapshotDigest','category','variations']) ||
        !UUID.test(item.estimateId || '') || !DIGEST.test(item.estimateSnapshotDigest || '') ||
        !CATEGORIES.has(item.category) || seen.has(item.estimateId) ||
        !exact(item.variations, NAMES)) return false;
    seen.add(item.estimateId);
    const weights = [];
    for (const name of NAMES) {
      const variation = item.variations[name];
      if (!exact(variation, ['weightPpm','reason']) ||
          !Number.isSafeInteger(variation.weightPpm) || variation.weightPpm < 0 ||
          variation.weightPpm > 1000000 || !validReason(variation.reason)) return false;
      weights.push(variation.weightPpm);
    }
    return weights[0] <= weights[1] && weights[1] <= weights[2];
  });
}

function createForecastNamedPipelineScenariosRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-named-pipeline-scenarios:${req.tenantContext.organizationId}:` +
    req.tenantContext.userId);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  async function guarded(req, res, sql, params, sanitizer, write) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      const raw = (await client.query(sql, [req.tenantContext.organizationId,
        req.tenantContext.userId, req.userRole, req.authSession.id, ...params])).rows[0]?.value;
      const safe = sanitizer(raw);
      if (!safe) throw new Error('Invalid guarded named scenario projection');
      await client.query('COMMIT');
      if (write && safe.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && safe.state === 'named_scenario_review_saved' &&
        safe.replayed === false ? 201 : 200).json({ success: true, data: safe });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }

  router.post('/reviews', auth, permission('forecast', 'update'), throttle,
    async (req, res) => {
      const body = req.body;
      const requestKey = req.get('Idempotency-Key');
      if (!exact(body, ['action','expectedRevision','expectedDigest','assumptions','reason',
        'confirmed','confirmationVersion']) || !['approve','revoke'].includes(body.action) ||
        !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
        body.expectedRevision > 9999 || typeof body.expectedDigest !== 'string' ||
        (body.expectedRevision === 0 ? body.expectedDigest !== 'none' :
          !DIGEST.test(body.expectedDigest)) || !validReason(body.reason) ||
        body.confirmed !== true || body.confirmationVersion !== VERSION ||
        !KEY.test(requestKey || '') || (body.action === 'approve' ?
          !validInputAssumptions(body.assumptions) : body.assumptions !== null)) {
        return failure(res, { code: '22023' });
      }
      return guarded(req, res,
        `SELECT public.canonical_forecast_named_scenario_v1_review_mutate(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) value`,
        [req.get('X-CSRF-Token'), requestKey, body.action, body.expectedRevision,
          body.expectedDigest, body.assumptions === null ? null : JSON.stringify(body.assumptions),
          body.reason,
          body.confirmed, body.confirmationVersion], sanitizeReview, true);
    });

  router.get('/current', auth, permission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!exact(req.query, [])) return failure(res, { code: '22023' });
      return guarded(req, res,
        `SELECT public.canonical_forecast_named_scenario_v1_current(
         $1,$2,$3,$4) value`, [], sanitizeNamedPipelineScenario, false);
    });
  return router;
}

module.exports = {
  createForecastNamedPipelineScenariosRouter,
  sanitizeNamedPipelineScenario,
  sanitizeReview,
};
