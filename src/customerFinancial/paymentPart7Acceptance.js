'use strict';

const part6Contract = require('./invoicePart6Acceptance');
const providerBoundary = require('./paymentProviderBoundary');
const providerConnection = require('./paymentProviderConnection');
const initiationPlan = require('./paymentInitiationPlan');

const CONTRACT_VERSION = 'm27-payment-part7-acceptance-v1';
const BUNDLE_VERSION = 'm27-payment-part7-preview-bundle-v1';
const ADAPTER_SCHEMA_VERSION = 'm27-payment-provider-adapter-schema-v1';
const REASON = 'provider_sandbox_evidence_unavailable';
const REQUIREMENTS = Object.freeze([
  Object.freeze({ requirement: 'exact_current_launch_policy', state: 'current', reason: null }),
  Object.freeze({ requirement: 'tenant_bound_test_provider_connection', state: 'unavailable',
    reason: 'provider_connection_prerequisites_unavailable' }),
  Object.freeze({ requirement: 'current_provider_capability_grant', state: 'unavailable',
    reason: 'provider_connection_capability_unavailable' }),
  Object.freeze({ requirement: 'recent_authentication_and_mfa', state: 'unavailable',
    reason: 'mfa_authority_unavailable' }),
  Object.freeze({ requirement: 'compatible_adapter_schema', state: 'unavailable',
    reason: 'provider_adapter_runtime_unavailable' }),
  Object.freeze({ requirement: 'provider_sandbox_journey_evidence', state: 'unavailable',
    reason: REASON }),
  Object.freeze({ requirement: 'exact_current_issued_balance', state: 'unavailable',
    reason: 'issued_invoice_unavailable' }),
  Object.freeze({ requirement: 'current_scoped_customer_session', state: 'unavailable',
    reason: 'invoice_public_session_unavailable' }),
  Object.freeze({ requirement: 'exact_payment_idempotency_receipt', state: 'not_created',
    reason: 'payment_plan_not_authorized' }),
  Object.freeze({ requirement: 'server_owned_rollout_flag', state: 'disabled',
    reason: 'payment_rollout_disabled' }),
]);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function unavailable(mode, part6Bundle, boundary = providerBoundary.unavailable(),
  connection = providerConnection.unavailable(), plan) {
  if (!['paid','demo'].includes(mode)) throw new Error('Payment Part 7 mode invalid');
  const current = part6Contract.projectBundle(part6Bundle, mode);
  const exactBoundary = providerBoundary.project(boundary);
  const exactConnection = providerConnection.project(connection);
  const exactPlan = initiationPlan.projectWithSources(plan || initiationPlan.unavailable(
    current.part6Acceptance.publicSession, exactConnection, mode),
  current.part6Acceptance.publicSession, exactConnection, mode);
  const launch = providerBoundary.validateLaunchPolicy();
  if (launch.rollout.currentStage !== 'disabled' ||
      launch.rollout.serverOwnedTenantFlagDefault !== 'off' ||
      launch.rollout.missionCompletionRequiresProviderSandbox !== true ||
      launch.financial.supportedMode !== 'test' ||
      JSON.stringify(launch.financial.supportedOnlineMethods) !== JSON.stringify(['card'])) {
    throw new Error('Payment Part 7 launch policy invalid');
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    previewWitness: current.part6Acceptance.previewWitness,
    sourceWitnesses: Object.freeze({
      providerBoundaryContractVersion: exactBoundary.contractVersion,
      providerBoundaryDigest: providerBoundary.digest(exactBoundary),
      providerConnectionContractVersion: exactConnection.contractVersion,
      providerConnectionDigest: providerBoundary.digest(exactConnection),
      paymentInitiationContractVersion: exactPlan.contractVersion,
      paymentInitiationDigest: providerBoundary.digest(exactPlan),
    }),
    requirements: REQUIREMENTS,
    adapterSchema: Object.freeze({
      contractVersion: ADAPTER_SCHEMA_VERSION,
      state: 'unavailable',
      reason: 'provider_adapter_runtime_unavailable',
      value: null,
      provider: exactBoundary.provider.adapter,
      mode: 'test',
      acceptedMajorVersion: 1,
      minimumSupportedMinorVersion: 0,
      maximumTestedMinorVersion: 0,
      breakingChangeRequiresNewMajorVersion: true,
      unknownRequiredFieldAccepted: false,
      unknownOptionalFieldMayAuthorizeEffect: false,
      backwardCompatibleMinorInputRequired: true,
      forwardCompatibleOptionalOutputRequired: true,
      callerAuthoredProviderObjectAccepted: false,
      providerPayloadMayMarkInvoicePaid: false,
    }),
    sandbox: Object.freeze({
      state: 'unavailable',
      reason: REASON,
      value: null,
      requiredForMissionCompletion: true,
      evidenceAccepted: false,
      syntheticEvidenceMaySubstitute: false,
      providerAccountId: null,
      providerSessionId: null,
      hostedCheckoutUrl: null,
    }),
    rollout: Object.freeze({
      stage: 'disabled',
      tenantFlagDefault: 'off',
      tenantFlagEnabled: false,
      featureFlagRollbackState: 'active',
      rollbackBlocksNewInitiation: true,
      rollbackCanMarkInvoicePaid: false,
      liveCapabilityEnabled: false,
      liveCapabilityPrerequisites: Object.freeze(['accepted_parts_8_and_9',
        'accepted_part_13_controls','separately_authorized_live_canary']),
    }),
    driftAndDisconnect: Object.freeze({
      capabilityDriftBehavior: 'deny_and_require_current_reauthorization',
      accountOrModeDriftBehavior: 'deny_and_require_exact_revalidation',
      disconnectBehavior: 'deny_new_initiation_and_clear_provider_state',
      credentialRotationBehavior: 'deny_until_current_server_credential_authority',
      automaticReconnectAuthorized: false,
      browserReturnMayRestoreAuthority: false,
    }),
    methods: Object.freeze([
      Object.freeze({ method: 'card', policyState: 'launch_supported',
        runtimeState: 'unavailable', reason: 'payment_provider_unavailable' }),
      Object.freeze({ method: 'any_other_online_method', policyState: 'unsupported',
        runtimeState: 'unsupported', reason: 'payment_method_unsupported' }),
    ]),
    protections: Object.freeze({
      duplicateClickRequiresSameIdempotencyReceipt: true,
      changedRequestUnderSameIdempotencyKeyConflicts: true,
      amountCurrencyInvoiceOrAllocationChangeInvalidatesPlan: true,
      stalePlanMayReachProvider: false,
      missingAmountMayBeTreatedAsZero: false,
      browserReturnAuthorizesPayment: false,
    }),
    access: Object.freeze({
      staffReadRoles: Object.freeze(['owner','admin']),
      providerConnectionRole: 'owner',
      customerInitiationAuthority: 'current_scoped_customer_session',
      staffRoleMaySubstituteForCustomerSession: false,
      roleAloneAuthorizesProviderAction: false,
      tenantCrossingAllowed: false,
    }),
    exactCurrentnessRevalidated: true,
    providerSandboxAccepted: false,
    providerConnectionCurrent: false,
    paymentPlanCurrent: false,
    paymentInitiationAuthorized: false,
    providerSessionCreated: false,
    paymentSuccessRecorded: false,
    settlementRecorded: false,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, mode, part6Bundle) {
  const expected = unavailable(mode, part6Bundle);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment Part 7 acceptance boundary invalid');
  }
  return expected;
}

