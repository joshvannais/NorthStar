'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { getActiveBusinessProfile, getBusinessProfileById } =
  require('../services/organizationAuthority');
const { adaptBusinessProfile } = require('../services/businessProfileAdapter');
const { deriveReportingWindow } = require('../forecasting/timeSeriesWindows');

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
              profile.profileHash) throw new Error('Invalid business profile authority');
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
