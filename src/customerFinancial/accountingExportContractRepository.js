'use strict';

const part10Contract = require('./collectionPart10Acceptance');
const part10Repository = require('./collectionPart10AcceptanceRepository');
const contract = require('./accountingExportContract');

function changed() {
  return Object.assign(new Error('The exact customer-financial export source changed. Reload its current evidence.'), {
    code: 'CUSTOMER_FINANCIAL_ACCOUNTING_EXPORT_SOURCE_CHANGED', status: 409,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart10 = options.readPart10 || part10Repository.readBundle;
  const before = part10Contract.projectBundle(await readPart10(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  const value = contract.unavailable(before);
  const after = part10Contract.projectBundle(await readPart10(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  try { return contract.project(value, after); }
  catch (_error) { throw changed(); }
}

module.exports = { read };
