'use strict';

const money = require('./exactMoney');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const CONTRACT_VERSION = 'm27-invoice-draft-components-v1';
const COMPONENT_TYPES = Object.freeze(['deposit_application','prior_payment','credit_note','refund','tax_adjustment']);
const COMPONENT_REASONS = Object.freeze(['deposit_payment_evidence_unavailable','prior_payment_evidence_unavailable',
  'credit_note_unavailable','refund_unavailable','tax_authority_unavailable']);
const COMPONENT_ROLES = Object.freeze(['amount_due_subtraction_once','amount_due_subtraction_once',
  'document_balance_adjustment_once','settled_payment_reversal_once','tax_liability_adjustment_once']);
const COMPONENT_MISSING_EVIDENCE = Object.freeze(['mission27.native_deposit_payment_receipt',
  'mission27.native_prior_payment_receipt','mission27.native_credit_note',
  'mission27.native_refund_receipt','mission27.invoice_date_tax_review']);
const UNSUPPORTED_TYPES = Object.freeze(['retainage','milestone','tip','surcharge','financing','recurring']);
const UNSUPPORTED_REASONS = Object.freeze(['retainage_unsupported','milestone_authority_unavailable',
  'tip_unsupported','surcharge_unsupported','financing_unsupported','recurring_billing_unsupported']);

