'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const providerConnection = require('./paymentProviderConnection');
const providerEventReceipt = require('./paymentProviderEventReceipt');

const CONTRACT_VERSION = 'm27-provider-lifecycle-health-v1';
const REASON = 'provider_lifecycle_authority_unavailable';
const ADAPTER_SCHEMA_VERSION = 'm27-provider-adapter-v1';
const REQUIREMENTS = Object.freeze([
  ['registered_provider_adapter', 'provider_adapter_runtime_unavailable'],
  ['current_tenant_provider_account_health', 'tenant_provider_account_unavailable'],
  ['observed_provider_capability_set', 'provider_capability_set_unavailable'],
  ['server_side_credential_rotation_authority', 'provider_credential_authority_unavailable'],
  ['server_side_webhook_endpoint_rotation_authority', 'provider_webhook_authority_unavailable'],
  ['verified_sandbox_live_separation', 'provider_sandbox_evidence_unavailable'],
  ['verified_disconnect_reconnect_predecessor', 'active_provider_connection_unavailable'],
  ['current_incident_disablement_authority', 'provider_incident_control_unavailable'],
]);

function requirement([name, reason]) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason });
}

function unavailable(boundaryRaw = providerBoundary.unavailable(),
  connectionRaw = providerConnection.unavailable(),
  receiptRaw = providerEventReceipt.unavailable()) {
  const boundary = providerBoundary.project(boundaryRaw);
  const connection = providerConnection.project(connectionRaw);
  const receipt = providerEventReceipt.project(receiptRaw);
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sources: Object.freeze([
      Object.freeze({ source: 'part7a_payment_provider_boundary',
        contractVersion: boundary.contractVersion,
        digest: providerBoundary.digest(boundary) }),
      Object.freeze({ source: 'part7b_provider_connection',
        contractVersion: connection.contractVersion,
        digest: providerBoundary.digest(connection) }),
      Object.freeze({ source: 'part8a_provider_event_receipt',
        contractVersion: receipt.contractVersion,
        digest: providerBoundary.digest(receipt) }),
    ]),
    adapter: Object.freeze({
      provider: boundary.provider.adapter,
      requiredSchemaVersion: ADAPTER_SCHEMA_VERSION,
      registrationState: 'unavailable',
      registrationReason: 'provider_adapter_runtime_unavailable',
      registeredAdapterIdentity: null,
      registeredAdapterVersion: null,
      runtimeAvailable: false,
    }),
    accountHealth: Object.freeze({
      accountShape: boundary.provider.accountShape,
      tenantBound: true,
      state: 'unavailable',
      reason: 'tenant_provider_account_unavailable',
      providerAccountIdentity: null,
      onboardingState: 'unavailable',
      kycState: null,
      chargesCapabilityState: null,
      payoutsCapabilityState: null,
      observedAt: null,
      mayBeAssumedHealthy: false,
    }),
    capabilityDrift: Object.freeze({
      expectedMode: boundary.modes.launchSupportedMode,
      expectedCountry: boundary.geographyAndCurrency.supportedCountry,
      expectedCurrency: boundary.geographyAndCurrency.supportedCurrency,
      expectedMethods: Object.freeze(boundary.methods.map(item => item.method)),
      observedMode: null,
      observedCountry: null,
      observedCurrency: null,
      observedMethods: null,
      comparisonState: 'unavailable',
      comparisonReason: 'provider_capability_set_unavailable',
      driftState: 'unavailable',
      driftMayBeAssumedAbsent: false,
      driftBlocksConnectionAndInitiation: true,
      exactRevalidationRequired: true,
    }),
    credentialLifecycle: Object.freeze({
      storageBoundary: connection.credentials.storageBoundary,
      authorityState: connection.credentials.credentialAuthorityState,
      authorityReason: connection.credentials.credentialAuthorityReason,
      secretReference: null,
      rawSecretInputAccepted: false,
      rawSecretStored: false,
      secretValueReturned: false,
      rotationState: 'unavailable',
      revocationState: 'unavailable',
      lastRotationReceipt: null,
    }),
    webhookLifecycle: Object.freeze({
      providerEventReceiptVersion: receipt.contractVersion,
      providerEventReceiptDigest: providerBoundary.digest(receipt),
      authorityState: 'unavailable',
      authorityReason: 'provider_webhook_authority_unavailable',
      endpointIdentity: null,
      endpointUrl: null,
      secretReference: null,
      rawSecretInputAccepted: false,
      secretValueReturned: false,
      rotationState: 'unavailable',
      revocationState: 'unavailable',
      lastRotationReceipt: null,
      deliveryState: 'unavailable',
      publicReceiptEndpointMounted: receipt.receipt.publicReceiptEndpointMounted,
    }),
    modeIsolation: Object.freeze({
      policyMode: boundary.modes.launchSupportedMode,
      activeMode: null,
      sandboxEvidenceState: 'unavailable',
      sandboxEvidenceReason: 'provider_sandbox_evidence_unavailable',
      liveModeEnabled: false,
      liveModeState: boundary.modes.liveModeState,
      credentialReuseAcrossModesAuthorized: false,
      sessionReuseAcrossModesAuthorized: false,
      eventReuseAcrossModesAuthorized: false,
    }),
    connectionRecovery: Object.freeze({
      connectionState: connection.lifecycle.connectionState,
      allowedPolicyOperations: connection.lifecycle.allowedPolicyOperations,
      disconnectBlocksNewConnectionAndInitiation: true,
      disconnectClearsProviderState: true,
      explicitReconnectOperation: connection.lifecycle.explicitReconnectOperation,
      reconnectRequiresVerifiedDisconnectedPredecessor:
        connection.lifecycle.reconnectRequiresVerifiedDisconnectedPredecessor,
      automaticReconnectAuthorized: connection.lifecycle.automaticReconnectAuthorized,
      reconnectState: 'unavailable',
      reconnectReason: 'active_provider_connection_unavailable',
    }),
    incidentControl: Object.freeze({
      rolloutStage: boundary.rollout.stage,
      tenantFlagEnabled: false,
      authorityState: 'unavailable',
      authorityReason: 'provider_incident_control_unavailable',
      activeIncidentIdentity: null,
      disablementState: 'unavailable',
      newConnectionAuthorized: false,
      paymentInitiationAuthorized: false,
      providerEventIngestionAuthorized: false,
      automaticRecoveryAuthorized: false,
      invoicePaidStateMayBeInferred: false,
    }),
    requirements: Object.freeze(REQUIREMENTS.map(requirement)),
    privacy: Object.freeze({
      organizationIdentityReturned: false,
      actorIdentityReturned: false,
      sessionIdentityReturned: false,
      providerAccountIdentityReturned: false,
      credentialReferenceReturned: false,
      webhookEndpointReturned: false,
      secretValueReturned: false,
    }),
    adapterRegistrationAuthorized: false,
    accountHealthRefreshAuthorized: false,
    credentialRotationAuthorized: false,
    webhookRotationAuthorized: false,
    incidentDisablementAuthorized: false,
    providerCallCount: 0,
    providerMutationCount: 0,
    credentialMutationCount: 0,
    webhookMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, boundaryRaw = providerBoundary.unavailable(),
  connectionRaw = providerConnection.unavailable(),
  receiptRaw = providerEventReceipt.unavailable()) {
  const expected = unavailable(boundaryRaw, connectionRaw, receiptRaw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Provider lifecycle health boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, ADAPTER_SCHEMA_VERSION, REQUIREMENTS,
  unavailable, project };
