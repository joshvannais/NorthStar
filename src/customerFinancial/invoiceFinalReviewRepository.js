'use strict';

const contract = require('./invoiceFinalReview');
const previewRepository = require('./invoiceDraftPreviewRepository');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function restricted(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function refs(estimateId, receiptId, receiptDigest) {
  if (!UUID.test(estimateId || '') || !UUID.test(receiptId || '') ||
      !DIGEST.test(receiptDigest || '')) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_FINAL_REVIEW_INVALID', 400,
      'Select one exact current invoice draft.');
  }
}

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  refs(estimateId, receiptId, receiptDigest);
  // The accepted Part 4E entry point revalidates current tenant, actor,
  // subscription and exact source authority in PostgreSQL. Its private result
  // is deliberately discarded: Part 1C requires session assurance to fail
  // before any customer, work, amount or digest survives this response.
  await previewRepository.read(pool, source, estimateId, receiptId, receiptDigest);
  return contract.unavailable();
}

module.exports = { read, refs };
