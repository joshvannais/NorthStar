'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const providerConnection = require('../../src/customerFinancial/paymentProviderConnection');
const publicSession = require('../../src/customerFinancial/invoicePublicSession');
const publicSessionRepository = require('../../src/customerFinancial/invoicePublicSessionRepository');
const contract = require('../../src/customerFinancial/paymentInitiationPlan');
const repository = require('../../src/customerFinancial/paymentInitiationPlanRepository');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 7C exact payment-initiation plan boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  test('binds the frozen one-invoice customer path and exact amount policy', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-payment-initiation-plan-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'issued_invoice_unavailable', value: null,
      authority: { capability: 'customer_financial.payment.initiate',
        actionMode: 'customer_scoped_only', customerPathPolicySupported: true,
        customerPathCurrent: false, staffPathSupported: false,
        staffPathState: 'staff_payment_initiation_unsupported',
        ownerOrAdministratorMaySubstituteForCustomerSession: false, roleAloneAuthorizes: false },
      planPolicy: { invoiceCount: 'exactly_one', partialProviderPaymentsSupported: false,
        multiInvoiceProviderPaymentsSupported: false, currency: 'USD', method: 'card',
        checkout: 'provider_hosted_direct_charge', minimumMinorUnits: '50',
        maximumMinorUnits: '10000000', invoiceMaximumMinorUnits: '10000000',
        amountMustEqualAllocationTotal: true, allocationMayExceedCurrentBalance: false,
        missingAmountMayBeTreatedAsZero: false, exactZeroInvoiceIsDistinctFromUnavailable: true },
    });
    expect(value.sourceWitnesses).toEqual({
      invoicePublicSessionContractVersion: publicSession.CONTRACT_VERSION,
      invoicePublicSessionDigest: providerBoundary.digest(publicSession.unavailable('paid')),
      providerConnectionContractVersion: providerConnection.CONTRACT_VERSION,
      providerConnectionDigest: providerBoundary.digest(providerConnection.unavailable()),
    });
  });

  test('keeps every unavailable plan value null and every effect false or zero', () => {
    const value = contract.unavailable();
    expect(value.requirements.map(item => [item.requirement, item.state, item.reason])).toEqual([
      ['one_exact_current_issued_invoice','unavailable','issued_invoice_unavailable'],
      ['current_scoped_customer_session','unavailable','invoice_public_session_unavailable'],
      ['immutable_exact_allocation','unavailable','issued_balance_unavailable'],
      ['current_tenant_provider_connection','unavailable','provider_connection_prerequisites_unavailable'],
      ['hosted_checkout','unavailable','provider_connection_prerequisites_unavailable'],
      ['exact_amount_currency_invoice_digest','unavailable','issued_balance_unavailable'],
      ['bounded_expiration','not_created','payment_plan_not_authorized'],
      ['idempotency_receipt','not_created','payment_plan_not_authorized'],
      ['exact_return_and_cancel_boundaries','not_created','payment_plan_not_authorized'],
    ]);
    expect(Object.values(value.plan).every(item => item === null)).toBe(true);
    expect(value).toMatchObject({ exactCurrentnessRevalidated: true,
      paymentInitiationAuthorized: false, providerSessionCreated: false,
      providerReturnAuthorizesPayment: false, rawPaymentInstrumentAccepted: false,
      rawPaymentInstrumentStored: false, browserProviderSecretExposed: false,
      paymentSuccessRecorded: false, settlementRecorded: false,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|customerId|client_secret|payment_method|sk_test/i);
  });

  test('strict projection rejects caller-authored plan values or substituted source evidence', () => {
    const changedAmount = structuredClone(contract.unavailable());
    changedAmount.plan.amountMinorUnits = '50';
    expect(() => contract.project(changedAmount)).toThrow('Payment-initiation plan boundary invalid');
    const changedConnection = structuredClone(providerConnection.unavailable());
    changedConnection.binding.activeMode = 'test';
    expect(() => contract.unavailable(publicSession.unavailable('paid'), changedConnection))
      .toThrow('Payment-provider connection boundary invalid');
    const demoSession = publicSession.unavailable('demo');
    expect(() => contract.unavailable(demoSession, providerConnection.unavailable()))
      .toThrow('Invoice public-session boundary invalid');
  });

  test('repository revalidates the exact paid public-session source and makes no provider call', async () => {
    const sessionRead = jest.spyOn(publicSessionRepository, 'read')
      .mockResolvedValue(publicSession.unavailable('paid'));
    const result = await repository.read({}, source, 'estimate', 'receipt', 'digest');
    expect(result).toEqual(contract.unavailable());
    expect(sessionRead).toHaveBeenCalledWith({}, source, 'estimate', 'receipt', 'digest');
    sessionRead.mockResolvedValue({ ...publicSession.unavailable('paid'), customerSessionCreated: true });
    await expect(repository.read({}, source, 'estimate', 'receipt', 'digest')).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_PAYMENT_INITIATION_UNAVAILABLE', status: 503,
    });
  });

  test('mounts one private exact-query read and no initiation action route', async () => {
    const paymentInitiationPlanRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.tenantContext = { organizationId: source.organizationId, userId: source.actorUserId };
      req.userRole = 'owner'; req.authSession = { id: source.authSessionId }; next();
    });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({
        poolProvider: () => ({}), paymentInitiationPlanRead,
        auth: (_req,_res,next) => next(), role: (_req,_res,next) => next(),
        throttle: (_req,_res,next) => next(),
      }));
    const route = '/api/v1/customer-financial/editable-estimates/estimate/payment-initiation-plan';
    const invalid = await request(app).get(route + '?handoffReceiptId=receipt');
    expect(invalid.status).toBe(400); expect(paymentInitiationPlanRead).not.toHaveBeenCalled();
    const ok = await request(app).get(route)
      .query({ handoffReceiptId: 'receipt', handoffReceiptDigest: 'digest' });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(paymentInitiationPlanRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route).send({ amount: '50' })).status).toBe(404);
  });

  test('contains no provider transport, action, public route, browser secret or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/paymentInitiationPlan.js'),
      read('src/customerFinancial/paymentInitiationPlanRepository.js'), route].join('\n');
    expect(route).toContain("router.get('/:estimateId/payment-initiation-plan', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/payment-initiation-plan'");
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|process\.env\.[A-Z_]*STRIPE/i);
    expect(read('src/routes/demo.js')).not.toContain('payment-initiation-plan');
    expect(read('src/server.js')).not.toContain('payment-initiation-plan');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
