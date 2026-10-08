'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;
const IMPLEMENTATION_PROCEDURE =
  'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)';
const DENOMINATOR_CATEGORIES = ['issued','unavailable','unpaired','corrected','revoked',
  'normalization_failed'];

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

function dense(value, size) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== size || Reflect.ownKeys(value).length !== size + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function validInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const milliseconds = Date.parse(value.slice(0, 23) + 'Z');
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 23) === value.slice(0, 23);
}

function validAlgorithm(value) {
  return exact(value, ['key','version','definitionDigest','implementationDigest','buildIdentity']) &&
    value.key === 'retell_three_complete_month_mean' &&
    value.version === 'm26-retell-three-month-mean-v2' &&
    DIGEST.test(value.definitionDigest || '') && DIGEST.test(value.implementationDigest || '') &&
    exact(value.buildIdentity, ['kind','procedure']) &&
    value.buildIdentity.kind === 'postgresql_function_definition_sha256' &&
    value.buildIdentity.procedure === IMPLEMENTATION_PROCEDURE;
}

function validBaselineIdentity(value, assessedAt) {
  if (!exact(value, ['target','unit','horizon','scope','profile','sourceAsOf',
    'sourceSnapshotDigest','sourceReceiptDigest','baselineDigest','configurationDigest',
    'algorithm']) ||
      !exact(value.target, ['key','definitionVersion','sourceScope']) ||
      value.target.key !== 'demand.inbound_leads' || value.target.definitionVersion !== 'v1' ||
      value.target.sourceScope !== 'retell_only_tenant_all' ||
      !exact(value.unit, ['key','currency']) || value.unit.key !== 'count' ||
      value.unit.currency !== null ||
      !exact(value.horizon, ['localStart','startsAt','endsAt','grain','timeZone']) ||
      !MONTH.test(value.horizon.localStart || '') || !validInstant(value.horizon.startsAt) ||
      !validInstant(value.horizon.endsAt) || value.horizon.startsAt >= value.horizon.endsAt ||
      value.horizon.grain !== 'business_local_month' ||
      typeof value.horizon.timeZone !== 'string' || value.horizon.timeZone.length < 1 ||
      value.horizon.timeZone.length > 100 ||
      !exact(value.scope, ['sourceScope','serviceKey','areaKey','dimensionKeys']) ||
      value.scope.sourceScope !== 'retell_only_tenant_all' || value.scope.serviceKey !== null ||
      value.scope.areaKey !== null || !dense(value.scope.dimensionKeys, 0) ||
      !exact(value.profile, ['businessProfileId','businessProfileVersion',
        'businessProfileHash','timeZone']) || !UUID.test(value.profile.businessProfileId || '') ||
      !Number.isSafeInteger(value.profile.businessProfileVersion) ||
      value.profile.businessProfileVersion < 1 ||
      !DIGEST.test(value.profile.businessProfileHash || '') ||
      value.profile.timeZone !== value.horizon.timeZone || !validInstant(value.sourceAsOf) ||
      value.sourceAsOf > assessedAt || assessedAt >= value.horizon.startsAt ||
      !DIGEST.test(value.sourceSnapshotDigest || '') ||
      !DIGEST.test(value.sourceReceiptDigest || '') ||
      !DIGEST.test(value.baselineDigest || '') ||
      !DIGEST.test(value.configurationDigest || '') || !validAlgorithm(value.algorithm)) return false;
  return true;
}

