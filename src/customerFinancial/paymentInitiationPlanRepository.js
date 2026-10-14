'use strict';

const publicSessionContract = require('./invoicePublicSession');
const publicSessionRepository = require('./invoicePublicSessionRepository');
const connectionContract = require('./paymentProviderConnection');
const planContract = require('./paymentInitiationPlan');

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  const publicSession = await publicSessionRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    publicSessionContract.project(publicSession, 'paid');
  } catch (_error) {
    throw Object.assign(new Error('The payment-initiation plan is unavailable.'), {
      code: 'CUSTOMER_FINANCIAL_PAYMENT_INITIATION_UNAVAILABLE', status: 503,
    });
  }
  // Part 7B has no tenant provider-account identity or credential authority.
  // Bind its exact released value-free witness without calling a provider or
  // accepting caller-authored account, mode, amount, allocation, or URL data.
  const connection = connectionContract.project(connectionContract.unavailable());
  return planContract.unavailable(publicSession, connection);
}

module.exports = { read };
