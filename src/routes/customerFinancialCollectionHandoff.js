'use strict';

const express = require('express');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/collectionHandoffReadinessRepository');

function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}

function createCustomerFinancialCollectionHandoffRouter(options = {}) {
  const router = express.Router();
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner','admin');
  const read = options.read || repository.read;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-collection-handoff:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie');
    next();
  });
  router.all('/', (req, res, next) => {
    if (req.method === 'GET') return next();
    return res.status(405).json({ success: false, error: {
      category: 'CUSTOMER_FINANCIAL_COLLECTION_HANDOFF_METHOD_NOT_ALLOWED',
      message: 'Use the exact collection-handoff readiness boundary.',
    } });
  });
  router.get('/', auth, role, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ success: false,
      error: { category: 'CUSTOMER_FINANCIAL_COLLECTION_HANDOFF_INVALID',
        message: 'Review the exact current tenant collection-handoff boundary.' } });
    try { return res.json({ success: true, data: await read(source(req)) }); }
    catch (error) {
      return res.status(error?.status || 503).json({ success: false, error: {
        category: error?.code || 'CUSTOMER_FINANCIAL_COLLECTION_HANDOFF_UNAVAILABLE',
        message: error?.message || 'The collection handoff is unavailable.',
      } });
    }
  });
  return router;
}

module.exports = { createCustomerFinancialCollectionHandoffRouter };
