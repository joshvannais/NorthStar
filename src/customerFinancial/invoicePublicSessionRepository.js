'use strict';

const documentContract = require('./invoiceDocument');
const documentRepository = require('./invoiceDocumentRepository');
const sessionContract = require('./invoicePublicSession');

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  const document = await documentRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    documentContract.project(document, 'paid');
  } catch (_error) {
    throw Object.assign(new Error('The invoice public session is unavailable.'), {
      code: 'CUSTOMER_FINANCIAL_INVOICE_PUBLIC_SESSION_UNAVAILABLE', status: 503,
    });
  }
  // Part 6A has no issued document. Do not generate a bearer secret, persist a
  // hash or session, mount public lookup/download, assign an expiry, or write a
  // revocation record for an authority that does not exist.
  return sessionContract.project(sessionContract.unavailable('paid'), 'paid');
}

module.exports = { read };
