'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../forecasting/forecastPaidJourneyRepository');

function actor(req, mutation) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id,
    ...(mutation ? { csrfToken: req.get('X-CSRF-Token'),
      idempotencyKey: req.get('Idempotency-Key') } : {}) };
}
function replyError(res, error) {
  const busy = ['55P03','57014'].includes(error?.code);
  const status = error?.status || (error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 : busy ? 503 :
      ['40001','40P01','23505'].includes(error?.code) ? 409 : 503);
  if (busy) res.set('Retry-After', '2');
  const category = error?.status ? error.code : status === 403 ?
    'FORECAST_PAID_JOURNEY_ACCESS_RESTRICTED' : status === 400 ?
      'FORECAST_PAID_JOURNEY_REQUEST_INVALID' : busy ?
        'FORECAST_PAID_JOURNEY_BUSY' : status === 409 ?
          'FORECAST_PAID_JOURNEY_CHANGED' : 'FORECAST_PAID_JOURNEY_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'The paid forecast journey is restricted to current owners and administrators.' :
    status === 400 ? 'Check the paid forecast journey request and try again.' :
      busy ? 'The paid forecast journey is busy. Retry shortly.' :
        status === 409 ? 'The paid forecast evidence changed. Refresh and review again.' :
          'The paid forecast journey is temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}
function createForecastPaidJourneyRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const readPermission = options.readPermission || requirePermission('forecast', 'read');
  const updatePermission = options.updatePermission || requirePermission('forecast', 'update');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-paid-journey:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store'); res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff'); res.vary('Cookie'); next();
  });
  router.get('/', auth, readPermission, throttle, async (req, res) => {
    if (Object.keys(req.query).length) return replyError(res, { status: 400,
      code: 'FORECAST_PAID_JOURNEY_REQUEST_INVALID', message: 'Check the paid forecast journey request and try again.' });
    try { return res.json({ success: true, data: await repository.current(poolProvider(), actor(req, false)) }); }
    catch (error) { return replyError(res, error); }
  });
  router.post('/issue', auth, updatePermission, throttle, async (req, res) => {
    try {
      const data = await repository.issue(poolProvider(), actor(req, true), req.body);
      if (data.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(data.replayed ? 200 : data.state === 'current' ? 201 : 200).json({ success: true, data });
    } catch (error) { return replyError(res, error); }
  });
  router.post('/:runId/rerun', auth, updatePermission, throttle, async (req, res) => {
    if (!req.body || Array.isArray(req.body) || Reflect.ownKeys(req.body).length) return replyError(res,
      { status: 400, code: 'FORECAST_PAID_JOURNEY_REQUEST_INVALID', message: 'Check the controlled rerun request and try again.' });
    try { return res.json({ success: true, data: await repository.rerun(poolProvider(), actor(req, true), req.params.runId) }); }
    catch (error) { return replyError(res, error); }
  });
  router.post('/review', auth, updatePermission, throttle, async (req, res) => {
    try {
      const data = await repository.review(poolProvider(), actor(req, true), req.body);
      if (data.state === 'replay') res.set('Idempotency-Replayed', 'true');
      return res.status(data.state === 'requested' ? 201 : 200).json({ success: true, data });
    }
    catch (error) { return replyError(res, error); }
  });
  return router;
}

module.exports = { createForecastPaidJourneyRouter, replyError };
