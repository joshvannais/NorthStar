'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const instant = value => typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value));
const common = value => value?.allSevenDimensionsApplied === true && value.resultsWithheld === true &&
  value.outputDigestsWithheld === true && value.researchOnly === true && value.forecastIssued === false &&
  value.paidNumericServing === false && value.forecastServingEnabled === false &&
  value.automaticActionTaken === false && typeof value.replayed === 'boolean';
const evaluationCommon = value => value?.allSevenDimensionsApplied === true && value.metricsWithheld === true &&
  value.researchOnly === true && value.forecastIssued === false && value.paidNumericServing === false &&
  value.forecastServingEnabled === false && value.automaticActionTaken === false &&
  typeof value.replayed === 'boolean';
const reviewIdentity = (kind, scopeKey, subjectId) =>
  (kind === 'method' && scopeKey === null && subjectId === null) ||
  (kind === 'scope' && typeof scopeKey === 'string' && subjectId === null) ||
  (kind === 'job' && typeof scopeKey === 'string' && UUID.test(subjectId || ''));

function failure(res, error) {
  if (error?.code === '42501') return res.status(403).json({ success: false, error: 'Forbidden' });
  if (error?.code === 'P0002') return res.status(404).json({ success: false, error: 'Not found' });
  if (error?.code === '22023') return res.status(400).json({ success: false, error: 'Invalid request' });
  if (error?.code === '23505' || error?.code === '40001') return res.status(409).json({ success: false, error: 'Conflict' });
  if (error?.code === '54000') return res.status(413).json({ success: false, error: 'Evidence exceeds bounds' });
  return res.status(503).json({ success: false, error: 'Constrained capacity research unavailable' });
}

