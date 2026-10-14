'use strict';

const sessionContract = require('./invoicePublicSession');
const sessionRepository = require('./invoicePublicSessionRepository');
const portalContract = require('./invoiceCustomerPortal');

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  const session = await sessionRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    sessionContract.project(session, 'paid');
  } catch (_error) {
    throw Object.assign(new Error('The invoice customer portal is unavailable.'), {
      code: 'CUSTOMER_FINANCIAL_INVOICE_CUSTOMER_PORTAL_UNAVAILABLE', status: 503,
    });
  }
  // Part 6B created no scoped customer session. Do not expose a public view or
  // download and do not accept questions, correction requests or acknowledgements.
  return portalContract.project(portalContract.unavailable('paid'), 'paid');
}

module.exports = { read };
