'use strict';

const contract = require('./invoiceIssueReadiness');
const finalReviewContract = require('./invoiceFinalReview');
const finalReviewRepository = require('./invoiceFinalReviewRepository');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function restricted(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function refs(estimateId, receiptId, receiptDigest) {
  if (!UUID.test(estimateId || '') || !UUID.test(receiptId || '') ||
      !DIGEST.test(receiptDigest || '')) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_ISSUE_INVALID', 400,
      'Select one exact current invoice draft.');
  }
}

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  refs(estimateId, receiptId, receiptDigest);
  const finalReview = await finalReviewRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    finalReviewContract.project(finalReview);
  } catch (_error) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_ISSUE_UNAVAILABLE', 503,
      'Invoice issue authority is unavailable.');
  }
  // Part 5A has no approved final invoice. Do not call the private Part 2C
  // reservation primitive, consume a number, create a receipt, or retain a
  // caller-supplied retry key for an effect that is not authorized.
  return contract.unavailable();
}

module.exports = { read, refs };
