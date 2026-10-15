'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const initiationPlan = require('../../src/customerFinancial/paymentInitiationPlan');
const settlementPayout = require('../../src/customerFinancial/paymentSettlementPayout');
const contract = require('../../src/customerFinancial/paymentAttemptAllocationOverpayment');
const repository = require('../../src/customerFinancial/paymentAttemptAllocationOverpaymentRepository');
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

describe('Mission 27 Part 9A payment attempts, allocation and overpayment readiness', () => {
  test('consumes exact Part 7C and Part 8D witnesses under the frozen launch shape', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-payment-attempt-allocation-overpayment-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'payment_attempt_evidence_unavailable', value: null,
      access: { eligibleAccessRoles: ['owner','admin'],
        roleAloneAuthorizesAttemptOrAllocation: false,
        customerPaymentSessionCurrent: false, staffMaySubstituteForCustomerSession: false,
        postPaymentAllocationCreatesInitiationAuthority: false },
      launchSupport: { currency: 'USD', method: 'card', invoiceCount: 'exactly_one',
        supportedPlanShape: 'one_exact_full_balance_invoice',
        partialProviderPaymentsSupported: false, multiInvoiceProviderPaymentsSupported: false,
        partialPaymentState: 'partial_payments_unsupported',
        multiInvoicePaymentState: 'multi_invoice_payments_unsupported',
        callerMayBroadenPlanShape: false },
    });
    expect(value.sourceWitnesses).toEqual({
      paymentInitiationPlanVersion: initiationPlan.CONTRACT_VERSION,
      paymentInitiationPlanDigest: providerBoundary.digest(initiationPlan.unavailable()),
      settlementPayoutReconciliationVersion: settlementPayout.CONTRACT_VERSION,
      settlementPayoutReconciliationDigest:
        providerBoundary.digest(settlementPayout.unavailable()),
    });
  });

  test('freezes exact attempt, race and overpayment semantics without widening initiation', () => {
    const value = contract.unavailable();
    expect(value.attemptPolicy).toEqual({
      eachAttemptRequiresDistinctProviderIdentity: true,
      eachAttemptMustBindExactAcceptedPlan: true,
      sameIdempotencyReceiptMayNotCreateSecondAttempt: true,
      duplicateOrReplayMayNotReapplyAllocation: true,
      providerAttemptMayNotExpandAcceptedAmountOrInvoiceSet: true,
      postPaymentAllocationMayNotExpandAcceptedAmountOrInvoiceSet: true,
      missingAttemptAmountOrBalanceMayNotBecomeZero: true,
      arrivalOrderIsAuthority: false,
    });
    expect(value.raceAndOverpaymentPolicy).toEqual({
      exactProviderOccurrenceSequenceAndCurrentSnapshotRequired: true,
      concurrentSettlementsReconciledIndividually: true,
      settledMoneyCannotBeRefusedRetroactively: true,
      settlementMayNotCreateRetroactiveInitiationAuthority: true,
      settledAmountWithinAcceptedCurrentBalanceMayApplyOnlyToExactAcceptedAllocation: true,
      amountBeyondAcceptedCurrentBalanceMayReduceAnotherInvoice: false,
      amountBeyondAcceptedCurrentBalanceBecomesRevenue: false,
      amountBeyondAcceptedCurrentBalanceDisposition: 'unapplied_credit_refund_review',
      unappliedCreditMayBeSilentlyRefunded: false,
      refundRequestMayBeTreatedAsCompletedRefund: false,
      refundMustReturnToOriginalCardCharge: true,
      refundMaximumMinorUnitsPerAction: '10000000',
      cumulativeRefundMaximum: 'refundable_remainder',
    });
  });

  test('requires exact initiated lineage, attempt evidence, balances and reviewed disposition', () => {
    const value = contract.unavailable();
    expect(value.requirements.map(item => [item.requirement,item.state,item.reason,item.value]))
      .toEqual([
        ['current_exact_launch_approved_payment_initiation_plan','unavailable',
          'payment_initiation_plan_unavailable',null],
        ['exact_accepted_amount_currency_invoice_set_and_version_digests','unavailable',
          'issued_invoice_unavailable',null],
        ['immutable_exact_initiated_allocation','unavailable','issued_balance_unavailable',null],
        ['current_scoped_customer_session_and_provider_checkout','unavailable',
          'payment_session_unavailable',null],
        ['unique_provider_attempt_identity_and_exact_plan_lineage','unavailable',
          'provider_payment_identity_unavailable',null],
        ['accepted_current_attempt_evidence_and_occurrence_order','unavailable',
          'accepted_payment_evidence_unavailable',null],
        ['duplicate_replay_and_idempotency_disposition','unavailable',
          'provider_reconciliation_unavailable',null],
        ['current_exact_invoice_balances_and_projection_revision','unavailable',
          'issued_balance_unavailable',null],
        ['accepted_settlement_evidence_for_each_concurrent_attempt','unavailable',
          'settlement_unavailable',null],
        ['exact_overpayment_amount_currency_and_source_lineage','unavailable',
          'accepted_payment_evidence_unavailable',null],
        ['append_only_unapplied_credit_disposition','unavailable','refund_unavailable',null],
        ['owner_reviewed_original_charge_refund_request','unavailable','refund_unavailable',null],
      ]);
  });

  test('keeps every value unavailable and every payment, allocation, credit and refund effect false', () => {
    const value = contract.unavailable();
    expect(Object.values(value.projection).every(item => item === null)).toBe(true);
    expect(Object.values(value.authority).every(item => item === false)).toBe(true);
    expect(Object.values(value.privacy).every(item => item === false)).toBe(true);
    expect(value).toMatchObject({ exactCurrentnessRevalidated: true,
      paymentAttemptRowCount: 0, allocationRowCount: 0, unappliedCreditRowCount: 0,
      refundReviewRowCount: 0, providerCallCount: 0, providerMutationCount: 0,
      receiverMutationCount: 0, accountingMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|customerId|client_secret|acct_caller|evt_caller|pi_caller|ch_caller|re_caller/i);
  });

  test('strict projection rejects unsupported plan shapes, contradictions, leakage and inferred zero', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value,
      requirements: [...value.requirements].reverse() })).toThrow();
    expect(() => contract.project({ ...value, launchSupport: { ...value.launchSupport,
      partialProviderPaymentsSupported: true } })).toThrow();
    expect(() => contract.project({ ...value, attemptPolicy: { ...value.attemptPolicy,
      arrivalOrderIsAuthority: true } })).toThrow();
    expect(() => contract.project({ ...value,
      raceAndOverpaymentPolicy: { ...value.raceAndOverpaymentPolicy,
        amountBeyondAcceptedCurrentBalanceBecomesRevenue: true } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, overpaymentMinorUnits: '0' } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, attemptIdentities: ['pi_caller'] } })).toThrow();
    expect(() => contract.unavailable({ ...initiationPlan.unavailable(),
      planPolicy: { ...initiationPlan.unavailable().planPolicy,
        multiInvoiceProviderPaymentsSupported: true } }, settlementPayout.unavailable())).toThrow();
    expect(() => contract.unavailable(initiationPlan.unavailable(), {
      ...settlementPayout.unavailable(), authority: {
        ...settlementPayout.unavailable().authority, settlementRecorded: true },
    })).toThrow();
  });

  test('repository consumes exact sources and fails closed before any projection', async () => {
    const readInitiationPlan = jest.fn().mockResolvedValue(initiationPlan.unavailable());
    const readSettlementPayout = jest.fn().mockResolvedValue(settlementPayout.unavailable());
    const result = await repository.read({}, source, 'estimate', 'receipt', 'digest',
      { readInitiationPlan, readSettlementPayout });
    expect(result).toEqual(contract.unavailable());
    expect(readInitiationPlan).toHaveBeenCalledWith({}, source, 'estimate', 'receipt', 'digest');
    expect(readSettlementPayout).toHaveBeenCalledWith({}, source, 'estimate', 'receipt', 'digest');
    readSettlementPayout.mockClear();
    readInitiationPlan.mockResolvedValue({ ...initiationPlan.unavailable(),
      plan: { ...initiationPlan.unavailable().plan, amountMinorUnits: '5000' } });
    await expect(repository.read({}, source, 'estimate', 'receipt', 'digest',
      { readInitiationPlan, readSettlementPayout })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_PAYMENT_ATTEMPT_ALLOCATION_UNAVAILABLE', status: 503,
    });
    expect(readSettlementPayout).not.toHaveBeenCalled();
  });

  test('mounts one private exact-query read and rejects caller payment data before entry', async () => {
    const paymentAttemptAllocationOverpaymentRead =
      jest.fn().mockResolvedValue(contract.unavailable());
    const app = express();
    app.use(express.json());
    app.use((req,_res,next) => { req.tenantContext = {
      organizationId: source.organizationId, userId: source.actorUserId };
    req.userRole = 'owner'; req.authSession = { id: source.authSessionId }; next(); });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
        paymentAttemptAllocationOverpaymentRead, auth: (_req,_res,next) => next(),
        role: (_req,_res,next) => next(), throttle: (_req,_res,next) => next() }));
    const route = '/api/v1/customer-financial/editable-estimates/estimate/' +
      'payment-attempt-allocation-overpayment';
    const receiptId = '44444444-4444-4444-8444-444444444444';
    const receiptDigest = 'a'.repeat(64);
    const invalid = await request(app).get(route).query({ handoffReceiptId: receiptId,
      handoffReceiptDigest: receiptDigest, invoiceIds: 'inv_victim,inv_other',
      paymentAttemptId: 'pi_victim', amountMinorUnits: '5000', overpayment: '200' });
    expect(invalid.status).toBe(400);
    expect(paymentAttemptAllocationOverpaymentRead).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toMatch(/inv_victim|pi_victim|5000|200/);
    for (const query of [{ handoffReceiptId: '', handoffReceiptDigest: receiptDigest },
      { handoffReceiptId: ` ${receiptId}`, handoffReceiptDigest: receiptDigest },
      { handoffReceiptId: receiptId, handoffReceiptDigest: 'not-a-digest' }]) {
      expect((await request(app).get(route).query(query)).status).toBe(400);
    }
    expect(paymentAttemptAllocationOverpaymentRead).not.toHaveBeenCalled();
    const ok = await request(app).get(route)
      .query({ handoffReceiptId: receiptId, handoffReceiptDigest: receiptDigest });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(paymentAttemptAllocationOverpaymentRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route)
      .send({ amountMinorUnits: '5000', invoiceIds: ['inv_victim'] })).status).toBe(404);
  });

  test('adds no transport, public/demo action, table or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/paymentAttemptAllocationOverpayment.js'),
      read('src/customerFinancial/paymentAttemptAllocationOverpaymentRepository.js'), route]
      .join('\n');
    expect(route).toContain(
      "router.get('/:estimateId/payment-attempt-allocation-overpayment', auth, role, throttle");
    expect(route).not.toContain(
      "router.post('/:estimateId/payment-attempt-allocation-overpayment'");
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|paymentIntents\.|refunds\.|process\.env\.[A-Z_]*STRIPE/i);
    expect(read('src/routes/demo.js')).not.toContain('payment-attempt-allocation-overpayment');
    expect(read('src/server.js')).not.toContain('payment-attempt-allocation-overpayment');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
