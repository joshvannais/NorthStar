'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const part10Contract = require('./collectionPart10Acceptance');
const exportContract = require('./accountingExportContract');
const exportReadiness = require('./accountingExportReadiness');
const reconciliation = require('./accountingReconciliationReadiness');

const CONTRACT_VERSION = 'm27-accounting-part11-acceptance-v1';
const BUNDLE_VERSION = 'm27-accounting-part11-preview-bundle-v1';
const RETENTION_HOLD_VERSION = 'm27-accounting-retention-hold-v1';
const ADAPTER_LIFECYCLE_VERSION = 'm27-accounting-adapter-lifecycle-v1';
const REASON = 'part11_accounting_evidence_unavailable';
const SOURCE_PARTS = Object.freeze([
  Object.freeze({ part:'11A', contractVersion:exportContract.CONTRACT_VERSION,
    state:'unavailable', reason:exportContract.REASON }),
  Object.freeze({ part:'11B', contractVersion:exportReadiness.CONTRACT_VERSION,
    state:'unavailable', reason:exportReadiness.REASON }),
  Object.freeze({ part:'11C', contractVersion:reconciliation.CONTRACT_VERSION,
    state:'unavailable', reason:reconciliation.REASON }),
]);
const HOLD_PURPOSES = Object.freeze([
  'legal','tax','accounting','provider','security',
]);
const ADAPTER_LIFECYCLE_STATES = Object.freeze([
  'connection_unavailable','disconnect_unavailable','regrant_unavailable',
]);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function derive(part10Raw, mode) {
  const part10 = part10Contract.projectBundle(part10Raw, mode);
  const source = exportContract.project(exportContract.unavailable(part10, mode), part10, mode);
  const readiness = exportReadiness.project(
    exportReadiness.unavailable(source, part10, mode), source, part10, mode);
  const reconciled = reconciliation.project(
    reconciliation.unavailable(readiness, source, part10, mode),
    readiness, source, part10, mode);
  return { part10, source, readiness, reconciliation:reconciled };
}

function sourceParts(values) {
  return SOURCE_PARTS.map((expected,index) => Object.freeze({
    part:expected.part,
    contractVersion:expected.contractVersion,
    state:expected.state,
    reason:expected.reason,
    digest:providerBoundary.digest(values[index]),
  }));
}

