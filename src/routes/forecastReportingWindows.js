'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { getActiveBusinessProfile, getBusinessProfileById } =
  require('../services/organizationAuthority');
const { adaptBusinessProfile, sha256 } = require('../services/businessProfileAdapter');
const { deriveReportingWindow, compareReportingWindows } =
  require('../forecasting/timeSeriesWindows');

const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function attestationError(res, error) {
  const status = error?.code === '42501' ? 403 :
    error?.code === '22023' ? 400 :
      ['40001', '55P03', '23505'].includes(error?.code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_ACCESS_RESTRICTED' :
      status === 400 ? 'FORECAST_REQUEST_INVALID' :
        status === 409 ? 'FORECAST_CALENDAR_CHANGED' : 'FORECAST_CALENDAR_UNAVAILABLE',
    message: status === 403 ? 'Forecast calendar access is restricted.' :
      status === 400 ? 'The forecast calendar request is invalid.' :
        status === 409 ? 'Forecast calendar evidence changed. Refresh and try again.' :
          'Forecast calendar evidence is temporarily unavailable.',
  } });
}

function calendarAuthority(rawProfile) {
  return {
    hours: rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, 'hours')
      ? rawProfile.hours : null,
    timeZone: rawProfile && rawProfile.company &&
      Object.prototype.hasOwnProperty.call(rawProfile.company, 'timeZone')
      ? rawProfile.company.timeZone : null,
  };
}

function validRequestDate(value, grain) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.toISOString().slice(0, 10) !== value ||
      (grain === 'week' && date.getUTCDay() !== 1) ||
      (['month', 'quarter', 'year'].includes(grain) && day !== 1) ||
      (grain === 'quarter' && (month - 1) % 3 !== 0) ||
      (grain === 'year' && month !== 1)) return false;
  if (grain === 'day') date.setUTCDate(date.getUTCDate() + 1);
  else if (grain === 'week') date.setUTCDate(date.getUTCDate() + 7);
  else if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (grain === 'quarter') date.setUTCMonth(date.getUTCMonth() + 3);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.getUTCFullYear() <= 2100;
}

