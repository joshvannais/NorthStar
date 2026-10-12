'use strict';

const crypto = require('node:crypto');
const review = require('../../src/customerFinancial/billableWorkReview');
const grants = require('../../src/customerFinancial/billableWorkReviewGrantIssuer');
const money = require('../../src/customerFinancial/exactMoney');

const id = () => crypto.randomUUID(); const digest = () => crypto.randomBytes(32).toString('hex');
function basis(amount = '6800.00', payments = []) {
  return { contractVersion: 'm27-polaris-editable-estimate-v1', digest: digest(),
    estimate: { id: id(), customerId: id() }, currentness: { current: true },
    mission24: { commercialApprovalId: id(), commercialApprovalDigest: digest() },
    options: [{ totalBeforeTax: money.fromDecimal(amount), pricingEvidence: {
      paymentSchedule: payments } }] };
}
function work(amount = '6800.00') {
  const commercialBasis = basis(amount); return { state: 'available', digest: digest(),
    commercialBasis, association: { execution: { id: id(), lifecycleState: 'completed' } },
    handoffEvidence: { sourceDigest: digest(), receipt: { id: id(), digest: digest() } },
    billableWork: { finalBalanceSourceCurrent: true } };
}

describe('Mission 27 Part 3C billable-work review contract', () => {
  test('projects exact final balance and conditional control without authorizing an invoice', () => {
    const single = review.finalBalance(work('10000.00'));
    expect(single).toMatchObject({ state: 'review_required', source: {
      sourceClass: 'final_balance', controlMode: 'single_control',
      amount: { minorUnits: '1000000' }, completionClaimed: true,
      completionInferred: false }, financialActionAuthorized: false, invoiceAuthorized: false });
    const dual = review.finalBalance(work('10000.01'));
    expect(dual.source).toMatchObject({ controlMode: 'dual_control',
      amount: { minorUnits: '1000001' } });
    expect(dual.source.decisionDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('accepts one exact bounded deposit without a completion claim', () => {
    const value = basis('10000.00', [{ id: id(), paymentKind: 'deposit',
      amount: money.fromDecimal('2500.00') }]);
    expect(review.preWorkDeposit(value)).toMatchObject({ state: 'review_required', source: {
      sourceClass: 'pre_work_deposit', amount: { minorUnits: '250000' },
      completionClaimed: false, controlMode: 'single_control' } });
  });

  test.each([
    [[], 'deposit_terms_unavailable'],
    [[{ id: id(), paymentKind: 'deposit', amount: money.fromDecimal('0.00') }],
      'deposit_terms_out_of_bounds'],
    [[{ id: id(), paymentKind: 'deposit', amount: money.fromDecimal('5000.01') }],
      'deposit_terms_out_of_bounds'],
  ])('fails deposit evidence value-free', (payments, reason) => {
    expect(review.preWorkDeposit(basis('10000.00', payments))).toMatchObject({
      state: 'unavailable', reason, value: null, financialActionAuthorized: false });
  });

  test('keeps milestone authority named, unsupported and value-free', () => {
    expect(review.candidate('milestone')).toMatchObject({ state: 'unavailable',
      reason: 'milestone_authority_unsupported', value: null, invoiceAuthorized: false });
  });

  test('ratifies the released grant classification without widening launch v1', () => {
    for (const role of ['owner','admin']) expect(grants.classify(role)).toMatchObject({
      capability: 'customer_financial.billable_work.review',
      businessPurpose: 'customer_financial.billable_work_review',
      policyVersion: 'mission27.launch.v1', actionMode: 'conditional_dual_control',
      assurance: 'recent_auth' });
    expect(() => grants.classify('member')).toThrow(/restricted/i);
  });
});
