'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { readGuardedApprovedPriceFlow } = require('../forecasting/guardedApprovedPriceFlow');
const { calendarMonth, assessOrderedPriceMonthCandidate,
  assessOrderedPriceReportingMonthCandidate } =
  require('../forecasting/orderedPriceMonthCandidate');
const { assessComparablePricePeriods } =
  require('../forecasting/comparablePricePeriods');
const { getActiveBusinessProfile, getBusinessProfileById } =
  require('../services/organizationAuthority');
const { adaptBusinessProfile, sha256 } = require('../services/businessProfileAdapter');
const { deriveReportingWindow } = require('../forecasting/timeSeriesWindows');
const { normalizeForecastOutput } = require('../forecasting/outputContract');
const { buildRollingBacktest } = require('../forecasting/rollingBacktest');
const { measureEvaluation, measureGuardedSavedBacktest } = require('../forecasting/evaluationGates');
const { assessSelectedPriceFlowEvaluation } = require('../forecasting/selectedPriceFlowEvaluationPolicy');
const { assessCompletePriceFlowEvaluation } = require('../forecasting/completePriceFlowEvaluation');
const { assessMatchedPriceFlowAlgorithms } =
  require('../forecasting/matchedPriceFlowAlgorithmPolicy');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const SQL_MILLISECOND_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const instant = value => typeof value === 'string' && INSTANT.test(value);

function calendarAuthority(rawProfile) {
  return {
    hours: rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, 'hours')
      ? rawProfile.hours : null,
    timeZone: rawProfile && rawProfile.company &&
      Object.prototype.hasOwnProperty.call(rawProfile.company, 'timeZone')
      ? rawProfile.company.timeZone : null,
  };
}

