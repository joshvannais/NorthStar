'use strict';

const express = require('express');
const { requireAccountMutation, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const {
  AssetCatalogueError,
  AssetCatalogueService,
} = require('../assets/service');
const { AssetCataloguePersistenceError } = require('../assets/repository');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function context(req) {
  return {
    organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId,
  };
}

function service(req) {
  const injected = req.app && req.app.locals && req.app.locals.assetCatalogueService;
  return injected && typeof injected.snapshot === 'function' ? injected : new AssetCatalogueService();
}

function failure(req, res, error, event) {
  if (error instanceof AssetCatalogueError ||
      (error && Number.isInteger(error.status) && typeof error.code === 'string')) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      requestId: requestId(req),
    });
  }
  if (error instanceof AssetCataloguePersistenceError ||
      (error && error.name === 'AssetCataloguePersistenceError')) {
    console.warn('[Assets] PostgreSQL authority unavailable:', { event, requestId: requestId(req) });
    return res.status(503).json({
      success: false,
      error: {
        code: 'asset_catalogue_authority_unavailable',
        message: 'Asset catalogue authority is temporarily unavailable',
      },
      requestId: requestId(req),
    });
  }
  const diagnostic = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(value)
    ? value : 'unexpected';
  console.error('[Assets] Request failed:', {
    event,
    requestId: requestId(req),
    code: diagnostic(error && error.code),
    constraint: diagnostic(error && error.constraint),
  });
  return res.status(500).json({
    success: false,
    error: { code: 'asset_catalogue_request_failed', message: 'Asset catalogue request failed' },
    requestId: requestId(req),
  });
}

function createAssetCatalogueRouter() {
  const router = express.Router();

  router.get('/', requireTenantAccess, requirePermission('assets', 'read'), async (req, res) => {
    try {
      const data = await service(req).snapshot(
        req.tenantContext.organizationId,
        req.tenantContext.role
      );
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'asset_catalogue_read_failed');
    }
  });

  router.post('/', requireAccountMutation, requirePermission('assets', 'create'), async (req, res) => {
    try {
      const data = await service(req).create(req.body || {}, context(req));
      return res.status(201).json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'asset_catalogue_create_failed');
    }
  });

  router.put('/:assetId', requireAccountMutation, requirePermission('assets', 'update'), async (req, res) => {
    try {
      const data = await service(req).update(req.params.assetId, req.body || {}, context(req));
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'asset_catalogue_update_failed');
    }
  });

  router.patch('/:assetId/catalogue-state', requireAccountMutation,
    requirePermission('assets', 'update'), async (req, res) => {
      try {
        const data = await service(req).setCatalogueState(
          req.params.assetId,
          req.body || {},
          context(req)
        );
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) {
        return failure(req, res, error, 'asset_catalogue_state_failed');
      }
    });

  return router;
}

module.exports = { createAssetCatalogueRouter };
