'use strict';

const providerBoundary = require('./paymentProviderBoundary');

const CONTRACT_VERSION = 'm27-payment-provider-connection-v1';
const REASON = 'provider_connection_prerequisites_unavailable';
const CAPABILITY = 'customer_financial.provider.connect';
const OPERATIONS = Object.freeze(['connect', 'disconnect', 'rotate', 'revoke']);
const BODY_KEYS = Object.freeze(['confirmed', 'operation', 'reason']);

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const rule = launch.actionControl[CAPABILITY];
  if (launch.team.ownerOnlyCapabilities.includes(CAPABILITY) !== true ||
      launch.team.adminDefaultCapabilities.includes(CAPABILITY) ||
      launch.team.recentAuthSeconds !== 600 || launch.team.mfaFreshnessSeconds !== 600 ||
      rule.mode !== 'conditional_dual_control' || rule.testMode.singleControlAllowed !== true ||
      JSON.stringify(rule.testMode.operations) !== JSON.stringify(OPERATIONS) ||
      !rule.testMode.requires.includes('owner_capability') ||
      !rule.testMode.requires.includes('recent_mfa') ||
      !rule.testMode.requires.includes('exact_tenant_account_mode_and_capability_set') ||
      !rule.testMode.requires.includes('fresh_confirmation') ||
      !rule.testMode.requires.includes('reason') ||
      rule.liveMode.singleControlAllowed !== false) {
    throw new Error('Payment-provider connection policy is unavailable');
  }
  return launch;
}

function requirement(requirementName, reason) {
  return Object.freeze({ requirement: requirementName, state: 'unavailable', reason });
}

function unavailable() {
  const launch = policy();
  const base = providerBoundary.unavailable();
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    providerBoundaryVersion: base.contractVersion,
    providerBoundaryDigest: providerBoundary.digest(base),
    state: 'unavailable',
    reason: REASON,
    value: null,
    access: Object.freeze({
      eligibleAccessRole: 'owner',
      roleAloneAuthorizes: false,
      requiredCapability: CAPABILITY,
      requiredAssurance: 'recent_mfa',
      maximumRecentAuthenticationSeconds: launch.team.recentAuthSeconds,
      maximumMfaFreshnessSeconds: launch.team.mfaFreshnessSeconds,
      currentCapabilityState: 'unavailable',
      currentCapabilityReason: 'provider_connection_capability_unavailable',
      currentCapabilityGrant: null,
      recentAuthenticationState: 'unavailable',
      recentAuthenticationReason: 'recent_auth_fact_unavailable',
      mfaState: 'unavailable',
      mfaReason: 'mfa_authority_unavailable',
    }),
    binding: Object.freeze({
      provider: base.provider.adapter,
      providerAccountShape: base.provider.accountShape,
      tenantBound: true,
      providerAccountIdentity: null,
      providerAccountIdentityState: 'unavailable',
      providerAccountIdentityReason: 'tenant_provider_account_unavailable',
      supportedPolicyMode: base.modes.launchSupportedMode,
      activeMode: null,
      activeModeState: 'unavailable',
      activeModeReason: 'provider_mode_unavailable',
      providerCapabilitySet: null,
      providerCapabilitySetState: 'unavailable',
      providerCapabilitySetReason: 'provider_capability_set_unavailable',
      liveModeEnabled: false,
    }),
    credentials: Object.freeze({
      storageBoundary: 'server_side_secret_reference_only',
      credentialAuthorityState: 'unavailable',
      credentialAuthorityReason: 'provider_credential_authority_unavailable',
      secretReference: null,
      rawSecretInputAccepted: false,
      rawSecretStored: false,
      secretValueReturned: false,
      browserCredentialExposure: false,
      rotationState: 'unavailable',
      revocationState: 'unavailable',
    }),
    lifecycle: Object.freeze({
      connectionState: 'unavailable',
      allowedPolicyOperations: OPERATIONS,
      operations: Object.freeze(OPERATIONS.map(operation => Object.freeze({
        operation,
        policyState: 'test_mode_supported',
        currentState: 'unavailable',
        currentReason: operation === 'connect'
          ? 'provider_connection_prerequisites_unavailable'
          : operation === 'disconnect'
            ? 'active_provider_connection_unavailable'
            : 'provider_credential_authority_unavailable',
        authorized: false,
      }))),
      explicitReconnectOperation: 'connect',
      reconnectRequiresVerifiedDisconnectedPredecessor: true,
      automaticReconnectAuthorized: false,
    }),
    requirements: Object.freeze([
      requirement('current_owner_capability', 'provider_connection_capability_unavailable'),
      requirement('server_owned_recent_authentication_fact', 'recent_auth_fact_unavailable'),
      requirement('accepted_mfa_ceremony', 'mfa_authority_unavailable'),
      requirement('exact_tenant_provider_account_identity', 'tenant_provider_account_unavailable'),
      requirement('exact_provider_mode', 'provider_mode_unavailable'),
      requirement('exact_provider_capability_set', 'provider_capability_set_unavailable'),
      requirement('server_side_credential_authority', 'provider_credential_authority_unavailable'),
    ]),
    instruments: Object.freeze({
      rawCardCredentialStorageAuthorized: false,
      rawBankCredentialStorageAuthorized: false,
      savedPaymentMethodStorageAuthorized: false,
      browserInstrumentCollectionAuthorized: false,
    }),
    connectionAuthorized: false,
    hostedOnboardingAuthorized: false,
    paymentInitiationAuthorized: false,
    providerCallCount: 0,
    providerMutationCount: 0,
    credentialMutationCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment-provider connection boundary invalid');
  }
  return expected;
}

function validateIntent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(BODY_KEYS) ||
      !OPERATIONS.includes(body.operation) || body.confirmed !== true ||
      typeof body.reason !== 'string' || body.reason.length < 12 || body.reason.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(body.reason)) {
    const error = new Error('Review the provider lifecycle action.');
    error.code = 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_INVALID';
    error.status = 400;
    throw error;
  }
  return Object.freeze({ operation: body.operation, reason: body.reason, confirmed: true });
}

module.exports = { CONTRACT_VERSION, REASON, CAPABILITY, OPERATIONS, policy,
  unavailable, project, validateIntent };
