'use strict';

const money = require('./exactMoney');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CONTRACT_VERSION = 'm27-invoice-date-tax-review-v1';
const CONFIRMATION_VERSION = 'm27-invoice-date-tax-review-record-v1';
const US_SUBDIVISIONS = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
  'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY','DC']);

function failure() { throw new Error('Invoice-date tax review contract invalid'); }
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function unavailable(raw) {
  if (!exact(raw, ['contractVersion','state','reason','value','sourceCurrent','taxAuthorityCurrent',
    'taxBearingInvoiceAuthorized','invoiceAuthorized','receivableAuthorized','issueAuthorized',
    'providerCallCount','receiverMutationCount']) || raw.contractVersion !== CONTRACT_VERSION ||
      raw.state !== 'unavailable' || typeof raw.reason !== 'string' || !raw.reason || raw.value !== null ||
      raw.sourceCurrent !== false || raw.taxAuthorityCurrent !== false ||
      raw.taxBearingInvoiceAuthorized !== false || raw.invoiceAuthorized !== false ||
      raw.receivableAuthorized !== false || raw.issueAuthorized !== false ||
      raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0 ||
      /minorUnits|decimal|preparation|jurisdiction|registration/i.test(JSON.stringify(raw))) failure();
  return Object.freeze(raw);
}
function jurisdiction(value) {
  return exact(value, ['countryCode','region','city','postalCode']) && value.countryCode === 'US' &&
    US_SUBDIVISIONS.has(value.region) && typeof value.city === 'string' && value.city.length > 0 &&
    /^[0-9]{5}(?:-[0-9]{4})?$/.test(value.postalCode || '');
}
function validatePreparation(value) {
  const draft = value?.invoiceDraft; const billing = value?.billingIdentity;
  const m24 = value?.mission24; const liability = value?.collectedTaxLiability;
  if (!exact(value, ['version','invoiceDate','invoiceDraft','billingIdentity','mission24',
    'serviceJurisdiction','billingJurisdiction','registrationEvidence','nexusEvidence',
    'exemptionSnapshot','rounding','lines','collectedTaxLiability','creditRefundAdjustmentLineage',
    'sourceCurrent','providerCalculationUsed','browserArithmeticUsed']) ||
      value.version !== 'm27-invoice-date-tax-preparation-v1' || !DATE.test(value.invoiceDate || '') ||
      !exact(draft, ['originId','originDigest','revision','draftDigest','historyChainDigest','currency',
        'subtotalBeforeTax']) || !UUID.test(draft.originId || '') || !DIGEST.test(draft.originDigest || '') ||
      !Number.isSafeInteger(draft.revision) || draft.revision < 0 || !DIGEST.test(draft.draftDigest || '') ||
      !DIGEST.test(draft.historyChainDigest || '') || draft.currency !== 'USD' ||
      !exact(billing, ['billingPartyId','reviewId','reviewSequence','reviewDigest']) ||
      !UUID.test(billing.billingPartyId || '') || !UUID.test(billing.reviewId || '') ||
      !Number.isSafeInteger(billing.reviewSequence) || billing.reviewSequence < 1 ||
      !DIGEST.test(billing.reviewDigest || '') ||
      !exact(m24, ['authorityClass','issuedVersionId','issuedRevision','issuedDigest','documentDigest',
        'termsId','termsRevision','termsDigest','decisionDigest','calculationVersion','taxAuthorityClass']) ||
      m24.authorityClass !== 'mission24.current_accepted_tax_preparation' ||
      !UUID.test(m24.issuedVersionId || '') || !Number.isSafeInteger(m24.issuedRevision) ||
      m24.issuedRevision < 1 || !DIGEST.test(m24.issuedDigest || '') ||
      !DIGEST.test(m24.documentDigest || '') || !UUID.test(m24.termsId || '') ||
      !Number.isSafeInteger(m24.termsRevision) || m24.termsRevision < 1 ||
      !DIGEST.test(m24.termsDigest || '') || !DIGEST.test(m24.decisionDigest || '') ||
      !['estimate-commercial-terms-v1','estimate-commercial-terms-v2'].includes(m24.calculationVersion) ||
      !['owner_recorded','validated'].includes(m24.taxAuthorityClass) ||
      !jurisdiction(value.serviceJurisdiction) || !jurisdiction(value.billingJurisdiction) ||
      !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 24 ||
      value.sourceCurrent !== true || value.providerCalculationUsed !== false ||
      value.browserArithmeticUsed !== false) failure();
  money.verify(draft.subtotalBeforeTax);
  if (value.registrationEvidence?.state === 'unavailable') {
    if (!exact(value.registrationEvidence, ['state','reason','value']) ||
        value.registrationEvidence.reason !== 'registration_evidence_unavailable' ||
        value.registrationEvidence.value !== null) failure();
  } else if (!exact(value.registrationEvidence, ['state','registration','registrationReference',
    'collectionBasis','taxProfileId','taxProfileRevision','taxProfileDigest']) ||
      value.registrationEvidence.state !== 'source_snapshot' ||
      !UUID.test(value.registrationEvidence.taxProfileId || '') ||
      !Number.isSafeInteger(value.registrationEvidence.taxProfileRevision) ||
      !DIGEST.test(value.registrationEvidence.taxProfileDigest || '')) failure();
  if (!exact(value.nexusEvidence, ['state','reason','value']) ||
      value.nexusEvidence.state !== 'unavailable' ||
      value.nexusEvidence.reason !== 'professional_tax_policy_unavailable' ||
      value.nexusEvidence.value !== null ||
      !exact(value.exemptionSnapshot, ['classification','evidenceReference','profileExemptionReference']) ||
      typeof value.exemptionSnapshot.classification !== 'string' ||
      !exact(value.rounding, ['version','mode','minorUnitExponent']) ||
      value.rounding.version !== 'mission24.canonical_commercial_numeric_round.v1' ||
      value.rounding.mode !== 'half_away_from_zero' || value.rounding.minorUnitExponent !== 2) failure();
  let taxSum = 0n;
  value.lines.forEach((line, ordinal) => {
    if (!exact(line, ['ordinal','invoiceSourceLineDigest','mission24LineId','taxGroupId','treatment',
      'inclusiveExclusive','ratePercent','taxableBasis','collectedTax','source']) ||
        line.ordinal !== ordinal || !DIGEST.test(line.invoiceSourceLineDigest || '') ||
        typeof line.mission24LineId !== 'string' || !line.mission24LineId ||
        typeof line.taxGroupId !== 'string' || !line.taxGroupId ||
        !['taxable','zero_rate','exempt'].includes(line.treatment) ||
        !['inclusive','exclusive'].includes(line.inclusiveExclusive) ||
        !/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,4})?$/.test(line.ratePercent || '') ||
        !exact(line.source, ['kind','jurisdiction','location','serviceKey','collectionBasis','reference',
          'effectiveOn','endsOn','reviewedOn','reviewValidThrough','ruleId','ruleDigest']) ||
        !['owner_recorded','validated'].includes(line.source.kind) ||
        !DATE.test(line.source.effectiveOn || '') || !DATE.test(line.source.reviewedOn || '') ||
        !DATE.test(line.source.reviewValidThrough || '')) failure();
    money.verify(line.taxableBasis); const tax = money.verify(line.collectedTax);
    taxSum += BigInt(tax.minorUnits);
  });
  if (!exact(liability, ['amount','arithmeticRole','revenueRecognitionAuthorized','filingAuthorized']) ||
      liability.arithmeticRole !== 'tax_liability_separate_from_commercial_subtotal' ||
      liability.revenueRecognitionAuthorized !== false || liability.filingAuthorized !== false ||
      BigInt(money.verify(liability.amount).minorUnits) !== taxSum ||
      !exact(value.creditRefundAdjustmentLineage, ['state','reason','value','missingEvidence']) ||
      value.creditRefundAdjustmentLineage.state !== 'unavailable' ||
      value.creditRefundAdjustmentLineage.reason !== 'credit_refund_lineage_unavailable' ||
      value.creditRefundAdjustmentLineage.value !== null ||
      !Array.isArray(value.creditRefundAdjustmentLineage.missingEvidence) ||
      value.creditRefundAdjustmentLineage.missingEvidence.length !== 2) failure();
}
function common(raw, state) {
  const keys = ['contractVersion','state','reviewId','reviewSequence','preparation','preparationDigest',
    'professionalPolicy','taxReviewDisposition','sourceCurrent','taxAuthorityCurrent',
    'taxBearingInvoiceAuthorized','invoiceAuthorized','receivableAuthorized','issueAuthorized',
    'providerCallCount','receiverMutationCount','reviewDigest','reason','reviewedAt'];
  if (!exact(raw, keys) || raw.contractVersion !== CONTRACT_VERSION || raw.state !== state ||
      !DIGEST.test(raw.preparationDigest || '') ||
      !exact(raw.professionalPolicy, ['state','reason','value','missingEvidence']) ||
      raw.professionalPolicy.state !== 'unavailable' || raw.professionalPolicy.reason !== 'tax_authority_unavailable' ||
      raw.professionalPolicy.value !== null || !Array.isArray(raw.professionalPolicy.missingEvidence) ||
      raw.professionalPolicy.missingEvidence[0] !== 'professional_tax_policy_review' ||
      !exact(raw.taxReviewDisposition, ['state','reason','value','taxBearingInvoiceAuthorized']) ||
      raw.taxReviewDisposition.state !== 'unavailable' || raw.taxReviewDisposition.reason !== 'tax_authority_unavailable' ||
      raw.taxReviewDisposition.value !== null || raw.taxReviewDisposition.taxBearingInvoiceAuthorized !== false ||
      raw.sourceCurrent !== true || raw.taxAuthorityCurrent !== false ||
      raw.taxBearingInvoiceAuthorized !== false || raw.invoiceAuthorized !== false ||
      raw.receivableAuthorized !== false || raw.issueAuthorized !== false ||
      raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0) failure();
  validatePreparation(raw.preparation);
}
function project(raw) {
  if (raw?.state === 'unavailable') return unavailable(raw);
  if (raw?.state === 'ready_to_record') {
    if (!exact(raw, ['contractVersion','state','reviewId','reviewSequence','preparation','preparationDigest',
      'professionalPolicy','taxReviewDisposition','sourceCurrent','taxAuthorityCurrent',
      'taxBearingInvoiceAuthorized','invoiceAuthorized','receivableAuthorized','issueAuthorized',
      'providerCallCount','receiverMutationCount','candidateDigest','reviewDigest','reason','reviewedAt'])) failure();
    const comparable = { ...raw }; delete comparable.candidateDigest;
    common(comparable, 'ready_to_record');
    if (raw.reviewId !== null || raw.reviewSequence !== 0 || !DIGEST.test(raw.candidateDigest || '') ||
        raw.reviewDigest !== null || raw.reason !== null || raw.reviewedAt !== null) failure();
  } else if (raw?.state === 'recorded_policy_unavailable') {
    common(raw, 'recorded_policy_unavailable');
    if (!UUID.test(raw.reviewId || '') || !Number.isSafeInteger(raw.reviewSequence) ||
        raw.reviewSequence < 1 || !DIGEST.test(raw.reviewDigest || '') ||
        typeof raw.reason !== 'string' || raw.reason.length < 12 || !UTC.test(raw.reviewedAt || '')) failure();
  } else failure();
  return Object.freeze(raw);
}

module.exports = { project, unavailable, CONTRACT_VERSION, CONFIRMATION_VERSION };
