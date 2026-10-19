'use strict';

const crypto=require('node:crypto');
const request=require('supertest');
const {createPart4ePaidBrowserFixture}=
  require('../helpers/m27-part4e-paid-journey-fixture');
const contract=require('../../src/customerFinancial/paidTenantJourneyAcceptance');

const realPostgres=process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 14A mounted paid provider-disabled journey',()=>{
  let prepared;let transport;let repositoryRead;let route;let query;

  async function completeCurrentJourney() {
    const {fixture,actor,estimate,receipt}=prepared;
    const base=`/api/v1/customer-financial/editable-estimates/${estimate}`;
    query={handoffReceiptId:receipt.receiptId,handoffReceiptDigest:receipt.receiptDigest};
    route=`${base}/paid-tenant-journey-acceptance`;
    const capability=await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({confirmed:true,confirmationVersion:'m27-invoice-draft-workflow-capability-v1'});
    expect(capability.status).toBe(200);
    const grant=capability.body.data;
    const adminCapability=await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`)
      .set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token',fixture.actors.admin.csrfToken)
      .set('Idempotency-Key',crypto.randomUUID())
      .send({confirmed:true,confirmationVersion:'m27-invoice-draft-workflow-capability-v1'});
    expect(adminCapability.status).toBe(200);
    const originRoute=`${base}/invoice-draft-origin`;
    const candidate=await request(fixture.app).get(originRoute).query(query).set(actor.session.headers);
    expect(candidate.status).toBe(200);
    const origin=await request(fixture.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({...query,capabilityGrantId:grant.grantId,
        capabilityGrantRevision:Number(grant.revision),businessPurpose:grant.businessPurpose,
        policyVersion:grant.policyVersion,expectedCandidateDigest:candidate.body.data.candidateDigest,
        reason:'Owner captured the exact synthetic Part 14A invoice source.',confirmed:true,
        confirmationVersion:'m27-invoice-draft-origin-capture-v1'});
    expect(origin.status).toBe(201);
    const draftRoute=`${base}/invoice-draft`;
    const baseline=await request(fixture.app).get(draftRoute).query(query).set(actor.session.headers);
    expect(baseline.status).toBe(200);
    const edit={contractVersion:'m27-invoice-draft-edit-v1',originId:baseline.body.data.originId,
      originDigest:baseline.body.data.originDigest,
      lines:baseline.body.data.lines.map((line,ordinal)=>({ordinal,
        sourceLineDigest:line.sourceLineDigest,group:line.group,
        description:ordinal===0?`${line.description} — reviewed for Part 14A`:line.description,
        allocatedMinorUnits:line.allocatedAmount.minorUnits}))};
    const draft=await request(fixture.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({...query,capabilityGrantId:grant.grantId,
        capabilityGrantRevision:Number(grant.revision),businessPurpose:grant.businessPurpose,
        policyVersion:grant.policyVersion,expectedRevision:Number(baseline.body.data.revision),
        expectedDraftDigest:baseline.body.data.draftDigest,draft:edit,
        reason:'Owner reviewed exact wording for the Part 14A reporting boundary.',confirmed:true,
        confirmationVersion:'m27-invoice-draft-revision-save-v1'});
    expect(draft.status).toBe(201);
    const taxRoute=`${base}/invoice-draft/tax-review`;
    const taxCandidate=await request(fixture.app).get(taxRoute).query(query).set(actor.session.headers);
    expect(taxCandidate.status).toBe(200);
    const tax=await request(fixture.app).post(taxRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({...query,capabilityGrantId:grant.grantId,
        capabilityGrantRevision:Number(grant.revision),businessPurpose:grant.businessPurpose,
        policyVersion:grant.policyVersion,
        expectedCandidateDigest:taxCandidate.body.data.candidateDigest,
        reason:'Owner reviewed exact synthetic Part 14A tax preparation.',confirmed:true,
        confirmationVersion:'m27-invoice-date-tax-review-record-v1'});
    expect(tax.status).toBe(201);
  }

  beforeAll(async()=>{
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    repositoryRead=jest.spyOn(
      require('../../src/customerFinancial/paidTenantJourneyAcceptanceRepository'),'read');
    transport=jest.spyOn(require('https'),'request').mockImplementation(()=>{
      throw new Error('External transport forbidden in Part 14A');
    });
    prepared=await createPart4ePaidBrowserFixture();
    await completeCurrentJourney();
  },240000);

  afterAll(async()=>{try{if(prepared) await prepared.fixture.cleanup();}
    finally{jest.restoreAllMocks();}},180000);

  test('owner and administrator receive one exact provider-disabled integrated journey',async()=>{
    const owner=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(owner.status).toBe(200);
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toMatchObject({
      contractVersion:'m27-paid-provider-disabled-journey-v1',
      state:'complete_provider_disabled',reason:'live_capability_disabled',value:null,
      mode:'paid',fictional:false,
      launchMatrix:{rolloutStage:'disabled',liveCapabilityEnabled:false,
        providerMode:'test',providerMethod:'card',partialProviderPaymentsEnabled:false,
        multiInvoiceProviderPaymentsEnabled:false,offlineCashReceiptEnabled:true,
        offlineCheckReceiptEnabled:true,checkClearedTransitionEnabled:false,
        checkClearanceUnavailableState:'check_clearance_authority_unavailable'},
      fixture:{fixtureVersion:'m27-local-synthetic-provider-fixture-v1',deterministic:true,
        inProcess:true,providerAccountUsed:false,credentialUsed:false,
        externalTransportUsed:false,liveMoneyUsed:false,
        offline:{cashReceiptState:'offline_received',
          checkReceiptState:'check_clearance_unknown',
          checkClearedState:'check_clearance_authority_unavailable',
          providerOrBankSettlementClaimed:false}},
      separation:{fixtureEvidenceIsFinancialTruth:false,
        fixtureEvidenceMayCreateProviderOrBankSettlement:false,
        fixtureEvidenceMayCreateInvoicePaymentRefundReceiptOrAccountingRecord:false},
      acceptance:{exactPaidProductionModulesMounted:true,
        completeOrderedLocalSyntheticTracePresent:true,
        providerDisabledBoundaryPreserved:true,
        providerSandboxEvidenceAccepted:false,livePaymentEvidenceAccepted:false},
      providerCallCount:0,providerMutationCount:0,receiverMutationCount:0,
      accountingMutationCount:0,downstreamMutationCount:0,
      databaseMutationCount:0,liveMoneyMovementCount:0});
    expect(owner.body.data.fixture.stages.map(value=>value.stage)).toEqual([...contract.STAGE_ORDER]);
    expect(owner.body.data.sourceWitnesses.every(value=>
      /^[0-9a-f]{64}$/.test(value.digest))).toBe(true);
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      /acct_victim|evt_victim|pi_victim|sk_test|customer@example|123 main/i);
    const admin=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.admin.session.headers);
    expect(admin.status).toBe(200);expect(admin.body.data).toEqual(owner.body.data);
    expect(transport).not.toHaveBeenCalled();
  },600000);

  test('auth tenant subscription and exact query boundaries fail closed',async()=>{
    expect((await request(prepared.fixture.app).get(route).query(query)).status).toBe(401);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.member.session.headers)).status).toBe(403);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.viewer.session.headers)).status).toBe(403);
    const cross=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.otherOwner.session.headers);
    // The sealed Part 12 atomic bundle intentionally reports an unavailable
    // cross-tenant source as currentness conflict without exposing whether the
    // foreign record exists.
    expect([403,404,409,503]).toContain(cross.status);
    repositoryRead.mockClear();
    const widened=await request(prepared.fixture.app).get(route)
      .query({...query,tenantId:prepared.fixture.org,accountId:'acct_victim',
        amountMinorUnits:'100',credential:'sk_secret'})
      .set(prepared.actor.session.headers);
    expect(widened.status).toBe(400);expect(repositoryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/acct_victim|sk_secret|100/);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers)).status).toBe(403);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
  },180000);

  test('composed body method and CORS boundary runs before parser auth throttle or repository',async()=>{
    repositoryRead.mockClear();
    for (const body of ['"sk_scalar_secret"','{"credential":"sk_malformed"',
      JSON.stringify({accountId:'acct_victim',amountMinorUnits:100})]) {
      const response=await request(prepared.fixture.app).get(route).query(query)
        .type('application/json').send(body).set(prepared.actor.session.headers);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(response.body.error.category).toBe('CUSTOMER_FINANCIAL_PAID_JOURNEY_INVALID');
      expect(JSON.stringify(response.body)).not.toMatch(/sk_scalar|sk_malformed|acct_victim|100/);
    }
    for (const method of ['head','options','post','put','patch','delete','trace','propfind']) {
      let pending=request(prepared.fixture.app)[method](route).query(query)
        .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','POST')
        .type('application/json').send('"sk_method_secret"');
      const response=await pending;
      expect(response.status).toBe(405);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers.allow).toBe('GET');
      // The pre-CORS method gate emits no CORS method header for ordinary
      // unsupported verbs. OPTIONS may retain the security middleware's exact
      // GET-only header, but it must never advertise a mutation method.
      expect([undefined,'GET']).toContain(
        response.headers['access-control-allow-methods']);
      expect(JSON.stringify(response.body||{})).not.toMatch(/sk_method_secret/);
    }
    expect(repositoryRead).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
  },180000);

  test('restart preserves exact projection with no migration or external residue',async()=>{
    const count=async()=>(await prepared.fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM public._migrations WHERE filename LIKE '273_%') migration273`))
      .rows[0];
    const before=await count();
    const first=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(first.status).toBe(200);expect(await count()).toEqual(before);
    expect(await prepared.fixture.db.initDatabase()).toBe(true);
    const restarted=await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(restarted.status).toBe(200);expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);expect(before.migration273).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  },600000);
});
