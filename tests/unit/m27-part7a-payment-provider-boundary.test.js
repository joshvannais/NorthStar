'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/paymentProviderBoundary');
const repository = require('../../src/customerFinancial/paymentProviderBoundaryRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 7A payment-provider boundary', () => {
  test('pins the exact immutable launch policy and merchant/funds model', () => {
    const policy = require('../../config/mission27-launch-contract.v1.json');
    expect(contract.digest(policy)).toBe(contract.POLICY_DIGEST);
    expect(contract.validateLaunchPolicy(policy)).toBe(policy);
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-payment-provider-boundary-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: contract.POLICY_DIGEST,
      state: 'unavailable', reason: 'payment_provider_unavailable', value: null,
      merchantAndFunds: {
        merchantOfRecord: 'contractor_business', northstarRole: 'software_provider',
        northstarCustodyOrControl: false, chargeShape: 'provider_hosted_direct_charge',
        fundsDestination: 'contractor_connected_account', northstarBalanceSupported: false,
        escrowSupported: false, splitTransferSupported: false, pooledFundsSupported: false,
      },
      provider: {
        adapter: 'stripe_connect', accountShape: 'tenant_bound_contractor_account',
        accountIdentityState: 'unavailable',
        accountIdentityReason: 'tenant_provider_account_unavailable', accountIdentity: null,
        accountTenantBound: true, onboardingShape: 'provider_hosted',
        onboardingState: 'unavailable', hostedOnboardingAuthorized: false,
        providerCredentialState: 'unavailable', browserCredentialExposure: false,
      },
      modes: { launchSupportedMode: 'test', activeMode: null, testModeAvailable: false,
        liveModeEnabled: false, liveModeState: 'live_payments_disabled' },
      geographyAndCurrency: { supportedCountry: 'US',
        supportedSubdivisionScope: '50_states_and_district_of_columbia',
        supportedCurrency: 'USD', foreignExchangeSupported: false },
      methods: [{ method: 'card', policyState: 'launch_supported',
        availabilityState: 'unavailable', availabilityReason: 'payment_provider_unavailable' }],
    });
  });

  test('keeps fees, connection capability, rollout and instruments value-free', () => {
    const value = contract.unavailable();
    expect(value.fees).toEqual({
      providerFeeDisclosureState: 'unavailable',
      providerFeeDisclosureReason: 'provider_fee_disclosure_unavailable',
      providerFeeSchedule: null, feeMayBeAssumedZero: false,
      customerSurchargeSupported: false, customerSurchargeState: 'surcharge_unsupported',
    });
    expect(value.capability).toMatchObject({
      requiredCapability: 'customer_financial.provider.connect',
      controlMode: 'conditional_dual_control', currentGrantState: 'unavailable',
      currentGrantReason: 'provider_connection_capability_unavailable', currentGrant: null,
      connectionAuthorized: false, liveConnectionRequiresTwoDifferentCurrentHumans: true,
    });
    expect(value.rollout).toEqual({ stage: 'disabled', tenantFlagDefault: 'off',
      tenantFlagEnabled: false, providerAccountAvailable: false,
      paymentInitiationAuthorized: false, providerEventsAuthorized: false });
    expect(value.exclusions).toEqual({ partialProviderPaymentsSupported: false,
      multiInvoiceProviderPaymentsSupported: false, savedPaymentMethodsSupported: false,
      automaticCollectionSupported: false, rawPaymentInstrumentStorageSupported: false });
    expect(value).toMatchObject({ providerAccountCurrent: false,
      paymentInitiationAuthorized: false, paymentSuccessRecorded: false,
      settlementRecorded: false, providerCallCount: 0, receiverMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|secret|credentialValue|paymentInstrumentId|client_secret/i);
  });

  test('rejects policy widening, malformed projections and caller-authored availability', () => {
    const policy = JSON.parse(JSON.stringify(
      require('../../config/mission27-launch-contract.v1.json')));
    policy.financial.supportedOnlineMethods.push('bank_account');
    expect(() => contract.validateLaunchPolicy(policy)).toThrow(
      'Payment-provider launch policy is unavailable');
    const value = contract.unavailable();
    expect(() => contract.project({ ...value, providerCallCount: 1 })).toThrow();
    expect(() => contract.project({ ...value,
      provider: { ...value.provider, accountIdentity: 'caller-authored' } })).toThrow();
    expect(() => contract.project({ ...value, extra: true })).toThrow();
  });

  test('accepts only a current owner/admin session source and exposes no tenant identity', async () => {
    await expect(repository.read(source)).resolves.toEqual(contract.unavailable());
    await expect(repository.read({ ...source, actorAccessRole: 'admin' }))
      .resolves.toEqual(contract.unavailable());
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'member' },
      { ...source, organizationId: 'victim' }, { ...source, authSessionId: null }]) {
      await expect(repository.read(invalid)).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PAYMENT_PROVIDER_RESTRICTED', status: 403,
      });
    }
  });

  test('mounts one no-store read and no connection, onboarding, payment, demo or migration', () => {
    const route = read('src/routes/customerFinancialPaymentProvider.js');
    const server = read('src/server.js');
    const demo = read('src/routes/demo.js');
    expect(route).toContain("router.get('/', auth, role, throttle");
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(route).toContain("requireRole('owner','admin')");
    expect(route).toContain("res.set('Cache-Control', 'private, no-store')");
    expect(server).toContain("app.use('/api/v1/customer-financial/payment-provider'");
    expect(demo).not.toContain('customer-financial/payment-provider');
    const sourceCode = [read('src/customerFinancial/paymentProviderBoundary.js'),
      read('src/customerFinancial/paymentProviderBoundaryRepository.js'), route].join('\n');
    expect(sourceCode).not.toMatch(/fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|providerCall\(/i);
    const names = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name => /^273_/.test(name))).toBe(false);
  });
});
