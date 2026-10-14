'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 7A mounted payment-provider boundary', () => {
  let fixture; let transport;
  const route = '/api/v1/customer-financial/payment-provider';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('Provider transport forbidden in Part 7A');
    });
    fixture = await createEstimateReviewFixture({ additionalCompleteEstimates: 0 });
  }, 180000);

  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  test('owner and administrator receive the exact deterministic value-free contract', async () => {
    const owner = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const admin = await request(fixture.app).get(route).set(fixture.actors.admin.session.headers);
    expect(owner.status).toBe(200); expect(admin.status).toBe(200);
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toEqual(admin.body.data);
    expect(owner.body.data).toMatchObject({
      contractVersion: 'm27-payment-provider-boundary-v1', state: 'unavailable',
      reason: 'payment_provider_unavailable', value: null,
      provider: { accountIdentityState: 'unavailable', accountIdentity: null,
        hostedOnboardingAuthorized: false },
      fees: { providerFeeDisclosureState: 'unavailable', providerFeeSchedule: null,
        feeMayBeAssumedZero: false },
      rollout: { stage: 'disabled', tenantFlagEnabled: false,
        paymentInitiationAuthorized: false },
      providerCallCount: 0, receiverMutationCount: 0, liveMoneyMovementCount: 0,
    });
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      /organizationId|actorUserId|authSessionId|client_secret|paymentInstrumentId/i);
    expect(transport).not.toHaveBeenCalled();
  });

  test('session, role, query and current-subscription gates fail closed', async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    expect((await request(fixture.app).get(route + '?tenant=victim')
      .set(fixture.actors.owner.session.headers)).status).toBe(400);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    const canceled = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(canceled.status).toBe(403);
    expect(canceled.body.code).toBe('product_access_required');
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers)).status).toBe(200);
  });

  test('read performs no provider, credential, financial or receiver mutation and survives restart', async () => {
    const before = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews`)).rows[0];
    const first = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);
    expect((await request(fixture.app).post(route)
      .set(fixture.actors.owner.session.headers).send({ action: 'connect' })).status).toBe(404);
    const after = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews`)).rows[0];
    expect(after).toEqual(before);
    expect(await fixture.db.initDatabase()).toBe(true);
    const restarted = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(restarted.status).toBe(200);
    expect(restarted.body.data).toEqual(first.body.data);
    expect(transport).not.toHaveBeenCalled();
    const migrations = await fixture.ownerPool.query(
      "SELECT filename FROM public._migrations WHERE filename LIKE '273_%'");
    expect(migrations.rowCount).toBe(0);
  }, 120000);
});
