'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ROLE = /^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const CATEGORIES = ['bottleneck', 'backlog', 'overtime', 'contractor', 'hiring_need'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const instant = value => typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value));
const baseFlags = value => value?.researchOnly === true && value.forecastIssued === false &&
  value.paidNumericServing === false && value.forecastServingEnabled === false &&
  value.automaticActionTaken === false && typeof value.replayed === 'boolean';

function failure(res, error) {
  if (error?.code === '42501') return res.status(403).json({ success: false, error: 'Forbidden' });
  if (error?.code === 'P0002') return res.status(404).json({ success: false, error: 'Not found' });
  if (error?.code === '22023' || error?.code === '22P02') return res.status(400).json({ success: false, error: 'Invalid request' });
  if (error?.code === '23505' || error?.code === '40001') return res.status(409).json({ success: false, error: 'Conflict' });
  if (error?.code === '54000') return res.status(413).json({ success: false, error: 'Evidence exceeds bounds' });
  return res.status(503).json({ success: false, error: 'Capacity advice research unavailable' });
}

function safeCategories(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  const seen = new Set();
  return value.every(item => {
    if (!exact(item, ['alternativeKey', 'scopeKey', 'role', 'categories']) ||
      !TOKEN.test(item.alternativeKey || '') || !TOKEN.test(item.scopeKey || '') || !ROLE.test(item.role || '') ||
      !exact(item.categories, CATEGORIES)) return false;
    const identity = `${item.alternativeKey}:${item.scopeKey}:${item.role}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return CATEGORIES.every(category => exact(item.categories[category], ['state']) &&
      (category === 'hiring_need' ? ['clear', 'attention', 'insufficient_history'] : ['clear', 'attention'])
        .includes(item.categories[category].state));
  });
}

function safeOrigin(value, expectedId = null) {
  const keys = ['state', 'id', 'predictionCutoffAt', 'horizonEndsAt', 'scopeCount', 'categoryCount',
    'decisionAction', 'categories', 'refreshRequired', 'valuesWithheld', 'thresholdsWithheld',
    'outputDigestsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
    'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
  if (!exact(value, keys) || !['capacity_advisory_origin_saved', 'capacity_advisory_origin_current',
    'capacity_advisory_origin_stale'].includes(value.state) || !UUID.test(value.id || '') ||
    (expectedId && value.id !== expectedId) || !instant(value.predictionCutoffAt) || !instant(value.horizonEndsAt) ||
    Date.parse(value.horizonEndsAt) - Date.parse(value.predictionCutoffAt) !== 2592000000 ||
    !Number.isSafeInteger(value.scopeCount) || value.scopeCount < 1 || value.scopeCount > 20 ||
    value.categoryCount !== value.scopeCount * 5 || ![null, 'approve', 'reject', 'withdraw'].includes(value.decisionAction) ||
    (value.decisionAction === 'approve' ? !safeCategories(value.categories) : value.categories !== null) ||
    value.refreshRequired !== value.state.endsWith('_stale') || value.valuesWithheld !== true ||
    value.thresholdsWithheld !== true || value.outputDigestsWithheld !== true || !baseFlags(value)) return null;
  return value;
}

function safeOutcome(value, expectedOrigin = null, expectedId = null) {
  const keys = ['state', 'id', 'originId', 'revision', 'capturedAt', 'refreshRequired', 'valuesWithheld',
    'outputDigestsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
    'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
  return exact(value, keys) && ['capacity_advisory_outcome_saved', 'capacity_advisory_outcome_current',
    'capacity_advisory_outcome_stale'].includes(value.state) && UUID.test(value.id || '') &&
    UUID.test(value.originId || '') && (!expectedOrigin || value.originId === expectedOrigin) &&
    (!expectedId || value.id === expectedId) && Number.isSafeInteger(value.revision) && value.revision >= 1 &&
    instant(value.capturedAt) && value.refreshRequired === value.state.endsWith('_stale') &&
    value.valuesWithheld === true && value.outputDigestsWithheld === true && baseFlags(value) ? value : null;
}

function safeEvaluation(value, expectedOrigin = null, expectedId = null, expectedOutcome = null) {
  const keys = ['state', 'id', 'originId', 'outcomeId', 'decisionId', 'revision', 'evaluatedAt',
    'refreshRequired', 'metricsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
    'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
  return exact(value, keys) && ['capacity_advisory_evaluation_saved', 'capacity_advisory_evaluation_current',
    'capacity_advisory_evaluation_stale'].includes(value.state) && UUID.test(value.id || '') &&
    UUID.test(value.originId || '') && UUID.test(value.outcomeId || '') && UUID.test(value.decisionId || '') &&
    (!expectedOrigin || value.originId === expectedOrigin) && (!expectedId || value.id === expectedId) &&
    (!expectedOutcome || value.outcomeId === expectedOutcome) && Number.isSafeInteger(value.revision) &&
    value.revision >= 1 && instant(value.evaluatedAt) && value.refreshRequired === value.state.endsWith('_stale') &&
    value.metricsWithheld === true && baseFlags(value) ? value : null;
}

function safeContinuation(value, expectedId = null, expectedPredecessor = null) {
  const keys = ['state', 'id', 'predecessorOriginId', 'periodStart', 'periodEnd', 'activationDeadline',
    'originId', 'refreshRequired', 'valuesWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
    'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
  return exact(value, keys) && ['capacity_advisory_continuation_pending', 'capacity_advisory_continuation_activated',
    'capacity_advisory_continuation_missed', 'capacity_advisory_continuation_stale'].includes(value.state) &&
    UUID.test(value.id || '') && UUID.test(value.predecessorOriginId || '') &&
    (!expectedId || value.id === expectedId) && (!expectedPredecessor || value.predecessorOriginId === expectedPredecessor) &&
    instant(value.periodStart) && instant(value.periodEnd) && instant(value.activationDeadline) &&
    Date.parse(value.periodEnd) - Date.parse(value.periodStart) === 2592000000 &&
    Date.parse(value.activationDeadline) - Date.parse(value.periodStart) === 3600000 &&
    ((value.state === 'capacity_advisory_continuation_activated' && UUID.test(value.originId || '')) ||
      (value.state !== 'capacity_advisory_continuation_activated' && value.originId === null)) &&
    value.refreshRequired === ['capacity_advisory_continuation_missed', 'capacity_advisory_continuation_stale'].includes(value.state) &&
    value.valuesWithheld === true && baseFlags(value) ? value : null;
}

function createForecastCapacityAdvisoryRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-capacity-advice:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const writeThrottle = options.writeThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-capacity-advice-write:${req.tenantContext.organizationId}`);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); res.vary('Cookie'); next(); });

  async function run(req, res, { write = false, sql, params = [], validate }) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
      await client.query("SET LOCAL statement_timeout='10000ms'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId, req.userRole, req.authSession.id];
      const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      const data = validate(value); if (!data) throw new Error('Invalid capacity-advice projection');
      await client.query('COMMIT');
      if (write && value?.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value?.replayed === false ? 201 : 200).json({ success: true, data });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }
  const invalid = res => res.status(400).json({ success: false, error: 'Invalid request' });
  const writeBody = (body, confirmation) => exact(body, ['reason', 'confirmed', 'confirmationVersion']) &&
    typeof body.reason === 'string' && body.reason.trim().length >= 10 && body.reason.length <= 1000 &&
    body.confirmed === true && body.confirmationVersion === confirmation;

  router.get('/prerequisites/current', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, [])) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_prerequisites($1,$2,$3,$4) value',
      validate(value) {
        const keys = ['state', 'epoch', 'method', 'policyCount', 'scopeCount', 'categories', 'researchOnly',
          'forecastIssued', 'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken'];
        return exact(value, keys) && value.state === 'capacity_advisory_prerequisites_current' &&
          exact(value.epoch, ['state', 'id', 'revision', 'installedAt']) && ['missing', 'current', 'stale'].includes(value.epoch.state) &&
          ((value.epoch.state === 'missing' && value.epoch.id === null && value.epoch.revision === null && value.epoch.installedAt === null) ||
           (value.epoch.state !== 'missing' && UUID.test(value.epoch.id || '') && Number.isSafeInteger(value.epoch.revision) &&
            value.epoch.revision >= 1 && instant(value.epoch.installedAt))) &&
          exact(value.method, ['expectedRevision', 'expectedDigest', 'approved', 'sourceCurrent']) &&
          Number.isSafeInteger(value.method.expectedRevision) && value.method.expectedRevision >= 0 &&
          (value.method.expectedDigest === 'none' || DIGEST.test(value.method.expectedDigest || '')) &&
          typeof value.method.approved === 'boolean' && typeof value.method.sourceCurrent === 'boolean' &&
          Number.isSafeInteger(value.policyCount) && value.policyCount >= 0 && value.policyCount <= 20 &&
          Number.isSafeInteger(value.scopeCount) && value.scopeCount >= 0 && value.scopeCount <= 20 &&
          JSON.stringify(value.categories) === JSON.stringify(CATEGORIES) && value.researchOnly === true &&
          value.forecastIssued === false && value.paidNumericServing === false &&
          value.forecastServingEnabled === false && value.automaticActionTaken === false ? value : null;
      } });
  });

  router.get('/reviews/current', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, ['kind', 'alternativeKey', 'scopeKey', 'role', 'subjectId']) ||
      !['method', 'policy', 'demand', 'outcome_demand'].includes(req.query.kind)) return invalid(res);
    const alternative = req.query.alternativeKey === 'none' ? null : req.query.alternativeKey;
    const scope = req.query.scopeKey === 'none' ? null : req.query.scopeKey;
    const role = req.query.role === 'none' ? null : req.query.role;
    const subject = req.query.subjectId === 'none' ? null : req.query.subjectId;
    if ((alternative !== null && !TOKEN.test(alternative)) || (scope !== null && !TOKEN.test(scope)) ||
      (role !== null && !ROLE.test(role)) || (subject !== null && !UUID.test(subject)) ||
      (req.query.kind === 'method' && (alternative || scope || role || subject)) ||
      (req.query.kind === 'policy' && !(alternative && scope && role && subject === null)) ||
      (req.query.kind === 'demand' && !(alternative && scope === null && role === null && subject === null)) ||
      (req.query.kind === 'outcome_demand' && !(alternative && scope === null && role === null && subject))) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_review_current($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
      params: [req.query.kind, alternative, scope, role, subject], validate(value) {
        const keys = ['state', 'kind', 'alternativeKey', 'scopeKey', 'role', 'subjectId', 'reviewId', 'action', 'expectedRevision',
          'expectedDigest', 'sourceCurrent', 'researchOnly', 'forecastIssued', 'paidNumericServing',
          'forecastServingEnabled', 'automaticActionTaken'];
        return exact(value, keys) && value.state === 'capacity_advisory_review_current' && value.kind === req.query.kind &&
          value.alternativeKey === alternative && value.scopeKey === scope && value.role === role && value.subjectId === subject &&
          Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 &&
          ((value.expectedRevision === 0 && value.expectedDigest === 'none' && value.reviewId === null && value.action === null) ||
           (value.expectedRevision > 0 && DIGEST.test(value.expectedDigest || '') && UUID.test(value.reviewId || '') &&
            ['approve', 'reject', 'withdraw'].includes(value.action))) && typeof value.sourceCurrent === 'boolean' &&
          value.researchOnly === true && value.forecastIssued === false && value.paidNumericServing === false &&
          value.forecastServingEnabled === false && value.automaticActionTaken === false ? value : null;
      } });
  });

  router.post('/reviews', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const body = req.body; const key = req.get('Idempotency-Key');
    const ordinaryKeys = ['kind', 'alternativeKey', 'scopeKey', 'role', 'subjectId', 'action',
      'expectedRevision', 'expectedDigest', 'definition', 'reason', 'confirmed', 'confirmationVersion'];
    const extendedKeys = [...ordinaryKeys, 'continuationId', 'correctionOfReviewId'];
    const extended = exact(body, extendedKeys);
    const continuationId = extended ? body.continuationId : null;
    const correctionOfReviewId = extended ? body.correctionOfReviewId : null;
    if (!exact(req.query, []) || !(exact(body, ordinaryKeys) || extended) ||
      !['method', 'policy', 'demand', 'outcome_demand'].includes(body.kind) || !['approve', 'reject', 'withdraw'].includes(body.action) ||
      !(body.alternativeKey === null || TOKEN.test(body.alternativeKey)) || !(body.scopeKey === null || TOKEN.test(body.scopeKey)) ||
      !(body.role === null || ROLE.test(body.role)) || !(body.subjectId === null || UUID.test(body.subjectId)) ||
      !(continuationId === null || UUID.test(continuationId)) || !(correctionOfReviewId === null || UUID.test(correctionOfReviewId)) ||
      (body.kind !== 'demand' && continuationId !== null) || (continuationId !== null && correctionOfReviewId !== null) ||
      (body.kind === 'method' && (body.alternativeKey || body.scopeKey || body.role || body.subjectId)) ||
      (body.kind === 'policy' && !(body.alternativeKey && body.scopeKey && body.role && body.subjectId === null)) ||
      (body.kind === 'demand' && !(body.alternativeKey && body.scopeKey === null && body.role === null && body.subjectId === null)) ||
      (body.kind === 'outcome_demand' && !(body.alternativeKey && body.scopeKey === null && body.role === null && body.subjectId)) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) || !exact(body.definition, Object.keys(body.definition || {})) ||
      typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000 ||
      body.confirmed !== true || body.confirmationVersion !== 'm26-capacity-advisory-review-v1' || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_review_mutate_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) value',
      params: [req.get('X-CSRF-Token'), key, body.kind, body.alternativeKey, body.scopeKey, body.role, body.subjectId, body.action,
        body.expectedRevision, body.expectedDigest, body.definition, body.reason, body.confirmationVersion,
        continuationId, correctionOfReviewId],
      validate(value) {
        const keys = ['state', 'id', 'kind', 'alternativeKey', 'scopeKey', 'role', 'subjectId', 'action', 'revision', 'digest', 'replayed'];
        return exact(value, keys) && value.state === 'capacity_advisory_review_recorded' && UUID.test(value.id || '') &&
          value.kind === body.kind && value.alternativeKey === body.alternativeKey && value.scopeKey === body.scopeKey &&
          value.role === body.role && value.subjectId === body.subjectId && value.action === body.action &&
          Number.isSafeInteger(value.revision) && value.revision >= 1 &&
          DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' ? value : null;
      } });
  });

  router.post('/epochs', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!exact(req.query, []) ||
      !writeBody(req.body, 'm26-capacity-advisory-epoch-v1') || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_epoch_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
      params: [req.get('X-CSRF-Token'), key, req.body.reason, req.body.confirmationVersion], validate(value) {
        return exact(value, ['state', 'id', 'revision', 'installedAt', 'digest', 'replayed']) &&
          value.state === 'capacity_advisory_epoch_recorded' && UUID.test(value.id || '') &&
          Number.isSafeInteger(value.revision) && value.revision >= 1 && instant(value.installedAt) &&
          DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' ? value : null;
      } });
  });

  router.post('/origins', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); const body = req.body;
    const ordinary = writeBody(body, 'm26-capacity-advisory-origin-v1');
    const corrected = exact(body, ['reason', 'confirmed', 'confirmationVersion', 'correctionOriginId']) &&
      typeof body.reason === 'string' && body.reason.trim().length >= 10 && body.reason.length <= 1000 &&
      body.confirmed === true && body.confirmationVersion === 'm26-capacity-advisory-origin-v1' &&
      UUID.test(body.correctionOriginId || '');
    if (!exact(req.query, []) || !(ordinary || corrected) || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_origin_capture_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
      params: [req.get('X-CSRF-Token'), key, body.reason, body.confirmationVersion,
        corrected ? body.correctionOriginId : null],
      validate: value => value?.state === 'capacity_advisory_origin_saved' ? safeOrigin(value) : null });
  });
  router.get('/origins/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_origin_read($1,$2,$3,$4,$5) value',
      params: [req.params.id], validate: value => value?.state !== 'capacity_advisory_origin_saved' &&
        value?.replayed === false ? safeOrigin(value, req.params.id) : null });
  });

  router.post('/origins/:id/continuations', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!exact(req.query, []) || !UUID.test(req.params.id || '') ||
      !writeBody(req.body, 'm26-capacity-advisory-continuation-v1') || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_continuation_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
      params: [req.get('X-CSRF-Token'), key, req.params.id, req.body.reason, req.body.confirmationVersion],
      validate: value => safeContinuation(value, null, req.params.id) });
  });
  router.get('/continuations/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, {
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_continuation_read($1,$2,$3,$4,$5) value',
      params: [req.params.id], validate: value => value?.replayed === false ? safeContinuation(value, req.params.id) : null,
    });
  });

  router.post('/origins/:id/decisions', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const body = req.body; const key = req.get('Idempotency-Key');
    if (!exact(req.query, []) || !exact(body, ['action', 'expectedRevision', 'expectedDigest', 'reason', 'confirmed', 'confirmationVersion']) ||
      !UUID.test(req.params.id || '') || !['approve', 'reject', 'withdraw'].includes(body.action) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
      ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
      typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000 ||
      body.confirmed !== true || body.confirmationVersion !== 'm26-capacity-advisory-decision-v1' || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
      params: [req.get('X-CSRF-Token'), key, req.params.id, body.action, body.expectedRevision,
        body.expectedDigest, body.reason, body.confirmationVersion], validate(value) {
        const keys = ['state', 'id', 'originId', 'action', 'revision', 'digest', 'replayed'];
        return exact(value, keys) && value.state === 'capacity_advisory_decision_recorded' && UUID.test(value.id || '') &&
          value.originId === req.params.id && value.action === body.action && Number.isSafeInteger(value.revision) &&
          value.revision >= 1 && DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' ? value : null;
      } });
  });
  router.get('/origins/:originId/decisions/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.originId || '') || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_decision_read($1,$2,$3,$4,$5,$6) value',
      params: [req.params.originId, req.params.id], validate(value) {
        const keys = ['state', 'id', 'originId', 'action', 'revision', 'refreshRequired', 'researchOnly', 'automaticActionTaken', 'replayed'];
        return exact(value, keys) && ['capacity_advisory_decision_current', 'capacity_advisory_decision_stale'].includes(value.state) &&
          value.id === req.params.id && value.originId === req.params.originId && ['approve', 'reject', 'withdraw'].includes(value.action) &&
          Number.isSafeInteger(value.revision) && value.revision >= 1 && value.refreshRequired === value.state.endsWith('_stale') &&
          value.researchOnly === true && value.automaticActionTaken === false && value.replayed === false ? value : null;
      } });
  });

  router.post('/origins/:id/outcomes', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!exact(req.query, []) || !exact(req.body, []) ||
      !UUID.test(req.params.id || '') || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_outcome_capture($1,$2,$3,$4,$5,$6,$7) value',
      params: [req.get('X-CSRF-Token'), key, req.params.id],
      validate: value => value?.state === 'capacity_advisory_outcome_saved' ? safeOutcome(value, req.params.id) : null });
  });
  router.post('/origins/:id/outcome-preparations', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!exact(req.query, []) || !exact(req.body, []) ||
      !UUID.test(req.params.id || '') || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_outcome_prepare($1,$2,$3,$4,$5,$6,$7) value',
      params: [req.get('X-CSRF-Token'), key, req.params.id], validate(value) {
        const keys = ['state', 'originId', 'workloadEvaluationId', 'alternativeKeys', 'periodStart', 'periodEnd',
          'researchOnly', 'valuesWithheld', 'automaticActionTaken', 'replayed'];
        return exact(value, keys) && value.state === 'capacity_advisory_outcome_basis_ready' &&
          value.originId === req.params.id && UUID.test(value.workloadEvaluationId || '') &&
          Array.isArray(value.alternativeKeys) && value.alternativeKeys.length >= 1 && value.alternativeKeys.length <= 20 &&
          value.alternativeKeys.every(item => TOKEN.test(item || '')) && instant(value.periodStart) && instant(value.periodEnd) &&
          Date.parse(value.periodEnd) - Date.parse(value.periodStart) === 2592000000 && value.researchOnly === true &&
          value.valuesWithheld === true && value.automaticActionTaken === false && typeof value.replayed === 'boolean' ? value : null;
      } });
  });
  router.get('/origins/:originId/outcomes/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.originId || '') || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_outcome_read($1,$2,$3,$4,$5,$6) value',
      params: [req.params.originId, req.params.id], validate: value => value?.state !== 'capacity_advisory_outcome_saved' &&
        value?.replayed === false ? safeOutcome(value, req.params.originId, req.params.id) : null });
  });
  router.post('/origins/:id/evaluations', auth, requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
    const key = req.get('Idempotency-Key'); if (!exact(req.query, []) || !exact(req.body, ['outcomeId']) ||
      !UUID.test(req.params.id || '') || !UUID.test(req.body.outcomeId || '') || !KEY.test(key || '')) return invalid(res);
    return run(req, res, { write: true,
      sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_evaluation_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
      params: [req.get('X-CSRF-Token'), key, req.params.id, req.body.outcomeId],
      validate: value => value?.state === 'capacity_advisory_evaluation_saved' ?
        safeEvaluation(value, req.params.id, null, req.body.outcomeId) : null });
  });
  router.get('/origins/:originId/evaluations/:id', auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
    if (!exact(req.query, []) || !UUID.test(req.params.originId || '') || !UUID.test(req.params.id || '')) return invalid(res);
    return run(req, res, { sql: 'SELECT public.canonical_forecast_capacity_advisory_v1_evaluation_read($1,$2,$3,$4,$5,$6) value',
      params: [req.params.originId, req.params.id], validate: value => value?.state !== 'capacity_advisory_evaluation_saved' &&
        value?.replayed === false ? safeEvaluation(value, req.params.originId, req.params.id) : null });
  });
  return router;
}

module.exports = { createForecastCapacityAdvisoryRouter, safeOrigin, safeOutcome, safeEvaluation, safeContinuation, safeCategories };
