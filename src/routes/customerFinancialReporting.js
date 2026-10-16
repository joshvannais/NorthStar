'use strict';

const express = require('express');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/invoiceReceivableReportingRepository');

function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}

function createCustomerFinancialReportingRouter(options = {}) {
  const router = express.Router();
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner','admin');
  const read = options.read || repository.read;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-reporting-invoice-receivables:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req,res,next) => {
    res.set('Cache-Control','private, no-store');
    res.set('Referrer-Policy','no-referrer');
    res.set('X-Content-Type-Options','nosniff');
    res.vary('Cookie');
    next();
  });
  router.all('/invoice-receivables',(req,res,next) => {
    if (req.method === 'GET') return next();
    return res.status(405).json({ success:false, error:{
      category:'CUSTOMER_FINANCIAL_REPORTING_METHOD_NOT_ALLOWED',
      message:'Use the exact invoice and receivable reporting read boundary.',
    } });
  });
  router.get('/invoice-receivables',auth,role,throttle,async (req,res) => {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ success:false,
      error:{ category:'CUSTOMER_FINANCIAL_REPORTING_INVALID',
        message:'Review the exact current invoice and receivable facts.' } });
    try { return res.json({ success:true,data:await read(source(req)) }); }
    catch (error) {
      return res.status(error?.status || 503).json({ success:false,error:{
        category:error?.code || 'CUSTOMER_FINANCIAL_REPORTING_UNAVAILABLE',
        message:error?.message || 'Invoice and receivable reporting is unavailable.',
      } });
    }
  });
  return router;
}

module.exports = { createCustomerFinancialReportingRouter };
