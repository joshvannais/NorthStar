'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { deriveApprovedEstimateStockFeature } =
  require('../forecasting/approvedEstimateStockFeature');
const { captureView: approvedEstimateV2CaptureView,
  readView: approvedEstimateV2ReadView } =
  require('../forecasting/approvedEstimateAsOfV2');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DIGEST = /^[0-9a-f]{64}$/;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function actor(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, authSessionId: req.authSession.id,
    actorAccessRole: req.userRole };
}

function errorReply(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['40001', '40P01', '55P03', '54000', '23505'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_ACCESS_RESTRICTED' :
      error?.code === '54000' ? 'FORECAST_SOURCE_CAPACITY' :
        ['55P03', '57014'].includes(error?.code) ? 'FORECAST_SOURCE_BUSY' :
        status === 409 ? 'FORECAST_SOURCE_CHANGED' : 'FORECAST_SOURCE_UNAVAILABLE',
    message: status === 403 ? 'Forecast feature access is restricted.' :
      error?.code === '54000' ? 'There is too much history to capture safely.' :
        ['55P03', '57014'].includes(error?.code) ?
          'Forecast source is busy. Try again shortly.' :
        status === 409 ? 'Forecast source changed. Refresh and try again.' :
          'Forecast feature history is temporarily unavailable.',
  } });
}

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

  router.post('/approved-estimate-stock/v2/snapshots', auth,
    requirePermission('forecast', 'update'), captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exactKeys(req.body, []) || !KEY.test(key || '')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The feature snapshot request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const response = await client.query(
          'SELECT public.canonical_forecast_approved_estimate_v2_capture($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.get('X-CSRF-Token'), key]);
        const view = approvedEstimateV2CaptureView(response.rows[0]?.value,
          identity.organizationId);
        await client.query('COMMIT');
        if (view.state === 'unavailable') {
          return res.status(409).json({ success: false, error: {
            category: 'FORECAST_SOURCE_UNAVAILABLE',
            message: 'Complete approved-estimate coverage is unavailable.',
          }, data: view });
        }
        if (view.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(view.replayed ? 200 : 201).json({ success: true, data: view });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/approved-estimate-stock/v2/:snapshotId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId) || Object.keys(req.query).length !== 0) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The feature request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const result = await client.query(
          'SELECT public.canonical_forecast_approved_estimate_v2_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.params.snapshotId]);
        if (result.rows[0]?.value === null) {
          await client.query('COMMIT');
          return res.status(404).json({ success: false, error: {
            category: 'FORECAST_SOURCE_UNAVAILABLE',
            message: 'Forecast feature history is unavailable.',
          } });
        }
        const view = approvedEstimateV2ReadView(result.rows[0]?.value,
          identity.organizationId);
        await client.query('COMMIT');
        return res.json({ success: true, data: view });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/approved-estimate-stock/snapshots', auth,
    requirePermission('forecast', 'update'), captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exactKeys(req.body, []) || !KEY.test(key || '')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The feature snapshot request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const response = await client.query(
          'SELECT public.canonical_forecast_estimate_decision_snapshot_capture($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.get('X-CSRF-Token'), key]);
        const captured = response.rows[0]?.value;
        const snapshot = captured?.snapshot;
        if (!snapshot || (captured.replayed !== true && captured.replayed !== false) ||
            snapshot.version !== 'm26-as-of-source-manifest-v1' ||
            snapshot.organizationId !== identity.organizationId ||
            snapshot.purposeKey !== 'forecast_pipeline' ||
            snapshot.targetKey !== 'pipeline.approved_estimates' ||
            !UUID.test(snapshot.id || '') ||
            !INSTANT.test(snapshot.asOf || '') || snapshot.asOf !== snapshot.capturedAt ||
            !Number.isSafeInteger(snapshot.sourceCount) || snapshot.sourceCount < 0 ||
            snapshot.sourceCount > 1000 || !DIGEST.test(snapshot.sourceSnapshotDigest || '')) {
          throw new Error('Invalid guarded feature snapshot receipt');
        }
        await client.query('COMMIT');
        if (captured.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(captured.replayed ? 200 : 201).json({ success: true, data: {
          state: 'historical_source_only', snapshotId: snapshot.id,
          asOf: snapshot.asOf, sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
          sourceCount: snapshot.sourceCount, replayed: captured.replayed === true,
          sourceAuthenticated: true, forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
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
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  return router;
}

module.exports = { createForecastFeaturesRouter };
