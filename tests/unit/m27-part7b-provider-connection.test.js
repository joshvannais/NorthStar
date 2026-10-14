'use strict';

const fs = require('node:fs');
const path = require('node:path');
const base = require('../../src/customerFinancial/paymentProviderBoundary');
const contract = require('../../src/customerFinancial/paymentProviderConnection');
const repository = require('../../src/customerFinancial/paymentProviderConnectionRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 7B provider connection lifecycle boundary', () => {
  test('binds the exact released provider boundary and frozen owner-only policy', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-payment-provider-connection-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: base.POLICY_DIGEST,
      providerBoundaryVersion: 'm27-payment-provider-boundary-v1',
      providerBoundaryDigest: base.digest(base.unavailable()),
      state: 'unavailable', reason: 'provider_connection_prerequisites_unavailable', value: null,
      access: { eligibleAccessRole: 'owner', roleAloneAuthorizes: false,
        requiredCapability: 'customer_financial.provider.connect',
        requiredAssurance: 'recent_mfa', maximumRecentAuthenticationSeconds: 600,
        maximumMfaFreshnessSeconds: 600 },
      binding: { provider: 'stripe_connect', providerAccountShape: 'tenant_bound_contractor_account',
        tenantBound: true, providerAccountIdentity: null, supportedPolicyMode: 'test',
        activeMode: null, liveModeEnabled: false },
    });
    expect(contract.policy().team.adminDefaultCapabilities)
      .not.toContain('customer_financial.provider.connect');
  });

  test('keeps capability, MFA, account, mode, capability set and credentials value-free', () => {
    const value = contract.unavailable();
    expect(value.requirements.map(item => [item.requirement, item.state])).toEqual([
      ['current_owner_capability', 'unavailable'],
      ['server_owned_recent_authentication_fact', 'unavailable'],
      ['accepted_mfa_ceremony', 'unavailable'],
      ['exact_tenant_provider_account_identity', 'unavailable'],
      ['exact_provider_mode', 'unavailable'],
      ['exact_provider_capability_set', 'unavailable'],
      ['server_side_credential_authority', 'unavailable'],
    ]);
    expect(value.credentials).toEqual({
      storageBoundary: 'server_side_secret_reference_only',
      credentialAuthorityState: 'unavailable',
      credentialAuthorityReason: 'provider_credential_authority_unavailable',
      secretReference: null, rawSecretInputAccepted: false, rawSecretStored: false,
      secretValueReturned: false, browserCredentialExposure: false,
      rotationState: 'unavailable', revocationState: 'unavailable',
    });
    expect(value.instruments).toEqual({ rawCardCredentialStorageAuthorized: false,
      rawBankCredentialStorageAuthorized: false, savedPaymentMethodStorageAuthorized: false,
      browserInstrumentCollectionAuthorized: false });
    expect(value).toMatchObject({ connectionAuthorized: false,
      hostedOnboardingAuthorized: false, paymentInitiationAuthorized: false,
      providerCallCount: 0, providerMutationCount: 0, credentialMutationCount: 0,
      receiverMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|credentialValue|client_secret|paymentInstrumentId/i);
  });

  test('recognizes only exact test-mode lifecycle intent and authorizes none of it', () => {
    const value = contract.unavailable();
    expect(value.lifecycle.allowedPolicyOperations).toEqual(['connect','disconnect','rotate','revoke']);
    expect(value.lifecycle.operations.every(item => item.authorized === false)).toBe(true);
    expect(value.lifecycle).toMatchObject({ explicitReconnectOperation: 'connect',
      reconnectRequiresVerifiedDisconnectedPredecessor: true,
      automaticReconnectAuthorized: false });
    for (const operation of contract.OPERATIONS) {
      expect(contract.validateIntent({ operation, confirmed: true,
        reason: `Review ${operation} in test mode.` })).toMatchObject({ operation, confirmed: true });
    }
    for (const invalid of [null, {}, { operation: 'enable', confirmed: true,
      reason: 'Try live mode now.' }, { operation: 'reconnect', confirmed: true,
      reason: 'Reconnect automatically.' }, { operation: 'connect', confirmed: false,
      reason: 'Not confirmed by owner.' }, { operation: 'connect', confirmed: true, reason: 'short' },
    { operation: 'connect', confirmed: true, reason: 'Includes a forbidden secret.',
      credential: 'sk_test_forbidden' }]) {
      expect(() => contract.validateIntent(invalid)).toThrow('Review the provider lifecycle action.');
    }
  });

  test('repository permits only an exact owner source and every intent remains no-effect', async () => {
    await expect(repository.read(source)).resolves.toEqual(contract.unavailable());
    await expect(repository.attempt(source, { operation: 'disconnect', confirmed: true,
      reason: 'Explicitly disconnect this test account.' })).resolves.toEqual(contract.unavailable());
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'admin' },
      { ...source, organizationId: 'victim' }, { ...source, authSessionId: null }]) {
      await expect(repository.read(invalid)).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_RESTRICTED', status: 403,
      });
    }
  });

  test('mounts one private read and one value-free action boundary without provider code or migration 273', () => {
    const route = read('src/routes/customerFinancialProviderConnection.js');
    const server = read('src/server.js');
    const implementation = [read('src/customerFinancial/paymentProviderConnection.js'),
      read('src/customerFinancial/paymentProviderConnectionRepository.js'), route].join('\n');
    expect(route).toContain("requireRole('owner')");
    expect(route).toContain("router.get('/', auth, role, throttle");
    expect(route).toContain("router.post('/actions', auth, role, throttle");
    expect(route).toContain("res.set('Cache-Control', 'private, no-store')");
    expect(server).toContain("app.use('/api/v1/customer-financial/payment-provider/connection'");
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|providerCall\(|process\.env\.[A-Z_]*STRIPE/i);
    expect(read('src/routes/demo.js')).not.toContain('payment-provider/connection');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
