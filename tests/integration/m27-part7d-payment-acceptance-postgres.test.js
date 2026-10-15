'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createPart4ePaidBrowserFixture } =
  require('../helpers/m27-part4e-paid-journey-fixture');
const contract = require('../../src/customerFinancial/paymentPart7Acceptance');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const DEMO_HOST = 'northstar.test';

function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }

realPostgres('Mission 27 Part 7D mounted provider acceptance', () => {
  let prepared; let transport; let route; let query;

  async function completeCurrentPart4() {
    const { fixture, actor, estimate, receipt } = prepared;
    const base = `/api/v1/customer-financial/editable-estimates/${estimate}`;
    query = { handoffReceiptId: receipt.receiptId,
      handoffReceiptDigest: receipt.receiptDigest };
    route = `${base}/payment-part7-acceptance`;
    const capability = await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ confirmed:true,
        confirmationVersion:'m27-invoice-draft-workflow-capability-v1' });
    expect(capability.status).toBe(200);
    const grant=capability.body.data;
    const adminCapability=await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`)
      .set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token',fixture.actors.admin.csrfToken)
      .set('Idempotency-Key',crypto.randomUUID())
      .send({confirmed:true,
        confirmationVersion:'m27-invoice-draft-workflow-capability-v1'});
    expect(adminCapability.status).toBe(200);
    const originRoute=`${base}/invoice-draft-origin`;
    const candidate=await request(fixture.app).get(originRoute).query(query).set(actor.session.headers);
    expect(candidate.status).toBe(200); expect(candidate.body.data.state).toBe('ready_to_capture');
    const origin=await request(fixture.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({...query,capabilityGrantId:grant.grantId,
        capabilityGrantRevision:Number(grant.revision),businessPurpose:grant.businessPurpose,
        policyVersion:grant.policyVersion,expectedCandidateDigest:candidate.body.data.candidateDigest,
        reason:'Owner captured the exact synthetic Part 7D invoice source.',confirmed:true,
        confirmationVersion:'m27-invoice-draft-origin-capture-v1'});
    expect(origin.status).toBe(201);
    const draftRoute=`${base}/invoice-draft`;
    const baseline=await request(fixture.app).get(draftRoute).query(query).set(actor.session.headers);
    expect(baseline.status).toBe(200);
    const edit={contractVersion:'m27-invoice-draft-edit-v1',originId:baseline.body.data.originId,
      originDigest:baseline.body.data.originDigest,
      lines:baseline.body.data.lines.map((line,ordinal)=>({ordinal,
        sourceLineDigest:line.sourceLineDigest,group:line.group,
        description:ordinal===0?`${line.description} — reviewed for Part 7D`:line.description,
        allocatedMinorUnits:line.allocatedAmount.minorUnits}))};
    const draft=await request(fixture.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({...query,capabilityGrantId:grant.grantId,
        capabilityGrantRevision:Number(grant.revision),businessPurpose:grant.businessPurpose,
        policyVersion:grant.policyVersion,expectedRevision:Number(baseline.body.data.revision),
        expectedDraftDigest:baseline.body.data.draftDigest,draft:edit,
        reason:'Owner reviewed exact wording for Part 7D acceptance.',confirmed:true,
        confirmationVersion:'m27-invoice-draft-revision-save-v1'});
    expect(draft.status).toBe(201);
    const taxRoute=`${base}/invoice-draft/tax-review`;
    const taxCandidate=await request(fixture.app).get(taxRoute).query(query).set(actor.session.headers);
    expect(taxCandidate.status).toBe(200); expect(taxCandidate.body.data.state).toBe('ready_to_record');
    const tax=await request(fixture.app).post(taxRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({...query,capabilityGrantId:grant.grantId,
        capabilityGrantRevision:Number(grant.revision),businessPurpose:grant.businessPurpose,
        policyVersion:grant.policyVersion,expectedCandidateDigest:taxCandidate.body.data.candidateDigest,
        reason:'Owner reviewed exact synthetic Part 7D tax preparation.',confirmed:true,
        confirmationVersion:'m27-invoice-date-tax-review-record-v1'});
    expect(tax.status).toBe(201);
  }

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport=jest.spyOn(require('https'),'request').mockImplementation(()=>{
      throw new Error('Provider transport forbidden in Part 7D');
    });
    prepared=await createPart4ePaidBrowserFixture();
    await completeCurrentPart4();
  },240000);

  afterAll(async()=>{try{if(prepared)await prepared.fixture.cleanup();}
    finally{jest.restoreAllMocks();}},180000);

  test('paid owner and administrator receive one strict value-free Part 7 bundle',async()=>{
    const owner=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(owner.status).toBe(200); expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store'); expect(owner.headers.vary).toContain('Cookie');
    expect(contract.projectBundle(owner.body.data,'paid')).toEqual(owner.body.data);
    expect(owner.body.data).toMatchObject({contractVersion:'m27-payment-part7-preview-bundle-v1',
      preview:{mode:'paid',fictional:false},part7Acceptance:{mode:'paid',fictional:false,
        state:'unavailable',reason:'provider_sandbox_evidence_unavailable',
        providerSandboxAccepted:false,paymentInitiationAuthorized:false,
        providerCallCount:0,providerMutationCount:0,receiverMutationCount:0,
        liveMoneyMovementCount:0}});
    expect(owner.body.data.part7Acceptance.requirements).toEqual(contract.REQUIREMENTS);
    expect(owner.body.data.part7Acceptance.previewWitness)
      .toEqual(owner.body.data.part6Acceptance.previewWitness);
    expect(owner.body.data.preview.previewDigest)
      .toBe(owner.body.data.part7Acceptance.previewWitness.previewDigest);
    expect(JSON.stringify(owner.body.data.part7Acceptance)).not.toMatch(
      /organizationId|actorUserId|authSessionId|email|address|sk_test|acct_|pi_|cs_/i);
    const admin=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.admin.session.headers);
    expect(admin.status).toBe(200); expect(admin.body.data).toEqual(owner.body.data);
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('fictional demo is isolated, deterministic, resettable and makes no paid/provider call',async()=>{
    const workspace=await request(prepared.fixture.app).get('/api/demo/command-center').set('Host',DEMO_HOST);
    expect(workspace.status).toBe(200); const savedCookie=cookie(workspace);
    const estimateId=workspace.body.data.graphs[0].ids.estimate;
    const demoRoute=`/api/demo/customer-financial/invoice-drafts/${estimateId}/part7-acceptance`;
    const first=await request(prepared.fixture.app).get(demoRoute).set('Host',DEMO_HOST)
      .set('Cookie',savedCookie);
    const replay=await request(prepared.fixture.app).get(demoRoute).set('Host',DEMO_HOST)
      .set('Cookie',savedCookie);
    expect(first.status).toBe(200); expect(replay.body).toEqual(first.body);
    expect(contract.projectBundle(first.body.data,'demo')).toEqual(first.body.data);
    expect(first.body.data.part7Acceptance).toMatchObject({fictional:true,mode:'demo',
      providerSandboxAccepted:false,paymentInitiationAuthorized:false,providerCallCount:0,
      providerMutationCount:0,receiverMutationCount:0,liveMoneyMovementCount:0});
    expect((await request(prepared.fixture.app).get(demoRoute).query({mode:'live'})
      .set('Host',DEMO_HOST).set('Cookie',savedCookie)).status).toBe(400);
    expect((await request(prepared.fixture.app).post(demoRoute).set('Host',DEMO_HOST)
      .set('Cookie',savedCookie).send({method:'card'})).status).toBe(404);
    const reset=await request(prepared.fixture.app).post('/api/demo/command-center/reset')
      .set('Host',DEMO_HOST).set('Origin','http://northstar.test')
      .set('Sec-Fetch-Site','same-origin').set('Cookie',savedCookie)
      .set('Idempotency-Key',crypto.randomUUID()).set('X-NorthStar-Demo-Intent','reset')
      .set('X-NorthStar-Demo-Revision',String(workspace.body.data.integrity.revision))
      .send({expectedRevision:workspace.body.data.integrity.revision});
    expect(reset.status).toBe(200);
    const workspaceAfter=await request(prepared.fixture.app).get('/api/demo/command-center')
      .set('Host',DEMO_HOST).set('Cookie',savedCookie);
    const resetEstimate=workspaceAfter.body.data.graphs[0].ids.estimate;
    const recovered=await request(prepared.fixture.app)
      .get(`/api/demo/customer-financial/invoice-drafts/${resetEstimate}/part7-acceptance`)
      .set('Host',DEMO_HOST).set('Cookie',savedCookie);
    expect(recovered.status).toBe(200); expect(contract.projectBundle(recovered.body.data,'demo'))
      .toEqual(recovered.body.data);
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('session, role, tenant, exact query and subscription gates fail closed',async()=>{
    expect((await request(prepared.fixture.app).get(route).query(query)).status).toBe(401);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.member.session.headers)).status).toBe(403);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.viewer.session.headers)).status).toBe(403);
    const cross=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.otherOwner.session.headers);
    expect([403,404,503]).toContain(cross.status);
    expect(JSON.stringify(cross.body)).not.toMatch(new RegExp(`${prepared.estimate}|${prepared.receipt.receiptId}`,'i'));
    expect((await request(prepared.fixture.app).get(route)
      .query({...query,mode:'live',providerAccountId:'acct_victim',amountMinorUnits:'50'})
      .set(prepared.actor.session.headers)).status).toBe(400);
    expect((await request(prepared.fixture.app).post(route).set(prepared.actor.session.headers)
      .set('X-CSRF-Token',prepared.actor.csrfToken).send({method:'card'})).status).toBe(404);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers)).status).toBe(403);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('restart and repeats preserve exact output with zero provider or financial residue',async()=>{
    const count=async()=>(await prepared.fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews`)).rows[0];
    const before=await count();
    const first=await request(prepared.fixture.app).get(route).query(query).set(prepared.actor.session.headers);
    const second=await request(prepared.fixture.app).get(route).query(query).set(prepared.actor.session.headers);
    expect(first.status).toBe(200); expect(second.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before); expect(await prepared.fixture.db.initDatabase()).toBe(true);
    const restarted=await request(prepared.fixture.app).get(route).query(query).set(prepared.actor.session.headers);
    expect(restarted.status).toBe(200); expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect((await prepared.fixture.ownerPool.query(
      "SELECT count(*)::int count FROM public._migrations WHERE filename LIKE '273_%'"))
      .rows[0].count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  },180000);
});
