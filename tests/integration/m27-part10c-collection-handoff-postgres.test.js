'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const collectionReview = require('../../src/customerFinancial/collectionReview');
const contract = require('../../src/customerFinancial/collectionHandoffReadiness');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 10C mounted collection handoff readiness', () => {
  let fixture; let transport; let sourceRead;
  const route = '/api/v1/customer-financial/collection-handoff';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    sourceRead = jest.spyOn(
      require('../../src/customerFinancial/collectionReviewRepository'), 'read');
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('External transport forbidden in Part 10C');
    });
    fixture = await createEstimateReviewFixture({ additionalCompleteEstimates: 1 });
  }, 180000);

  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  test('owner and administrator receive one strict source-bound value-free contract', async () => {
    const owner = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const admin = await request(fixture.app).get(route).set(fixture.actors.admin.session.headers);
    expect(owner.status).toBe(200); expect(admin.status).toBe(200);
    expect(owner.body.data).toEqual(admin.body.data);
    expect(() => contract.project(owner.body.data)).not.toThrow();
    expect(owner.body.data.sourceWitness).toMatchObject({
      collectionReviewVersion: collectionReview.CONTRACT_VERSION,
      reviewState: 'unavailable', receivablePopulationComplete: false,
      selectedNextStep: null, reviewRevision: null, reviewDigest: null,
    });
    expect(owner.body.data).toMatchObject({ state: 'unavailable',
      reason: 'receivable_population_incomplete',
      mission28ReminderHandoff: { state: 'unavailable',
        reason: 'mission28_handoff_unavailable', currentReceivingAdapterAvailable: false },
      manualPaymentLinkResend: { state: 'unavailable',
        founderRatificationRequired: true, currentFounderRatificationState: 'unavailable',
        currentExactCustomerStartedLinkMayBeRedeliveredOnlyAfterAllGates: true,
        terminalExpiredOrSupersededProviderSessionMayBeReused: false,
        newCheckoutMayBeCreatedByStaff: false,
        customerMayExplicitlyStartNewExactCheckoutAfterTerminalAttempt: true },
      projection: { selectedPath: null, issuedInvoiceIdentity: null,
        recipientEvidenceDigest: null, messagePreview: null, deliveryEvidence: null },
      handoffRequestRowCount: 0, manualResendRequestRowCount: 0,
      deliveryEvidenceRowCount: 0, outboundMessageCount: 0, providerCallCount: 0,
      receiverMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(JSON.stringify(owner.body)).not.toMatch(
      new RegExp(`${fixture.org}|${fixture.actors.owner.actorUserId}|customer@example|https://pay|client_secret|acct_|pi_`, 'i'));
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('session, role, query, tenant and subscription gates fail closed before source entry', async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers);
    expect(crossTenant.status).toBe(200);
    expect(crossTenant.body.data).toEqual(contract.unavailable());
    expect(JSON.stringify(crossTenant.body)).not.toContain(fixture.org);
    sourceRead.mockClear();
    const widened = await request(fixture.app).get(route)
      .query({ tenantId: fixture.org, invoiceId: 'victim', balanceMinorUnits: '0',
        recipient: 'customer@example.test', message: 'pay now',
        paymentLink: 'https://pay.example/secret', idempotencyKey: 'replay' })
      .set(fixture.actors.owner.session.headers);
    expect(widened.status).toBe(400); expect(sourceRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(
      /victim|customer@example|pay now|pay\.example|secret|replay/);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers)).status).toBe(403);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers)).status).toBe(200);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('every non-GET method stops before Part 10B source entry with no Allow widening', async () => {
    sourceRead.mockClear();
    for (const method of ['head','options','post','put','patch','delete']) {
      const response = await request(fixture.app)[method](route)
        .set(fixture.actors.owner.session.headers)
        .query({ path: 'manual_payment_link_resend', recipient: 'customer@example.test',
          message: 'pay now', paymentLink: 'https://pay.example/secret' });
      expect(response.status).toBe(405);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers.allow).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/customer@example|pay now|secret/);
    }
    expect(sourceRead).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('read is restart-safe and creates no handoff, resend, delivery or external residue', async () => {
    const count = async () => (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%receivable%' OR table_name LIKE '%aging%' OR
        table_name LIKE '%collection%' OR table_name LIKE '%promise%to%pay%' OR
        table_name LIKE '%payment%link%' OR table_name LIKE '%delivery%')) part10_tables`)).rows[0];
    const before = await count();
    const first = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);
    expect((await request(fixture.app).post(route)
      .set(fixture.actors.owner.session.headers)
      .send({ path: 'mission28_reviewed_reminder_handoff' })).status).toBe(405);
    expect(await count()).toEqual(before);
    expect(await fixture.db.initDatabase()).toBe(true);
    const restarted = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(restarted.status).toBe(200); expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect((await fixture.ownerPool.query(
      "SELECT count(*)::int count FROM public._migrations WHERE filename LIKE '273_%'"))
      .rows[0].count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  }, 180000);
});
