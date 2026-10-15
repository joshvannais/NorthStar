'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const creditRefund = require('../../src/customerFinancial/creditRefundReadiness');
const contract = require('../../src/customerFinancial/offlinePaymentReadiness');
const repository = require('../../src/customerFinancial/offlinePaymentReadinessRepository');
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

describe('Mission 27 Part 9D offline-payment intake readiness', () => {
  test('binds the exact released Part 9C witness and current human-control policy', () => {
    const sourceWitness = creditRefund.unavailable();
    const value = contract.unavailable(sourceWitness);
    expect(contract.projectWithSource(JSON.parse(JSON.stringify(value)), sourceWitness)).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-offline-payment-intake-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'issued_invoice_allocation_unavailable', value: null,
      sourceWitness: { creditRefundReadinessVersion: creditRefund.CONTRACT_VERSION,
        creditRefundReadinessDigest: providerBoundary.digest(sourceWitness) },
      access: { eligibleAccessRoles: ['owner','admin'],
        requiredCapability: 'customer_financial.payment.record_offline',
        roleAloneAuthorizesOfflineReceipt: false, requiredAssurance: 'recent_auth_mfa',
        maximumRecentAuthenticationSeconds: 600, maximumMfaFreshnessSeconds: 600,
        maximumIndependentApprovalSeconds: 600, currentCapabilityState: 'unavailable',
        recentAuthenticationState: 'unavailable', mfaState: 'unavailable',
        independentApprovalState: 'unavailable' },
    });
  });

  test('freezes enabled cash/check bounds and the complete append-only receipt contract', () => {
    const value = contract.unavailable();
    expect(value.intakePolicy).toEqual({ launchEnabled: true, currency: 'USD',
      supportedMethods: ['cash','check'], oneOrMoreCurrentIssuedInvoicesSupported: true,
      controlMode: 'conditional_dual_control', maximumCashMinorUnits: '1000000',
      maximumCheckMinorUnits: '1000000', singleControlMaximumMinorUnits: '100000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      missingAmountOrAllocationMayBecomeZero: false,
      dualControlMayRepairMissingEvidenceOrAuthority: false });
    expect(value.receiptContract).toEqual({ exactTenantRequired: true,
      exactCurrentIssuedInvoiceVersionsRequired: true,
      exactCurrentCollectibleBalancesRequired: true,
      exactAllocationEqualToReceiptAmountRequired: true,
      exactAmountCurrencyAndMethodRequired: true, humanAttestedOccurrenceTimeRequired: true,
      immutableServerAcceptanceTimeRequired: true, currentActorRequired: true,
      boundedEvidenceOrReferenceRequired: true, boundedReasonRequired: true,
      idempotencyKeyAndExactRequestDigestRequired: true, duplicateDetectionRequired: true,
      immutableSourceDigestRequired: true, reviewBeforeExplicitConfirmationRequired: true,
      serverAssignedReceiptNumberPattern: 'RCT-{tenant_monotonic_10_digit_sequence}',
      appendOnly: true, inPlaceEditAllowed: false,
      correctionShape: 'append_only_replacement_or_reversal_never_in_place' });
  });

  test('keeps cash receipt, check received and check cleared meanings separate', () => {
    const value = contract.unavailable();
    expect(value.cashSemantics).toEqual({ acceptedState: 'offline_received',
      effect: 'accepted_offline_receipt_reduces_collectible_balance_without_provider_settlement_claim',
      reducesOnlyExactCollectibleAllocation: true, providerAuthorizationClaimed: false,
      providerCaptureClaimed: false, providerSettlementClaimed: false, payoutClaimed: false,
      bankDepositClaimed: false, accountingAcknowledgementClaimed: false,
      earnedRevenueClaimed: false, physicalCashReturnClaimedByReversal: false });
    expect(value.checkSemantics).toEqual({ acceptedState: 'check_clearance_unknown',
      effect: 'pending_tender_only_face_and_settled_balances_unchanged_collection_action_blocked',
      pendingTenderOnly: true, invoiceFaceValueChanges: false, settledBalanceChanges: false,
      paidBalanceChanges: false, collectionBlockedForExactPendingAllocation: true,
      clearedTransitionEnabled: false,
      clearanceAuthority: 'unavailable_until_authenticated_bank_source',
      humanAttestationMayClaimClearance: false,
      accountingAcknowledgementMayClaimClearance: false,
      customerReceiptCopy: 'check received — clearance unknown' });
  });

  test('freezes return-source classes without preempting Part 9E outcome processing', () => {
    const returned = contract.unavailable().returnedCheckPolicy;
    expect(returned).toMatchObject({ returnedState: 'check_returned',
      effect: 'authorized_return_disposition_reverses_exact_pending_tender_and_reopens_exact_collectible_allocation',
      humanAttestationAloneAccepted: false,
      freeTextPhonePhotoOrAccountingAcknowledgementAccepted: false,
      authorizesBankClearanceClaim: false, reopensOnlyExactPendingAllocation: true,
      feeEffect: 'none', missingAuthorityState: 'returned_check_authority_unavailable',
      returnProcessingOwnedByPart9E: true });
    expect(returned.acceptedEvidenceClasses).toEqual(contract.RETURN_SOURCES);
    expect(returned.acceptedEvidenceClasses.map(value => value.class)).toEqual([
      'authenticated_bank_return_event.v1',
      'owner_admin_reviewed_bank_return_notice.v1',
    ]);
    expect(returned.acceptedEvidenceClasses.every(value =>
      value.currentRuntimeAvailable === false &&
      value.requires.includes('exact_original_check_receipt_and_allocation'))).toBe(true);
  });

  test('requires the complete intake record and keeps every value and effect unavailable', () => {
    const value = contract.unavailable();
    expect(value.requirements).toHaveLength(19);
    expect(value.requirements.map(item => item.requirement)).toEqual([
      'exact_current_issued_invoice_versions',
      'exact_current_collectible_balances_and_projection_revision',
      'exact_tenant_and_current_owner_or_administrator',
      'current_offline_payment_recording_capability',
      'server_owned_recent_authentication_fact',
      'accepted_mfa_ceremony',
      'supported_cash_or_check_method',
      'exact_usd_amount_within_method_ceiling',
      'immutable_exact_invoice_allocation_equal_to_receipt_amount',
      'human_attested_occurrence_time',
      'server_owned_immutable_acceptance_time',
      'bounded_evidence_or_reference',
      'bounded_immutable_reason',
      'immutable_source_digest',
      'idempotency_key_and_exact_request_digest',
      'duplicate_disposition',
      'different_current_human_approval_when_policy_requires',
      'explicit_review_and_confirmation',
      'append_only_server_assigned_receipt_identity',
    ]);
    expect(value.requirements.every(item => item.state === 'unavailable' &&
      item.value === null)).toBe(true);
    expect(Object.entries(value.projection).every(([key,item]) =>
      ['cashState','checkState','checkClearanceState'].includes(key) ?
        item === 'unavailable' : item === null)).toBe(true);
    expect(Object.values(value.authority).every(item => item === false)).toBe(true);
    expect(Object.values(value.privacy).every(item => item === false)).toBe(true);
    expect(value).toMatchObject({ offlineReceiptRowCount: 0,
      offlineReceiptCorrectionRowCount: 0, returnedCheckRowCount: 0,
      invoiceBalanceMutationCount: 0, providerCallCount: 0, providerMutationCount: 0,
      receiverMutationCount: 0, accountingMutationCount: 0, liveMoneyMovementCount: 0 });
  });

  test('rejects contradictory semantics, leaked values and malformed source witnesses', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value,
      checkSemantics: { ...value.checkSemantics, clearedTransitionEnabled: true } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, amountMinorUnits: '0' } })).toThrow();
    expect(() => contract.project({ ...value,
      authority: { ...value.authority, cashReceiptRecordingAuthorized: true } })).toThrow();
    expect(() => contract.unavailable({ ...creditRefund.unavailable(),
      authority: { ...creditRefund.unavailable().authority,
        invoiceBalanceChangeAuthorized: true } })).toThrow();
    expect(JSON.stringify(value)).not.toMatch(
      /11111111-1111|22222222-2222|33333333-3333|customer@example|123 main|acct_victim|sk_test/i);
  });

  test('repository and private route fail closed before any premature acceptance action', async () => {
    const readCreditRefund = jest.fn().mockResolvedValue(creditRefund.unavailable());
    expect(await repository.read({}, source, ID.estimate, ID.receipt, digest('a'),
      { readCreditRefund })).toEqual(contract.unavailable());
    expect(readCreditRefund).toHaveBeenCalledWith(
      {}, source, ID.estimate, ID.receipt, digest('a'));
    readCreditRefund.mockResolvedValue({ ...creditRefund.unavailable(),
      authority: { ...creditRefund.unavailable().authority,
        invoiceBalanceChangeAuthorized: true } });
    await expect(repository.read({}, source, ID.estimate, ID.receipt, digest('a'),
      { readCreditRefund })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_OFFLINE_PAYMENT_UNAVAILABLE', status: 503,
    });

    const offlinePaymentReadinessRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express(); app.use(express.json());
    app.use((req,_res,next) => { req.tenantContext = { organizationId: ID.organization,
      userId: ID.actor }; req.userRole = 'owner'; req.authSession = { id: ID.session }; next(); });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
        offlinePaymentReadinessRead, auth: (_req,_res,next) => next(),
        role: (_req,_res,next) => next(), throttle: (_req,_res,next) => next() }));
    const route = `/api/v1/customer-financial/editable-estimates/${ID.estimate}/offline-payment-readiness`;
    const invalid = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('a'), method: 'cash', amountMinorUnits: '100000',
      invoiceId: 'inv_victim', evidence: 'caller evidence' });
    expect(invalid.status).toBe(400); expect(offlinePaymentReadinessRead).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toMatch(/cash|100000|inv_victim|caller evidence/);
    const ok = await request(app).get(route).query({ handoffReceiptId: ID.receipt,
      handoffReceiptDigest: digest('a') });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(offlinePaymentReadinessRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route).set('X-CSRF-Token','x'.repeat(16))
      .set('Idempotency-Key','i'.repeat(16)).send({ method: 'cash',
        amountMinorUnits: '100000', confirmed: true })).status).toBe(404);
  });

  test('adds no receipt table, mutation, provider transport, demo route or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/offlinePaymentReadiness.js'),
      read('src/customerFinancial/offlinePaymentReadinessRepository.js'), route].join('\n');
    expect(route).toContain("router.get('/:estimateId/offline-payment-readiness', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/offline-payment-readiness'");
    expect(implementation).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('offline-payment-readiness');
    expect(read('src/server.js')).not.toContain('offline-payment-readiness');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
