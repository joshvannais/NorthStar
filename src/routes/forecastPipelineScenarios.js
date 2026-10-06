'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const POLICY_VERSION = 'pipeline-scenario-policy-v1';
const ORIGIN_VERSION = 'pipeline-open-value-scenario-v1';
const EVALUATION_VERSION = 'pipeline-cutoff-cohort-evaluation-v1';
const TARGET = 'pipeline.open_value_scenario';
const MEASUREMENT = 'research.pipeline_cutoff_cohort_booked_work_value';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const copy = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const instant = value => typeof value === 'string' && INSTANT.test(value) &&
  Number.isFinite(Date.parse(value)) && !/T24:|:60(?:\.|Z)/.test(value);
const reason = value => typeof value === 'string' && value.trim().length >= 10 &&
  value.trim().length <= 1000 && Buffer.byteLength(value) <= 4000;

const unavailableReasons = new Set([
  'no_review', 'approved_scenario_policy_unavailable', 'current_profile_unavailable',
  'currency_authority_unavailable', 'commercial_sources_unavailable',
  'approved_price_coverage_unavailable', 'approved_price_source_limit', 'mixed_currency',
  'approved_price_source_invalid', 'amount_exceeds_limit', 'approved_price_manifest_size',
  'issued_estimate_source_limit', 'issued_estimate_source_invalid',
  'issued_estimate_history_source_limit', 'issued_estimate_manifest_size',
  'commercial_review_source_limit', 'booked_work_lineage_unavailable',
  'duplicate_current_booked_opportunity', 'booked_work_confirmation_source_limit',
  'booked_work_manifest_size', 'prospective_pipeline_epoch_unavailable',
  'authoritative_open_pipeline_unavailable', 'authoritative_open_pipeline_invalid',
  'open_pipeline_member_limit', 'estimate_source_limit', 'estimate_source_gap',
  'estimate_source_invalid', 'open_pipeline_estimate_identity_ambiguous',
  'decision_currentness_gap', 'authoritative_open_pipeline_booking_mismatch',
  'preliminary_price_missing', 'decision_source_invalid', 'duplicate_open_opportunity',
  'ambiguous_commercial_status', 'open_pipeline_estimate_unavailable',
  'estimate_source_manifest_invalid', 'pipeline_sources_unavailable',
  'future_horizon_elapsed_before_capture', 'prior_origin_stale_new_request_required',
  'horizon_not_ended', 'schedule_lineage_gap', 'approved_price_epoch_unavailable',
  'event_time_approved_price_unavailable', 'complete_outcome_unavailable',
  'frozen_origin_evidence_unavailable',
  'prior_evaluation_stale_new_request_required',
]);

function failure(res, error) {
  const code = error?.code;
  if (code === '42501') return res.status(403).json({ success: false, error: 'Forbidden' });
  if (code === 'P0002') return res.status(404).json({ success: false, error: 'Not found' });
  if (code === '22023' || code === '22P02') {
    return res.status(400).json({ success: false, error: 'Invalid request' });
  }
  if (code === '23505' || code === '40001') {
    return res.status(409).json({ success: false, error: 'Conflict' });
  }
  if (code === '40P01' || code === '55P03') {
    return res.status(409).json({ success: false, error: 'Pipeline scenario is busy' });
  }
  if (code === '54000') {
    return res.status(413).json({ success: false, error: 'Evidence exceeds bounds' });
  }
  return res.status(503).json({ success: false, error: 'Pipeline scenario research unavailable' });
}
const invalid = res => res.status(400).json({ success: false, error: 'Invalid request' });

function weights(value) {
  if (!exact(value, ['preliminaryEstimate', 'approvedUnbooked'])) return false;
  return ['preliminaryEstimate', 'approvedUnbooked'].every(category => {
    const item = value[category];
    if (!exact(item, ['lowerPpm', 'centralPpm', 'upperPpm'])) return false;
    const values = [item.lowerPpm, item.centralPpm, item.upperPpm];
    return values.every(number => Number.isSafeInteger(number) &&
      number >= 0 && number <= 1000000) && values[0] <= values[1] && values[1] <= values[2];
  });
}

