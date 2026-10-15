'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const normalization = require('./paymentProviderEventNormalization');
const offlinePayment = require('./offlinePaymentReadiness');

const CONTRACT_VERSION = 'm27-payment-outcome-readiness-v1';
const REASON = 'financial_outcome_source_evidence_unavailable';
const WRITE_OFF_CAPABILITY = 'customer_financial.write_off.record';
const PROVIDER_OUTCOME_STATES = Object.freeze(['failed', 'canceled', 'reversed']);
const DISPUTE_OUTCOME_STATES = Object.freeze(['dispute_won', 'dispute_lost']);
const OUTCOME_AXIS_ORDER = Object.freeze([
  'paymentFailure',
  'paymentCancellation',
  'returnedOfflinePayment',
  'nsfFee',
  'disputeDeadline',
  'disputeFee',
  'disputeOutcome',
  'chargeback',
  'paymentReversal',
  'offlineReversal',
  'refundSettlement',
  'badDebtWriteOffReview',
  'reopenedBalance',
]);

function policy() {
  const launch = offlinePayment.policy();
  const team = launch.team;
  const financial = launch.financial;
  const dispute = financial.dispute;
  const writeOff = financial.writeOff;
  const refund = financial.refund;
  const control = launch.actionControl?.[WRITE_OFF_CAPABILITY];
  const requiredCodes = [
    'settlement_unavailable', 'refund_unavailable', 'dispute_action_unsupported',
    'returned_check_authority_unavailable', 'nsf_fee_unsupported',
    'automatic_payment_retry_unsupported', 'earned_revenue_policy_unavailable',
  ];
  if (team.roleAloneAuthorizes !== false ||
      !team.ownerDefaultCapabilities.includes(WRITE_OFF_CAPABILITY) ||
      !team.adminDefaultCapabilities.includes(WRITE_OFF_CAPABILITY) ||
      team.memberDefaultCapabilities.includes(WRITE_OFF_CAPABILITY) ||
      team.recentAuthSeconds !== 600 || team.mfaFreshnessSeconds !== 600 ||
      team.independentApprovalSeconds !== 600 ||
      control?.mode !== 'conditional_dual_control' ||
      control.maximumMinorUnits !== '1000000' ||
      JSON.stringify(control.singleControlAllowedWhen) !== JSON.stringify([
        'write_off_minor_units_lte_50000',
        'exact_current_balance_component',
        'no_tax_or_revenue_recognition_effect',
      ]) || JSON.stringify(control.dualControlRequiredWhen) !== JSON.stringify([
        'write_off_minor_units_gt_50000_and_lte_1000000',
      ]) || JSON.stringify(control.denyWhen) !== JSON.stringify([
        'amount_or_bound_missing',
        'any_required_balance_authority_identity_or_currentness_condition_missing',
      ]) || launch.amountPolicy.singleControlMaximums.write_off !== '50000' ||
      launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans !== true ||
      financial.supportedCurrency !== 'USD' ||
      writeOff?.maximumMinorUnitsPerAction !== '1000000' ||
      writeOff.mayChangeTaxOrRevenueRecognition !== false ||
      dispute?.authenticatedProviderEvidenceOnly !== true ||
      dispute.automaticConcessionOrEvidenceSubmission !== false ||
      dispute.blocksDestructiveCleanup !== true ||
      refund?.cardToOriginalChargeOnly !== true || refund.partialAndFullSupported !== true ||
      refund.maximumMinorUnitsPerAction !== '10000000' ||
      refund.cumulativeMaximumIsRefundableRemainder !== true ||
      refund.offlineCashReturnClaimsSupported !== false ||
      refund.checkRefundBeforeClearanceSupported !== false ||
      JSON.stringify(normalization.EVIDENCE_STATES) !== JSON.stringify([
        'created', 'authorized', 'processing', 'succeeded', 'failed', 'canceled',
        'settled', 'reversed', 'corrected',
      ]) || requiredCodes.some(code => !launch.unavailableCodes.includes(code))) {
    throw new Error('Payment-outcome policy is unavailable');
  }
  return launch;
}

