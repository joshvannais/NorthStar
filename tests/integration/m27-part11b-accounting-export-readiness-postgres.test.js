'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createPart4ePaidBrowserFixture } =
  require('../helpers/m27-part4e-paid-journey-fixture');
const contract = require('../../src/customerFinancial/accountingExportReadiness');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 11B mounted accounting export readiness', () => {
  let prepared; let transport; let repositoryRead; let route; let exportContractRoute;
  let part10Route; let query;

  async function completeCurrentPart4() {
    const { fixture, actor, estimate, receipt } = prepared;
    const base = `/api/v1/customer-financial/editable-estimates/${estimate}`;
    query = { handoffReceiptId: receipt.receiptId,
      handoffReceiptDigest: receipt.receiptDigest };
    route = `${base}/accounting-export-readiness`;
    exportContractRoute = `${base}/accounting-export-contract`;
    part10Route = `${base}/collection-part10-acceptance`;
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
        reason: 'Owner captured the exact synthetic Part 11B invoice source.', confirmed: true,
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
        description: ordinal === 0 ? `${line.description} — reviewed for Part 11B` : line.description,
        allocatedMinorUnits: line.allocatedAmount.minorUnits })) };
    const draft = await request(fixture.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion, expectedRevision: Number(baseline.body.data.revision),
        expectedDraftDigest: baseline.body.data.draftDigest, draft: edit,
        reason: 'Owner reviewed exact wording for the Part 11B export boundary.', confirmed: true,
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
        reason: 'Owner reviewed exact synthetic Part 11B tax preparation.', confirmed: true,
        confirmationVersion: 'm27-invoice-date-tax-review-record-v1' });
    expect(tax.status).toBe(201);
  }

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    repositoryRead = jest.spyOn(
      require('../../src/customerFinancial/accountingExportReadinessRepository'), 'read');
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('External transport forbidden in Part 11B');
    });
    prepared = await createPart4ePaidBrowserFixture();
    await completeCurrentPart4();
  }, 240000);

  afterAll(async () => {
    try { if (prepared) await prepared.fixture.cleanup(); }
    finally { jest.restoreAllMocks(); }
  }, 180000);

  test('owner and administrator receive one exact value-free accounting destination and transmission contract', async () => {
    const owner = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(owner.status).toBe(200);
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    const source = await request(prepared.fixture.app).get(exportContractRoute).query(query)
      .set(prepared.actor.session.headers);
    expect(source.status).toBe(200);
    const part10 = await request(prepared.fixture.app).get(part10Route).query(query)
      .set(prepared.actor.session.headers);
    expect(part10.status).toBe(200);
    expect(() => contract.project(owner.body.data, source.body.data, part10.body.data)).not.toThrow();
    expect(owner.body.data).toMatchObject({
      contractVersion:'m27-accounting-export-readiness-v1',state:'unavailable',
      reason:'accounting_destination_and_export_authority_unavailable',
      destination:{state:'unavailable',ownerSelectionRequired:true,
        selectionEligibleRoles:['owner'],administratorMaySelectDestination:false,
        selectedAdapter:null,destinationAccountId:null,selectionDigest:null},
      mappingReview:{state:'unavailable',ownerReviewRequired:true,
        callerAuthoredOrInferredMappingAccepted:false,chartOfAccountsMayBeInvented:false,
        journalClassificationMayBeInvented:false,taxOrRecognitionPolicyMayBeInvented:false,
        mappingCount:null,mappingDigest:null},
      preview:{state:'unavailable',recordCount:0,absoluteMinorUnits:null,currency:null,
        previewDigest:null,missingAmountCurrencyMappingOrSourceMayBecomeZeroOrCurrent:false},
      transmission:{state:'unavailable',requiredCapability:'customer_financial.accounting.export',
        currentCapabilityGrantState:'unavailable',currentReceivingAdapterState:'unavailable',
        currentRecentAuthenticationState:'unavailable',currentMfaState:'unavailable',
        currentIndependentApprovalState:'unavailable',currentActionReasonState:'unavailable',
        transmissionAuthorized:false,sameKeyChangedRequestConflicts:true,
        selectionAndMappingReviewDoNotAuthorizeTransmission:true,
        largerInBoundsExportRequiresTwoDifferentCurrentHumans:true,
        exactReplayReturnsSameImmutableReceipt:true,
        uncertainResultRequiresOriginalReceiptLookupBeforeRetry:true},
      acknowledgement:{state:'unavailable',receiptIdentity:null,receiptDigest:null,immutable:true,
        sameRequestMayHaveOneCanonicalReceipt:true,
        acknowledgementMayRewriteNorthStarSource:false},
      partialFailure:{state:'unavailable',acceptedRecordCount:null,rejectedRecordCount:null,
        retryableRecordCount:null,uncertainRecordCount:null,
        partialAcknowledgementMayBecomeWholeBatchSuccess:false,
        retryRestrictedToExactFailedSubset:true},
      destinationSelectionCount:0,mappingReviewCount:0,exportPreviewCount:0,
      transmissionCount:0,acknowledgementCount:0,partialFailureRecordCount:0,
      accountingMutationCount:0,providerCallCount:0,receiverMutationCount:0,
      liveMoneyMovementCount:0,
    });
    expect(owner.body.data.mappingReview.factClassOrder).toEqual([
      'issued_invoice','payment','offline_cash','offline_check','credit','refund',
      'write_off','dispute','provider_fee','settlement',
    ]);
    expect(owner.body.data.mappingReview.mappings.every(item => item.value === null &&
      item.destinationAccountId === null && item.mappingDigest === null)).toBe(true);
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      /acct_victim|evt_victim|pi_victim|sk_test|customer@example|123 main/i);
    const admin = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.admin.session.headers);
    expect(admin.status).toBe(200); expect(admin.body.data).toEqual(owner.body.data);
    expect(transport).not.toHaveBeenCalled();
  }, 300000);

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
      .query({ ...query, destination: 'quickbooks', accountId: 'acct_victim',
        amountMinorUnits: '0', sourceRecordId: 'inv_victim', exportedAt: 'now' })
      .set(prepared.actor.session.headers);
    expect(widened.status).toBe(400);
    expect(JSON.stringify(widened.body)).not.toMatch(/acct_victim|inv_victim|quickbooks|now/i);
    expect((await request(prepared.fixture.app).post(route).set(prepared.actor.session.headers)
      .set('X-CSRF-Token', prepared.actor.csrfToken)
      .send({ action: 'export', destination: 'quickbooks' })).status).toBe(405);
    expect((await request(prepared.fixture.app).head(route).query(query)
      .set(prepared.actor.session.headers)).status).toBe(405);
    repositoryRead.mockClear();
    const preflight = await request(prepared.fixture.app).options(route).query(query)
      .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','POST');
    expect(preflight.status).toBe(405);
    expect(preflight.headers.allow).toBe('GET');
    expect(preflight.headers['access-control-allow-methods']).toBe('GET');
    expect(preflight.headers['cache-control']).toContain('no-store');
    expect(preflight.headers['referrer-policy']).toBe('no-referrer');
    expect(preflight.body.error.category)
      .toBe('CUSTOMER_FINANCIAL_ACCOUNTING_EXPORT_READINESS_METHOD_NOT_ALLOWED');
    expect(repositoryRead).not.toHaveBeenCalled();
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

  test('reads survive restart and create no export, acknowledgement or financial residue', async () => {
    const count = async () => (await prepared.fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%accounting%export%' OR table_name LIKE '%accounting%ack%' OR
        table_name LIKE '%accounting%reconcil%' OR table_name LIKE '%journal%' OR
        table_name LIKE '%books%close%')) protected_tables`)).rows[0];
    const before = await count();
    const first = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(first.status).toBe(200); expect(await count()).toEqual(before);
    expect(await prepared.fixture.db.initDatabase()).toBe(true);
    const restarted = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(restarted.status).toBe(200); expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect((await prepared.fixture.ownerPool.query(
      "SELECT count(*)::int count FROM public._migrations WHERE filename LIKE '273_%'"))
      .rows[0].count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  }, 300000);
});