function safePolicy(value, mode) {
  const unavailable = ['state', 'reason', 'weightsWithheld',
    'weightsAreScenarioAssumptions', 'probabilityCalibrated', 'forecastIssued'];
  if (value?.state === 'pipeline_scenario_policy_unavailable') {
    return mode === 'read' && exact(value, unavailable) && value.reason === 'no_review' &&
      value.weightsWithheld === true && value.weightsAreScenarioAssumptions === true &&
      value.probabilityCalibrated === false && value.forecastIssued === false ?
      copy(value, unavailable) : null;
  }
  const keys = mode === 'write' ?
    ['state', 'id', 'revision', 'action', 'replayed', 'weightsWithheld',
      'weightsAreScenarioAssumptions', 'probabilityCalibrated', 'forecastIssued'] :
    ['state', 'id', 'revision', 'action', 'weightsWithheld',
      'weightsAreScenarioAssumptions', 'probabilityCalibrated', 'forecastIssued'];
  if (!exact(value, keys) || value.state !== (mode === 'write' ?
    'pipeline_scenario_policy_reviewed' : 'pipeline_scenario_policy_current') ||
    !UUID.test(value.id || '') || !Number.isSafeInteger(value.revision) ||
    value.revision < 1 || value.revision > 10000 ||
    !['approve', 'reject'].includes(value.action) ||
    (mode === 'write' && typeof value.replayed !== 'boolean') ||
    value.weightsWithheld !== true || value.weightsAreScenarioAssumptions !== true ||
    value.probabilityCalibrated !== false || value.forecastIssued !== false) return null;
  return copy(value, keys);
}

function safeOrigin(value, mode, expectedId = null) {
  if (value?.state === 'pipeline_scenario_origin_unavailable') {
    const keys = ['state', 'reason', 'valuesWithheld', 'probabilityCalibrated',
      'researchOnly', 'realForecastEligible', 'forecastIssued', 'paidNumericServing',
      'automaticActionAuthorized'];
    return mode === 'write' && exact(value, keys) && unavailableReasons.has(value.reason) &&
      value.valuesWithheld === true && value.probabilityCalibrated === false &&
      value.researchOnly === true && value.realForecastEligible === false &&
      value.forecastIssued === false && value.paidNumericServing === false &&
      value.automaticActionAuthorized === false ? copy(value, keys) : null;
  }
  if (value?.state === 'pipeline_scenario_origin_stale') {
    const keys = ['state', 'id', 'refreshRequired', 'valuesWithheld', 'researchOnly',
      'forecastIssued', 'paidNumericServing'];
    return mode === 'read' && exact(value, keys) && UUID.test(value.id || '') &&
      (!expectedId || value.id === expectedId) && value.refreshRequired === true &&
      value.valuesWithheld === true && value.researchOnly === true &&
      value.forecastIssued === false && value.paidNumericServing === false ? copy(value, keys) : null;
  }
  const common = value?.targetKey === TARGET && value?.targetVersion === 'v1' &&
    value?.evaluationMeasurementKey === MEASUREMENT &&
    value?.formalBookedWorkValueTargetClaimed === false &&
    value?.postCutoffEntrantsExcluded === true && value?.valuesWithheld === true &&
    value?.weightsAreScenarioAssumptions === true && value?.probabilityCalibrated === false &&
    value?.researchOnly === true && value?.realForecastEligible === false &&
    value?.forecastIssued === false && value?.paidNumericServing === false &&
    value?.automaticActionAuthorized === false;
  if (mode === 'write') {
    const keys = ['state', 'id', 'horizonStartsAt', 'horizonEndsAt', 'replayed',
      'targetKey', 'targetVersion', 'evaluationMeasurementKey',
      'formalBookedWorkValueTargetClaimed', 'postCutoffEntrantsExcluded', 'valuesWithheld',
      'weightsAreScenarioAssumptions', 'probabilityCalibrated', 'researchOnly',
      'realForecastEligible', 'forecastIssued', 'paidNumericServing',
      'automaticActionAuthorized'];
    return exact(value, keys) && value.state === 'pipeline_scenario_origin_saved' &&
      UUID.test(value.id || '') && instant(value.horizonStartsAt) &&
      instant(value.horizonEndsAt) && Date.parse(value.horizonEndsAt) >
      Date.parse(value.horizonStartsAt) && typeof value.replayed === 'boolean' && common ?
      copy(value, keys) : null;
  }
  const keys = ['state', 'id', 'horizonStartsAt', 'horizonEndsAt',
    'captureInputsCurrentAtRead', 'captureInputsFrozen', 'targetKey', 'targetVersion',
    'evaluationMeasurementKey', 'formalBookedWorkValueTargetClaimed',
    'postCutoffEntrantsExcluded', 'valuesWithheld', 'sourceCoverageCompleteAtCapture',
    'weightsAreScenarioAssumptions', 'probabilityCalibrated', 'researchOnly',
    'realForecastEligible', 'forecastIssued', 'paidNumericServing',
    'automaticActionAuthorized'];
  return exact(value, keys) && value.state === 'pipeline_scenario_origin_current' &&
    UUID.test(value.id || '') && (!expectedId || value.id === expectedId) &&
    instant(value.horizonStartsAt) && instant(value.horizonEndsAt) &&
    Date.parse(value.horizonEndsAt) > Date.parse(value.horizonStartsAt) &&
    typeof value.captureInputsCurrentAtRead === 'boolean' &&
    typeof value.captureInputsFrozen === 'boolean' &&
    value.captureInputsCurrentAtRead !== value.captureInputsFrozen &&
    value.sourceCoverageCompleteAtCapture === true && common ? copy(value, keys) : null;
}