function validRequirements(value) {
  if (!exact(value, ['completeEligibleOriginInventory','preOutcomeChronology',
    'comparableFinalizedOutcomes','reviewedCalibrationPolicy','versionedQuantilePolicy',
    'heldOutEvaluation','existingDescriptiveEvidence'])) return false;
  const inventory = value.completeEligibleOriginInventory;
  if (!exact(inventory, ['state','reason','inventoryDigest','totalCount','issuedCount',
    'unavailableCount','unpairedCount','correctedCount','revokedCount',
    'normalizationFailedCount','denominatorCategories']) || inventory.state !== 'unavailable' ||
      inventory.reason !== 'complete_saved_prediction_inventory_not_available' ||
      !['inventoryDigest','totalCount','issuedCount','unavailableCount','unpairedCount',
        'correctedCount','revokedCount','normalizationFailedCount']
        .every(key => inventory[key] === null) ||
      !dense(inventory.denominatorCategories, DENOMINATOR_CATEGORIES.length) ||
      inventory.denominatorCategories.join('|') !== DENOMINATOR_CATEGORIES.join('|')) return false;
  const chronology = value.preOutcomeChronology;
  if (!exact(chronology, ['state','reason','verified','latestPredictionIssuedAt',
    'earliestOutcomeFinalizedAt']) || chronology.state !== 'unavailable' ||
      chronology.reason !== 'pre_outcome_prediction_chronology_not_available' ||
      chronology.verified !== false || chronology.latestPredictionIssuedAt !== null ||
      chronology.earliestOutcomeFinalizedAt !== null) return false;
  const outcomes = value.comparableFinalizedOutcomes;
  if (!exact(outcomes, ['state','reason','outcomeFinalityPolicyVersion',
    'outcomeFinalityPolicyDigest','pairedCount','unpairedCount','correctedCount','revokedCount']) ||
      outcomes.state !== 'unavailable' ||
      outcomes.reason !== 'comparable_finalized_outcomes_not_available' ||
      !['outcomeFinalityPolicyVersion','outcomeFinalityPolicyDigest','pairedCount','unpairedCount',
        'correctedCount','revokedCount'].every(key => outcomes[key] === null)) return false;
  const policy = value.reviewedCalibrationPolicy;
  if (!exact(policy, ['state','reason','policyVersion','policyDigest','sufficiencyRule',
    'independenceRule','concentrationRule','acceptableErrorRule']) ||
      policy.state !== 'unavailable' ||
      policy.reason !== 'contractor_calibration_policy_not_available' ||
      !['policyVersion','policyDigest','sufficiencyRule','independenceRule','concentrationRule',
        'acceptableErrorRule'].every(key => policy[key] === null)) return false;
  const quantiles = value.versionedQuantilePolicy;
  if (!exact(quantiles, ['state','reason','policyVersion','policyDigest','nominalCoverage',
    'quantileDefinition','p10Definition','p50Definition','p90Definition']) ||
      quantiles.state !== 'unavailable' ||
      quantiles.reason !== 'versioned_quantile_policy_not_available' ||
      !['policyVersion','policyDigest','nominalCoverage','quantileDefinition','p10Definition',
        'p50Definition','p90Definition'].every(key => quantiles[key] === null)) return false;
  const evaluation = value.heldOutEvaluation;
  if (!exact(evaluation, ['state','reason','evaluationPolicyVersion','evaluationPolicyDigest',
    'evaluationDigest','evaluationCurrentnessDigest','evaluatedAt','trainingOriginPeriods',
    'heldOutOriginPeriods','pairedCount','exclusions','nominalCoverage','empiricalCoverage',
    'quantileScores','recency','drift','materialDownside']) ||
      evaluation.state !== 'unavailable' ||
      evaluation.reason !== 'held_out_calibration_evaluation_not_available' ||
      !['evaluationPolicyVersion','evaluationPolicyDigest','evaluationDigest',
        'evaluationCurrentnessDigest','evaluatedAt','trainingOriginPeriods',
        'heldOutOriginPeriods','pairedCount','nominalCoverage','empiricalCoverage',
        'quantileScores','recency','drift','materialDownside']
        .every(key => evaluation[key] === null) ||
      !exact(evaluation.exclusions, ['unavailable','unpaired','corrected','revoked',
        'normalizationFailed']) ||
      !Object.values(evaluation.exclusions).every(item => item === null)) return false;
  const descriptive = value.existingDescriptiveEvidence;
  return exact(descriptive, ['state','targetKey','requestedTargetKey','usableForCalibration',
    'reason']) && descriptive.state === 'inapplicable' &&
    descriptive.targetKey === 'pipeline.approved_estimates' &&
    descriptive.requestedTargetKey === 'demand.inbound_leads' &&
    descriptive.usableForCalibration === false &&
    descriptive.reason === 'different_target_and_point_only_descriptive_evidence';
}

