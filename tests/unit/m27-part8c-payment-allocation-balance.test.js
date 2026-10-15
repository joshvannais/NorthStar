'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const initiationPlan = require('../../src/customerFinancial/paymentInitiationPlan');
const eventNormalization = require('../../src/customerFinancial/paymentProviderEventNormalization');
const contract = require('../../src/customerFinancial/paymentAllocationBalance');
const repository = require('../../src/customerFinancial/paymentAllocationBalanceRepository');
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

describe('Mission 27 Part 8C exact allocation and balance readiness', () => {
  test('binds exact Part 7C and 8B witnesses to the frozen allocation policy', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-payment-allocation-balance-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'accepted_payment_evidence_unavailable', value: null,
      access: { eligibleAccessRoles: ['owner', 'admin'], roleAloneAuthorizesAllocation: false,
        authenticatedProviderProjectionIsHumanAction: false,
        manualReconciliationCapability: 'customer_financial.payment.reconcile',
        manualReconciliationControlMode: 'dual_control', singleControlAllowed: false },
      allocationPolicy: { invoiceCount: 'exactly_one',
        partialProviderPaymentsSupported: false, multiInvoiceProviderPaymentsSupported: false,
        currency: 'USD', method: 'card', minimumMinorUnits: '50',
        maximumMinorUnits: '10000000', invoiceMaximumMinorUnits: '10000000',
        amountMustEqualAllocationTotal: true, allocationMayExceedCurrentBalance: false,
        missingAmountMayBeTreatedAsZero: false, exactZeroInvoiceIsDistinctFromUnavailable: true,
        callerMaySelectInvoiceOrAmount: false, providerEvidenceMaySelectDifferentInvoice: false,
        automaticForeignExchangeSupported: false },
    });
    expect(value.sourceWitnesses).toEqual({
      paymentInitiationPlanVersion: initiationPlan.CONTRACT_VERSION,
      paymentInitiationPlanDigest: providerBoundary.digest(initiationPlan.unavailable()),
      providerEventNormalizationVersion: eventNormalization.CONTRACT_VERSION,
      providerEventNormalizationDigest: providerBoundary.digest(eventNormalization.unavailable()),
    });
  });

  test('requires one exact current invoice and accepted current payment evidence', () => {
    const value = contract.unavailable();
    expect(value.requirements.map(item => [item.requirement, item.state, item.reason])).toEqual([
      ['one_exact_current_issued_invoice','unavailable','issued_invoice_unavailable'],
      ['current_immutable_payment_initiation_plan','unavailable','payment_initiation_plan_unavailable'],
      ['accepted_current_normalized_payment_evidence','unavailable','provider_event_normalization_unavailable'],
      ['exact_tenant_provider_account_and_mode','unavailable','provider_account_mode_unavailable'],
      ['exact_provider_payment_object_identity','unavailable','provider_payment_identity_unavailable'],
      ['exact_invoice_amount_currency_and_digest','unavailable','issued_balance_unavailable'],
      ['unique_nonduplicate_event_and_payment_identity','unavailable','provider_event_uniqueness_unavailable'],
      ['exact_plan_session_and_idempotency_binding','unavailable','payment_session_unavailable'],
      ['current_unapplied_invoice_balance_revision','unavailable','issued_balance_unavailable'],
    ]);
    expect(value.matching).toEqual({ acceptedPaymentEvidenceState: 'unavailable',
      normalizedEvidenceAccepted: false, exactTenantMatch: false,
      exactProviderAccountMatch: false, exactProviderModeMatch: false,
      exactPaymentObjectMatch: false, exactInvoiceMatch: false, exactCurrencyMatch: false,
      exactAmountMatch: false, exactInitiationPlanMatch: false,
      duplicateDispositionState: 'unavailable', duplicateDetected: null,
      unmatchedEvidenceRejected: true });
  });

  test('keeps unavailable money null and rejects every mismatch without an effect', () => {
    const value = contract.unavailable();
    expect(Object.entries(value.projection).filter(([, field]) => field !== 'unavailable')
      .every(([, field]) => field === null)).toBe(true);
    expect(value.safeguards).toEqual({ duplicateMayChangeBalance: false,
      replayMayChangeBalance: false, wrongTenantMayChangeBalance: false,
      wrongProviderAccountMayChangeBalance: false, wrongCurrencyMayChangeBalance: false,
      wrongAmountMayChangeBalance: false, unmatchedEventMayChangeBalance: false,
      stalePlanMayChangeBalance: false, browserReturnMayMarkInvoicePaid: false,
      paymentSuccessMayImplySettlement: false, capturedPaymentMayImplySettledCash: false,
      missingEvidenceMayBecomeZero: false, manualMismatchMayBypassDualControl: false,
      manualAllocationMayBypassDualControl: false });
    expect(Object.values(value.authority).every(field => field === false)).toBe(true);
    expect(value).toMatchObject({ exactCurrentnessRevalidated: true, allocationRowCount: 0,
      balanceProjectionRowCount: 0, providerCallCount: 0, providerMutationCount: 0,
      receiverMutationCount: 0, accountingMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|customerId|client_secret|acct_[a-z0-9]|evt_[a-z0-9]|pi_[a-z0-9]/i);
  });

  test('strict projection rejects reordered, contradictory, leaked or caller-authored values', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value,
      requirements: [...value.requirements].reverse() })).toThrow();
    expect(() => contract.project({ ...value,
      matching: { ...value.matching, exactTenantMatch: true } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, allocatedMinorUnits: '0' } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, providerPaymentIdentity: 'pi_caller' } })).toThrow();
    expect(() => contract.project({ ...value,
      safeguards: { ...value.safeguards, duplicateMayChangeBalance: true } })).toThrow();
    expect(() => contract.unavailable({ ...initiationPlan.unavailable(),
      paymentSuccessRecorded: true }, eventNormalization.unavailable())).toThrow();
    expect(() => contract.unavailable(initiationPlan.unavailable(), {
      ...eventNormalization.unavailable(), downstream: {
        ...eventNormalization.unavailable().downstream, invoiceBalanceChanged: true,
      },
    })).toThrow();
  });

  test('repository consumes both exact sources and fails closed on substitution', async () => {
    const readPlan = jest.fn().mockResolvedValue(initiationPlan.unavailable());
    const readNormalization = jest.fn().mockResolvedValue(eventNormalization.unavailable());
    const result = await repository.read({}, source, 'estimate', 'receipt', 'digest',
      { readPlan, readNormalization });
    expect(result).toEqual(contract.unavailable());
    expect(readPlan).toHaveBeenCalledWith({}, source, 'estimate', 'receipt', 'digest');
    expect(readNormalization).toHaveBeenCalledWith(source);
    readNormalization.mockResolvedValue({ ...eventNormalization.unavailable(),
      normalization: { ...eventNormalization.unavailable().normalization,
        normalizedState: 'succeeded' } });
    await expect(repository.read({}, source, 'estimate', 'receipt', 'digest',
      { readPlan, readNormalization })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_PAYMENT_ALLOCATION_UNAVAILABLE', status: 503,
    });
  });

  test('mounts one private exact-query read and rejects caller money before repository entry', async () => {
    const paymentAllocationBalanceRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.tenantContext = { organizationId: source.organizationId, userId: source.actorUserId };
      req.userRole = 'owner'; req.authSession = { id: source.authSessionId }; next();
    });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
        paymentAllocationBalanceRead, auth: (_req,_res,next) => next(),
        role: (_req,_res,next) => next(), throttle: (_req,_res,next) => next() }));
    const route = '/api/v1/customer-financial/editable-estimates/estimate/payment-allocation-balance';
    const invalid = await request(app).get(route).query({ handoffReceiptId: 'receipt',
      handoffReceiptDigest: 'digest', amountMinorUnits: '50', currency: 'USD',
      providerAccountId: 'acct_victim', paymentId: 'pi_victim' });
    expect(invalid.status).toBe(400); expect(paymentAllocationBalanceRead).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toMatch(/50|USD|acct_victim|pi_victim/);
    const ok = await request(app).get(route)
      .query({ handoffReceiptId: 'receipt', handoffReceiptDigest: 'digest' });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(paymentAllocationBalanceRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route).send({ amountMinorUnits: '50' })).status).toBe(404);
  });

  test('adds no transport, public/demo action, table or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/paymentAllocationBalance.js'),
      read('src/customerFinancial/paymentAllocationBalanceRepository.js'), route].join('\n');
    expect(route).toContain(
      "router.get('/:estimateId/payment-allocation-balance', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/payment-allocation-balance'");
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|checkout\.sessions|paymentIntents|process\.env\.[A-Z_]*STRIPE/i);
    expect(read('src/routes/demo.js')).not.toContain('payment-allocation-balance');
    expect(read('src/server.js')).not.toContain('payment-allocation-balance');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
