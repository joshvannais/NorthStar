'use strict';

const initiationPlan = require('./paymentInitiationPlan');
const initiationPlanRepository = require('./paymentInitiationPlanRepository');
const settlementPayout = require('./paymentSettlementPayout');
const settlementPayoutRepository = require('./paymentSettlementPayoutRepository');
const contract = require('./paymentAttemptAllocationOverpayment');

function unavailableError() {
  return Object.assign(new Error('Payment-attempt allocation and overpayment readiness is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_PAYMENT_ATTEMPT_ALLOCATION_UNAVAILABLE', status: 503,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readInitiationPlan = options.readInitiationPlan || initiationPlanRepository.read;
  const readSettlementPayout = options.readSettlementPayout || settlementPayoutRepository.read;
  const plan = await readInitiationPlan(pool, source, estimateId, receiptId, receiptDigest);
  try {
    initiationPlan.project(plan);
  } catch (_error) {
    throw unavailableError();
  }
  const settlement = await readSettlementPayout(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    settlementPayout.project(settlement);
    return contract.unavailable(plan, settlement);
  } catch (_error) {
    throw unavailableError();
  }
}

module.exports = { read };
