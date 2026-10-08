'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../forecasting/forecastSettingsRepository');

function actor(req, mutation) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id,
    ...(mutation ? { csrfToken: req.get('X-CSRF-Token'),
      idempotencyKey: req.get('Idempotency-Key') } : {}) };
}
function projection(result) {
  return { ...result,
    targetRegistrationProvenByPreference: false,
    algorithmPromotionProvenByPreference: false,
    sourceAuthorityProvenByPreference: false,
    intervalCalibrationProvenByPreference: false,
    actualFinalityProvenByPreference: false,
    issuanceEligibilityProvenByPreference: false,
    forecastIssued: false, calibratedRangeIssued: false,
    automaticActionAuthorized: false };
}
function replyError(res, error) {
  const status = error?.status || (error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 :
      ['40001','40P01','55P03','23505'].includes(error?.code) ? 409 : 503);
  const category = error?.status ? error.code : status === 403 ?
    'FORECAST_SETTINGS_ACCESS_RESTRICTED' : status === 400 ?
      'FORECAST_SETTINGS_REQUEST_INVALID' : error?.code === '55P03' ?
        'FORECAST_SETTINGS_BUSY' : status === 409 ?
          'FORECAST_SETTINGS_CHANGED' : 'FORECAST_SETTINGS_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'Forecast settings access is restricted.' : status === 400 ?
      'Check the forecast settings request and try again.' :
      error?.code === '55P03' ? 'Forecast settings are busy. Try again shortly.' :
        status === 409 ? 'Forecast settings changed. Refresh and review again.' :
          'Forecast settings are temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}

function createForecastSettingsRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const readPermission = options.readPermission || requirePermission('forecast', 'read');
  const updatePermission = options.updatePermission || requirePermission('forecast', 'update');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-settings:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie'); next();
  });
  router.get('/', auth, readPermission, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return replyError(res, {
      status: 400, code: 'FORECAST_SETTINGS_REQUEST_INVALID',
      message: 'Check the forecast settings request and try again.',
    });
    try {
      return res.json({ success: true,
        data: projection(await repository.readCurrent(poolProvider(), actor(req, false))) });
    } catch (error) { return replyError(res, error); }
  });
  router.post('/', auth, updatePermission, throttle, async (req, res) => {
    try {
      const saved = await repository.capture(poolProvider(), actor(req, true), req.body);
      if (saved.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(saved.replayed ? 200 : 201).json({ success: true,
        data: projection(saved) });
    } catch (error) { return replyError(res, error); }
  });
  return router;
}

module.exports = { createForecastSettingsRouter };
