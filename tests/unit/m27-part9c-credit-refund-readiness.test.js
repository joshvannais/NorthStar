'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const correction = require('../../src/customerFinancial/invoicePostIssueCorrection');
const paymentAttempt = require('../../src/customerFinancial/paymentAttemptAllocationOverpayment');
const contract = require('../../src/customerFinancial/creditRefundReadiness');
const repository = require('../../src/customerFinancial/creditRefundReadinessRepository');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ID = Object.freeze({ organization: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  session: '33333333-3333-4333-8333-333333333333',
  estimate: '44444444-4444-4444-8444-444444444444',
  receipt: '55555555-5555-4555-8555-555555555555' });
const source = Object.freeze({ organizationId: ID.organization, actorUserId: ID.actor,
  actorAccessRole: 'owner', authSessionId: ID.session });
const digest = character => character.repeat(64);

describe('Mission 27 Part 9C credit-note and refund-request readiness', () => {
  test('binds exact correction and payment witnesses under the frozen action policies', () => {
    const correctionSource = correction.unavailable();
    const attemptSource = paymentAttempt.unavailable();
    const value = contract.unavailable(correctionSource, attemptSource);
    expect(contract.projectWithSources(JSON.parse(JSON.stringify(value)),
      correctionSource, attemptSource)).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-credit-note-refund-request-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'credit_refund_source_evidence_unavailable', value: null,
      sourceWitnesses: {
        postIssueCorrectionVersion: correction.CONTRACT_VERSION,
        postIssueCorrectionDigest: providerBoundary.digest(correctionSource),
        paymentAttemptAllocationVersion: paymentAttempt.CONTRACT_VERSION,
        paymentAttemptAllocationDigest: providerBoundary.digest(attemptSource),
      },
      access: { eligibleAccessRoles: ['owner','admin'],
        roleAloneAuthorizesCreditOrRefund: false, requiredAssurance: 'recent_auth_mfa',
        maximumRecentAuthenticationSeconds: 600, maximumMfaFreshnessSeconds: 600,
        maximumIndependentApprovalSeconds: 600, recentAuthenticationState: 'unavailable',
        mfaState: 'unavailable', creditCapabilityState: 'unavailable',
        refundCapabilityState: 'unavailable' },
    });
  });

  test('freezes exact credit-note bounds, append-only lineage and issued-byte immutability', () => {
    expect(contract.unavailable().creditNotePolicy).toEqual({
      requiredCapability: 'customer_financial.invoice.correct',
      controlMode: 'conditional_dual_control', maximumAbsoluteDeltaMinorUnits: '2500000',
      singleControlMaximumMinorUnits: '100000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      exactCurrentIssuedDocumentRequired: true,
      currentMission24CommercialChangeAuthorityRequired: true,
      exactRemainingBalanceRequired: true, exactAmountAndCurrencyRequired: true,
      boundedReasonRequired: true, immutableOriginalIssuedVersion: true,
      appendOnlyCreditRecordRequired: true, creditNoteMayImplyRefund: false,
      missingAmountOrBalanceMayBecomeZero: false,
    });
  });

  test('freezes original-charge refund bounds, control separation and acknowledgement truth', () => {
    expect(contract.unavailable().refundPolicy).toEqual({
      requiredCapability: 'customer_financial.refund.issue',
      controlMode: 'conditional_dual_control', maximumMinorUnitsPerAction: '10000000',
      singleControlMaximumMinorUnits: '100000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      dualControlSeparation: 'requester_cannot_approve', originalCardChargeOnly: true,
      partialAndFullSupported: true, cumulativeMaximum: 'current_refundable_remainder',
      offlineCashReturnClaimsSupported: false, checkRefundBeforeClearanceSupported: false,
      exactCurrentSettledOriginalChargeRequired: true,
      exactOriginalPaymentAndAllocationLineageRequired: true,
      exactRefundableRemainderRequired: true, exactAmountAndCurrencyRequired: true,
      boundedReasonRequired: true, idempotencyKeyAndRequestDigestRequired: true,
      providerAcknowledgementRequired: true, requestIsCompletedRefund: false,
      acknowledgementIsSettlement: false, missingAmountOrRemainderMayBecomeZero: false,
    });
  });

  test('requires complete source, assurance, amount, reason, idempotency and provider lineage', () => {
    expect(contract.unavailable().requirements.map(item =>
      [item.requirement,item.state,item.reason,item.value])).toEqual([
      ['exact_current_immutable_issued_invoice','unavailable','issued_invoice_unavailable',null],
      ['exact_current_remaining_invoice_balance','unavailable','issued_balance_unavailable',null],
      ['current_mission24_commercial_change_authority','unavailable',
        'commercial_change_authority_unavailable',null],
      ['current_credit_or_refund_action_capability','unavailable',
        'credit_refund_capability_unavailable',null],
      ['server_owned_recent_authentication_fact','unavailable','recent_auth_fact_unavailable',null],
      ['accepted_mfa_ceremony','unavailable','mfa_authority_unavailable',null],
      ['exact_bounded_usd_amount','unavailable','credit_refund_amount_unavailable',null],
      ['bounded_immutable_action_reason','unavailable','credit_refund_reason_unavailable',null],
      ['exact_original_accepted_payment_identity','unavailable',
        'accepted_payment_evidence_unavailable',null],
      ['exact_original_payment_allocation_lineage','unavailable',
        'accepted_payment_evidence_unavailable',null],
      ['exact_current_settled_original_card_charge','unavailable','settlement_unavailable',null],
      ['exact_current_refundable_remainder','unavailable','refundable_remainder_unavailable',null],
      ['action_idempotency_key_and_exact_request_digest','unavailable',
        'credit_refund_request_unavailable',null],
      ['different_current_human_approval_when_policy_requires','unavailable',
        'independent_approval_unavailable',null],
      ['append_only_credit_note_or_refund_request_receipt','unavailable',
        'credit_refund_request_unavailable',null],
      ['provider_refund_acknowledgement','unavailable',
        'provider_refund_acknowledgement_unavailable',null],
    ]);
  });

  test('keeps all values unavailable and rejects contradictions, leakage and inferred zero', () => {
    const value = contract.unavailable();
    expect(Object.values(value.projection).filter(item => item !== 'unavailable')
      .every(item => item === null)).toBe(true);
    expect(Object.values(value.authority).every(item => item === false)).toBe(true);
    expect(Object.values(value.privacy).every(item => item === false)).toBe(true);
    expect(value).toMatchObject({ creditNoteRowCount: 0, refundReviewRowCount: 0,
      refundRequestRowCount: 0, providerAcknowledgementRowCount: 0,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      accountingMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(() => contract.project({ ...value,
      refundPolicy: { ...value.refundPolicy, requestIsCompletedRefund: true } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, refundAmountMinorUnits: '0' } })).toThrow();
    expect(() => contract.unavailable({ ...correction.unavailable(), creditRecordAuthorized: true },
      paymentAttempt.unavailable())).toThrow();
    expect(() => contract.unavailable(correction.unavailable(), { ...paymentAttempt.unavailable(),
      authority: { ...paymentAttempt.unavailable().authority, refundAuthorized: true } })).toThrow();
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|customerId|acct_victim|ch_victim|re_victim|sk_test/i);
  });

  test('repository validates correction before payment lineage and fails closed', async () => {
    const readCorrection = jest.fn().mockResolvedValue(correction.unavailable());
    const readPaymentAttempt = jest.fn().mockResolvedValue(paymentAttempt.unavailable());
    const result = await repository.read({}, source, ID.estimate, ID.receipt, digest('a'),
      { readCorrection, readPaymentAttempt });
    expect(result).toEqual(contract.unavailable());
    expect(readCorrection).toHaveBeenCalledWith({}, source, ID.estimate, ID.receipt, digest('a'));
    expect(readPaymentAttempt).toHaveBeenCalledWith({}, source, ID.estimate, ID.receipt, digest('a'));
    readPaymentAttempt.mockClear();
    readCorrection.mockResolvedValue({ ...correction.unavailable(), creditRecordAuthorized: true });
    await expect(repository.read({}, source, ID.estimate, ID.receipt, digest('a'),
      { readCorrection, readPaymentAttempt })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_CREDIT_REFUND_UNAVAILABLE', status: 503,
    });
    expect(readPaymentAttempt).not.toHaveBeenCalled();
  });

  test('mounts one private exact-query read and no premature action route', async () => {
    const creditRefundReadinessRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express(); app.use(express.json());
    app.use((req,_res,next) => { req.tenantContext = { organizationId: ID.organization,
      userId: ID.actor }; req.userRole = 'owner'; req.authSession = { id: ID.session }; next(); });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
        creditRefundReadinessRead, auth: (_req,_res,next) => next(),
        role: (_req,_res,next) => next(), throttle: (_req,_res,next) => next() }));
    const route = `/api/v1/customer-financial/editable-estimates/${ID.estimate}/credit-refund-readiness`;
    const invalid = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('a'), refundMinorUnits: '100000',
      originalCharge: 'ch_victim', reason: 'caller reason' });
    expect(invalid.status).toBe(400); expect(creditRefundReadinessRead).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toMatch(/100000|ch_victim|caller reason/);
    const ok = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('a') });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(creditRefundReadinessRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route).set('X-CSRF-Token','x'.repeat(16))
      .set('Idempotency-Key','i'.repeat(16)).send({ action: 'refund',
        amountMinorUnits: '100000', reason: 'caller authored refund' })).status).toBe(404);
  });

  test('adds no credit/refund table, provider transport, public/demo action or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/creditRefundReadiness.js'),
      read('src/customerFinancial/creditRefundReadinessRepository.js'), route].join('\n');
    expect(route).toContain("router.get('/:estimateId/credit-refund-readiness', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/credit-refund-readiness'");
    expect(implementation).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe\.|refunds\./i);
    expect(read('src/routes/demo.js')).not.toContain('credit-refund-readiness');
    expect(read('src/server.js')).not.toContain('credit-refund-readiness');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
