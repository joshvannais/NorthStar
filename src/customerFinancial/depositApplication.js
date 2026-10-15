'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const invoiceDraftOrigin = require('./invoiceDraftOrigin');
const paymentAttempt = require('./paymentAttemptAllocationOverpayment');
const money = require('./exactMoney');

const CONTRACT_VERSION = 'm27-deposit-application-readiness-v1';
const REASON = 'deposit_payment_evidence_unavailable';

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const deposit = launch.financial?.deposit;
  const preWork = launch.billableWork?.preWorkDeposit;
  const milestone = launch.billableWork?.milestoneOrProgress;
  const earned = launch.billableWork?.earnedRevenue;
  if (!deposit || deposit.enabled !== true ||
      deposit.requiresExactMission24Schedule !== true ||
      deposit.maximumBasisPoints !== 5000 || deposit.maximumMinorUnits !== '2500000' ||
      deposit.separateInvoiceRequired !== true ||
      launch.financial.progressBilling !== false ||
      launch.financial.milestoneBilling !== false ||
      preWork?.supported !== true || preWork.completionEvidenceRequired !== false ||
      JSON.stringify(preWork.requires) !== JSON.stringify([
        'exact_current_mission24_accepted_deposit_schedule',
        'explicit_capability_authorized_human_review',
      ]) || milestone?.supported !== false ||
      milestone.missingAuthority !== 'separately_accepted_mission23_work_package_source' ||
      earned?.currentAuthorityAvailable !== false ||
      earned.invoicePaymentOrCompletionCanDecide !== false ||
      earned.state !== 'earned_revenue_policy_unavailable') {
    throw new Error('Deposit-application policy is unavailable');
  }
  return launch;
}

function unavailableOrigin() {
  return Object.freeze({
    contractVersion: invoiceDraftOrigin.CONTRACT_VERSION,
    state: 'unavailable',
    reason: 'deposit_schedule_unavailable',
    value: null,
    sourceCurrent: false,
    invoiceAuthorized: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
  });
}

function normalizedOrigin(raw) {
  return raw?.state === 'unavailable' ? invoiceDraftOrigin.unavailable(raw) :
    invoiceDraftOrigin.project(raw);
}

function depositScheduleCurrent(raw) {
  const origin = normalizedOrigin(raw);
  if (origin.state === 'unavailable' || origin.state !== 'current') return false;
  const depositLines = origin.lines.filter(line => line.kind === 'mission24_accepted_deposit');
  if (depositLines.length === 0) return false;
  if (origin.lines.length !== 1 || depositLines.length !== 1 ||
      depositLines[0].quantity.unit !== 'accepted_deposit') {
    throw new Error('Deposit invoice origin is invalid');
  }
  const amount = money.verify(depositLines[0].lineAmount);
  const subtotal = money.verify(origin.subtotalBeforeTax);
  if (amount.minorUnits !== subtotal.minorUnits || BigInt(amount.minorUnits) <= 0n ||
      BigInt(amount.minorUnits) > 2500000n) {
    throw new Error('Deposit schedule amount is outside the frozen launch boundary');
  }
  return true;
}

function requirement(name, current, unavailableReason) {
  return Object.freeze({
    requirement: name,
    state: current ? 'current' : 'unavailable',
    reason: current ? null : unavailableReason,
    value: null,
  });
}

