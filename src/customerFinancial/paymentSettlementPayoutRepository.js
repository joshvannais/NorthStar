'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const allocationBalance = require('./paymentAllocationBalance');
const allocationBalanceRepository = require('./paymentAllocationBalanceRepository');
const contract = require('./paymentSettlementPayout');

function unavailableError() {
  return Object.assign(new Error('Settlement and payout reconciliation is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_SETTLEMENT_PAYOUT_UNAVAILABLE', status: 503,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readAllocationBalance = options.readAllocationBalance || allocationBalanceRepository.read;
  const readProviderBoundary = options.readProviderBoundary ||
    (async () => providerBoundary.unavailable());
  const allocation = await readAllocationBalance(
    pool, source, estimateId, receiptId, receiptDigest);
  const provider = await readProviderBoundary(source);
  try {
    allocationBalance.project(allocation);
    providerBoundary.project(provider);
    return contract.unavailable(allocation, provider);
  } catch (_error) {
    throw unavailableError();
  }
}

module.exports = { read };