function createForecastReportingWindowsRouter(options = {}) {
  const router = express.Router();
  const pool = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-reporting-windows:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const captureThrottle = options.captureThrottle || rateLimit('forecast-source-capture', req =>
    `forecast-profile-month:${req.tenantContext.organizationId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });
  router.get('/', auth, requirePermission('forecast', 'read'), throttle,
    async (req, res) => {
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('localStartDate') ||
          !keys.includes('grain') ||
          typeof req.query.localStartDate !== 'string' ||
          typeof req.query.grain !== 'string' ||
          !GRAINS.has(req.query.grain) ||
          !validRequestDate(req.query.localStartDate, req.query.grain)) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The reporting window request is invalid.' } });
      }
      try {
        const profile = await getActiveBusinessProfile(pool(),
          req.tenantContext.organizationId);
        if (profile.organizationId !== req.tenantContext.organizationId ||
            !Number.isSafeInteger(profile.versionNumber) ||
            profile.versionNumber < 1 ||
            profile.versionLabel !== `org-profile-v${profile.versionNumber}` ||
            adaptBusinessProfile(profile.rawProfile, profile.versionLabel).hash !==
              profile.profileHash ||
            !profile.calendarAuthority ||
            sha256(calendarAuthority(profile.rawProfile)) !==
              sha256(profile.calendarAuthority)) {
          throw new Error('Invalid business profile authority');
        }
        const window = deriveReportingWindow({
          organizationId: profile.organizationId,
          businessProfileId: profile.id,
          businessProfileVersion: profile.versionNumber,
          businessProfileHash: profile.profileHash,
          rawProfile: profile.rawProfile,
          grain: req.query.grain,
          localStartDate: req.query.localStartDate,
          serviceKey: null,
          areaScope: 'tenant_all',
        });
        return res.json({ success: true, data: {
          window, profileBasis: 'current_active_profile_at_read',
          historicalCalendarVerified: false,
          observationCoverageVerified: false,
          sourceEligibilityVerified: false,
          forecastIssued: false,
        } });
      } catch (error) {
        return res.status(503).json({ success: false, error: {
          category: 'FORECAST_WINDOW_UNAVAILABLE',
          message: 'The reporting window is unavailable until the business profile can be verified.',
        } });
      }
    });

  router.get('/month-attestations', auth, requirePermission('forecast', 'read'),
    throttle, async (req, res) => {
      if (!exact(req.query, ['localStartDate']) ||
          !validRequestDate(req.query.localStartDate, 'month')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast calendar request is invalid.',
        } });
      }
      try {
        const result = await pool().query(
          'SELECT public.canonical_forecast_profile_month_attestation_read($1,$2,$3,$4,$5) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.query.localStartDate]);
        const value = result.rows[0]?.value ?? null;
        if (value !== null && (value.localStartDate !== req.query.localStartDate ||
            !UUID.test(value.id || '') || !DIGEST.test(value.digest || '') ||
            typeof value.profilePinVerified !== 'boolean')) {
          throw new Error('Invalid guarded calendar receipt');
        }
        return res.json({ success: true, data: {
          attestation: value, ownerConfirmedHistoricalProfile:
            value?.action === 'confirm', profilePinVerified:
            value?.profilePinVerified === true,
          historicalCalendarVerified: false,
          observationCoverageVerified: false, forecastIssued: false,
        } });
      } catch (error) { return attestationError(res, error); }
    });

  router.get('/reviewed-month-window', auth, requirePermission('forecast', 'read'),
    throttle, async (req, res) => {
      if (!exact(req.query, ['localStartDate']) ||
          !validRequestDate(req.query.localStartDate, 'month')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The reporting window request is invalid.',
        } });
      }
      let client;
      try {
        client = await pool().connect();
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await client.query(
          'SELECT public.canonical_forecast_profile_month_attestation_read($1,$2,$3,$4,$5) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.query.localStartDate]);
        const claim = result.rows[0]?.value ?? null;
        if (claim !== null && (claim.localStartDate !== req.query.localStartDate ||
            !UUID.test(claim.id || '') || !DIGEST.test(claim.digest || '') ||
            typeof claim.profilePinVerified !== 'boolean')) {
          throw new Error('Invalid guarded calendar receipt');
        }
        const base = { historicalCalendarVerified: false,
          observationCoverageVerified: false, sourceEligibilityVerified: false,
          forecastIssued: false };
        if (!claim || claim.action !== 'confirm' || !claim.profilePinVerified) {
          await client.query('COMMIT');
          return res.json({ success: true, data: { ...base, window: null,
            ownerConfirmedHistoricalProfile: claim?.action === 'confirm',
            profilePinVerified: false,
            unavailableReason: !claim ? 'no_reviewed_claim' :
              claim.action === 'revoke' ? 'claim_revoked' : 'profile_changed' } });
        }
        const profile = await getBusinessProfileById(client,
          req.tenantContext.organizationId, claim.businessProfileId);
        if (profile.versionNumber !== claim.businessProfileVersion ||
            profile.profileHash !== claim.businessProfileHash ||
            adaptBusinessProfile(profile.rawProfile, profile.versionLabel).hash !==
              claim.businessProfileHash) throw new Error('Business Profile pin is unavailable');
        const window = deriveReportingWindow({
          organizationId: profile.organizationId,
          businessProfileId: profile.id,
          businessProfileVersion: profile.versionNumber,
          businessProfileHash: profile.profileHash,
          rawProfile: profile.rawProfile, grain: 'month',
          localStartDate: req.query.localStartDate,
          serviceKey: null, areaScope: 'tenant_all',
        });
        await client.query('COMMIT');
        return res.json({ success: true, data: { ...base, window,
          profileBasis: 'owner_reviewed_month_claim',
          attestation: { id: claim.id, revision: claim.revision,
            digest: claim.digest, recordedAt: claim.recordedAt },
          ownerConfirmedHistoricalProfile: true, profilePinVerified: true } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return attestationError(res, error);
      } finally { if (client) client.release(); }
    });

  // This prospective source starts with an owner-captured profile and a
  // separate commit observation. It cannot certify a month before capture.
  router.post('/effective-anchors', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!exact(body, ['reason', 'confirmed']) || body.confirmed !== true ||
          typeof body.reason !== 'string' || body.reason.trim().length < 10 ||
          body.reason.length > 1000 || !KEY.test(key || '')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The profile source request is invalid.',
        } });
      }
      let client;
      try {
        client = await pool().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await client.query(
          'SELECT public.canonical_forecast_profile_effective_anchor_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.get('X-CSRF-Token'),
            key, body.reason, body.confirmed]);
        const value = result.rows[0]?.value;
        if (!value || !['profile_effective_anchor_recorded',
          'profile_effective_anchor_unavailable'].includes(value.state) ||
            (value.anchorId !== undefined && !UUID.test(value.anchorId))) {
          throw new Error('Invalid guarded profile source receipt');
        }
        await client.query('COMMIT');
        if (value.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(value.state === 'profile_effective_anchor_recorded' &&
          !value.replayed ? 201 : 200).json({ success: true, data: value });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return attestationError(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/effective-anchors/:anchorId/activate', auth,
    requirePermission('forecast', 'update'), captureThrottle, async (req, res) => {
      if (!UUID.test(req.params.anchorId) || !exact(req.body, [])) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The profile source request is invalid.',
        } });
      }
      let client;
      try {
        client = await pool().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await client.query(
          'SELECT public.canonical_forecast_profile_effective_anchor_activate($1,$2,$3,$4,$5,$6) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.get('X-CSRF-Token'),
            req.params.anchorId]);
        const value = result.rows[0]?.value;
        if (!value || !['profile_effective_activation_recorded',
          'profile_effective_activation_unavailable'].includes(value.state) ||
            (value.anchorId !== undefined && value.anchorId !== req.params.anchorId)) {
          throw new Error('Invalid guarded profile source receipt');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: value });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return attestationError(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/effective-anchors/:anchorId/month', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.anchorId) ||
          !exact(req.query, ['localStartDate']) ||
          !validRequestDate(req.query.localStartDate, 'month')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID', message: 'The reporting window request is invalid.',
        } });
      }
      let client;
      try {
        client = await pool().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const pin = await client.query(
          'SELECT public.canonical_forecast_profile_effective_anchor_pin($1,$2,$3,$4,$5) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.params.anchorId]);
        const source = pin.rows[0]?.value;
        if (!source || source.state !== 'profile_effective_anchor_pinned') {
          await client.query('COMMIT');
          return res.json({ success: true, data: {
            window: null, historicalCalendarVerified: false,
            observationCoverageVerified: false, forecastIssued: false,
            unavailableReason: 'anchor_not_found',
          } });
        }
        const profile = await getBusinessProfileById(client,
          req.tenantContext.organizationId, source.businessProfileId);
        if (profile.versionNumber !== source.businessProfileVersion ||
            profile.profileHash !== source.businessProfileHash ||
            adaptBusinessProfile(profile.rawProfile, profile.versionLabel).hash !==
              source.businessProfileHash) throw new Error('Business Profile pin is unavailable');
        const window = deriveReportingWindow({
          organizationId: profile.organizationId,
          businessProfileId: profile.id,
          businessProfileVersion: profile.versionNumber,
          businessProfileHash: profile.profileHash,
          rawProfile: profile.rawProfile, grain: 'month',
          localStartDate: req.query.localStartDate,
          serviceKey: null, areaScope: 'tenant_all',
        });
        const result = await client.query(
          'SELECT public.canonical_forecast_profile_effective_window($1,$2,$3,$4,$5,$6,$7) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.params.anchorId,
            window.startsAt, window.endsAt]);
        const value = result.rows[0]?.value;
        if (!value || typeof value.state !== 'string' ||
            (value.state === 'profile_effective_window_verified' &&
              (value.businessProfileId !== profile.id ||
               value.businessProfileHash !== profile.profileHash ||
               !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.startsAt || '') ||
               !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.endsAt || '') ||
               Date.parse(value.startsAt) !== Date.parse(window.startsAt) ||
               Date.parse(value.endsAt) !== Date.parse(window.endsAt)))) {
          throw new Error('Invalid guarded profile source window');
        }
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          window: value.state === 'profile_effective_window_verified' ? window : null,
          profileBasis: 'prospective_source_observed_profile',
          historicalCalendarVerified: value.historicalCalendarVerified === true,
          observationCoverageVerified: false, forecastIssued: false,
          unavailableReason: value.reason || null,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return attestationError(res, error);
      } finally { if (client) client.release(); }
    });

  router.get('/effective-anchors/:anchorId/compare-months', auth,
    requirePermission('forecast', 'read'), throttle, async (req, res) => {
      if (!UUID.test(req.params.anchorId) ||
          !exact(req.query, ['firstLocalStartDate', 'secondLocalStartDate',
            'areaScope']) ||
          !validRequestDate(req.query.firstLocalStartDate, 'month') ||
          !validRequestDate(req.query.secondLocalStartDate, 'month') ||
          req.query.firstLocalStartDate >= req.query.secondLocalStartDate ||
          !['tenant_all', 'profile_area'].includes(req.query.areaScope)) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The reporting period comparison request is invalid.',
        } });
      }
      const unavailable = reason => ({ state: 'unavailable', reason,
        windows: null, historicalCalendarVerified: false,
        observationCoverageVerified: false,
        areaObservationCoverageVerified: false, forecastIssued: false });
      let client;
      try {
        client = await pool().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const pin = (await client.query(
          'SELECT public.canonical_forecast_profile_effective_anchor_pin($1,$2,$3,$4,$5) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.params.anchorId])).rows[0]?.value;
        if (!pin || !['profile_effective_anchor_pinned',
          'profile_effective_anchor_unavailable'].includes(pin.state)) {
          throw new Error('Invalid guarded profile anchor');
        }
        if (pin.state !== 'profile_effective_anchor_pinned') {
          await client.query('COMMIT');
          return res.json({ success: true, data: unavailable('anchor_not_found') });
        }
        const profile = await getBusinessProfileById(client,
          req.tenantContext.organizationId, pin.businessProfileId);
        if (profile.versionNumber !== pin.businessProfileVersion ||
            profile.profileHash !== pin.businessProfileHash ||
            adaptBusinessProfile(profile.rawProfile, profile.versionLabel).hash !==
              pin.businessProfileHash) {
          await client.query('COMMIT');
          return res.json({ success: true, data: unavailable('profile_changed') });
        }
        let windows;
        try {
          windows = [req.query.firstLocalStartDate,
            req.query.secondLocalStartDate].map(localStartDate =>
            deriveReportingWindow({
              organizationId: profile.organizationId,
              businessProfileId: profile.id,
              businessProfileVersion: profile.versionNumber,
              businessProfileHash: profile.profileHash,
              rawProfile: profile.rawProfile, grain: 'month', localStartDate,
              serviceKey: null, areaScope: req.query.areaScope,
            }));
        } catch (error) {
          if (error?.code !== 'M26_REPORTING_WINDOW_UNAVAILABLE') throw error;
          await client.query('COMMIT');
          return res.json({ success: true,
            data: unavailable(error.reason || 'reporting_window_unavailable') });
        }
        for (const window of windows) {
          const proof = (await client.query(
            'SELECT public.canonical_forecast_profile_effective_window($1,$2,$3,$4,$5,$6,$7) value',
            [req.tenantContext.organizationId, req.tenantContext.userId,
              req.userRole, req.authSession.id, req.params.anchorId,
              window.startsAt, window.endsAt])).rows[0]?.value;
          if (!proof || !['profile_effective_window_verified',
            'profile_effective_window_unavailable'].includes(proof.state)) {
            throw new Error('Invalid guarded profile window');
          }
          if (proof.state !== 'profile_effective_window_verified') {
            await client.query('COMMIT');
            return res.json({ success: true,
              data: unavailable(proof.reason || 'profile_period_unverified') });
          }
          if (proof.anchorId !== req.params.anchorId ||
              proof.businessProfileId !== window.businessProfileId ||
              proof.businessProfileVersion !== window.businessProfileVersion ||
              proof.businessProfileHash !== window.businessProfileHash ||
              !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(proof.startsAt || '') ||
              !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(proof.endsAt || '') ||
              Date.parse(proof.startsAt) !== Date.parse(window.startsAt) ||
              Date.parse(proof.endsAt) !== Date.parse(window.endsAt)) {
            throw new Error('Invalid guarded profile period identity');
          }
        }
        const context = compareReportingWindows(windows[0], windows[1]);
        await client.query('COMMIT');
        return res.json({ success: true, data: {
          state: context.comparableContext ? 'comparable_profile_context' :
            'incomparable_profile_context',
          reason: context.comparableContext ? null : context.reasons,
          windows, areaScope: req.query.areaScope,
          normalizationRequired: context.normalizationRequired,
          normalizationDimensions: !context.comparableContext ? [] : [
            ...(windows[0].elapsedMinutes !== windows[1].elapsedMinutes ?
              ['elapsed_minutes'] : []),
            ...(windows[0].openMinutes !== windows[1].openMinutes ?
              ['open_minutes'] : []),
            ...(windows[0].calendarDigest !== windows[1].calendarDigest ?
              ['calendar_revision'] : []),
          ],
          historicalCalendarVerified: context.comparableContext,
          observationCoverageVerified: false,
          areaObservationCoverageVerified: false,
          forecastIssued: false,
        } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return attestationError(res, error);
      } finally { if (client) client.release(); }
    });

  router.post('/month-attestations', auth, requirePermission('forecast', 'update'),
    captureThrottle, async (req, res) => {
      const body = req.body;
      const key = req.get('Idempotency-Key');
      if (!exact(body, ['localStartDate', 'action', 'businessProfileId',
        'businessProfileHash', 'expectedRevision', 'expectedDigest', 'reason',
        'confirmed', 'confirmationVersion']) ||
          !validRequestDate(body.localStartDate, 'month') ||
          !['confirm', 'revoke'].includes(body.action) ||
          !UUID.test(body.businessProfileId || '') ||
          !DIGEST.test(body.businessProfileHash || '') ||
          !Number.isInteger(body.expectedRevision) ||
          body.expectedRevision < 0 || body.expectedRevision >= 1000 ||
          (body.expectedRevision === 0 ? body.expectedDigest !== null :
            !DIGEST.test(body.expectedDigest || '')) ||
          typeof body.reason !== 'string' || !body.reason.trim() ||
          body.reason.length > 1000 || body.confirmed !== true ||
          body.confirmationVersion !== 'forecast-calendar-review-v1' ||
          !KEY.test(key || '')) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The forecast calendar request is invalid.',
        } });
      }
      let client;
      try {
        client = await pool().connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await client.query(
          'SELECT public.canonical_forecast_profile_month_attestation_capture($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) value',
          [req.tenantContext.organizationId, req.tenantContext.userId,
            req.userRole, req.authSession.id, req.get('X-CSRF-Token'), key,
            body.localStartDate, body.action, body.businessProfileId,
            body.businessProfileHash, body.expectedRevision, body.expectedDigest,
            body.reason, body.confirmed, body.confirmationVersion]);
        const receipt = result.rows[0]?.value;
        if (!receipt || !UUID.test(receipt.id || '') ||
            !DIGEST.test(receipt.digest || '') ||
            !Number.isInteger(receipt.revision) ||
            receipt.action !== body.action || typeof receipt.replayed !== 'boolean' ||
            typeof receipt.profilePinVerified !== 'boolean') {
          throw new Error('Invalid guarded calendar receipt');
        }
        if (receipt.action === 'confirm' && !receipt.replayed &&
            !receipt.profilePinVerified) throw new Error('Business Profile pin is unavailable');
        if (receipt.action === 'confirm' && !receipt.replayed) {
          const profile = await getBusinessProfileById(client,
            req.tenantContext.organizationId, body.businessProfileId);
          if (profile.versionNumber < 1 ||
              profile.profileHash !== body.businessProfileHash ||
              adaptBusinessProfile(profile.rawProfile, profile.versionLabel).hash !==
                body.businessProfileHash) {
            throw new Error('Business Profile pin is unavailable');
          }
        }
        await client.query('COMMIT');
        if (receipt.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(receipt.replayed ? 200 : 201).json({ success: true,
          data: { ...receipt, ownerConfirmedHistoricalProfile:
            receipt.action === 'confirm',
          historicalCalendarVerified: false,
          observationCoverageVerified: false, forecastIssued: false } });
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return attestationError(res, error);
      } finally { if (client) client.release(); }
    });
  return router;
}

module.exports = { createForecastReportingWindowsRouter };
