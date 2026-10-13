'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { rateLimit } = require('../middleware/rateLimit');
const repository = require('../customerFinancial/editableEstimateBasisRepository');
const workContextRepository = require('../customerFinancial/billableWorkContextRepository');
const billableReviewRepository = require('../customerFinancial/billableWorkReviewRepository');
const quoteJourneyRepository = require('../customerFinancial/polarisQuoteJourneyRepository');
const invoiceDraftRepository = require('../customerFinancial/invoiceDraftOriginRepository');
const invoiceDraftRevisionRepository = require('../customerFinancial/invoiceDraftRevisionRepository');

function source(req) {
  return { organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId, actorAccessRole: req.userRole,
    authSessionId: req.authSession.id };
}
function failure(res, error) {
  const busy = ['55P03','57014'].includes(error?.code);
  const conflict = ['40001','23505'].includes(error?.code);
  const status = error?.status || (error?.code === '42501' ? 403 :
    ['22023','22P02'].includes(error?.code) ? 400 : conflict ? 409 : busy ? 503 : 503);
  if (busy) res.set('Retry-After','2');
  const category = error?.status ? error.code : status === 403 ?
      'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_RESTRICTED' : status === 400 ?
      'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_INVALID' : status === 409 ?
        'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_CONFLICT' : busy ?
        'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_BUSY' :
        'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_UNAVAILABLE';
  const message = error?.status ? error.message : status === 403 ?
    'Editable estimate access requires a current role and action-specific capability.' :
    status === 400 ? 'Select one exact current estimate.' : status === 409 ?
      'The editable estimate source changed. Reload the current draft.' : busy ?
      'The editable estimate source is busy. Retry shortly.' :
      'The editable estimate source is temporarily unavailable.';
  return res.status(status).json({ success: false, error: { category, message } });
}
function createCustomerFinancialEditableEstimateRouter(options = {}) {
  const router = express.Router(); const poolProvider = options.poolProvider || (() => db.getPool());
  const basisRead = options.basisRead || repository.read;
  const workContextRead = options.workContextRead || workContextRepository.read;
  const billableRead = options.billableRead || billableReviewRepository.read;
  const billableAccept = options.billableAccept || billableReviewRepository.accept;
  const quoteRead = options.quoteRead || quoteJourneyRepository.read;
  const quoteSave = options.quoteSave || quoteJourneyRepository.save;
  const quoteHandoff = options.quoteHandoff || quoteJourneyRepository.requestHandoff;
  const invoiceDraftRead = options.invoiceDraftRead || invoiceDraftRepository.read;
  const invoiceDraftCapture = options.invoiceDraftCapture || invoiceDraftRepository.capture;
  const invoiceDraftRevisionRead = options.invoiceDraftRevisionRead || invoiceDraftRevisionRepository.read;
  const invoiceDraftRevisionSave = options.invoiceDraftRevisionSave || invoiceDraftRevisionRepository.save;
  const auth = options.auth || requireOnboardedInternal;
  const role = options.role || requireRole('owner','admin');
  const quoteRole = options.quoteRole || requireRole('owner','admin','member');
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
  router.get('/:estimateId/billable-work-review', auth, role, throttle, async (req,res) => {
    if (Object.keys(req.query).length !== 1 || typeof req.query.sourceClass !== 'string') {
      return failure(res, { status: 400, code: 'CUSTOMER_FINANCIAL_BILLABLE_REVIEW_INVALID',
        message: 'Choose one explicit billable-work source.' });
    }
    try { return res.json({ success: true,
      data: await billableRead(poolProvider(), source(req), req.params.estimateId,
        req.query.sourceClass) });
    } catch (error) { return failure(res,error); }
  });
  router.post('/:estimateId/billable-work-review', auth, role, throttle, async (req,res) => {
    const csrfToken = req.get('X-CSRF-Token');
    if (typeof csrfToken !== 'string' || csrfToken.length < 16) return failure(res, {
      status: 403, code: 'CUSTOMER_FINANCIAL_BILLABLE_REVIEW_RESTRICTED',
      message: 'A current request confirmation is required for this review.',
    });
    if (Object.keys(req.query).length || !req.body || typeof req.body !== 'object' ||
        Array.isArray(req.body)) return failure(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_BILLABLE_REVIEW_INVALID',
      message: 'Review one exact billable-work source.' });
    try {
      const requestSource = { ...source(req), csrfToken,
        idempotencyKey: req.get('Idempotency-Key') };
      const result = await billableAccept(poolProvider(), requestSource,
        req.params.estimateId, req.body);
      return res.status(result.replayed === true ? 200 : result.status).json({ success: true, data: result.body,
        replayed: result.replayed === true });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-draft-origin', auth, role, throttle, async (req,res) => {
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID',
      message: 'Select one exact reviewed handoff.' });
    try { return res.json({ success: true, data: await invoiceDraftRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.post('/:estimateId/invoice-draft-origin', auth, role, throttle, async (req,res) => {
    const csrfToken = req.get('X-CSRF-Token');
    if (typeof csrfToken !== 'string' || csrfToken.length < 16) return failure(res, {
      status: 403, code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_RESTRICTED',
      message: 'A current request confirmation is required for this draft origin.' });
    if (Object.keys(req.query).length || !req.body || typeof req.body !== 'object' ||
        Array.isArray(req.body)) return failure(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID',
      message: 'Capture one exact reviewed handoff.' });
    try {
      const result = await invoiceDraftCapture(poolProvider(), { ...source(req), csrfToken,
        idempotencyKey: req.get('Idempotency-Key') }, req.params.estimateId, req.body);
      return res.status(result.status).json({ success: true, data: result.body,
        replayed: result.replayed });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-draft', auth, role, throttle, async (req,res) => {
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID',
      message: 'Select one exact current invoice draft.' });
    try { return res.json({ success: true, data: await invoiceDraftRevisionRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.post('/:estimateId/invoice-draft', auth, role, throttle, async (req,res) => {
    const csrfToken = req.get('X-CSRF-Token');
    if (typeof csrfToken !== 'string' || csrfToken.length < 16) return failure(res, {
      status: 403, code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_RESTRICTED',
      message: 'A current request confirmation is required for this draft revision.' });
    if (Object.keys(req.query).length || !req.body || typeof req.body !== 'object' ||
        Array.isArray(req.body)) return failure(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID',
      message: 'Revise one exact current invoice draft.' });
    try {
      const result = await invoiceDraftRevisionSave(poolProvider(), { ...source(req), csrfToken,
        idempotencyKey: req.get('Idempotency-Key') }, req.params.estimateId, req.body);
      return res.status(result.status).json({ success: true, data: result.body,
        replayed: result.replayed });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/quote-journey', auth, quoteRole, throttle, async (req,res) => {
    const keys = Object.keys(req.query);
    if (keys.some(key => !['historyLimit','historyBefore'].includes(key)) ||
        typeof req.query.historyLimit === 'object' || typeof req.query.historyBefore === 'object') {
      return failure(res, { status: 400, code: 'CUSTOMER_FINANCIAL_QUOTE_JOURNEY_INVALID',
        message: 'Choose one bounded revision-history page.' });
    }
    try { return res.json({ success: true,
      data: await quoteRead(poolProvider(), source(req), req.params.estimateId, {
        limit: req.query.historyLimit === undefined ? 20 : req.query.historyLimit,
        beforeRevision: req.query.historyBefore === undefined ? null : req.query.historyBefore,
      }) });
    } catch (error) { return failure(res,error); }
  });
  function mutationSource(req) {
    const csrfToken = req.get('X-CSRF-Token');
    if (typeof csrfToken !== 'string' || csrfToken.length < 16) throw {
      status: 403, code: 'CUSTOMER_FINANCIAL_QUOTE_JOURNEY_RESTRICTED',
      message: 'A current request confirmation is required for this quote action.',
    };
    return { ...source(req), csrfToken, idempotencyKey: req.get('Idempotency-Key') };
  }
  router.post('/:estimateId/quote-journey/draft', auth, quoteRole, throttle, async (req,res) => {
    if (Object.keys(req.query).length || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return failure(res, { status: 400, code: 'CUSTOMER_FINANCIAL_QUOTE_JOURNEY_INVALID',
        message: 'Review one exact quote draft.' });
    }
    try {
      const data = await quoteSave(poolProvider(), mutationSource(req), req.params.estimateId, req.body);
      return res.status(data.replayed === true ? 200 : 201).json({ success: true, data });
    } catch (error) { return failure(res,error); }
  });
  router.post('/:estimateId/quote-journey/work-handoff', auth, role, throttle, async (req,res) => {
    try {
      const data = await quoteHandoff(poolProvider(), mutationSource(req), req.params.estimateId, req.body);
      return res.status(409).json({ success: false, error: { category: data.reason,
        message: 'The reviewed Mission 23 work-intake receiver is unavailable.' }, data });
    } catch (error) { return failure(res,error); }
  });
  return router;
}

module.exports = { createCustomerFinancialEditableEstimateRouter, failure, source };
