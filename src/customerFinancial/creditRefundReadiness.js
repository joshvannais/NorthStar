'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const correction = require('./invoicePostIssueCorrection');
const paymentAttempt = require('./paymentAttemptAllocationOverpayment');

const CONTRACT_VERSION = 'm27-credit-note-refund-request-readiness-v1';
const REASON = 'credit_refund_source_evidence_unavailable';
const CREDIT_CAPABILITY = 'customer_financial.invoice.correct';
const REFUND_CAPABILITY = 'customer_financial.refund.issue';

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const team = launch.team;
  const credit = launch.actionControl?.[CREDIT_CAPABILITY];
  const refund = launch.actionControl?.[REFUND_CAPABILITY];
  const refundFinancial = launch.financial?.refund;
  const amounts = launch.amountPolicy;
  if (!team.ownerDefaultCapabilities.includes(CREDIT_CAPABILITY) ||
      !team.ownerDefaultCapabilities.includes(REFUND_CAPABILITY) ||
      !team.adminDefaultCapabilities.includes(CREDIT_CAPABILITY) ||
      !team.adminDefaultCapabilities.includes(REFUND_CAPABILITY) ||
      team.memberDefaultCapabilities.includes(CREDIT_CAPABILITY) ||
      team.memberDefaultCapabilities.includes(REFUND_CAPABILITY) ||
      team.recentAuthSeconds !== 600 || team.mfaFreshnessSeconds !== 600 ||
      team.independentApprovalSeconds !== 600 ||
      credit?.mode !== 'conditional_dual_control' ||
      credit.maximumAbsoluteDeltaMinorUnits !== '2500000' ||
      JSON.stringify(credit.singleControlAllowedWhen) !== JSON.stringify([
        'absolute_delta_minor_units_lte_100000',
        'exact_current_issued_document',
        'current_mission24_authority_for_commercial_change',
      ]) || JSON.stringify(credit.dualControlRequiredWhen) !== JSON.stringify([
        'absolute_delta_minor_units_gt_100000_and_lte_2500000',
      ]) || JSON.stringify(credit.denyWhen) !== JSON.stringify([
        'amount_or_bound_missing',
        'any_required_document_commercial_authority_identity_or_currentness_condition_missing',
      ]) || refund?.mode !== 'conditional_dual_control' ||
      refund.maximumMinorUnits !== '10000000' ||
      JSON.stringify(refund.singleControlAllowedWhen) !== JSON.stringify([
        'refund_minor_units_lte_100000',
        'exact_current_settled_original_charge',
        'refund_lte_current_refundable_remainder',
      ]) || JSON.stringify(refund.dualControlRequiredWhen) !== JSON.stringify([
        'refund_minor_units_gt_100000_and_lte_10000000',
      ]) || JSON.stringify(refund.denyWhen) !== JSON.stringify([
        'amount_or_bound_missing',
        'any_required_charge_remainder_authority_identity_or_currentness_condition_missing',
      ]) || refund.dualControlSeparation !== 'requester_cannot_approve' ||
      amounts.correctionMaximumAbsoluteDeltaMinorUnits !== '2500000' ||
      amounts.singleControlMaximums.refund !== '100000' ||
      amounts.singleControlMaximums.commercial_correction_delta !== '100000' ||
      amounts.aboveSingleControlRequiresTwoDifferentCurrentHumans !== true ||
      refundFinancial?.cardToOriginalChargeOnly !== true ||
      refundFinancial.partialAndFullSupported !== true ||
      refundFinancial.maximumMinorUnitsPerAction !== '10000000' ||
      refundFinancial.cumulativeMaximumIsRefundableRemainder !== true ||
      refundFinancial.offlineCashReturnClaimsSupported !== false ||
      refundFinancial.checkRefundBeforeClearanceSupported !== false) {
    throw new Error('Credit-note and refund-request policy is unavailable');
  }
  return launch;
}

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason, value: null });
}

