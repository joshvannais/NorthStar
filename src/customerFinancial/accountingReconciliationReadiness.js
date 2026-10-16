'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const accountingExport = require('./accountingExportContract');
const exportReadiness = require('./accountingExportReadiness');

const CONTRACT_VERSION = 'm27-accounting-reconciliation-readiness-v1';
const RECORD_VERSION = 'm27-accounting-reconciliation-record-v1';
const REASON = 'accounting_acknowledgement_and_reconciliation_authority_unavailable';
const CAPABILITY = 'customer_financial.accounting.reconcile';
const STATES = Object.freeze([
  'matched','unmatched','conflicting','corrected','unavailable',
]);
const SIDES = Object.freeze(['northstar_source','external_accounting_record']);
const RECORD_FIELDS = Object.freeze([
  'recordVersion','state','northStarSourceId','northStarSourceRevision',
  'northStarSourceDigest','exportRequestId','exportRequestDigest',
  'acknowledgementReceiptId','acknowledgementReceiptDigest','externalRecordId',
  'externalRecordRevision','externalRecordDigest','currency','absoluteMinorUnits',
  'correctionOfReconciliationId','correctionReason','reviewedByUserId','reviewedAt',
  'revision','digest',
]);

function stateSemantics() {
  return Object.freeze([
    Object.freeze({ state:'matched', availability:'unavailable', value:null,
      exactNorthStarAndExternalPinsRequired:true,
      exactCurrencyAndAbsoluteMinorUnitsRequired:true,
      externalAcknowledgementMaySelfApply:false }),
    Object.freeze({ state:'unmatched', availability:'unavailable', value:null,
      exactlyOneSideMissingOrUnidentifiedRequired:true,
      missingSideMayBeInferredFromArrivalOrder:false,
      missingSideMayBecomeZeroOrCurrent:false }),
    Object.freeze({ state:'conflicting', availability:'unavailable', value:null,
      exactPinnedDisagreementRequired:true,
      conflictMayBeSilentlyResolved:false,
      externalRecordMayOverrideNorthStar:false }),
    Object.freeze({ state:'corrected', availability:'unavailable', value:null,
      exactPriorReconciliationRequired:true,
      appendOnlyCorrectionReasonAndReviewerRequired:true,
      correctionMayRewriteEitherSourceRecord:false }),
    Object.freeze({ state:'unavailable', availability:'unavailable', value:null,
      usedWhenRequiredSourceExportAcknowledgementOrExternalEvidenceIsMissing:true,
      unavailableMayBePromotedWithoutNewExactEvidence:false }),
  ]);
}

