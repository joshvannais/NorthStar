'use strict';

const express = require('express');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/providerLifecycleAcceptanceRepository');
function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}
function sendError(res, error) {
  return res.status(error?.status || 503).json({ success: false, error: {
    category: error?.code || 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_UNAVAILABLE',
    message: error?.message || 'Provider lifecycle acceptance is unavailable.',
  } });
}
function createCustomerFinancialProviderAcceptanceRouter(options = {}) {
  const router = express.Router();
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner');
  const read = options.read || repository.read;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-provider-acceptance:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie'); next();
  });
  const exactInput = (req, res, next) => {
    if (Object.keys(req.query).length === 0 &&
        (req.body === undefined || req.body === null ||
          (typeof req.body === 'object' && !Array.isArray(req.body) &&
            Object.keys(req.body).length === 0))) return next();
    return sendError(res, Object.assign(new Error('Review the provider lifecycle acceptance request.'),
      { code: 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_INVALID', status: 400 }));
  };
  router.get('/', exactInput, auth, role, throttle, async (req, res) => {
    try { return res.json({ success: true, data: await read(source(req)) }); }
    catch (error) { return sendError(res, error); }
  });
  router.all('/', (_req, res) => {
    res.set('Allow', 'GET');
    return sendError(res, Object.assign(new Error('Use the provider lifecycle acceptance read boundary.'),
      { code: 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_METHOD_NOT_ALLOWED', status: 405 }));
  });
  return router;
}
module.exports = { createCustomerFinancialProviderAcceptanceRouter, source, sendError };
