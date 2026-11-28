'use strict';

const express = require('express');
const { requireSession, requireVerifiedAccount } = require('../auth/middleware');
const { EnterpriseContextError } = require('../enterprise/context');
const { EnterpriseContextRepository } = require('../enterprise/contextRepository');

function createEnterpriseContextRouter(options = {}) {
  const router = express.Router();
  const repository = options.repository || new EnterpriseContextRepository();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.vary('Cookie');
    next();
  });
  const handle = (select, canonical = false) => async (req, res) => {
    try {
      if (req.originalUrl.includes('?') || (select && req.body === undefined)) {
        throw new EnterpriseContextError(400, 'enterprise_selection_invalid');
      }
      const principal = {
        actorUserId: req.tenantContext.userId, sessionId: req.authSession.id,
        organizationId: req.tenantContext.organizationId,
      };
      const value = await repository.read(principal, select ? req.body : undefined, canonical);
      return res.json({ success: true, data: value, requestId: req.requestId || 'unavailable' });
    } catch (error) {
      const known = error instanceof EnterpriseContextError;
      return res.status(known ? error.status : 503).json({
        success: false,
        error: { code: known ? error.code : 'enterprise_context_unavailable', message: 'Enterprise context is unavailable. Refresh the current account context.' },
        requestId: req.requestId || 'unavailable',
      });
    }
  };
  router.get('/', requireSession, requireVerifiedAccount, handle(false));
  router.post('/resolve', requireSession, requireVerifiedAccount, handle(true));
  router.post('/resolve-canonical', requireSession, requireVerifiedAccount, handle(true, true));
  return router;
}

module.exports = { createEnterpriseContextRouter };
