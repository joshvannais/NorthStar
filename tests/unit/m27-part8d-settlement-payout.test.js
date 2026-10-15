'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const allocationBalance = require('../../src/customerFinancial/paymentAllocationBalance');
const contract = require('../../src/customerFinancial/paymentSettlementPayout');
const repository = require('../../src/customerFinancial/paymentSettlementPayoutRepository');
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

describe('Mission 27 Part 8D settlement and payout reconciliation readiness', () => {
  test('binds exact Part 8C and provider witnesses to the frozen funds policy', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-settlement-payout-reconciliation-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'settlement_unavailable', value: null,
      access: { eligibleAccessRoles: ['owner','admin'],
        roleAloneAuthorizesReconciliation: false,
        authenticatedProviderProjectionIsHumanAction: false,
        manualReconciliationCapability: 'customer_financial.payment.reconcile',
        manualReconciliationControlMode: 'dual_control', singleControlAllowed: false,
        manualSettlementOverrideAuthorized: false },
      fundsPolicy: { merchantOfRecord: 'contractor_business',
        northstarCustodyOrControl: false, provider: 'stripe_connect',
        providerAccountShape: 'tenant_bound_contractor_account',
        fundsDestination: 'contractor_connected_account', supportedMode: 'test',
        liveModeEnabled: false, currency: 'USD', providerFeeDisclosureState: 'unavailable',
        providerFeeMayBeAssumedZero: false,
        capturedPaymentMayBeTreatedAsSettledCash: false,
        settledBalanceTransactionMayBeTreatedAsPayout: false,
        payoutMayBeTreatedAsBankArrival: false,
        accountingAcknowledgementMayBeTreatedAsSettlement: false,
        settlementMayRecognizeEarnedRevenue: false },
    });
    expect(value.sourceWitnesses).toEqual({
      paymentAllocationBalanceVersion: allocationBalance.CONTRACT_VERSION,
      paymentAllocationBalanceDigest: providerBoundary.digest(allocationBalance.unavailable()),
      paymentProviderBoundaryVersion: providerBoundary.CONTRACT_VERSION,
      paymentProviderBoundaryDigest: providerBoundary.digest(providerBoundary.unavailable()),
    });
  });

  test('requires exact capture, balance-transaction, payout and funds-destination evidence', () => {
    const value = contract.unavailable();
    expect(value.requirements.map(item => [item.requirement,item.state,item.reason,item.value]))
      .toEqual([
        ['current_exact_payment_allocation_and_balance_projection','unavailable',
          'accepted_payment_evidence_unavailable',null],
        ['accepted_current_capture_evidence','unavailable',
          'provider_capture_evidence_unavailable',null],
        ['exact_tenant_provider_account_and_mode','unavailable',
          'provider_account_mode_unavailable',null],
        ['exact_provider_payment_and_capture_identity','unavailable',
          'provider_capture_identity_unavailable',null],
        ['exact_provider_balance_transaction_identity','unavailable',
          'provider_balance_transaction_unavailable',null],
        ['exact_capture_to_balance_transaction_lineage','unavailable',
          'provider_balance_transaction_unavailable',null],
        ['exact_gross_fee_net_and_currency_identity','unavailable',
          'provider_fee_disclosure_unavailable',null],
        ['current_provider_settlement_evidence','unavailable','settlement_unavailable',null],
        ['exact_payout_identity_and_balance_transaction_membership','unavailable',
          'provider_payout_unavailable',null],
        ['current_payout_status_and_arrival_evidence','unavailable',
          'provider_payout_unavailable',null],
        ['exact_contractor_funds_destination','unavailable',
          'provider_funds_destination_unavailable',null],
        ['duplicate_reversal_and_correction_disposition','unavailable',
          'provider_reconciliation_unavailable',null],
      ]);
    expect(Object.entries(value.matching).filter(([key]) => ![
      'duplicateDispositionState','reversalOrCorrectionDispositionState',
      'unmatchedEvidenceRejected'].includes(key)).every(([,item]) => item === false)).toBe(true);
    expect(value.matching).toMatchObject({ duplicateDispositionState: 'unavailable',
      reversalOrCorrectionDispositionState: 'unavailable', unmatchedEvidenceRejected: true });
  });

  test('keeps capture, settlement, payout, bank arrival and revenue separate and value-free', () => {
    const value = contract.unavailable();
    const unavailableStateFields = ['balanceTransactionStatus','settlementState','payoutStatus'];
    expect(Object.entries(value.projection).every(([key,item]) =>
      unavailableStateFields.includes(key) ? item === 'unavailable' : item === null)).toBe(true);
    expect(Object.values(value.safeguards).every(item => item === false)).toBe(true);
    expect(Object.values(value.authority).every(item => item === false)).toBe(true);
    expect(value).toMatchObject({ exactCurrentnessRevalidated: true,
      settlementProjectionRowCount: 0, payoutReconciliationRowCount: 0,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      accountingMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|customerId|client_secret|acct_[a-z0-9]|evt_[a-z0-9]|pi_[a-z0-9]|txn_[a-z0-9]|po_[a-z0-9]/i);
  });

  test('strict projection rejects reordered, contradictory, leaked or inferred values', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value,
      requirements: [...value.requirements].reverse() })).toThrow();
    expect(() => contract.project({ ...value,
      matching: { ...value.matching, exactBalanceTransactionMatch: true } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, feeMinorUnits: '0' } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, payoutIdentity: 'po_caller' } })).toThrow();
    expect(() => contract.project({ ...value,
      safeguards: { ...value.safeguards, captureMayImplySettlement: true } })).toThrow();
    expect(() => contract.unavailable({ ...allocationBalance.unavailable(),
      authority: { ...allocationBalance.unavailable().authority,
        settlementRecorded: true } }, providerBoundary.unavailable())).toThrow();
    expect(() => contract.unavailable(allocationBalance.unavailable(), {
      ...providerBoundary.unavailable(), provider: {
        ...providerBoundary.unavailable().provider, accountIdentity: 'acct_caller',
      },
    })).toThrow();
  });

  test('repository consumes exact Part 8C and provider sources and fails closed', async () => {
    const readAllocationBalance = jest.fn().mockResolvedValue(allocationBalance.unavailable());
    const readProviderBoundary = jest.fn().mockResolvedValue(providerBoundary.unavailable());
    const result = await repository.read({}, source, 'estimate', 'receipt', 'digest',
      { readAllocationBalance, readProviderBoundary });
    expect(result).toEqual(contract.unavailable());
    expect(readAllocationBalance).toHaveBeenCalledWith(
      {}, source, 'estimate', 'receipt', 'digest');
    expect(readProviderBoundary).toHaveBeenCalledWith(source);
    readAllocationBalance.mockResolvedValue({ ...allocationBalance.unavailable(),
      projection: { ...allocationBalance.unavailable().projection,
        captureState: 'succeeded' } });
    await expect(repository.read({}, source, 'estimate', 'receipt', 'digest',
      { readAllocationBalance, readProviderBoundary })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_SETTLEMENT_PAYOUT_UNAVAILABLE', status: 503,
    });
  });

  test('mounts one private exact-query read and rejects caller provider data before entry', async () => {
    const paymentSettlementPayoutRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express();
    app.use(express.json());
    app.use((req,_res,next) => { req.tenantContext = {
      organizationId: source.organizationId, userId: source.actorUserId };
    req.userRole = 'owner'; req.authSession = { id: source.authSessionId }; next(); });
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
        paymentSettlementPayoutRead, auth: (_req,_res,next) => next(),
        role: (_req,_res,next) => next(), throttle: (_req,_res,next) => next() }));
    const route = '/api/v1/customer-financial/editable-estimates/estimate/' +
      'settlement-payout-reconciliation';
    const receiptId = '44444444-4444-4444-8444-444444444444';
    const receiptDigest = 'a'.repeat(64);
    const invalid = await request(app).get(route).query({ handoffReceiptId: receiptId,
      handoffReceiptDigest: receiptDigest, balanceTransactionId: 'txn_victim',
      payoutId: 'po_victim', gross: '5000', fee: '0', net: '5000' });
    expect(invalid.status).toBe(400); expect(paymentSettlementPayoutRead).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toMatch(/txn_victim|po_victim|5000/);
    for (const query of [{ handoffReceiptId: '', handoffReceiptDigest: receiptDigest },
      { handoffReceiptId: ` ${receiptId}`, handoffReceiptDigest: receiptDigest },
      { handoffReceiptId: receiptId, handoffReceiptDigest: 'not-a-digest' }]) {
      expect((await request(app).get(route).query(query)).status).toBe(400);
    }
    expect(paymentSettlementPayoutRead).not.toHaveBeenCalled();
    const ok = await request(app).get(route)
      .query({ handoffReceiptId: receiptId, handoffReceiptDigest: receiptDigest });
    expect(ok.status).toBe(200); expect(ok.body.data).toEqual(contract.unavailable());
    expect(ok.headers['cache-control']).toContain('private');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers.vary).toContain('Cookie');
    expect(paymentSettlementPayoutRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post(route).send({ payoutId: 'po_victim' })).status).toBe(404);
  });

  test('adds no transport, public/demo action, table or migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const implementation = [read('src/customerFinancial/paymentSettlementPayout.js'),
      read('src/customerFinancial/paymentSettlementPayoutRepository.js'), route].join('\n');
    expect(route).toContain(
      "router.get('/:estimateId/settlement-payout-reconciliation', auth, role, throttle");
    expect(route).not.toContain(
      "router.post('/:estimateId/settlement-payout-reconciliation'");
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|balanceTransactions\.|payouts\.|process\.env\.[A-Z_]*STRIPE/i);
    expect(read('src/routes/demo.js')).not.toContain('settlement-payout-reconciliation');
    expect(read('src/server.js')).not.toContain('settlement-payout-reconciliation');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
