'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const contract = require('../../src/customerFinancial/receivableAging');
const repository = require('../../src/customerFinancial/receivableAgingRepository');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialReceivablesRouter } =
  require('../../src/routes/customerFinancialReceivables');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 10A receivable population and aging', () => {
  test('keeps exact receivable OPTIONS requests inside the fail-closed route boundary', async () => {
    const resolveOptions = requestPath => new Promise((resolve, reject) => corsOptions({
      path: requestPath, header: () => undefined,
    }, (error, options) => error ? reject(error) : resolve(options)));
    await expect(resolveOptions('/api/v1/customer-financial/receivables')).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    await expect(resolveOptions('/api/v1/customer-financial/receivables/')).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    await expect(resolveOptions('/api/v1/customer-financial/payment-provider')).resolves
      .toMatchObject({ preflightContinue: false });
  });

  test('pins the exact frozen aging authority and typed incomplete coverage', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-receivable-aging-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'incomplete', reason: 'receivable_population_incomplete', value: null,
      access: { tenantPrivate: true, eligibleAccessRoles: ['owner','admin'],
        currentTenantSessionRequired: true, currentSubscriptionRequired: true,
        crossTenantAccessAllowed: false, readOnlyProjection: true },
      coverage: { state: 'incomplete', complete: false,
        populationSource: 'immutable_current_issued_receivables',
        populationSourceState: 'unavailable',
        populationSourceReason: 'issued_receivable_population_unavailable',
        completenessProven: false, partialPopulationMayBePresentedAsComplete: false,
        missingReceivablesMayBeZero: false, maximumPageSize: 100,
        projectedRowCount: 0, totalReceivableCount: null, asOf: null },
    });
    expect(value.coverage.incompleteStates).toEqual([
      'issued_receivable_population_unavailable', 'issued_balance_unavailable',
      'issued_due_date_unavailable', 'trusted_server_clock_unavailable',
      'dispute_refund_hold_unavailable', 'customer_contactability_unavailable',
      'receivable_projection_currentness_unavailable',
    ]);
  });

  test('freezes the exact receivable fields, bucket boundaries, holds and contactability', () => {
    const value = contract.unavailable();
    expect(value.receivableContract.requiredFields).toEqual([
      'issuedInvoiceIdentity', 'issuedInvoiceVersionDigest', 'customerIdentity',
      'currency', 'issuedMinorUnits', 'outstandingMinorUnits', 'issuedDueDate',
      'agingBucket', 'daysPastDue', 'disputeHold', 'refundHold', 'contactability',
      'projectionRevision', 'projectionDigest',
    ]);
    expect(value.receivableContract).toMatchObject({ exactCurrentIssuedInvoiceRequired: true,
      exactCurrentIssuedBalanceRequired: true, exactCurrencyRequired: 'USD',
      exactIssuedDueDateRequired: true, trustedServerClockRequired: true,
      disputeAndRefundHoldsRemainSeparate: true,
      heldReceivableMayBeRemovedFromBalance: false,
      exactReviewedContactabilityEvidenceRequired: true,
      contactabilityStates: ['contactable','not_contactable','unknown'],
      contactabilityAuthorizesCommunication: false,
      missingAmountDateHoldOrContactabilityMayBecomeZeroOrCurrent: false });
    expect(value.agingPolicy.buckets).toEqual([
      { bucket: 'not_due', minimumDaysPastDue: null, maximumDaysPastDue: -1 },
      { bucket: 'due_today', minimumDaysPastDue: 0, maximumDaysPastDue: 0 },
      { bucket: 'overdue_1_30', minimumDaysPastDue: 1, maximumDaysPastDue: 30 },
      { bucket: 'overdue_31_60', minimumDaysPastDue: 31, maximumDaysPastDue: 60 },
      { bucket: 'overdue_61_90', minimumDaysPastDue: 61, maximumDaysPastDue: 90 },
      { bucket: 'overdue_91_plus', minimumDaysPastDue: 91, maximumDaysPastDue: null },
    ]);
    expect(value.agingPolicy).toMatchObject({
      dateBasis: 'issued_due_date_in_tenant_business_timezone',
      clockBasis: 'trusted_server_clock', issuedDueDateMayBeInferred: false,
      missingDueDateMayBecomeDueToday: false, missingBalanceMayEnterABucket: false,
      exactZeroBalanceIsNotAnOpenReceivable: true,
      dueOrOverdueAuthorizesReminderFeeCollectionOrCharge: false });
    expect(value.holds).toEqual({ disputeState: 'unavailable',
      disputeReason: 'dispute_refund_hold_unavailable', refundState: 'unavailable',
      refundReason: 'dispute_refund_hold_unavailable', pendingHoldBlocksCollectionReview: true,
      holdChangesIssuedOrOutstandingAmount: false, holdAuthorizesCustomerContact: false });
    expect(value.contactability).toEqual({ state: 'unavailable',
      reason: 'customer_contactability_unavailable', value: null,
      reviewedRecipientRequired: true, deliveryEvidenceMaySubstituteForRecipientReview: false,
      staffRoleMaySubstituteForCustomerConsent: false,
      customerIdentityOrRecipientExposed: false });
  });

  test('keeps population, money, authority, privacy and effects value-free', () => {
    const value = contract.unavailable();
    expect(value.projection).toEqual({ receivables: [], totalIssuedMinorUnits: null,
      totalOutstandingMinorUnits: null, heldOutstandingMinorUnits: null, currency: null,
      bucketCounts: null, bucketOutstandingMinorUnits: null, oldestIssuedDueDate: null,
      oldestDaysPastDue: null, projectionRevision: null, projectionDigest: null });
    expect(Object.values(value.authority).every(item => item === false)).toBe(true);
    expect(Object.values(value.privacy).every(item => item === false)).toBe(true);
    expect(value).toMatchObject({ requestContextCurrentnessRevalidated: true,
      receivableProjectionCurrentnessRevalidated: false,
      projectedReceivableRowCount: 0, collectionReviewRowCount: 0,
      promiseToPayRowCount: 0, providerCallCount: 0, providerMutationCount: 0,
      receiverMutationCount: 0, accountingMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /11111111-1111|22222222-2222|customer@example|123 main|acct_|pi_|client_secret/i);
  });

  test('rejects missing, reordered, widened, contradictory and leaked contracts', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value,
      coverage: { ...value.coverage, incompleteStates: [...value.coverage.incompleteStates].reverse() } }))
      .toThrow('Receivable-aging boundary invalid');
    expect(() => contract.project({ ...value,
      agingPolicy: { ...value.agingPolicy, missingDueDateMayBecomeDueToday: true } })).toThrow();
    expect(() => contract.project({ ...value,
      projection: { ...value.projection, totalOutstandingMinorUnits: '0' } })).toThrow();
    expect(() => contract.project({ ...value,
      authority: { ...value.authority, collectionReviewAuthorized: true } })).toThrow();
    expect(() => contract.project({ ...value,
      contactability: { ...value.contactability, value: 'customer@example.test' } })).toThrow();
    const { holds: _holds, ...missing } = value;
    expect(() => contract.project(missing)).toThrow();
  });

  test('repository and mounted route accept only current owner/admin tenant sessions', async () => {
    await expect(repository.read(source)).resolves.toEqual(contract.unavailable());
    await expect(repository.read({ ...source, actorAccessRole: 'admin' }))
      .resolves.toEqual(contract.unavailable());
    for (const invalid of [null, {}, { ...source, actorAccessRole: 'member' },
      { ...source, organizationId: 'victim' }, { ...source, authSessionId: null }]) {
      await expect(repository.read(invalid)).rejects.toMatchObject({
        code: 'CUSTOMER_FINANCIAL_RECEIVABLE_AGING_RESTRICTED', status: 403 });
    }

    const repositoryRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express();
    app.use((req,_res,next) => { req.tenantContext = { organizationId: source.organizationId,
      userId: source.actorUserId }; req.userRole = 'owner';
      req.authSession = { id: source.authSessionId }; next(); });
    app.use('/api/v1/customer-financial/receivables',
      createCustomerFinancialReceivablesRouter({ read: repositoryRead,
        auth: (_req,_res,next) => next(), role: (_req,_res,next) => next(),
        throttle: (_req,_res,next) => next() }));
    const widened = await request(app).get('/api/v1/customer-financial/receivables')
      .query({ customerId: 'victim', balanceMinorUnits: '0', dueDate: '2026-01-01' });
    expect(widened.status).toBe(400); expect(repositoryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|2026-01-01/);
    const head = await request(app).head('/api/v1/customer-financial/receivables');
    const options = await request(app).options('/api/v1/customer-financial/receivables');
    expect(head.status).toBe(405); expect(options.status).toBe(405);
    expect(head.headers['cache-control']).toContain('no-store');
    expect(options.headers['cache-control']).toContain('no-store');
    expect(options.headers.allow).toBeUndefined();
    expect(JSON.stringify(options.body)).not.toMatch(/victim|balance|dueDate/i);
    expect(repositoryRead).not.toHaveBeenCalled();
    const response = await request(app).get('/api/v1/customer-financial/receivables');
    expect(response.status).toBe(200); expect(response.body.data).toEqual(contract.unavailable());
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Cookie');
    expect(repositoryRead).toHaveBeenCalledTimes(1);
    expect((await request(app).post('/api/v1/customer-financial/receivables')
      .send({ action: 'collect' })).status).toBe(405);
  });

  test('adds no financial table, mutation, demo surface, provider transport or migration 273', () => {
    const route = read('src/routes/customerFinancialReceivables.js');
    const sourceCode = [read('src/customerFinancial/receivableAging.js'),
      read('src/customerFinancial/receivableAgingRepository.js'), route].join('\n');
    expect(route).toContain("router.get('/', auth, role, throttle");
    expect(route).toContain("router.all('/', (req, res, next)");
    expect(route).toContain("req.method === 'GET'");
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(route).toContain("requireRole('owner','admin')");
    expect(sourceCode).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('customer-financial/receivables');
    expect(read('src/server.js')).toContain(
      "app.use('/api/v1/customer-financial/receivables'");
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
