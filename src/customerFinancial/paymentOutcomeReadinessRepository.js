'use strict';

const offlinePayment = require('./offlinePaymentReadiness');
const offlinePaymentRepository = require('./offlinePaymentReadinessRepository');
const contract = require('./paymentOutcomeReadiness');

function unavailableError() {
  return Object.assign(new Error('Payment-outcome readiness is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_PAYMENT_OUTCOME_UNAVAILABLE', status: 503,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readOfflinePayment = options.readOfflinePayment || offlinePaymentRepository.read;
  const sourceWitness = await readOfflinePayment(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    offlinePayment.project(sourceWitness);
    return contract.unavailable(sourceWitness);
  } catch (_error) { throw unavailableError(); }
}

module.exports = { read };
