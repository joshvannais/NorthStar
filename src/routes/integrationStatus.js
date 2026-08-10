'use strict';

const express = require('express');
const db = require('../db');
const { requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { readIntegrationCatalogue } = require('../integrations/catalogue');
const { readCanonicalIntegrationStatuses } = require('../integrations/status');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function createIntegrationStatusRouter(options = {}) {
  const router = express.Router();
  const poolProvider = typeof options.poolProvider === 'function'
    ? options.poolProvider
    : () => db.getPool();
  const readStatuses = typeof options.readStatuses === 'function'
    ? options.readStatuses
    : readCanonicalIntegrationStatuses;
  const readCatalogue = typeof options.readCatalogue === 'function'
    ? options.readCatalogue
    : readIntegrationCatalogue;

  router.get('/status', requireTenantAccess, requirePermission('integrations', 'read'), async (req, res) => {
    try {
      const data = await readStatuses(poolProvider(), req.tenantContext.organizationId);
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      if (error && Number.isInteger(error.status) && typeof error.code === 'string') {
        return res.status(error.status).json({
          success: false,
          error: { code: error.code, message: error.message },
          requestId: requestId(req),
        });
      }
      console.warn('[Integrations] Canonical status unavailable:', {
        event: 'integration_status_read_failed',
        requestId: requestId(req),
      });
      return res.status(503).json({
        success: false,
        error: {
          code: 'CANONICAL_PERSISTENCE_UNAVAILABLE',
          message: 'Canonical PostgreSQL persistence is unavailable.',
        },
        requestId: requestId(req),
      });
    }
  });

  router.get('/catalogue', requireTenantAccess, requirePermission('integrations', 'read'), async (req, res) => {
    try {
      const data = await readCatalogue(poolProvider(), req.tenantContext.organizationId);
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      if (error && Number.isInteger(error.status) && typeof error.code === 'string') {
        return res.status(error.status).json({
          success: false,
          error: { code: error.code, message: error.message },
          requestId: requestId(req),
        });
      }
      console.warn('[Integrations] Canonical catalogue unavailable:', {
        event: 'integration_catalogue_read_failed',
        requestId: requestId(req),
      });
      return res.status(503).json({
        success: false,
        error: {
          code: 'CANONICAL_PERSISTENCE_UNAVAILABLE',
          message: 'Canonical PostgreSQL persistence is unavailable.',
        },
        requestId: requestId(req),
      });
    }
  });

  return router;
}

module.exports = { createIntegrationStatusRouter };
