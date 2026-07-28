/**
 * Organization-scoped canonical Business Profile API.
 *
 * Reads, validation, and writes on this mounted tenant route use the persisted
 * organization profile contract. No file-backed profile singleton is loaded.
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { getActiveBusinessProfile, putBusinessProfile } = require('../services/organizationAuthority');
const {
  migrateLegacyCanonicalAuthority,
  prepareBusinessProfileForWrite,
  synchronizeLegacyFinancial,
} = require('../services/businessProfileAdapter');

const VALID_SECTIONS = new Set([
  'company', 'headquarters', 'serviceArea', 'routing', 'hours', 'crew',
  'vehicles', 'services', 'financial', 'scheduling', 'polaris', 'retell',
  'notifications', 'integrations', 'canonicalPricing', 'canonicalCosts',
]);

function sendError(res, error) {
  const status = error && error.status ? error.status : 503;
  const code = error && error.code ? error.code : 'CANONICAL_PERSISTENCE_UNAVAILABLE';
  const message = status === 503 && code !== 'CANONICAL_BUSINESS_PROFILE_REQUIRED'
    ? 'Canonical PostgreSQL persistence is unavailable.' : error.message;
  return res.status(status).json({ success: false, error: { code, message } });
}

function response(profile) {
  const editable = migrateLegacyCanonicalAuthority(profile.rawProfile);
  synchronizeLegacyFinancial(editable.profile);
  return {
    ...editable.profile,
    canonicalAuthority: {
      id: profile.id,
      version: profile.versionLabel,
      hash: profile.profileHash,
      createdAt: profile.createdAt,
      legacyMigration: {
        pending: editable.migratedFields.length > 0,
        fields: editable.migratedFields,
      },
    },
  };
}

async function active(req) {
  return getActiveBusinessProfile(db.getPool(), req.tenantContext.organizationId);
}

async function persist(req, rawProfile) {
  const source = rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
    ? { ...rawProfile } : {};
  delete source.canonicalAuthority;
  const prepared = prepareBusinessProfileForWrite(source);
  if (prepared.errors.length) {
    const error = new Error('Business Profile validation failed.');
    error.status = 400;
    error.code = 'INVALID_BUSINESS_PROFILE';
    error.details = prepared.errors;
    throw error;
  }
  const stored = await putBusinessProfile(db.getPool(), {
    organizationId: req.tenantContext.organizationId,
    userId: req.tenantContext.userId,
    profile: prepared.profile,
  });
  return stored;
}

router.get('/', requireAuth, async function (req, res) {
  try {
    return res.json({ success: true, data: response(await active(req)) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put('/', requireAuth, requirePermission('settings', 'update'), async function (req, res) {
  try {
    return res.json({ success: true, data: response(await persist(req, req.body || {})) });
  } catch (error) {
    if (error.details) return res.status(400).json({ success: false, errors: error.details });
    return sendError(res, error);
  }
});

router.put('/:section', requireAuth, requirePermission('settings', 'update'), async function (req, res) {
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

router.get('/:section', requireAuth, async function (req, res) {
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
