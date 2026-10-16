'use strict';

const part10Contract = require('./collectionPart10Acceptance');
const part10Repository = require('./collectionPart10AcceptanceRepository');
const exportContract = require('./accountingExportContract');
const exportReadiness = require('./accountingExportReadiness');
const reconciliation = require('./accountingReconciliationReadiness');

function changed() {
  return Object.assign(new Error(
    'The exact accounting reconciliation source changed. Reload its current evidence.'), {
    code:'CUSTOMER_FINANCIAL_ACCOUNTING_RECONCILIATION_SOURCE_CHANGED', status:409,
  });
}

function derive(part10Raw) {
  const part10 = part10Contract.projectBundle(part10Raw, 'paid');
  const source = exportContract.project(exportContract.unavailable(part10), part10);
  const readiness = exportReadiness.project(exportReadiness.unavailable(source, part10),
    source, part10);
  return { part10, source, readiness };
}

async function read(pool, sourceContext, estimateId, receiptId, receiptDigest, options = {}) {
  const readPart10 = options.readPart10 || part10Repository.readBundle;
  const before = derive(await readPart10(
    pool, sourceContext, estimateId, receiptId, receiptDigest));
  const value = reconciliation.unavailable(before.readiness, before.source, before.part10);
  const after = derive(await readPart10(
    pool, sourceContext, estimateId, receiptId, receiptDigest));
  if (JSON.stringify(before.readiness) !== JSON.stringify(after.readiness)) throw changed();
  try { return reconciliation.project(value, after.readiness, after.source, after.part10); }
  catch (_error) { throw changed(); }
}

module.exports = { read };
