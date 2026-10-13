'use strict';

const money = require('./exactMoney');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INTEGER = /^(?:0|[1-9][0-9]{0,7})$/;
const CONTRACT_VERSION = 'm27-invoice-draft-revision-v1';
const EDIT_VERSION = 'm27-invoice-draft-edit-v1';
const CONFIRMATION_VERSION = 'm27-invoice-draft-revision-save-v1';

function failure() { throw new Error('Invoice-draft revision contract invalid'); }
function unavailable(raw) {
  if (!raw || raw.contractVersion !== CONTRACT_VERSION || raw.state !== 'unavailable' ||
      typeof raw.reason !== 'string' || raw.value !== null || raw.sourceCurrent !== false ||
      raw.invoiceAuthorized !== false || raw.receivableAuthorized !== false ||
      raw.issueAuthorized !== false || raw.providerCallCount !== 0 ||
      raw.receiverMutationCount !== 0 || /minorUnits|decimal|description|customerId|lines/i.test(
        JSON.stringify(raw))) failure();
  return Object.freeze(raw);
}
function project(raw) {
  if (!raw || raw.contractVersion !== CONTRACT_VERSION || raw.state !== 'current' ||
      !UUID.test(raw.originId || '') || !DIGEST.test(raw.originDigest || '') ||
      !DIGEST.test(raw.candidateDigest || '') || !Number.isSafeInteger(raw.revision) ||
      raw.revision < 0 || !DIGEST.test(raw.draftDigest || '') ||
      !DIGEST.test(raw.historyChainDigest || '') || raw.currency !== 'USD' ||
      !Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 24 ||
      raw.sourceCurrent !== true || raw.invoiceAuthorized !== false ||
      raw.receivableAuthorized !== false || raw.issueAuthorized !== false ||
      raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0) failure();
  const total = money.verify(raw.subtotalBeforeTax); let sum = 0n;
  for (const [ordinal, line] of raw.lines.entries()) {
    if (!line || line.ordinal !== ordinal || !DIGEST.test(line.sourceLineDigest || '') ||
        typeof line.group !== 'string' || line.group.trim() !== line.group ||
        line.group.length < 1 || line.group.length > 120 || typeof line.description !== 'string' ||
        line.description.trim() !== line.description || line.description.length < 1 ||
        line.description.length > 500 || line.quantity?.version !== 'm27-invoice-quantity-v1' ||
        line.quantity?.value !== '1' ||
        !['customer_safe_charge','accepted_deposit'].includes(line.quantity?.unit) ||
        money.verify(line.allocatedAmount).currency !== 'USD') failure();
    sum += BigInt(line.allocatedAmount.minorUnits);
  }
  if (sum.toString() !== total.minorUnits) failure();
  return Object.freeze(raw);
}
function normalizeEdit(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      raw.contractVersion !== EDIT_VERSION || !UUID.test(raw.originId || '') ||
      !DIGEST.test(raw.originDigest || '') || !Array.isArray(raw.lines) ||
      raw.lines.length < 1 || raw.lines.length > 24 ||
      Object.keys(raw).some(key => !['contractVersion','originId','originDigest','lines'].includes(key))) failure();
  const lines = raw.lines.map((line, ordinal) => {
    if (!line || typeof line !== 'object' || Array.isArray(line) ||
        Object.keys(line).some(key => !['ordinal','sourceLineDigest','group','description','allocatedMinorUnits'].includes(key)) ||
        line.ordinal !== ordinal || !DIGEST.test(line.sourceLineDigest || '') ||
        typeof line.group !== 'string' || line.group.trim() !== line.group ||
        line.group.length < 1 || line.group.length > 120 || typeof line.description !== 'string' ||
        line.description.trim() !== line.description || line.description.length < 1 ||
        line.description.length > 500 || typeof line.allocatedMinorUnits !== 'string' ||
        !INTEGER.test(line.allocatedMinorUnits)) failure();
    return Object.freeze({ ordinal, sourceLineDigest: line.sourceLineDigest,
      group: line.group, description: line.description,
      allocatedMinorUnits: line.allocatedMinorUnits });
  });
  if (new Set(lines.map(line => line.sourceLineDigest)).size !== lines.length) failure();
  return Object.freeze({ contractVersion: EDIT_VERSION, originId: raw.originId.toLowerCase(),
    originDigest: raw.originDigest, lines: Object.freeze(lines) });
}

module.exports = { project, unavailable, normalizeEdit, CONTRACT_VERSION, EDIT_VERSION,
  CONFIRMATION_VERSION };
