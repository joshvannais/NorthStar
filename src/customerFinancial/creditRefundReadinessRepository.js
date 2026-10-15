'use strict';

const correction = require('./invoicePostIssueCorrection');
const correctionRepository = require('./invoicePostIssueCorrectionRepository');
const paymentAttempt = require('./paymentAttemptAllocationOverpayment');
const paymentAttemptRepository = require('./paymentAttemptAllocationOverpaymentRepository');
const contract = require('./creditRefundReadiness');

function unavailableError() {
  return Object.assign(new Error('Credit-note and refund-request readiness is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_CREDIT_REFUND_UNAVAILABLE', status: 503,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readCorrection = options.readCorrection || correctionRepository.read;
  const readPaymentAttempt = options.readPaymentAttempt || paymentAttemptRepository.read;
  const correctionSource = await readCorrection(pool, source, estimateId, receiptId, receiptDigest);
  try { correction.project(correctionSource); }
  catch (_error) { throw unavailableError(); }
  const attemptSource = await readPaymentAttempt(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    paymentAttempt.project(attemptSource);
    return contract.unavailable(correctionSource, attemptSource);
  } catch (_error) { throw unavailableError(); }
}

module.exports = { read };
