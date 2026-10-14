'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const base = require('../../src/customerFinancial/paymentProviderBoundary');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 7B mounted provider connection boundary', () => {
  let fixture; let transport;
  const route = '/api/v1/customer-financial/payment-provider/connection';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('Provider transport forbidden in Part 7B');
    });
    fixture = await createEstimateReviewFixture({ additionalCompleteEstimates: 0 });
  }, 180000);

  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  test('paid owner reads the exact deterministic value-free lifecycle contract', async () => {
    const response = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.body.data).toMatchObject({
      contractVersion: 'm27-payment-provider-connection-v1',
      providerBoundaryVersion: 'm27-payment-provider-boundary-v1',
      providerBoundaryDigest: base.digest(base.unavailable()),
      state: 'unavailable', reason: 'provider_connection_prerequisites_unavailable', value: null,
      access: { eligibleAccessRole: 'owner', roleAloneAuthorizes: false,
        currentCapabilityState: 'unavailable', mfaState: 'unavailable' },
      binding: { providerAccountIdentity: null, activeMode: null,
        providerCapabilitySet: null, liveModeEnabled: false },
      credentials: { credentialAuthorityState: 'unavailable', secretReference: null,
        rawSecretInputAccepted: false, rawSecretStored: false, secretValueReturned: false },
      connectionAuthorized: false, providerCallCount: 0, providerMutationCount: 0,
      credentialMutationCount: 0, receiverMutationCount: 0, liveMoneyMovementCount: 0,
    });
    expect(JSON.stringify(response.body.data)).not.toMatch(
      /organizationId|actorUserId|authSessionId|client_secret|paymentInstrumentId/i);
    expect(transport).not.toHaveBeenCalled();
  });

  test('session, owner role, query, CSRF and current subscription gates fail closed', async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.admin.session.headers)).status).toBe(403);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    expect((await request(fixture.app).get(route + '?tenant=victim')
      .set(fixture.actors.owner.session.headers)).status).toBe(400);
    const noCsrf = await request(fixture.app).post(route + '/actions')
      .set('Cookie', fixture.actors.owner.session.headers.Cookie)
      .send({ operation: 'connect', confirmed: true, reason: 'Review test connection now.' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('csrf_invalid');
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers)).status).toBe(403);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
  });

  test('all exact policy actions remain named value-free while widened or secret-shaped input is rejected', async () => {
    const owner = fixture.actors.owner;
    for (const operation of ['connect','disconnect','rotate','revoke']) {
      const response = await request(fixture.app).post(route + '/actions')
        .set(owner.session.headers).set('X-CSRF-Token', owner.csrfToken)
        .send({ operation, confirmed: true, reason: `Review ${operation} in test mode.` });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ success: false,
        data: { state: 'unavailable', connectionAuthorized: false,
          providerCallCount: 0, providerMutationCount: 0, credentialMutationCount: 0 },
        error: { category: 'CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_UNAVAILABLE' } });
    }
    for (const body of [
      { operation: 'enable', confirmed: true, reason: 'Attempt to enable live mode.' },
      { operation: 'reconnect', confirmed: true, reason: 'Attempt automatic reconnect.' },
      { operation: 'connect', confirmed: true, reason: '            ' },
      { operation: 'connect', confirmed: true, reason: '  Review this test connection.  ' },
      { operation: 'connect', confirmed: true, reason: 'Attempt caller account injection.',
        providerAccountId: 'acct_victim' },
      { operation: 'connect', confirmed: true, reason: 'Attempt caller secret injection.',
        credential: 'sk_test_forbidden' },
    ]) {
      const response = await request(fixture.app).post(route + '/actions')
        .set(owner.session.headers).set('X-CSRF-Token', owner.csrfToken).send(body);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toMatch(/acct_victim|sk_test_forbidden/);
    }
    const queryInjection = await request(fixture.app)
      .post(route + '/actions?credential=sk_test_forbidden&providerAccountId=acct_victim&mode=live')
      .set(owner.session.headers).set('X-CSRF-Token', owner.csrfToken)
      .send({ operation: 'connect', confirmed: true, reason: 'Review test connection now.' });
    expect(queryInjection.status).toBe(400);
    expect(queryInjection.body.error.category)
      .toBe('CUSTOMER_FINANCIAL_PROVIDER_CONNECTION_INVALID');
    expect(JSON.stringify(queryInjection.body)).not.toMatch(/acct_victim|sk_test_forbidden|mode=live/);
    expect(transport).not.toHaveBeenCalled();
  });

  test('reads and denied intents leave no credential or financial residue and survive restart', async () => {
    const count = async () => (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews`)).rows[0];
    const before = await count();
    const first = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);
    const denied = await request(fixture.app).post(route + '/actions')
      .set(fixture.actors.owner.session.headers)
      .set('X-CSRF-Token', fixture.actors.owner.csrfToken)
      .send({ operation: 'connect', confirmed: true, reason: 'Review test connection now.' });
    expect(denied.status).toBe(409);
    expect(await count()).toEqual(before);
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