function failure() { throw new Error('Invoice-draft component contract invalid'); }
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function unavailable(raw) {
  if (!exact(raw, ['contractVersion','state','reason','value','sourceCurrent',
    'commercialSourceAuthorityCurrent','invoiceAuthorized','receivableAuthorized','issueAuthorized',
    'providerCallCount','receiverMutationCount']) || raw.contractVersion !== CONTRACT_VERSION ||
      raw.state !== 'unavailable' ||
      typeof raw.reason !== 'string' || raw.reason.length < 1 || raw.value !== null ||
      raw.sourceCurrent !== false || raw.commercialSourceAuthorityCurrent !== false ||
      raw.invoiceAuthorized !== false || raw.receivableAuthorized !== false ||
      raw.issueAuthorized !== false || raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0 ||
      /minorUnits|decimal|commercialRevision|financialComponents|invoiceDraft/i.test(JSON.stringify(raw))) failure();
  return Object.freeze(raw);
}
function missingComponent(raw, ordinal) {
  if (!exact(raw, ['componentType','state','reason','value','provenance','arithmeticRole','missingEvidence']) ||
      raw.componentType !== COMPONENT_TYPES[ordinal] || raw.state !== 'unavailable' ||
      raw.reason !== COMPONENT_REASONS[ordinal] || raw.value !== null || raw.provenance !== null ||
      raw.arithmeticRole !== COMPONENT_ROLES[ordinal] || !Array.isArray(raw.missingEvidence) ||
      raw.missingEvidence.length !== 1 ||
      raw.missingEvidence[0] !== COMPONENT_MISSING_EVIDENCE[ordinal]) failure();
}
function unsupported(raw, ordinal) {
  if (!exact(raw, ['componentType','state','reason','value','provenance','arithmeticRole']) ||
      raw.componentType !== UNSUPPORTED_TYPES[ordinal] || raw.state !== 'unsupported' ||
      raw.reason !== UNSUPPORTED_REASONS[ordinal] || raw.value !== null || raw.provenance !== null ||
      raw.arithmeticRole !== 'none') failure();
}
function project(raw) {
  const draft = raw?.invoiceDraft; const commercial = raw?.commercialRevision;
  const acceptance = commercial?.customerAcceptance; const reconciliation = raw?.reconciliation;
  if (!exact(raw, ['contractVersion','state','invoiceDraft','commercialRevision','financialComponents',
    'unsupportedShapes','reconciliation','sourceCurrent','commercialSourceAuthorityCurrent','invoiceAuthorized',
    'receivableAuthorized','issueAuthorized','providerCallCount','receiverMutationCount','componentsDigest']) ||
      raw.contractVersion !== CONTRACT_VERSION || raw.state !== 'current' ||
      !exact(draft, ['originId','originDigest','revision','draftDigest','historyChainDigest','currency',
        'subtotalBeforeTax']) || !UUID.test(draft.originId || '') || !DIGEST.test(draft.originDigest || '') ||
      !Number.isSafeInteger(draft.revision) || draft.revision < 0 ||
      !DIGEST.test(draft.draftDigest || '') || !DIGEST.test(draft.historyChainDigest || '') ||
      draft.currency !== 'USD' || !exact(commercial, ['authorityClass','issuedVersionId','issuedRevision',
        'issuedDigest','documentDigest','commercialApprovalId','commercialApprovalDigest',
        'customerAcceptance','amountChangingFeesDiscountsOrScopeRequireNewAcceptedMission24Revision',
        'mission27CommercialAmountOverrideAuthorized']) ||
      commercial.authorityClass !== 'mission24.current_accepted_commercial_revision' ||
      !UUID.test(commercial.issuedVersionId || '') || !Number.isSafeInteger(commercial.issuedRevision) ||
      commercial.issuedRevision < 1 || !DIGEST.test(commercial.issuedDigest || '') ||
      !DIGEST.test(commercial.documentDigest || '') || !UUID.test(commercial.commercialApprovalId || '') ||
      !DIGEST.test(commercial.commercialApprovalDigest || '') ||
      !exact(acceptance, ['state','acceptanceId','acceptanceDigest']) ||
      acceptance.state !== 'accepted_current' ||
      !UUID.test(acceptance.acceptanceId || '') || !DIGEST.test(acceptance.acceptanceDigest || '') ||
      commercial.amountChangingFeesDiscountsOrScopeRequireNewAcceptedMission24Revision !== true ||
      commercial.mission27CommercialAmountOverrideAuthorized !== false ||
      !Array.isArray(raw.financialComponents) || raw.financialComponents.length !== COMPONENT_TYPES.length ||
      !Array.isArray(raw.unsupportedShapes) || raw.unsupportedShapes.length !== UNSUPPORTED_TYPES.length ||
      !exact(reconciliation, ['version','commercialSubtotalSource','subtotalBeforeTax',
        'separateComponentsAffectCommercialSubtotal','depositScheduleIsPaymentReceipt',
        'componentIdentityAndProvenanceRequired','duplicateComponentEffectAllowed','componentEffect','amountDue']) ||
      reconciliation.version !== 'm27-invoice-component-reconciliation-v1' ||
      reconciliation.commercialSubtotalSource !== 'exact_current_invoice_draft_only' ||
      reconciliation.separateComponentsAffectCommercialSubtotal !== false ||
      reconciliation.depositScheduleIsPaymentReceipt !== false ||
      reconciliation.componentIdentityAndProvenanceRequired !== true ||
      reconciliation.duplicateComponentEffectAllowed !== false ||
      !exact(reconciliation.componentEffect, ['state','reason','value']) ||
      reconciliation.componentEffect.state !== 'unavailable' ||
      reconciliation.componentEffect.reason !== 'financial_component_evidence_unavailable' ||
      reconciliation.componentEffect?.value !== null || reconciliation.amountDue?.state !== 'unavailable' ||
      !exact(reconciliation.amountDue, ['state','reason','value']) ||
      reconciliation.amountDue.reason !== 'invoice_reconciliation_not_yet_authorized' ||
      reconciliation.amountDue.value !== null || raw.sourceCurrent !== true ||
      raw.commercialSourceAuthorityCurrent !== true || raw.invoiceAuthorized !== false ||
      raw.receivableAuthorized !== false || raw.issueAuthorized !== false ||
      raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0 ||
      !DIGEST.test(raw.componentsDigest || '')) failure();
  const draftSubtotal = money.verify(draft.subtotalBeforeTax);
  const reconciliationSubtotal = money.verify(reconciliation.subtotalBeforeTax);
  if (draftSubtotal.minorUnits !== reconciliationSubtotal.minorUnits) failure();
  raw.financialComponents.forEach(missingComponent);
  raw.unsupportedShapes.forEach(unsupported);
  return Object.freeze(raw);
}

module.exports = { project, unavailable, CONTRACT_VERSION, COMPONENT_TYPES,
  COMPONENT_REASONS, COMPONENT_MISSING_EVIDENCE, UNSUPPORTED_TYPES, UNSUPPORTED_REASONS };
