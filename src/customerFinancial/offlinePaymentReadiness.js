'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const creditRefund = require('./creditRefundReadiness');

const CONTRACT_VERSION = 'm27-offline-payment-intake-readiness-v1';
const REASON = 'issued_invoice_allocation_unavailable';
const CAPABILITY = 'customer_financial.payment.record_offline';

const RETURN_SOURCES = Object.freeze([
  Object.freeze({
    class: 'authenticated_bank_return_event.v1',
    currentRuntimeAvailable: false,
    requires: Object.freeze([
      'same_tenant_bank_source',
      'exact_original_check_receipt_and_allocation',
      'return_code',
      'bank_occurrence_time',
      'authenticated_source_identity',
      'immutable_event_digest',
    ]),
  }),
  Object.freeze({
    class: 'owner_admin_reviewed_bank_return_notice.v1',
    currentRuntimeAvailable: false,
    requires: Object.freeze([
      'retained_bank_generated_return_notice',
      'exact_original_check_receipt_and_allocation',
      'return_code',
      'notice_date',
      'source_artifact_digest',
      'current_owner_or_admin_capability',
      'recent_mfa',
      'fresh_confirmation',
      'reason',
      'idempotency_key',
    ]),
  }),
]);

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const team = launch.team;
  const control = launch.actionControl?.[CAPABILITY];
  const amounts = launch.amountPolicy;
  const financial = launch.financial;
  const offline = financial?.offline;
  const returned = offline?.returnedCheckAuthority;
  if (!team.ownerDefaultCapabilities.includes(CAPABILITY) ||
      !team.adminDefaultCapabilities.includes(CAPABILITY) ||
      team.memberDefaultCapabilities.includes(CAPABILITY) ||
      team.recentAuthSeconds !== 600 || team.mfaFreshnessSeconds !== 600 ||
      team.independentApprovalSeconds !== 600 ||
      control?.mode !== 'conditional_dual_control' ||
      control.maximumMinorUnits !== '1000000' ||
      JSON.stringify(control.singleControlAllowedWhen) !== JSON.stringify([
        'receipt_amount_minor_units_lte_100000',
        'supported_cash_or_check_method',
        'exact_current_invoice_allocation',
        'current_evidence_authority',
      ]) || JSON.stringify(control.dualControlRequiredWhen) !== JSON.stringify([
        'receipt_amount_minor_units_gt_100000_and_lte_1000000',
      ]) || JSON.stringify(control.denyWhen) !== JSON.stringify([
        'amount_or_bound_missing',
        'any_required_method_evidence_allocation_authority_identity_or_currentness_condition_missing',
      ]) || financial.supportedCurrency !== 'USD' ||
      amounts.offlineCashMaximumMinorUnits !== '1000000' ||
      amounts.offlineCheckMaximumMinorUnits !== '1000000' ||
      amounts.singleControlMaximums.offline_cash_or_check_receipt !== '100000' ||
      amounts.aboveSingleControlRequiresTwoDifferentCurrentHumans !== true ||
      financial.numbering.receipt !== 'RCT-{tenant_monotonic_10_digit_sequence}' ||
      financial.numbering.reuseAllowed !== false || financial.numbering.gapsAllowed !== true ||
      financial.numbering.yearResetAllowed !== false ||
      offline?.cashReceiptEnabled !== true || offline.checkReceiptEnabled !== true ||
      offline.checkClearedTransitionEnabled !== false ||
      offline.checkClearanceAuthority !== 'unavailable_until_authenticated_bank_source' ||
      offline.cashEffect !==
        'accepted_offline_receipt_reduces_collectible_balance_without_provider_settlement_claim' ||
      offline.checkEffect !==
        'pending_tender_only_face_and_settled_balances_unchanged_collection_action_blocked' ||
      offline.returnedCheckEffect !==
        'authorized_return_disposition_reverses_exact_pending_tender_and_reopens_exact_collectible_allocation' ||
      offline.correctionEffect !== 'append_only_replacement_or_reversal_never_in_place' ||
      JSON.stringify(returned?.acceptedEvidenceClasses) !== JSON.stringify(RETURN_SOURCES) ||
      returned.humanAttestationAloneAccepted !== false ||
      returned.freeTextPhonePhotoOrAccountingAcknowledgementAccepted !== false ||
      returned.authorizesBankClearanceClaim !== false ||
      returned.reopensOnlyExactPendingAllocation !== true || returned.feeEffect !== 'none' ||
      returned.missingAuthorityState !== 'returned_check_authority_unavailable') {
    throw new Error('Offline-payment intake policy is unavailable');
  }
  return launch;
}

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason, value: null });
}

