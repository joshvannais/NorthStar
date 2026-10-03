'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const PURPOSES = ['seasonal_inbound', 'pipeline_first_booking'];
const SEASONAL_STATES = new Set(['repeated_high', 'repeated_low', 'repeated_neutral',
  'authenticated_complete_zero_no_signal']);

function exact(value, keys) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function invalid(res) {
  return res.status(400).json({ success: false, error: {
    category: 'FORECAST_DEMAND_TO_SCHEDULE_REQUEST_INVALID',
    message: 'Check the research request and try again.',
  } });
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 : error?.code === '22023' ? 400 :
    ['23505', '40001', '40P01', '55P03'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_DEMAND_TO_SCHEDULE_RESTRICTED' :
      status === 400 ? 'FORECAST_DEMAND_TO_SCHEDULE_REQUEST_INVALID' :
        error?.code === '23505' ? 'FORECAST_DEMAND_TO_SCHEDULE_REQUEST_REUSED' :
          status === 409 ? 'FORECAST_DEMAND_TO_SCHEDULE_CHANGED' :
            'FORECAST_DEMAND_TO_SCHEDULE_UNAVAILABLE',
    message: status === 403 ? 'You cannot access this research evidence.' :
      status === 400 ? 'Check the research request and try again.' :
        error?.code === '23505' ? 'This request key was already used with different details.' :
          status === 409 ? 'The source changed. Refresh and try again.' :
            'The research evidence is temporarily unavailable.',
  } });
}

function instant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function commonFlags(value) {
  return value && value.researchOnly === true && value.forecastIssued === false &&
    value.paidNumericServing === false && value.forecastServingEnabled === false;
}
const PRIVATE_RESULT_KEYS = new Set(['probability', 'outputDigest', 'privateOutput',
  'privatePoint', 'expectedCount', 'actualLeadCount', 'actualFirstBookedCount',
  'absoluteError', 'members', 'periods', 'evidence', 'privateMetrics']);
function hasPrivatePoison(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).some(key => PRIVATE_RESULT_KEYS.has(key));
}
function unavailable(value, prefix, withheldKey) {
  const state = `${prefix}_unavailable`;
  if (!value || value.state !== state || typeof value.reason !== 'string' || !value.reason ||
      !commonFlags(value) || value[withheldKey] !== true) return null;
  return { state, reason: value.reason, researchOnly: true, [withheldKey]: true,
    forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false };
}

function safeOrigin(value, kind, expectedId = null) {
  if (value === null) return { state: 'not_found' };
  if (hasPrivatePoison(value)) return null;
  const prefix = kind === 'seasonal' ? 'seasonal_origin' : 'pipeline_origin';
  const withheld = kind === 'seasonal' ? 'amountWithheld' : 'countWithheld';
  if (value?.state === `${prefix}_unavailable`) return unavailable(value, prefix, withheld);
  if (value?.state === `${prefix}_stale`) {
    if (!UUID.test(value.id || '') || value.refreshRequired !== true || !commonFlags(value) ||
        value[withheld] !== true || value.outputDigestWithheld !== true) return null;
    return { state: value.state, id: value.id, refreshRequired: true, researchOnly: true,
      [withheld]: true, outputDigestWithheld: true, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false };
  }
  if (!value || ![`${prefix}_saved`, `${prefix}_current`].includes(value.state) ||
      !UUID.test(value.id || '') || (expectedId && value.id !== expectedId) ||
      !commonFlags(value) || value[withheld] !== true || value.outputDigestWithheld !== true) return null;
  if (kind === 'seasonal') {
    if (!MONTH.test(value.localHorizonStart || '') ||
        (value.horizonStartsAt !== undefined && !instant(value.horizonStartsAt)) ||
        (value.horizonEndsAt !== undefined && !instant(value.horizonEndsAt)) ||
        (value.replayed !== undefined && typeof value.replayed !== 'boolean')) return null;
    const result = { state: value.state, id: value.id,
      localHorizonStart: value.localHorizonStart, researchOnly: true,
      amountWithheld: true, outputDigestWithheld: true, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false };
    if (value.horizonStartsAt !== undefined) {
      result.horizonStartsAt = value.horizonStartsAt;
      result.horizonEndsAt = value.horizonEndsAt;
    }
    if (value.seasonalSignalState !== undefined) {
      if (!SEASONAL_STATES.has(value.seasonalSignalState)) return null;
      result.seasonalSignalState = value.seasonalSignalState;
    }
    if (value.replayed !== undefined) result.replayed = value.replayed;
    return result;
  }
  if (!instant(value.predictionCutoffAt) || !instant(value.horizonEndsAt) ||
      (value.replayed !== undefined && typeof value.replayed !== 'boolean')) return null;
  const result = { state: value.state, id: value.id,
    predictionCutoffAt: value.predictionCutoffAt, horizonEndsAt: value.horizonEndsAt,
    researchOnly: true, countWithheld: true, outputDigestWithheld: true,
    forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false };
  if (value.replayed !== undefined) result.replayed = value.replayed;
  return result;
}

