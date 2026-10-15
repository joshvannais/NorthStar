'use strict';

const part7Contract = require('./paymentPart7Acceptance');
const part7Repository = require('./paymentPart7AcceptanceRepository');
const paymentAttempt = require('./paymentAttemptAllocationOverpayment');
const paymentAttemptRepository = require('./paymentAttemptAllocationOverpaymentRepository');
const paymentInitiationPlan = require('./paymentInitiationPlan');
const paymentInitiationPlanRepository = require('./paymentInitiationPlanRepository');
const settlementPayout = require('./paymentSettlementPayout');
const settlementPayoutRepository = require('./paymentSettlementPayoutRepository');
const depositApplication = require('./depositApplication');
const depositApplicationRepository = require('./depositApplicationRepository');
const invoiceDraftOrigin = require('./invoiceDraftOrigin');
const invoiceDraftOriginRepository = require('./invoiceDraftOriginRepository');
const creditRefund = require('./creditRefundReadiness');
const creditRefundRepository = require('./creditRefundReadinessRepository');
const postIssueCorrection = require('./invoicePostIssueCorrection');
const postIssueCorrectionRepository = require('./invoicePostIssueCorrectionRepository');
const offlinePayment = require('./offlinePaymentReadiness');
const offlinePaymentRepository = require('./offlinePaymentReadinessRepository');
const paymentOutcome = require('./paymentOutcomeReadiness');
const paymentOutcomeRepository = require('./paymentOutcomeReadinessRepository');
const contract = require('./paymentPart9Acceptance');

function changed() {
  return Object.assign(new Error('The exact Part 9 financial journey changed. Reload its current evidence.'), {
    code: 'CUSTOMER_FINANCIAL_PAYMENT_PART9_CHANGED', status: 409,
  });
}

async function readBundle(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart7 = options.readPart7 || part7Repository.readBundle;
  const readPaymentAttempt = options.readPaymentAttempt || paymentAttemptRepository.read;
  const readPaymentInitiationPlan = options.readPaymentInitiationPlan ||
    paymentInitiationPlanRepository.read;
  const readSettlementPayout = options.readSettlementPayout || settlementPayoutRepository.read;
  const readDepositApplication = options.readDepositApplication || depositApplicationRepository.read;
  const readInvoiceDraftOrigin = options.readInvoiceDraftOrigin || invoiceDraftOriginRepository.read;
  const readCreditRefund = options.readCreditRefund || creditRefundRepository.read;
  const readPostIssueCorrection = options.readPostIssueCorrection || postIssueCorrectionRepository.read;
  const readOfflinePayment = options.readOfflinePayment || offlinePaymentRepository.read;
  const readPaymentOutcome = options.readPaymentOutcome || paymentOutcomeRepository.read;
  const before = part7Contract.projectBundle(await readPart7(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  const upstream = {
    paymentInitiationPlan: await readPaymentInitiationPlan(
      pool, source, estimateId, receiptId, receiptDigest),
    settlementPayout: await readSettlementPayout(
      pool, source, estimateId, receiptId, receiptDigest),
    invoiceDraftOrigin: await readInvoiceDraftOrigin(
      pool, source, estimateId, receiptId, receiptDigest),
    postIssueCorrection: await readPostIssueCorrection(
      pool, source, estimateId, receiptId, receiptDigest),
  };
  const sources = {
    paymentAttempt: await readPaymentAttempt(pool, source, estimateId, receiptId, receiptDigest),
    depositApplication: await readDepositApplication(pool, source, estimateId, receiptId, receiptDigest),
    creditRefund: await readCreditRefund(pool, source, estimateId, receiptId, receiptDigest),
    offlinePayment: await readOfflinePayment(pool, source, estimateId, receiptId, receiptDigest),
    paymentOutcome: await readPaymentOutcome(pool, source, estimateId, receiptId, receiptDigest),
  };
  try {
    paymentInitiationPlan.project(upstream.paymentInitiationPlan);
    settlementPayout.project(upstream.settlementPayout);
    const origin = upstream.invoiceDraftOrigin?.state === 'unavailable' ?
      invoiceDraftOrigin.unavailable(upstream.invoiceDraftOrigin) :
      invoiceDraftOrigin.project(upstream.invoiceDraftOrigin);
    postIssueCorrection.project(upstream.postIssueCorrection);
    paymentAttempt.projectWithSources(sources.paymentAttempt,
      upstream.paymentInitiationPlan, upstream.settlementPayout);
    depositApplication.projectWithSources(sources.depositApplication,
      origin, sources.paymentAttempt);
    creditRefund.projectWithSources(sources.creditRefund,
      upstream.postIssueCorrection, sources.paymentAttempt);
    offlinePayment.projectWithSource(sources.offlinePayment, sources.creditRefund);
    paymentOutcome.projectWithSource(sources.paymentOutcome, sources.offlinePayment);
  } catch (_error) { throw changed(); }
  const after = part7Contract.projectBundle(await readPart7(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  try {
    const acceptance = contract.unavailable('paid', after, sources, upstream);
    return contract.bundle(after, acceptance, sources, upstream);
  } catch (_error) { throw changed(); }
}

module.exports = { readBundle };
