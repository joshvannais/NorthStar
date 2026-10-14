'use strict';

const contract = require('./invoicePart5Acceptance');
const correctionContract = require('./invoicePostIssueCorrection');
const correctionRepository = require('./invoicePostIssueCorrectionRepository');
const previewContract = require('./invoiceDraftPreview');
const previewRepository = require('./invoiceDraftPreviewRepository');

async function read(pool, source, estimateId, receiptId, receiptDigest) {
  const correction = await correctionRepository.read(
    pool, source, estimateId, receiptId, receiptDigest);
  try {
    correctionContract.project(correction);
  } catch (_error) {
    throw Object.assign(new Error('Invoice Part 5 acceptance is unavailable.'), {
      code: 'CUSTOMER_FINANCIAL_INVOICE_PART5_UNAVAILABLE', status: 503,
    });
  }
  // Re-read the exact current private preview after the complete Part 5A-D
  // chain. Its minimized immutable witness is returned with the value-free
  // acceptance result so a separately loaded preview can never be paired with
  // a newer draft or tax preparation.
  const preview = previewContract.project(await previewRepository.read(
    pool, source, estimateId, receiptId, receiptDigest));
  // The Part 5D read recursively revalidates the exact current Part 4 preview,
  // then the released 5A, 5B and 5C boundaries. Part 5E renders that complete
  // result without creating an approval, issue, lifecycle or correction effect.
  return contract.unavailable('paid', preview);
}

async function readBundle(pool, source, estimateId, receiptId, receiptDigest) {
  // Both projections are built inside one server operation. Read the private
  // preview before and after the complete Part 5 chain; a concurrent source,
  // draft, or tax transition can never produce a mixed browser payload.
  const before = previewContract.project(await previewRepository.read(
    pool, source, estimateId, receiptId, receiptDigest));
  const acceptance = await read(pool, source, estimateId, receiptId, receiptDigest);
  try { return contract.bundle(before, acceptance); }
  catch (_error) {
    throw Object.assign(new Error('The exact invoice draft changed. Reload its current evidence.'), {
      code:'CUSTOMER_FINANCIAL_INVOICE_PART5_CHANGED', status:409,
    });
  }
}

module.exports = { read, readBundle };