function safeEvaluation(value, mode, expectedOrigin = null, expectedId = null) {
  if (value?.state === 'pipeline_scenario_evaluation_unavailable') {
    const keys = ['state', 'reason', 'metricsWithheld', 'researchOnly',
      'forecastIssued', 'paidNumericServing'];
    return mode === 'write' && exact(value, keys) && unavailableReasons.has(value.reason) &&
      value.metricsWithheld === true && value.researchOnly === true &&
      value.forecastIssued === false && value.paidNumericServing === false ?
      copy(value, keys) : null;
  }
  if (value?.state === 'pipeline_scenario_evaluation_stale') {
    const keys = ['state', 'id', 'originId', 'revision', 'refreshRequired',
      'metricsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing'];
    return mode === 'read' && exact(value, keys) && UUID.test(value.id || '') &&
      UUID.test(value.originId || '') && (!expectedId || value.id === expectedId) &&
      (!expectedOrigin || value.originId === expectedOrigin) &&
      Number.isSafeInteger(value.revision) && value.revision >= 1 &&
      value.refreshRequired === true && value.metricsWithheld === true &&
      value.researchOnly === true && value.forecastIssued === false &&
      value.paidNumericServing === false ? copy(value, keys) : null;
  }
  const keys = mode === 'write' ?
    ['state', 'id', 'originId', 'revision', 'replayed', 'measurementKey',
      'formalTargetClaimed', 'postCutoffEntrantsExcluded', 'metricsWithheld',
      'researchOnly', 'calibrationClaimed', 'forecastIssued', 'paidNumericServing',
      'automaticActionTaken'] :
    ['state', 'id', 'originId', 'revision', 'evaluatedAt', 'measurementKey',
      'formalTargetClaimed', 'postCutoffEntrantsExcluded', 'metricsWithheld',
      'researchOnly', 'calibrationClaimed', 'forecastIssued', 'paidNumericServing',
      'automaticActionTaken'];
  if (!exact(value, keys) || value.state !== (mode === 'write' ?
    'pipeline_scenario_evaluation_saved' : 'pipeline_scenario_evaluation_current') ||
    !UUID.test(value.id || '') || !UUID.test(value.originId || '') ||
    (expectedId && value.id !== expectedId) ||
    (expectedOrigin && value.originId !== expectedOrigin) ||
    !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    (mode === 'write' ? typeof value.replayed !== 'boolean' : !instant(value.evaluatedAt)) ||
    value.measurementKey !== MEASUREMENT || value.formalTargetClaimed !== false ||
    value.postCutoffEntrantsExcluded !== true || value.metricsWithheld !== true ||
    value.researchOnly !== true || value.calibrationClaimed !== false ||
    value.forecastIssued !== false || value.paidNumericServing !== false ||
    value.automaticActionTaken !== false) return null;
  return copy(value, keys);
}

function createForecastPipelineScenariosRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-pipeline-scenarios:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
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
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const raw = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      if (raw == null) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      const safe = sanitizer(raw);
      if (!safe) throw new Error('Invalid guarded pipeline scenario result');
      await client.query('COMMIT');
      if (write && safe.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && safe.replayed === false ? 201 : 200)
        .json({ success: true, data: safe });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally {
      if (client) client.release();
    }
  }

  router.post('/policies', auth, requirePermission('forecast', 'update'), throttle,
    async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!exact(body, ['action', 'reason', 'expectedRevision', 'scenarioWeights',
        'confirmed', 'confirmationVersion']) || !['approve', 'reject'].includes(body.action) ||
        !reason(body.reason) || !Number.isSafeInteger(body.expectedRevision) ||
        body.expectedRevision < 0 || body.expectedRevision > 10000 ||
        body.confirmed !== true || body.confirmationVersion !== POLICY_VERSION ||
        !KEY.test(key || '') || (body.action === 'approve' ? !weights(body.scenarioWeights) :
          body.scenarioWeights !== null)) return invalid(res);
      const selected = body.scenarioWeights;
      return guarded(req, res,
        'SELECT public.canonical_forecast_pipeline_scenario_policy_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) value',
        [req.get('X-CSRF-Token'), key, body.action, body.reason, body.expectedRevision,
          selected?.preliminaryEstimate?.lowerPpm ?? null,
          selected?.preliminaryEstimate?.centralPpm ?? null,
          selected?.preliminaryEstimate?.upperPpm ?? null,
          selected?.approvedUnbooked?.lowerPpm ?? null,
          selected?.approvedUnbooked?.centralPpm ?? null,
          selected?.approvedUnbooked?.upperPpm ?? null, true, POLICY_VERSION],
        value => safePolicy(value, 'write'), true);
    });

  router.get('/policies/current', auth, requirePermission('forecast', 'read'), throttle,
    (req, res) => guarded(req, res,
      'SELECT public.canonical_forecast_pipeline_scenario_policy_read($1,$2,$3,$4) value',
      [], value => safePolicy(value, 'read'), false));

  router.post('/origins', auth, requirePermission('forecast', 'update'), throttle,
    async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!exact(body, ['reason', 'confirmed', 'confirmationVersion']) ||
        !reason(body.reason) || body.confirmed !== true ||
        body.confirmationVersion !== ORIGIN_VERSION || !KEY.test(key || '')) return invalid(res);
      return guarded(req, res,
        'SELECT public.canonical_forecast_pipeline_scenario_origin_capture($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
        [req.get('X-CSRF-Token'), key, body.reason, true, ORIGIN_VERSION],
        value => safeOrigin(value, 'write'), true);
    });

  router.get('/origins/:originId', auth, requirePermission('forecast', 'read'), throttle,
    (req, res) => {
      if (!UUID.test(req.params.originId || '')) return invalid(res);
      return guarded(req, res,
        'SELECT public.canonical_forecast_pipeline_scenario_origin_read($1,$2,$3,$4,$5) value',
        [req.params.originId], value => safeOrigin(value, 'read', req.params.originId), false);
    });

  router.post('/origins/:originId/evaluations', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!UUID.test(req.params.originId || '') ||
        !exact(body, ['reason', 'confirmed', 'confirmationVersion']) ||
        !reason(body.reason) || body.confirmed !== true ||
        body.confirmationVersion !== EVALUATION_VERSION || !KEY.test(key || '')) return invalid(res);
      return guarded(req, res,
        'SELECT public.canonical_forecast_pipeline_scenario_evaluation_capture($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
        [req.get('X-CSRF-Token'), key, req.params.originId, body.reason,
          true, EVALUATION_VERSION],
        value => safeEvaluation(value, 'write', req.params.originId), true);
    });

  router.get('/evaluations/:evaluationId', auth,
    requirePermission('forecast', 'read'), throttle, (req, res) => {
      if (!UUID.test(req.params.evaluationId || '')) return invalid(res);
      return guarded(req, res,
        'SELECT public.canonical_forecast_pipeline_scenario_evaluation_read($1,$2,$3,$4,$5) value',
        [req.params.evaluationId],
        value => safeEvaluation(value, 'read', null, req.params.evaluationId), false);
    });

  return router;
}

module.exports = {
  createForecastPipelineScenariosRouter,
  safePolicy,
  safeOrigin,
  safeEvaluation,
};