function unavailable(mode, part10Raw, sourcesRaw) {
  if (!['paid','demo'].includes(mode)) throw new Error('Accounting Part 11 mode invalid');
  const derived = sourcesRaw || derive(part10Raw, mode);
  const part10 = part10Contract.projectBundle(derived.part10 || part10Raw, mode);
  const source = exportContract.project(derived.source, part10, mode);
  const readiness = exportReadiness.project(derived.readiness, source, part10, mode);
  const reconciled = reconciliation.project(
    derived.reconciliation, readiness, source, part10, mode);
  const policy = providerBoundary.validateLaunchPolicy();
  const financial = policy.financial;
  const accounting = financial.accounting;
  const tax = financial.tax;
  const retention = policy.retention;
  const professional = policy.professionalReviews;
  const previewWitness = part10.part10Acceptance.previewWitness;
  return Object.freeze({
    contractVersion:CONTRACT_VERSION,
    policyVersion:providerBoundary.POLICY_VERSION,
    policyDigest:providerBoundary.POLICY_DIGEST,
    state:'unavailable',
    reason:REASON,
    mode,
    fictional:mode === 'demo',
    previewWitness,
    part10Witness:Object.freeze({
      contractVersion:part10.part10Acceptance.contractVersion,
      state:part10.part10Acceptance.state,
      reason:part10.part10Acceptance.reason,
      digest:providerBoundary.digest(part10.part10Acceptance),
    }),
    sourceParts:Object.freeze(sourceParts([source,readiness,reconciled])),
    taxAccountingBoundary:Object.freeze({
      state:'unavailable',
      reason:'tax_and_accounting_review_unavailable',
      value:null,
      providerTaxCalculationEnabled:tax.providerCalculationEnabled,
      exactCurrentMission24TaxDecisionRequired:tax.supportedOnlyFromExactMission24Decision,
      taxRequiredPins:Object.freeze([...tax.requiredPins]),
      filingOrNexusAuthority:tax.filingOrNexusAuthority,
      configuredAccountingAdapter:accounting.adapter,
      configuredAccountingMode:accounting.supportedMode,
      accountingRuntimeAvailable:accounting.currentRuntimeAvailable,
      accountingMayInventChartOfAccounts:accounting.mayInventChartOfAccounts,
      accountingMayDecideRecognitionOrTax:accounting.mayDecideRecognitionOrTax,
      accountingMaySupplyCheckClearance:accounting.maySupplyCheckClearance,
      legalReviewAccepted:professional.legal.accepted,
      taxReviewAccepted:professional.tax.accepted,
      accountingReviewAccepted:professional.accounting.accepted,
      providerReviewAccepted:professional.provider.accepted,
      securityReviewAccepted:professional.security.accepted,
      journalTaxFilingRevenueRecognitionOrBooksCloseAuthorized:false,
    }),
    retentionHold:Object.freeze({
      contractVersion:RETENTION_HOLD_VERSION,
      state:'unavailable',
      reason:'source_retention_unavailable',
      value:null,
      recognizedHoldPurposes:HOLD_PURPOSES,
      financialRecordCalendarYears:retention.financialRecordCalendarYears,
      immutableIdempotencyAndAuditCalendarYears:
        retention.immutableIdempotencyAndAuditCalendarYears,
      holdsSuspendEligibleDeletion:retention.holdsSuspendEligibleDeletion,
      legalTaxAccountingProviderSecurityReviewComplete:
        retention.legalTaxAccountingProviderSecurityReviewComplete,
      currentRetentionAuthorityState:'unavailable',
      currentHoldState:'unavailable',
      currentDeletionAuthorityState:'unavailable',
      requiredDeletionCapability:'customer_financial.record.delete',
      exactRecordPolicyHoldAndSourcePinsRequired:true,
      missingRetentionOrHoldStateMayAuthorizeDeletion:false,
      disconnectMayDeleteSourceExportAcknowledgementReconciliationOrAudit:false,
      holdReleaseMayRewriteOrBackdateRecord:false,
      deletionAuthorized:false,
    }),
    adapterLifecycle:Object.freeze({
      contractVersion:ADAPTER_LIFECYCLE_VERSION,
      exactStates:ADAPTER_LIFECYCLE_STATES,
      state:'unavailable',
      reason:'accounting_adapter_unavailable',
      value:null,
      configuredAdapter:accounting.adapter,
      configuredMode:accounting.supportedMode,
      runtimeAvailable:accounting.currentRuntimeAvailable,
      currentConnectionState:'unavailable',
      currentGrantState:'unavailable',
      currentDisconnectAuthorityState:'unavailable',
      currentRegrantAuthorityState:'unavailable',
      ownerActionSpecificCapabilityRequired:true,
      currentRecentAuthenticationAndMfaRequired:true,
      exactTenantAdapterModeDestinationMappingAndReasonRequired:true,
      automaticReconnectAllowed:false,
      disconnectStopsNewPreviewTransmissionAcknowledgementAndReconciliation:true,
      disconnectMayRewriteNorthStarOrExternalFacts:false,
      disconnectMayDeleteImmutableReceiptsOrAudit:false,
      priorGrantCredentialDestinationMappingOrReceiptMayBeReusedAfterDisconnect:false,
      regrantRequiresFreshReviewedAuthority:true,
      roleAloneAuthorizesDisconnectOrRegrant:false,
      disconnectAuthorized:false,
      regrantAuthorized:false,
    }),
    access:Object.freeze({
      eligiblePaidReadRoles:Object.freeze(['owner','admin']),
      currentTenantSessionRequired:true,
      currentSubscriptionRequired:true,
      roleAloneAuthorizesAccountingAction:false,
      demoPhysicallyAndLogicallyIsolated:true,
      customerOrPublicAccessAllowed:false,
      tenantCrossingAllowed:false,
    }),
    privacy:Object.freeze({
      tenantOrCustomerIdentityExposed:false,
      sourceRecordAmountCurrencyOrTimestampExposed:false,
      destinationAccountCompanyOrMappingExposed:false,
      exportRequestAcknowledgementOrExternalRecordExposed:false,
      retentionHoldOrDeletionTargetIdentityExposed:false,
      adapterCredentialSecretOrIdempotencyKeyExposed:false,
      actorApproverOrReviewerIdentityExposed:false,
    }),
    acceptance:Object.freeze({
      sourceContractsRevalidated:true,
      wholePart11FunctionalBoundaryPresent:true,
      paidDemoIsolationAccepted:true,
      taxAccountingRetentionHoldAndAdapterLifecycleBoundaryPresent:true,
      independentWholeHeadAuditAccepted:false,
      productionPerformanceSlaAccepted:false,
      firstPayingCustomerLiveMoneyValidated:false,
      founderVisualApprovalAccepted:false,
    }),
    exactCurrentnessRevalidated:true,
    exportRecordCount:0,
    destinationSelectionCount:0,
    mappingReviewCount:0,
    transmissionCount:0,
    acknowledgementCount:0,
    reconciliationRecordCount:0,
    reconciliationCorrectionCount:0,
    retentionDeletionCount:0,
    adapterConnectionMutationCount:0,
    accountingMutationCount:0,
    northStarSourceMutationCount:0,
    externalRecordMutationCount:0,
    providerCallCount:0,
    receiverMutationCount:0,
    liveMoneyMovementCount:0,
  });
}

