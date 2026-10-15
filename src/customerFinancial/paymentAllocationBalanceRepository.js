'use strict';

const initiationPlan = require('./paymentInitiationPlan');
const initiationPlanRepository = require('./paymentInitiationPlanRepository');
const eventNormalization = require('./paymentProviderEventNormalization');
const eventNormalizationRepository = require('./paymentProviderEventNormalizationRepository');
const contract = require('./paymentAllocationBalance');

function unavailableError() {
  return Object.assign(new Error('The payment allocation and balance projection is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_PAYMENT_ALLOCATION_UNAVAILABLE', status: 503,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPlan = options.readPlan || initiationPlanRepository.read;
  const readNormalization = options.readNormalization || eventNormalizationRepository.read;
  const plan = await readPlan(pool, source, estimateId, receiptId, receiptDigest);
  const normalization = await readNormalization(source);
  try {
    initiationPlan.project(plan);
    eventNormalization.project(normalization);
    return contract.unavailable(plan, normalization);
  } catch (_error) {
    throw unavailableError();
  }
}

module.exports = { read };
