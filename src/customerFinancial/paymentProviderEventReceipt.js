'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const providerConnection = require('./paymentProviderConnection');

const CONTRACT_VERSION = 'm27-provider-event-receipt-readiness-v1';
const REASON = 'payment_provider_unavailable';
const RECONCILE_CAPABILITY = 'customer_financial.payment.reconcile';

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const control = launch.actionControl[RECONCILE_CAPABILITY];
  if (launch.retention.rawProviderEventDays !== 30 ||
      launch.retention.legalTaxAccountingProviderSecurityReviewComplete !== false ||
      launch.professionalReviews.legal.accepted !== false ||
      !launch.professionalReviews.legal.requiredBefore.includes('retention_launch') ||
      launch.professionalReviews.provider.accepted !== false ||
      launch.professionalReviews.security.accepted !== false ||
      launch.performance.maximumProviderEventBytes !== 262144 ||
      launch.performance.webhookClockToleranceSeconds !== 300 ||
      control?.mode !== 'dual_control' || control?.singleControlAllowed !== false ||
      control?.authenticatedProviderProjectionIsHumanAction !== false) {
    throw new Error('Provider-event receipt policy is unavailable');
  }
  return launch;
}

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason });
}

function unavailable(providerRaw = providerBoundary.unavailable(),
  connectionRaw = providerConnection.unavailable()) {
  const launch = policy();
  const provider = providerBoundary.project(providerRaw);
  const connection = providerConnection.project(connectionRaw);
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    providerBoundaryVersion: provider.contractVersion,
    providerBoundaryDigest: providerBoundary.digest(provider),
    providerConnectionVersion: connection.contractVersion,
    providerConnectionDigest: providerBoundary.digest(connection),
    state: 'unavailable',
    reason: REASON,
    value: null,
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      roleAloneAuthorizesReceipt: false,
      authenticatedProviderProjectionIsHumanAction: false,
      manualReconciliationCapability: RECONCILE_CAPABILITY,
      manualReconciliationControlMode: launch.actionControl[RECONCILE_CAPABILITY].mode,
      providerEvidenceCanAuthorizeCharge: false,
    }),
    requirements: Object.freeze([
      requirement('exact_tenant_provider_account_identity',
        'tenant_provider_account_unavailable'),
      requirement('server_side_webhook_signing_credential',
        'provider_credential_authority_unavailable'),
      requirement('provider_specific_signature_verifier',
        'provider_adapter_runtime_unavailable'),
      requirement('bounded_raw_provider_event_payload',
        'provider_event_receipt_unavailable'),
      requirement('current_raw_provider_event_retention_authority',
        'retention_review_unavailable'),
      requirement('unique_provider_event_identity',
        'provider_event_identity_unavailable'),
      requirement('exact_provider_account_and_mode_match',
        'provider_account_mode_unavailable'),
      requirement('replay_safe_provider_acknowledgement',
        'provider_event_acknowledgement_unavailable'),
    ]),
    receipt: Object.freeze({
      publicReceiptEndpointMounted: false,
      rawBodyRequired: true,
      maximumPayloadBytes: launch.performance.maximumProviderEventBytes,
      webhookClockToleranceSeconds: launch.performance.webhookClockToleranceSeconds,
      authenticationState: 'unavailable',
      signingCredentialReference: null,
      signatureScheme: null,
      signatureVerified: false,
      rawPayloadAccepted: false,
      rawPayload: null,
      rawPayloadDigest: null,
    }),
    retention: Object.freeze({
      rawProviderEventDays: launch.retention.rawProviderEventDays,
      retentionLaunchAuthorized: false,
      retentionReviewState: 'unavailable',
      retentionReviewReason: 'retention_review_unavailable',
      payloadRetained: false,
      retentionExpiresAt: null,
      legalOrAuditHoldEvaluated: false,
    }),
    binding: Object.freeze({
      provider: provider.provider.adapter,
      providerAccountShape: provider.provider.accountShape,
      tenantBound: true,
      providerAccountIdentity: null,
      providerAccountMatchVerified: false,
      expectedMode: provider.modes.launchSupportedMode,
      eventLivemode: null,
      livemodeAccepted: false,
      modeMatchVerified: false,
    }),
    uniqueness: Object.freeze({
      providerEventIdentity: null,
      providerEventIdentityState: 'unavailable',
      uniquenessClaimCreated: false,
      duplicateDetected: false,
      replayWindowEvaluated: false,
    }),
    acknowledgement: Object.freeze({
      replaySafeAcknowledgementAvailable: false,
      acknowledgementAttempted: false,
      acknowledgementStatus: null,
      providerRetryState: 'unavailable',
      providerMayRetry: null,
    }),
    downstream: Object.freeze({
      normalizationAuthorized: false,
      invoiceAllocationAuthorized: false,
      paymentSuccessRecorded: false,
      captureRecorded: false,
      settlementRecorded: false,
      payoutRecorded: false,
      invoiceBalanceChanged: false,
      accountingAcknowledgementRecorded: false,
    }),
    tenantSessionCurrent: true,
    exactPolicyCurrent: true,
    providerAccountCurrent: false,
    receiptRowCount: 0,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Provider-event receipt readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, RECONCILE_CAPABILITY, policy,
  unavailable, project };
