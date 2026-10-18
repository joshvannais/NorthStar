'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const contract = require('../../src/customerFinancial/providerLifecycleAcceptance');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 13D mounted provider lifecycle acceptance boundary', () => {
  let fixture; let transport;
  const route = '/api/v1/customer-financial/payment-provider/lifecycle-acceptance';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('External transport forbidden in Part 13D');
    });
    fixture = await createEstimateReviewFixture({ additionalCompleteEstimates: 0 });
  }, 180000);

  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  test('paid owner reads exact private value-free provider acceptance readiness', async () => {
    const response = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.body.data).toEqual(contract.unavailable());
    expect(response.body.data).toMatchObject({
      loadAndCapacity: { state: 'unavailable', maximumJsonRequestBytes: 65536,
        maximumPageSize: 100, concurrentWriterPerAggregate: 1,
        loadTestAccepted: false, capacityAccepted: false },
      abuseResistance: { state: 'unavailable', exactTenantAndSessionRequired: true,
        requestBodyAllowed: false, unsupportedMethodsFailClosed: true,
        abuseResistanceAccepted: false },
      securityReview: { state: 'unavailable', accepted: false,
        providerSandboxAuthorized: false, livePaymentAuthorized: false },
      disasterRecovery: { state: 'unavailable', requiredMigrationSequence: 272,
        restoreTestAccepted: false, productionRestoreAuthorized: false },
      independentAcceptance: { state: 'unavailable', auditPerformed: false,
        accepted: false },
      missionVerdicts: { fullLocal: false, providerSandboxAccepted: false,
        livePaymentAccepted: false, missionComplete: false },
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      accountingMutationCount: 0, databaseMutationCount: 0, liveMoneyMovementCount: 0,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  test('auth, role, subscription, query, body and methods fail closed before effects', async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.admin.session.headers)).status).toBe(403);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const query = await request(fixture.app)
      .get(route + '?account=acct_forbidden&receipt=victim&mode=live')
      .set(fixture.actors.owner.session.headers);
    expect(query.status).toBe(400);
    expect(JSON.stringify(query.body)).not.toMatch(/acct_forbidden|victim|mode=live/);
    for (const body of ['"sk_forbidden"', '{malformed',
      JSON.stringify({ account: 'acct_forbidden', amount: 100, identity: 'victim' })]) {
      const response = await request(fixture.app).get(route)
        .set(fixture.actors.owner.session.headers).set('Content-Type','application/json').send(body);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_forbidden|acct_forbidden|victim|malformed/);
    }
    for (const method of ['head','options','post','put','patch','delete']) {
      const response = await request(fixture.app)[method](route)
        .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','GET')
        .set('Content-Type','application/json').send('"sk_forbidden"');
      expect(response.status).toBe(405); expect(response.headers.allow).toBe('GET');
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body)).not.toContain('sk_forbidden');
    }
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    try {
      expect((await request(fixture.app).get(route)
        .set(fixture.actors.owner.session.headers)).status).toBe(403);
    } finally {
      await fixture.ownerPool.query(
        "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
        [fixture.org]);
    }
    expect(transport).not.toHaveBeenCalled();
  }, 60000);

  test('restart and repeated concurrent reads remain exact with zero residue or transport', async () => {
    const count = async () => (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews`)).rows[0];
    const before = await count();
    const first = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
      request(fixture.app).get(route).set(fixture.actors.owner.session.headers)));
    expect(concurrent.every(item => item.status === 200 &&
      JSON.stringify(item.body) === JSON.stringify(first.body))).toBe(true);
    expect(await count()).toEqual(before);
    expect(await fixture.db.initDatabase()).toBe(true);
    const second = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    expect(second.status).toBe(200); expect(second.body).toEqual(first.body);
    expect(await count()).toEqual(before);
    const migrations = await fixture.ownerPool.query(
      "SELECT filename FROM public._migrations WHERE filename LIKE '273_%'");
    expect(migrations.rowCount).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  }, 60000);
});