function unavailable(sourceRaw = creditRefund.unavailable()) {
  const source = creditRefund.project(sourceRaw);
  const launch = policy();
  const offline = launch.financial.offline;
  const control = launch.actionControl[CAPABILITY];
  const amounts = launch.amountPolicy;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitness: Object.freeze({
      creditRefundReadinessVersion: source.contractVersion,
      creditRefundReadinessDigest: providerBoundary.digest(source),
    }),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      requiredCapability: CAPABILITY,
      roleAloneAuthorizesOfflineReceipt: false,
      requiredAssurance: 'recent_auth_mfa',
      maximumRecentAuthenticationSeconds: launch.team.recentAuthSeconds,
      maximumMfaFreshnessSeconds: launch.team.mfaFreshnessSeconds,
      maximumIndependentApprovalSeconds: launch.team.independentApprovalSeconds,
      currentCapabilityState: 'unavailable',
      recentAuthenticationState: 'unavailable',
      mfaState: 'unavailable',
      independentApprovalState: 'unavailable',
    }),
    intakePolicy: Object.freeze({
      launchEnabled: true,
      currency: launch.financial.supportedCurrency,
      supportedMethods: Object.freeze(['cash', 'check']),
      oneOrMoreCurrentIssuedInvoicesSupported: true,
      controlMode: control.mode,
      maximumCashMinorUnits: amounts.offlineCashMaximumMinorUnits,
      maximumCheckMinorUnits: amounts.offlineCheckMaximumMinorUnits,
      singleControlMaximumMinorUnits:
        amounts.singleControlMaximums.offline_cash_or_check_receipt,
      aboveSingleControlRequiresTwoDifferentCurrentHumans:
        amounts.aboveSingleControlRequiresTwoDifferentCurrentHumans,
      missingAmountOrAllocationMayBecomeZero: false,
      dualControlMayRepairMissingEvidenceOrAuthority: false,
    }),
    receiptContract: Object.freeze({
      exactTenantRequired: true,
      exactCurrentIssuedInvoiceVersionsRequired: true,
      exactCurrentCollectibleBalancesRequired: true,
      exactAllocationEqualToReceiptAmountRequired: true,
      exactAmountCurrencyAndMethodRequired: true,
      humanAttestedOccurrenceTimeRequired: true,
      immutableServerAcceptanceTimeRequired: true,
      currentActorRequired: true,
      boundedEvidenceOrReferenceRequired: true,
      boundedReasonRequired: true,
      idempotencyKeyAndExactRequestDigestRequired: true,
      duplicateDetectionRequired: true,
      immutableSourceDigestRequired: true,
      reviewBeforeExplicitConfirmationRequired: true,
      serverAssignedReceiptNumberPattern: launch.financial.numbering.receipt,
      appendOnly: true,
      inPlaceEditAllowed: false,
      correctionShape: offline.correctionEffect,
    }),
    cashSemantics: Object.freeze({
      acceptedState: 'offline_received',
      effect: offline.cashEffect,
      reducesOnlyExactCollectibleAllocation: true,
      providerAuthorizationClaimed: false,
      providerCaptureClaimed: false,
      providerSettlementClaimed: false,
      payoutClaimed: false,
      bankDepositClaimed: false,
      accountingAcknowledgementClaimed: false,
      earnedRevenueClaimed: false,
      physicalCashReturnClaimedByReversal: false,
    }),
    checkSemantics: Object.freeze({
      acceptedState: 'check_clearance_unknown',
      effect: offline.checkEffect,
      pendingTenderOnly: true,
      invoiceFaceValueChanges: false,
      settledBalanceChanges: false,
      paidBalanceChanges: false,
      collectionBlockedForExactPendingAllocation: true,
      clearedTransitionEnabled: offline.checkClearedTransitionEnabled,
      clearanceAuthority: offline.checkClearanceAuthority,
      humanAttestationMayClaimClearance: false,
      accountingAcknowledgementMayClaimClearance: false,
      customerReceiptCopy: 'check received — clearance unknown',
    }),
    returnedCheckPolicy: Object.freeze({
      returnedState: 'check_returned',
      effect: offline.returnedCheckEffect,
      acceptedEvidenceClasses: RETURN_SOURCES,
      humanAttestationAloneAccepted: false,
      freeTextPhonePhotoOrAccountingAcknowledgementAccepted: false,
      authorizesBankClearanceClaim: false,
      reopensOnlyExactPendingAllocation: true,
      feeEffect: 'none',
      missingAuthorityState: 'returned_check_authority_unavailable',
      returnProcessingOwnedByPart9E: true,
    }),
    requirements: Object.freeze([
      requirement('exact_current_issued_invoice_versions', 'issued_invoice_unavailable'),
      requirement('exact_current_collectible_balances_and_projection_revision',
        'issued_balance_unavailable'),
      requirement('exact_tenant_and_current_owner_or_administrator',
        'offline_receipt_actor_unavailable'),
      requirement('current_offline_payment_recording_capability', 'capability_required'),
      requirement('server_owned_recent_authentication_fact', 'recent_auth_required'),
      requirement('accepted_mfa_ceremony', 'mfa_required'),
      requirement('supported_cash_or_check_method', 'offline_payment_method_unavailable'),
      requirement('exact_usd_amount_within_method_ceiling',
        'offline_payment_amount_unavailable'),
      requirement('immutable_exact_invoice_allocation_equal_to_receipt_amount',
        'offline_payment_allocation_unavailable'),
      requirement('human_attested_occurrence_time', 'offline_payment_occurrence_unavailable'),
      requirement('server_owned_immutable_acceptance_time',
        'offline_payment_acceptance_unavailable'),
      requirement('bounded_evidence_or_reference', 'offline_payment_evidence_unavailable'),
      requirement('bounded_immutable_reason', 'offline_payment_reason_unavailable'),
      requirement('immutable_source_digest', 'offline_payment_source_unavailable'),
      requirement('idempotency_key_and_exact_request_digest',
        'offline_payment_request_unavailable'),
      requirement('duplicate_disposition', 'offline_payment_request_unavailable'),
      requirement('different_current_human_approval_when_policy_requires',
        'independent_approval_unavailable'),
      requirement('explicit_review_and_confirmation', 'offline_payment_review_unavailable'),
      requirement('append_only_server_assigned_receipt_identity',
        'offline_payment_receipt_unavailable'),
    ]),
    projection: Object.freeze({
      issuedInvoiceSet: null,
      issuedInvoiceVersionDigests: null,
      currentCollectibleBalances: null,
      currentBalanceProjectionRevision: null,
      method: null,
      currency: null,
      amountMinorUnits: null,
      allocation: null,
      occurrenceAt: null,
      acceptedAt: null,
      evidenceReference: null,
      evidenceDigest: null,
      reason: null,
      actorIdentity: null,
      idempotencyReceiptIdentity: null,
      receiptIdentity: null,
      receiptNumber: null,
      receiptDigest: null,
      cashState: 'unavailable',
      checkState: 'unavailable',
      checkClearanceState: 'unavailable',
      replacementReceiptIdentity: null,
      reversalReceiptIdentity: null,
      returnedCheckIdentity: null,
      projectionRevision: null,
      projectionDigest: null,
    }),
    authority: Object.freeze({
      offlineReceiptReviewAuthorized: false,
      offlineReceiptAcceptanceAuthorized: false,
      cashReceiptRecordingAuthorized: false,
      checkReceiptRecordingAuthorized: false,
      invoiceCollectibleBalanceChangeAuthorized: false,
      pendingTenderRecordingAuthorized: false,
      checkClearedTransitionAuthorized: false,
      returnedCheckRecordingAuthorized: false,
      replacementAuthorized: false,
      reversalAuthorized: false,
      providerPaymentRecorded: false,
      providerSettlementRecorded: false,
      bankClearanceRecorded: false,
      accountingMutationAuthorized: false,
      revenueRecognitionAuthorized: false,
    }),
    privacy: Object.freeze({
      issuedInvoiceIdentityExposed: false,
      customerIdentityExposed: false,
      actorIdentityExposed: false,
      amountOrAllocationExposed: false,
      evidenceReferenceExposed: false,
      reasonExposed: false,
      bankSourceIdentityExposed: false,
      providerIdentityExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    offlineReceiptRowCount: 0,
    offlineReceiptCorrectionRowCount: 0,
    returnedCheckRowCount: 0,
    invoiceBalanceMutationCount: 0,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Offline-payment intake readiness boundary invalid');
  }
  return expected;
}

function projectWithSource(raw, source) {
  const expected = unavailable(source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Offline-payment intake readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, CAPABILITY, RETURN_SOURCES,
  policy, unavailable, project, projectWithSource };
