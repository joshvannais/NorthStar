'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createPart4ePaidBrowserFixture } =
  require('../helpers/m27-part4e-paid-journey-fixture');
const contract = require('../../src/customerFinancial/collectionPart10Acceptance');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 10D mounted whole-Part-10 acceptance', () => {
  let prepared; let transport; let route; let query;

  async function completeCurrentPart4() {
    const { fixture, actor, estimate, receipt } = prepared;
    const base = `/api/v1/customer-financial/editable-estimates/${estimate}`;
    query = { handoffReceiptId: receipt.receiptId,
      handoffReceiptDigest: receipt.receiptDigest };
    route = `${base}/collection-part10-acceptance`;
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
        reason: 'Owner captured the exact synthetic Part 10D invoice source.', confirmed: true,
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
        description: ordinal === 0 ? `${line.description} — reviewed for Part 10D` : line.description,
        allocatedMinorUnits: line.allocatedAmount.minorUnits })) };
    const draft = await request(fixture.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion, expectedRevision: Number(baseline.body.data.revision),
        expectedDraftDigest: baseline.body.data.draftDigest, draft: edit,
        reason: 'Owner reviewed exact wording for the Part 10D acceptance boundary.', confirmed: true,
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
        reason: 'Owner reviewed exact synthetic Part 10D tax preparation.', confirmed: true,
        confirmationVersion: 'm27-invoice-date-tax-review-record-v1' });
    expect(tax.status).toBe(201);
  }

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('External transport forbidden in Part 10D');
    });
    prepared = await createPart4ePaidBrowserFixture();
    await completeCurrentPart4();
  }, 240000);

  afterAll(async () => {
    try { if (prepared) await prepared.fixture.cleanup(); }
    finally { jest.restoreAllMocks(); }
  }, 180000);

  test('owner and administrator receive one exact atomic value-free Part 10 bundle', async () => {
    const adversaries = await Promise.all([
      request(prepared.fixture.app).get(route).query(query).set(prepared.actor.session.headers),
      request(prepared.fixture.app).get(route).query(query).set(prepared.actor.session.headers),
    ]);
    const successful = adversaries.filter(response => response.status === 200);
    expect(successful.length).toBeGreaterThanOrEqual(1);
    for (const denied of adversaries.filter(response => response.status !== 200)) {
      expect(denied.status).toBe(503);
      expect(denied.body.data).toBeUndefined();
    }
    const owner = successful[0];
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    for (const response of successful) expect(response.body.data).toEqual(owner.body.data);
    expect(() => contract.projectBundle(owner.body.data, 'paid')).not.toThrow();
    expect(owner.body.data).toMatchObject({
      contractVersion: 'm27-collection-part10-preview-bundle-v1',
      part10Acceptance: {
        contractVersion: 'm27-collection-part10-acceptance-v1',
        state: 'unavailable', reason: 'part10_collection_evidence_unavailable', mode: 'paid',
        fictional: false,
        failureRetry: { state: 'unavailable',
          exactCurrentSourceRequiredBeforeEveryRetry: true,
          humanReviewedRetryRequired: true,
          automaticReminderRetryOrChargeSupported: false,
          priorProviderSessionMayBeReused: false,
          failedOrRejectedRequestMayCreateEffect: false },
        revocation: { state: 'unavailable', reason: 'revocation_authority_unavailable',
          everyAxisRevalidatedBeforeDisplayOrAction: true,
          revocationClearsRenderedPrivateAndCollectionState: true,
          roleOrRetryMayBypassRevocation: false,
          revocationCreatesFinancialOrExternalEffect: false },
        access: { eligiblePaidRoles: ['owner','admin'],
          currentTenantSessionRequired: true,currentSubscriptionRequired: true,
          roleAloneAuthorizesCollectionAction: false,
          scopedCustomerSessionRequiredForCustomerAction: true,
          staffRoleMaySubstituteForCustomerSession: false,
          demoPhysicallyAndLogicallyIsolated: true,tenantCrossingAllowed: false },
        acceptance: { sourceContractsRevalidated: true,
          wholePart10FunctionalBoundaryPresent: true,paidDemoIsolationAccepted: true,
          failureRetryRevocationPrivacyBoundaryPresent: true,
          independentWholeHeadAuditAccepted: false,
          firstPayingCustomerLiveMoneyValidated: false,founderVisualApprovalAccepted: false },
        receivableRowCount: 0,collectionReviewRowCount: 0,promiseToPayRowCount: 0,
        handoffRequestRowCount: 0,manualResendRequestRowCount: 0,outboundMessageCount: 0,
        providerCallCount: 0,providerMutationCount: 0,receiverMutationCount: 0,
        accountingMutationCount: 0, liveMoneyMovementCount: 0,
      },
    });
    expect(owner.body.data.part10Acceptance.sourceParts.map(value => value.part))
      .toEqual(['10A','10B','10C']);
    expect(owner.body.data.part10Acceptance.sourceParts.map(value => value.state))
      .toEqual(['incomplete','unavailable','unavailable']);
    expect(owner.body.data.part10Acceptance.sourceParts.every(value =>
      /^[0-9a-f]{64}$/.test(value.digest))).toBe(true);
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      /acct_victim|evt_victim|pi_victim|sk_test|customer@example|123 main/i);
    const admin = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.admin.session.headers);
    expect(admin.status).toBe(200); expect(admin.body.data).toEqual(owner.body.data);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('session, role, tenant, query, subscription and method gates fail closed', async () => {
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
    const widened = await request(prepared.fixture.app).get(route)
      .query({ ...query, providerAccountId: 'acct_victim', eventId: 'evt_victim',
        paymentId: 'pi_victim', receiptNumber: 'RCT-0000000001', amountMinorUnits: '0',
        accountingStatus: 'posted', recovery: 'restore' }).set(prepared.actor.session.headers);
    expect(widened.status).toBe(400);
    expect(JSON.stringify(widened.body)).not.toMatch(
      /acct_victim|evt_victim|pi_victim|RCT-0000000001|posted|restore/i);
    expect((await request(prepared.fixture.app).post(route).set(prepared.actor.session.headers)
      .set('X-CSRF-Token', prepared.actor.csrfToken)
      .send({ action: 'recover', receiptNumber: 'RCT-0000000001' })).status).toBe(405);
    expect((await request(prepared.fixture.app).head(route).query(query)
      .set(prepared.actor.session.headers)).status).toBe(405);
    const preflight = await request(prepared.fixture.app).options(route).query(query)
      .set(prepared.actor.session.headers);
    expect(preflight.status).toBe(204);
    expect(preflight.text).toBe('');
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

  test('reads survive restart and create no Part 10, receiver, provider or money residue', async () => {
    const count = async () => (await prepared.fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%customer%receipt%' OR table_name LIKE '%accounting%export%' OR
        table_name LIKE '%accounting%reconcil%' OR table_name LIKE '%provider%event%' OR
        table_name LIKE '%payment%alloc%' OR table_name LIKE '%payment%attempt%' OR
        table_name LIKE '%unapplied%credit%' OR table_name LIKE '%refund%review%' OR
        table_name LIKE '%deposit%application%' OR table_name LIKE '%credit%note%' OR
        table_name LIKE '%refund%request%' OR table_name LIKE '%offline%payment%' OR
        table_name LIKE '%offline%receipt%' OR table_name LIKE '%cash%receipt%' OR
        table_name LIKE '%check%receipt%' OR table_name LIKE '%dispute%' OR
        table_name LIKE '%chargeback%' OR table_name LIKE '%write%off%' OR
        table_name LIKE '%payment%reversal%' OR table_name LIKE '%payment%outcome%'))
        protected_tables`)).rows[0];
    const before = await count();
    const first = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(first.status).toBe(200);
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
