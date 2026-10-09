'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../forecasting/forecastHandoffRepository');

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
    'FORECAST_HANDOFF_ACCESS_RESTRICTED' : status === 400 ?
      'FORECAST_HANDOFF_REQUEST_INVALID' : busy ? 'FORECAST_HANDOFF_BUSY' :
        status === 409 ? 'FORECAST_HANDOFF_CHANGED' : 'FORECAST_HANDOFF_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'Reviewed forecast handoffs are limited to current owners and administrators.' :
    status === 400 ? 'Check the reviewed handoff request and try again.' : busy ?
      'Reviewed forecast handoffs are busy. Retry shortly.' : status === 409 ?
        'The forecast or review record changed. Refresh and review again.' :
        'Reviewed forecast handoffs are temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}

function createForecastHandoffsRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const readPermission = options.readPermission || requirePermission('forecast', 'read');
  const updatePermission = options.updatePermission || requirePermission('forecast', 'update');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-handoffs:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie'); next();
  });
  router.get('/', auth, readPermission, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return failure(res, {
      status: 400, code: 'FORECAST_HANDOFF_REQUEST_INVALID',
      message: 'Check the reviewed handoff request and try again.' });
    try {
      return res.json({ success: true,
        data: await repository.list(poolProvider(), actor(req, false)) });
    } catch (error) { return failure(res, error); }
  });
  router.post('/', auth, updatePermission, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return failure(res, {
      status: 400, code: 'FORECAST_HANDOFF_REQUEST_INVALID',
      message: 'Check the reviewed handoff request and try again.' });
    try {
      const data = await repository.requestReview(poolProvider(), actor(req, true), req.body);
      if (data.state === 'replay') res.set('Idempotency-Replayed', 'true');
      return res.status(data.state === 'created' ? 201 : 200)
        .json({ success: true, data });
    } catch (error) { return failure(res, error); }
  });
  router.post('/:proposalId/dismiss', auth, updatePermission, throttle,
    async (req, res) => {
      if (Object.keys(req.query).length !== 0) return failure(res, {
        status: 400, code: 'FORECAST_HANDOFF_REQUEST_INVALID',
        message: 'Check the reviewed handoff request and try again.' });
      try {
        const data = await repository.dismiss(poolProvider(), actor(req, true),
          req.params.proposalId, req.body);
        if (data.state === 'replay') res.set('Idempotency-Replayed', 'true');
        return res.json({ success: true, data });
      } catch (error) { return failure(res, error); }
    });
  return router;
}

module.exports = { createForecastHandoffsRouter, failure };
