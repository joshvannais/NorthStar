'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const initiationPlan = require('./paymentInitiationPlan');
const eventNormalization = require('./paymentProviderEventNormalization');

const CONTRACT_VERSION = 'm27-payment-allocation-balance-readiness-v1';
const REASON = 'accepted_payment_evidence_unavailable';
const RECONCILE_CAPABILITY = 'customer_financial.payment.reconcile';

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const control = launch.actionControl[RECONCILE_CAPABILITY];
  const financial = launch.financial;
  const amount = launch.amountPolicy;
  if (control?.mode !== 'dual_control' || control.singleControlAllowed !== false ||
      JSON.stringify(control.appliesTo) !== JSON.stringify([
        'manual_match', 'manual_mismatch_resolution', 'manual_settlement_override',
        'manual_allocation_override',
      ]) || control.authenticatedProviderProjectionIsHumanAction !== false ||
      financial.supportedCurrency !== 'USD' ||
      JSON.stringify(financial.supportedOnlineMethods) !== JSON.stringify(['card']) ||
      financial.partialProviderPayments !== false ||
      financial.multiInvoiceProviderPayments !== false ||
      amount.cardCheckoutMinimumMinorUnits !== '50' ||
      amount.cardCheckoutMaximumMinorUnits !== '10000000' ||
      amount.invoiceMaximumMinorUnits !== '10000000') {
    throw new Error('Payment allocation and balance policy is unavailable');
  }
  return launch;
}

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason, value: null });
}

function unavailable(planRaw = initiationPlan.unavailable(),
  normalizationRaw = eventNormalization.unavailable()) {
  const plan = initiationPlan.project(planRaw);
  const normalization = eventNormalization.project(normalizationRaw);
  const launch = policy();
  const control = launch.actionControl[RECONCILE_CAPABILITY];
  const planPolicy = plan.planPolicy;
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
      providerEventNormalizationVersion: normalization.contractVersion,
      providerEventNormalizationDigest: providerBoundary.digest(normalization),
    }),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      roleAloneAuthorizesAllocation: false,
      authenticatedProviderProjectionIsHumanAction:
        control.authenticatedProviderProjectionIsHumanAction,
      manualReconciliationCapability: RECONCILE_CAPABILITY,
      manualReconciliationControlMode: control.mode,
      singleControlAllowed: control.singleControlAllowed,
    }),
    allocationPolicy: Object.freeze({
      invoiceCount: planPolicy.invoiceCount,
      partialProviderPaymentsSupported: planPolicy.partialProviderPaymentsSupported,
      multiInvoiceProviderPaymentsSupported: planPolicy.multiInvoiceProviderPaymentsSupported,
      currency: planPolicy.currency,
      method: planPolicy.method,
      minimumMinorUnits: planPolicy.minimumMinorUnits,
      maximumMinorUnits: planPolicy.maximumMinorUnits,
      invoiceMaximumMinorUnits: planPolicy.invoiceMaximumMinorUnits,
      amountMustEqualAllocationTotal: planPolicy.amountMustEqualAllocationTotal,
      allocationMayExceedCurrentBalance: planPolicy.allocationMayExceedCurrentBalance,
      missingAmountMayBeTreatedAsZero: planPolicy.missingAmountMayBeTreatedAsZero,
      exactZeroInvoiceIsDistinctFromUnavailable:
        planPolicy.exactZeroInvoiceIsDistinctFromUnavailable,
      callerMaySelectInvoiceOrAmount: false,
      providerEvidenceMaySelectDifferentInvoice: false,
      automaticForeignExchangeSupported: false,
    }),
    requirements: Object.freeze([
      requirement('one_exact_current_issued_invoice', 'issued_invoice_unavailable'),
      requirement('current_immutable_payment_initiation_plan',
        'payment_initiation_plan_unavailable'),
      requirement('accepted_current_normalized_payment_evidence',
        'provider_event_normalization_unavailable'),
      requirement('exact_tenant_provider_account_and_mode',
        'provider_account_mode_unavailable'),
      requirement('exact_provider_payment_object_identity',
        'provider_payment_identity_unavailable'),
      requirement('exact_invoice_amount_currency_and_digest',
        'issued_balance_unavailable'),
      requirement('unique_nonduplicate_event_and_payment_identity',
        'provider_event_uniqueness_unavailable'),
      requirement('exact_plan_session_and_idempotency_binding',
        'payment_session_unavailable'),
      requirement('current_unapplied_invoice_balance_revision',
        'issued_balance_unavailable'),
    ]),
    matching: Object.freeze({
      acceptedPaymentEvidenceState: 'unavailable',
      normalizedEvidenceAccepted: false,
      exactTenantMatch: false,
      exactProviderAccountMatch: false,
      exactProviderModeMatch: false,
      exactPaymentObjectMatch: false,
      exactInvoiceMatch: false,
      exactCurrencyMatch: false,
      exactAmountMatch: false,
      exactInitiationPlanMatch: false,
      duplicateDispositionState: 'unavailable',
      duplicateDetected: null,
      unmatchedEvidenceRejected: true,
    }),
    projection: Object.freeze({
      invoiceId: null,
      invoiceVersion: null,
      invoiceDigest: null,
      balanceRevision: null,
      balanceDigest: null,
      currency: null,
      originalBalanceMinorUnits: null,
      acceptedPaymentMinorUnits: null,
      allocatedMinorUnits: null,
      remainingBalanceMinorUnits: null,
      allocation: null,
      paymentState: 'unavailable',
      captureState: 'unavailable',
      settlementState: 'unavailable',
      providerEventIdentity: null,
      providerPaymentIdentity: null,
      projectionRevision: null,
      projectionDigest: null,
    }),
    safeguards: Object.freeze({
      duplicateMayChangeBalance: false,
      replayMayChangeBalance: false,
      wrongTenantMayChangeBalance: false,
      wrongProviderAccountMayChangeBalance: false,
      wrongCurrencyMayChangeBalance: false,
      wrongAmountMayChangeBalance: false,
      unmatchedEventMayChangeBalance: false,
      stalePlanMayChangeBalance: false,
      browserReturnMayMarkInvoicePaid: false,
      paymentSuccessMayImplySettlement: false,
      capturedPaymentMayImplySettledCash: false,
      missingEvidenceMayBecomeZero: false,
      manualMismatchMayBypassDualControl: false,
      manualAllocationMayBypassDualControl: false,
    }),
    authority: Object.freeze({
      automaticExactProjectionAuthorized: false,
      manualMatchAuthorized: false,
      manualMismatchResolutionAuthorized: false,
      manualAllocationOverrideAuthorized: false,
      invoiceAllocationAuthorized: false,
      invoiceBalanceChangeAuthorized: false,
      paymentSuccessRecorded: false,
      captureRecorded: false,
      settlementRecorded: false,
      payoutRecorded: false,
      accountingEntryAuthorized: false,
      earnedRevenueRecognitionAuthorized: false,
    }),
    privacy: Object.freeze({
      rawProviderPayloadExposed: false,
      providerEventIdentityExposed: false,
      providerPaymentIdentityExposed: false,
      providerAccountIdentityExposed: false,
      providerCredentialExposed: false,
      customerPrivateDataExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    allocationRowCount: 0,
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
    throw new Error('Payment allocation and balance readiness boundary invalid');
  }
  return expected;
}

function projectWithSources(raw, plan, normalization) {
  const expected = unavailable(plan, normalization);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment allocation and balance readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, RECONCILE_CAPABILITY, policy, unavailable,
  project, projectWithSources };
