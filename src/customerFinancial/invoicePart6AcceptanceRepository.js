'use strict';

const part5Contract = require('./invoicePart5Acceptance');
const part5Repository = require('./invoicePart5AcceptanceRepository');
const portalContract = require('./invoiceCustomerPortal');
const portalRepository = require('./invoiceCustomerPortalRepository');
const contract = require('./invoicePart6Acceptance');

async function readBundle(pool, source, estimateId, receiptId, receiptDigest) {
  const before = part5Contract.projectBundle(await part5Repository.readBundle(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  const portal = await portalRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try { portalContract.project(portal, 'paid'); }
  catch (_error) {
    throw Object.assign(new Error('Invoice Part 6 acceptance is unavailable.'), {
      code: 'CUSTOMER_FINANCIAL_INVOICE_PART6_UNAVAILABLE', status: 503,
    });
  }
  const after = part5Contract.projectBundle(await part5Repository.readBundle(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw Object.assign(new Error('The exact invoice journey changed. Reload its current evidence.'), {
      code: 'CUSTOMER_FINANCIAL_INVOICE_PART6_CHANGED', status: 409,
    });
  }
  return contract.bundle(after,
    contract.unavailable('paid', after.acceptance.previewWitness));
}

module.exports = { readBundle };
