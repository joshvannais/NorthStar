'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const money = require('../../src/customerFinancial/exactMoney');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const paymentAttempt = require('../../src/customerFinancial/paymentAttemptAllocationOverpayment');
const contract = require('../../src/customerFinancial/depositApplication');
const repository = require('../../src/customerFinancial/depositApplicationRepository');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ID = Object.freeze({
  organization: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  session: '33333333-3333-4333-8333-333333333333',
  estimate: '44444444-4444-4444-8444-444444444444',
  customer: '55555555-5555-4555-8555-555555555555',
  receipt: '66666666-6666-4666-8666-666666666666',
  origin: '77777777-7777-4777-8777-777777777777',
});
const source = Object.freeze({ organizationId: ID.organization, actorUserId: ID.actor,
  actorAccessRole: 'owner', authSessionId: ID.session });
const digest = character => character.repeat(64);

function depositOrigin(amount = '250000') {
  const exact = money.fromMinorUnits(amount);
  return {
    contractVersion: 'm27-invoice-draft-origin-v1', state: 'current',
    originId: ID.origin, originDigest: digest('a'), candidateDigest: digest('b'),
    estimateId: ID.estimate, customerId: ID.customer, handoffReceiptId: ID.receipt,
    handoffReceiptDigest: digest('c'), decisionDigest: digest('d'),
    commercialBasisDigest: digest('e'), currency: 'USD', sourceCurrent: true,
    invoiceAuthorized: false, receivableAuthorized: false, issueAuthorized: false,
    lines: [{ ordinal: 0, lineDigest: digest('f'), kind: 'mission24_accepted_deposit',
      description: 'Accepted Mission 24 pre-work deposit',
      quantity: { value: '1', unit: 'accepted_deposit' }, unitAmount: exact,
      lineAmount: exact }],
    subtotalBeforeTax: exact, tax: { state: 'unavailable', value: null },
    amountDue: { state: 'unavailable', value: null }, providerCallCount: 0,
    receiverMutationCount: 0,
  };
}

function finalBalanceOrigin() {
  const exact = money.fromMinorUnits('500000');
  return { ...depositOrigin('500000'),
    lines: [{ ...depositOrigin('500000').lines[0], kind: 'mission24_customer_safe_charge',
      description: 'Accepted final-balance charge',
      quantity: { value: '1', unit: 'customer_safe_charge' } }],
    subtotalBeforeTax: exact };
}

