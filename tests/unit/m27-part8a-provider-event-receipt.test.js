'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const providerConnection = require('../../src/customerFinancial/paymentProviderConnection');
const contract = require('../../src/customerFinancial/paymentProviderEventReceipt');
const repository = require('../../src/customerFinancial/paymentProviderEventReceiptRepository');
const { createCustomerFinancialProviderEventReceiptRouter } =
  require('../../src/routes/customerFinancialProviderEventReceipt');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 8A provider-event receipt readiness', () => {
  test('binds exact released provider witnesses and the immutable receipt limits', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-provider-event-receipt-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      providerBoundaryVersion: 'm27-payment-provider-boundary-v1',
      providerBoundaryDigest: providerBoundary.digest(providerBoundary.unavailable()),
      providerConnectionVersion: 'm27-payment-provider-connection-v1',
      providerConnectionDigest: providerBoundary.digest(providerConnection.unavailable()),
      state: 'unavailable', reason: 'payment_provider_unavailable', value: null,
      receipt: { publicReceiptEndpointMounted: false, rawBodyRequired: true,
        maximumPayloadBytes: 262144, webhookClockToleranceSeconds: 300,
        authenticationState: 'unavailable', signingCredentialReference: null,
        signatureScheme: null, signatureVerified: false, rawPayloadAccepted: false,
        rawPayload: null, rawPayloadDigest: null },
      retention: { rawProviderEventDays: 30, retentionLaunchAuthorized: false,
        retentionReviewState: 'unavailable', payloadRetained: false,
        retentionExpiresAt: null, legalOrAuditHoldEvaluated: false },
    });
  });

  test('names every Part 8A prerequisite without inventing provider authority', () => {
    const value = contract.unavailable();
    expect(value.requirements.map(item => item.requirement)).toEqual([
      'exact_tenant_provider_account_identity',
      'server_side_webhook_signing_credential',
      'provider_specific_signature_verifier',
      'bounded_raw_provider_event_payload',
      'current_raw_provider_event_retention_authority',
      'unique_provider_event_identity',
      'exact_provider_account_and_mode_match',
      'replay_safe_provider_acknowledgement',
    ]);
    expect(value.requirements.every(item => item.state === 'unavailable')).toBe(true);
    expect(value.binding).toEqual({ provider: 'stripe_connect',
      providerAccountShape: 'tenant_bound_contractor_account', tenantBound: true,
      providerAccountIdentity: null, providerAccountMatchVerified: false,
      expectedMode: 'test', eventLivemode: null, livemodeAccepted: false,
      modeMatchVerified: false });
    expect(value.uniqueness).toEqual({ providerEventIdentity: null,
      providerEventIdentityState: 'unavailable', uniquenessClaimCreated: false,
      duplicateDetected: false, replayWindowEvaluated: false });
    expect(value.acknowledgement).toEqual({ replaySafeAcknowledgementAvailable: false,
      acknowledgementAttempted: false, acknowledgementStatus: null,
      providerRetryState: 'unavailable', providerMayRetry: null });
  });

  test('keeps normalization, allocation, settlement and all effects outside Part 8A', () => {
    const value = contract.unavailable();
    expect(value.downstream).toEqual({ normalizationAuthorized: false,
      invoiceAllocationAuthorized: false, paymentSuccessRecorded: false,
      captureRecorded: false, settlementRecorded: false, payoutRecorded: false,
      invoiceBalanceChanged: false, accountingAcknowledgementRecorded: false });
    expect(value).toMatchObject({ providerAccountCurrent: false, receiptRowCount: 0,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|client_secret|webhook_secret|acct_[a-z0-9]/i);
  });

  test('fails closed for widened policy or caller-authored receipt/provider state', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value,
      receipt: { ...value.receipt, signatureVerified: true } })).toThrow();
    expect(() => contract.project({ ...value,
      binding: { ...value.binding, providerAccountIdentity: 'acct_caller' } })).toThrow();
    expect(() => contract.project({ ...value,
      uniqueness: { ...value.uniqueness, uniquenessClaimCreated: true } })).toThrow();
    expect(() => contract.project({ ...value,
      downstream: { ...value.downstream, settlementRecorded: true } })).toThrow();
    expect(() => contract.unavailable({ ...providerBoundary.unavailable(), extra: true }))
      .toThrow('Payment-provider boundary invalid');
  });

  test('permits only an exact paid owner/admin source and consumes the Part 7A boundary', async () => {
    const readProviderBoundary = jest.fn().mockResolvedValue(providerBoundary.unavailable());
    await expect(repository.read(source, { readProviderBoundary }))
      .resolves.toEqual(contract.unavailable());
    await expect(repository.read({ ...source, actorAccessRole: 'admin' },
      { readProviderBoundary })).resolves.toEqual(contract.unavailable());
    expect(readProviderBoundary).toHaveBeenCalledTimes(2);
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'member' },
      { ...source, organizationId: 'victim' }, { ...source, authSessionId: null }]) {
      await expect(repository.read(invalid, { readProviderBoundary })).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PROVIDER_EVENT_RECEIPT_RESTRICTED', status: 403,
      });
    }
  });

  test('rejects query input before repository entry and mounts no public receipt mutation', async () => {
    const readBoundary = jest.fn();
    const app = express();
    app.use('/api/v1/customer-financial/payment-provider/event-receipt',
      createCustomerFinancialProviderEventReceiptRouter({
        auth: (req, _res, next) => { req.tenantContext = {
          organizationId: source.organizationId, userId: source.actorUserId };
        req.authSession = { id: source.authSessionId }; req.userRole = 'owner'; next(); },
        role: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
        read: readBoundary,
      }));
    const response = await request(app)
      .get('/api/v1/customer-financial/payment-provider/event-receipt' +
        '?signature=forged&account=acct_victim&livemode=true');
    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/forged|acct_victim|livemode=true/);
    expect(readBoundary).not.toHaveBeenCalled();
  });

  test('mounts one private read with no webhook, demo endpoint, transport, table or migration 273', () => {
    const route = read('src/routes/customerFinancialProviderEventReceipt.js');
    const server = read('src/server.js');
    const demo = read('src/routes/demo.js');
    const implementation = [read('src/customerFinancial/paymentProviderEventReceipt.js'),
      read('src/customerFinancial/paymentProviderEventReceiptRepository.js'), route].join('\n');
    expect(route).toContain("requireRole('owner', 'admin')");
    expect(route).toContain("router.get('/', auth, role, throttle");
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(server).toContain(
      "app.use('/api/v1/customer-financial/payment-provider/event-receipt'");
    expect(demo).not.toContain('payment-provider/event-receipt');
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|constructEvent|checkout\.sessions|paymentIntents|process\.env\.[A-Z_]*STRIPE/i);
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
