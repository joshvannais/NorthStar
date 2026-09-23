'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../forecasting/forecastSettingsRepository');

function actor(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id,
    csrfToken: req.get('X-CSRF-Token'),
    idempotencyKey: req.get('Idempotency-Key') };
}
function replyError(res, error) {
  const status = error?.status || (error?.code === '42501' ? 403 :
    ['40001', '55P03', '23505'].includes(error?.code) ? 409 : 503);
  const category = error?.status ? error.code : status === 403 ?
    'FORECAST_ACCESS_RESTRICTED' : error?.code === '55P03' ?
      'FORECAST_SETTINGS_BUSY' : status === 409 ?
        'FORECAST_SETTINGS_CHANGED' : 'FORECAST_SETTINGS_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'Forecast settings access is restricted.' : error?.code === '55P03' ?
      'Forecast settings are busy. Try again shortly.' : status === 409 ?
        'Forecast settings changed. Refresh and try again.' :
        'Forecast settings are temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}

function createForecastSettingsRouter(options = {}) {
  const router = express.Router();
  const pool = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-settings:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie'); next();
  });
  router.get('/', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (Object.keys(req.query).length !== 0) return res.status(400).json({
        success: false, error: { category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast settings request is invalid.' },
      });
      try {
        const settings = await repository.readCurrent(pool(), actor(req));
        return res.json({ success: true, data: { settings,
          forecastIssued: false, sourceEligibilityVerified: false } });
      } catch (error) { return replyError(res, error); }
    });
  router.post('/', auth, requirePermission('forecast', 'update'), throttle,
    async (req, res) => {
      try {
        const saved = await repository.capture(pool(), actor(req), req.body);
        if (saved.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(saved.replayed ? 200 : 201).json({ success: true,
          data: { settings: saved.settings, replayed: saved.replayed,
            forecastIssued: false, sourceEligibilityVerified: false } });
      } catch (error) { return replyError(res, error); }
    });
  return router;
}

module.exports = { createForecastSettingsRouter };
