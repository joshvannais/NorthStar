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
const invoiceDraftComponentsRepository = require('../customerFinancial/invoiceDraftComponentsRepository');
const invoiceTaxReviewRepository = require('../customerFinancial/invoiceTaxReviewRepository');
const invoiceDraftPreviewRepository = require('../customerFinancial/invoiceDraftPreviewRepository');
const invoiceFinalReviewRepository = require('../customerFinancial/invoiceFinalReviewRepository');
const invoiceIssueReadinessRepository = require('../customerFinancial/invoiceIssueReadinessRepository');
const invoiceLifecycleProjectionRepository =
  require('../customerFinancial/invoiceLifecycleProjectionRepository');
const invoicePostIssueCorrectionRepository =
  require('../customerFinancial/invoicePostIssueCorrectionRepository');
const invoicePart5AcceptanceRepository =
  require('../customerFinancial/invoicePart5AcceptanceRepository');
const invoiceDocumentRepository = require('../customerFinancial/invoiceDocumentRepository');
const invoicePublicSessionRepository =
  require('../customerFinancial/invoicePublicSessionRepository');
const invoiceCustomerPortalRepository =
  require('../customerFinancial/invoiceCustomerPortalRepository');
const invoicePart6AcceptanceRepository =
  require('../customerFinancial/invoicePart6AcceptanceRepository');
const paymentInitiationPlanRepository =
  require('../customerFinancial/paymentInitiationPlanRepository');
const paymentPart7AcceptanceRepository =
  require('../customerFinancial/paymentPart7AcceptanceRepository');
const paymentAllocationBalanceRepository =
  require('../customerFinancial/paymentAllocationBalanceRepository');
const paymentSettlementPayoutRepository =
  require('../customerFinancial/paymentSettlementPayoutRepository');
const paymentAttemptAllocationOverpaymentRepository =
  require('../customerFinancial/paymentAttemptAllocationOverpaymentRepository');

