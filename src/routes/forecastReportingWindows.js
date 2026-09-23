'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { getActiveBusinessProfile } = require('../services/organizationAuthority');
const { deriveReportingWindow } = require('../forecasting/timeSeriesWindows');

const GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);

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
          !GRAINS.has(req.query.grain)) {
        return res.status(400).json({ success: false, error: {
          category: 'FORECAST_REQUEST_INVALID',
          message: 'The reporting window request is invalid.' } });
      }
      try {
        const profile = await getActiveBusinessProfile(pool(),
          req.tenantContext.organizationId);
        if (profile.organizationId !== req.tenantContext.organizationId ||
            !Number.isSafeInteger(profile.versionNumber) ||
            profile.versionNumber < 1) throw new Error('Invalid business profile authority');
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
        const invalid = error?.code === 'M26_REPORTING_WINDOW_INVALID';
        return res.status(invalid ? 400 : 503).json({ success: false, error: {
          category: invalid ? 'FORECAST_REQUEST_INVALID' : 'FORECAST_WINDOW_UNAVAILABLE',
          message: invalid ? 'The reporting window request is invalid.' :
            'The reporting window is unavailable until the business profile can be verified.',
        } });
      }
    });
  return router;
}

module.exports = { createForecastReportingWindowsRouter };
