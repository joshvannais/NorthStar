'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createPart4ePaidBrowserFixture } =
  require('../helpers/m27-part4e-paid-journey-fixture');
const contract = require('../../src/customerFinancial/paymentSettlementPayout');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 8D mounted settlement and payout reconciliation readiness', () => {
  let prepared; let transport; let route; let query;

  async function completeCurrentPart4() {
    const { fixture, actor, estimate, receipt } = prepared;
    const base = `/api/v1/customer-financial/editable-estimates/${estimate}`;
    query = { handoffReceiptId: receipt.receiptId,
      handoffReceiptDigest: receipt.receiptDigest };
    route = `${base}/settlement-payout-reconciliation`;
    const capability = await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ confirmed: true,
        confirmationVersion: 'm27-invoice-draft-workflow-capability-v1' });
    expect(capability.status).toBe(200);
    const grant = capability.body.data;
    const adminCapability = await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`)
      .set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token', fixture.actors.admin.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ confirmed: true,
        confirmationVersion: 'm27-invoice-draft-workflow-capability-v1' });
    expect(adminCapability.status).toBe(200);
    const originRoute = `${base}/invoice-draft-origin`;
    const candidate = await request(fixture.app).get(originRoute).query(query)
      .set(actor.session.headers);
    expect(candidate.status).toBe(200);
    expect(candidate.body.data.state).toBe('ready_to_capture');
    const origin = await request(fixture.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion,
        expectedCandidateDigest: candidate.body.data.candidateDigest,
        reason: 'Owner captured the exact synthetic Part 8D invoice source.', confirmed: true,
        confirmationVersion: 'm27-invoice-draft-origin-capture-v1' });
    expect(origin.status).toBe(201);

    const draftRoute = `${base}/invoice-draft`;
    const baseline = await request(fixture.app).get(draftRoute).query(query)
      .set(actor.session.headers);
    expect(baseline.status).toBe(200);
    const edit = { contractVersion: 'm27-invoice-draft-edit-v1',
      originId: baseline.body.data.originId, originDigest: baseline.body.data.originDigest,
      lines: baseline.body.data.lines.map((line, ordinal) => ({ ordinal,
        sourceLineDigest: line.sourceLineDigest, group: line.group,
        description: ordinal === 0 ? `${line.description} — reviewed for Part 8D` : line.description,
        allocatedMinorUnits: line.allocatedAmount.minorUnits })) };
    const draft = await request(fixture.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion, expectedRevision: Number(baseline.body.data.revision),
        expectedDraftDigest: baseline.body.data.draftDigest, draft: edit,
        reason: 'Owner reviewed exact wording for the Part 8D settlement boundary.', confirmed: true,
        confirmationVersion: 'm27-invoice-draft-revision-save-v1' });
    expect(draft.status).toBe(201);

    const taxRoute = `${base}/invoice-draft/tax-review`;
    const taxCandidate = await request(fixture.app).get(taxRoute).query(query)
      .set(actor.session.headers);
    expect(taxCandidate.status).toBe(200);
    expect(taxCandidate.body.data.state).toBe('ready_to_record');
    const tax = await request(fixture.app).post(taxRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion,
        expectedCandidateDigest: taxCandidate.body.data.candidateDigest,
        reason: 'Owner reviewed exact synthetic Part 8D tax preparation.', confirmed: true,
        confirmationVersion: 'm27-invoice-date-tax-review-record-v1' });
    expect(tax.status).toBe(201);
  }

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('Provider transport forbidden in Part 8D');
    });
    prepared = await createPart4ePaidBrowserFixture();
    await completeCurrentPart4();
  }, 240000);

  afterAll(async () => {
    try { if (prepared) await prepared.fixture.cleanup(); }
    finally { jest.restoreAllMocks(); }
  }, 180000);

  test('paid owner and administrator receive only the exact value-free projection', async () => {
    const owner = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(owner.status).toBe(200);
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toEqual(contract.unavailable());
    expect(owner.body.data).toMatchObject({ state: 'unavailable',
      reason: 'settlement_unavailable', value: null,
      access: { eligibleAccessRoles: ['owner', 'admin'],
        roleAloneAuthorizesReconciliation: false,
        manualReconciliationControlMode: 'dual_control', singleControlAllowed: false,
        manualSettlementOverrideAuthorized: false },
      fundsPolicy: { merchantOfRecord: 'contractor_business',
        northstarCustodyOrControl: false, provider: 'stripe_connect',
        providerAccountShape: 'tenant_bound_contractor_account',
        fundsDestination: 'contractor_connected_account', supportedMode: 'test',
        liveModeEnabled: false, currency: 'USD',
        providerFeeDisclosureState: 'unavailable', providerFeeMayBeAssumedZero: false,
        capturedPaymentMayBeTreatedAsSettledCash: false,
        settledBalanceTransactionMayBeTreatedAsPayout: false,
        payoutMayBeTreatedAsBankArrival: false,
        accountingAcknowledgementMayBeTreatedAsSettlement: false,
        settlementMayRecognizeEarnedRevenue: false },
      matching: { allocationBalanceCurrent: false, captureEvidenceAccepted: false,
        exactTenantMatch: false, exactProviderAccountMatch: false,
        exactBalanceTransactionMatch: false, exactCurrencyMatch: false,
        exactPayoutMembershipMatch: false, exactFundsDestinationMatch: false,
        duplicateDispositionState: 'unavailable', unmatchedEvidenceRejected: true },
      authority: { paymentSuccessRecorded: false, captureRecorded: false,
        settlementRecorded: false, settledCashRecorded: false, payoutRecorded: false,
        bankArrivalRecorded: false, collectedCashRecorded: false,
        earnedRevenueRecognitionAuthorized: false },
      settlementProjectionRowCount: 0, payoutReconciliationRowCount: 0,
      providerCallCount: 0,
      providerMutationCount: 0, receiverMutationCount: 0,
      accountingMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(owner.body.data.requirements).toHaveLength(12);
    expect(['invoiceId','invoiceVersion','invoiceDigest','paymentIdentity','captureIdentity',
      'captureOccurredAt','balanceTransactionIdentity','balanceTransactionType',
      'balanceTransactionAvailableOn','currency','grossMinorUnits','feeMinorUnits','netMinorUnits',
      'settlementOccurredAt','payoutIdentity','payoutCreatedAt','payoutExpectedArrivalAt',
      'payoutArrivedAt','payoutMinorUnits','fundsDestinationIdentity',
      'bankArrivalEvidenceIdentity','reconciliationRevision','reconciliationDigest']
      .every(field => owner.body.data.projection[field] === null)).toBe(true);
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      /customerId|organizationId|actorUserId|email|address|description|acct_[a-z0-9]|evt_[a-z0-9]|pi_[a-z0-9]|txn_[a-z0-9]|po_[a-z0-9]|sk_test/i);
    const admin = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.admin.session.headers);
    expect(admin.status).toBe(200); expect(admin.body.data).toEqual(owner.body.data);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('session, role, tenant, exact query and subscription gates fail closed', async () => {
    expect((await request(prepared.fixture.app).get(route).query(query)).status).toBe(401);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.member.session.headers)).status).toBe(403);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.viewer.session.headers)).status).toBe(403);
    const crossTenant = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.otherOwner.session.headers);
    expect([403,404,503]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(
      new RegExp(`${prepared.estimate}|${prepared.receipt.receiptId}`, 'i'));
    expect((await request(prepared.fixture.app).get(route)
      .query({ handoffReceiptId: query.handoffReceiptId })
      .set(prepared.actor.session.headers)).status).toBe(400);
    expect((await request(prepared.fixture.app).get(route)
      .query({ ...query, amount: '50', currency: 'USD', providerAccountId: 'acct_victim',
        providerEventId: 'evt_victim', providerPaymentId: 'pi_victim',
        balanceTransactionId: 'txn_victim', payoutId: 'po_victim' })
      .set(prepared.actor.session.headers)).status).toBe(400);
    expect((await request(prepared.fixture.app).post(route).set(prepared.actor.session.headers)
      .set('X-CSRF-Token', prepared.actor.csrfToken)
      .send({ amountMinorUnits: '50' })).status).toBe(404);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers)).status).toBe(403);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('reads are deterministic, restart-safe and create no credential or financial residue', async () => {
    const count = async () => (await prepared.fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%provider%event%' OR table_name LIKE '%event%normal%' OR
        table_name LIKE '%payment%alloc%' OR table_name LIKE '%balance%projection%' OR
        table_name LIKE '%settlement%' OR table_name LIKE '%payout%')) part8_tables`)).rows[0];
    const before = await count();
    const first = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    const second = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(first.status).toBe(200); expect(second.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect(await prepared.fixture.db.initDatabase()).toBe(true);
    const restarted = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(restarted.status).toBe(200); expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect((await prepared.fixture.ownerPool.query(
      "SELECT count(*)::int count FROM public._migrations WHERE filename LIKE '273_%'"))
      .rows[0].count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  }, 180000);
});
