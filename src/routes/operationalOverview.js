'use strict';

const express = require('express');
const db = require('../db');
const { requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { normalizeOverviewRead, validateOverviewResponse, overviewError } = require('../operations/overviewContract');
const { readOperationalOverview } = require('../operations/overviewRepository');

function createOperationalOverviewRouter(options = {}) {
  const router = express.Router();
  const tenantAuth = options.tenantAuth || requireTenantAccess;
  const throttle = options.throttle || rateLimit('internal-api');
  const poolProvider = options.poolProvider || (() => db.getPool());
  const read = options.readOverview || readOperationalOverview;
  router.get('/', (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    next();
  }, tenantAuth, throttle, requirePermission('operations', 'read'), async (req, res, next) => {
    try {
      if (!['owner', 'admin', 'member'].includes(req.userRole)) throw overviewError(403, 'OPERATIONAL_OVERVIEW_RESTRICTED');
      const query = normalizeOverviewRead(req.query);
      const input = {
        organizationId: req.tenantContext.organizationId,
        actorUserId: req.tenantContext.userId,
        actorAccessRole: req.userRole,
        authSessionId: req.authSession.id,
        ...query,
      };
      // Member/dispatcher qualification is reloaded by the canonical database
      // entry, not trusted from a browser claim or cached operational role.
      const data = validateOverviewResponse(await read(poolProvider(), input), req.userRole, query);
      res.json({ success: true, data, requestId: req.requestId });
    } catch (error) {
      next(error && /^OPERATIONAL_OVERVIEW_|^INVALID_OPERATIONAL_OVERVIEW_/.test(error.code || '') ?
        error : overviewError(503, 'OPERATIONAL_OVERVIEW_UNAVAILABLE'));
    }
  });
  return router;
}

module.exports = { createOperationalOverviewRouter };
