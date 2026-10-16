'use strict';

const express = require('express');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/invoiceReceivableReportingRepository');

const READ_PATHS = new Set([
  '/api/v1/customer-financial/reporting/invoice-receivables',
  '/api/v1/customer-financial/reporting/invoice-receivables/',
]);

function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}

function hasRequestBody(req) {
  const headers = req.headers || {};
  const transferEncoding = headers['transfer-encoding'];
  if (transferEncoding !== undefined && String(transferEncoding).trim() !== '') return true;
  const contentLength = headers['content-length'];
  if (contentLength !== undefined) {
    const normalized = String(contentLength).trim();
    if (!/^\d+$/.test(normalized) || Number(normalized) > 0) return true;
  }
  if (typeof req.rawBody === 'string' && req.rawBody.length !== 0) return true;
  if (Buffer.isBuffer(req.body)) return req.body.length !== 0;
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body.length !== 0;
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) &&
        Object.keys(req.body).length === 0) return false;
    return true;
  }
  return false;
}

function hasFramedRequestBody(req) {
  const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  let contentLengthCount = 0;
  for (let index=0;index<rawHeaders.length;index+=2) {
    if (String(rawHeaders[index]).toLowerCase() === 'content-length') contentLengthCount += 1;
  }
  if (contentLengthCount > 1) return true;
  const headers = req.headers || {};
  const transferEncoding = headers['transfer-encoding'];
  if (transferEncoding !== undefined && String(transferEncoding).trim() !== '') return true;
  const contentLength = headers['content-length'];
  if (contentLength === undefined) return false;
  const normalized = String(contentLength).trim();
  return !/^0+$/.test(normalized);
}

function setPrivateReadHeaders(res) {
  res.set('Cache-Control','private, no-store');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Content-Type-Options','nosniff');
  res.vary('Cookie');
}

function rejectCustomerFinancialReportingReadBody(req,res,next) {
  if (req.method !== 'GET' || !READ_PATHS.has(req.path) || !hasFramedRequestBody(req)) {
    return next();
  }
  setPrivateReadHeaders(res);
  return res.status(400).json({ success:false,error:{
    category:'CUSTOMER_FINANCIAL_REPORTING_INVALID',
    message:'Review the exact current invoice and receivable facts.',
  } });
}

function requireExactReadInput(req,res,next) {
  if (Object.keys(req.query).length === 0 && !hasRequestBody(req)) return next();
  return res.status(400).json({ success:false,error:{
    category:'CUSTOMER_FINANCIAL_REPORTING_INVALID',
    message:'Review the exact current invoice and receivable facts.',
  } });
}

function createCustomerFinancialReportingRouter(options = {}) {
  const router = express.Router();
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner','admin');
  const read = options.read || repository.read;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `m27-reporting-invoice-receivables:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req,res,next) => {
    setPrivateReadHeaders(res);
    next();
  });
  router.all('/invoice-receivables',(req,res,next) => {
    if (req.method === 'GET') return next();
    return res.status(405).json({ success:false, error:{
      category:'CUSTOMER_FINANCIAL_REPORTING_METHOD_NOT_ALLOWED',
      message:'Use the exact invoice and receivable reporting read boundary.',
    } });
  });
  router.get('/invoice-receivables',auth,role,requireExactReadInput,throttle,async (req,res) => {
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

module.exports = { createCustomerFinancialReportingRouter, hasRequestBody,
  hasFramedRequestBody, rejectCustomerFinancialReportingReadBody, requireExactReadInput };
