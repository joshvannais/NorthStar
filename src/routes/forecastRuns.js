'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../forecasting/forecastRunRepository');

function actor(req, mutation) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id,
    ...(mutation ? { csrfToken: req.get('X-CSRF-Token'),
      idempotencyKey: req.get('Idempotency-Key') } : {}) };
}
function failure(res, error) {
  const busy = ['55P03','57014'].includes(error?.code);
  const status = error?.status || (error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 : busy ? 503 :
      ['40001','40P01','23505'].includes(error?.code) ? 409 : 503);
  if (busy) res.set('Retry-After', '2');
  const category = error?.status ? error.code : status === 403 ?
    'FORECAST_RUN_ACCESS_RESTRICTED' : status === 400 ?
      'FORECAST_RUN_REQUEST_INVALID' : busy ? 'FORECAST_RUN_BUSY' :
        status === 409 ? 'FORECAST_RUN_CHANGED' : 'FORECAST_RUN_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'Forecast run access is restricted.' : status === 400 ?
      'Check the forecast run request and try again.' : busy ?
        'Forecast runs are busy. Retry shortly.' : status === 409 ?
          'Forecast run evidence changed. Refresh and review again.' :
          'Forecast runs are temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}

function createForecastRunsRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const readPermission = options.readPermission || requirePermission('forecast', 'read');
  const updatePermission = options.updatePermission || requirePermission('forecast', 'update');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-runs:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie'); next();
  });
  router.get('/currentness', auth, readPermission, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return failure(res, {
      status: 400, code: 'FORECAST_RUN_REQUEST_INVALID',
      message: 'Check the forecast currentness request and try again.' });
    try {
      return res.json({ success: true,
        data: await repository.currentness(poolProvider(), actor(req, false)) });
    } catch (error) { return failure(res, error); }
  });
  router.get('/', auth, readPermission, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return failure(res, {
      status: 400, code: 'FORECAST_RUN_REQUEST_INVALID',
      message: 'Check the forecast run request and try again.' });
    try {
      return res.json({ success: true,
        data: await repository.list(poolProvider(), actor(req, false)) });
    } catch (error) { return failure(res, error); }
  });
  router.get('/compare/:leftRunId/:rightRunId', auth, readPermission, throttle,
    async (req, res) => {
      if (Object.keys(req.query).length !== 0) return failure(res, {
        status: 400, code: 'FORECAST_RUN_REQUEST_INVALID',
        message: 'Check the forecast comparison request and try again.' });
      try {
        return res.json({ success: true, data: await repository.compare(poolProvider(),
          actor(req, false), req.params.leftRunId, req.params.rightRunId) });
      } catch (error) { return failure(res, error); }
    });
  router.post('/:runId/controlled-rerun', auth, updatePermission, throttle,
    async (req, res) => {
      if (Object.keys(req.query).length !== 0 || !req.body ||
          Object.getPrototypeOf(req.body) !== Object.prototype ||
          Reflect.ownKeys(req.body).length !== 0) return failure(res, {
        status: 400, code: 'FORECAST_RUN_REQUEST_INVALID',
        message: 'Check the controlled rerun request and try again.' });
      try {
        return res.json({ success: true,
          data: await repository.controlledRerun(poolProvider(), actor(req, true),
            req.params.runId) });
      } catch (error) { return failure(res, error); }
    });
  router.post('/', auth, updatePermission, throttle, async (req, res) => {
    try {
      const saved = await repository.capture(poolProvider(), actor(req, true), req.body);
      if (saved.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(saved.replayed ? 200 : saved.state === 'current' ? 201 : 200)
        .json({ success: true, data: saved });
    } catch (error) { return failure(res, error); }
  });
  return router;
}

module.exports = { createForecastRunsRouter };
