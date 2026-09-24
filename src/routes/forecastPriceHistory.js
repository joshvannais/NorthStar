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
const { sha256 } = require('../services/businessProfileAdapter');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
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
  const readPosition = options.readPosition || readGuardedApprovedPriceFlow;
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });

  // A separate transaction must observe the first ordered receipt committed
  // before its prospective source coverage can be used for a local period.
  router.post('/ordered-anchor/activate', auth,
    requirePermission('forecast', 'update'), captureThrottle, async (req, res) => {
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
        return res.json({ success: true, data: { ...saved, output: null,
          outputDigest: sha256(output), forecastValueAvailable: false } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return errorReply(res, error);
      } finally { if (client) client.release(); }
    });

  return router;
}

module.exports = { createForecastPriceHistoryRouter };
