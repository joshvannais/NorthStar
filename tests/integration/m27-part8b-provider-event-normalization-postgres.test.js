'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 8B mounted provider-event normalization readiness', () => {
  let fixture; let transport;
  const route = '/api/v1/customer-financial/payment-provider/event-normalization';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'OPENAI_API_KEY',
      'RETELL_API_KEY', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER',
      'SMTP_PASS']) delete process.env[key];
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('Provider transport forbidden in Part 8B');
    });
    fixture = await createEstimateReviewFixture({ additionalCompleteEstimates: 0 });
  }, 180000);

  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  test('owner and administrator receive the exact private value-free normalization contract', async () => {
    const owner = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const admin = await request(fixture.app).get(route).set(fixture.actors.admin.session.headers);
    expect(owner.status).toBe(200); expect(admin.status).toBe(200);
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toEqual(admin.body.data);
    expect(owner.body.data).toMatchObject({
      contractVersion: 'm27-provider-event-normalization-readiness-v1',
      state: 'unavailable', reason: 'provider_event_receipt_unavailable', value: null,
      receipt: { authenticationState: 'unavailable', signatureVerified: false,
        rawPayloadAccepted: false, providerEventIdentity: null,
        providerObjectIdentity: null, providerAccountIdentity: null },
      ordering: { arrivalOrderTrusted: false, receivedAtMaySelectProjection: false,
        globalNumericStateRankSupported: false, providerOccurrenceTimeRequired: true,
        duplicateOrReplayMayAdvanceProjection: false, olderEventMayRegressProjection: false,
        missingEvidenceMayBecomeZero: false },
      normalization: { inputAccepted: false, providerState: null,
        normalizedState: null, normalizationAuthorized: false },
      normalizationRowCount: 0, providerCallCount: 0, receiverMutationCount: 0,
      liveMoneyMovementCount: 0,
    });
    expect(owner.body.data.stateContract.map(item => item.providerState)).toEqual([
      'created', 'authorized', 'processing', 'succeeded', 'failed', 'canceled',
      'settled', 'reversed', 'corrected',
    ]);
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      /organizationId|actorUserId|authSessionId|client_secret|webhook_secret|acct_[a-z0-9]|evt_[a-z0-9]/i);
    expect(transport).not.toHaveBeenCalled();
  });

  test('session, role, query, method and current-subscription gates fail closed', async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const query = await request(fixture.app)
      .get(route + '?event=evt_forged&object=pi_victim&state=succeeded&amount=999999')
      .set(fixture.actors.owner.session.headers);
    expect(query.status).toBe(400);
    expect(JSON.stringify(query.body)).not.toMatch(/evt_forged|pi_victim|succeeded|999999/);
    expect((await request(fixture.app).post(route)
      .set(fixture.actors.owner.session.headers)
      .send({ event: 'evt_caller', state: 'settled' })).status).toBe(404);
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
  });

  test('read creates no provider-event, normalization, credential or financial residue and survives restart', async () => {
    const snapshot = async () => (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM information_schema.tables
       WHERE table_schema='public' AND
       (table_name LIKE '%provider%event%' OR table_name LIKE '%event%normal%')) event_tables`)).rows[0];
    const before = await snapshot();
    const first = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect(await fixture.db.initDatabase()).toBe(true);
    const restarted = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(restarted.status).toBe(200);
    expect(restarted.body.data).toEqual(first.body.data);
    expect(await snapshot()).toEqual(before);
    expect(transport).not.toHaveBeenCalled();
    const migrations = await fixture.ownerPool.query(
      "SELECT filename FROM public._migrations WHERE filename LIKE '273_%'");
    expect(migrations.rowCount).toBe(0);
  }, 120000);
});
