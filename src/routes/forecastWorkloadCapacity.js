'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const ROLE = /^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$/;
const TARGETS = [
  'workload.accepted_person_hours.v1',
  'workload.end_backlog_hours.v1',
  'capacity.available_role_hours.v1',
];
const REVIEW_KINDS = ['method', 'remaining_work', 'role_qualification', 'availability_basis',
  'capacity_role_scope'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const instant = value => typeof value === 'string' && INSTANT.test(value) &&
  Number.isFinite(Date.parse(value)) && !/T24:|:60(?:\.|Z|[+-])/.test(value);
const common = value => value?.researchOnly === true && value.forecastIssued === false &&
  value.paidNumericServing === false && value.forecastServingEnabled === false &&
  value.automaticActionTaken === false;
function validReviewShape(value) {
  if (value.kind === 'method') return TARGETS.includes(value.target) && value.subjectId === null &&
    value.role === null && value.remainingPersonMinutes === null;
  if (value.kind === 'remaining_work') return value.target === TARGETS[1] &&
    UUID.test(value.subjectId || '') && value.role === null && Number.isSafeInteger(value.remainingPersonMinutes) &&
    value.remainingPersonMinutes >= 0 && value.remainingPersonMinutes <= 100000000;
  if (value.kind === 'role_qualification') return value.target === TARGETS[2] &&
    UUID.test(value.subjectId || '') && ROLE.test(value.role || '') && value.remainingPersonMinutes === null;
  if (value.kind === 'capacity_role_scope') return value.target === TARGETS[2] &&
    value.subjectId === null && ROLE.test(value.role || '') && value.remainingPersonMinutes === null;
  return value.kind === 'availability_basis' && value.target === TARGETS[2] &&
    UUID.test(value.subjectId || '') && value.role === null && value.remainingPersonMinutes === null;
}

function failure(res, error) {
  const code = error?.code;
  if (code === '42501') return res.status(403).json({ success: false, error: 'Forbidden' });
  if (code === 'P0002') return res.status(404).json({ success: false, error: 'Not found' });
  if (code === '22023') return res.status(400).json({ success: false, error: 'Invalid request' });
  if (code === '23505' || code === '40001') return res.status(409).json({ success: false, error: 'Conflict' });
  if (code === '54000') return res.status(413).json({ success: false, error: 'Evidence exceeds bounds' });
  return res.status(503).json({ success: false, error: 'Workload research unavailable' });
}
const invalid = res => res.status(400).json({ success: false, error: 'Invalid request' });

function safeReceipt(value, state, fields) {
  const keys = ['state', 'id', ...fields, 'digest', 'replayed'];
  if (!exact(value, keys) || value.state !== state || !UUID.test(value.id || '') ||
      !DIGEST.test(value.digest || '') || typeof value.replayed !== 'boolean') return null;
  const result = { state, id: value.id };
  for (const field of fields) result[field] = value[field];
  return { ...result, digest: value.digest, replayed: value.replayed };
}

function safeOrigin(value, expectedId = null) {
  if (value === null) return { state: 'not_found' };
  if (!exact(value, ['state', 'id', 'capacityRole', 'predictionCutoffAt', 'horizonEndsAt', 'targets',
    'refreshRequired', 'resultsWithheld', 'outputDigestsWithheld', 'researchOnly',
    'forecastIssued', 'paidNumericServing', 'forecastServingEnabled',
    'automaticActionTaken', 'replayed']) ||
      !['workload_capacity_origin_saved', 'workload_capacity_origin_current',
        'workload_capacity_origin_stale'].includes(value.state) ||
      !UUID.test(value.id || '') || !ROLE.test(value.capacityRole || '') ||
      (expectedId && value.id !== expectedId) ||
      !instant(value.predictionCutoffAt) || !instant(value.horizonEndsAt) ||
      Date.parse(value.horizonEndsAt) - Date.parse(value.predictionCutoffAt) !== 2592000000 ||
      !Array.isArray(value.targets) || value.targets.length !== TARGETS.length ||
      value.targets.some((target, index) => target !== TARGETS[index]) ||
      value.resultsWithheld !== true || value.outputDigestsWithheld !== true ||
      value.refreshRequired !== value.state.endsWith('_stale') ||
      typeof value.replayed !== 'boolean' || !common(value)) return null;
  return { ...value };
}

function safeEvaluation(value, expectedOrigin = null, expectedId = null) {
  if (value === null) return { state: 'not_found' };
  if (!exact(value, ['state', 'id', 'originId', 'capacityRole', 'revision', 'evaluatedAt', 'targets',
    'refreshRequired', 'metricsWithheld', 'researchOnly', 'forecastIssued',
    'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken', 'replayed']) ||
      !['workload_capacity_evaluation_saved', 'workload_capacity_evaluation_current',
        'workload_capacity_evaluation_stale'].includes(value.state) ||
      !UUID.test(value.id || '') || !UUID.test(value.originId || '') ||
      !ROLE.test(value.capacityRole || '') ||
      (expectedOrigin && value.originId !== expectedOrigin) || (expectedId && value.id !== expectedId) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 || !instant(value.evaluatedAt) ||
      !Array.isArray(value.targets) || value.targets.length !== TARGETS.length ||
      value.targets.some((target, index) => target !== TARGETS[index]) ||
      value.metricsWithheld !== true || value.refreshRequired !== value.state.endsWith('_stale') ||
      typeof value.replayed !== 'boolean' || !common(value)) return null;
  return { ...value };
}

function createForecastWorkloadCapacityRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-workload-capacity:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const writeThrottle = options.writeThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-workload-capacity-write:${req.tenantContext.organizationId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store'); res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie'); next();
  });

  async function run(req, res, { write = false, sql, params = [], validate }) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
      await client.query("SET LOCAL statement_timeout = '8000ms'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      const data = validate(value); if (!data) throw new Error('Invalid workload projection');
      await client.query('COMMIT');
      if (write && value?.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value?.replayed === false ? 201 : 200).json({ success: true, data });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  }

  router.get('/prerequisites/current', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_prerequisites($1,$2,$3,$4) value',
        validate(value) {
          if (!exact(value, ['state', 'epoch', 'methods', 'reviewCounts', 'researchOnly',
            'forecastIssued', 'paidNumericServing', 'forecastServingEnabled',
            'automaticActionTaken']) || value.state !== 'workload_capacity_prerequisites_current' ||
              !exact(value.epoch, ['state', 'id', 'revision', 'digest', 'installedAt']) ||
              !['missing', 'current', 'stale'].includes(value.epoch.state) ||
              !Array.isArray(value.methods) || value.methods.length !== TARGETS.length ||
              value.methods.some((item, index) => !exact(item, ['target', 'expectedRevision',
                'expectedDigest', 'approved']) || item.target !== TARGETS[index] ||
                !Number.isSafeInteger(item.expectedRevision) || item.expectedRevision < 0 ||
                !(item.expectedDigest === 'none' || DIGEST.test(item.expectedDigest || '')) ||
                typeof item.approved !== 'boolean') || !exact(value.reviewCounts,
                ['remainingWork', 'roleQualification', 'availabilityBasis']) ||
              Object.values(value.reviewCounts).some(count => !Number.isSafeInteger(count) || count < 0) ||
              !common(value)) return null;
          if (value.epoch.state === 'missing') {
            if (value.epoch.id !== null || value.epoch.revision !== null ||
                value.epoch.digest !== null || value.epoch.installedAt !== null) return null;
          } else if (!UUID.test(value.epoch.id || '') || !Number.isSafeInteger(value.epoch.revision) ||
              value.epoch.revision < 1 || !DIGEST.test(value.epoch.digest || '') ||
              !instant(value.epoch.installedAt)) return null;
          return value;
        },
      });
    });

  router.post('/backlog-items/:id/unschedule', auth, requirePermission('forecast', 'update'),
    writeThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !UUID.test(req.params.id || '') ||
          !exact(req.body, ['expectedRevision', 'expectedDigest', 'reason', 'confirmed',
            'confirmationVersion']) || !Number.isSafeInteger(req.body.expectedRevision) ||
          req.body.expectedRevision < 1 || !DIGEST.test(req.body.expectedDigest || '') ||
          typeof req.body.reason !== 'string' || req.body.reason.trim().length < 10 ||
          req.body.reason.length > 1000 || req.body.confirmed !== true ||
          req.body.confirmationVersion !== 'm26-workload-capacity-unschedule-v1' ||
          !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: `SELECT public.canonical_forecast_workload_capacity_v1_backlog_unschedule(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value`,
        params: [req.get('X-CSRF-Token'), key, req.params.id, req.body.expectedRevision,
          req.body.expectedDigest, req.body.reason, req.body.confirmationVersion],
        validate(value) {
          if (!exact(value, ['state', 'appointmentId', 'assignmentId', 'assignmentRevision',
            'assignmentDigest', 'scheduleState', 'dispatchState', 'researchOnly',
            'forecastIssued', 'paidNumericServing', 'forecastServingEnabled',
            'automaticActionTaken', 'replayed']) ||
              value.state !== 'workload_capacity_backlog_unscheduled' ||
              value.appointmentId !== req.params.id || !UUID.test(value.assignmentId || '') ||
              !Number.isSafeInteger(value.assignmentRevision) || value.assignmentRevision < 2 ||
              !DIGEST.test(value.assignmentDigest || '') || value.scheduleState !== 'unscheduled' ||
              !['not_dispatched', 'revoked'].includes(value.dispatchState) ||
              typeof value.replayed !== 'boolean' || !common(value)) return null;
          return value;
        },
      });
    });

  router.get('/reviews/current', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!exact(req.query, ['kind', 'target', 'subjectId', 'role']) ||
          !REVIEW_KINDS.includes(req.query.kind) || !TARGETS.includes(req.query.target))
        return invalid(res);
      const subjectId = req.query.subjectId === 'none' ? null : req.query.subjectId;
      const reviewRole = req.query.role === 'none' ? null : req.query.role;
      if (!(subjectId === null || UUID.test(subjectId || '')) ||
          !(reviewRole === null || ROLE.test(reviewRole || '')) ||
          !(req.query.kind === 'capacity_role_scope' && req.query.target === TARGETS[2] &&
            subjectId === null && reviewRole === null) &&
          !validReviewShape({ kind: req.query.kind, target: req.query.target,
            subjectId, role: reviewRole, remainingPersonMinutes:
              req.query.kind === 'remaining_work' ? 0 : null })) return invalid(res);
      return run(req, res, {
        sql: `SELECT public.canonical_forecast_workload_capacity_v1_review_current(
          $1,$2,$3,$4,$5,$6,$7,$8) value`,
        params: [req.query.kind, req.query.target, subjectId, reviewRole],
        validate(value) {
          if (!exact(value, ['state', 'kind', 'target', 'subjectId', 'role', 'reviewId',
            'action', 'expectedRevision', 'expectedDigest', 'sourceCurrent', 'researchOnly',
            'forecastIssued', 'paidNumericServing', 'forecastServingEnabled',
            'automaticActionTaken']) || value.state !== 'workload_capacity_review_current' ||
              value.kind !== req.query.kind || value.target !== req.query.target ||
              value.subjectId !== subjectId ||
              (req.query.kind === 'capacity_role_scope'
                ? !(value.role === null || ROLE.test(value.role || ''))
                : value.role !== reviewRole) ||
              !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 ||
              !(value.expectedDigest === 'none' || DIGEST.test(value.expectedDigest || '')) ||
              ((value.expectedRevision === 0) !== (value.expectedDigest === 'none')) ||
              typeof value.sourceCurrent !== 'boolean' || !common(value)) return null;
          if (value.expectedRevision === 0) {
            if (value.reviewId !== null || value.action !== null || value.role !== null || value.sourceCurrent) return null;
          } else if (!UUID.test(value.reviewId || '') ||
              !['approve', 'reject', 'withdraw'].includes(value.action)) return null;
          return value;
        },
      });
    });

  router.post('/epochs', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, ['reason', 'confirmed', 'confirmationVersion']) ||
          typeof req.body.reason !== 'string' || req.body.reason.trim().length < 10 ||
          req.body.reason.length > 1000 || req.body.confirmed !== true ||
          req.body.confirmationVersion !== 'm26-workload-capacity-epoch-v1' || !KEY.test(key || ''))
        return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_epoch_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
        params: [req.get('X-CSRF-Token'), key, req.body.reason, req.body.confirmationVersion],
        validate(value) {
          const result = safeReceipt(value, 'workload_capacity_epoch_recorded',
            ['revision', 'installedAt']);
          return result && Number.isSafeInteger(result.revision) && result.revision >= 1 &&
            instant(result.installedAt) ? result : null;
        } });
    });

  router.post('/reviews', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key'); const body = req.body;
      if (!exact(req.query, []) || !exact(body, ['kind', 'target', 'subjectId', 'role',
        'action', 'expectedRevision', 'expectedDigest', 'remainingPersonMinutes', 'reason',
        'confirmed', 'confirmationVersion']) || !REVIEW_KINDS.includes(body.kind) ||
          !TARGETS.includes(body.target) || !['approve', 'reject', 'withdraw'].includes(body.action) ||
          !(body.subjectId === null || UUID.test(body.subjectId || '')) ||
          !(body.role === null || ROLE.test(body.role || '')) ||
          !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
          !(body.expectedDigest === 'none' || DIGEST.test(body.expectedDigest || '')) ||
          ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
          !(body.remainingPersonMinutes === null || (Number.isSafeInteger(body.remainingPersonMinutes) &&
            body.remainingPersonMinutes >= 0 && body.remainingPersonMinutes <= 100000000)) ||
          !validReviewShape(body) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000 ||
          body.confirmed !== true || body.confirmationVersion !== 'm26-workload-capacity-review-v1' ||
          !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_review_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) value',
        params: [req.get('X-CSRF-Token'), key, body.kind, body.target, body.subjectId,
          body.role, body.action, body.expectedRevision, body.expectedDigest,
          body.remainingPersonMinutes, body.reason, body.confirmationVersion],
        validate(value) {
          const result = safeReceipt(value, 'workload_capacity_review_recorded',
            ['kind', 'target', 'subjectId', 'role', 'action', 'revision']);
          if (!result || !REVIEW_KINDS.includes(result.kind) || !TARGETS.includes(result.target) ||
              !(result.subjectId === null || UUID.test(result.subjectId || '')) ||
              !(result.role === null || ROLE.test(result.role || '')) ||
              !['approve', 'reject', 'withdraw'].includes(result.action) ||
              !Number.isSafeInteger(result.revision) || result.revision < 1 ||
              !validReviewShape({ ...result, remainingPersonMinutes: body.remainingPersonMinutes })) return null;
          return result;
        } });
    });

  router.post('/windows/finalize', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key'); const body = req.body;
      if (!exact(req.query, []) || !exact(body, ['windowStart', 'windowEnd', 'reason']) ||
          !instant(body.windowStart) || !instant(body.windowEnd) ||
          Date.parse(body.windowEnd) <= Date.parse(body.windowStart) ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.length > 1000 || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_window_finalize($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
        params: [req.get('X-CSRF-Token'), key, body.windowStart, body.windowEnd, body.reason],
        validate(value) {
          const result = safeReceipt(value, 'workload_capacity_window_finalized',
            ['windowStart', 'windowEnd', 'capacityRole', 'sourceCounts']);
          return result && instant(result.windowStart) && instant(result.windowEnd) &&
            ROLE.test(result.capacityRole || '') &&
            exact(result.sourceCounts, ['labor', 'backlog', 'capacity']) &&
            Object.values(result.sourceCounts).every(count => Number.isSafeInteger(count) && count >= 0)
            ? result : null;
        } });
    });

  router.post('/origins', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, ['reason', 'confirmed', 'confirmationVersion']) ||
          typeof req.body.reason !== 'string' || req.body.reason.trim().length < 10 ||
          req.body.reason.length > 900 || req.body.confirmed !== true ||
          req.body.confirmationVersion !== 'm26-workload-capacity-origin-v1' || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
        params: [req.get('X-CSRF-Token'), key, req.body.reason, req.body.confirmationVersion],
        validate: safeOrigin });
    });

  router.get('/origins/:id', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!exact(req.query, []) || !UUID.test(req.params.id || '')) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_origin_read($1,$2,$3,$4,$5) value',
        params: [req.params.id], validate: value => safeOrigin(value, req.params.id) });
    });

  router.post('/origins/:id/evaluations', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, []) || !UUID.test(req.params.id || '') ||
          !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_evaluation_capture($1,$2,$3,$4,$5,$6,$7) value',
        params: [req.get('X-CSRF-Token'), key, req.params.id],
        validate: value => safeEvaluation(value, req.params.id) });
    });

  router.get('/origins/:originId/evaluations/:id', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!exact(req.query, []) || !UUID.test(req.params.originId || '') ||
          !UUID.test(req.params.id || '')) return invalid(res);
      return run(req, res, {
        sql: 'SELECT public.canonical_forecast_workload_capacity_v1_evaluation_read($1,$2,$3,$4,$5,$6) value',
        params: [req.params.originId, req.params.id],
        validate: value => safeEvaluation(value, req.params.originId, req.params.id) });
    });

  return router;
}

module.exports = { createForecastWorkloadCapacityRouter, safeOrigin, safeEvaluation };