function safeOrigin(value, expectedId = null, allowNotFound = false) {
  if (value === null) return allowNotFound ? { state: 'not_found' } : null;
  const keys = ['state', 'id', 'predictionCutoffAt', 'horizonEndsAt', 'scopeCount', 'refreshRequired',
    'allSevenDimensionsApplied', 'resultsWithheld', 'outputDigestsWithheld', 'researchOnly',
    'forecastIssued', 'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
  if (!exact(value, keys) || !['constrained_capacity_origin_saved', 'constrained_capacity_origin_current',
    'constrained_capacity_origin_stale'].includes(value.state) || !UUID.test(value.id || '') ||
    (expectedId && value.id !== expectedId) || !instant(value.predictionCutoffAt) ||
    !instant(value.horizonEndsAt) || Date.parse(value.horizonEndsAt) - Date.parse(value.predictionCutoffAt) !== 2592000000 ||
    !Number.isSafeInteger(value.scopeCount) || value.scopeCount < 1 || value.scopeCount > 20 ||
    value.refreshRequired !== value.state.endsWith('_stale') || !common(value)) return null;
  return value;
}

function safeOutcome(value, expectedOrigin = null, expectedId = null, allowNotFound = false) {
  if (value === null) return allowNotFound ? { state: 'not_found' } : null;
  const keys = ['state', 'id', 'originId', 'revision', 'capturedAt', 'refreshRequired',
    'allSevenDimensionsApplied', 'resultsWithheld', 'outputDigestsWithheld', 'researchOnly',
    'forecastIssued', 'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
  if (!exact(value, keys) || !['constrained_capacity_outcome_saved', 'constrained_capacity_outcome_current',
    'constrained_capacity_outcome_stale'].includes(value.state) || !UUID.test(value.id || '') ||
    !UUID.test(value.originId || '') || (expectedOrigin && value.originId !== expectedOrigin) ||
    (expectedId && value.id !== expectedId) || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    !instant(value.capturedAt) || value.refreshRequired !== value.state.endsWith('_stale') || !common(value)) return null;
  return value;
}

function safeEvaluation(value, expectedOrigin = null, expectedId = null, expectedOutcome = null,
  allowNotFound = false) {
  if (value === null) return allowNotFound ? { state: 'not_found' } : null;
  const keys = ['state', 'id', 'originId', 'outcomeId', 'revision', 'capturedAt', 'refreshRequired',
    'allSevenDimensionsApplied', 'metricsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
    'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
  if (!exact(value, keys) || !['constrained_capacity_evaluation_saved', 'constrained_capacity_evaluation_current',
    'constrained_capacity_evaluation_stale'].includes(value.state) || !UUID.test(value.id || '') ||
    !UUID.test(value.originId || '') || !UUID.test(value.outcomeId || '') ||
    (expectedOrigin && value.originId !== expectedOrigin) || (expectedId && value.id !== expectedId) ||
    (expectedOutcome && value.outcomeId !== expectedOutcome) ||
    !Number.isSafeInteger(value.revision) || value.revision < 1 || !instant(value.capturedAt) ||
    value.refreshRequired !== value.state.endsWith('_stale') || !evaluationCommon(value)) return null;
  return value;
}

function createForecastConstrainedCapacityRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-constrained-capacity:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const writeThrottle = options.writeThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-constrained-capacity-write:${req.tenantContext.organizationId}`);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); res.vary('Cookie'); next(); });

  async function run(req, res, { write = false, sql, params = [], validate }) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
      await client.query("SET LOCAL statement_timeout='8000ms'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      const data = validate(value); if (!data) throw new Error('Invalid constrained-capacity projection');
      await client.query('COMMIT');
      if (write && value?.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value?.replayed === false ? 201 : 200).json({ success: true, data });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }
  const invalid = res => res.status(400).json({ success: false, error: 'Invalid request' });

  router.get('/prerequisites/current', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, [])) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_prerequisites($1,$2,$3,$4) value',
      validate(value) {
        if (!exact(value, ['state', 'epoch', 'method', 'scopeCount', 'jobReviewCount', 'researchOnly',
          'forecastIssued', 'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken']) ||
          value.state !== 'constrained_capacity_prerequisites_current' ||
          !exact(value.epoch, ['state', 'id', 'revision', 'digest', 'installedAt']) ||
          !exact(value.method, ['expectedRevision', 'expectedDigest', 'approved', 'sourceCurrent']) ||
          !['missing', 'current'].includes(value.epoch.state) ||
          (value.epoch.state === 'missing'
            ? !(value.epoch.id === null && value.epoch.revision === null && value.epoch.digest === null &&
              value.epoch.installedAt === null)
            : !(UUID.test(value.epoch.id || '') && Number.isSafeInteger(value.epoch.revision) &&
              value.epoch.revision >= 1 && DIGEST.test(value.epoch.digest || '') && instant(value.epoch.installedAt))) ||
          !Number.isSafeInteger(value.method.expectedRevision) || value.method.expectedRevision < 0 ||
          !(value.method.expectedDigest === 'none' || DIGEST.test(value.method.expectedDigest || '')) ||
          ((value.method.expectedRevision === 0) !== (value.method.expectedDigest === 'none')) ||
          typeof value.method.approved !== 'boolean' || typeof value.method.sourceCurrent !== 'boolean' ||
          (value.method.expectedRevision === 0 && (value.method.approved || value.method.sourceCurrent)) ||
          !Number.isSafeInteger(value.scopeCount) || value.scopeCount < 0 || value.scopeCount > 20 ||
          !Number.isSafeInteger(value.jobReviewCount) || value.jobReviewCount < 0 || value.jobReviewCount > 500 ||
          value.researchOnly !== true || value.forecastIssued !== false || value.paidNumericServing !== false ||
          value.forecastServingEnabled !== false || value.automaticActionTaken !== false) return null;
        return value;
      } });
  });

  router.get('/reviews/current', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, ['kind', 'scopeKey', 'subjectId']) || !['method', 'scope', 'job'].includes(req.query.kind)) return invalid(res);
    const scopeKey = req.query.scopeKey === 'none' ? null : req.query.scopeKey;
    const subjectId = req.query.subjectId === 'none' ? null : req.query.subjectId;
    if (!(scopeKey === null || /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(scopeKey)) ||
      !(subjectId === null || UUID.test(subjectId)) ||
      !reviewIdentity(req.query.kind, scopeKey, subjectId)) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_review_current($1,$2,$3,$4,$5,$6,$7) value',
      params: [req.query.kind, scopeKey, subjectId], validate(value) {
        const keys = ['state', 'kind', 'scopeKey', 'subjectId', 'reviewId', 'action', 'expectedRevision',
          'expectedDigest', 'sourceCurrent', 'researchOnly', 'forecastIssued', 'paidNumericServing',
          'forecastServingEnabled', 'automaticActionTaken'];
        return exact(value, keys) && value.state === 'constrained_capacity_review_current' &&
          value.kind === req.query.kind && value.scopeKey === scopeKey && value.subjectId === subjectId &&
          reviewIdentity(value.kind, value.scopeKey, value.subjectId) &&
          Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 &&
          ((value.expectedRevision === 0 && value.expectedDigest === 'none' && value.reviewId === null &&
            value.action === null) || (value.expectedRevision > 0 && DIGEST.test(value.expectedDigest || '') &&
            UUID.test(value.reviewId || '') && ['approve', 'reject', 'withdraw'].includes(value.action))) &&
          typeof value.sourceCurrent === 'boolean' && value.researchOnly === true &&
          value.forecastIssued === false && value.paidNumericServing === false &&
          value.forecastServingEnabled === false && value.automaticActionTaken === false ? value : null;
      } });
  });

  router.post('/reviews', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); const body = req.body;
    if (!exact(req.query, []) || !exact(body, ['kind', 'scopeKey', 'subjectId', 'action', 'expectedRevision',
      'expectedDigest', 'definition', 'reason', 'confirmed', 'confirmationVersion']) ||
      !['method', 'scope', 'job'].includes(body.kind) || !(body.scopeKey === null ||
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(body.scopeKey)) ||
      !(body.subjectId === null || UUID.test(body.subjectId)) || !['approve', 'reject', 'withdraw'].includes(body.action) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
      !reviewIdentity(body.kind, body.scopeKey, body.subjectId) ||
      !body.definition || typeof body.definition !== 'object' || Array.isArray(body.definition) ||
      typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000 ||
      body.confirmed !== true || body.confirmationVersion !== 'm26-constrained-capacity-review-v1' || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_review_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) value',
      params: [req.get('X-CSRF-Token'), key, body.kind, body.scopeKey, body.subjectId, body.action,
        body.expectedRevision, body.expectedDigest, body.definition, body.reason, body.confirmationVersion],
      validate(value) {
        const keys = ['state', 'id', 'kind', 'scopeKey', 'subjectId', 'action', 'revision', 'digest', 'replayed'];
        return exact(value, keys) && value.state === 'constrained_capacity_review_recorded' && UUID.test(value.id || '') &&
          value.kind === body.kind && value.scopeKey === body.scopeKey && value.subjectId === body.subjectId &&
          value.action === body.action && Number.isSafeInteger(value.revision) && value.revision >= 1 &&
          DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' ? value : null;
      } });
  });

  router.post('/epochs', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!exact(req.query, []) || !exact(req.body, ['reason', 'confirmed', 'confirmationVersion']) ||
      typeof req.body.reason !== 'string' || req.body.reason.trim().length < 10 || req.body.reason.length > 1000 ||
      req.body.confirmed !== true || req.body.confirmationVersion !== 'm26-constrained-capacity-epoch-v1' || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_epoch_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
      params: [req.get('X-CSRF-Token'), key, req.body.reason, req.body.confirmationVersion],
      validate(value) { return exact(value, ['state', 'id', 'revision', 'installedAt', 'digest', 'replayed']) &&
        value.state === 'constrained_capacity_epoch_recorded' && UUID.test(value.id || '') &&
        Number.isSafeInteger(value.revision) && value.revision >= 1 && instant(value.installedAt) &&
        DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' ? value : null; } });
  });

  router.post('/origins', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!exact(req.query, []) || !exact(req.body, ['reason', 'confirmed', 'confirmationVersion']) ||
      typeof req.body.reason !== 'string' || req.body.reason.trim().length < 10 || req.body.reason.length > 1000 ||
      req.body.confirmed !== true || req.body.confirmationVersion !== 'm26-constrained-capacity-origin-v1' || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
      params: [req.get('X-CSRF-Token'), key, req.body.reason, req.body.confirmationVersion], validate: safeOrigin });
  });
  router.get('/origins/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_origin_read($1,$2,$3,$4,$5) value',
      params: [req.params.id], validate: value => safeOrigin(value, req.params.id, true) });
  });
  router.post('/origins/:id/outcomes', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!exact(req.query, []) || !exact(req.body, []) ||
      !UUID.test(req.params.id || '') || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_outcome_capture($1,$2,$3,$4,$5,$6,$7) value',
      params: [req.get('X-CSRF-Token'), key, req.params.id], validate: value => safeOutcome(value, req.params.id) });
  });
  router.get('/origins/:originId/outcomes/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.originId || '') || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_outcome_read($1,$2,$3,$4,$5,$6) value',
      params: [req.params.originId, req.params.id],
      validate: value => safeOutcome(value, req.params.originId, req.params.id, true) });
  });
  router.post('/origins/:id/evaluations', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!exact(req.query, []) || !exact(req.body, ['outcomeId']) ||
      !UUID.test(req.params.id || '') || !UUID.test(req.body.outcomeId || '') || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_evaluation_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
      params: [req.get('X-CSRF-Token'), key, req.params.id, req.body.outcomeId],
      validate: value => safeEvaluation(value, req.params.id, null, req.body.outcomeId) });
  });
  router.get('/origins/:originId/evaluations/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.originId || '') || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_constrained_capacity_v1_evaluation_read($1,$2,$3,$4,$5,$6) value',
      params: [req.params.originId, req.params.id],
      validate: value => safeEvaluation(value, req.params.originId, req.params.id, null, true) });
  });
  return router;
}

module.exports = { createForecastConstrainedCapacityRouter, safeOrigin, safeOutcome, safeEvaluation };
