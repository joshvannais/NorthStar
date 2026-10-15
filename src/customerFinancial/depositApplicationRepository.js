'use strict';

const invoiceDraftOrigin = require('./invoiceDraftOrigin');
const invoiceDraftOriginRepository = require('./invoiceDraftOriginRepository');
const paymentAttempt = require('./paymentAttemptAllocationOverpayment');
const paymentAttemptRepository = require('./paymentAttemptAllocationOverpaymentRepository');
const contract = require('./depositApplication');

function unavailableError() {
  return Object.assign(new Error('Deposit-application readiness is unavailable.'), {
    code: 'CUSTOMER_FINANCIAL_DEPOSIT_APPLICATION_UNAVAILABLE', status: 503,
  });
}

function validateOrigin(raw) {
  return raw?.state === 'unavailable' ? invoiceDraftOrigin.unavailable(raw) :
    invoiceDraftOrigin.project(raw);
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readOrigin = options.readInvoiceDraftOrigin || invoiceDraftOriginRepository.read;
  const readAttempt = options.readPaymentAttempt || paymentAttemptRepository.read;
  const origin = await readOrigin(pool, source, estimateId, receiptId, receiptDigest);
  try { validateOrigin(origin); contract.depositScheduleCurrent(origin); }
  catch (_error) { throw unavailableError(); }
  const attempt = await readAttempt(pool, source, estimateId, receiptId, receiptDigest);
  try {
    paymentAttempt.project(attempt);
    return contract.unavailable(origin, attempt);
  } catch (_error) { throw unavailableError(); }
}

module.exports = { read };