function unavailable(readinessRaw, sourceRaw, part10Raw) {
  let source; let readiness;
  try {
    source = accountingExport.project(sourceRaw, part10Raw);
    readiness = exportReadiness.project(readinessRaw, source, part10Raw);
  } catch (_error) {
    throw new Error('Accounting reconciliation source contract invalid');
  }
  const launch = providerBoundary.validateLaunchPolicy();
  const control = launch.actionControl[CAPABILITY];
  if (!control || control.mode !== 'dual_control' || control.singleControlAllowed !== false ||
      JSON.stringify(control.appliesTo) !== JSON.stringify([
        'manual_match','manual_mismatch_resolution','manual_books_status_override',
      ]) || control.adapterAcknowledgementIsHumanAction !== false) {
    throw new Error('Accounting reconciliation policy invalid');
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitness: Object.freeze({
      contractVersion: readiness.contractVersion,
      state: readiness.state,
      reason: readiness.reason,
      digest: providerBoundary.digest(readiness),
      exportContractVersion: source.contractVersion,
      exportContractDigest: providerBoundary.digest(source),
    }),
    recordContract: Object.freeze({
      recordVersion: RECORD_VERSION,
      exactFields: RECORD_FIELDS,
      exactStates: STATES,
      exactSides: SIDES,
      stateSemantics: stateSemantics(),
      everyRecordRequiresExactSourceExportAcknowledgementAndExternalPins: true,
      everyRecordRequiresExactCurrencyAndAbsoluteMinorUnits: true,
      everyRecordRequiresImmutableRevisionAndDigest: true,
      missingIdentityRevisionDigestAmountCurrencyOrTimeMayBecomeZeroOrCurrent: false,
      arrivalOrderMaySupplyOccurrenceRevisionMatchOrAuthority: false,
    }),
    northStarAuthority: Object.freeze({
      state: 'unavailable',
      reason: 'accepted_northstar_export_source_unavailable',
      value: null,
      providerNeutralSourceContractVersion: source.recordContract.recordVersion,
      exactCurrentSourceFactRequired: true,
      exactExportRequestAndAcknowledgementRequired: true,
      sourceRecordId: null,
      sourceRevision: null,
      sourceDigest: null,
      exportRequestId: null,
      exportRequestDigest: null,
      acknowledgementReceiptId: null,
      acknowledgementReceiptDigest: null,
      externalRecordMayRewriteNorthStarFactStateAmountCurrencyOrLineage: false,
      reconciliationMayCreateInvoicePaymentSettlementClearanceOrTaxTruth: false,
    }),
    externalEvidence: Object.freeze({
      state: 'unavailable',
      reason: 'accounting_external_record_evidence_unavailable',
      value: null,
      configuredAdapter: source.adapterBoundary.configuredAdapter,
      configuredMode: source.adapterBoundary.supportedMode,
      runtimeAvailable: source.adapterBoundary.runtimeAvailable,
      currentReceivingAdapterState: 'unavailable',
      exactAdapterAcknowledgementRequired: true,
      exactExternalRecordIdentityRevisionAndDigestRequired: true,
      externalRecordId: null,
      externalRecordRevision: null,
      externalRecordDigest: null,
      externalCurrency: null,
      externalAbsoluteMinorUnits: null,
      externalRecordRemainsAdapterSourceOwned: true,
      adapterAcknowledgementIsHumanAction: false,
      acknowledgementMaySupplySettlementCheckClearanceTaxRecognitionOrBooksClose:false,
    }),
    matching: Object.freeze({
      state: 'unavailable',
      reason: 'accounting_bidirectional_match_evidence_unavailable',
      value: null,
      compareBothDirections:true,
      exactSourceRecordRevisionDigestRequired:true,
      exactExportRequestAndAcknowledgementPinsRequired:true,
      exactExternalRecordRevisionDigestRequired:true,
      exactCurrencyAndAbsoluteMinorUnitsRequired:true,
      fuzzyIdentityAmountToleranceSilentFxOrArrivalOrderAllowed:false,
      missingAmountCurrencyCountOrSideMayBecomeZeroOrMatch:false,
      matchedRecordCount:null,
      unmatchedRecordCount:null,
      conflictingRecordCount:null,
      correctedRecordCount:null,
      unavailableRecordCount:null,
    }),
    correction: Object.freeze({
      state:'unavailable',
      reason:'accounting_reconciliation_correction_evidence_unavailable',
      value:null,
      appendOnly:true,
      exactPriorReconciliationIdentityRevisionAndDigestRequired:true,
      exactCurrentNorthStarAndExternalPinsRequired:true,
      reviewedReasonRequired:true,
      priorStateRetained:true,
      correctionMayDeleteOrRewritePriorReconciliation:false,
      correctionMayRewriteNorthStarOrExternalSource:false,
      correctionIdentity:null,
      correctionRevision:null,
      correctionDigest:null,
      correctedByUserId:null,
      correctedAt:null,
    }),
    authority: Object.freeze({
      requiredCapability: CAPABILITY,
      controlMode: control.mode,
      singleControlAllowed: control.singleControlAllowed,
      exactControlledActions: control.appliesTo,
      currentCapabilityGrantState:'unavailable',
      currentRecentAuthenticationState:'unavailable',
      currentMfaState:'unavailable',
      currentIndependentApprovalState:'unavailable',
      currentActionReasonState:'unavailable',
      roleAloneAuthorizesReconciliation:false,
      adapterAcknowledgementIsHumanAction:control.adapterAcknowledgementIsHumanAction,
      reconciliationAuthorized:false,
      manualResolutionMayInventAccountTaxRecognitionOrBooksClosePolicy:false,
    }),
    access: Object.freeze({
      eligiblePaidReadRoles:Object.freeze(['owner','admin']),
      currentTenantSessionRequired:true,
      currentSubscriptionRequired:true,
      tenantCrossingAllowed:false,
      customerOrPublicAccessAllowed:false,
      demoRouteAvailable:false,
    }),
    privacy: Object.freeze({
      tenantOrCustomerIdentityExposed:false,
      sourceRecordAmountCurrencyOrTimestampExposed:false,
      destinationAccountOrCompanyIdentityExposed:false,
      exportRequestOrAcknowledgementIdentityExposed:false,
      externalRecordIdentityOrValueExposed:false,
      credentialSecretOrIdempotencyKeyExposed:false,
    }),
    exactCurrentnessRevalidated:true,
    reconciliationRecordCount:0,
    reconciliationCorrectionCount:0,
    accountingMutationCount:0,
    northStarSourceMutationCount:0,
    externalRecordMutationCount:0,
    providerCallCount:0,
    receiverMutationCount:0,
    liveMoneyMovementCount:0,
  });
}

function project(raw, readiness, source, part10) {
  const expected = unavailable(readiness, source, part10);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Accounting reconciliation readiness invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, RECORD_VERSION, REASON, CAPABILITY, STATES, SIDES,
  RECORD_FIELDS, unavailable, project };
