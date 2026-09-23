'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { getActiveBusinessProfile } = require('../services/organizationAuthority');
const { adaptBusinessProfile } = require('../services/businessProfileAdapter');
const { deriveReportingWindow } = require('../forecasting/timeSeriesWindows');

const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);

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
  return router;
}

module.exports = { createForecastReportingWindowsRouter };
