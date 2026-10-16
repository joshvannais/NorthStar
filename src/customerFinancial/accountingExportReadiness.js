'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const accountingExport = require('./accountingExportContract');

const CONTRACT_VERSION = 'm27-accounting-export-readiness-v1';
const DESTINATION_SELECTION_VERSION = 'm27-accounting-destination-selection-v1';
const MAPPING_REVIEW_VERSION = 'm27-accounting-mapping-review-v1';
const PREVIEW_VERSION = 'm27-accounting-export-preview-v1';
const TRANSMISSION_VERSION = 'm27-accounting-export-transmission-v1';
const ACKNOWLEDGEMENT_VERSION = 'm27-accounting-export-acknowledgement-v1';
const PARTIAL_FAILURE_VERSION = 'm27-accounting-export-partial-failure-v1';
const REASON = 'accounting_destination_and_export_authority_unavailable';
const DESTINATION_FIELDS = Object.freeze([
  'destinationSelectionVersion','adapter','mode','destinationAccountId',
  'destinationCompanyId','selectedByOwnerUserId','selectedAt','selectionRevision',
  'selectionDigest',
]);
const MAPPING_FIELDS = Object.freeze([
  'mappingReviewVersion','factType','destinationAccountId','destinationTaxCodeId',
  'mappingRevision','mappingDigest','reviewedByUserId','reviewedAt',
]);
const PREVIEW_FIELDS = Object.freeze([
  'previewVersion','destinationSelectionDigest','mappingReviewDigest','sourceFactDigest',
  'recordCount','absoluteMinorUnits','currency','previewRevision','previewDigest','preparedAt',
]);
const TRANSMISSION_FIELDS = Object.freeze([
  'transmissionVersion','previewDigest','requestId','requestDigest','idempotencyKeyDigest',
  'requestedByUserId','requestedAt','recordCount','absoluteMinorUnits','currency',
]);
const ACKNOWLEDGEMENT_FIELDS = Object.freeze([
  'acknowledgementVersion','adapter','mode','destinationAccountId','transmissionRequestId',
  'transmissionRequestDigest','externalBatchId','receivedAt','status','acceptedRecordCount',
  'rejectedRecordCount','uncertainRecordCount','receiptDigest',
]);
const PARTIAL_FAILURE_DISPOSITIONS = Object.freeze([
  'accepted','rejected','retryable','uncertain','duplicate_confirmed','unavailable',
]);
const PARTIAL_FAILURE_FIELDS = Object.freeze([
  'partialFailureVersion','sourceRecordId','sourceRevision','sourceDigest',
  'transmissionRequestId','disposition','externalRecordId','errorCode','retryAfter',
  'recordedAt','dispositionDigest',
]);

function mappingEntries(source) {
  return source.factClasses.map(item => Object.freeze({
    factType: item.factType,
    state: 'unavailable',
    reason: 'accounting_mapping_review_unavailable',
    value: null,
    destinationAccountId: null,
    destinationTaxCodeId: null,
    mappingRevision: null,
    mappingDigest: null,
    reviewedByUserId: null,
    reviewedAt: null,
  }));
}

