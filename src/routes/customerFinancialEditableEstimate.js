'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/editableEstimateBasisRepository');
const workContextRepository = require('../customerFinancial/billableWorkContextRepository');

function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}
function failure(res, error) {
  const busy = ['55P03','57014'].includes(error?.code);
  const status = error?.status || (error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 : busy ? 503 : 503);
  if (busy) res.set('Retry-After','2');
  const category = error?.status ? error.code : status === 403 ?
    'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_RESTRICTED' : status === 400 ?
      'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_INVALID' : busy ?
        'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_BUSY' :
        'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'Editable estimate access requires a current owner or administrator capability.' :
    status === 400 ? 'Select one exact current estimate.' : busy ?
      'The editable estimate source is busy. Retry shortly.' :
      'The editable estimate source is temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}
function createCustomerFinancialEditableEstimateRouter(options = {}) {
  const router = express.Router(); const poolProvider = options.poolProvider || (() => db.getPool());
  const basisRead = options.basisRead || repository.read;
  const workContextRead = options.workContextRead || workContextRepository.read;
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner','admin');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-editable-estimate:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req,res,next) => { res.set('Cache-Control','private, no-store');
    res.set('Referrer-Policy','no-referrer'); res.set('X-Content-Type-Options','nosniff');
    res.vary('Cookie'); next(); });
  router.get('/:estimateId/basis', auth, role, throttle, async (req,res) => {
    if (Object.keys(req.query).length) return failure(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_INVALID',
      message: 'Select one exact current estimate.' });
    try { return res.json({ success: true,
      data: await basisRead(poolProvider(), source(req), req.params.estimateId) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/work-context', auth, role, throttle, async (req,res) => {
    if (Object.keys(req.query).length) return failure(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_INVALID',
      message: 'Select one exact current estimate.' });
    try { return res.json({ success: true,
      data: await workContextRead(poolProvider(), source(req), req.params.estimateId) });
    } catch (error) { return failure(res,error); }
  });
  return router;
}

module.exports = { createCustomerFinancialEditableEstimateRouter, failure, source };
