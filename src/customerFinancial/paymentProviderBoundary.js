'use strict';

const crypto = require('node:crypto');
const launchPolicy = require('../../config/mission27-launch-contract.v1.json');

const CONTRACT_VERSION = 'm27-payment-provider-boundary-v1';
const POLICY_VERSION = 'mission27.launch.v1';
const POLICY_DIGEST = 'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a';
const REASON = 'payment_provider_unavailable';
const CAPABILITY = 'customer_financial.provider.connect';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]),
  );
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function validateLaunchPolicy(policy = launchPolicy) {
  const financial = policy?.financial;
  const rollout = policy?.rollout;
  const control = policy?.actionControl?.[CAPABILITY];
  if (policy?.contractVersion !== POLICY_VERSION || digest(policy) !== POLICY_DIGEST ||
      policy?.policyState !== 'frozen_provider_disabled' ||
      financial?.merchantOfRecord !== 'contractor_business' ||
      financial?.northstarCustodyOrControl !== false ||
      financial?.provider !== 'stripe_connect' ||
      financial?.providerAccountShape !== 'tenant_bound_contractor_account' ||
      financial?.onboarding !== 'provider_hosted' ||
      financial?.checkout !== 'provider_hosted_direct_charge' ||
      financial?.fundsDestination !== 'contractor_connected_account' ||
      financial?.supportedMode !== 'test' || financial?.liveModeDefaultEnabled !== false ||
      financial?.supportedCountry !== 'US' || financial?.supportedCurrency !== 'USD' ||
      JSON.stringify(financial?.supportedOnlineMethods) !== JSON.stringify(['card']) ||
      financial?.partialProviderPayments !== false ||
      financial?.multiInvoiceProviderPayments !== false ||
      financial?.savedPaymentMethods !== false || financial?.automaticCollection !== false ||
      rollout?.currentStage !== 'disabled' || rollout?.serverOwnedTenantFlagDefault !== 'off' ||
      control?.mode !== 'conditional_dual_control' ||
      JSON.stringify(control?.testMode?.operations) !==
        JSON.stringify(['connect','disconnect','rotate','revoke']) ||
      control?.liveMode?.singleControlAllowed !== false) {
    throw new Error('Payment-provider launch policy is unavailable');
  }
  return policy;
}

function unavailable() {
  const policy = validateLaunchPolicy();
  const financial = policy.financial;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: POLICY_VERSION,
    policyDigest: POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    merchantAndFunds: Object.freeze({
      merchantOfRecord: financial.merchantOfRecord,
      northstarRole: 'software_provider',
      northstarCustodyOrControl: financial.northstarCustodyOrControl,
      chargeShape: financial.checkout,
      fundsDestination: financial.fundsDestination,
      northstarBalanceSupported: false,
      escrowSupported: false,
      splitTransferSupported: false,
      pooledFundsSupported: false,
    }),
    provider: Object.freeze({
      adapter: financial.provider,
      accountShape: financial.providerAccountShape,
      accountIdentityState: 'unavailable',
      accountIdentityReason: 'tenant_provider_account_unavailable',
      accountIdentity: null,
      accountTenantBound: true,
      onboardingShape: financial.onboarding,
      onboardingState: 'unavailable',
      hostedOnboardingAuthorized: false,
      providerCredentialState: 'unavailable',
      browserCredentialExposure: false,
    }),
    modes: Object.freeze({
      launchSupportedMode: financial.supportedMode,
      activeMode: null,
      testModeAvailable: false,
      liveModeEnabled: financial.liveModeDefaultEnabled,
      liveModeState: 'live_payments_disabled',
    }),
    geographyAndCurrency: Object.freeze({
      supportedCountry: financial.supportedCountry,
      supportedSubdivisionScope: financial.supportedSubdivisionScope,
      supportedCurrency: financial.supportedCurrency,
      foreignExchangeSupported: policy.currency.foreignExchangeSupported,
    }),
    methods: Object.freeze(financial.supportedOnlineMethods.map(method => Object.freeze({
      method,
      policyState: 'launch_supported',
      availabilityState: 'unavailable',
      availabilityReason: 'payment_provider_unavailable',
    }))),
    fees: Object.freeze({
      providerFeeDisclosureState: 'unavailable',
      providerFeeDisclosureReason: 'provider_fee_disclosure_unavailable',
      providerFeeSchedule: null,
      feeMayBeAssumedZero: false,
      customerSurchargeSupported: financial.surcharges,
      customerSurchargeState: 'surcharge_unsupported',
    }),
    capability: Object.freeze({
      requiredCapability: CAPABILITY,
      controlMode: policy.actionControl[CAPABILITY].mode,
      currentGrantState: 'unavailable',
      currentGrantReason: 'provider_connection_capability_unavailable',
      currentGrant: null,
      connectionAuthorized: false,
      liveConnectionRequiresTwoDifferentCurrentHumans:
        policy.amountPolicy.liveProviderConnectionAlwaysRequiresTwoHumans,
    }),
    rollout: Object.freeze({
      stage: policy.rollout.currentStage,
      tenantFlagDefault: policy.rollout.serverOwnedTenantFlagDefault,
      tenantFlagEnabled: false,
      providerAccountAvailable: false,
      paymentInitiationAuthorized: false,
      providerEventsAuthorized: false,
    }),
    exclusions: Object.freeze({
      partialProviderPaymentsSupported: financial.partialProviderPayments,
      multiInvoiceProviderPaymentsSupported: financial.multiInvoiceProviderPayments,
      savedPaymentMethodsSupported: financial.savedPaymentMethods,
      automaticCollectionSupported: financial.automaticCollection,
      rawPaymentInstrumentStorageSupported: false,
    }),
    tenantSessionCurrent: true,
    exactPolicyCurrent: true,
    providerAccountCurrent: false,
    paymentInitiationAuthorized: false,
    paymentSuccessRecorded: false,
    settlementRecorded: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment-provider boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, POLICY_VERSION, POLICY_DIGEST, REASON, CAPABILITY,
  digest, validateLaunchPolicy, unavailable, project };
