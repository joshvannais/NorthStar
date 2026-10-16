'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const invoicePart5 = require('./invoicePart5Acceptance');
const paymentPart9 = require('./paymentPart9Acceptance');
const providerEventNormalization = require('./paymentProviderEventNormalization');
const offlinePayment = require('./offlinePaymentReadiness');
const creditRefund = require('./creditRefundReadiness');
const paymentOutcome = require('./paymentOutcomeReadiness');
const settlementPayout = require('./paymentSettlementPayout');
const part10Contract = require('./collectionPart10Acceptance');

const CONTRACT_VERSION = 'm27-accounting-export-contract-v1';
const RECORD_VERSION = 'm27-accounting-export-record-v1';
const REASON = 'accounting_export_source_facts_unavailable';
const CAPABILITY = 'customer_financial.accounting.export';
const RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'factType',
  'factState',
  'sourceAuthority',
  'sourceContractVersion',
  'sourceRecordId',
  'sourceRevision',
  'sourceDigest',
  'sourceOccurredAt',
  'sourceRecordedAt',
  'currency',
  'amountMinorUnits',
  'sourceLineage',
]);
const LINEAGE_FIELDS = Object.freeze([
  'sourceAuthority',
  'sourceContractVersion',
  'sourceRecordId',
  'sourceRevision',
  'sourceDigest',
]);
const OFFLINE_CHECK_STATES = offlinePayment.OFFLINE_STATES;
const FACT_CLASSES = Object.freeze([
  Object.freeze({ factType: 'issued_invoice', sourceContractVersion: invoicePart5.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['issued_invoice']),
    reason: 'issued_invoice_unavailable' }),
  Object.freeze({ factType: 'payment', sourceContractVersion: paymentPart9.CONTRACT_VERSION,
    acceptedEvidenceStates: providerEventNormalization.EVIDENCE_STATES,
    reason: 'accepted_payment_unavailable' }),
  Object.freeze({ factType: 'offline_cash', sourceContractVersion: offlinePayment.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['offline_received']),
    reason: 'accepted_offline_cash_receipt_unavailable' }),
  Object.freeze({ factType: 'offline_check', sourceContractVersion: offlinePayment.CONTRACT_VERSION,
    acceptedEvidenceStates: OFFLINE_CHECK_STATES,
    reason: 'accepted_offline_check_evidence_unavailable' }),
  Object.freeze({ factType: 'credit', sourceContractVersion: creditRefund.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['credit_note_issued']),
    reason: 'issued_credit_unavailable' }),
  Object.freeze({ factType: 'refund', sourceContractVersion: paymentOutcome.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['refund_succeeded','refund_failed','refund_reversed']),
    reason: 'accepted_refund_evidence_unavailable' }),
  Object.freeze({ factType: 'write_off', sourceContractVersion: paymentOutcome.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['write_off_accepted']),
    reason: 'accepted_write_off_unavailable' }),
  Object.freeze({ factType: 'dispute', sourceContractVersion: paymentOutcome.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['dispute_opened','dispute_won','dispute_lost','dispute_reversed']),
    reason: 'authenticated_dispute_evidence_unavailable' }),
  Object.freeze({ factType: 'provider_fee', sourceContractVersion: settlementPayout.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['provider_fee_recorded']),
    reason: 'provider_fee_evidence_unavailable' }),
  Object.freeze({ factType: 'settlement', sourceContractVersion: settlementPayout.CONTRACT_VERSION,
    acceptedEvidenceStates: Object.freeze(['provider_settled']),
    reason: 'provider_settlement_evidence_unavailable' }),
]);
const FIELD_RULES = Object.freeze({
  recordVersion: Object.freeze({ type: 'literal', value: RECORD_VERSION }),
  factType: Object.freeze({ type: 'ordered_enum',
    values: Object.freeze(FACT_CLASSES.map(value => value.factType)) }),
  factState: Object.freeze({ type: 'fact_type_scoped_enum', callerAuthored: false }),
  sourceAuthority: Object.freeze({ type: 'versioned_server_owned_authority',
    blankAllowed: false }),
  sourceContractVersion: Object.freeze({ type: 'exact_source_contract_version',
    blankAllowed: false }),
  sourceRecordId: Object.freeze({ type: 'opaque_source_identifier', blankAllowed: false,
    maximumUtf8Bytes: 512 }),
  sourceRevision: Object.freeze({ type: 'base10_positive_integer_string',
    missingMayBecomeCurrent: false }),
  sourceDigest: Object.freeze({ type: 'lowercase_hex_sha256', length: 64 }),
  sourceOccurredAt: Object.freeze({ type: 'rfc3339_utc_instant',
    receiptTimeMaySubstitute: false }),
  sourceRecordedAt: Object.freeze({ type: 'rfc3339_utc_instant',
    receiptTimeMaySubstitute: false }),
  currency: Object.freeze({ type: 'iso4217_uppercase_3', silentConversionAllowed: false }),
  amountMinorUnits: Object.freeze({ type: 'base10_nonnegative_integer_string',
    negativeAmountAllowed: false, directionComesFromFactTypeAndState: true }),
  sourceLineage: Object.freeze({ type: 'exact_object', exactFields: LINEAGE_FIELDS,
    mustEqualTopLevelSourcePins: true }),
});

function exportFacts() {
  return FACT_CLASSES.map(value => Object.freeze({
    factType: value.factType,
    sourceContractVersion: value.sourceContractVersion,
    acceptedEvidenceStates: value.acceptedEvidenceStates,
    state: 'unavailable',
    reason: value.reason,
    value: null,
    factState: null,
    sourceAuthority: null,
    sourceRecordId: null,
    sourceRevision: null,
    sourceDigest: null,
    sourceOccurredAt: null,
    sourceRecordedAt: null,
    currency: null,
    amountMinorUnits: null,
    sourceLineage: null,
  }));
}

