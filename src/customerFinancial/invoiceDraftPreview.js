'use strict';

const money = require('./exactMoney');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const CONTRACT_VERSION = 'm27-invoice-draft-preview-v1';

function invalid() { throw new Error('Invoice-draft preview contract invalid'); }
function exact(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)); }
function unavailable(raw) {
  if (!exact(raw, ['contractVersion','state','mode','fictional','reason','value','sourceCurrent',
    'commercialSourceAuthorityCurrent','taxAuthorityCurrent','amountDueCurrent','invoiceAuthorized',
    'receivableAuthorized','issueAuthorized','providerCallCount','receiverMutationCount']) ||
    raw.contractVersion !== CONTRACT_VERSION || raw.state !== 'unavailable' || raw.mode !== 'paid' ||
    raw.fictional !== false || typeof raw.reason !== 'string' || !raw.reason || raw.value !== null ||
    raw.sourceCurrent !== false || raw.commercialSourceAuthorityCurrent !== false ||
    raw.taxAuthorityCurrent !== false || raw.amountDueCurrent !== false || raw.invoiceAuthorized !== false ||
    raw.receivableAuthorized !== false || raw.issueAuthorized !== false || raw.providerCallCount !== 0 ||
    raw.receiverMutationCount !== 0 || /minorUnits|decimal|description|lines|customer/i.test(JSON.stringify(raw))) invalid();
  return Object.freeze(raw);
}
function verifyReconciliation(value) {
  if (!exact(value, ['version','subtotalBeforeTax','preparedTax','preparedDocumentTotal','amountDue',
    'zeroRequiresExplicitSupportedArithmetic','missingEvidenceTreatedAsZero','browserArithmeticUsed']) ||
    value.version !== 'm27-invoice-draft-total-reconciliation-v1' ||
    value.preparedDocumentTotal?.state !== 'preparation_only' ||
    value.preparedDocumentTotal?.reason !== 'professional_tax_policy_unavailable' ||
    value.amountDue?.state !== 'unavailable' ||
    value.amountDue?.reason !== 'invoice_reconciliation_evidence_unavailable' || value.amountDue.value !== null ||
    !Array.isArray(value.amountDue.missingEvidence) || value.amountDue.missingEvidence.length !== 6 ||
    value.amountDue.missingEvidence.some(item => !item || item.state !== 'unavailable' ||
      typeof item.source !== 'string' || typeof item.reason !== 'string') ||
    value.zeroRequiresExplicitSupportedArithmetic !== true || value.missingEvidenceTreatedAsZero !== false ||
    value.browserArithmeticUsed !== false) invalid();
  const subtotal = money.verify(value.subtotalBeforeTax), tax = money.verify(value.preparedTax);
  const total = money.verify(value.preparedDocumentTotal.value);
  if (BigInt(subtotal.minorUnits) + BigInt(tax.minorUnits) !== BigInt(total.minorUnits)) invalid();
  const sources = value.amountDue.missingEvidence.map(item => item.source);
  if (new Set(sources).size !== sources.length) invalid();
}
function project(raw) {
  if (raw?.state === 'unavailable') return unavailable(raw);
  const identity = raw?.draftIdentity, preview = raw?.documentPreview;
  if (!exact(raw, ['contractVersion','state','mode','fictional','draftIdentity','documentPreview',
    'reconciliation','professionalTaxPolicy','sourceCurrent','commercialSourceAuthorityCurrent',
    'taxAuthorityCurrent','amountDueCurrent','invoiceAuthorized','receivableAuthorized','issueAuthorized',
    'providerCallCount','receiverMutationCount','previewDigest']) || raw.contractVersion !== CONTRACT_VERSION ||
    raw.state !== 'current' || !['paid','demo'].includes(raw.mode) || raw.fictional !== (raw.mode === 'demo') ||
    !exact(identity, ['estimateId','originId','originDigest','revision','draftDigest','historyChainDigest',
      'componentsDigest','preparationDigest']) || !UUID.test(identity.estimateId || '') ||
    !UUID.test(identity.originId || '') || !DIGEST.test(identity.originDigest || '') ||
    !Number.isSafeInteger(identity.revision) || identity.revision < 0 || !DIGEST.test(identity.draftDigest || '') ||
    !DIGEST.test(identity.historyChainDigest || '') || !DIGEST.test(identity.componentsDigest || '') ||
    !DIGEST.test(identity.preparationDigest || '') || !exact(preview, ['version','state','fictional','label',
      'lines','reconciliation','pdf','customerFacingDocumentAuthorized','issuedDocument']) ||
    preview.version !== 'm27-invoice-draft-document-preview-v1' || preview.state !== 'review_required' ||
    preview.fictional !== raw.fictional || typeof preview.label !== 'string' || !preview.label || preview.label.length > 120 ||
    !Array.isArray(preview.lines) || preview.lines.length < 1 || preview.lines.length > 24 ||
    preview.pdf?.state !== 'unavailable' || typeof preview.pdf?.reason !== 'string' || !preview.pdf.reason ||
    preview.pdf?.value !== null ||
    preview.customerFacingDocumentAuthorized !== false || preview.issuedDocument !== false ||
    raw.professionalTaxPolicy?.state !== 'unavailable' || raw.professionalTaxPolicy?.value !== null ||
    raw.sourceCurrent !== true || raw.commercialSourceAuthorityCurrent !== true ||
    raw.taxAuthorityCurrent !== false || raw.amountDueCurrent !== false || raw.invoiceAuthorized !== false ||
    raw.receivableAuthorized !== false || raw.issueAuthorized !== false || raw.providerCallCount !== 0 ||
    raw.receiverMutationCount !== 0 || !DIGEST.test(raw.previewDigest || '')) invalid();
  let lineSubtotal = 0n, lineTax = 0n;
  preview.lines.forEach((line, ordinal) => {
    if (!exact(line, ['ordinal','sourceLineDigest','group','description','quantity','amount','tax',
      'taxTreatment','inclusiveExclusive']) || line.ordinal !== ordinal || !DIGEST.test(line.sourceLineDigest || '') ||
      typeof line.group !== 'string' || !line.group || line.group.length > 80 ||
      typeof line.description !== 'string' || !line.description || line.description.length > 280 ||
      !exact(line.quantity, ['version','value','unit','meaning']) ||
      line.quantity.version !== 'm27-invoice-quantity-v1' || typeof line.quantity.value !== 'string' ||
      !line.quantity.value || typeof line.quantity.unit !== 'string' || !line.quantity.unit ||
      typeof line.quantity.meaning !== 'string' || !line.quantity.meaning ||
      !['taxable','zero_rate','exempt'].includes(line.taxTreatment) ||
      !['inclusive','exclusive'].includes(line.inclusiveExclusive)) invalid();
    lineSubtotal += BigInt(money.verify(line.amount).minorUnits);
    lineTax += BigInt(money.verify(line.tax).minorUnits);
  });
  verifyReconciliation(raw.reconciliation);
  if (lineSubtotal !== BigInt(raw.reconciliation.subtotalBeforeTax.minorUnits) ||
      lineTax !== BigInt(raw.reconciliation.preparedTax.minorUnits)) invalid();
  if (JSON.stringify(raw.reconciliation) !== JSON.stringify(preview.reconciliation)) invalid();
  return Object.freeze(raw);
}

module.exports = { project, unavailable, CONTRACT_VERSION };
