'use strict';

const express = require('express');
const db = require('../db');
const { requireAccountMutation, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const centerContract = require('../../public/js/automation-center-contract');
const { readAutomationCenter } = require('../automationCenter/repository');

function centerError(status, code, message) {
  return Object.assign(new Error(message || code), { status, code });
}
function ownerOrAdmin(req, _res, next) {
  if (!['owner', 'admin'].includes(req.userRole)) return next(centerError(403, 'AUTOMATION_CENTER_RESTRICTED'));
  return next();
}
function noStore(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.vary('Cookie');
  next();
}

function createAutomationCenterRouter(options = {}) {
  const router = express.Router();
  const tenantAuth = options.tenantAuth || requireTenantAccess;
  const mutationAuth = options.mutationAuth || requireAccountMutation;
  const throttle = options.throttle || rateLimit(
    'internal-api',
    req => `automation-center:${req.tenantContext.organizationId}:${req.tenantContext.userId}`
  );
  const poolProvider = options.poolProvider || (() => db.getPool());
  const read = options.readCenter || readAutomationCenter;

  router.get('/', noStore, tenantAuth, throttle, requirePermission('automation', 'read'), ownerOrAdmin,
    async (req, res, next) => {
      try {
        const data = await read(poolProvider(), {
          organizationId: req.tenantContext.organizationId,
          actorUserId: req.tenantContext.userId,
          actorAccessRole: req.userRole,
          authSessionId: req.authSession.id,
        });
        res.json({ success: true, data, requestId: req.requestId });
      } catch (error) {
        next(error && /^AUTOMATION_CENTER_/.test(error.code || '')
          ? error : centerError(503, 'AUTOMATION_CENTER_UNAVAILABLE'));
      }
    });

  router.post('/preview', noStore, tenantAuth, mutationAuth, throttle,
    requirePermission('automation', 'update'), ownerOrAdmin, (req, res, next) => {
      try {
        // Preview is deliberately pure. It stores no policy, approval, schedule,
        // queue item, message, provider attempt, external effect, or money effect.
        const data = centerContract.buildPreview(req.body);
        res.json({ success: true, data, requestId: req.requestId });
      } catch (error) {
        next(centerError(400, 'AUTOMATION_CENTER_PREVIEW_INVALID', error.message));
      }
    });

  return router;
}

module.exports = { createAutomationCenterRouter };