function safeEvaluation(value, kind, expectedOrigin = null) {
  if (value === null) return { state: 'not_found' };
  if (hasPrivatePoison(value)) return null;
  const prefix = `${kind}_evaluation`;
  if (value?.state === `${prefix}_unavailable`) return unavailable(value, prefix, 'metricsWithheld');
  if (!value || ![`${prefix}_saved`, `${prefix}_current`, `${prefix}_stale`].includes(value.state) ||
      !UUID.test(value.id || '') || !UUID.test(value.originId || '') ||
      (expectedOrigin && value.originId !== expectedOrigin) || !commonFlags(value) ||
      value.metricsWithheld !== true) return null;
  if (value.state.endsWith('_stale')) {
    if (value.refreshRequired !== true) return null;
    return { state: value.state, id: value.id, originId: value.originId, refreshRequired: true,
      researchOnly: true, metricsWithheld: true, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false };
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 ||
      (value.replayed !== undefined && typeof value.replayed !== 'boolean') ||
      (value.evaluatedAt !== undefined && !instant(value.evaluatedAt))) return null;
  const result = { state: value.state, id: value.id, originId: value.originId,
    revision: value.revision, researchOnly: true, metricsWithheld: true,
    forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false };
  if (value.replayed !== undefined) result.replayed = value.replayed;
  if (value.evaluatedAt !== undefined) result.evaluatedAt = value.evaluatedAt;
  return result;
}

