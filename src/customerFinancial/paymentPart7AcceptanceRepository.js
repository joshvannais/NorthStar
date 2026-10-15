'use strict';

const part6Contract = require('./invoicePart6Acceptance');
const part6Repository = require('./invoicePart6AcceptanceRepository');
const providerBoundary = require('./paymentProviderBoundary');
const providerConnection = require('./paymentProviderConnection');
const initiationPlanRepository = require('./paymentInitiationPlanRepository');
const contract = require('./paymentPart7Acceptance');

async function readBundle(pool, source, estimateId, receiptId, receiptDigest) {
  const before = part6Contract.projectBundle(await part6Repository.readBundle(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  const plan = await initiationPlanRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  const after = part6Contract.projectBundle(await part6Repository.readBundle(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw Object.assign(new Error('The exact payment journey changed. Reload its current evidence.'), {
      code: 'CUSTOMER_FINANCIAL_PAYMENT_PART7_CHANGED', status: 409,
    });
  }
  const boundary = providerBoundary.project(providerBoundary.unavailable());
  const connection = providerConnection.project(providerConnection.unavailable());
  return contract.bundle(after,
    contract.unavailable('paid', after, boundary, connection, plan));
}

module.exports = { readBundle };
