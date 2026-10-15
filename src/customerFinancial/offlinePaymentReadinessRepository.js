'use strict';

const creditRefund = require('./creditRefundReadiness');
const creditRefundRepository = require('./creditRefundReadinessRepository');
const contract = require('./offlinePaymentReadiness');

function unavailableError() {
  return Object.assign(new Error('Offline-payment intake readiness is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_OFFLINE_PAYMENT_UNAVAILABLE', status: 503,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readCreditRefund = options.readCreditRefund || creditRefundRepository.read;
  const sourceWitness = await readCreditRefund(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    creditRefund.project(sourceWitness);
    return contract.unavailable(sourceWitness);
  } catch (_error) { throw unavailableError(); }
}

module.exports = { read };
