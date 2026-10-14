'use strict';

const documentContract = require('./invoiceDocument');
const part5Contract = require('./invoicePart5Acceptance');
const part5Repository = require('./invoicePart5AcceptanceRepository');

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  const bundle = await part5Repository.readBundle(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    part5Contract.projectBundle(bundle, 'paid');
  } catch (_error) {
    throw Object.assign(new Error('The customer-safe invoice document is unavailable.'), {
      code: 'CUSTOMER_FINANCIAL_INVOICE_DOCUMENT_UNAVAILABLE', status: 503,
    });
  }
  // Part 5 has no immutable issue receipt or issued invoice. Revalidate the
  // complete exact-current chain above, then discard its private preview and
  // witness before returning this minimized, value-free Part 6A boundary.
  return documentContract.project(documentContract.unavailable('paid'), 'paid');
}

module.exports = { read };
