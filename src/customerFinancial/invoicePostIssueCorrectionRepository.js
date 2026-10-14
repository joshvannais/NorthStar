'use strict';

const contract = require('./invoicePostIssueCorrection');
const lifecycleContract = require('./invoiceLifecycleProjection');
const lifecycleRepository = require('./invoiceLifecycleProjectionRepository');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function restricted(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function refs(estimateId, receiptId, receiptDigest) {
  if (!UUID.test(estimateId || '') || !UUID.test(receiptId || '') ||
      !DIGEST.test(receiptDigest || '')) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_CORRECTION_INVALID', 400,
      'Select one exact current issued invoice.');
  }
}

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  refs(estimateId, receiptId, receiptDigest);
  const lifecycle = await lifecycleRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    lifecycleContract.project(lifecycle);
  } catch (_error) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_CORRECTION_UNAVAILABLE', 503,
      'Post-issue correction authority is unavailable.');
  }
  // Part 5B has no immutable issue receipt and Part 5C therefore has no
  // current issued document/revision. Preserve each frozen correction class as
  // a named value-free append-only boundary; never fabricate a correction or
  // mutate the draft, numbering, issue, invoice or receivable state.
  return contract.unavailable();
}

module.exports = { read, refs };