function bundle(part6Bundle, acceptance) {
  const current = part6Contract.projectBundle(part6Bundle);
  const value = project(acceptance, current.preview.mode, current);
  if (JSON.stringify(value.previewWitness) !==
      JSON.stringify(current.part6Acceptance.previewWitness)) {
    throw new Error('Payment Part 7 preview bundle currentness mismatch');
  }
  return Object.freeze({ contractVersion: BUNDLE_VERSION,
    preview: current.preview,
    part5Acceptance: current.part5Acceptance,
    part6Acceptance: current.part6Acceptance,
    part7Acceptance: value });
}

function projectBundle(raw, expectedMode) {
  if (!exact(raw, ['contractVersion','preview','part5Acceptance','part6Acceptance',
    'part7Acceptance']) || raw.contractVersion !== BUNDLE_VERSION) {
    throw new Error('Payment Part 7 preview bundle invalid');
  }
  const part6Bundle = { contractVersion: part6Contract.BUNDLE_VERSION,
    preview: raw.preview, part5Acceptance: raw.part5Acceptance,
    part6Acceptance: raw.part6Acceptance };
  const value = bundle(part6Bundle, raw.part7Acceptance);
  if (expectedMode && value.preview.mode !== expectedMode) {
    throw new Error('Payment Part 7 preview bundle mode mismatch');
  }
  return value;
}

module.exports = { CONTRACT_VERSION, BUNDLE_VERSION, ADAPTER_SCHEMA_VERSION, REASON,
  REQUIREMENTS, unavailable, project, bundle, projectBundle };
