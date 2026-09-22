'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { readGuardedApprovedPriceFlow } = require('../forecasting/guardedApprovedPriceFlow');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;

function errorReply(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['40001', '40P01', '54000'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_ACCESS_RESTRICTED' :
      error?.code === '54000' ? 'FORECAST_SOURCE_CAPACITY' :
        status === 409 ? 'FORECAST_SOURCE_CHANGED' : 'FORECAST_SOURCE_UNAVAILABLE',
    message: status === 403 ? 'Forecast history access is restricted.' :
      error?.code === '54000' ? 'There is too much history to capture safely.' :
        status === 409 ? 'Forecast history changed. Refresh and try again.' :
        'Forecast history is temporarily unavailable.',
  } });
}

function actor(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, authSessionId: req.authSession.id,
    actorAccessRole: req.userRole };
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function createForecastPriceHistoryRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-price-history:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-price-history:${req.tenantContext.organizationId}`);
  const readPosition = options.readPosition || readGuardedApprovedPriceFlow;
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  router.post('/snapshots', auth, requirePermission('forecast', 'update'), captureThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exactKeys(req.body, []) || !KEY.test(key || '')) return res.status(400).json({
        success: false, error: { category: 'FORECAST_REQUEST_INVALID',
          message: 'The history request is invalid.' },
      });
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const identity = actor(req);
        const response = await client.query(
          'SELECT public.canonical_forecast_price_event_snapshot_capture($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.get('X-CSRF-Token'), key]);
        const captured = response.rows[0]?.value;
        if (!captured?.snapshot || captured.snapshot.organizationId !== identity.organizationId ||
            !UUID.test(captured.snapshot.id || '') || captured.snapshot.forecastIssued === true) {
          throw new Error('Invalid guarded price history receipt');
        }
        await client.query('COMMIT');
        if (captured.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(captured.replayed ? 200 : 201).json({ success: true, data: {
          state: 'historical_source_only', snapshotId: captured.snapshot.id,
          asOf: captured.snapshot.asOf,
          sourceSnapshotDigest: captured.snapshot.sourceSnapshotDigest,
          eventCount: captured.snapshot.eventCount,
          replayed: captured.replayed === true, forecastIssued: false,
          bookedWorkMeasured: false, earnedRevenueMeasured: false,
          collectedCashMeasured: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/snapshots/:snapshotId/approved-flow', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId) ||
          !exactKeys(req.query, ['startsAt', 'endsAt', 'currency'])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The history request is invalid.',
        } });
      }
      try {
        const data = await readPosition({ pool: poolProvider(), actor: actor(req),
          snapshotId: req.params.snapshotId,
          window: { startsAt: req.query.startsAt, endsAt: req.query.endsAt },
          currency: req.query.currency });
        return res.json({ success: true, data });
      } catch (error) { return errorReply(res, error); }
    });

  return router;
}

module.exports = { createForecastPriceHistoryRouter };