function sanitizeCalibratedRangeAssessment(value) {
  const keys = ['version','state','reason','originId','assessedAt','baselineIdentity','range',
    'distribution','requirements','currentness','digests','sourceAuthenticated','researchOnly',
    'realForecastEligible','probabilityDistributionIssued','calibratedRangeIssued',
    'paidNumericServing','automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-calibrated-range-assessment-v1' ||
      value.state !== 'unavailable' || !['calibration_evidence_not_established',
        'deterministic_baseline_not_current'].includes(value.reason) ||
      !UUID.test(value.originId || '') || !validInstant(value.assessedAt) ||
      !exact(value.range, ['state','reason','p10','p50','p90','nominalCentralCoverage',
        'empiricalCalibrationClaimed']) || value.range.state !== 'unavailable' ||
      value.range.reason !== value.reason || value.range.p10 !== null ||
      value.range.p50 !== null || value.range.p90 !== null ||
      value.range.nominalCentralCoverage !== null ||
      value.range.empiricalCalibrationClaimed !== false ||
      !exact(value.distribution, ['state','reason','family','parameters','distributionDigest']) ||
      value.distribution.state !== 'unavailable' || value.distribution.reason !== value.reason ||
      value.distribution.family !== null || value.distribution.parameters !== null ||
      value.distribution.distributionDigest !== null || !validRequirements(value.requirements) ||
      !exact(value.currentness, ['baselineCurrent','evidenceCurrent','refreshRequired',
        'correctionOrRevocationApplied']) || value.currentness.evidenceCurrent !== false ||
      value.currentness.refreshRequired !== true ||
      !exact(value.digests, ['assessment','completeOriginInventory','calibrationPolicy',
        'quantilePolicy','heldOutEvaluation','backtest']) ||
      !['completeOriginInventory','calibrationPolicy','quantilePolicy','heldOutEvaluation',
        'backtest'].every(key => value.digests[key] === null) ||
      value.researchOnly !== true || value.realForecastEligible !== false ||
      value.probabilityDistributionIssued !== false || value.calibratedRangeIssued !== false ||
      value.paidNumericServing !== false || value.automaticActionAuthorized !== false) return null;
  const current = value.reason === 'calibration_evidence_not_established';
  if (current) {
    if (!validBaselineIdentity(value.baselineIdentity, value.assessedAt) ||
        !DIGEST.test(value.digests.assessment || '') || value.sourceAuthenticated !== true ||
        value.currentness.baselineCurrent !== true ||
        value.currentness.correctionOrRevocationApplied !== false) return null;
  } else if (value.baselineIdentity !== null || value.digests.assessment !== null ||
      value.sourceAuthenticated !== false || value.currentness.baselineCurrent !== false ||
      value.currentness.correctionOrRevocationApplied !== true) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 :
      ['40001','40P01','55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'CALIBRATED_RANGE_RESTRICTED' :
      status === 400 ? 'CALIBRATED_RANGE_REQUEST_INVALID' :
        status === 409 ? 'CALIBRATED_RANGE_CHANGED' : 'CALIBRATED_RANGE_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this range assessment.' :
      status === 400 ? 'Check the range assessment request and try again.' :
        status === 409 ? 'The range assessment changed. Refresh and try again.' :
          'The calibrated range assessment is temporarily unavailable.',
  } });
}

function createForecastCalibratedRangesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-calibrated-range:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });
  router.get('/:originId', auth, permission, throttle, async (req, res) => {
    if (!UUID.test(req.params.originId || '') || !exact(req.query, [])) {
      return failure(res, { code: '22023' });
    }
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const raw = (await client.query(
        `SELECT public.canonical_forecast_calibrated_range_v1_read(
         $1,$2,$3,$4,$5) value`, [req.tenantContext.organizationId,
          req.tenantContext.userId, req.userRole, req.authSession.id,
          req.params.originId])).rows[0]?.value;
      if (raw === null || raw === undefined) {
        await client.query('COMMIT');
        return res.status(404).json({ success: false, error: {
          category: 'CALIBRATED_RANGE_NOT_FOUND',
          message: 'This calibrated range assessment was not found.',
        } });
      }
      const value = sanitizeCalibratedRangeAssessment(raw);
      if (!value) throw new Error('Invalid calibrated range assessment projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastCalibratedRangesRouter, sanitizeCalibratedRangeAssessment };
