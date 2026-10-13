'use strict';

const { sha256 } = require('../services/businessProfileAdapter');
const money = require('./exactMoney');
const contract = require('./invoiceDraftPreview');

function asMoney(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) {
    throw Object.assign(new Error('The fictional invoice amount is unavailable.'), { code: 'DEMO_STATE_INVALID' });
  }
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 0.000001 || !Number.isSafeInteger(scaled)) {
    throw Object.assign(new Error('The fictional invoice amount is not exact.'), { code: 'DEMO_STATE_INVALID' });
  }
  return money.fromMinorUnits(String(scaled));
}
function project(item, workspaceRevision) {
  if (!item || item.source?.type !== 'account_free_demo' || item.source?.version !== '2' ||
      item.estimate?.currency !== 'USD' || !Array.isArray(item.estimate.lineItems) ||
      item.estimate.lineItems.length < 1 || item.estimate.lineItems.length > 24 ||
      !Number.isSafeInteger(workspaceRevision) || workspaceRevision < 1) {
    throw Object.assign(new Error('That fictional invoice preview is unavailable.'), { code: 'DEMO_STATE_INVALID' });
  }
  const snapshot = item.snapshot || {};
  const subtotal = asMoney(snapshot.subtotalBeforeTax);
  const preparedTax = asMoney(snapshot.tax);
  const preparedTotal = asMoney(snapshot.totalIncludingTax);
  if (BigInt(subtotal.minorUnits) + BigInt(preparedTax.minorUnits) !== BigInt(preparedTotal.minorUnits)) {
    throw Object.assign(new Error('The fictional invoice totals conflict.'), { code: 'DEMO_STATE_INVALID' });
  }
  let lineSum = 0n;
  const lines = item.estimate.lineItems.map((line, ordinal) => {
    const amount = asMoney(line.customerCharge); lineSum += BigInt(amount.minorUnits);
    return { ordinal, sourceLineDigest: sha256({ snapshotDigest: item.snapshotDigest,
      code: line.code, ordinal, amount }), group: 'Fictional example',
      description: String(line.label || 'Fictional service line'),
      quantity: { version: 'm27-invoice-quantity-v1', value: '1',
        unit: 'customer_safe_charge', meaning: 'One fictional customer-safe charge.' },
      amount, tax: ordinal === item.estimate.lineItems.length - 1 ? preparedTax : money.fromMinorUnits('0'),
      taxTreatment: preparedTax.exactZero ? 'zero_rate' : 'taxable', inclusiveExclusive: 'exclusive' };
  });
  if (lineSum !== BigInt(subtotal.minorUnits)) {
    throw Object.assign(new Error('The fictional invoice lines do not reconcile.'), { code: 'DEMO_STATE_INVALID' });
  }
  const missingEvidence = [
    ['professional_tax_policy_review','tax_authority_unavailable'],
    ['mission27.native_deposit_payment_receipt','deposit_payment_evidence_unavailable'],
    ['mission27.native_prior_payment_receipt','prior_payment_evidence_unavailable'],
    ['mission27.native_credit_note','credit_note_unavailable'],
    ['mission27.native_refund_receipt','refund_unavailable'],
    ['mission27.invoice_date_tax_review','tax_authority_unavailable'],
  ].map(([source, reason]) => ({ source, state: 'unavailable', reason }));
  const reconciliation = { version: 'm27-invoice-draft-total-reconciliation-v1',
    subtotalBeforeTax: subtotal, preparedTax,
    preparedDocumentTotal: { state: 'preparation_only', reason: 'professional_tax_policy_unavailable',
      value: preparedTotal }, amountDue: { state: 'unavailable',
      reason: 'invoice_reconciliation_evidence_unavailable', value: null, missingEvidence },
    zeroRequiresExplicitSupportedArithmetic: true, missingEvidenceTreatedAsZero: false,
    browserArithmeticUsed: false };
  const originDigest = item.projectionDigest;
  const componentsDigest = sha256({ item: item.ids.estimate, workspaceRevision, missingEvidence });
  const preparationDigest = sha256({ snapshotDigest: item.snapshotDigest, subtotal, preparedTax, preparedTotal });
  const draftIdentity = { estimateId: item.ids.estimate, originId: item.ids.graph, originDigest,
    revision: workspaceRevision, draftDigest: sha256({ originDigest, lines, subtotal }),
    historyChainDigest: sha256({ originDigest, workspaceRevision }), componentsDigest, preparationDigest };
  const documentPreview = { version: 'm27-invoice-draft-document-preview-v1', state: 'review_required',
    fictional: true, label: 'Fictional invoice draft — not issued', lines, reconciliation,
    pdf: { state: 'unavailable', reason: 'immutable_invoice_document_not_yet_authorized', value: null },
    customerFacingDocumentAuthorized: false, issuedDocument: false };
  const base = { contractVersion: contract.CONTRACT_VERSION, state: 'current', mode: 'demo', fictional: true,
    draftIdentity, documentPreview, reconciliation,
    professionalTaxPolicy: { state: 'unavailable', reason: 'tax_authority_unavailable', value: null },
    sourceCurrent: true, commercialSourceAuthorityCurrent: true, taxAuthorityCurrent: false,
    amountDueCurrent: false, invoiceAuthorized: false, receivableAuthorized: false,
    issueAuthorized: false, providerCallCount: 0, receiverMutationCount: 0 };
  return contract.project({ ...base, previewDigest: sha256(base) });
}

module.exports = { project, asMoney };
