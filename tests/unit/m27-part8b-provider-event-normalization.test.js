'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const receiptContract = require('../../src/customerFinancial/paymentProviderEventReceipt');
const contract = require('../../src/customerFinancial/paymentProviderEventNormalization');
const repository = require('../../src/customerFinancial/paymentProviderEventNormalizationRepository');
const { createCustomerFinancialProviderEventNormalizationRouter } =
  require('../../src/routes/customerFinancialProviderEventNormalization');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 8B provider-event normalization readiness', () => {
  test('binds the exact Part 8A receipt and ordered nine-state normalization contract', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-provider-event-normalization-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      providerEventReceiptVersion: 'm27-provider-event-receipt-readiness-v1',
      providerEventReceiptDigest: providerBoundary.digest(receiptContract.unavailable()),
      state: 'unavailable', reason: 'provider_event_receipt_unavailable', value: null,
      receipt: { authenticationState: 'unavailable', signatureVerified: false,
        rawPayloadAccepted: false, providerEventIdentity: null,
        providerEventIdentityState: 'unavailable', providerObjectIdentity: null,
        providerObjectIdentityState: 'unavailable', providerAccountIdentity: null,
        accountModeMatchVerified: false },
    });
    expect(value.stateContract.map(item => item.providerState)).toEqual([
      'created', 'authorized', 'processing', 'succeeded', 'failed', 'canceled',
      'settled', 'reversed', 'corrected',
    ]);
    expect(value.stateContract.map(item => item.semantic)).toEqual([
      'payment_attempt_created_evidence', 'payment_authorization_evidence',
      'payment_processing_evidence', 'payment_success_evidence',
      'payment_failure_evidence', 'payment_cancellation_evidence',
      'provider_settlement_evidence', 'prior_payment_effect_reversal_evidence',
      'prior_provider_evidence_correction',
    ]);
    expect(value.stateContract.every(item => item.currentState === 'unavailable' &&
      item.normalized === false && item.maySupersedeByArrival === false &&
      item.financialProjectionAuthorized === false)).toBe(true);
  });

  test('never trusts arrival order, received time, missing evidence or a global state rank', () => {
    const value = contract.unavailable();
    expect(value.ordering).toEqual({
      arrivalOrderTrusted: false,
      receivedAtMaySelectProjection: false,
      globalNumericStateRankSupported: false,
      terminalStateAssumedFromArrival: false,
      providerOccurrenceTimeRequired: true,
      providerSequenceOrCurrentSnapshotRequiredForAmbiguity: true,
      exactEventAndObjectIdentityRequired: true,
      duplicateOrReplayMayAdvanceProjection: false,
      olderEventMayRegressProjection: false,
      reversalRequiresExactPriorPaymentEffect: true,
      correctionRequiresExactPriorProviderEvidence: true,
      missingEvidenceMayBecomeZero: false,
    });
    expect(value.requirements.map(item => item.requirement)).toEqual([
      'exact_authenticated_provider_event_receipt',
      'current_provider_adapter_event_schema',
      'unique_provider_event_and_object_identity',
      'exact_tenant_account_and_mode_binding',
      'provider_occurrence_time',
      'exact_supported_provider_semantic_state',
      'duplicate_and_replay_disposition',
      'provider_sequence_or_current_snapshot_for_ambiguity',
      'exact_reversal_or_correction_lineage',
    ]);
    expect(value.requirements.every(item => item.state === 'unavailable')).toBe(true);
  });

  test('keeps event data private and every financial effect outside Part 8B', () => {
    const value = contract.unavailable();
    expect(value.normalization).toEqual({ inputAccepted: false, providerEventType: null,
      providerState: null, providerOccurredAt: null, providerSequence: null,
      currentProviderSnapshot: null, normalizedState: null, normalizedAt: null,
      normalizationRevision: null, normalizationDigest: null,
      conflictState: 'unavailable', completenessState: 'unavailable',
      normalizationAuthorized: false });
    expect(value.authority).toEqual({ providerEvidenceCanAuthorizeCharge: false,
      providerEvidenceCanApproveRefundOrWriteOff: false,
      paymentSuccessAuthorizesSettlement: false, settlementAuthorizesPayout: false,
      normalizedEvidenceAuthorizesInvoiceAllocation: false,
      normalizedEvidenceAuthorizesBalanceChange: false,
      normalizedEvidenceAuthorizesAccountingEntry: false });
    expect(value.downstream).toEqual({ normalizationRecorded: false,
      invoiceAllocationAuthorized: false, paymentSuccessRecorded: false,
      captureRecorded: false, settlementRecorded: false, payoutRecorded: false,
      invoiceBalanceChanged: false, accountingAcknowledgementRecorded: false });
    expect(value).toMatchObject({ providerReceiptCurrent: false, normalizationRowCount: 0,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /organizationId|actorUserId|authSessionId|client_secret|webhook_secret|acct_[a-z0-9]|evt_[a-z0-9]/i);
  });

  test('fails closed for widened, reordered, caller-authored or contradictory state', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value,
      stateContract: [...value.stateContract].reverse() })).toThrow();
    expect(() => contract.project({ ...value,
      ordering: { ...value.ordering, arrivalOrderTrusted: true } })).toThrow();
    expect(() => contract.project({ ...value,
      normalization: { ...value.normalization, providerState: 'succeeded' } })).toThrow();
    expect(() => contract.project({ ...value,
      downstream: { ...value.downstream, paymentSuccessRecorded: true } })).toThrow();
    expect(() => contract.unavailable({ ...receiptContract.unavailable(),
      uniqueness: { ...receiptContract.unavailable().uniqueness,
        providerEventIdentity: 'evt_caller' } })).toThrow();
  });

  test('permits only an exact paid owner/admin source and consumes Part 8A', async () => {
    const readReceipt = jest.fn().mockResolvedValue(receiptContract.unavailable());
    await expect(repository.read(source, { readReceipt })).resolves.toEqual(contract.unavailable());
    await expect(repository.read({ ...source, actorAccessRole: 'admin' }, { readReceipt }))
      .resolves.toEqual(contract.unavailable());
    expect(readReceipt).toHaveBeenCalledTimes(2);
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'member' },
      { ...source, organizationId: 'victim' }, { ...source, authSessionId: null }]) {
      await expect(repository.read(invalid, { readReceipt })).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_PROVIDER_EVENT_NORMALIZATION_RESTRICTED', status: 403,
      });
    }
  });

  test('rejects query-carried event data before repository entry without reflection', async () => {
    const readBoundary = jest.fn();
    const app = express();
    app.use('/api/v1/customer-financial/payment-provider/event-normalization',
      createCustomerFinancialProviderEventNormalizationRouter({
        auth: (req, _res, next) => { req.tenantContext = {
          organizationId: source.organizationId, userId: source.actorUserId };
        req.authSession = { id: source.authSessionId }; req.userRole = 'owner'; next(); },
        role: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
        read: readBoundary,
      }));
    const response = await request(app)
      .get('/api/v1/customer-financial/payment-provider/event-normalization' +
        '?event=evt_forged&object=pi_victim&state=succeeded&amount=999999');
    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/evt_forged|pi_victim|succeeded|999999/);
    expect(readBoundary).not.toHaveBeenCalled();
  });

  test('mounts one private read with no event input, demo endpoint, transport, table or migration 273', () => {
    const route = read('src/routes/customerFinancialProviderEventNormalization.js');
    const server = read('src/server.js');
    const demo = read('src/routes/demo.js');
    const implementation = [read('src/customerFinancial/paymentProviderEventNormalization.js'),
      read('src/customerFinancial/paymentProviderEventNormalizationRepository.js'), route].join('\n');
    expect(route).toContain("requireRole('owner', 'admin')");
    expect(route).toContain("router.get('/', auth, role, throttle");
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(server).toContain(
      "app.use('/api/v1/customer-financial/payment-provider/event-normalization'");
    expect(demo).not.toContain('payment-provider/event-normalization');
    expect(implementation).not.toMatch(
      /fetch\(|axios|stripe\.|constructEvent|checkout\.sessions|paymentIntents|process\.env\.[A-Z_]*STRIPE/i);
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
