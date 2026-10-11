'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/billingIdentityJourneyRepository');

function sourceActor(req, mutation) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id,
    ...(mutation ? { csrfToken: req.get('X-CSRF-Token') } : {}) };
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
}
function replyError(res, error) {
  const busy = ['55P03','57014'].includes(error?.code);
  const status = error?.status || (error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 : busy ? 503 :
      ['40001','40P01','23505'].includes(error?.code) ? 409 : 503);
  if (busy) res.set('Retry-After', '2');
  const category = error?.status ? error.code : status === 403 ?
    'CUSTOMER_FINANCIAL_BILLING_JOURNEY_RESTRICTED' : status === 400 ?
      'CUSTOMER_FINANCIAL_BILLING_JOURNEY_INVALID' : status === 409 ?
        'CUSTOMER_FINANCIAL_BILLING_JOURNEY_CHANGED' : busy ?
          'CUSTOMER_FINANCIAL_BILLING_JOURNEY_BUSY' :
          'CUSTOMER_FINANCIAL_BILLING_JOURNEY_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'Billing identity review requires a current owner or administrator capability.' :
    status === 400 ? 'Check the billing identity review and try again.' :
      status === 409 ? 'Billing identity evidence changed. Refresh before reviewing again.' :
        busy ? 'Billing identity review is busy. Retry shortly.' :
          'Billing identity review is temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}
function createCustomerFinancialBillingIdentityRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner', 'admin');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-billing-identity:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store'); res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff'); res.vary('Cookie'); next();
  });
  router.get('/:customerId', auth, role, throttle, async (req, res) => {
    if (Object.keys(req.query).length) return replyError(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_BILLING_JOURNEY_INVALID',
      message: 'Check the billing identity review and try again.' });
    try {
      return res.json({ success: true,
        data: await repository.current(poolProvider(), sourceActor(req, false), req.params.customerId) });
    } catch (error) { return replyError(res, error); }
  });
  router.post('/:customerId/establish', auth, role, throttle, async (req, res) => {
    if (!exact(req.body, ['expectedSourceDigest','expectedSourceUpdatedAt','reason'])) {
      return replyError(res, { status: 400, code: 'CUSTOMER_FINANCIAL_BILLING_JOURNEY_INVALID',
        message: 'Check the billing identity establishment and try again.' });
    }
    try {
      const result = await repository.establish(poolProvider(), sourceActor(req, true),
        { customerId: req.params.customerId, ...req.body }, req.get('Idempotency-Key'));
      if (result.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(result.status).json({ success: true, data: result.body,
        replayed: result.replayed });
    } catch (error) { return replyError(res, error); }
  });
  router.post('/:customerId/reviews', auth, role, throttle, async (req, res) => {
    const keys = ['billingPartyId','originSnapshotId','expectedSourceDigest','expectedSourceUpdatedAt',
      'expectedPreviousReviewId','expectedPreviousReviewDigest','expectedPreviousSequence','payload','reason'];
    if (!exact(req.body, keys)) return replyError(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_BILLING_JOURNEY_INVALID',
      message: 'Check the billing identity review and try again.' });
    try {
      const result = await repository.accept(poolProvider(), sourceActor(req, true),
        { customerId: req.params.customerId, ...req.body }, req.get('Idempotency-Key'));
      if (result.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(result.status).json({ success: true, data: result.body,
        replayed: result.replayed });
    } catch (error) { return replyError(res, error); }
  });
  return router;
}

module.exports = { createCustomerFinancialBillingIdentityRouter, replyError, sourceActor };
