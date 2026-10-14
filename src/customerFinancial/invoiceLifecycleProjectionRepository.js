'use strict';

const contract = require('./invoiceLifecycleProjection');
const issueReadinessContract = require('./invoiceIssueReadiness');
const issueReadinessRepository = require('./invoiceIssueReadinessRepository');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function restricted(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function refs(estimateId, receiptId, receiptDigest) {
  if (!UUID.test(estimateId || '') || !UUID.test(receiptId || '') ||
      !DIGEST.test(receiptDigest || '')) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_LIFECYCLE_INVALID', 400,
      'Select one exact current invoice draft.');
  }
}

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  refs(estimateId, receiptId, receiptDigest);
  const issueReadiness = await issueReadinessRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    issueReadinessContract.project(issueReadiness);
  } catch (_error) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_LIFECYCLE_UNAVAILABLE', 503,
      'Invoice lifecycle authority is unavailable.');
  }
  // Part 5B has no immutable issue receipt. Preserve every lifecycle axis as
  // a named value-free projection and do not infer an invoice, balance, date,
  // dispute, settlement, accounting handoff or action authority.
  return contract.unavailable();
}

module.exports = { read, refs };
