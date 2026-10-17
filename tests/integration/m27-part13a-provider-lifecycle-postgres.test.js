'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const contract = require('../../src/customerFinancial/providerLifecycleHealth');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 13A mounted provider lifecycle health boundary', () => {
  let fixture; let transport;
  const route = '/api/v1/customer-financial/payment-provider/lifecycle-health';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('External transport forbidden in Part 13A');
    });
    fixture = await createEstimateReviewFixture({ additionalCompleteEstimates: 0 });
  }, 180000);

  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  test('paid owner reads the exact private value-free lifecycle contract', async () => {
    const response = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.body.data).toEqual(contract.unavailable());
    expect(response.body.data).toMatchObject({
      adapter: { registrationState: 'unavailable', registeredAdapterIdentity: null },
      accountHealth: { state: 'unavailable', providerAccountIdentity: null,
        mayBeAssumedHealthy: false },
      capabilityDrift: { driftState: 'unavailable', driftMayBeAssumedAbsent: false,
        driftBlocksConnectionAndInitiation: true },
      webhookLifecycle: { authorityState: 'unavailable', endpointIdentity: null,
        endpointUrl: null, secretReference: null },
      modeIsolation: { policyMode: 'test', liveModeEnabled: false },
      connectionRecovery: { automaticReconnectAuthorized: false },
      incidentControl: { rolloutStage: 'disabled', paymentInitiationAuthorized: false },
      providerCallCount: 0, providerMutationCount: 0, credentialMutationCount: 0,
      webhookMutationCount: 0, receiverMutationCount: 0, accountingMutationCount: 0,
      liveMoneyMovementCount: 0,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  test('auth, role, query, body, method and current subscription gates fail closed', async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.admin.session.headers)).status).toBe(403);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const query = await request(fixture.app).get(route + '?account=acct_forbidden&mode=live')
      .set(fixture.actors.owner.session.headers);
    expect(query.status).toBe(400);
    expect(JSON.stringify(query.body)).not.toMatch(/acct_forbidden|mode=live/);
    for (const body of ['"sk_forbidden"', '{malformed',
      JSON.stringify({ account: 'acct_forbidden', amount: 100, identity: 'victim' })]) {
      const response = await request(fixture.app).get(route)
        .set(fixture.actors.owner.session.headers).set('Content-Type','application/json')
        .send(body);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_forbidden|acct_forbidden|victim|malformed/);
    }
    for (const method of ['head','options','post','put','patch','delete']) {
      const response = await request(fixture.app)[method](route)
        .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','GET')
        .set('Content-Type','application/json').send('"sk_forbidden"');
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe('GET');
      expect(response.headers['cache-control']).toContain('private');
      expect([undefined,'GET']).toContain(response.headers['access-control-allow-methods']);
      expect(JSON.stringify(response.body)).not.toContain('sk_forbidden');
    }
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers)).status).toBe(403);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect(transport).not.toHaveBeenCalled();
  });

  test('case/slash equivalents remain protected while near misses do not acquire the boundary', async () => {
    for (const accepted of [route, route + '/', route.toUpperCase()]) {
      const response = await request(fixture.app).get(accepted)
        .set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(contract.unavailable());
    }
    for (const rejected of [route + '/extra', route.replace('lifecycle-health','lifecycle-healthx'),
      route.replace('/payment-provider/','/payment-provider//'),
      route.replace('lifecycle-health','lifecycle%2Dhealth')]) {
      expect((await request(fixture.app).get(rejected)
        .set(fixture.actors.owner.session.headers)).status).toBe(404);
    }
  });

  test('reads leave no credential or financial residue and remain exact after restart', async () => {
    const count = async () => (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews`)).rows[0];
    const before = await count();
    const first = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);
    expect(await count()).toEqual(before);
    expect(await fixture.db.initDatabase()).toBe(true);
    const restarted = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(restarted.status).toBe(200);
    expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    const migrations = await fixture.ownerPool.query(
      "SELECT filename FROM public._migrations WHERE filename LIKE '273_%'");
    expect(migrations.rowCount).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);
});