function unavailable(sourceRaw, part10Raw, expectedMode = 'paid') {
  let source;
  try { source = accountingExport.project(sourceRaw, part10Raw, expectedMode); }
  catch (_error) { throw new Error('Accounting export source contract invalid'); }
  const control = providerBoundary.validateLaunchPolicy()
    .actionControl[accountingExport.CAPABILITY];
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitness: Object.freeze({
      contractVersion: source.contractVersion,
      state: source.state,
      reason: source.reason,
      digest: providerBoundary.digest(source),
    }),
    destination: Object.freeze({
      contractVersion: DESTINATION_SELECTION_VERSION,
      exactFields: DESTINATION_FIELDS,
      state: 'unavailable',
      reason: 'accounting_destination_selection_unavailable',
      value: null,
      launchAdapter: source.adapterBoundary.configuredAdapter,
      launchMode: source.adapterBoundary.supportedMode,
      runtimeAvailable: source.adapterBoundary.runtimeAvailable,
      ownerSelectionRequired: true,
      selectionEligibleRoles: Object.freeze(['owner']),
      administratorMaySelectDestination: false,
      roleAloneAuthorizesSelectionOrTransmission: false,
      selectedAdapter: null,
      selectedMode: null,
      destinationAccountId: null,
      destinationCompanyId: null,
      selectedByOwnerUserId: null,
      selectedAt: null,
      selectionRevision: null,
      selectionDigest: null,
    }),
    mappingReview: Object.freeze({
      contractVersion: MAPPING_REVIEW_VERSION,
      exactFields: MAPPING_FIELDS,
      state: 'unavailable',
      reason: 'accounting_mapping_review_unavailable',
      value: null,
      factClassOrder: Object.freeze(source.factClasses.map(item => item.factType)),
      mappings: Object.freeze(mappingEntries(source)),
      everyFactClassRequiresExplicitMappingDisposition: true,
      everyMappingRequiresExactDestinationAccountIdentity: true,
      exactDestinationSelectionDigestRequired: true,
      exactSourceFactContractAndDigestRequired: true,
      ownerReviewRequired: true,
      callerAuthoredOrInferredMappingAccepted: false,
      chartOfAccountsMayBeInvented: false,
      journalClassificationMayBeInvented: false,
      taxOrRecognitionPolicyMayBeInvented: false,
      mappingCount: null,
      mappingRevision: null,
      mappingDigest: null,
      reviewedByUserId: null,
      reviewedAt: null,
    }),
    preview: Object.freeze({
      contractVersion: PREVIEW_VERSION,
      exactFields: PREVIEW_FIELDS,
      state: 'unavailable',
      reason: 'accounting_export_preview_unavailable',
      value: null,
      exactCurrentDestinationSelectionRequired: true,
      exactCurrentMappingReviewRequired: true,
      exactCurrentSourceFactsRequired: true,
      destinationSelectionDigest: null,
      mappingReviewDigest: null,
      sourceFactDigest: null,
      recordCount: 0,
      absoluteMinorUnits: null,
      currency: null,
      previewRevision: null,
      previewDigest: null,
      preparedAt: null,
      missingAmountCurrencyMappingOrSourceMayBecomeZeroOrCurrent: false,
      previewMayAuthorizeTransmission: false,
    }),
    transmission: Object.freeze({
      contractVersion: TRANSMISSION_VERSION,
      exactFields: TRANSMISSION_FIELDS,
      state: 'unavailable',
      reason: 'accounting_export_transmission_unavailable',
      value: null,
      requiredCapability: accountingExport.CAPABILITY,
      controlMode: control.mode,
      currentCapabilityGrantState: 'unavailable',
      currentRecentAuthenticationState: 'unavailable',
      currentMfaState: 'unavailable',
      currentIndependentApprovalState: 'unavailable',
      currentActionReasonState: 'unavailable',
      currentReceivingAdapterState: 'unavailable',
      exactCurrentPreviewRequired: true,
      selectionAndMappingReviewDoNotAuthorizeTransmission: true,
      transmissionAuthorized: false,
      requestId: null,
      requestDigest: null,
      idempotencyKeyDigest: null,
      requestedByUserId: null,
      requestedAt: null,
      requestedRecordCount: 0,
      requestedAbsoluteMinorUnits: null,
      requestedCurrency: null,
      maximumRecords: control.maximumRecords,
      maximumAbsoluteMinorUnits: control.maximumMinorUnits,
      singleControlMaximumRecords: source.bounds.singleControlMaximumRecords,
      singleControlMaximumAbsoluteMinorUnits:
        source.bounds.singleControlMaximumAbsoluteMinorUnits,
      largerInBoundsExportRequiresTwoDifferentCurrentHumans:
        source.bounds.largerInBoundsExportRequiresTwoDifferentCurrentHumans,
      missingRecordCountAmountBoundFactSetAdapterIdentityCurrentnessOrControlDenies: true,
      sameKeyChangedRequestConflicts: true,
      exactReplayReturnsSameImmutableReceipt: true,
      uncertainResultRequiresOriginalReceiptLookupBeforeRetry: true,
      retryMayWidenOriginalRecordSetAmountOrDestination: false,
      duplicateTransmissionMayRepeatExternalEffect: false,
    }),
    acknowledgement: Object.freeze({
      contractVersion: ACKNOWLEDGEMENT_VERSION,
      exactFields: ACKNOWLEDGEMENT_FIELDS,
      state: 'unavailable',
      reason: 'accounting_export_acknowledgement_unavailable',
      value: null,
      receiptIdentity: null,
      receiptDigest: null,
      immutable: true,
      sameRequestMayHaveOneCanonicalReceipt: true,
      exactDestinationAdapterAndRequestRequired: true,
      exactPerRecordDispositionCountsRequired: true,
      uncertainReceiptStateMayBecomeSuccessOrFailureWithoutLookup: false,
      adapterAcknowledgementIsHumanApproval: false,
      acknowledgementMayRewriteNorthStarSource: false,
      acknowledgementMaySupplyPaymentSettlementOrCheckClearance: false,
      acknowledgementMaySupplyTaxRecognitionOrBooksCloseAuthority: false,
    }),
    partialFailure: Object.freeze({
      contractVersion: PARTIAL_FAILURE_VERSION,
      exactFields: PARTIAL_FAILURE_FIELDS,
      exactDispositionStates: PARTIAL_FAILURE_DISPOSITIONS,
      state: 'unavailable',
      reason: 'accounting_export_partial_failure_evidence_unavailable',
      value: null,
      acceptedRecordCount: null,
      rejectedRecordCount: null,
      retryableRecordCount: null,
      uncertainRecordCount: null,
      missingCountsMayBecomeZero: false,
      partialAcknowledgementMayBecomeWholeBatchSuccess: false,
      acceptedRecordsMayBeRetransmittedWithoutExactDuplicateProof: false,
      retryRestrictedToExactFailedSubset: true,
      uncertainRecordsRequireReceiptLookupBeforeRetry: true,
      everyDispositionRequiresOriginalSourceAndRequestPins: true,
      oneRecordFailureMayRewriteAcceptedSourceOrDestinationMapping: false,
    }),
    access: Object.freeze({
      eligiblePaidReadRoles: Object.freeze(['owner','admin']),
      currentTenantSessionRequired: true,
      currentSubscriptionRequired: true,
      tenantCrossingAllowed: false,
      customerOrPublicAccessAllowed: false,
      demoRouteAvailable: false,
    }),
    privacy: Object.freeze({
      tenantIdentityExposed: false,
      customerIdentityExposed: false,
      sourceRecordOrAmountExposed: false,
      destinationAccountOrCompanyIdentityExposed: false,
      externalRecordOrBatchIdentityExposed: false,
      credentialSecretOrIdempotencyKeyExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    destinationSelectionCount: 0,
    mappingReviewCount: 0,
    exportPreviewCount: 0,
    transmissionCount: 0,
    acknowledgementCount: 0,
    partialFailureRecordCount: 0,
    accountingMutationCount: 0,
    providerCallCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, source, part10, expectedMode = 'paid') {
  const expected = unavailable(source, part10, expectedMode);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Accounting export readiness invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, DESTINATION_SELECTION_VERSION, MAPPING_REVIEW_VERSION,
  PREVIEW_VERSION, TRANSMISSION_VERSION, ACKNOWLEDGEMENT_VERSION, PARTIAL_FAILURE_VERSION,
  REASON, DESTINATION_FIELDS, MAPPING_FIELDS, PREVIEW_FIELDS, TRANSMISSION_FIELDS,
  ACKNOWLEDGEMENT_FIELDS, PARTIAL_FAILURE_DISPOSITIONS, PARTIAL_FAILURE_FIELDS,
  unavailable, project };
