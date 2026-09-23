'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { deriveApprovedEstimateStockFeature } =
  require('../forecasting/approvedEstimateStockFeature');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function createForecastFeaturesRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-feature:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-feature:${req.tenantContext.organizationId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  router.post('/approved-estimate-stock/snapshots', auth,
    requirePermission('forecast', 'update'), captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!req.body || typeof req.body !== 'object' ||
          Array.isArray(req.body) || Object.keys(req.body).length !== 0 ||
          Object.keys(req.query).length !== 0 || !KEY.test(key || '')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The source capture request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const org = req.tenantContext.organizationId;
        const result = await client.query(
          'SELECT public.canonical_forecast_estimate_decision_snapshot_capture($1,$2,$3,$4,$5,$6) value',
          [org, req.tenantContext.userId, req.userRole, req.authSession.id,
            req.get('X-CSRF-Token'), key]);
        const value = result.rows[0]?.value;
        const snapshot = value?.snapshot;
        if (!snapshot || !UUID.test(snapshot.id || '') ||
            snapshot.organizationId !== org ||
            snapshot.version !== 'm26-as-of-source-manifest-v1' ||
            snapshot.purposeKey !== 'forecast_pipeline' ||
            snapshot.targetKey !== 'pipeline.approved_estimates' ||
            !INSTANT.test(snapshot.asOf || '') ||
            snapshot.asOf !== snapshot.capturedAt ||
            !DIGEST.test(snapshot.sourceSnapshotDigest || '') ||
            !Number.isSafeInteger(snapshot.sourceCount) ||
            snapshot.sourceCount < 0 || snapshot.sourceCount > 1000 ||
            value.replayed !== true && value.replayed !== false) {
          throw new Error('Invalid guarded forecast source receipt');
        }
        await client.query('COMMIT');
        if (value.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(value.replayed ? 200 : 201).json({ success: true, data: {
          state: 'historical_source_only', snapshotId: snapshot.id,
          asOf: snapshot.asOf, sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
          sourceCount: snapshot.sourceCount, replayed: value.replayed,
          sourceAuthenticated: true, forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        const status = error?.code === '42501' ? 403 :
          ['40001', '40P01', '55P03', '54000', '23505'].includes(error?.code) ? 409 : 503;
        return res.status(status).json({ success: false, error: {
          category: status === 403 ? 'FORECAST_ACCESS_RESTRICTED' :
            status === 409 ? 'FORECAST_SOURCE_CHANGED' : 'FORECAST_SOURCE_UNAVAILABLE',
          message: status === 403 ? 'Forecast source access is restricted.' :
            status === 409 ? 'Forecast source changed. Refresh and try again.' :
              'Forecast source is temporarily unavailable.',
        } });
      } finally { if (client) client.release(); }
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
