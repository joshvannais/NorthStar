'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const allocationBalance = require('./paymentAllocationBalance');

const CONTRACT_VERSION = 'm27-settlement-payout-reconciliation-readiness-v1';
const REASON = 'settlement_unavailable';
const RECONCILE_CAPABILITY = 'customer_financial.payment.reconcile';

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const control = launch.actionControl[RECONCILE_CAPABILITY];
  const financial = launch.financial;
  if (control?.mode !== 'dual_control' || control.singleControlAllowed !== false ||
      JSON.stringify(control.appliesTo) !== JSON.stringify([
        'manual_match', 'manual_mismatch_resolution', 'manual_settlement_override',
        'manual_allocation_override',
      ]) || control.authenticatedProviderProjectionIsHumanAction !== false ||
      financial.merchantOfRecord !== 'contractor_business' ||
      financial.northstarCustodyOrControl !== false ||
      financial.provider !== 'stripe_connect' ||
      financial.providerAccountShape !== 'tenant_bound_contractor_account' ||
      financial.fundsDestination !== 'contractor_connected_account' ||
      financial.supportedMode !== 'test' || financial.liveModeDefaultEnabled !== false ||
      financial.supportedCurrency !== 'USD') {
    throw new Error('Settlement and payout reconciliation policy is unavailable');
  }
  return launch;
}

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason, value: null });
}