describe('Mission 27 Part 9B deposit-application readiness', () => {
  test('binds an exact accepted Mission 24 deposit origin without exposing its identity or amount', () => {
    const origin = depositOrigin();
    const attempt = paymentAttempt.unavailable();
    const value = contract.unavailable(origin, attempt);
    expect(contract.projectWithSources(JSON.parse(JSON.stringify(value)), origin, attempt))
      .toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-deposit-application-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'deposit_payment_evidence_unavailable', value: null,
      sourceWitnesses: {
        invoiceDraftOriginVersion: 'm27-invoice-draft-origin-v1',
        invoiceDraftOriginDigest: providerBoundary.digest(origin),
        paymentAttemptAllocationVersion: paymentAttempt.CONTRACT_VERSION,
        paymentAttemptAllocationDigest: providerBoundary.digest(attempt),
      },
      depositPolicy: { launchSupported: true, exactCurrentMission24ScheduleRequired: true,
        maximumBasisPoints: 5000, maximumMinorUnits: '2500000',
        separateInvoiceRequired: true, scheduleCurrent: true, scheduleIsPaymentReceipt: false,
        acceptedNativeDepositPaymentReceiptRequired: true,
        exactReceiptScheduleAndInvoiceLineageRequired: true, applyExactlyOnce: true,
        missingReceiptAmountOrFinalBalanceMayBecomeZero: false,
        finalBalanceMayDoubleCountDeposit: false, paymentApplicationMayClaimJobCompletion: false },
    });
    expect(JSON.stringify(value)).not.toMatch(
      /"250000"|77777777|accepted mission 24 pre-work deposit/i);
  });

  test('keeps progress, milestone and earned-revenue authority explicitly unavailable', () => {
    const value = contract.unavailable(depositOrigin());
    expect(value.unsupportedApplication).toEqual({
      progressBillingSupported: false, milestoneBillingSupported: false,
      milestoneOrProgressSourceAuthorityAvailable: false,
      missingAuthority: 'separately_accepted_mission23_work_package_source',
      depositScheduleMayAuthorizeMilestoneOrProgressApplication: false,
      earnedRevenueAuthorityAvailable: false,
      invoicePaymentOrCompletionCanDecideEarnedRevenue: false,
    });
    expect(value.access).toEqual({ eligibleAccessRoles: ['owner','admin'],
      roleAloneAuthorizesDepositApplication: false,
      explicitCapabilityAuthorizedHumanReviewRequired: true,
      staffMaySubstituteForAcceptedPaymentEvidence: false,
      completionEvidenceRequiredForPreWorkDeposit: false,
      completionEvidenceMaySubstituteForPaymentReceipt: false });
  });

  test('requires schedule, separate invoice, accepted receipt and exactly-once final-balance lineage', () => {
    const value = contract.unavailable(depositOrigin());
    expect(value.requirements.map(item =>
      [item.requirement,item.state,item.reason,item.value])).toEqual([
      ['exact_current_mission24_accepted_deposit_schedule','current',null,null],
      ['explicit_capability_authorized_human_review','current',null,null],
      ['separate_current_deposit_invoice','unavailable','issued_deposit_invoice_unavailable',null],
      ['accepted_native_deposit_payment_receipt','unavailable',
        'accepted_deposit_payment_evidence_unavailable',null],
      ['exact_receipt_schedule_and_invoice_lineage','unavailable',
        'accepted_deposit_payment_evidence_unavailable',null],
      ['exact_currency_and_amount_within_schedule_and_launch_bounds','unavailable',
        'accepted_deposit_payment_evidence_unavailable',null],
      ['current_part9a_duplicate_race_and_allocation_disposition','unavailable',
        'payment_attempt_evidence_unavailable',null],
      ['exactly_once_deposit_application_identity_and_idempotency','unavailable',
        'deposit_application_receipt_unavailable',null],
      ['exact_final_balance_carry_forward_without_double_counting','unavailable',
        'issued_balance_unavailable',null],
      ['accepted_mission23_milestone_or_work_package_source','unavailable',
        'separately_accepted_mission23_work_package_source',null],
    ]);
  });

  test('never treats a final-balance origin, schedule, completion, or missing values as payment', () => {
    const final = contract.unavailable(finalBalanceOrigin());
    expect(final.depositPolicy.scheduleCurrent).toBe(false);
    expect(final.requirements.slice(0,2).map(item => item.state))
      .toEqual(['unavailable','unavailable']);
    expect(Object.values(final.projection).every(value => value === null)).toBe(true);
    expect(Object.values(final.authority).every(value => value === false)).toBe(true);
    expect(Object.values(final.privacy).every(value => value === false)).toBe(true);
    expect(final).toMatchObject({ depositApplicationRowCount: 0, finalBalanceMutationCount: 0,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      accountingMutationCount: 0, liveMoneyMovementCount: 0 });
  });

  test('fails closed on over-bound, mixed, malformed or contradictory source contracts', () => {
    expect(() => contract.unavailable(depositOrigin('2500001'))).toThrow();
    const mixed = depositOrigin();
    mixed.lines.push({ ...mixed.lines[0], ordinal: 1, lineDigest: digest('1'),
      kind: 'mission24_customer_safe_charge',
      quantity: { value: '1', unit: 'customer_safe_charge' } });
    mixed.subtotalBeforeTax = money.fromMinorUnits('500000');
    expect(() => contract.unavailable(mixed)).toThrow();
    const value = contract.unavailable(depositOrigin());
    expect(() => contract.projectWithSources({ ...value,
      depositPolicy: { ...value.depositPolicy, finalBalanceMayDoubleCountDeposit: true } },
    depositOrigin(), paymentAttempt.unavailable())).toThrow();
    expect(() => contract.unavailable(depositOrigin(), { ...paymentAttempt.unavailable(),
      authority: { ...paymentAttempt.unavailable().authority, invoiceBalanceChangeAuthorized: true } }))
      .toThrow();
  });

  test('repository validates the reviewed origin before reading the Part 9A witness', async () => {
    const readInvoiceDraftOrigin = jest.fn().mockResolvedValue(depositOrigin());
    const readPaymentAttempt = jest.fn().mockResolvedValue(paymentAttempt.unavailable());
    const result = await repository.read({}, source, ID.estimate, ID.receipt, digest('c'),
      { readInvoiceDraftOrigin, readPaymentAttempt });
    expect(result).toEqual(contract.unavailable(depositOrigin()));
    expect(readInvoiceDraftOrigin).toHaveBeenCalledWith(
      {}, source, ID.estimate, ID.receipt, digest('c'));
    expect(readPaymentAttempt).toHaveBeenCalledWith(
      {}, source, ID.estimate, ID.receipt, digest('c'));
    readPaymentAttempt.mockClear();
    readInvoiceDraftOrigin.mockResolvedValue(depositOrigin('2500001'));
    await expect(repository.read({}, source, ID.estimate, ID.receipt, digest('c'),
      { readInvoiceDraftOrigin, readPaymentAttempt })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_DEPOSIT_APPLICATION_UNAVAILABLE', status: 503,
    });
    expect(readPaymentAttempt).not.toHaveBeenCalled();
  });

  test('mounts one private exact-query owner/admin read with no mutation route', async () => {
    const depositApplicationRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express(); app.use(express.json());
    app.use((req,_res,next) => { req.tenantContext = { organizationId: ID.organization,
      userId: ID.actor }; req.userRole = 'owner'; req.authSession = { id: ID.session }; next(); });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
        depositApplicationRead, auth: (_req,_res,next) => next(),
        role: (_req,_res,next) => next(), throttle: (_req,_res,next) => next() }));
    const route = `/api/v1/customer-financial/editable-estimates/${ID.estimate}/deposit-application`;
    const invalid = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('c'), amountMinorUnits: '250000', providerReceipt: 'secret' });
    expect(invalid.status).toBe(400); expect(depositApplicationRead).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toMatch(/250000|secret/);
    const ok = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('c') });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(depositApplicationRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route).send({ appliedAmountMinorUnits: '250000' })).status)
      .toBe(404);
  });

  test('adds no database, provider, public/demo surface or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/depositApplication.js'),
      read('src/customerFinancial/depositApplicationRepository.js'), route].join('\n');
    expect(route).toContain("router.get('/:estimateId/deposit-application', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/deposit-application'");
    expect(implementation).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe\.|paymentIntents\./i);
    expect(read('src/routes/demo.js')).not.toContain('deposit-application');
    expect(read('src/server.js')).not.toContain('deposit-application');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