function axis(axisName, state, reason, factShape) {
  return Object.freeze({ axis: axisName, state, reason, value: null,
    factShape, accepted: false });
}

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason, value: null });
}

function unavailable(sourceRaw = offlinePayment.unavailable()) {
  const source = offlinePayment.project(sourceRaw);
  const launch = policy();
  const control = launch.actionControl[WRITE_OFF_CAPABILITY];
  const offline = launch.financial.offline;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitness: Object.freeze({
      offlinePaymentReadinessVersion: source.contractVersion,
      offlinePaymentReadinessDigest: providerBoundary.digest(source),
    }),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      roleAloneAuthorizesOutcomeOrWriteOff: false,
      writeOffCapability: WRITE_OFF_CAPABILITY,
      requiredAssurance: 'recent_auth_mfa',
      maximumRecentAuthenticationSeconds: launch.team.recentAuthSeconds,
      maximumMfaFreshnessSeconds: launch.team.mfaFreshnessSeconds,
      maximumIndependentApprovalSeconds: launch.team.independentApprovalSeconds,
      currentCapabilityState: 'unavailable',
      recentAuthenticationState: 'unavailable',
      mfaState: 'unavailable',
      independentApprovalState: 'unavailable',
    }),
    axisOrder: OUTCOME_AXIS_ORDER,
    axes: Object.freeze([
      axis('paymentFailure', 'unavailable', 'provider_event_receipt_unavailable',
        'append_only_provider_fact'),
      axis('paymentCancellation', 'unavailable', 'provider_event_receipt_unavailable',
        'append_only_provider_fact'),
      axis('returnedOfflinePayment', 'returned_check_authority_unavailable',
        'returned_check_authority_unavailable', 'append_only_offline_fact'),
      axis('nsfFee', 'nsf_fee_unsupported', 'nsf_fee_unsupported', 'unsupported'),
      axis('disputeDeadline', 'unavailable', 'provider_event_receipt_unavailable',
        'append_only_provider_fact'),
      axis('disputeFee', 'unavailable', 'provider_event_receipt_unavailable',
        'append_only_provider_fact'),
      axis('disputeOutcome', 'unavailable', 'provider_event_receipt_unavailable',
        'append_only_provider_fact'),
      axis('chargeback', 'unavailable', 'provider_event_receipt_unavailable',
        'append_only_provider_fact'),
      axis('paymentReversal', 'unavailable', 'provider_event_receipt_unavailable',
        'append_only_provider_fact'),
      axis('offlineReversal', 'unavailable', 'accepted_offline_receipt_unavailable',
        'append_only_offline_fact'),
      axis('refundSettlement', 'settlement_unavailable', 'settlement_unavailable',
        'append_only_provider_fact'),
      axis('badDebtWriteOffReview', 'unavailable', 'issued_balance_unavailable',
        'append_only_human_review'),
      axis('reopenedBalance', 'unavailable', 'issued_balance_unavailable',
        'derived_projection'),
    ]),
    providerOutcomePolicy: Object.freeze({
      normalizedOutcomeStates: PROVIDER_OUTCOME_STATES,
      disputeOutcomeStates: DISPUTE_OUTCOME_STATES,
      authenticatedProviderEvidenceOnly: launch.financial.dispute.authenticatedProviderEvidenceOnly,
      exactTenantAccountModeAndObjectBindingRequired: true,
      exactProviderOccurrenceSequenceAndCurrentSnapshotRequired: true,
      duplicateReplayCorrectionDispositionRequired: true,
      arrivalOrderAuthorizesOutcome: false,
      failureOrCancellationAuthorizesRetry: false,
      automaticRetryState: 'automatic_payment_retry_unsupported',
      disputeActionState: 'dispute_action_unsupported',
      automaticConcessionOrEvidenceSubmission:
        launch.financial.dispute.automaticConcessionOrEvidenceSubmission,
      disputeBlocksDestructiveCleanup: launch.financial.dispute.blocksDestructiveCleanup,
      disputeMayAutomaticallyRefundOrWriteOff: false,
      disputeMayContactCustomer: false,
      disputeMayChangeTaxOrRecognizeRevenue: false,
      providerOutcomeMayRewritePriorEvidence: false,
    }),
    offlineOutcomePolicy: Object.freeze({
      receivedCheckState: 'check_clearance_unknown',
      returnedCheckState: 'check_returned',
      offlineReversalState: 'offline_reversed',
      acceptedReturnEvidenceClasses: offlinePayment.RETURN_SOURCES,
      acceptedReturnSourceRuntimeAvailable: false,
      returnedCheckEffect: offline.returnedCheckEffect,
      missingReturnAuthorityState: offline.returnedCheckAuthority.missingAuthorityState,
      returnReopensOnlyExactPendingAllocation:
        offline.returnedCheckAuthority.reopensOnlyExactPendingAllocation,
      nsfFeeState: 'nsf_fee_unsupported',
      returnFeeEffect: offline.returnedCheckAuthority.feeEffect,
      offlineReversalShape: offline.correctionEffect,
      offlineReversalMayClaimPhysicalCashReturn: false,
      checkUnknownMayBecomeClearedCash: false,
    }),
    refundSettlementPolicy: Object.freeze({
      originalSettledCardChargeOnly: launch.financial.refund.cardToOriginalChargeOnly,
      requestIsCompletedRefund: false,
      providerAcknowledgementIsSettlement: false,
      exactOriginalPaymentAndAllocationRequired: true,
      exactCurrentRefundableRemainderRequired: true,
      exactProviderRefundSettlementEvidenceRequired: true,
      refundSettlementState: 'settlement_unavailable',
      missingSettlementMayBecomeZero: false,
    }),
    writeOffPolicy: Object.freeze({
      requiredCapability: WRITE_OFF_CAPABILITY,
      controlMode: control.mode,
      maximumMinorUnitsPerAction: launch.financial.writeOff.maximumMinorUnitsPerAction,
      singleControlMaximumMinorUnits: launch.amountPolicy.singleControlMaximums.write_off,
      aboveSingleControlRequiresTwoDifferentCurrentHumans:
        launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans,
      exactCurrentBalanceComponentRequired: true,
      exactUsdAmountRequired: true,
      boundedReasonRequired: true,
      reviewAndFreshConfirmationRequired: true,
      appendOnlyReceiptRequired: true,
      mayChangeTaxOrRevenueRecognition:
        launch.financial.writeOff.mayChangeTaxOrRevenueRecognition,
      mayMoveProviderOrOfflineMoney: false,
      missingAmountOrBalanceMayBecomeZero: false,
    }),
    balanceProjectionPolicy: Object.freeze({
      exactAcceptedOutcomeAndOriginalAllocationRequired: true,
      failureOrCancellationAloneReopensBalance: false,
      disputeDoesNotEraseOriginalPayment: true,
      returnedCheckReopensOnlyExactPendingAllocation: true,
      refundRequestOrAcknowledgementReopensBalance: false,
      missingOutcomeMayChangeBalance: false,
      missingAmountMayBecomeZero: false,
      negativeBalanceCreditRevenueAndExpenseRemainSeparate: true,
      appendOnlyProjectionRevisionRequired: true,
    }),
    requirements: Object.freeze([
      requirement('exact_current_issued_invoice_and_balance', 'issued_balance_unavailable'),
      requirement('exact_original_payment_or_offline_receipt_and_allocation',
        'accepted_payment_evidence_unavailable'),
      requirement('authenticated_normalized_provider_outcome_event',
        'provider_event_receipt_unavailable'),
      requirement('exact_provider_account_mode_object_and_tenant_binding',
        'provider_account_mode_unavailable'),
      requirement('provider_occurrence_sequence_and_current_snapshot',
        'provider_reconciliation_unavailable'),
      requirement('duplicate_replay_correction_and_prior_effect_disposition',
        'provider_reconciliation_unavailable'),
      requirement('exact_dispute_deadline_fee_currency_and_outcome',
        'provider_event_receipt_unavailable'),
      requirement('exact_returned_check_source_code_time_and_digest',
        'returned_check_authority_unavailable'),
      requirement('exact_refund_request_acknowledgement_and_settlement_lineage',
        'settlement_unavailable'),
      requirement('current_write_off_capability', 'capability_required'),
      requirement('server_owned_recent_authentication_fact', 'recent_auth_required'),
      requirement('accepted_mfa_ceremony', 'mfa_required'),
      requirement('exact_bounded_write_off_amount_and_currency', 'amount_limit_exceeded'),
      requirement('bounded_immutable_write_off_reason', 'human_review_required'),
      requirement('different_current_human_approval_when_policy_requires',
        'dual_control_unavailable'),
      requirement('append_only_outcome_identity_time_and_source_digest',
        'source_authority_unavailable'),
      requirement('outcome_specific_reopened_balance_projection',
        'issued_balance_unavailable'),
    ]),
    projection: Object.freeze({
      issuedInvoiceIdentity: null,
      issuedInvoiceVersionDigest: null,
      originalPaymentIdentity: null,
      originalOfflineReceiptIdentity: null,
      originalAllocationIdentity: null,
      originalBalanceMinorUnits: null,
      failureState: 'unavailable',
      cancellationState: 'unavailable',
      returnedOfflinePaymentState: 'returned_check_authority_unavailable',
      nsfFeeState: 'nsf_fee_unsupported',
      disputeActionState: 'dispute_action_unsupported',
      disputeDeadlineState: 'unavailable',
      disputeFeeState: 'unavailable',
      disputeOutcomeState: 'unavailable',
      chargebackState: 'unavailable',
      reversalState: 'unavailable',
      offlineReversalState: 'unavailable',
      refundSettlementState: 'settlement_unavailable',
      writeOffReviewState: 'unavailable',
      reopenedBalanceState: 'unavailable',
      outcomeIdentity: null,
      outcomeOccurredAt: null,
      outcomeAcceptedAt: null,
      outcomeAmountMinorUnits: null,
      outcomeCurrency: null,
      providerFeeMinorUnits: null,
      writeOffAmountMinorUnits: null,
      reopenedBalanceMinorUnits: null,
      projectionRevision: null,
      projectionDigest: null,
    }),
    authority: Object.freeze({
      providerOutcomeAccepted: false,
      paymentFailureRecorded: false,
      paymentCancellationRecorded: false,
      returnedOfflinePaymentRecorded: false,
      nsfFeeAuthorized: false,
      disputeOutcomeRecorded: false,
      chargebackRecorded: false,
      paymentReversalRecorded: false,
      offlineReversalRecorded: false,
      refundSettlementRecorded: false,
      writeOffReviewAuthorized: false,
      writeOffRecorded: false,
      reopenedBalanceAuthorized: false,
      invoiceBalanceMutationAuthorized: false,
      providerMutationAuthorized: false,
      customerContactAuthorized: false,
      accountingMutationAuthorized: false,
      taxMutationAuthorized: false,
      revenueRecognitionAuthorized: false,
    }),
    privacy: Object.freeze({
      issuedInvoiceIdentityExposed: false,
      paymentOrReceiptIdentityExposed: false,
      providerEventOrObjectIdentityExposed: false,
      providerAccountIdentityExposed: false,
      customerIdentityExposed: false,
      actorIdentityExposed: false,
      amountOrFeeExposed: false,
      disputeOrReturnEvidenceExposed: false,
      writeOffReasonExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    outcomeRowCount: 0,
    disputeRowCount: 0,
    returnedOfflinePaymentRowCount: 0,
    offlineReversalRowCount: 0,
    refundSettlementRowCount: 0,
    writeOffReviewRowCount: 0,
    balanceProjectionRowCount: 0,
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
    throw new Error('Payment-outcome readiness boundary invalid');
  }
  return expected;
}

function projectWithSource(raw, source) {
  const expected = unavailable(source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment-outcome readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, WRITE_OFF_CAPABILITY,
  PROVIDER_OUTCOME_STATES, DISPUTE_OUTCOME_STATES, OUTCOME_AXIS_ORDER,
  policy, unavailable, project, projectWithSource };
