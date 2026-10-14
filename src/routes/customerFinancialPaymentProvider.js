'use strict';

const express = require('express');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/paymentProviderBoundaryRepository');

function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}

function createCustomerFinancialPaymentProviderRouter(options = {}) {
  const router = express.Router();
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner','admin');
  const read = options.read || repository.read;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-payment-provider:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie');
    next();
  });
  router.get('/', auth, role, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ success: false,
      error: { category: 'CUSTOMER_FINANCIAL_PAYMENT_PROVIDER_INVALID',
        message: 'Review the current tenant payment-provider boundary.' } });
    try { return res.json({ success: true, data: await read(source(req)) }); }
    catch (error) {
      return res.status(error?.status || 503).json({ success: false, error: {
        category: error?.code || 'CUSTOMER_FINANCIAL_PAYMENT_PROVIDER_UNAVAILABLE',
        message: error?.message || 'The payment-provider boundary is unavailable.',
      } });
    }
  });
  return router;
}

module.exports = { createCustomerFinancialPaymentProviderRouter };