function unavailable(originRaw = unavailableOrigin(), attemptRaw = paymentAttempt.unavailable()) {
  const origin = normalizedOrigin(originRaw);
  const attempt = paymentAttempt.project(attemptRaw);
  const launch = policy();
  const currentDepositSchedule = depositScheduleCurrent(origin);
  const deposit = launch.financial.deposit;
  const milestone = launch.billableWork.milestoneOrProgress;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitnesses: Object.freeze({
      invoiceDraftOriginVersion: invoiceDraftOrigin.CONTRACT_VERSION,
      invoiceDraftOriginDigest: providerBoundary.digest(origin),
      paymentAttemptAllocationVersion: paymentAttempt.CONTRACT_VERSION,
      paymentAttemptAllocationDigest: providerBoundary.digest(attempt),
    }),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      roleAloneAuthorizesDepositApplication: false,
      explicitCapabilityAuthorizedHumanReviewRequired: true,
      staffMaySubstituteForAcceptedPaymentEvidence: false,
      completionEvidenceRequiredForPreWorkDeposit: false,
      completionEvidenceMaySubstituteForPaymentReceipt: false,
    }),
    depositPolicy: Object.freeze({
      launchSupported: deposit.enabled,
      exactCurrentMission24ScheduleRequired: deposit.requiresExactMission24Schedule,
      maximumBasisPoints: deposit.maximumBasisPoints,
      maximumMinorUnits: deposit.maximumMinorUnits,
      separateInvoiceRequired: deposit.separateInvoiceRequired,
      scheduleCurrent: currentDepositSchedule,
      scheduleIsPaymentReceipt: false,
      acceptedNativeDepositPaymentReceiptRequired: true,
      exactReceiptScheduleAndInvoiceLineageRequired: true,
      applyExactlyOnce: true,
      missingReceiptAmountOrFinalBalanceMayBecomeZero: false,
      finalBalanceMayDoubleCountDeposit: false,
      paymentApplicationMayClaimJobCompletion: false,
    }),
    unsupportedApplication: Object.freeze({
      progressBillingSupported: launch.financial.progressBilling,
      milestoneBillingSupported: launch.financial.milestoneBilling,
      milestoneOrProgressSourceAuthorityAvailable: milestone.supported,
      missingAuthority: milestone.missingAuthority,
      depositScheduleMayAuthorizeMilestoneOrProgressApplication: false,
      earnedRevenueAuthorityAvailable: launch.billableWork.earnedRevenue.currentAuthorityAvailable,
      invoicePaymentOrCompletionCanDecideEarnedRevenue:
        launch.billableWork.earnedRevenue.invoicePaymentOrCompletionCanDecide,
    }),
    requirements: Object.freeze([
      requirement('exact_current_mission24_accepted_deposit_schedule', currentDepositSchedule,
        'deposit_schedule_unavailable'),
      requirement('explicit_capability_authorized_human_review', currentDepositSchedule,
        'deposit_schedule_review_unavailable'),
      requirement('separate_current_deposit_invoice', false, 'issued_deposit_invoice_unavailable'),
      requirement('accepted_native_deposit_payment_receipt', false,
        'accepted_deposit_payment_evidence_unavailable'),
      requirement('exact_receipt_schedule_and_invoice_lineage', false,
        'accepted_deposit_payment_evidence_unavailable'),
      requirement('exact_currency_and_amount_within_schedule_and_launch_bounds', false,
        'accepted_deposit_payment_evidence_unavailable'),
      requirement('current_part9a_duplicate_race_and_allocation_disposition', false,
        'payment_attempt_evidence_unavailable'),
      requirement('exactly_once_deposit_application_identity_and_idempotency', false,
        'deposit_application_receipt_unavailable'),
      requirement('exact_final_balance_carry_forward_without_double_counting', false,
        'issued_balance_unavailable'),
      requirement('accepted_mission23_milestone_or_work_package_source', false,
        milestone.missingAuthority),
    ]),
    projection: Object.freeze({
      depositScheduleIdentity: null,
      depositScheduleDigest: null,
      depositInvoiceIdentity: null,
      depositInvoiceVersionDigest: null,
      scheduledAmountMinorUnits: null,
      acceptedDepositPaymentReceiptIdentity: null,
      acceptedDepositPaymentAmountMinorUnits: null,
      depositApplicationIdentity: null,
      appliedAmountMinorUnits: null,
      finalBalanceReductionMinorUnits: null,
      finalInvoiceIdentity: null,
      finalBalanceBeforeMinorUnits: null,
      finalBalanceAfterMinorUnits: null,
      projectionRevision: null,
      projectionDigest: null,
    }),
    authority: Object.freeze({
      depositInvoiceAuthorized: false,
      depositPaymentRecorded: false,
      depositApplicationAuthorized: false,
      invoiceBalanceChangeAuthorized: false,
      finalBalanceReconciliationAuthorized: false,
      milestoneApplicationAuthorized: false,
      progressApplicationAuthorized: false,
      jobCompletionClaimAuthorized: false,
      revenueRecognitionAuthorized: false,
    }),
    privacy: Object.freeze({
      depositScheduleIdentityExposed: false,
      invoiceIdentityExposed: false,
      paymentReceiptIdentityExposed: false,
      providerIdentityExposed: false,
      customerPrivateDataExposed: false,
      exactAmountExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    depositApplicationRowCount: 0,
    finalBalanceMutationCount: 0,
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
    throw new Error('Deposit-application readiness boundary invalid');
  }
  return expected;
}

function projectWithSources(raw, origin, attempt) {
  const expected = unavailable(origin, attempt);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Deposit-application readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, policy, unavailableOrigin, depositScheduleCurrent,
  unavailable, project, projectWithSources };
