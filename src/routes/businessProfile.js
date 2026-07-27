/**
 * Organization-scoped canonical Business Profile API.
 *
 * The file-backed profile service is used only to validate the established
 * input shape. Reads and writes on this mounted tenant route use PostgreSQL.
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const cache = require('../cache/client');
const fixtureProfile = require('../services/businessProfile');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { getActiveBusinessProfile, putBusinessProfile } = require('../services/organizationAuthority');

const VALID_SECTIONS = new Set([
  'company', 'headquarters', 'serviceArea', 'routing', 'hours', 'crew',
  'vehicles', 'services', 'financial', 'scheduling', 'polaris', 'retell',
  'notifications', 'integrations', 'canonicalPricing', 'canonicalCosts',
]);

router.use(requireAuth);

function sendError(res, error) {
  const status = error && error.status ? error.status : 503;
  const code = error && error.code ? error.code : 'CANONICAL_PERSISTENCE_UNAVAILABLE';
  const message = status === 503 && code !== 'CANONICAL_BUSINESS_PROFILE_REQUIRED'
    ? 'Canonical PostgreSQL persistence is unavailable.' : error.message;
  return res.status(status).json({ success: false, error: { code, message } });
}

function response(profile) {
  return {
    ...profile.rawProfile,
    canonicalAuthority: {
      id: profile.id,
      version: profile.versionLabel,
      hash: profile.profileHash,
      createdAt: profile.createdAt,
    },
  };
}

async function active(req) {
  return getActiveBusinessProfile(db.getPool(), req.tenantContext.organizationId);
}

async function persist(req, rawProfile) {
  const validation = fixtureProfile.validateProfile(rawProfile);
  if (!validation.valid) {
    const error = new Error('Business Profile validation failed.');
    error.status = 400;
    error.code = 'INVALID_BUSINESS_PROFILE';
    error.details = validation.errors;
    throw error;
  }
  const stored = await putBusinessProfile(db.getPool(), {
    organizationId: req.tenantContext.organizationId,
    userId: req.tenantContext.userId,
    profile: rawProfile,
  });
  try {
    await cache.invalidateOrg(req.tenantContext.organizationId);
  } catch (_cacheError) {
    // PostgreSQL remains authoritative.
  }
  return stored;
}

router.get('/', async function (req, res) {
  try {
    return res.json({ success: true, data: response(await active(req)) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put('/', requirePermission('settings', 'update'), async function (req, res) {
  try {
    return res.json({ success: true, data: response(await persist(req, req.body || {})) });
  } catch (error) {
    if (error.details) return res.status(400).json({ success: false, errors: error.details });
    return sendError(res, error);
  }
});

router.put('/:section', requirePermission('settings', 'update'), async function (req, res) {
  const section = req.params.section;
  if (!VALID_SECTIONS.has(section)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_PROFILE_SECTION', message: 'Business Profile section is invalid.' } });
  }
  try {
    const current = await active(req);
    const updated = { ...current.rawProfile, [section]: req.body };
    return res.json({ success: true, data: response(await persist(req, updated)) });
  } catch (error) {
    if (error.details) return res.status(400).json({ success: false, errors: error.details });
    return sendError(res, error);
  }
});

router.get('/:section', async function (req, res) {
  const section = req.params.section;
  if (!VALID_SECTIONS.has(section)) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Business Profile section not found.' } });
  }
  try {
    const profile = await active(req);
    return res.json({ success: true, data: profile.rawProfile[section] });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