function project(raw, mode, part10Raw, sources) {
  const expected = unavailable(mode, part10Raw, sources);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length) {
    throw new Error('Accounting Part 11 acceptance invalid');
  }
  if (sources) {
    if (JSON.stringify(raw) !== JSON.stringify(expected)) {
      throw new Error('Accounting Part 11 acceptance invalid');
    }
    return expected;
  }
  const actualComparable = JSON.parse(JSON.stringify(raw));
  const expectedComparable = JSON.parse(JSON.stringify(expected));
  if (!/^[0-9a-f]{64}$/.test(actualComparable.part10Witness?.digest || '') ||
      !Array.isArray(actualComparable.sourceParts) || actualComparable.sourceParts.length !== 3 ||
      actualComparable.sourceParts.some(value => !/^[0-9a-f]{64}$/.test(value.digest || ''))) {
    throw new Error('Accounting Part 11 acceptance invalid');
  }
  actualComparable.part10Witness.digest = expectedComparable.part10Witness.digest;
  actualComparable.sourceParts.forEach((value,index) => {
    value.digest = expectedComparable.sourceParts[index].digest;
  });
  if (JSON.stringify(actualComparable) !== JSON.stringify(expectedComparable)) {
    throw new Error('Accounting Part 11 acceptance invalid');
  }
  return raw;
}

function bundle(part10Raw, acceptance, sources) {
  const mode = part10Raw?.preview?.mode;
  const part10 = part10Contract.projectBundle(part10Raw, mode);
  const value = project(acceptance, mode, part10, sources);
  if (JSON.stringify(value.previewWitness) !==
      JSON.stringify(part10.part10Acceptance.previewWitness)) {
    throw new Error('Accounting Part 11 preview bundle currentness mismatch');
  }
  return Object.freeze({
    contractVersion:BUNDLE_VERSION,
    preview:part10.preview,
    part5Acceptance:part10.part5Acceptance,
    part6Acceptance:part10.part6Acceptance,
    part7Acceptance:part10.part7Acceptance,
    part9Acceptance:part10.part9Acceptance,
    part10Acceptance:part10.part10Acceptance,
    part11Acceptance:value,
  });
}

function projectBundle(raw, expectedMode, sources) {
  if (!exact(raw,['contractVersion','preview','part5Acceptance','part6Acceptance',
    'part7Acceptance','part9Acceptance','part10Acceptance','part11Acceptance']) ||
      raw.contractVersion !== BUNDLE_VERSION) {
    throw new Error('Accounting Part 11 preview bundle invalid');
  }
  const part10 = {
    contractVersion:part10Contract.BUNDLE_VERSION,
    preview:raw.preview,
    part5Acceptance:raw.part5Acceptance,
    part6Acceptance:raw.part6Acceptance,
    part7Acceptance:raw.part7Acceptance,
    part9Acceptance:raw.part9Acceptance,
    part10Acceptance:raw.part10Acceptance,
  };
  const value = bundle(part10,raw.part11Acceptance,sources);
  if (expectedMode && value.preview.mode !== expectedMode) {
    throw new Error('Accounting Part 11 preview bundle mode mismatch');
  }
  return value;
}

module.exports = { CONTRACT_VERSION, BUNDLE_VERSION, RETENTION_HOLD_VERSION,
  ADAPTER_LIFECYCLE_VERSION, REASON, SOURCE_PARTS, HOLD_PURPOSES,
  ADAPTER_LIFECYCLE_STATES, derive, unavailable, project, bundle, projectBundle };
