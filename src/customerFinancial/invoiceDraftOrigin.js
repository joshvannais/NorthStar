'use strict';

const money = require('./exactMoney');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const CONTRACT_VERSION = 'm27-invoice-draft-origin-v1';
const CONFIRMATION_VERSION = 'm27-invoice-draft-origin-capture-v1';

function failure() { throw new Error('Invoice-draft origin contract invalid'); }
function project(raw) {
  if (!raw || raw.contractVersion !== CONTRACT_VERSION ||
      !['ready_to_capture','current'].includes(raw.state) ||
      (raw.state === 'current' ? !UUID.test(raw.originId || '') || !DIGEST.test(raw.originDigest || '') :
        raw.originId !== null || raw.originDigest !== null) ||
      !DIGEST.test(raw.candidateDigest || '') || !UUID.test(raw.estimateId || '') ||
      !UUID.test(raw.customerId || '') || !UUID.test(raw.handoffReceiptId || '') ||
      !DIGEST.test(raw.handoffReceiptDigest || '') || !DIGEST.test(raw.decisionDigest || '') ||
      !DIGEST.test(raw.commercialBasisDigest || '') ||
      !Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 24 ||
      raw.currency !== 'USD' || raw.sourceCurrent !== true || raw.invoiceAuthorized !== false ||
      raw.receivableAuthorized !== false || raw.issueAuthorized !== false ||
      raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0 ||
      raw.tax?.state !== 'unavailable' || raw.tax?.value !== null ||
      raw.amountDue?.state !== 'unavailable' || raw.amountDue?.value !== null) failure();
  const subtotal = money.verify(raw.subtotalBeforeTax);
  let sum = 0n;
  for (const [ordinal, line] of raw.lines.entries()) {
    if (!line || line.ordinal !== ordinal || !DIGEST.test(line.lineDigest || '') ||
        !['mission24_customer_safe_charge','mission24_accepted_deposit'].includes(line.kind) ||
        typeof line.description !== 'string' || !line.description.trim() ||
        line.description.length > 500 || line.quantity?.value !== '1' ||
        !['customer_safe_charge','accepted_deposit'].includes(line.quantity?.unit) ||
        money.verify(line.unitAmount).minorUnits !== money.verify(line.lineAmount).minorUnits) failure();
    sum += BigInt(money.verify(line.lineAmount).minorUnits);
  }
  if (sum.toString() !== subtotal.minorUnits) failure();
  const serialized = JSON.stringify(raw);
  if (/customerName|email|phone|address|margin|internalCost|staff|providerPayload|rawEvidence/i.test(serialized)) failure();
  return Object.freeze(raw);
}
function unavailable(raw) {
  if (!raw || raw.state !== 'unavailable' || typeof raw.reason !== 'string' ||
      raw.value !== null || raw.sourceCurrent !== false || raw.invoiceAuthorized !== false ||
      raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0 ||
      /minorUnits|decimal|description|customerId|sourceIdentity/.test(JSON.stringify(raw))) failure();
  return Object.freeze(raw);
}

module.exports = { project, unavailable, CONTRACT_VERSION, CONFIRMATION_VERSION };
