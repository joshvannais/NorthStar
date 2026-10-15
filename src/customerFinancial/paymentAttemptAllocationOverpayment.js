'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const initiationPlan = require('./paymentInitiationPlan');
const settlementPayout = require('./paymentSettlementPayout');

const CONTRACT_VERSION = 'm27-payment-attempt-allocation-overpayment-readiness-v1';
const REASON = 'payment_attempt_evidence_unavailable';

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const financial = launch.financial;
  const refund = financial.refund;
  if (financial.supportedCurrency !== 'USD' ||
      JSON.stringify(financial.supportedOnlineMethods) !== JSON.stringify(['card']) ||
      financial.partialProviderPayments !== false ||
      financial.multiInvoiceProviderPayments !== false ||
      refund?.cardToOriginalChargeOnly !== true ||
      refund.partialAndFullSupported !== true ||
      refund.maximumMinorUnitsPerAction !== '10000000' ||
      refund.cumulativeMaximumIsRefundableRemainder !== true ||
      refund.offlineCashReturnClaimsSupported !== false ||
      refund.checkRefundBeforeClearanceSupported !== false) {
    throw new Error('Payment-attempt allocation and overpayment policy is unavailable');
  }
  return launch;
}

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason, value: null });
}

function unavailable(planRaw = initiationPlan.unavailable(),
  settlementRaw = settlementPayout.unavailable()) {
  const plan = initiationPlan.project(planRaw);
  const settlement = settlementPayout.project(settlementRaw);
  const launch = policy();
  const refund = launch.financial.refund;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitnesses: Object.freeze({
      paymentInitiationPlanVersion: plan.contractVersion,
      paymentInitiationPlanDigest: providerBoundary.digest(plan),
      settlementPayoutReconciliationVersion: settlement.contractVersion,
      settlementPayoutReconciliationDigest: providerBoundary.digest(settlement),
    }),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      roleAloneAuthorizesAttemptOrAllocation: false,
      customerPaymentSessionCurrent: false,
      staffMaySubstituteForCustomerSession: false,
      postPaymentAllocationCreatesInitiationAuthority: false,
    }),
    launchSupport: Object.freeze({
      currency: plan.planPolicy.currency,
      method: plan.planPolicy.method,
      invoiceCount: plan.planPolicy.invoiceCount,
      supportedPlanShape: 'one_exact_full_balance_invoice',
      partialProviderPaymentsSupported: plan.planPolicy.partialProviderPaymentsSupported,
      multiInvoiceProviderPaymentsSupported:
        plan.planPolicy.multiInvoiceProviderPaymentsSupported,
      partialPaymentState: 'partial_payments_unsupported',
      multiInvoicePaymentState: 'multi_invoice_payments_unsupported',
      callerMayBroadenPlanShape: false,
    }),
    attemptPolicy: Object.freeze({
      eachAttemptRequiresDistinctProviderIdentity: true,
      eachAttemptMustBindExactAcceptedPlan: true,
      sameIdempotencyReceiptMayNotCreateSecondAttempt: true,
      duplicateOrReplayMayNotReapplyAllocation: true,
      providerAttemptMayNotExpandAcceptedAmountOrInvoiceSet: true,
      postPaymentAllocationMayNotExpandAcceptedAmountOrInvoiceSet: true,
      missingAttemptAmountOrBalanceMayNotBecomeZero: true,
      arrivalOrderIsAuthority: false,
    }),
    raceAndOverpaymentPolicy: Object.freeze({
      exactProviderOccurrenceSequenceAndCurrentSnapshotRequired: true,
      concurrentSettlementsReconciledIndividually: true,
      settledMoneyCannotBeRefusedRetroactively: true,
      settlementMayNotCreateRetroactiveInitiationAuthority: true,
      settledAmountWithinAcceptedCurrentBalanceMayApplyOnlyToExactAcceptedAllocation: true,
      amountBeyondAcceptedCurrentBalanceMayReduceAnotherInvoice: false,
      amountBeyondAcceptedCurrentBalanceBecomesRevenue: false,
      amountBeyondAcceptedCurrentBalanceDisposition: 'unapplied_credit_refund_review',
      unappliedCreditMayBeSilentlyRefunded: false,
      refundRequestMayBeTreatedAsCompletedRefund: false,
      refundMustReturnToOriginalCardCharge: refund.cardToOriginalChargeOnly,
      refundMaximumMinorUnitsPerAction: refund.maximumMinorUnitsPerAction,
      cumulativeRefundMaximum: 'refundable_remainder',
    }),
    requirements: Object.freeze([
      requirement('current_exact_launch_approved_payment_initiation_plan',
        'payment_initiation_plan_unavailable'),
      requirement('exact_accepted_amount_currency_invoice_set_and_version_digests',
        'issued_invoice_unavailable'),
      requirement('immutable_exact_initiated_allocation', 'issued_balance_unavailable'),
      requirement('current_scoped_customer_session_and_provider_checkout',
        'payment_session_unavailable'),
      requirement('unique_provider_attempt_identity_and_exact_plan_lineage',
        'provider_payment_identity_unavailable'),
      requirement('accepted_current_attempt_evidence_and_occurrence_order',
        'accepted_payment_evidence_unavailable'),
      requirement('duplicate_replay_and_idempotency_disposition',
        'provider_reconciliation_unavailable'),
      requirement('current_exact_invoice_balances_and_projection_revision',
        'issued_balance_unavailable'),
      requirement('accepted_settlement_evidence_for_each_concurrent_attempt',
        'settlement_unavailable'),
      requirement('exact_overpayment_amount_currency_and_source_lineage',
        'accepted_payment_evidence_unavailable'),
      requirement('append_only_unapplied_credit_disposition', 'refund_unavailable'),
      requirement('owner_reviewed_original_charge_refund_request', 'refund_unavailable'),
    ]),
    projection: Object.freeze({
      initiationPlanIdentity: null,
      initiationPlanDigest: null,
      invoiceSet: null,
      invoiceVersionDigests: null,
      currency: null,
      initiatedAmountMinorUnits: null,
      initiatedAllocation: null,
      attemptCount: null,
      attemptIdentities: null,
      acceptedAttemptEvidence: null,
      settledAttemptIdentities: null,
      allocatedMinorUnits: null,
      currentBalances: null,
      overpaymentMinorUnits: null,
      unappliedCreditMinorUnits: null,
      unappliedCreditIdentity: null,
      refundReviewIdentity: null,
      refundRequestIdentity: null,
      projectionRevision: null,
      projectionDigest: null,
    }),
    authority: Object.freeze({
      paymentAttemptCreationAuthorized: false,
      partialPaymentInitiationAuthorized: false,
      multiInvoicePaymentInitiationAuthorized: false,
      postPaymentAllocationAuthorized: false,
      invoiceBalanceChangeAuthorized: false,
      unappliedCreditRecordingAuthorized: false,
      refundReviewCreationAuthorized: false,
      refundRequestAuthorized: false,
      refundAuthorized: false,
      paymentSuccessRecorded: false,
      settlementRecorded: false,
      revenueRecognitionAuthorized: false,
    }),
    privacy: Object.freeze({
      rawProviderPayloadExposed: false,
      providerAttemptIdentityExposed: false,
      providerAccountIdentityExposed: false,
      customerSessionIdentityExposed: false,
      providerCredentialExposed: false,
      customerPrivateDataExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    paymentAttemptRowCount: 0,
    allocationRowCount: 0,
    unappliedCreditRowCount: 0,
    refundReviewRowCount: 0,
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
    throw new Error('Payment-attempt allocation and overpayment readiness boundary invalid');
  }
  return expected;
}

function projectWithSources(raw, plan, settlement) {
  const expected = unavailable(plan, settlement);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment-attempt allocation and overpayment readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, policy, unavailable, project, projectWithSources };
