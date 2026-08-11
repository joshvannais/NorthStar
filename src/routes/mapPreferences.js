'use strict';

const express = require('express');
const { requireAccountMutation, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const {
  MapPreferenceError,
  parseOrganizationWrite,
  parseUserWrite,
  projectMapPreferences,
} = require('../mapPreferences/contract');
const { MapPreferencesRepository } = require('../mapPreferences/repository');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function failure(req, res, error) {
  if (error instanceof MapPreferenceError) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      requestId: requestId(req),
    });
  }
  console.warn('[MapPreferences] Canonical authority unavailable:', {
    event: 'map_preferences_authority_unavailable',
    requestId: requestId(req),
  });
  return res.status(503).json({
    success: false,
    error: {
      code: 'MAP_PREFERENCES_UNAVAILABLE',
      message: 'Canonical map preferences are temporarily unavailable.',
    },
    requestId: requestId(req),
  });
}

function createMapPreferencesRouter(options = {}) {
  const router = express.Router();
  const repositoryProvider = typeof options.repositoryProvider === 'function'
    ? options.repositoryProvider
    : () => new MapPreferencesRepository();

  async function readProjection(req) {
    const stored = await repositoryProvider().read(
      req.tenantContext.organizationId,
      req.tenantContext.userId
    );
    return projectMapPreferences({ ...stored, role: req.tenantContext.role });
  }

  router.get('/', requireTenantAccess, async (req, res) => {
    try {
      const data = await readProjection(req);
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error);
    }
  });

  router.put(
    '/organization',
    requireAccountMutation,
    requirePermission('settings', 'update'),
    async (req, res) => {
      try {
        const parsed = parseOrganizationWrite(req.body);
        const repository = repositoryProvider();
        const result = await repository.updateOrganization({
          organizationId: req.tenantContext.organizationId,
          actorUserId: req.tenantContext.userId,
          ...parsed,
        });
        const stored = await repository.read(
          req.tenantContext.organizationId,
          req.tenantContext.userId
        );
        const data = projectMapPreferences({ ...stored, role: req.tenantContext.role });
        return res.json({ success: true, changed: result.changed, data, requestId: requestId(req) });
      } catch (error) {
        return failure(req, res, error);
      }
    }
  );

  router.put('/me', requireAccountMutation, async (req, res) => {
    try {
      const parsed = parseUserWrite(req.body);
      const repository = repositoryProvider();
      const result = await repository.updateUser({
        organizationId: req.tenantContext.organizationId,
        actorUserId: req.tenantContext.userId,
        ...parsed,
      });
      const stored = await repository.read(
        req.tenantContext.organizationId,
        req.tenantContext.userId
      );
      const data = projectMapPreferences({ ...stored, role: req.tenantContext.role });
      return res.json({ success: true, changed: result.changed, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error);
    }
  });

  return router;
}

module.exports = { createMapPreferencesRouter };
