'use strict';

const part12Repository = require('./reportingPart12AcceptanceRepository');
const contract = require('./paidTenantJourneyAcceptance');

function changed(cause) {
  const error = Object.assign(new Error(
    'The exact paid provider-disabled journey changed. Reload its current evidence.'), {
    code: 'CUSTOMER_FINANCIAL_PAID_JOURNEY_CHANGED', status: 409,
  });
  if (cause) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart12 = options.readPart12 || part12Repository.readBundle;
  try {
    // Part 12's repository already obtains and compares exact before/after
    // snapshots of every Parts 11/12 source. Projection is synchronous after
    // that accepted atomic bundle, so no second asynchronous gap is created.
    return contract.candidate(await readPart12(
      pool, source, estimateId, receiptId, receiptDigest));
  } catch (error) {
    if (error?.code === 'CUSTOMER_FINANCIAL_PAID_JOURNEY_CHANGED') throw error;
    // Keep upstream authorization, record-scope, and source-availability
    // failures exact. Converting them to currentness conflicts would blur the
    // tenant boundary and make absent records look like stale journey data.
    if ([403, 404, 503].includes(error?.status)) throw error;
    throw changed(error);
  }
}

module.exports = { read };
