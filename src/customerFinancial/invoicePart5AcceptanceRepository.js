'use strict';

const contract = require('./invoicePart5Acceptance');
const correctionContract = require('./invoicePostIssueCorrection');
const correctionRepository = require('./invoicePostIssueCorrectionRepository');

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
  // The Part 5D read recursively revalidates the exact current Part 4 preview,
  // then the released 5A, 5B and 5C boundaries. Part 5E renders that complete
  // result without creating an approval, issue, lifecycle or correction effect.
  return contract.unavailable('paid');
}

module.exports = { read };
