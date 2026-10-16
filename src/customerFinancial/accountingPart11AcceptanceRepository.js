'use strict';

const part10Contract = require('./collectionPart10Acceptance');
const part10Repository = require('./collectionPart10AcceptanceRepository');
const contract = require('./accountingPart11Acceptance');

function changed() {
  return Object.assign(new Error(
    'The exact Part 11 accounting boundary changed. Reload its current evidence.'), {
    code:'CUSTOMER_FINANCIAL_ACCOUNTING_PART11_CHANGED', status:409,
  });
}

async function readBundle(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart10 = options.readPart10 || part10Repository.readBundle;
  const before = part10Contract.projectBundle(await readPart10(
    pool,source,estimateId,receiptId,receiptDigest),'paid');
  const sources = contract.derive(before,'paid');
  const after = part10Contract.projectBundle(await readPart10(
    pool,source,estimateId,receiptId,receiptDigest),'paid');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  try {
    const acceptance = contract.unavailable('paid',after,sources);
    return contract.bundle(after,acceptance,sources);
  } catch (_error) { throw changed(); }
}

module.exports = { readBundle };