function unavailable(allocationRaw = allocationBalance.unavailable(),
  providerRaw = providerBoundary.unavailable()) {
  const allocation = allocationBalance.project(allocationRaw);
  const provider = providerBoundary.project(providerRaw);
  const launch = policy();
  const control = launch.actionControl[RECONCILE_CAPABILITY];
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitnesses: Object.freeze({
      paymentAllocationBalanceVersion: allocation.contractVersion,
      paymentAllocationBalanceDigest: providerBoundary.digest(allocation),
      paymentProviderBoundaryVersion: provider.contractVersion,
      paymentProviderBoundaryDigest: providerBoundary.digest(provider),
    }),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      roleAloneAuthorizesReconciliation: false,
      authenticatedProviderProjectionIsHumanAction:
        control.authenticatedProviderProjectionIsHumanAction,
      manualReconciliationCapability: RECONCILE_CAPABILITY,
      manualReconciliationControlMode: control.mode,
      singleControlAllowed: control.singleControlAllowed,
      manualSettlementOverrideAuthorized: false,
    }),
    fundsPolicy: Object.freeze({
      merchantOfRecord: provider.merchantAndFunds.merchantOfRecord,
      northstarCustodyOrControl: provider.merchantAndFunds.northstarCustodyOrControl,
      provider: provider.provider.adapter,
      providerAccountShape: provider.provider.accountShape,
      fundsDestination: provider.merchantAndFunds.fundsDestination,
      supportedMode: provider.modes.launchSupportedMode,
      liveModeEnabled: provider.modes.liveModeEnabled,
      currency: provider.geographyAndCurrency.supportedCurrency,
      providerFeeDisclosureState: provider.fees.providerFeeDisclosureState,
      providerFeeMayBeAssumedZero: provider.fees.feeMayBeAssumedZero,
      capturedPaymentMayBeTreatedAsSettledCash: false,
      settledBalanceTransactionMayBeTreatedAsPayout: false,
      payoutMayBeTreatedAsBankArrival: false,
      accountingAcknowledgementMayBeTreatedAsSettlement: false,
      settlementMayRecognizeEarnedRevenue: false,
    }),
    requirements: Object.freeze([
      requirement('current_exact_payment_allocation_and_balance_projection',
        'accepted_payment_evidence_unavailable'),
      requirement('accepted_current_capture_evidence', 'provider_capture_evidence_unavailable'),
      requirement('exact_tenant_provider_account_and_mode',
        'provider_account_mode_unavailable'),
      requirement('exact_provider_payment_and_capture_identity',
        'provider_capture_identity_unavailable'),
      requirement('exact_provider_balance_transaction_identity',
        'provider_balance_transaction_unavailable'),
      requirement('exact_capture_to_balance_transaction_lineage',
        'provider_balance_transaction_unavailable'),
      requirement('exact_gross_fee_net_and_currency_identity',
        'provider_fee_disclosure_unavailable'),
      requirement('current_provider_settlement_evidence', 'settlement_unavailable'),
      requirement('exact_payout_identity_and_balance_transaction_membership',
        'provider_payout_unavailable'),
      requirement('current_payout_status_and_arrival_evidence',
        'provider_payout_unavailable'),
      requirement('exact_contractor_funds_destination',
        'provider_funds_destination_unavailable'),
      requirement('duplicate_reversal_and_correction_disposition',
        'provider_reconciliation_unavailable'),
    ]),
    matching: Object.freeze({
      allocationBalanceCurrent: false,
      captureEvidenceAccepted: false,
      exactTenantMatch: false,
      exactProviderAccountMatch: false,
      exactProviderModeMatch: false,
      exactPaymentAndCaptureMatch: false,
      exactBalanceTransactionMatch: false,
      exactCaptureLineageMatch: false,
      exactCurrencyMatch: false,
      grossFeeNetIdentityVerified: false,
      exactPayoutMembershipMatch: false,
      exactFundsDestinationMatch: false,
      duplicateDispositionState: 'unavailable',
      reversalOrCorrectionDispositionState: 'unavailable',
      unmatchedEvidenceRejected: true,
    }),
    projection: Object.freeze({
      invoiceId: null,
      invoiceVersion: null,
      invoiceDigest: null,
      paymentIdentity: null,
      captureIdentity: null,
      captureOccurredAt: null,
      balanceTransactionIdentity: null,
      balanceTransactionType: null,
      balanceTransactionStatus: 'unavailable',
      balanceTransactionAvailableOn: null,
      currency: null,
      grossMinorUnits: null,
      feeMinorUnits: null,
      netMinorUnits: null,
      settlementState: 'unavailable',
      settlementOccurredAt: null,
      payoutIdentity: null,
      payoutStatus: 'unavailable',
      payoutCreatedAt: null,
      payoutExpectedArrivalAt: null,
      payoutArrivedAt: null,
      payoutMinorUnits: null,
      fundsDestinationIdentity: null,
      bankArrivalEvidenceIdentity: null,
      reconciliationRevision: null,
      reconciliationDigest: null,
    }),
    safeguards: Object.freeze({
      paymentSuccessMayImplyCapture: false,
      paymentSuccessMayImplySettlement: false,
      captureMayImplySettlement: false,
      captureMayImplyPayout: false,
      settlementMayImplyPayout: false,
      payoutInitiationMayImplyPayoutPaid: false,
      payoutPaidMayImplyBankArrival: false,
      providerFeeMayBeAssumedZero: false,
      missingAmountMayBecomeZero: false,
      duplicateMayCreateSettlementOrPayout: false,
      replayMayCreateSettlementOrPayout: false,
      reversalOrCorrectionMayRewritePriorEvidence: false,
      accountingAcknowledgementMaySupplyProviderEvidence: false,
      manualSettlementOverrideMayBypassDualControl: false,
    }),
    authority: Object.freeze({
      automaticProviderProjectionAuthorized: false,
      manualSettlementOverrideAuthorized: false,
      paymentSuccessRecorded: false,
      captureRecorded: false,
      settlementRecorded: false,
      settledCashRecorded: false,
      payoutRecorded: false,
      bankArrivalRecorded: false,
      accountingAcknowledgementRecorded: false,
      collectedCashRecorded: false,
      earnedRevenueRecognitionAuthorized: false,
    }),
    privacy: Object.freeze({
      rawProviderPayloadExposed: false,
      providerEventIdentityExposed: false,
      providerPaymentIdentityExposed: false,
      providerBalanceTransactionIdentityExposed: false,
      providerPayoutIdentityExposed: false,
      providerAccountIdentityExposed: false,
      fundsDestinationIdentityExposed: false,
      providerCredentialExposed: false,
      customerPrivateDataExposed: false,
    }),
    exactCurrentnessRevalidated: true,
    settlementProjectionRowCount: 0,
    payoutReconciliationRowCount: 0,
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
    throw new Error('Settlement and payout reconciliation readiness boundary invalid');
  }
  return expected;
}

function projectWithSources(raw, allocation, provider) {
  const expected = unavailable(allocation, provider);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Settlement and payout reconciliation readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, RECONCILE_CAPABILITY, policy,
  unavailable, project, projectWithSources };
