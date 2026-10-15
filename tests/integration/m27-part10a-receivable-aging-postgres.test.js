'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const contract = require('../../src/customerFinancial/receivableAging');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 10A mounted receivable population and aging', () => {
  let fixture; let transport; let repositoryRead;
  const route = '/api/v1/customer-financial/receivables';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    repositoryRead = jest.spyOn(
      require('../../src/customerFinancial/receivableAgingRepository'), 'read');
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('External transport forbidden in Part 10A');
    });
    fixture = await createEstimateReviewFixture({ additionalCompleteEstimates: 1 });
  }, 180000);

  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  test('owner and administrator receive exact tenant-private typed incomplete coverage', async () => {
    const owner = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const admin = await request(fixture.app).get(route).set(fixture.actors.admin.session.headers);
    expect(owner.status).toBe(200); expect(admin.status).toBe(200);
    expect(owner.body.data).toEqual(admin.body.data);
    expect(() => contract.project(owner.body.data)).not.toThrow();
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toMatchObject({ state: 'incomplete',
      reason: 'receivable_population_incomplete', value: null,
      coverage: { complete: false, populationSourceState: 'unavailable',
        completenessProven: false, missingReceivablesMayBeZero: false,
        projectedRowCount: 0, totalReceivableCount: null },
      projection: { receivables: [], totalIssuedMinorUnits: null,
        totalOutstandingMinorUnits: null, bucketCounts: null },
      projectedReceivableRowCount: 0, providerCallCount: 0,
      receiverMutationCount: 0, liveMoneyMovementCount: 0 });
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      new RegExp(`${fixture.org}|${fixture.actors.owner.actorUserId}|customer@example|acct_|pi_`, 'i'));
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('session, role, query, tenant and subscription gates fail closed', async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers);
    expect(crossTenant.status).toBe(200);
    expect(crossTenant.body.data).toEqual(contract.unavailable());
    expect(JSON.stringify(crossTenant.body)).not.toContain(fixture.org);
    const widened = await request(fixture.app).get(route)
      .query({ tenantId: fixture.org, customerId: 'victim', balanceMinorUnits: '0',
        dueDate: '2026-01-01', agingBucket: 'current' })
      .set(fixture.actors.owner.session.headers);
    expect(widened.status).toBe(400);
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|2026-01-01|balanceMinorUnits/);
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

  test('HEAD and OPTIONS stop before the read boundary without disclosure or effect', async () => {
    const count = async () => (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%receivable%' OR table_name LIKE '%aging%' OR
        table_name LIKE '%collection%' OR table_name LIKE '%promise%to%pay%')) part10_tables`)).rows[0];
    const before = await count();
    repositoryRead.mockClear();
    const head = await request(fixture.app).head(route)
      .set(fixture.actors.owner.session.headers);
    const options = await request(fixture.app).options(route)
      .set(fixture.actors.owner.session.headers);
    expect(head.status).toBe(405); expect(options.status).toBe(405);
    expect(head.headers['cache-control']).toContain('no-store');
    expect(options.headers['cache-control']).toContain('no-store');
    expect(options.headers.allow).toBeUndefined();
    expect(JSON.stringify(options.body)).not.toMatch(
      new RegExp(`${fixture.org}|${fixture.actors.owner.actorUserId}|balance|dueDate`, 'i'));
    expect(repositoryRead).not.toHaveBeenCalled();
    expect(await count()).toEqual(before);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('read is restart-safe and creates no receivable, collection or external residue', async () => {
    const count = async () => (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%receivable%' OR table_name LIKE '%aging%' OR
        table_name LIKE '%collection%' OR table_name LIKE '%promise%to%pay%')) part10_tables`)).rows[0];
    const before = await count();
    const first = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);
    expect((await request(fixture.app).post(route)
      .set(fixture.actors.owner.session.headers).send({ action: 'collect' })).status).toBe(405);
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
