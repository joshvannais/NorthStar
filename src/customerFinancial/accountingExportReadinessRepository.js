'use strict';

const part10Contract = require('./collectionPart10Acceptance');
const part10Repository = require('./collectionPart10AcceptanceRepository');
const exportContract = require('./accountingExportContract');
const readiness = require('./accountingExportReadiness');

function changed() {
  return Object.assign(new Error('The exact accounting export source changed. Reload its current evidence.'), {
    code: 'CUSTOMER_FINANCIAL_ACCOUNTING_EXPORT_READINESS_SOURCE_CHANGED', status: 409,
  });
}

async function read(pool, source, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart10 = options.readPart10 || part10Repository.readBundle;
  const beforePart10 = part10Contract.projectBundle(await readPart10(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  const before = exportContract.project(exportContract.unavailable(beforePart10), beforePart10);
  const value = readiness.unavailable(before, beforePart10);
  const afterPart10 = part10Contract.projectBundle(await readPart10(
    pool, source, estimateId, receiptId, receiptDigest), 'paid');
  const after = exportContract.project(exportContract.unavailable(afterPart10), afterPart10);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  try { return readiness.project(value, after, afterPart10); }
  catch (_error) { throw changed(); }
}

module.exports = { read };