function unavailable(correctionRaw = correction.unavailable(),
  attemptRaw = paymentAttempt.unavailable()) {
  const correctionSource = correction.project(correctionRaw);
  const attemptSource = paymentAttempt.project(attemptRaw);
  const launch = policy();
  const creditControl = launch.actionControl[CREDIT_CAPABILITY];
  const refundControl = launch.actionControl[REFUND_CAPABILITY];
  const refundPolicy = launch.financial.refund;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitnesses: Object.freeze({
      postIssueCorrectionVersion: correctionSource.contractVersion,
      postIssueCorrectionDigest: providerBoundary.digest(correctionSource),
      paymentAttemptAllocationVersion: attemptSource.contractVersion,
      paymentAttemptAllocationDigest: providerBoundary.digest(attemptSource),
    }),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      roleAloneAuthorizesCreditOrRefund: false,
      requiredAssurance: 'recent_auth_mfa',
      maximumRecentAuthenticationSeconds: launch.team.recentAuthSeconds,
      maximumMfaFreshnessSeconds: launch.team.mfaFreshnessSeconds,
      maximumIndependentApprovalSeconds: launch.team.independentApprovalSeconds,
      recentAuthenticationState: 'unavailable',
      mfaState: 'unavailable',
      creditCapabilityState: 'unavailable',
      refundCapabilityState: 'unavailable',
    }),
    creditNotePolicy: Object.freeze({
      requiredCapability: CREDIT_CAPABILITY,
      controlMode: creditControl.mode,
      maximumAbsoluteDeltaMinorUnits: creditControl.maximumAbsoluteDeltaMinorUnits,
      singleControlMaximumMinorUnits:
        launch.amountPolicy.singleControlMaximums.commercial_correction_delta,
      aboveSingleControlRequiresTwoDifferentCurrentHumans:
        launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans,
      exactCurrentIssuedDocumentRequired: true,
      currentMission24CommercialChangeAuthorityRequired: true,
      exactRemainingBalanceRequired: true,
      exactAmountAndCurrencyRequired: true,
      boundedReasonRequired: true,
      immutableOriginalIssuedVersion: true,
      appendOnlyCreditRecordRequired: true,
      creditNoteMayImplyRefund: false,
      missingAmountOrBalanceMayBecomeZero: false,
    }),
    refundPolicy: Object.freeze({
      requiredCapability: REFUND_CAPABILITY,
      controlMode: refundControl.mode,
      maximumMinorUnitsPerAction: refundPolicy.maximumMinorUnitsPerAction,
      singleControlMaximumMinorUnits: launch.amountPolicy.singleControlMaximums.refund,
      aboveSingleControlRequiresTwoDifferentCurrentHumans:
        launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans,
      dualControlSeparation: refundControl.dualControlSeparation,
      originalCardChargeOnly: refundPolicy.cardToOriginalChargeOnly,
      partialAndFullSupported: refundPolicy.partialAndFullSupported,
      cumulativeMaximum: 'current_refundable_remainder',
      offlineCashReturnClaimsSupported: refundPolicy.offlineCashReturnClaimsSupported,
      checkRefundBeforeClearanceSupported: refundPolicy.checkRefundBeforeClearanceSupported,
      exactCurrentSettledOriginalChargeRequired: true,
      exactOriginalPaymentAndAllocationLineageRequired: true,
      exactRefundableRemainderRequired: true,
      exactAmountAndCurrencyRequired: true,
      boundedReasonRequired: true,
      idempotencyKeyAndRequestDigestRequired: true,
      providerAcknowledgementRequired: true,
      requestIsCompletedRefund: false,
      acknowledgementIsSettlement: false,
      missingAmountOrRemainderMayBecomeZero: false,
    }),
    requirements: Object.freeze([
      requirement('exact_current_immutable_issued_invoice', 'issued_invoice_unavailable'),
      requirement('exact_current_remaining_invoice_balance', 'issued_balance_unavailable'),
      requirement('current_mission24_commercial_change_authority',
        'commercial_change_authority_unavailable'),
      requirement('current_credit_or_refund_action_capability',
        'credit_refund_capability_unavailable'),
      requirement('server_owned_recent_authentication_fact', 'recent_auth_fact_unavailable'),
      requirement('accepted_mfa_ceremony', 'mfa_authority_unavailable'),
      requirement('exact_bounded_usd_amount', 'credit_refund_amount_unavailable'),
      requirement('bounded_immutable_action_reason', 'credit_refund_reason_unavailable'),
      requirement('exact_original_accepted_payment_identity',
        'accepted_payment_evidence_unavailable'),
      requirement('exact_original_payment_allocation_lineage',
        'accepted_payment_evidence_unavailable'),
      requirement('exact_current_settled_original_card_charge', 'settlement_unavailable'),
      requirement('exact_current_refundable_remainder', 'refundable_remainder_unavailable'),
      requirement('action_idempotency_key_and_exact_request_digest',
        'credit_refund_request_unavailable'),
      requirement('different_current_human_approval_when_policy_requires',
        'independent_approval_unavailable'),
      requirement('append_only_credit_note_or_refund_request_receipt',
        'credit_refund_request_unavailable'),
      requirement('provider_refund_acknowledgement', 'provider_refund_acknowledgement_unavailable'),
    ]),
    projection: Object.freeze({
      issuedInvoiceIdentity: null,
      issuedInvoiceVersionDigest: null,
      currentBalanceMinorUnits: null,
      creditNoteIdentity: null,
      creditNoteDigest: null,
      creditAmountMinorUnits: null,
      originalPaymentIdentity: null,
      originalAllocationIdentity: null,
      originalChargeIdentity: null,
      refundableRemainderMinorUnits: null,
      refundRequestIdentity: null,
      refundRequestDigest: null,
      refundAmountMinorUnits: null,
      providerRefundIdentity: null,
      providerAcknowledgementIdentity: null,
      providerAcknowledgementState: 'unavailable',
      refundSettlementState: 'unavailable',
      projectionRevision: null,
      projectionDigest: null,
    }),
    authority: Object.freeze({
      creditNoteRequestAuthorized: false,
      creditNoteRecordAuthorized: false,
      invoiceBalanceChangeAuthorized: false,
      refundReviewAuthorized: false,
      refundRequestAuthorized: false,
      providerRefundAuthorized: false,
      providerAcknowledgementRecorded: false,
      refundCompleted: false,
      refundSettled: false,
      accountingMutationAuthorized: false,
      revenueRecognitionAuthorized: false,
    }),
    privacy: Object.freeze({
      issuedInvoiceIdentityExposed: false,
      paymentIdentityExposed: false,
      allocationIdentityExposed: false,
      providerChargeIdentityExposed: false,
      providerRefundIdentityExposed: false,
      customerPrivateDataExposed: false,
      exactAmountExposed: false,
      actionReasonExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    creditNoteRowCount: 0,
    refundReviewRowCount: 0,
    refundRequestRowCount: 0,
    providerAcknowledgementRowCount: 0,
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
    throw new Error('Credit-note and refund-request readiness boundary invalid');
  }
  return expected;
}

function projectWithSources(raw, correctionSource, attemptSource) {
  const expected = unavailable(correctionSource, attemptSource);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Credit-note and refund-request readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, CREDIT_CAPABILITY, REFUND_CAPABILITY,
  policy, unavailable, project, projectWithSources };
