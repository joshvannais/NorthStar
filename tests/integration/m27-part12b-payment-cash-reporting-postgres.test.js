'use strict';

const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const reporting = require('../../src/customerFinancial/paymentCashReporting');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 12B mounted payment and cash reporting',() => {
  let fixture;let transport;let repositoryRead;
  const route='/api/v1/customer-financial/reporting/payment-cash';

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    repositoryRead=jest.spyOn(
      require('../../src/customerFinancial/paymentCashReportingRepository'),'read');
    transport=jest.spyOn(require('https'),'request').mockImplementation(()=>{
      throw new Error('External transport forbidden in Part 12B');
    });
    fixture=await createEstimateReviewFixture({additionalCompleteEstimates:1});
  },180000);

  afterAll(async () => {
    try {if(fixture) await fixture.cleanup();}
    finally {jest.restoreAllMocks();}
  },180000);

  test('owner and administrator receive thirteen separate source-backed incomplete facts',async () => {
    const owner=await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const admin=await request(fixture.app).get(route).set(fixture.actors.admin.session.headers);
    expect(owner.status).toBe(200);expect(admin.status).toBe(200);
    expect(owner.body.data).toEqual(admin.body.data);
    expect(()=>reporting.project(owner.body.data,reporting.defaultSources())).not.toThrow();
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toMatchObject({
      contractVersion:'m27-payment-cash-reporting-v1',state:'incomplete',
      reason:'payment_cash_reporting_coverage_incomplete',value:null,
      coverageSummary:{requiredFactCount:13,completeFactCount:0,incompleteFactCount:13,
        allFactsComplete:false,sourceAsOf:null,reportCurrency:null,
        reportMayBePresentedAsComplete:false,unknownOrMissingFactMayBecomeZero:false},
      reportRowCount:0,providerCallCount:0,providerMutationCount:0,
      receiverMutationCount:0,accountingMutationCount:0,liveMoneyMovementCount:0,
    });
    expect(owner.body.data.facts.every(item=>item.value === null && item.currency === null &&
      item.coverage.complete === false && item.coverage.totalSourceRecordCount === null &&
      item.launchMatrixSupport.currentAuthorityAvailable === false)).toBe(true);
    expect(owner.body.data.separationContract).toMatchObject({
      acceptedOfflineCashReceiptMayImplyProviderSettlement:false,
      checkClearanceUnknownMayImplyCheckCleared:false,
      checkClearanceUnknownMayImplySettledCash:false,
    });
    expect(JSON.stringify(owner.body.data)).not.toMatch(
      new RegExp(`${fixture.org}|${fixture.actors.owner.actorUserId}|customer@example|acct_|pi_|ch_`,'i'));
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('session role query tenant and subscription boundaries fail closed',async () => {
    expect((await request(fixture.app).get(route)).status).toBe(401);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other=await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);expect(other.body.data).toEqual(reporting.unavailable());
    expect(JSON.stringify(other.body)).not.toContain(fixture.org);
    repositoryRead.mockClear();
    const widened=await request(fixture.app).get(route)
      .query({tenantId:fixture.org,providerAccountId:'acct_secret',amountMinorUnits:'100',
        customerIdentity:'victim',credential:'sk_secret'})
      .set(fixture.actors.owner.session.headers);
    expect(widened.status).toBe(400);expect(repositoryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|acct_secret|sk_secret|100/);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers)).status).toBe(403);
    await fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [fixture.org]);
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('body and path-equivalent matrices reject before throttle source or repository',async () => {
    repositoryRead.mockClear();
    const bodyCases=[
      request(fixture.app).get(route).type('json').send({tenantId:fixture.org,
        providerAccountId:'acct_secret',amountMinorUnits:'100',credential:'sk_secret'}),
      request(fixture.app).get(route).type('json').send([{customerIdentity:'victim'}]),
      request(fixture.app).get(route).type('json').send({}),
      request(fixture.app).get(route).type('json').send('"sk_secret_scalar"'),
      request(fixture.app).get(route).type('json').send('123456789'),
      request(fixture.app).get(route).type('json').send('true'),
      request(fixture.app).get(route).type('json').send('null'),
      request(fixture.app).get(route).type('json').send('{"credential":"sk_secret"'),
      request(fixture.app).get(route).type('form').send({accountId:'acct_secret'}),
      request(fixture.app).get(route).type('text').send('identity=victim'),
      request(fixture.app).get(route).type('application/octet-stream')
        .send(Buffer.from('amountMinorUnits=100')),
    ];
    for (const bodyRequest of bodyCases) {
      const response=await bodyRequest.set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(response.body).toEqual({success:false,error:{
        category:'CUSTOMER_FINANCIAL_PAYMENT_CASH_REPORTING_INVALID',
        message:'Review the exact current payment and cash facts.'}});
      expect(JSON.stringify(response.body)).not.toMatch(
        /victim|acct_secret|sk_secret|123456789|amountMinorUnits/i);
      expect(repositoryRead).not.toHaveBeenCalled();
    }
    const equivalents=[
      '/API/v1/customer-financial/reporting/payment-cash',
      '/api/V1/customer-financial/REPORTING/PAYMENT-CASH',
      '/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG/PaYmEnT-CaSh/',
      '/api/v1/customer-financial/reporting//payment-cash',
      '/API/V1/CUSTOMER-FINANCIAL/REPORTING//PAYMENT-CASH/',
      '/api/v1/customer-financial/reporting/payment-cash?identity=victim',
    ];
    for (const pathName of equivalents) {
      const response=await request(fixture.app).get(pathName).type('json')
        .send('"sk_path_secret"').set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/sk_path_secret|identity|victim/);
      expect(repositoryRead).not.toHaveBeenCalled();
    }
    const uppercase=await request(fixture.app)
      .get('/API/V1/CUSTOMER-FINANCIAL/REPORTING/PAYMENT-CASH/')
      .set(fixture.actors.owner.session.headers);
    const doubleSlash=await request(fixture.app)
      .get('/api/v1/customer-financial/reporting//payment-cash')
      .set(fixture.actors.owner.session.headers);
    expect(uppercase.status).toBe(200);expect(doubleSlash.status).toBe(200);
    expect(repositoryRead).toHaveBeenCalledTimes(2);
    expect(transport).not.toHaveBeenCalled();
  },120000);

  test('every unsupported method owns empty and body-bearing requests before parsing',async () => {
    repositoryRead.mockClear();
    const methods=['head','options','post','put','patch','delete','trace','propfind'];
    const paths=[route,'/API/V1/CUSTOMER-FINANCIAL/REPORTING//PAYMENT-CASH/?query=secret'];
    for (const pathName of paths) {
      for (const method of methods) {
        for (const body of [undefined,'"sk_scalar_secret"','{"credential":"sk_malformed"']) {
          let pending=request(fixture.app)[method](pathName)
            .set('Origin','http://localhost:3000')
            .set('Access-Control-Request-Method','POST');
          if (body !== undefined) pending=pending.type('application/json').send(body);
          const response=await pending;
          expect(response.status).toBe(405);
          expect(response.headers['cache-control']).toContain('private');
          expect(response.headers['cache-control']).toContain('no-store');
          expect(response.headers.allow).toBeUndefined();
          if (method === 'options') {
            expect(response.headers['access-control-allow-methods']).toBe('GET');
          }
          expect(response.text || '').not.toMatch(/sk_scalar_secret|sk_malformed|credential/);
          if (method !== 'head') expect(response.body).toEqual({success:false,error:{
            category:'CUSTOMER_FINANCIAL_PAYMENT_CASH_REPORTING_METHOD_NOT_ALLOWED',
            message:'Use the exact payment and cash reporting read boundary.',
          }});
        }
      }
    }
    expect(repositoryRead).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
  },120000);

  test('restart preserves value-free projection with no table financial or external residue',async () => {
    const count=async ()=>(await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%payment%cash%report%' OR
        table_name LIKE '%financial%report%aggregate%')) part12_tables`)).rows[0];
    const before=await count();
    const first=await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(first.status).toBe(200);expect(await count()).toEqual(before);
    expect((await request(fixture.app).post(route)
      .set(fixture.actors.owner.session.headers).send({action:'recalculate'})).status).toBe(405);
    expect(await fixture.db.initDatabase()).toBe(true);
    const restarted=await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(restarted.status).toBe(200);expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect((await fixture.ownerPool.query(
      "SELECT count(*)::int count FROM public._migrations WHERE filename LIKE '273_%'"))
      .rows[0].count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  },180000);
});
