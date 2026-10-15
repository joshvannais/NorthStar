'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const receivableAging = require('../../src/customerFinancial/receivableAging');
const contract = require('../../src/customerFinancial/collectionReview');
const repository = require('../../src/customerFinancial/collectionReviewRepository');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialCollectionReviewRouter } =
  require('../../src/routes/customerFinancialCollectionReview');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 10B collection review and promise-to-pay boundary', () => {
  test('pins exact Part 10A witness, access, assurance and action-control policy', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({ contractVersion: 'm27-collection-review-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'receivable_population_incomplete', value: null,
      sourceWitness: { receivableAgingVersion: 'm27-receivable-aging-v1',
        receivableAgingDigest: providerBoundary.digest(receivableAging.unavailable()),
        populationState: 'unavailable',
        populationReason: 'issued_receivable_population_unavailable',
        populationComplete: false },
      access: { tenantPrivate: true, eligibleAccessRoles: ['owner','admin'],
        currentTenantSessionRequired: true, currentSubscriptionRequired: true,
        requiredCapability: 'customer_financial.collection.action', roleAloneAuthorizes: false,
        requiredAssurance: 'recent_auth_mfa', maximumRecentAuthenticationSeconds: 600,
        maximumMfaFreshnessSeconds: 600, maximumIndependentApprovalSeconds: 600,
        currentCapabilityState: 'unavailable', recentAuthenticationState: 'unavailable',
        mfaState: 'unavailable', independentApprovalState: 'unavailable' } });
    expect(value.nextStepPolicy).toMatchObject({ controlMode: 'conditional_dual_control',
      singleControlMaximumMinorUnits: '1000000', maximumMinorUnits: '10000000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      mission28ReceivingAdapterAvailable: false,
      externalExecutionAuthority: 'mission28_only' });
  });

  test('freezes queue filters, exact drilldown and explicit next-step selection', () => {
    const value = contract.unavailable();
    expect(value.queuePolicy.filterOrder).toEqual([
      'agingBucket','holdState','contactabilityState','promiseToPayState','selectedNextStep',
    ]);
    expect(value.queuePolicy.filterDefinitions.agingBucket).toEqual([
      'all','not_due','due_today','overdue_1_30','overdue_31_60','overdue_61_90',
      'overdue_91_plus',
    ]);
    expect(value.queuePolicy).toMatchObject({ source: 'complete_current_receivable_population',
      sourceState: 'unavailable', maximumPageSize: 100, exactCurrentRowsOnly: true,
      incompletePopulationMayBePresentedAsEmptyOrComplete: false,
      stableOrder: 'oldest_due_date_then_issued_invoice_identity', activeFilters: null,
      totalQueueRows: null, projectedQueueRows: 0 });
    expect(value.drilldownPolicy).toMatchObject({ exactCurrentReceivableRequired: true,
      exactIssuedInvoiceVersionAndReceivableProjectionRequired: true,
      exactBalanceDueDisputeRefundPendingTenderAndContactabilityRequired: true,
      heldOrUnknownReceivableMayNotAuthorizeAnAction: true,
      missingDrilldownMayNotReuseAnOlderRevision: true });
    expect(value.nextStepPolicy.orderedValues).toEqual([
      'continue_internal_review','record_internal_note','record_promise_to_pay',
      'close_internal_review_no_action','request_mission28_reviewed_handoff',
      'request_manual_payment_link_resend',
    ]);
    expect(value.nextStepPolicy).toMatchObject({ exactlyOneExplicitSelectionRequired: true,
      noDefaultOrInferredSelection: true,
      selectedMission28OrResendStepIsExecutionAuthority: false });
  });

  test('keeps notes and promise-to-pay append-only, exact and non-executing', () => {
    const value = contract.unavailable();
    expect(value.notePolicy.requiredFields).toEqual([
      'noteIdentity','issuedInvoiceIdentity','issuedInvoiceVersionDigest',
      'receivableProjectionDigest','body','reason','actorUserIdentity','recordedAt',
      'revision','digest',
    ]);
    expect(value.notePolicy).toMatchObject({ supported: true, appendOnly: true,
      minimumBodyCharacters: 1, maximumBodyCharacters: 2000,
      boundedReasonRequired: true, exactCurrentReceivableWitnessRequired: true,
      noteMayAuthorizeCustomerContactFeeChargeOrBalanceChange: false,
      noteMayContainProviderCredentialOrPaymentInstrument: false });
    expect(value.promiseToPayPolicy).toMatchObject({ supported: true, appendOnly: true,
      exactCustomerCommitmentEvidenceRequired: true,
      exactCurrentIssuedInvoiceBalanceAndCurrencyRequired: true,
      promisedAmountMustBePositiveAndNoGreaterThanOutstandingBalance: true,
      promisedDateAndTenantBusinessTimezoneRequired: true,
      boundedReasonAndIdempotencyRequired: true, promiseIsPaymentAuthorization: false,
      promiseIsPaymentSettlement: false,
      promiseAuthorizesAutomaticReminderRetryChargeOrFee: false,
      missedPromiseAuthorizesEscalationSuspensionCreditReportingOrLegalReferral: false });
  });

  test('keeps values private and every communication, financial and external effect disabled', () => {
    const value = contract.unavailable();
    expect(value.unsupportedExecution).toEqual({
      mission27DirectCollectionCommunication: 'collection_communication_unsupported',
      automaticReminder: 'automatic_reminder_unsupported',
      automaticPaymentRetry: 'automatic_payment_retry_unsupported',
      savedInstrumentCharge: 'saved_instrument_charge_unsupported',
      lateFee: 'late_fee_unsupported', nsfFee: 'nsf_fee_unsupported',
      collectionFee: 'collection_fee_unsupported',
      automaticEscalation: 'collection_escalation_unsupported',
      serviceSuspension: 'service_suspension_unsupported',
      accountSuspension: 'account_suspension_unsupported',
      creditReporting: 'credit_reporting_unsupported',
      legalReferral: 'legal_collection_referral_unsupported',
      externalExecution: 'collection_execution_unsupported',
      mission28Handoff: 'mission28_handoff_unavailable',
    });
    expect(value.projection).toEqual({ queueRows: [], queueAsOf: null,
      queueRevision: null, queueDigest: null, selectedReceivable: null,
      activeFilters: null, internalNotes: [], promisesToPay: [], selectedNextStep: null,
      reviewRevision: null, reviewDigest: null });
    expect(Object.values(value.authority).every(item => item === false)).toBe(true);
    expect(Object.values(value.privacy).every(item => item === false)).toBe(true);
    expect(value).toMatchObject({ requestContextCurrentnessRevalidated: true,
      receivableProjectionCurrentnessRevalidated: false, collectionReviewRowCount: 0,
      collectionNoteRowCount: 0, promiseToPayRowCount: 0, nextStepSelectionRowCount: 0,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      accountingMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /11111111-1111|22222222-2222|customer@example|promise text|acct_|pi_|client_secret/i);
  });

  test('rejects stale, missing, reordered, widened, contradictory and leaked contracts', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value, sourceWitness: { ...value.sourceWitness,
      receivableAgingDigest: '0'.repeat(64) } })).toThrow('Collection-review boundary invalid');
    expect(() => contract.project({ ...value, queuePolicy: { ...value.queuePolicy,
      filterOrder: [...value.queuePolicy.filterOrder].reverse() } })).toThrow();
    expect(() => contract.project({ ...value, nextStepPolicy: { ...value.nextStepPolicy,
      orderedValues: [...value.nextStepPolicy.orderedValues, 'charge_saved_card'] } })).toThrow();
    expect(() => contract.project({ ...value, authority: { ...value.authority,
      promiseToPayRecordAuthorized: true } })).toThrow();
    expect(() => contract.project({ ...value, projection: { ...value.projection,
      selectedReceivable: { customerEmail: 'customer@example.test' } } })).toThrow();
    const { promiseToPayPolicy: _promise, ...missing } = value;
    expect(() => contract.project(missing)).toThrow();
  });

  test('repository binds the exact Part 10A source and route fails closed before source entry', async () => {
    const sourceRead = jest.fn().mockResolvedValue(receivableAging.unavailable());
    await expect(repository.read(source, { readReceivableAging: sourceRead }))
      .resolves.toEqual(contract.unavailable());
    expect(sourceRead).toHaveBeenCalledWith(source);
    const malformedRead = jest.fn().mockResolvedValue({ ...receivableAging.unavailable(),
      projectedReceivableRowCount: 1 });
    await expect(repository.read(source, { readReceivableAging: malformedRead }))
      .rejects.toMatchObject({ code: 'CUSTOMER_FINANCIAL_COLLECTION_REVIEW_UNAVAILABLE',
        status: 503 });

    const repositoryRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express();
    app.use((req,_res,next) => { req.tenantContext = { organizationId: source.organizationId,
      userId: source.actorUserId }; req.userRole = 'owner';
      req.authSession = { id: source.authSessionId }; next(); });
    app.use('/api/v1/customer-financial/collection-review',
      createCustomerFinancialCollectionReviewRouter({ read: repositoryRead,
        auth: (_req,_res,next) => next(), role: (_req,_res,next) => next(),
        throttle: (_req,_res,next) => next() }));
    const widened = await request(app).get('/api/v1/customer-financial/collection-review')
      .query({ customerId: 'victim', amount: '0', action: 'charge' });
    expect(widened.status).toBe(400); expect(repositoryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|charge/);
    for (const method of ['head','options','post','put','patch','delete']) {
      const response = await request(app)[method]('/api/v1/customer-financial/collection-review')
        .query({ action: 'collect', promise: 'tomorrow' });
      expect(response.status).toBe(405);
      expect(response.headers['cache-control']).toContain('no-store');
    }
    expect(repositoryRead).not.toHaveBeenCalled();
    const response = await request(app).get('/api/v1/customer-financial/collection-review');
    expect(response.status).toBe(200); expect(response.body.data).toEqual(contract.unavailable());
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers.vary).toContain('Cookie');
    expect(repositoryRead).toHaveBeenCalledTimes(1);
  });

  test('keeps OPTIONS in the method gate and adds no mutation, demo, transport or migration', async () => {
    const resolveOptions = requestPath => new Promise((resolve, reject) => corsOptions({
      path: requestPath, header: () => undefined,
    }, (error, options) => error ? reject(error) : resolve(options)));
    await expect(resolveOptions('/api/v1/customer-financial/collection-review')).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    await expect(resolveOptions('/api/v1/customer-financial/collection-review/')).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    const route = read('src/routes/customerFinancialCollectionReview.js');
    const sourceCode = [read('src/customerFinancial/collectionReview.js'),
      read('src/customerFinancial/collectionReviewRepository.js'), route].join('\n');
    expect(route).toContain("router.all('/', (req, res, next)");
    expect(route).toContain("req.method === 'GET'");
    expect(route).toContain("router.get('/', auth, role, throttle");
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(sourceCode).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('customer-financial/collection-review');
    expect(read('src/server.js')).toContain(
      "app.use('/api/v1/customer-financial/collection-review'");
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