function errorReply(res, error) {
  const status = error?.code === '22023' ? 400 :
    error?.code === '42501' ? 403 :
      ['40001', '40P01', '55P03', '54000', '23505'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 400 ? 'FORECAST_REQUEST_INVALID' :
      status === 403 ? 'FORECAST_ACCESS_RESTRICTED' :
      error?.code === '54000' ? 'FORECAST_SOURCE_CAPACITY' :
        error?.code === '55P03' ? 'FORECAST_SOURCE_BUSY' :
        status === 409 ? 'FORECAST_SOURCE_CHANGED' : 'FORECAST_SOURCE_UNAVAILABLE',
    message: status === 400 ? 'The forecast source request is invalid.' :
      status === 403 ? 'Forecast history access is restricted.' :
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

function validLocalMonth(value) {
  if (typeof value !== 'string' ||
      !/^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])-01$/.test(value) ||
      value === '2100-12-01') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function createForecastPriceHistoryRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-price-history:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-price-history:${req.tenantContext.organizationId}`);
  const actualThrottle = options.actualThrottle || rateLimit('forecast-actual-capture', req =>
    `forecast-price-history:${req.tenantContext.organizationId}`);
  const evaluationThrottle = options.evaluationThrottle ||
    rateLimit('forecast-evaluation-capture', req =>
      `forecast-price-history:${req.tenantContext.organizationId}`);
  const algorithmOriginThrottle = options.algorithmOriginThrottle ||
    rateLimit('forecast-algorithm-origin', req =>
      `forecast-price-history:${req.tenantContext.organizationId}`);
  const readPosition = options.readPosition || readGuardedApprovedPriceFlow;
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  const lockPriceFlowActualRuns = async (client, organizationId, runIds) => {
    if (!Array.isArray(runIds) || runIds.some(runId => !UUID.test(runId || '')) ||
        new Set(runIds).size !== runIds.length) {
      throw new Error('Invalid guarded evaluation origin');
    }
    const acquired = (await client.query(`
      SELECT COALESCE(bool_and(acquired),TRUE) acquired FROM (
        SELECT pg_try_advisory_xact_lock(hashtextextended(
          'm26:price-flow-actual:'||$1::text||':'||input.run_id::text,0)) acquired
        FROM unnest($2::uuid[]) AS input(run_id)
        ORDER BY input.run_id
      ) selected_actual_locks`, [organizationId, runIds])).rows[0]?.acquired;
    if (acquired !== true) {
      const busy = new Error('Price-flow evaluation actuals are busy');
      busy.code = '55P03';
      throw busy;
    }
  };

  // A separate transaction must observe the first ordered receipt committed
  // before its prospective source coverage can be used for a local period.
  router.post('/ordered-anchor/activate', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      if (!exactKeys(req.body, [])) return res.status(400).json({
        success: false, error: { category: 'FORECAST_REQUEST_INVALID',
          message: 'The price source request is invalid.' },
      });
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const identity = actor(req);
        const response = await client.query(
          'SELECT public.canonical_forecast_price_anchor_activate($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token')]);
        const value = response.rows[0]?.value;
        if (!value || !['price_anchor_activation_recorded',
          'price_anchor_activation_unavailable'].includes(value.state) ||
          (value.firstReceiptId !== undefined && !UUID.test(value.firstReceiptId)) ||
          value.sourceCoverageVerified !== false || value.forecastIssued !== false) {
          throw new Error('Invalid guarded price anchor activation');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: value });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  async function guardedMonthCandidate(req, res, buildWindow, currency) {
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const identity = actor(req);
      const basis = await buildWindow(client, identity);
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
      if (basis.unavailableReason) {
        const reviewedClaimExists = basis.unavailableReason === 'profile_changed';
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: 'unavailable', reason: basis.unavailableReason,
          snapshotId: req.params.snapshotId, window: null,
          profileBasis: reviewedClaimExists ? 'owner_reviewed_month_claim' : null,
          ownerConfirmedHistoricalProfile: reviewedClaimExists,
          profilePinVerified: false,
          historicalCalendarVerified: false,
          observationCoverageVerified: false,
          sourceAuthenticated: false, sourceMonthVerified: false,
          calendarPeriodVerified: false, eligibleForForecast: false,
          wholeBusinessCoverageVerified: false, forecastIssued: false,
        } });
      }
      const candidate = basis.reportingWindow ?
        assessOrderedPriceReportingMonthCandidate(value, basis.reportingWindow,
          currency) : assessOrderedPriceMonthCandidate(value, basis.window, currency);
      await client.query('COMMIT');
      return res.json({ success: true, data: {
        state: candidate.state, reason: candidate.reason,
        snapshotId: req.params.snapshotId,
        sourceCapturedAt: candidate.capturedAt ?? null,
        sourceSnapshotDigest: candidate.sourceSnapshotDigest ?? null,
        preAnchorContextDigest: candidate.preAnchorContextDigest ?? null,
        window: basis.window,
        ...(basis.reportingWindow ? {
          profileBasis: basis.profileBasis || 'current_active_profile_at_read',
          historicalCalendarVerified: false,
          observationCoverageVerified: false,
          ...(basis.attestation ? {
            ownerConfirmedHistoricalProfile: true,
            profilePinVerified: true,
            attestation: basis.attestation,
          } : {}),
        } : {}),
        inputOrderTimestampDecisionCount: candidate.inputOrderTimestampDecisionCount ?? null,
        inputCurrency: candidate.inputCurrency ?? currency,
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
  }

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
          replayed: captured.replayed === true, eligibleForForecast: false,
          forecastIssued: false,
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
      return guardedMonthCandidate(req, res, async () => ({ window,
        reportingWindow: null }), withCurrency ? req.query.currency : null);
    });

  router.get('/ordered-snapshots/:snapshotId/profile-month-candidate', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      const withCurrency = exactKeys(req.query, ['localStartDate', 'currency']);
      if (!UUID.test(req.params.snapshotId) ||
          !(withCurrency || exactKeys(req.query, ['localStartDate'])) ||
          !validLocalMonth(req.query.localStartDate) ||
          (withCurrency && (typeof req.query.currency !== 'string' ||
            !/^[A-Z]{3}$/.test(req.query.currency)))) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The history request is invalid.',
        } });
      }
      return guardedMonthCandidate(req, res, async (client, identity) => {
        const profile = await getActiveBusinessProfile(client, identity.organizationId);
        if (profile.organizationId !== identity.organizationId ||
            !Number.isSafeInteger(profile.versionNumber) || profile.versionNumber < 1 ||
            profile.versionLabel !== `org-profile-v${profile.versionNumber}` ||
            adaptBusinessProfile(profile.rawProfile, profile.versionLabel).hash !==
              profile.profileHash ||
            !profile.calendarAuthority ||
            sha256(calendarAuthority(profile.rawProfile)) !==
              sha256(profile.calendarAuthority)) {
          throw new Error('Invalid active Business Profile');
        }
        const reportingWindow = deriveReportingWindow({
          organizationId: identity.organizationId,
          businessProfileId: profile.id,
          businessProfileVersion: profile.versionNumber,
          businessProfileHash: profile.profileHash,
          rawProfile: profile.rawProfile,
          grain: 'month', localStartDate: req.query.localStartDate,
          serviceKey: null, areaScope: 'tenant_all',
        });
        return { window: reportingWindow, reportingWindow };
      }, withCurrency ? req.query.currency : null);
    });

  router.get('/ordered-snapshots/:snapshotId/reviewed-profile-month-candidate', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      const withCurrency = exactKeys(req.query, ['localStartDate', 'currency']);
      if (!UUID.test(req.params.snapshotId) ||
          !(withCurrency || exactKeys(req.query, ['localStartDate'])) ||
          !validLocalMonth(req.query.localStartDate) ||
          (withCurrency && (typeof req.query.currency !== 'string' ||
            !/^[A-Z]{3}$/.test(req.query.currency)))) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The history request is invalid.',
        } });
      }
      return guardedMonthCandidate(req, res, async (client, identity) => {
        const response = await client.query(
          'SELECT public.canonical_forecast_profile_month_guarded_source($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
            identity.authSessionId, req.query.localStartDate]);
        const source = response.rows[0]?.value;
        if (!source || typeof source.state !== 'string')
          throw new Error('Invalid reviewed calendar source');
        if (source.state !== 'owner_claim_only') {
          if (!['no_reviewed_claim', 'claim_revoked', 'profile_changed']
            .includes(source.state)) throw new Error('Invalid reviewed calendar state');
          return { unavailableReason: source.state };
        }
        if (!UUID.test(source.attestationId || '') ||
            !DIGEST.test(source.attestationDigest || '') ||
            !UUID.test(source.businessProfileId || '') ||
            !DIGEST.test(source.businessProfileHash || '') ||
            !Number.isSafeInteger(source.businessProfileVersion) ||
            source.businessProfileVersion < 1 ||
            source.businessProfileLabel !==
              `org-profile-v${source.businessProfileVersion}` ||
            adaptBusinessProfile(source.rawProfile,
              source.businessProfileLabel).hash !== source.businessProfileHash) {
          throw new Error('Invalid reviewed calendar pin');
        }
        const reportingWindow = deriveReportingWindow({
          organizationId: identity.organizationId,
          businessProfileId: source.businessProfileId,
          businessProfileVersion: source.businessProfileVersion,
          businessProfileHash: source.businessProfileHash,
          rawProfile: source.rawProfile,
          grain: 'month', localStartDate: req.query.localStartDate,
          serviceKey: null, areaScope: 'tenant_all',
        });
        return { window: reportingWindow, reportingWindow,
          profileBasis: 'owner_reviewed_month_claim',
          attestation: { id: source.attestationId,
            revision: source.attestationRevision,
            digest: source.attestationDigest,
            recordedAt: source.attestationRecordedAt } };
      }, withCurrency ? req.query.currency : null);
    });

  router.get('/ordered-snapshots/:snapshotId/comparable-profile-months', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.snapshotId) ||
          !exactKeys(req.query, ['profileAnchorId', 'firstLocalStartDate',
            'secondLocalStartDate', 'currency']) ||
          !UUID.test(req.query.profileAnchorId) ||
          !validLocalMonth(req.query.firstLocalStartDate) ||
          !validLocalMonth(req.query.secondLocalStartDate) ||
          req.query.firstLocalStartDate >= req.query.secondLocalStartDate ||
          typeof req.query.currency !== 'string' ||
          !/^[A-Z]{3}$/.test(req.query.currency)) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The reporting period comparison request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const identity = actor(req);
        const pin = (await client.query(
          'SELECT public.canonical_forecast_profile_effective_anchor_pin($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.query.profileAnchorId])).rows[0]?.value;
        if (!pin || !['profile_effective_anchor_pinned',
          'profile_effective_anchor_unavailable'].includes(pin.state)) {
          throw new Error('Invalid guarded profile anchor');
        }
        if (pin.state !== 'profile_effective_anchor_pinned') {
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            state: 'unavailable', reason: 'profile_anchor_not_found',
            observationCoverageVerified: false,
            historicalCalendarVerified: false,
            eligibleForForecast: false,
            wholeBusinessCoverageVerified: false, forecastIssued: false,
          } });
        }
        const profile = await getBusinessProfileById(client,
          identity.organizationId, pin.businessProfileId);
        if (profile.versionNumber !== pin.businessProfileVersion ||
            profile.profileHash !== pin.businessProfileHash ||
            adaptBusinessProfile(profile.rawProfile, profile.versionLabel).hash !==
              pin.businessProfileHash) {
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            state: 'unavailable', reason: 'profile_changed',
            observationCoverageVerified: false,
            historicalCalendarVerified: false,
            eligibleForForecast: false,
            wholeBusinessCoverageVerified: false, forecastIssued: false,
          } });
        }
        if (profile.rawProfile.company?.currency !== req.query.currency) {
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            state: 'unavailable', reason: 'profile_currency_mismatch',
            observationCoverageVerified: false,
            historicalCalendarVerified: false,
            eligibleForForecast: false,
            wholeBusinessCoverageVerified: false, forecastIssued: false,
          } });
        }
        const windows = [req.query.firstLocalStartDate,
          req.query.secondLocalStartDate].map(localStartDate =>
          deriveReportingWindow({
            organizationId: identity.organizationId,
            businessProfileId: profile.id,
            businessProfileVersion: profile.versionNumber,
            businessProfileHash: profile.profileHash,
            rawProfile: profile.rawProfile, grain: 'month', localStartDate,
            serviceKey: null, areaScope: 'tenant_all',
          }));
        const profileProofs = [];
        for (const window of windows) {
          const proof = await client.query(
            'SELECT public.canonical_forecast_profile_effective_window($1,$2,$3,$4,$5,$6,$7) value',
            [identity.organizationId, identity.actorUserId,
              identity.actorAccessRole, identity.authSessionId,
              req.query.profileAnchorId, window.startsAt, window.endsAt]);
          profileProofs.push(proof.rows[0]?.value);
        }
        const priceActivation = (await client.query(
          'SELECT public.canonical_forecast_price_anchor_activation_read($1,$2,$3,$4) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId])).rows[0]?.value;
        const source = (await client.query(
          'SELECT public.canonical_forecast_price_ordered_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.snapshotId])).rows[0]?.value;
        if (source === null) {
          await client.query('COMMIT');
          return res.status(404).json({ success: false, error: {
            category: 'FORECAST_SOURCE_UNAVAILABLE',
            message: 'Forecast history is unavailable.',
          } });
        }
        if (!source?.snapshot ||
            source.snapshot.organizationId !== identity.organizationId ||
            source.snapshot.id !== req.params.snapshotId) {
          throw new Error('Invalid guarded ordered-price source');
        }
        const data = assessComparablePricePeriods({ source, profileProofs,
          priceActivation, windows, currency: req.query.currency,
          anchorId: req.query.profileAnchorId });
        await client.query('COMMIT');
        return res.json({ success: true, data });
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

  // A fictional-data research run follows a still-current owner selection.
  // This never activates paid numeric forecast serving.
  router.post('/research-selected-origins', auth,
    requirePermission('forecast', 'update'), algorithmOriginThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exactKeys(req.body, ['baseRunId']) ||
          !UUID.test(req.body.baseRunId || '') || !KEY.test(key || '') ||
          !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The research origin request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        await client.query("SET LOCAL lock_timeout = '14000ms'");
        const identity = actor(req);
        const captured = (await client.query(
          'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), key,
            req.body.baseRunId])).rows[0]?.value;
        if (captured?.state === 'research_selected_origin_unavailable') {
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            state: captured.state, reason: captured.reason,
            researchOnly: true, forecastServingEnabled: false,
            realForecastEligible: false, forecastValueAvailable: false } });
        }
        if (captured?.state !== 'research_selected_origin_saved' ||
            !UUID.test(captured.runId || '') ||
            !UUID.test(captured.baseRunId || '') ||
            !['m26_price_flow_carry_forward_v1',
              'm26_price_flow_zero_baseline_v1'].includes(
              captured.algorithmVersion) ||
            captured.researchOnly !== true ||
            captured.forecastServingEnabled !== false) {
          throw new Error('Invalid research-selected origin');
        }
        await client.query('COMMIT');
        if (captured.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(captured.replayed ? 200 : 201).json({ success: true,
          data: { state: captured.state, runId: captured.runId,
            baseRunId: captured.baseRunId,
            algorithmVersion: captured.algorithmVersion,
            selectionEventId: captured.selectionEventId || null,
            replayed: captured.replayed === true, researchOnly: true,
            forecastServingEnabled: false, realForecastEligible: false,
            forecastValueAvailable: false, output: null } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  // Supported M24-source synthetic price-flow origin. The saved point is a
  // deterministic carry-forward, not a calibrated or whole-business forecast.
  router.post('/saved-price-flow-origins', auth,
    requirePermission('forecast', 'update'), captureThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exactKeys(req.body, ['sourceReceiptId', 'currency',
        'horizonStartsAt', 'horizonEndsAt']) ||
          !UUID.test(req.body.sourceReceiptId || '') ||
          !/^[A-Z]{3}$/.test(req.body.currency || '') ||
          !instant(req.body.horizonStartsAt) ||
          !instant(req.body.horizonEndsAt) || !KEY.test(key || '') ||
          !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast source request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const captured = (await client.query(
          'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), key, req.body.sourceReceiptId,
            req.body.currency, req.body.horizonStartsAt,
            req.body.horizonEndsAt])).rows[0]?.value;
        if (captured?.state === 'price_flow_origin_unavailable') {
          await client.query('COMMIT');
          return res.json({ success: true, data: captured });
        }
        if (captured?.state !== 'saved_price_flow_origin' ||
            !UUID.test(captured.runId || '') ||
            captured.preHorizonCommitVerified !== false) {
          throw new Error('Invalid saved price-flow origin');
        }
        const output = normalizeForecastOutput(captured.output);
        if (output.organizationId !== identity.organizationId ||
            output.target.key !== 'revenue.approved_price_flow' ||
            output.applicability.limits.join('|') !==
              'northstar_m24_only|uncalibrated_carry_forward') {
          throw new Error('Invalid supported price-flow output');
        }
        await client.query('COMMIT');
        if (captured.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(captured.replayed ? 200 : 201).json({ success: true,
          data: { state: 'saved_price_flow_origin', runId: captured.runId,
            output: null, outputDigest: sha256(output),
            receiptDigest: captured.receiptDigest,
            preHorizonCommitVerified: false,
            realForecastEligible: false, forecastValueAvailable: false,
            replayed: captured.replayed } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  // A fixed zero-point comparator shares the verified M24 source and horizon
  // of an existing pre-horizon origin. It remains masked and ineligible for a
  // real forecast until independent evaluation and human governance.
  router.post('/saved-price-flow-origins/:runId/zero-baseline', auth,
    requirePermission('forecast', 'update'), algorithmOriginThrottle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!UUID.test(req.params.runId || '') || !KEY.test(key || '') ||
          !exactKeys(req.body, []) || !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast source request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const saved = (await client.query(
          'SELECT public.canonical_forecast_capture_price_flow_zero_baseline($1,$2,$3,$4,$5,$6,$7) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), key, req.params.runId])).rows[0]?.value;
        if (saved?.state === 'price_flow_origin_unavailable') {
          await client.query('COMMIT');
          return res.json({ success: true, data: saved });
        }
        if (saved?.state !== 'saved_price_flow_origin' ||
            !UUID.test(saved.runId || '') ||
            saved.preHorizonCommitVerified !== false) {
          throw new Error('Invalid zero baseline origin');
        }
        const output = normalizeForecastOutput(saved.output);
        if (output.organizationId !== identity.organizationId ||
            output.target.key !== 'revenue.approved_price_flow' ||
            output.calculationVersion !== 'm26_price_flow_zero_baseline_v1' ||
            output.applicability.limits.join('|') !==
              'northstar_m24_only|uncalibrated_zero_baseline') {
          throw new Error('Invalid zero baseline output');
        }
        await client.query('COMMIT');
        if (saved.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(saved.replayed ? 200 : 201).json({ success: true,
          data: { state: 'saved_price_flow_origin', runId: saved.runId,
            output: null, outputDigest: null, receiptDigest: null,
            preHorizonCommitVerified: false, realForecastEligible: false,
            forecastValueAvailable: false, replayed: saved.replayed } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/algorithm-research-review', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!exactKeys(req.query, [])) return res.status(400).json({
        success: false, error: { category: 'FORECAST_REQUEST_INVALID',
          message: 'The algorithm review request is invalid.' },
      });
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const reviewed = (await client.query(
          'SELECT public.canonical_forecast_price_flow_research_review($1,$2,$3,$4) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId])).rows[0]?.value;
        if (!reviewed || !['research_review_ready',
          'research_review_unavailable'].includes(reviewed.state)) {
          throw new Error('Invalid algorithm research review');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: reviewed.state, reason: reviewed.reason || null,
          policyVersion: reviewed.policyVersion || null,
          currentRevision: reviewed.currentRevision,
          currentEventId: reviewed.currentEventId || null,
          currentAlgorithmVersion: reviewed.currentAlgorithmVersion || null,
          humanResearchReviewAvailable:
            reviewed.state === 'research_review_ready',
          reviewToken: null,
          researchOnly: true, numericalErrorAvailable: false,
          promotionAvailable: false, forecastServingEnabled: false,
          realForecastEligible: false } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/algorithm-research-challenges', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      if (!exactKeys(req.query, []) ||
          !exactKeys(req.body, ['expectedRevision', 'action',
            'algorithmVersion', 'reversesEventId', 'reason']) ||
          !Number.isInteger(req.body.expectedRevision) ||
          req.body.expectedRevision < 0 ||
          !['select_candidate', 'rollback'].includes(req.body.action) ||
          !['m26_price_flow_zero_baseline_v1',
            'm26_price_flow_carry_forward_v1'].includes(
            req.body.algorithmVersion) ||
          !(req.body.reversesEventId === null ||
            UUID.test(req.body.reversesEventId || '')) ||
          typeof req.body.reason !== 'string' ||
          req.body.reason.length < 16 || req.body.reason.length > 1000) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The research challenge request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const challenged = (await client.query(
          'SELECT public.canonical_forecast_price_flow_research_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), req.body.expectedRevision,
            req.body.action, req.body.algorithmVersion,
            req.body.reversesEventId, req.body.reason])).rows[0]?.value;
        if (!challenged || !['research_challenge_ready',
          'research_challenge_unavailable'].includes(challenged.state)) {
          throw new Error('Invalid research challenge');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: challenged.state, reason: challenged.reason || null,
          reviewToken: challenged.state === 'research_challenge_ready' ?
            challenged.reviewToken : null,
          currentRevision: challenged.currentRevision ?? null,
          researchOnly: true, forecastServingEnabled: false,
          realForecastEligible: false } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/algorithm-research-selections', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!exactKeys(req.query, []) ||
          !exactKeys(req.body, ['expectedRevision', 'action',
            'algorithmVersion', 'reversesEventId', 'reason',
            'reviewToken', 'confirmed']) ||
          !Number.isInteger(req.body.expectedRevision) ||
          req.body.expectedRevision < 0 ||
          !['select_candidate', 'rollback'].includes(req.body.action) ||
          !['m26_price_flow_zero_baseline_v1',
            'm26_price_flow_carry_forward_v1'].includes(
            req.body.algorithmVersion) ||
          !(req.body.reversesEventId === null ||
            UUID.test(req.body.reversesEventId || '')) ||
          typeof req.body.reason !== 'string' ||
          req.body.reason.length < 16 || req.body.reason.length > 1000 ||
          !DIGEST.test(req.body.reviewToken || '') ||
          req.body.confirmed !== true || !KEY.test(key || '')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The research selection request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const selectionArgs = [identity.organizationId, identity.actorUserId,
          identity.actorAccessRole, identity.authSessionId,
          req.get('X-CSRF-Token'), key, req.body.expectedRevision,
          req.body.action, req.body.algorithmVersion,
          req.body.reversesEventId, req.body.reason,
          req.body.reviewToken];
        const selectionSql =
          'SELECT public.canonical_forecast_price_flow_research_select($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value';
        // A committed replay stays idempotent even if its source later changes.
        const saved = (await client.query(selectionSql,
          [...selectionArgs, true])).rows[0]?.value;
        if (!saved || !['research_selection_recorded',
          'research_selection_unavailable'].includes(saved.state)) {
          throw new Error('Invalid research selection receipt');
        }
        if (saved.state === 'research_selection_unavailable') {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, error: {
            category: 'FORECAST_SOURCE_CHANGED',
            message: 'The research review changed. Refresh it before selecting.',
          } });
        }
        await client.query('COMMIT');
        if (saved.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(saved.state === 'research_selection_recorded' &&
          !saved.replayed ? 201 : 200).json({ success: true, data: {
          state: saved.state, reason: saved.reason || null,
          eventId: saved.eventId || null, revision: saved.revision ?? null,
          algorithmVersion: saved.algorithmVersion || null,
          researchOnly: true, forecastServingEnabled: false,
          forecastValueAvailable: false, realForecastEligible: false,
          replayed: saved.replayed === true } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/algorithm-matched-population', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!exactKeys(req.query, [])) return res.status(400).json({
        success: false, error: { category: 'FORECAST_REQUEST_INVALID',
          message: 'The algorithm population request is invalid.' },
      });
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        let observed = (await client.query(
          'SELECT public.canonical_forecast_price_flow_matched_population($1,$2,$3,$4,FALSE) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId])).rows[0]?.value;
        if (!observed || !['matched_population_unavailable',
          'matched_population_observed'].includes(observed.state)) {
          throw new Error('Invalid algorithm population');
        }
        await client.query('COMMIT');
        if (observed.state === 'matched_population_unavailable') {
          return res.json({ success: true, data: {
            state: observed.state, reason: observed.reason,
            promotionAvailable: false, realForecastEligible: false } });
        }
        const selectedRunIds = observed.selectedRunIds;
        if (!Array.isArray(selectedRunIds) || selectedRunIds.length > 200 ||
            selectedRunIds.some(runId => !UUID.test(runId || '')) ||
            new Set(selectedRunIds).size !== selectedRunIds.length) {
          throw new Error('Invalid algorithm population origin inventory');
        }
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        await lockPriceFlowActualRuns(client, identity.organizationId,
          selectedRunIds);
        const confirmed = (await client.query(
          'SELECT public.canonical_forecast_price_flow_matched_population($1,$2,$3,$4,TRUE) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId])).rows[0]?.value;
        if (confirmed?.state !== 'matched_population_observed' ||
            !Array.isArray(confirmed.selectedRunIds) ||
            confirmed.selectedRunIds.join(',') !== selectedRunIds.join(',')) {
          throw new Error('Algorithm population changed during guarded read');
        }
        observed = confirmed;
        const keys = ['expectedUtcDays', 'storedBaseCount',
          'matchingBaseCount', 'excludedBaseCount', 'candidateMissingCount',
          'candidateDuplicateCount', 'orphanCandidateCount',
          'missingSavedOriginDays', 'duplicateSavedOriginDays',
          'pairedCount', 'partialCount', 'missingActualCount',
          'unavailableCount', 'distinctSourceEventDays'];
        if (observed.scope !==
            'northstar_m24_registered_saved_algorithms_only' ||
            !keys.every(name => Number.isInteger(observed[name]) &&
              observed[name] >= 0 && observed[name] <= 100)) {
          throw new Error('Invalid algorithm population counts');
        }
        const policy = assessMatchedPriceFlowAlgorithms(observed);
        const responseData = {
          state: observed.state, scope: observed.scope,
          counts: Object.fromEntries(keys.map(name => [name, observed[name]])),
          completeRegisteredPopulation:
            observed.completeRegisteredPopulation === true,
          comparisonState: policy.state,
          comparisonReason: policy.reason || null,
          direction: policy.direction || null,
          referenceDirection: policy.referenceDirection || null,
          laterDirection: policy.laterDirection || null,
          candidateWorseDays: policy.candidateWorseDays ?? null,
          sourceEventDiversityVerified:
            policy.sourceEventDiversityVerified === true,
          observationLag: policy.observationLag || {
            state: 'unavailable',
            reason: 'matched_population_incomplete' },
          unsavedOriginCoverageVerified: false,
          wholeBusinessCoverageVerified: false,
          numericalErrorAvailable: false, promotionAvailable: false,
          realForecastEligible: false };
        await client.query('COMMIT');
        return res.json({ success: true, data: responseData });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/algorithm-matched-pairs', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!exactKeys(req.query, ['baseRunId', 'candidateRunId']) ||
          !UUID.test(req.query.baseRunId || '') ||
          !UUID.test(req.query.candidateRunId || '')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The algorithm comparison request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const result = (await client.query(
          'SELECT public.canonical_forecast_price_flow_matched_algorithms($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.query.baseRunId, req.query.candidateRunId])).rows[0]?.value;
        if (!result || !['matched_algorithms_unavailable',
          'matched_algorithms_observed'].includes(result.state)) {
          throw new Error('Invalid algorithm comparison source');
        }
        await client.query('COMMIT');
        if (result.state === 'matched_algorithms_unavailable') {
          return res.json({ success: true, data: {
            state: result.state, reason: result.reason, matched: false,
            numericComparisonAvailable: false,
            promotionAvailable: false, realForecastEligible: false } });
        }
        if (result.matched !== true ||
            !['paired', 'partial', 'missing', 'revoked', 'unavailable']
              .includes(result.actualPairStatus) ||
            result.baseRunId !== req.query.baseRunId ||
            result.candidateRunId !== req.query.candidateRunId) {
          throw new Error('Invalid algorithm comparison pair');
        }
        return res.json({ success: true, data: {
          state: result.state, matched: true,
          actualPairStatus: result.actualPairStatus,
          numericComparisonAvailable: false, promotionAvailable: false,
          realForecastEligible: false } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/saved-price-flow-origins/:runId/activate', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      if (!UUID.test(req.params.runId) || !exactKeys(req.body, []) ||
          !exactKeys(req.query, [])) return res.status(400).json({
        success: false, error: { category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast origin request is invalid.' },
      });
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const proof = (await client.query(
          'SELECT public.canonical_forecast_activate_price_flow_origin($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), req.params.runId])).rows[0]?.value;
        if (!proof || !['price_flow_origin_activated',
          'price_flow_origin_unavailable'].includes(proof.state)) {
          throw new Error('Invalid price-flow origin proof');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: proof });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/saved-price-flow-origins/:runId', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.runId) || !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast origin request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const saved = (await client.query(
          'SELECT public.canonical_forecast_price_flow_origin_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.runId])).rows[0]?.value;
        if (saved?.state === 'price_flow_origin_unavailable') {
          await client.query('COMMIT');
          return res.status(404).json({ success: false, error: {
            category: 'FORECAST_SOURCE_UNAVAILABLE',
            message: 'The saved forecast origin is unavailable.',
          } });
        }
        if (saved?.state !== 'saved_price_flow_origin' ||
            saved.runId !== req.params.runId ||
            !DIGEST.test(saved.receiptDigest || '')) {
          throw new Error('Invalid saved price-flow origin');
        }
        const output = normalizeForecastOutput(saved.output);
        if (output.organizationId !== identity.organizationId ||
            output.target.key !== 'revenue.approved_price_flow') {
          throw new Error('Invalid supported price-flow output');
        }
        await client.query('COMMIT');
        const zeroBaseline = output.calculationVersion ===
          'm26_price_flow_zero_baseline_v1';
        return res.json({ success: true, data: { ...saved, output: null,
          outputDigest: zeroBaseline ? null : sha256(output),
          receiptDigest: zeroBaseline ? null : saved.receiptDigest,
          originProofDigest: zeroBaseline ? null : saved.originProofDigest,
          forecastValueAvailable: false } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  // A separate pre-horizon transaction observes the prospective Business
  // Profile activation committed. The later reader must still verify that
  // the profile remained effective through the complete target period.
  router.post('/saved-price-flow-origins/:runId/profile-witness', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      if (!UUID.test(req.params.runId) ||
          !exactKeys(req.body, ['profileAnchorId']) ||
          !UUID.test(req.body.profileAnchorId || '') ||
          !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast source request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const value = (await client.query(
          'SELECT public.canonical_forecast_price_flow_profile_observe($1,$2,$3,$4,$5,$6,$7) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), req.params.runId,
            req.body.profileAnchorId])).rows[0]?.value;
        if (!value || !['profile_witness_recorded',
          'profile_witness_unavailable'].includes(value.state)) {
          throw new Error('Invalid price-flow profile witness');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          ...value, forecastValueAvailable: false,
          realForecastEligible: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  // This records when a separate transaction first saw an M24 price decision
  // committed. It is source evidence, not an actual-outcome or forecast claim.
  router.post('/decision-commit-observations', auth,
    requirePermission('forecast', 'update'), throttle, async (req, res) => {
      if (!exactKeys(req.body, ['decisionId']) ||
          !UUID.test(req.body.decisionId || '') || !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast source request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const value = (await client.query(
          'SELECT public.canonical_forecast_observe_price_decision_commit($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), req.body.decisionId])).rows[0]?.value;
        if (!value || !['price_decision_commit_observed',
          'price_decision_commit_unavailable'].includes(value.state)) {
          throw new Error('Invalid price decision commit observation');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: value });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/saved-price-flow-origins/:runId/actual-candidates/:receiptId',
    auth, requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.runId) ||
          !UUID.test(req.params.receiptId) || !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast source request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const value = (await client.query(
          'SELECT public.canonical_forecast_price_flow_actual_candidate($1,$2,$3,$4,$5,$6) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.runId, req.params.receiptId])).rows[0]?.value;
        if (!value || !['price_flow_actual_candidate',
          'price_flow_actual_pending',
          'price_flow_actual_unavailable'].includes(value.state)) {
          throw new Error('Invalid price-flow actual candidate');
        }
        await client.query('COMMIT');
        // No unfinalized numerical target result is delivered as an accuracy
        // or forecast claim through the paid route.
        return res.json({ success: true, data: {
          ...value, amount: null, firstApprovalCount: null,
          outcomeFinalized: false, realForecastEligible: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/saved-price-flow-origins/:runId/actual-receipts',
    auth, requirePermission('forecast', 'update'), actualThrottle,
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (!UUID.test(req.params.runId) ||
          !exactKeys(req.body, ['sourceReceiptId']) ||
          !UUID.test(req.body.sourceReceiptId || '') ||
          !KEY.test(key || '') || !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast source request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const value = (await client.query(
          'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.get('X-CSRF-Token'), key, req.params.runId,
            req.body.sourceReceiptId])).rows[0]?.value;
        if (!value || !['price_flow_actual_recorded',
          'price_flow_actual_pending',
          'price_flow_actual_unavailable'].includes(value.state)) {
          throw new Error('Invalid saved price-flow actual');
        }
        await client.query('COMMIT');
        if (value.state === 'price_flow_actual_recorded') {
          // The receipt writer must commit before a later transaction records
          // durable commit evidence. That witness remains valid after xid
          // status retention expires.
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
          await client.query("SET LOCAL statement_timeout = '10000ms'");
          await client.query("SET LOCAL lock_timeout = '2000ms'");
          const observed = (await client.query(
            'SELECT public.canonical_forecast_observe_price_flow_actual_commit($1,$2,$3,$4,$5,$6) value',
            [identity.organizationId, identity.actorUserId,
              identity.actorAccessRole, identity.authSessionId,
              req.get('X-CSRF-Token'), value.receiptId])).rows[0]?.value;
          if (observed?.state !== 'price_flow_actual_commit_observed' ||
              observed.receiptId !== value.receiptId ||
              observed.runId !== req.params.runId) {
            throw new Error('Invalid price-flow actual commit observation');
          }
          await client.query('COMMIT');
        }
        return res.status(value.state === 'price_flow_actual_recorded' &&
          !value.replayed ? 201 : 200).json({ success: true,
          data: { ...value, amount: null, firstApprovalCount: null,
            realForecastEligible: false } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/saved-price-flow-origins/:runId/actual-receipts/latest',
    auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      if (!UUID.test(req.params.runId) || !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast source request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const value = (await client.query(
          'SELECT public.canonical_forecast_price_flow_actual_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.runId])).rows[0]?.value;
        if (!value || !['price_flow_actual_finalized',
          'price_flow_actual_revoked',
          'price_flow_actual_unavailable'].includes(value.state)) {
          throw new Error('Invalid price-flow actual read');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          ...value, amount: null, firstApprovalCount: null,
          realForecastEligible: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  // Read-only supported-source pairing. The owning SQL functions authenticate
  // each saved run, profile witness and latest actual before the pure
  // comparator sees them. No paid numerical prediction or actual is returned.
  const guardedPriceFlowRun = async (client, identity, runId) => {
    const args = [identity.organizationId, identity.actorUserId,
      identity.actorAccessRole, identity.authSessionId, runId];
    const source = (await client.query(
      'SELECT public.canonical_forecast_price_flow_pair_source_read($1,$2,$3,$4,$5) value',
      args)).rows[0]?.value;
    if (source?.state === 'pair_source_unavailable') {
      return { state: 'unavailable', reason: 'source_evidence_unavailable' };
    }
    if (source?.state !== 'pair_source_verified' ||
        source.runId !== runId ||
        !UUID.test(source.profileAnchorId || '') ||
        !DIGEST.test(source.profileProofDigest || '') ||
        !SQL_MILLISECOND_INSTANT.test(source.savedAt || '') ||
        !SQL_MILLISECOND_INSTANT.test(source.sourceSnapshotAsOf || '') ||
        (source.latestSourceRecordedAt !== null &&
          !SQL_MILLISECOND_INSTANT.test(source.latestSourceRecordedAt || ''))) {
      throw new Error('Invalid guarded price-flow source');
    }
    const output = normalizeForecastOutput(source.output);
    const profilePin = (await client.query(
      'SELECT public.canonical_forecast_profile_effective_anchor_pin($1,$2,$3,$4,$5) value',
      [identity.organizationId, identity.actorUserId,
        identity.actorAccessRole, identity.authSessionId,
        source.profileAnchorId])).rows[0]?.value;
    if (profilePin?.state !== 'profile_effective_anchor_pinned') {
      return { state: 'unavailable', reason: 'profile_anchor_unavailable' };
    }
    const profile = await getBusinessProfileById(client,
      identity.organizationId, profilePin.businessProfileId);
    if (profile.versionNumber !== profilePin.businessProfileVersion ||
        profile.profileHash !== profilePin.businessProfileHash ||
        adaptBusinessProfile(profile.rawProfile,
          profile.versionLabel).hash !== profilePin.businessProfileHash ||
        profile.rawProfile.company?.currency !== output.unit.currency) {
      throw new Error('Invalid pinned Business Profile');
    }
    const window = deriveReportingWindow({
      organizationId: identity.organizationId,
      businessProfileId: profile.id,
      businessProfileVersion: profile.versionNumber,
      businessProfileHash: profile.profileHash,
      rawProfile: profile.rawProfile,
      grain: 'day', localStartDate: output.horizon.startsAt.slice(0, 10),
      serviceKey: null, areaScope: 'tenant_all',
    });
    if (window.startsAt !== output.horizon.startsAt ||
        window.endsAt !== output.horizon.endsAt) {
      throw new Error('Price-flow horizon and profile window differ');
    }
    const effective = (await client.query(
      'SELECT public.canonical_forecast_profile_effective_window($1,$2,$3,$4,$5,$6,$7) value',
      [identity.organizationId, identity.actorUserId,
        identity.actorAccessRole, identity.authSessionId,
        source.profileAnchorId, window.startsAt,
        window.endsAt])).rows[0]?.value;
    if (effective?.state !== 'profile_effective_window_verified' ||
        effective.businessProfileId !== profile.id ||
        effective.businessProfileHash !== profile.profileHash) {
      return { state: 'unavailable', reason: 'profile_period_unverified' };
    }
    const run = { id: runId, savedAt: source.savedAt,
      outputDigest: sha256(output),
      sourceSnapshotAsOf: source.sourceSnapshotAsOf,
      latestSourceRecordedAt: source.latestSourceRecordedAt,
      reportingWindow: window, output };
    const actual = (await client.query(
      'SELECT public.canonical_forecast_price_flow_pair_actual_read($1,$2,$3,$4,$5) value',
      args)).rows[0]?.value;
    const outcome = actual?.state === 'pair_actual_known' ||
      actual?.state === 'pair_actual_revoked' ? {
        id: actual.receiptId, forecastRunId: runId,
        organizationId: identity.organizationId,
        target: output.target, horizon: output.horizon,
        unit: output.unit, applicability: output.applicability,
        observedThrough: actual.observedThrough,
        capturedAt: actual.capturedAt,
        sourceDigest: actual.sourceDigest,
        state: actual.state === 'pair_actual_known' ? 'known' : 'revoked',
        amount: actual.amount, reason: actual.reason,
      } : null;
    return { state: 'verified', run, outcome };
  };

  const rollingPairHandler = async (req, res, saveEvaluation) => {
      if (!exactKeys(req.query, ['firstRunId', 'secondRunId']) ||
          !UUID.test(req.query.firstRunId || '') ||
          !UUID.test(req.query.secondRunId || '') ||
          req.query.firstRunId === req.query.secondRunId ||
          (saveEvaluation && (!exactKeys(req.body, []) ||
            !KEY.test(req.get('Idempotency-Key') || '')))) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The rolling comparison request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        if (saveEvaluation) {
          const replay = (await client.query(
            'SELECT public.canonical_forecast_price_flow_evaluation_replay($1,$2,$3,$4,$5,$6,$7,$8) value',
            [identity.organizationId, identity.actorUserId,
              identity.actorAccessRole, identity.authSessionId,
              req.get('X-CSRF-Token'), req.get('Idempotency-Key'),
              req.query.firstRunId, req.query.secondRunId])).rows[0]?.value;
          if (replay?.state === 'price_flow_evaluation_saved') {
            await client.query('COMMIT');
            return res.json({ success: true, data: {
              ...replay, accuracyAvailable: false,
              forecastValueAvailable: false, realForecastEligible: false,
            } });
          }
          if (replay?.state !== 'price_flow_evaluation_new') {
            throw new Error('Invalid price-flow evaluation replay state');
          }
        }
        const runs = [];
        const outcomes = [];
        for (const runId of [req.query.firstRunId, req.query.secondRunId]) {
          const guarded = await guardedPriceFlowRun(client, identity, runId);
          if (guarded.state !== 'verified') {
            await client.query('COMMIT');
            return res.json({ success: true, data: {
              state: 'rolling_pairs_unavailable',
              reason: guarded.reason,
              evaluationSaved: false, realForecastEligible: false,
            } });
          }
          runs.push(guarded.run);
          if (guarded.outcome) outcomes.push(guarded.outcome);
        }        const result = buildRollingBacktest({
          version: 'm26-rolling-backtest-v1', runs, outcomes });
        if (saveEvaluation) {
          const value = (await client.query(
            'SELECT public.canonical_forecast_capture_price_flow_evaluation($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) value',
            [identity.organizationId, identity.actorUserId,
              identity.actorAccessRole, identity.authSessionId,
              req.get('X-CSRF-Token'), req.get('Idempotency-Key'),
              req.query.firstRunId, req.query.secondRunId,
              JSON.stringify(result)])).rows[0]?.value;
          if (!value || !['price_flow_evaluation_saved',
            'price_flow_evaluation_unavailable'].includes(value.state)) {
            throw new Error('Invalid saved price-flow evaluation');
          }
          await client.query('COMMIT');
          return res.status(value.state === 'price_flow_evaluation_saved' &&
            !value.replayed ? 201 : 200).json({ success: true, data: {
              ...value, accuracyAvailable: false,
              forecastValueAvailable: false, realForecastEligible: false,
            } });
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: 'rolling_pairs_candidate',
          originCount: result.originCount,
          comparisons: result.comparisons.map(item => ({
            forecastRunId: item.forecastRunId, status: item.status,
            reason: item.reason,
            outcomeReceiptId: item.outcomeReceiptId,
          })),
          evaluationSaved: false, accuracyAvailable: false,
          realForecastEligible: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    };
  router.get('/saved-price-flow-rolling-pairs', auth,
    requirePermission('forecast', 'read'), throttle,
    (req, res) => rollingPairHandler(req, res, false));
  router.post('/saved-price-flow-rolling-pairs', auth,
    requirePermission('forecast', 'update'), evaluationThrottle,
    (req, res) => rollingPairHandler(req, res, true));

  router.get('/saved-price-flow-evaluations/:evaluationId/manifest', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.evaluationId || '') ||
          !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The evaluation manifest request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const manifest = (await client.query(
          'SELECT public.canonical_forecast_price_flow_evaluation_manifest($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.evaluationId])).rows[0]?.value;
        if (!manifest || !['evaluation_manifest_available',
          'evaluation_manifest_unavailable'].includes(manifest.state)) {
          throw new Error('Invalid guarded evaluation manifest');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: manifest });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/saved-price-flow-evaluations/:evaluationId/measurement', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.evaluationId || '') ||
          !exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The evaluation measurement request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const initialSource = (await client.query(
          'SELECT public.canonical_forecast_price_flow_evaluation_private_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.evaluationId])).rows[0]?.value;
        if (initialSource?.state === 'evaluation_measurement_unavailable') {
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            state: 'evaluation_measurement_unavailable',
            reason: initialSource.reason, realAccuracyAvailable: false,
          } });
        }
        if (initialSource?.state !== 'evaluation_measurement_source_verified' ||
            initialSource.evaluationId !== req.params.evaluationId ||
            !Array.isArray(initialSource.manifest?.origins) ||
            initialSource.manifest.origins.length !== 2) {
          throw new Error('Invalid guarded evaluation measurement source');
        }
        const selectedRunIds = initialSource.manifest.origins.map(
          item => item.forecastRunId);
        // The first read selects the immutable run identities only. Lock every
        // actual writer before re-reading any status or population value, so
        // missing-to-known and correction races cannot mix two snapshots.
        await lockPriceFlowActualRuns(client, identity.organizationId,
          selectedRunIds);
        const source = (await client.query(
          'SELECT public.canonical_forecast_price_flow_evaluation_private_read($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.evaluationId])).rows[0]?.value;
        if (source?.state !== 'evaluation_measurement_source_verified' ||
            source.evaluationId !== req.params.evaluationId ||
            !Array.isArray(source.manifest?.origins) ||
            source.manifest.origins.length !== 2 ||
            source.manifest.origins.map(item => item.forecastRunId).sort()
              .join(',') !== [...selectedRunIds].sort().join(',')) {
          throw new Error('Invalid guarded evaluation measurement source');
        }
        const population = (await client.query(
          'SELECT public.canonical_forecast_price_flow_evaluation_population($1,$2,$3,$4,$5) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            req.params.evaluationId])).rows[0]?.value;
        if (!population || !['bounded_saved_origin_inventory_verified',
          'evaluation_selection_incomplete',
          'evaluation_population_unavailable'].includes(population.state)) {
          throw new Error('Invalid guarded evaluation population');
        }
        const result = measureGuardedSavedBacktest(source.result);
        const policy = assessSelectedPriceFlowEvaluation(
          source.result, result, population);
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: 'evaluation_descriptive_only',
          evaluationId: source.evaluationId, revision: source.revision,
          originCount: result.originCount,
          comparisonCount: result.comparisonCount,
          statusCounts: result.statusCounts,
          savedOriginPopulation: {
            state: population.state, scope: population.scope || null,
            reason: population.reason || null,
            storedOriginCount: population.storedOriginCount ?? null,
            matchingContextCount: population.matchingContextCount ?? null,
            excludedContextCount: population.excludedContextCount ?? null,
            omittedMatchingCount: population.omittedMatchingCount ?? null,
            unsavedOriginCoverageVerified: false,
            wholeBusinessCoverageVerified: false,
          },
          currentStatusCounts: source.manifest.origins.reduce((counts, item) => {
            counts[item.currentStatus] = (counts[item.currentStatus] || 0) + 1;
            return counts;
          }, {}),
          policy,
          descriptiveErrorAvailable: false,
          sampleSufficiency: result.sampleSufficiency,
          calibration: result.calibration, drift: result.drift,
          realAccuracyAvailable: false, realForecastEligible: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/complete-price-flow-evaluation-window', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!exactKeys(req.query, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The evaluation window request is invalid.',
        } });
      }
      let client;
      try {
        client = await poolProvider().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        const identity = actor(req);
        const window = (await client.query(
          'SELECT public.canonical_forecast_price_flow_complete_window($1,$2,$3,$4) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId])).rows[0]?.value;
        if (window?.state === 'complete_window_unavailable') {
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            state: 'evaluation_window_unavailable', reason: window.reason,
            realAccuracyAvailable: false, realForecastEligible: false,
          } });
        }
        if (window?.state !== 'complete_saved_origin_window_observed' ||
            window.expectedUtcDays !== 60 ||
            !Array.isArray(window.origins) || window.origins.length > 100) {
          throw new Error('Invalid guarded evaluation window');
        }
        const matchingOrigins = window.origins.filter(item =>
          item.eligibility === 'matching_context');
        const matchingRunIds = matchingOrigins.map(item => item.runId);
        if (matchingRunIds.some(runId => !UUID.test(runId || '')) ||
            new Set(matchingRunIds).size !== matchingRunIds.length) {
          throw new Error('Invalid guarded evaluation origin');
        }
        // The actual writer uses the same per-run transaction lock. Acquire
        // every selected lock in deterministic order before reading any run,
        // so a concurrent correction cannot mix old and new actual revisions.
        await lockPriceFlowActualRuns(client, identity.organizationId,
          matchingRunIds);
        const runs = [];
        const outcomes = [];
        for (const item of matchingOrigins) {
          const guarded = await guardedPriceFlowRun(client, identity, item.runId);
          if (guarded.state !== 'verified') {
            await client.query('COMMIT');
            return res.json({ success: true, data: {
              state: 'evaluation_window_unavailable',
              reason: guarded.reason,
              realAccuracyAvailable: false, realForecastEligible: false,
            } });
          }
          runs.push(guarded.run);
          if (guarded.outcome) outcomes.push(guarded.outcome);
        }
        if (runs.length === 0) {
          throw new Error('Guarded evaluation window has no matching origin');
        }
        let backtest;
        let measurement;
        let referenceMeasurement;
        let laterMeasurement;
        try {
          backtest = buildRollingBacktest({
            version: 'm26-rolling-backtest-v1', runs, outcomes });
          measurement = measureEvaluation({
            version: 'm26-evaluation-gates-v1', runs, outcomes });
          const midpoint = Date.parse(window.windowStart) + 30 * 86400000;
          const half = predicate => {
            const selectedRuns = runs.filter(predicate);
            if (selectedRuns.length === 0) {
              return { descriptiveError: { state: 'unavailable' } };
            }
            const ids = new Set(selectedRuns.map(run => run.id));
            return measureEvaluation({ version: 'm26-evaluation-gates-v1',
              runs: selectedRuns,
              outcomes: outcomes.filter(item => ids.has(item.forecastRunId)) });
          };
          referenceMeasurement = half(run =>
            Date.parse(run.output.horizon.startsAt) < midpoint);
          laterMeasurement = half(run =>
            Date.parse(run.output.horizon.startsAt) >= midpoint);
        } catch (error) {
          if (!['M26_BACKTEST_COMPARISON_INVALID',
            'M26_EVALUATION_INVALID'].includes(error.code)) throw error;
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            state: 'evaluation_window_unavailable',
            reason: 'incomparable_source_windows',
            realAccuracyAvailable: false, realForecastEligible: false,
          } });
        }
        const diversity = (await client.query(
          'SELECT public.canonical_forecast_price_flow_event_diversity($1,$2,$3,$4,$5,$6::jsonb) value',
          [identity.organizationId, identity.actorUserId,
            identity.actorAccessRole, identity.authSessionId,
            window.anchorRunId, JSON.stringify(window.origins)])).rows[0]?.value;
        if (!diversity || !Number.isInteger(diversity.distinctSourceEventCount) ||
            diversity.distinctSourceEventCount < 0 ||
            diversity.distinctSourceEventCount > 60) {
          throw new Error('Invalid guarded source-event diversity');
        }
        const distinctSourceSnapshotCount = new Set(runs.map(run =>
          run.sourceSnapshotAsOf)).size;
        const policy = assessCompletePriceFlowEvaluation({ ...window,
          distinctSourceSnapshotCount,
          sourceEventDiversityVerified:
            diversity.sourceEventDiversityVerified === true,
          distinctSourceEventCount: diversity.distinctSourceEventCount }, backtest,
          measurement, referenceMeasurement, laterMeasurement);
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: 'evaluation_window_descriptive_only', policy,
          numericalErrorAvailable: false,
          realAccuracyAvailable: false, realForecastEligible: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  return router;
}

module.exports = { createForecastPriceHistoryRouter };
