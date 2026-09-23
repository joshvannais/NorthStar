'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { deriveApprovedEstimateStockFeature } =
  require('../forecasting/approvedEstimateStockFeature');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createForecastFeaturesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-feature:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  router.get('/approved-estimate-stock/:snapshotId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId) || Object.keys(req.query).length !== 0) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The feature request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const org = req.tenantContext.organizationId;
        const result = await client.query(
          'SELECT public.canonical_forecast_estimate_decision_lineage_read($1,$2,$3,$4,$5) value',
          [org, req.tenantContext.userId, req.userRole,
            req.authSession.id, req.params.snapshotId]);
        const source = result.rows[0]?.value;
        if (source === null) {
          await client.query('COMMIT');
          return res.status(404).json({ success: false, error: {
            category: 'FORECAST_SOURCE_UNAVAILABLE',
            message: 'Forecast feature history is unavailable.',
          } });
        }
        const feature = deriveApprovedEstimateStockFeature(source, org);
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          version: feature.version, state: feature.state,
          reason: feature.reason, amount: feature.amount, unit: feature.unit,
          asOf: feature.asOf, sourceSnapshotDigest: feature.sourceSnapshotDigest,
          definitionDigest: feature.definitionDigest,
          sourceAuthenticated: true, forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        const status = error?.code === '42501' ? 403 :
          ['40001', '40P01', '55P03', '54000'].includes(error?.code) ? 409 : 503;
        return res.status(status).json({ success: false, error: {
          category: status === 403 ? 'FORECAST_ACCESS_RESTRICTED' :
            status === 409 ? 'FORECAST_SOURCE_CHANGED' : 'FORECAST_SOURCE_UNAVAILABLE',
          message: status === 403 ? 'Forecast feature access is restricted.' :
            status === 409 ? 'Forecast source changed. Refresh and try again.' :
              'Forecast feature history is temporarily unavailable.',
        } });
      } finally { if (client) client.release(); }
    });

  return router;
}

module.exports = { createForecastFeaturesRouter };