function safePrerequisites(value) {
  if (!value || !exact(value, ['state', 'profile', 'seasonal', 'pipeline',
    'researchOnly', 'automaticActionTaken', 'forecastIssued', 'paidNumericServing',
    'forecastServingEnabled']) || value.state !== 'demand_ui_prerequisites_current' ||
      value.researchOnly !== true || value.automaticActionTaken !== false ||
      value.forecastIssued !== false || value.paidNumericServing !== false ||
      value.forecastServingEnabled !== false || !exact(value.profile, ['state', 'anchorId']) ||
      !['current', 'unavailable'].includes(value.profile.state) ||
      (value.profile.state === 'current' ? !UUID.test(value.profile.anchorId || '') :
        value.profile.anchorId !== null)) return null;
  const project = (item, purpose, target) => {
    if (!exact(item, ['purpose', 'targetKey', 'targetVersion', 'calculationVersion',
      'method', 'epoch']) || item.purpose !== purpose || item.targetKey !== target ||
        item.targetVersion !== 'v1' || typeof item.calculationVersion !== 'string' ||
        !item.calculationVersion || !exact(item.method,
          ['expectedRevision', 'expectedDigest', 'action', 'approved']) ||
        !Number.isSafeInteger(item.method.expectedRevision) || item.method.expectedRevision < 0 ||
        item.method.expectedRevision > 10000 || !(item.method.expectedDigest === 'none' ||
          DIGEST.test(item.method.expectedDigest || '')) ||
        ((item.method.expectedRevision === 0) !== (item.method.expectedDigest === 'none')) ||
        ![null, 'approve', 'reject'].includes(item.method.action) ||
        item.method.approved !== (item.method.action === 'approve') ||
        !exact(item.epoch, ['state', 'id', 'revision', 'installedAt']) ||
        !['missing', 'current', 'stale'].includes(item.epoch.state)) return null;
    if (item.epoch.state === 'missing') {
      if (item.epoch.id !== null || item.epoch.revision !== null ||
          item.epoch.installedAt !== null) return null;
    } else if (!UUID.test(item.epoch.id || '') ||
        !Number.isSafeInteger(item.epoch.revision) || item.epoch.revision < 1 ||
        !instant(item.epoch.installedAt)) return null;
    return { purpose: item.purpose, targetKey: item.targetKey,
      targetVersion: item.targetVersion, calculationVersion: item.calculationVersion,
      method: { expectedRevision: item.method.expectedRevision,
        expectedDigest: item.method.expectedDigest, action: item.method.action,
        approved: item.method.approved }, epoch: { state: item.epoch.state,
        id: item.epoch.id, revision: item.epoch.revision,
        installedAt: item.epoch.installedAt } };
  };
  const seasonal = project(value.seasonal, 'seasonal_inbound', 'demand.inbound_leads');
  const pipeline = project(value.pipeline, 'pipeline_first_booking',
    'demand.pipeline_first_accepted_bookings');
  if (!seasonal || !pipeline) return null;
  return { state: value.state, profile: { state: value.profile.state,
    anchorId: value.profile.anchorId }, seasonal, pipeline, researchOnly: true,
  automaticActionTaken: false, forecastIssued: false, paidNumericServing: false,
  forecastServingEnabled: false };
}

function createForecastDemandToScheduleRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-demand-to-schedule:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const writeThrottle = options.writeThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-demand-to-schedule-write:${req.tenantContext.organizationId}`);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer'); res.vary('Cookie'); next(); });

  async function run(req, res, { write = false, serializable = false, sql, params, validate }) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query(serializable ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const value = (await client.query(sql, [...identity, ...params])).rows[0]?.value;
      const data = validate(value); if (!data) throw new Error('Invalid demand-to-schedule projection');
      await client.query('COMMIT');
      if (write && value?.replayed === true) res.set('Idempotency-Replayed', 'true');
      return res.status(write && value?.replayed === false ? 201 : 200).json({ success: true, data });
    } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error); } finally { if (client) client.release(); }
  }

  router.get('/prerequisites/current', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!exact(req.query, [])) return invalid(res);
      return run(req, res, {
        sql: `SELECT public.canonical_forecast_demand_ui_prerequisites_v1_read(
          $1,$2,$3,$4) value`, params: [], validate: safePrerequisites,
      });
    });

  router.post('/epochs', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key'), body = req.body;
      if (!exact(req.query, []) || !exact(body, ['purpose', 'profileAnchorId']) ||
          !PURPOSES.includes(body.purpose) || !UUID.test(body.profileAnchorId || '') ||
          !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_demand_schedule_epoch_v1_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
        params: [req.get('X-CSRF-Token'), key, body.purpose, body.profileAnchorId], validate(value) {
          if (value?.state === 'demand_schedule_epoch_unavailable') {
            if (typeof value.reason !== 'string') return null;
            return { state: value.state, reason: value.reason };
          }
          if (!value || value.state !== 'demand_schedule_epoch_recorded' ||
              !UUID.test(value.id || '') || !PURPOSES.includes(value.purpose) ||
              !instant(value.installedAt) || !DIGEST.test(value.digest || '') ||
              typeof value.replayed !== 'boolean') return null;
          return { state: value.state, id: value.id, purpose: value.purpose,
            installedAt: value.installedAt, digest: value.digest, replayed: value.replayed };
        } });
    });

  router.post('/method-reviews', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key'), body = req.body;
      if (!exact(req.query, []) || !exact(body, ['purpose', 'action', 'expectedRevision',
        'expectedDigest', 'reason', 'confirmed', 'confirmationVersion']) ||
        !PURPOSES.includes(body.purpose) || !['approve', 'reject'].includes(body.action) ||
        !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
        body.expectedRevision > 10000 || !(body.expectedDigest === 'none' ||
          DIGEST.test(body.expectedDigest || '')) ||
        ((body.expectedRevision === 0) !== (body.expectedDigest === 'none')) ||
        typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
        body.reason.length > 1000 || body.confirmed !== true ||
        body.confirmationVersion !== 'm26-demand-schedule-method-review-v1' ||
        !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true,
        sql: 'SELECT public.canonical_forecast_demand_schedule_method_review_v1_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
        params: [req.get('X-CSRF-Token'), key, body.purpose, body.action,
          body.expectedRevision, body.expectedDigest, body.reason, body.confirmationVersion],
        validate(value) {
          if (!value || value.state !== 'demand_schedule_method_review_recorded' ||
              !UUID.test(value.id || '') || !PURPOSES.includes(value.purpose) ||
              !Number.isSafeInteger(value.revision) || value.revision < 1 ||
              !['approve', 'reject'].includes(value.action) || !DIGEST.test(value.digest || '') ||
              typeof value.replayed !== 'boolean') return null;
          return { state: value.state, id: value.id, purpose: value.purpose,
            revision: value.revision, action: value.action, digest: value.digest,
            replayed: value.replayed, researchOnly: true, automaticActionTaken: false };
        } });
    });

  router.post('/backlog-facts', auth, requirePermission('forecast', 'update'), writeThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exact(req.query, []) || !exact(req.body, []) || !KEY.test(key || '')) return invalid(res);
      return run(req, res, { write: true, serializable: true,
        sql: 'SELECT public.canonical_forecast_demand_schedule_backlog_v1_capture($1,$2,$3,$4,$5,$6) value',
        params: [req.get('X-CSRF-Token'), key], validate(value) {
          if (value?.state === 'backlog_fact_stale' && UUID.test(value.id || '') &&
              value.refreshRequired === true && value.knownSubsetOnly === true &&
              value.wholeBusinessCoverageVerified === false && value.researchOnly === true &&
              value.forecastIssued === false) {
            return { state: value.state, id: value.id, refreshRequired: true,
              knownSubsetOnly: true, wholeBusinessCoverageVerified: false,
              researchOnly: true, forecastIssued: false };
          }
          if (value?.state === 'backlog_fact_unavailable') {
            if (typeof value.reason !== 'string') return null;
            return { state: value.state, reason: value.reason, researchOnly: true,
              forecastIssued: false };
          }
          if (!value || value.state !== 'backlog_fact_saved' || !UUID.test(value.id || '') ||
              !UUID.test(value.backlogSnapshotId || '') || !DIGEST.test(value.factDigest || '') ||
              typeof value.replayed !== 'boolean' || value.researchOnly !== true ||
              value.forecastIssued !== false) return null;
          return { state: value.state, id: value.id, backlogSnapshotId: value.backlogSnapshotId,
            factDigest: value.factDigest, replayed: value.replayed, knownSubsetOnly: true,
            wholeBusinessCoverageVerified: false, researchOnly: true, forecastIssued: false };
        } });
    });

  router.get('/backlog-facts/:factId', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      const id = String(req.params.factId || '').toLowerCase();
      if (!UUID.test(id) || !exact(req.query, [])) return invalid(res);
      return run(req, res, { sql: 'SELECT public.canonical_forecast_demand_schedule_backlog_v1_read($1,$2,$3,$4,$5) value', params: [id], validate(value) {
        if (value === null) return { state: 'not_found' };
        if (!value || !['backlog_fact_current', 'backlog_fact_stale'].includes(value.state) ||
            value.id !== id || value.researchOnly !== true || value.forecastIssued !== false ||
            value.knownSubsetOnly !== true || value.wholeBusinessCoverageVerified !== false) return null;
        if (value.state === 'backlog_fact_stale' && value.refreshRequired !== true) return null;
        if (value.state === 'backlog_fact_current' &&
            (!UUID.test(value.backlogSnapshotId || '') || !DIGEST.test(value.factDigest || ''))) {
          return null;
        }
        return value.state === 'backlog_fact_stale' ? { state: value.state, id,
          refreshRequired: true, knownSubsetOnly: true, wholeBusinessCoverageVerified: false,
          researchOnly: true, forecastIssued: false } : { state: value.state, id,
          backlogSnapshotId: value.backlogSnapshotId, factDigest: value.factDigest,
          knownSubsetOnly: true, wholeBusinessCoverageVerified: false,
          researchOnly: true, forecastIssued: false };
      } });
    });

  const originPost = (kind, sql, bodyKeys, params) => async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!exact(req.query, []) || !exact(req.body, bodyKeys) || !KEY.test(key || '') ||
        (kind === 'seasonal' && !MONTH.test(req.body.horizonMonth || ''))) return invalid(res);
    return run(req, res, { write: true, sql, params: [req.get('X-CSRF-Token'), key, ...params(req)],
      validate: value => safeOrigin(value, kind) });
  };
  router.post('/seasonal-origins', auth, requirePermission('forecast', 'update'), writeThrottle,
    originPost('seasonal', 'SELECT public.canonical_forecast_seasonal_origin_v1_capture($1,$2,$3,$4,$5,$6,$7::date) value', ['horizonMonth'], req => [req.body.horizonMonth]));
  router.post('/pipeline-origins', auth, requirePermission('forecast', 'update'), writeThrottle,
    originPost('pipeline', 'SELECT public.canonical_forecast_pipeline_origin_v1_capture($1,$2,$3,$4,$5,$6) value', [], () => []));

  for (const kind of ['seasonal', 'pipeline']) {
    router.get(`/${kind}-origins/:originId`, auth, requirePermission('forecast', 'read'), throttle,
      async (req, res) => { const id = String(req.params.originId || '').toLowerCase();
        if (!UUID.test(id) || !exact(req.query, [])) return invalid(res);
        return run(req, res, { sql: `SELECT public.canonical_forecast_${kind}_origin_v1_read($1,$2,$3,$4,$5) value`,
          params: [id], validate: value => safeOrigin(value, kind, id) }); });
    router.post(`/${kind}-origins/:originId/evaluations`, auth,
      requirePermission('forecast', 'update'), writeThrottle, async (req, res) => {
        const id = String(req.params.originId || '').toLowerCase(), key = req.get('Idempotency-Key');
        if (!UUID.test(id) || !exact(req.query, []) || !exact(req.body, []) ||
            !KEY.test(key || '')) return invalid(res);
        return run(req, res, { write: true,
          sql: `SELECT public.canonical_forecast_${kind}_evaluation_v1_capture($1,$2,$3,$4,$5,$6,$7) value`,
          params: [req.get('X-CSRF-Token'), key, id],
          validate: value => safeEvaluation(value, kind, id) });
      });
    router.get(`/${kind}-evaluations/:evaluationId`, auth,
      requirePermission('forecast', 'read'), throttle, async (req, res) => {
        const id = String(req.params.evaluationId || '').toLowerCase();
        if (!UUID.test(id) || !exact(req.query, [])) return invalid(res);
        return run(req, res, {
          sql: `SELECT public.canonical_forecast_${kind}_evaluation_v1_read($1,$2,$3,$4,$5) value`,
          params: [id], validate: value => safeEvaluation(value, kind) });
      });
  }
  return router;
}

module.exports = { createForecastDemandToScheduleRouter, safeOrigin, safeEvaluation,
  safePrerequisites };
