'use strict';

const express = require('express');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/paymentProviderConnectionRepository');

function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}

function sendError(res, error) {
  return res.status(error?.status || 503).json({ success: false, error: {
    category: error?.code || 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_UNAVAILABLE',
    message: error?.message || 'The payment-provider connection is unavailable.',
  } });
}

function createCustomerFinancialProviderConnectionRouter(options = {}) {
  const router = express.Router();
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner');
  const read = options.read || repository.read;
  const attempt = options.attempt || repository.attempt;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-provider-connection:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie');
    next();
  });
  router.get('/', auth, role, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return sendError(res, Object.assign(
      new Error('Review the provider connection boundary.'),
      { code: 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_INVALID', status: 400 }));
    try { return res.json({ success: true, data: await read(source(req)) }); }
    catch (error) { return sendError(res, error); }
  });
  router.post('/actions', auth, role, throttle, async (req, res) => {
    if (Object.keys(req.query).length !== 0) return sendError(res, Object.assign(
      new Error('Review the provider lifecycle action.'),
      { code: 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_INVALID', status: 400 }));
    try {
      const data = await attempt(source(req), req.body);
      return res.status(409).json({ success: false, data, error: {
        category: 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_UNAVAILABLE',
        message: 'Provider connection prerequisites are unavailable.',
      } });
    } catch (error) { return sendError(res, error); }
  });
  return router;
}

module.exports = { createCustomerFinancialProviderConnectionRouter };