const PART8D_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PART8D_DIGEST = /^[0-9a-f]{64}$/i;

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
  const invoiceDraftComponentsRead = options.invoiceDraftComponentsRead || invoiceDraftComponentsRepository.read;
  const invoiceTaxReviewRead = options.invoiceTaxReviewRead || invoiceTaxReviewRepository.read;
  const invoiceTaxReviewRecord = options.invoiceTaxReviewRecord || invoiceTaxReviewRepository.record;
  const invoiceDraftPreviewRead = options.invoiceDraftPreviewRead || invoiceDraftPreviewRepository.read;
  const invoiceDraftWorkflowCapability = options.invoiceDraftWorkflowCapability ||
    invoiceDraftPreviewRepository.ensureWorkflowCapability;
  const invoiceFinalReviewRead = options.invoiceFinalReviewRead || invoiceFinalReviewRepository.read;
  const invoiceIssueReadinessRead = options.invoiceIssueReadinessRead ||
    invoiceIssueReadinessRepository.read;
  const invoiceLifecycleProjectionRead = options.invoiceLifecycleProjectionRead ||
    invoiceLifecycleProjectionRepository.read;
  const invoicePostIssueCorrectionRead = options.invoicePostIssueCorrectionRead ||
    invoicePostIssueCorrectionRepository.read;
  const invoicePart5AcceptanceRead = options.invoicePart5AcceptanceRead ||
    invoicePart5AcceptanceRepository.readBundle;
  const invoiceDocumentRead = options.invoiceDocumentRead || invoiceDocumentRepository.read;
  const invoicePublicSessionRead = options.invoicePublicSessionRead ||
    invoicePublicSessionRepository.read;
  const invoiceCustomerPortalRead = options.invoiceCustomerPortalRead ||
    invoiceCustomerPortalRepository.read;
  const invoicePart6AcceptanceRead = options.invoicePart6AcceptanceRead ||
    invoicePart6AcceptanceRepository.readBundle;
  const paymentInitiationPlanRead = options.paymentInitiationPlanRead ||
    paymentInitiationPlanRepository.read;
  const paymentPart7AcceptanceRead = options.paymentPart7AcceptanceRead ||
    paymentPart7AcceptanceRepository.readBundle;
  const paymentAllocationBalanceRead = options.paymentAllocationBalanceRead ||
    paymentAllocationBalanceRepository.read;
  const paymentSettlementPayoutRead = options.paymentSettlementPayoutRead ||
    paymentSettlementPayoutRepository.read;
  const paymentAttemptAllocationOverpaymentRead =
    options.paymentAttemptAllocationOverpaymentRead ||
    paymentAttemptAllocationOverpaymentRepository.read;
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
  router.get('/:estimateId/invoice-draft/components', auth, role, throttle, async (req,res) => {
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_COMPONENTS_INVALID',
      message: 'Select one exact current invoice draft.' });
    try { return res.json({ success: true, data: await invoiceDraftComponentsRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-draft/tax-review', auth, role, throttle, async (req,res) => {
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_TAX_REVIEW_INVALID',
      message: 'Select one exact current invoice draft.' });
    try { return res.json({ success: true, data: await invoiceTaxReviewRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-draft/preview', auth, role, throttle, async (req,res) => {
    res.set('Cache-Control','no-store'); res.vary('Cookie');
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_PREVIEW_INVALID',
      message: 'Select one exact current invoice draft.' });
    try { return res.json({ success: true, data: await invoiceDraftPreviewRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-final-review', auth, role, throttle, async (req,res) => {
    res.set('Cache-Control','no-store'); res.vary('Cookie');
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_FINAL_REVIEW_INVALID',
      message: 'Select one exact current invoice draft.' });
    try { return res.json({ success: true, data: await invoiceFinalReviewRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-issue-readiness', auth, role, throttle, async (req,res) => {
    res.set('Cache-Control','no-store'); res.vary('Cookie');
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_ISSUE_INVALID',
      message: 'Select one exact current invoice draft.' });
    try { return res.json({ success: true, data: await invoiceIssueReadinessRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-lifecycle', auth, role, throttle, async (req,res) => {
    res.set('Cache-Control','no-store'); res.vary('Cookie');
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_LIFECYCLE_INVALID',
      message: 'Select one exact current invoice draft.' });
    try { return res.json({ success: true, data: await invoiceLifecycleProjectionRead(poolProvider(),
      source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-post-issue-correction', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_CORRECTION_INVALID',
        message: 'Select one exact current issued invoice.' });
      try { return res.json({ success: true, data: await invoicePostIssueCorrectionRead(
        poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
        req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.get('/:estimateId/invoice-part5-acceptance', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_PART5_INVALID',
        message: 'Select one exact current invoice journey.' });
      try { return res.json({ success: true, data: await invoicePart5AcceptanceRead(
        poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
        req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.get('/:estimateId/invoice-document', auth, role, throttle, async (req,res) => {
    res.set('Cache-Control','no-store'); res.vary('Cookie');
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_DOCUMENT_INVALID',
      message: 'Select one exact current issued invoice document.' });
    try { return res.json({ success: true, data: await invoiceDocumentRead(
      poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-public-session', auth, role, throttle, async (req,res) => {
    res.set('Cache-Control','private, no-store'); res.vary('Cookie');
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_PUBLIC_SESSION_INVALID',
      message: 'Select one exact current issued invoice document.' });
    try { return res.json({ success: true, data: await invoicePublicSessionRead(
      poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-customer-portal', auth, role, throttle, async (req,res) => {
    res.set('Cache-Control','private, no-store'); res.vary('Cookie');
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
        !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
        typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_CUSTOMER_PORTAL_INVALID',
      message: 'Select one exact current invoice customer session.' });
    try { return res.json({ success: true, data: await invoiceCustomerPortalRead(
      poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
      req.query.handoffReceiptDigest) });
    } catch (error) { return failure(res,error); }
  });
  router.get('/:estimateId/invoice-part6-acceptance', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','private, no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_PART6_INVALID',
        message: 'Select one exact current invoice delivery journey.' });
      try { return res.json({ success: true, data: await invoicePart6AcceptanceRead(
        poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
        req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.get('/:estimateId/payment-initiation-plan', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','private, no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_PAYMENT_INITIATION_INVALID',
        message: 'Select one exact current issued invoice balance.' });
      try { return res.json({ success: true, data: await paymentInitiationPlanRead(
        poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
        req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.get('/:estimateId/payment-part7-acceptance', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','private, no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_PAYMENT_PART7_INVALID',
        message: 'Select one exact current payment-provider journey.' });
      try { return res.json({ success: true, data: await paymentPart7AcceptanceRead(
        poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
        req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.get('/:estimateId/payment-allocation-balance', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','private, no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string') return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_PAYMENT_ALLOCATION_INVALID',
        message: 'Select one exact current issued invoice and accepted payment.' });
      try { return res.json({ success: true, data: await paymentAllocationBalanceRead(
        poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
        req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.get('/:estimateId/settlement-payout-reconciliation', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','private, no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string' ||
          !PART8D_UUID.test(req.query.handoffReceiptId) ||
          !PART8D_DIGEST.test(req.query.handoffReceiptDigest)) return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_SETTLEMENT_PAYOUT_INVALID',
        message: 'Select one exact current captured payment and provider reconciliation.' });
      try { return res.json({ success: true, data: await paymentSettlementPayoutRead(
        poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
        req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.get('/:estimateId/payment-attempt-allocation-overpayment', auth, role, throttle,
    async (req,res) => {
      res.set('Cache-Control','private, no-store'); res.vary('Cookie');
      const keys = Object.keys(req.query);
      if (keys.length !== 2 || !keys.includes('handoffReceiptId') ||
          !keys.includes('handoffReceiptDigest') || typeof req.query.handoffReceiptId !== 'string' ||
          typeof req.query.handoffReceiptDigest !== 'string' ||
          !PART8D_UUID.test(req.query.handoffReceiptId) ||
          !PART8D_DIGEST.test(req.query.handoffReceiptDigest)) return failure(res, {
        status: 400, code: 'CUSTOMER_FINANCIAL_PAYMENT_ATTEMPT_ALLOCATION_INVALID',
        message: 'Select one exact current initiated payment and reconciliation boundary.' });
      try { return res.json({ success: true,
        data: await paymentAttemptAllocationOverpaymentRead(
          poolProvider(), source(req), req.params.estimateId, req.query.handoffReceiptId,
          req.query.handoffReceiptDigest) });
      } catch (error) { return failure(res,error); }
    });
  router.post('/:estimateId/invoice-draft/workflow-capability', auth, role, throttle, async (req,res) => {
    const csrfToken = req.get('X-CSRF-Token');
    if (typeof csrfToken !== 'string' || csrfToken.length < 16) return failure(res, {
      status: 403, code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_RESTRICTED',
      message: 'A current request confirmation is required for this invoice-draft workflow.' });
    if (Object.keys(req.query).length || !req.body || typeof req.body !== 'object' ||
        Array.isArray(req.body) || Object.keys(req.body).length !== 2 || req.body.confirmed !== true ||
        req.body.confirmationVersion !== 'm27-invoice-draft-workflow-capability-v1') return failure(res, {
      status: 400, code: 'CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID',
      message: 'Confirm the exact current invoice-draft workflow.' });
    try { return res.json({ success: true, data: await invoiceDraftWorkflowCapability(poolProvider(),
      { ...source(req), csrfToken, idempotencyKey: req.get('Idempotency-Key') }, req.params.estimateId) });
    } catch (error) { return failure(res,error); }
  });
  router.post('/:estimateId/invoice-draft/tax-review', auth, role, throttle, async (req,res) => {
    const csrfToken = req.get('X-CSRF-Token');
    if (typeof csrfToken !== 'string' || csrfToken.length < 16) return failure(res, {
      status: 403, code: 'CUSTOMER_FINANCIAL_INVOICE_TAX_REVIEW_RESTRICTED',
      message: 'A current request confirmation is required for this tax review.' });
    if (Object.keys(req.query).length || !req.body || typeof req.body !== 'object' ||
        Array.isArray(req.body)) return failure(res, { status: 400,
      code: 'CUSTOMER_FINANCIAL_INVOICE_TAX_REVIEW_INVALID',
      message: 'Record one exact invoice-date tax preparation.' });
    try {
      const result = await invoiceTaxReviewRecord(poolProvider(), { ...source(req), csrfToken,
        idempotencyKey: req.get('Idempotency-Key') }, req.params.estimateId, req.body);
      return res.status(result.status).json({ success: result.status !== 409, data: result.body,
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