function unavailable(part10Raw, expectedMode = 'paid') {
  const part10 = part10Contract.projectBundle(part10Raw, expectedMode);
  const launch = paymentPart9.policy();
  const accounting = launch.financial.accounting;
  const exportControl = launch.actionControl[CAPABILITY];
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    part10Witness: Object.freeze({
      contractVersion: part10.part10Acceptance.contractVersion,
      state: part10.part10Acceptance.state,
      reason: part10.part10Acceptance.reason,
      digest: providerBoundary.digest(part10.part10Acceptance),
    }),
    recordContract: Object.freeze({
      recordVersion: RECORD_VERSION,
      providerNeutral: true,
      exactFields: RECORD_FIELDS,
      exactLineageFields: LINEAGE_FIELDS,
      fieldRules: FIELD_RULES,
      everyRecordRequiresExactSourceId: true,
      everyRecordRequiresExactSourceAuthorityContractAndState: true,
      everyRecordRequiresCurrency: true,
      everyRecordRequiresSourceOccurredAndRecordedTimestamps: true,
      everyRecordRequiresImmutableRevisionAndDigestLineage: true,
      missingAmountRevisionTimestampOrCurrencyMayBecomeZeroOrCurrent: false,
      arrivalOrderMaySupplyOccurrenceTimeRevisionOrAuthority: false,
      correctionReversalOrVoidMayRewriteSourceRecord: false,
      destinationSpecificAccountOrJournalFieldsAllowed: false,
      destinationMappingMayRewriteSourceFact: false,
    }),
    factClasses: Object.freeze(exportFacts()),
    offlineEvidence: Object.freeze({
      cashReceiptLaunchApproved: launch.financial.offline.cashReceiptEnabled,
      cashMayClaimProviderSettlement: false,
      checkReceiptLaunchApproved: launch.financial.offline.checkReceiptEnabled,
      exactCheckStates: OFFLINE_CHECK_STATES,
      checkClearedTransitionEnabled: launch.financial.offline.checkClearedTransitionEnabled,
      checkClearanceAuthority: launch.financial.offline.checkClearanceAuthority,
      missingClearanceState: offlinePayment.CHECK_CLEARANCE_UNAVAILABLE_STATE,
      accountingAcknowledgementMayClaimCheckClearance: false,
      humanAttestationPhotoPhoneOrFreeTextMayClaimClearance: false,
      returnAndReversalRequireExactOriginalReceiptAndAllocation: true,
    }),
    adapterBoundary: Object.freeze({
      configuredAdapter: accounting.adapter,
      supportedMode: accounting.supportedMode,
      runtimeAvailable: accounting.currentRuntimeAvailable,
      providerNeutralRecordContract: true,
      destinationSelectionAndMappingOwnedByPart11B: true,
      exportPreviewTransmissionAndAcknowledgementOwnedByPart11B: true,
      acknowledgementMayRewriteNorthStarSource: false,
      acknowledgementIsHumanAction: false,
    }),
    authority: Object.freeze({
      requiredCapability: CAPABILITY,
      controlMode: exportControl.mode,
      currentCapabilityGrantState: 'unavailable',
      currentReceivingAdapterState: 'unavailable',
      roleAloneAuthorizesExport: false,
      transmissionAuthorized: false,
      mayInventChartOfAccounts: accounting.mayInventChartOfAccounts,
      mayDecideRecognitionOrTax: accounting.mayDecideRecognitionOrTax,
      mayCreateJournalTaxFilingOrBooksClose: false,
      legalTaxOrAccountingReviewComplete: false,
    }),
    bounds: Object.freeze({
      maximumRecords: exportControl.maximumRecords,
      maximumAbsoluteMinorUnits: exportControl.maximumMinorUnits,
      singleControlMaximumRecords: launch.performance.singleControlAccountingExportRecords,
      singleControlMaximumAbsoluteMinorUnits:
        launch.performance.singleControlAccountingExportMinorUnits,
      exactCurrentMinimizedFactSetRequired: true,
      currentReceivingAdapterRequired: true,
      largerInBoundsExportRequiresTwoDifferentCurrentHumans: true,
      missingRecordCountAmountOrBoundDenies: true,
      candidateRecordCount: 0,
      candidateAbsoluteMinorUnits: null,
      candidateWithinBounds: null,
    }),
    access: Object.freeze({
      eligiblePaidRoles: Object.freeze(['owner','admin']),
      currentTenantSessionRequired: true,
      currentSubscriptionRequired: true,
      tenantCrossingAllowed: false,
      customerOrPublicAccessAllowed: false,
      demoRouteAvailable: false,
    }),
    privacy: Object.freeze({
      tenantIdentityExposed: false,
      customerIdentityExposed: false,
      invoicePaymentOrProviderIdentityExposed: false,
      sourceAmountCurrencyOrTimestampExposed: false,
      accountingAccountMappingExposed: false,
      providerCredentialOrSecretExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    exportRecordCount: 0,
    exportBatchCount: 0,
    exportPreviewCount: 0,
    transmissionCount: 0,
    acknowledgementCount: 0,
    accountingMutationCount: 0,
    providerCallCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, part10Raw, expectedMode = 'paid') {
  const expected = unavailable(part10Raw, expectedMode);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Accounting export contract invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, RECORD_VERSION, REASON, CAPABILITY, RECORD_FIELDS,
  LINEAGE_FIELDS, OFFLINE_CHECK_STATES, FACT_CLASSES, FIELD_RULES, unavailable, project };
