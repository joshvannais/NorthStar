'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const offlinePayment = require('../../src/customerFinancial/offlinePaymentReadiness');
const contract = require('../../src/customerFinancial/paymentOutcomeReadiness');
const repository = require('../../src/customerFinancial/paymentOutcomeReadinessRepository');
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

describe('Mission 27 Part 9E payment-outcome readiness', () => {
  test('binds the exact released Part 9D witness and write-off control policy', () => {
    const sourceWitness = offlinePayment.unavailable();
    const value = contract.unavailable(sourceWitness);
    expect(contract.projectWithSource(JSON.parse(JSON.stringify(value)), sourceWitness)).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-payment-outcome-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'financial_outcome_source_evidence_unavailable', value: null,
      sourceWitness: { offlinePaymentReadinessVersion: offlinePayment.CONTRACT_VERSION,
        offlinePaymentReadinessDigest: providerBoundary.digest(sourceWitness) },
      access: { eligibleAccessRoles: ['owner','admin'],
        roleAloneAuthorizesOutcomeOrWriteOff: false,
        writeOffCapability: 'customer_financial.write_off.record',
        requiredAssurance: 'recent_auth_mfa', maximumRecentAuthenticationSeconds: 600,
        maximumMfaFreshnessSeconds: 600, maximumIndependentApprovalSeconds: 600,
        currentCapabilityState: 'unavailable', recentAuthenticationState: 'unavailable',
        mfaState: 'unavailable', independentApprovalState: 'unavailable' },
    });
  });

  test('keeps every exact outcome axis ordered, separately typed and value-free', () => {
    const value = contract.unavailable();
    expect(value.axisOrder).toEqual(contract.OUTCOME_AXIS_ORDER);
    expect(value.axes.map(item => item.axis)).toEqual([
      'paymentFailure', 'paymentCancellation', 'returnedOfflinePayment', 'nsfFee',
      'disputeDeadline', 'disputeFee', 'disputeOutcome', 'chargeback',
      'paymentReversal', 'offlineReversal', 'refundSettlement',
      'badDebtWriteOffReview', 'reopenedBalance',
    ]);
    expect(value.axes.every(item => item.value === null && item.accepted === false)).toBe(true);
    expect(value.axes.find(item => item.axis === 'returnedOfflinePayment')).toEqual({
      axis: 'returnedOfflinePayment', state: 'returned_check_authority_unavailable',
      reason: 'returned_check_authority_unavailable', value: null,
      factShape: 'append_only_offline_fact', accepted: false });
    expect(value.axes.find(item => item.axis === 'nsfFee').state).toBe('nsf_fee_unsupported');
    expect(value.axes.find(item => item.axis === 'refundSettlement').state)
      .toBe('settlement_unavailable');
  });

  test('freezes provider, dispute, offline, refund, write-off and balance semantics', () => {
    const value = contract.unavailable();
    expect(value.providerOutcomePolicy).toEqual({
      normalizedOutcomeStates: ['failed','canceled','reversed'],
      disputeOutcomeStates: ['dispute_won','dispute_lost'],
      authenticatedProviderEvidenceOnly: true,
      exactTenantAccountModeAndObjectBindingRequired: true,
      exactProviderOccurrenceSequenceAndCurrentSnapshotRequired: true,
      duplicateReplayCorrectionDispositionRequired: true,
      arrivalOrderAuthorizesOutcome: false, failureOrCancellationAuthorizesRetry: false,
      automaticRetryState: 'automatic_payment_retry_unsupported',
      disputeActionState: 'dispute_action_unsupported',
      automaticConcessionOrEvidenceSubmission: false, disputeBlocksDestructiveCleanup: true,
      disputeMayAutomaticallyRefundOrWriteOff: false, disputeMayContactCustomer: false,
      disputeMayChangeTaxOrRecognizeRevenue: false,
      providerOutcomeMayRewritePriorEvidence: false });
    expect(value.offlineOutcomePolicy).toMatchObject({
      receivedCheckState: 'check_clearance_unknown', returnedCheckState: 'check_returned',
      offlineReversalState: 'offline_reversed', acceptedReturnSourceRuntimeAvailable: false,
      missingReturnAuthorityState: 'returned_check_authority_unavailable',
      returnReopensOnlyExactPendingAllocation: true, nsfFeeState: 'nsf_fee_unsupported',
      returnFeeEffect: 'none', offlineReversalMayClaimPhysicalCashReturn: false,
      checkUnknownMayBecomeClearedCash: false });
    expect(value.offlineOutcomePolicy.acceptedReturnEvidenceClasses)
      .toEqual(offlinePayment.RETURN_SOURCES);
    expect(value.refundSettlementPolicy).toEqual({ originalSettledCardChargeOnly: true,
      requestIsCompletedRefund: false, providerAcknowledgementIsSettlement: false,
      exactOriginalPaymentAndAllocationRequired: true,
      exactCurrentRefundableRemainderRequired: true,
      exactProviderRefundSettlementEvidenceRequired: true,
      refundSettlementState: 'settlement_unavailable', missingSettlementMayBecomeZero: false });
    expect(value.writeOffPolicy).toEqual({
      requiredCapability: 'customer_financial.write_off.record',
      controlMode: 'conditional_dual_control', maximumMinorUnitsPerAction: '1000000',
      singleControlMaximumMinorUnits: '50000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      exactCurrentBalanceComponentRequired: true, exactUsdAmountRequired: true,
      boundedReasonRequired: true, reviewAndFreshConfirmationRequired: true,
      appendOnlyReceiptRequired: true, mayChangeTaxOrRevenueRecognition: false,
      mayMoveProviderOrOfflineMoney: false, missingAmountOrBalanceMayBecomeZero: false });
    expect(value.balanceProjectionPolicy).toMatchObject({
      failureOrCancellationAloneReopensBalance: false,
      disputeDoesNotEraseOriginalPayment: true,
      returnedCheckReopensOnlyExactPendingAllocation: true,
      refundRequestOrAcknowledgementReopensBalance: false,
      missingOutcomeMayChangeBalance: false, missingAmountMayBecomeZero: false,
      negativeBalanceCreditRevenueAndExpenseRemainSeparate: true });
  });

  test('requires complete evidence and preserves a zero-effect projection', () => {
    const value = contract.unavailable();
    expect(value.requirements).toHaveLength(17);
    expect(value.requirements.map(item => item.requirement)).toEqual([
      'exact_current_issued_invoice_and_balance',
      'exact_original_payment_or_offline_receipt_and_allocation',
      'authenticated_normalized_provider_outcome_event',
      'exact_provider_account_mode_object_and_tenant_binding',
      'provider_occurrence_sequence_and_current_snapshot',
      'duplicate_replay_correction_and_prior_effect_disposition',
      'exact_dispute_deadline_fee_currency_and_outcome',
      'exact_returned_check_source_code_time_and_digest',
      'exact_refund_request_acknowledgement_and_settlement_lineage',
      'current_write_off_capability', 'server_owned_recent_authentication_fact',
      'accepted_mfa_ceremony', 'exact_bounded_write_off_amount_and_currency',
      'bounded_immutable_write_off_reason',
      'different_current_human_approval_when_policy_requires',
      'append_only_outcome_identity_time_and_source_digest',
      'outcome_specific_reopened_balance_projection',
    ]);
    expect(value.requirements.every(item => item.state === 'unavailable' && item.value === null))
      .toBe(true);
    expect(value.projection).toMatchObject({ failureState: 'unavailable',
      cancellationState: 'unavailable',
      returnedOfflinePaymentState: 'returned_check_authority_unavailable',
      nsfFeeState: 'nsf_fee_unsupported', disputeActionState: 'dispute_action_unsupported',
      disputeOutcomeState: 'unavailable', chargebackState: 'unavailable',
      reversalState: 'unavailable', offlineReversalState: 'unavailable',
      refundSettlementState: 'settlement_unavailable', writeOffReviewState: 'unavailable',
      reopenedBalanceState: 'unavailable', reopenedBalanceMinorUnits: null });
    expect(Object.values(value.authority).every(item => item === false)).toBe(true);
    expect(Object.values(value.privacy).every(item => item === false)).toBe(true);
    for (const [key,item] of Object.entries(value)) {
      if (/RowCount$|CallCount$|MutationCount$|MovementCount$/.test(key)) expect(item).toBe(0);
    }
  });

  test('rejects missing, reordered, contradictory and leaked outcome contracts', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value, axes: [...value.axes].reverse() })).toThrow();
    expect(() => contract.project({ ...value,
      providerOutcomePolicy: { ...value.providerOutcomePolicy,
        disputeOutcomeStates: ['dispute_lost','dispute_won'] } })).toThrow();
    const { offlineOutcomePolicy: _missing, ...missingOffline } = value;
    expect(() => contract.project(missingOffline)).toThrow();
    expect(() => contract.project({ ...value,
      offlineOutcomePolicy: { ...value.offlineOutcomePolicy,
        missingReturnAuthorityState: 'unavailable' } })).toThrow();
    expect(() => contract.project({ ...value,
      refundSettlementPolicy: { ...value.refundSettlementPolicy,
        providerAcknowledgementIsSettlement: true } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, outcomeAmountMinorUnits: '0' } })).toThrow();
    expect(() => contract.project({ ...value,
      authority: { ...value.authority, reopenedBalanceAuthorized: true } })).toThrow();
    expect(() => contract.unavailable({ ...offlinePayment.unavailable(),
      authority: { ...offlinePayment.unavailable().authority,
        returnedCheckRecordingAuthorized: true } })).toThrow();
    expect(JSON.stringify(value)).not.toMatch(
      /11111111-1111|22222222-2222|33333333-3333|customer@example|123 main|acct_victim|sk_test/i);
  });

  test('repository and private route fail closed before any outcome action', async () => {
    const readOfflinePayment = jest.fn().mockResolvedValue(offlinePayment.unavailable());
    expect(await repository.read({}, source, ID.estimate, ID.receipt, digest('a'),
      { readOfflinePayment })).toEqual(contract.unavailable());
    expect(readOfflinePayment).toHaveBeenCalledWith(
      {}, source, ID.estimate, ID.receipt, digest('a'));
    readOfflinePayment.mockResolvedValue({ ...offlinePayment.unavailable(),
      authority: { ...offlinePayment.unavailable().authority,
        returnedCheckRecordingAuthorized: true } });
    await expect(repository.read({}, source, ID.estimate, ID.receipt, digest('a'),
      { readOfflinePayment })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_PAYMENT_OUTCOME_UNAVAILABLE', status: 503 });

    const paymentOutcomeReadinessRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express(); app.use(express.json());
    app.use((req,_res,next) => { req.tenantContext = { organizationId: ID.organization,
      userId: ID.actor }; req.userRole = 'owner'; req.authSession = { id: ID.session }; next(); });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
        paymentOutcomeReadinessRead, auth: (_req,_res,next) => next(),
        role: (_req,_res,next) => next(), throttle: (_req,_res,next) => next() }));
    const route = `/api/v1/customer-financial/editable-estimates/${ID.estimate}/payment-outcome-readiness`;
    const invalid = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('a'), providerEvent: 'evt_victim',
      writeOffAmountMinorUnits: '0', reason: 'caller reason' });
    expect(invalid.status).toBe(400); expect(paymentOutcomeReadinessRead).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toMatch(/evt_victim|writeOff|caller reason/);
    const ok = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('a') });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(paymentOutcomeReadinessRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route).set('X-CSRF-Token','x'.repeat(16))
      .send({ outcome: 'failed', amountMinorUnits: '0', confirmed: true })).status).toBe(404);
  });

  test('adds no outcome table, mutation, provider transport, demo route or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/paymentOutcomeReadiness.js'),
      read('src/customerFinancial/paymentOutcomeReadinessRepository.js'), route].join('\n');
    expect(route).toContain(
      "router.get('/:estimateId/payment-outcome-readiness', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/payment-outcome-readiness'");
    expect(implementation).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('payment-outcome-readiness');
    expect(read('src/server.js')).not.toContain('payment-outcome-readiness');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
