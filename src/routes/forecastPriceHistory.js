'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { readGuardedApprovedPriceFlow } = require('../forecasting/guardedApprovedPriceFlow');
const { calendarMonth, assessOrderedPriceMonthCandidate } =
  require('../forecasting/orderedPriceMonthCandidate');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const instant = value => typeof value === 'string' && INSTANT.test(value);

function errorReply(res, error) {
  const status = error?.code === '42501' ? 403 :
    ['40001', '40P01', '55P03', '54000'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_ACCESS_RESTRICTED' :
      error?.code === '54000' ? 'FORECAST_SOURCE_CAPACITY' :
        error?.code === '55P03' ? 'FORECAST_SOURCE_BUSY' :
        status === 409 ? 'FORECAST_SOURCE_CHANGED' : 'FORECAST_SOURCE_UNAVAILABLE',
    message: status === 403 ? 'Forecast history access is restricted.' :
      error?.code === '54000' ? 'There is too much history to capture safely.' :
        error?.code === '55P03' ? 'Forecast history is busy. Try again shortly.' :
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

  router.post('/ordered-snapshots', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exactKeys(req.body, []) || !KEY.test(key || '')) return res.status(400).json({
        success: false, error: { category: 'FORECAST_REQUEST_INVALID',
          message: 'The history request is invalid.' },
      });
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const identity = actor(req);
        const response = await client.query(
          'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.get('X-CSRF-Token'), key]);
        const captured = response.rows[0]?.value;
        const snapshot = captured?.snapshot;
        if (!snapshot || (captured.replayed !== true && captured.replayed !== false) ||
            snapshot.version !== 'm26-price-ordered-source-v1' ||
            snapshot.scope !== 'northstar_m24_approved_price_decisions' ||
            snapshot.organizationId !== identity.organizationId ||
            !UUID.test(snapshot.id || '') || snapshot.forecastIssued !== false ||
            snapshot.wholeBusinessCoverageVerified !== false ||
            !instant(snapshot.capturedAt) ||
            !Number.isSafeInteger(snapshot.eventCount) ||
            snapshot.eventCount < 0 || snapshot.eventCount > 1000 ||
            !Array.isArray(snapshot.events) ||
            snapshot.events.length !== snapshot.eventCount ||
            typeof snapshot.sourceSnapshotDigest !== 'string' ||
            !/^[0-9a-f]{64}$/.test(snapshot.sourceSnapshotDigest)) {
          throw new Error('Invalid guarded ordered-price receipt');
        }
        await client.query('COMMIT');
        if (captured.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(captured.replayed ? 200 : 201).json({ success: true, data: {
          state: 'source_order_receipt_only', snapshotId: snapshot.id,
          capturedAt: snapshot.capturedAt,
          sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
          eventCount: snapshot.eventCount,
          replayed: captured.replayed === true, forecastIssued: false,
          calendarPeriodVerified: false, wholeBusinessCoverageVerified: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/ordered-snapshots/:snapshotId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId) || !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The history request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const identity = actor(req);
        const response = await client.query(
          'SELECT public.canonical_forecast_price_ordered_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.params.snapshotId]);
        const value = response.rows[0]?.value;
        if (value === null) {
          await client.query('COMMIT');
          return res.status(404).json({ success: false, error: {
            category: 'FORECAST_SOURCE_UNAVAILABLE',
            message: 'Forecast history is unavailable.',
          } });
        }
        const snapshot = value?.snapshot;
        if (!snapshot || snapshot.version !== 'm26-price-ordered-source-v1' ||
            snapshot.scope !== 'northstar_m24_approved_price_decisions' ||
            snapshot.organizationId !== identity.organizationId ||
            snapshot.id !== req.params.snapshotId ||
            !['current', 'stale'].includes(value.state) ||
            value.sourceOrderCurrent !== (value.state === 'current') ||
            value.calendarPeriodVerified !== false ||
            value.eligibleForForecast !== false ||
            value.wholeBusinessCoverageVerified !== false ||
            value.forecastIssued !== false ||
            !UUID.test(value.firstReceiptId || '') ||
            !instant(value.coverageStartsAt) ||
            !instant(snapshot.capturedAt) ||
            !Number.isSafeInteger(snapshot.eventCount) ||
            snapshot.eventCount < 0 || snapshot.eventCount > 1000 ||
            !Array.isArray(snapshot.events) ||
            snapshot.events.length !== snapshot.eventCount ||
            typeof snapshot.sourceSnapshotDigest !== 'string' ||
            !/^[0-9a-f]{64}$/.test(snapshot.sourceSnapshotDigest)) {
          throw new Error('Invalid guarded ordered-price readback');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: value.state, snapshotId: snapshot.id,
          sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
          capturedAt: snapshot.capturedAt,
          coverageStartsAt: value.coverageStartsAt,
          firstReceiptId: value.firstReceiptId,
          eventCount: snapshot.eventCount,
          sourceOrderCurrent: value.sourceOrderCurrent,
          calendarPeriodVerified: false, eligibleForForecast: false,
          wholeBusinessCoverageVerified: false, forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/ordered-snapshots/:snapshotId/month-candidate', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      const withCurrency = exactKeys(req.query, ['startsAt', 'endsAt', 'currency']);
      if (!UUID.test(req.params.snapshotId) ||
          !(withCurrency || exactKeys(req.query, ['startsAt', 'endsAt'])) ||
          (withCurrency && (typeof req.query.currency !== 'string' ||
            !/^[A-Z]{3}$/.test(req.query.currency)))) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The history request is invalid.',
        } });
      }
      let window;
      try {
        window = calendarMonth({ startsAt: req.query.startsAt, endsAt: req.query.endsAt });
      } catch {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The calendar month is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const identity = actor(req);
        const response = await client.query(
          'SELECT public.canonical_forecast_price_ordered_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.params.snapshotId]);
        const value = response.rows[0]?.value;
        if (value === null) {
          await client.query('COMMIT');
          return res.status(404).json({ success: false, error: {
            category: 'FORECAST_SOURCE_UNAVAILABLE',
            message: 'Forecast history is unavailable.',
          } });
        }
        if (!value?.snapshot || value.snapshot.organizationId !== identity.organizationId ||
            value.snapshot.id !== req.params.snapshotId) {
          throw new Error('Invalid guarded ordered-price month source');
        }
        const candidate = assessOrderedPriceMonthCandidate(value, window,
          withCurrency ? req.query.currency : null);
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: candidate.state, reason: candidate.reason,
          snapshotId: req.params.snapshotId,
          sourceCapturedAt: candidate.capturedAt ?? null,
          sourceSnapshotDigest: candidate.sourceSnapshotDigest ?? null,
          window,
          inputOrderTimestampDecisionCount: candidate.inputOrderTimestampDecisionCount ?? null,
          inputCurrency: candidate.inputCurrency ?? (withCurrency ? req.query.currency : null),
          inputFirstApprovalCount: candidate.inputFirstApprovalCount ?? null,
          inputFirstApprovalAmount: candidate.inputFirstApprovalAmount ?? null,
          candidateWindowChecksPassed: candidate.candidateWindowChecksPassed,
          // The guarded read holds the tenant source-order lock until COMMIT.
          // This proves only a bounded NorthStar order-time UTC window as it
          // stood at this receipt capture, never business-wide month coverage.
          sourceOrderUtcWindowObservedAsOfCapture:
            candidate.candidateWindowChecksPassed === true,
          sourceMonthVerified: false,
          sourceAuthenticated: candidate.candidateWindowChecksPassed === true,
          calendarPeriodVerified: false,
          eligibleForForecast: false, wholeBusinessCoverageVerified: false,
          forecastIssued: false,
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
