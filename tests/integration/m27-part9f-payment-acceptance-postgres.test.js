'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createPart4ePaidBrowserFixture } =
  require('../helpers/m27-part4e-paid-journey-fixture');
const contract = require('../../src/customerFinancial/paymentPart9Acceptance');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 9F mounted whole-Part-9 acceptance', () => {
  let prepared; let transport; let route; let query;

  async function completeCurrentPart4() {
    const { fixture, actor, estimate, receipt } = prepared;
    const base = `/api/v1/customer-financial/editable-estimates/${estimate}`;
    query = { handoffReceiptId: receipt.receiptId,
      handoffReceiptDigest: receipt.receiptDigest };
    route = `${base}/payment-part9-acceptance`;
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
        reason: 'Owner captured the exact synthetic Part 9F invoice source.', confirmed: true,
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
        description: ordinal === 0 ? `${line.description} — reviewed for Part 9F` : line.description,
        allocatedMinorUnits: line.allocatedAmount.minorUnits })) };
    const draft = await request(fixture.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion, expectedRevision: Number(baseline.body.data.revision),
        expectedDraftDigest: baseline.body.data.draftDigest, draft: edit,
        reason: 'Owner reviewed exact wording for the Part 9F acceptance boundary.', confirmed: true,
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
        reason: 'Owner reviewed exact synthetic Part 9F tax preparation.', confirmed: true,
        confirmationVersion: 'm27-invoice-date-tax-review-record-v1' });
    expect(tax.status).toBe(201);
  }

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('External transport forbidden in Part 9F');
    });
    prepared = await createPart4ePaidBrowserFixture();
    await completeCurrentPart4();
  }, 240000);

  afterAll(async () => {
    try { if (prepared) await prepared.fixture.cleanup(); }
    finally { jest.restoreAllMocks(); }
  }, 180000);

  test('owner and administrator receive one exact atomic value-free Part 9 bundle', async () => {
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
      contractVersion: 'm27-payment-part9-preview-bundle-v1',
      part9Acceptance: {
        contractVersion: 'm27-payment-part9-acceptance-v1',
        state: 'unavailable', reason: 'part9_financial_evidence_unavailable', mode: 'paid',
        fictional: false,
        concurrency: { maximumConcurrentWriterPerAggregate: 1,
          exactAggregateRevisionRequired: true,
          exactRequestDigestAndIdempotencyReceiptRequired: true,
          duplicateOrReplayMayRepeatEffect: false, arrivalOrderMayAuthorizeEffect: false,
          settledMoneyMayBeRefusedRetroactively: false,
          crossAxisSilentOverwriteAllowed: false, missingAmountOrEvidenceMayBecomeZero: false },
        correctionRecovery: { correctionsAreAppendOnly: true,
          priorAcceptedEvidenceMayBeRewritten: false,
          exactOriginalRequestAndReceiptRequired: true,
          readOnlyLookupRequiresNoExternalOrFinancialEffect: true,
          restoringExternalOrFinancialEffectRequiresDualControl: true,
          recoveryMayExceedOriginalRequest: false,
          staleOrChangedSourceClearsRenderedFinancialState: true },
        customerReceipt: { numberingPattern: 'RCT-{tenant_monotonic_10_digit_sequence}',
          serverAssigned: true, immutable: true, gapsAllowed: true, reuseAllowed: false,
          annualResetAllowed: false,
          checkReceivedRequiredWording: 'check received — clearance unknown',
          receiptMayClaimProviderSettlementOrBankClearance: false,
          refundRequestIsCompletedRefund: false, providerDisputeErasesOriginalPayment: false,
          negativeBalanceCreditRevenueAndExpenseRemainSeparate: true,
          customerReceiptIdentity: null, publicReceiptRouteAvailable: false },
        accounting: { state: 'accounting_adapter_unavailable',
          adapter: 'quickbooks_online.accounting_export.v1', supportedMode: 'sandbox',
          runtimeAvailable: false, exportAndAcknowledgementOnly: true,
          mayInventChartOfAccounts: false, mayDecideRecognitionOrTax: false,
          maySupplyCheckClearance: false, maximumExportRecords: 1000,
          maximumExportMinorUnits: '100000000', singleControlMaximumRecords: 100,
          singleControlMaximumMinorUnits: '10000000',
          aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
          manualReconciliationAlwaysDualControl: true,
          adapterAcknowledgementIsHumanAction: false },
        acceptance: { sourceContractsRevalidated: true,
          wholePart9FunctionalBoundaryPresent: true,
          independentWholeHeadAuditAccepted: false, providerSandboxEvidenceAccepted: false,
          firstPayingCustomerLiveMoneyValidated: false, founderVisualApprovalAccepted: false },
        customerReceiptRowCount: 0, correctionRowCount: 0, recoveryRowCount: 0,
        accountingExportRowCount: 0, accountingReconciliationRowCount: 0,
        providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
        accountingMutationCount: 0, liveMoneyMovementCount: 0,
      },
    });
    expect(owner.body.data.part9Acceptance.sourceParts.map(value => value.part))
      .toEqual(['9A','9B','9C','9D','9E']);
    expect(owner.body.data.part9Acceptance.sourceParts.every(value =>
      value.state === 'unavailable' && /^[0-9a-f]{64}$/.test(value.digest))).toBe(true);
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
      .send({ action: 'recover', receiptNumber: 'RCT-0000000001' })).status).toBe(404);
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

  test('reads survive restart and create no Part 9, accounting, provider or money residue', async () => {
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
