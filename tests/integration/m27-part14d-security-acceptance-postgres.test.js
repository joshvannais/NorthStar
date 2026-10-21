'use strict';

const crypto=require('node:crypto');
const request=require('supertest');
const {createPart4ePaidBrowserFixture}=
  require('../helpers/m27-part4e-paid-journey-fixture');

const realPostgres=process.env.M19_PG_ADMIN_URL?describe:describe.skip;

realPostgres('Mission 27 Part 14D mounted security acceptance',()=>{
  let prepared;let transport;let recoveryRead;let route;let exactQuery;

  beforeAll(async()=>{
    for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']){
      delete process.env[key];
    }
    recoveryRead=jest.spyOn(
      require('../../src/customerFinancial/financialLifecycleRecoveryAcceptanceRepository'),'read');
    transport=jest.spyOn(require('https'),'request').mockImplementation(()=>{
      throw new Error('External transport forbidden in Part 14D');
    });
    prepared=await createPart4ePaidBrowserFixture();
    route=`/api/v1/customer-financial/editable-estimates/${prepared.estimate}`+
      '/financial-lifecycle-recovery-acceptance';
    exactQuery={handoffReceiptId:prepared.receipt.receiptId,
      handoffReceiptDigest:prepared.receipt.receiptDigest};
  },240000);

  afterAll(async()=>{try{if(prepared)await prepared.fixture.cleanup();}
    finally{jest.restoreAllMocks();}},180000);

  async function residue(){
    return(await prepared.fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM public._migrations WHERE filename LIKE '273_%') migration273`)).rows[0];
  }

  test('runtime role cannot bypass guarded repositories through direct table access',async()=>{
    for(const sql of [
      'SELECT * FROM canonical_customer_financial_invoice_draft_origins_v1 LIMIT 1',
      'SELECT * FROM canonical_customer_financial_invoice_draft_revisions_v1 LIMIT 1',
      'SELECT * FROM canonical_customer_financial_invoice_tax_reviews_v1 LIMIT 1',
      'INSERT INTO canonical_customer_financial_invoice_draft_origins_v1 DEFAULT VALUES',
    ]){
      await expect(prepared.fixture.runtimePool.query(sql)).rejects.toMatchObject({code:'42501'});
    }
    expect(transport).not.toHaveBeenCalled();
  });

  test('tenant role session and real CSRF witnesses fail closed with zero financial effect',async()=>{
    const before=await residue();
    expect((await request(prepared.fixture.app).get(route).query(exactQuery)).status).toBe(401);
    for(const actor of [prepared.fixture.actors.admin,prepared.fixture.actors.member,
      prepared.fixture.actors.viewer]){
      expect((await request(prepared.fixture.app).get(route).query(exactQuery)
        .set(actor.session.headers)).status).toBe(403);
    }
    const cross=await request(prepared.fixture.app).get(route).query(exactQuery)
      .set(prepared.fixture.actors.otherOwner.session.headers);
    expect([403,404,409,503]).toContain(cross.status);
    const wrongCsrf=await request(prepared.fixture.app)
      .post(`/api/v1/customer-financial/editable-estimates/${prepared.estimate}`+
        '/invoice-draft/workflow-capability')
      .set(prepared.actor.session.headers).set('X-CSRF-Token','wrong-but-bounded-csrf-witness')
      .set('Idempotency-Key',crypto.randomUUID()).send({confirmed:true,
        confirmationVersion:'m27-invoice-draft-workflow-capability-v1'});
    expect(wrongCsrf.status).toBe(403);
    expect(await residue()).toEqual(before);expect(transport).not.toHaveBeenCalled();
  },180000);

  test('public link webhook provider account secret PII amount and offline evidence are nonreflective denials',async()=>{
    const before=await residue();recoveryRead.mockClear();
    const widened=await request(prepared.fixture.app).get(route).query({...exactQuery,
      tenantId:prepared.fixture.org,providerAccountId:'acct_victim',credential:'sk_test_secret',
      customerEmail:'customer@example.test',amountMinorUnits:'999999',
      offlineEvidence:'check_cleared'}).set(prepared.actor.session.headers);
    expect(widened.status).toBe(400);expect(recoveryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(
      /acct_victim|sk_test_secret|customer@example|999999|check_cleared/i);
    const deniedPaths=[
      ['/api/v1/customer-financial/public/invoices/guessed-token','get'],
      ['/api/v1/customer-financial/payment-provider/webhook','post'],
      ['/api/v1/customer-financial/payment-provider/charge','post'],
      ['/api/v1/customer-financial/offline-receipts','post'],
    ];
    for(const [pathname,method] of deniedPaths){
      const response=await request(prepared.fixture.app)[method](pathname)
        .set(prepared.actor.session.headers).set('X-CSRF-Token',prepared.actor.csrfToken)
        .type('application/json').send({token:'guessed-token',providerAccountId:'acct_victim',
          credential:'sk_test_secret',amountMinorUnits:999999,checkState:'check_cleared'});
      expect([400,403,404,405]).toContain(response.status);
      expect(JSON.stringify(response.body||{})).not.toMatch(
        /acct_victim|sk_test_secret|999999|check_cleared/i);
    }
    expect(await residue()).toEqual(before);expect(transport).not.toHaveBeenCalled();
  },180000);

  test('duplicate and bounded abuse attempts never enter recovery source or leave residue',async()=>{
    const before=await residue();recoveryRead.mockClear();
    const attempts=[];
    for(let index=0;index<12;index+=1){
      attempts.push(request(prepared.fixture.app).post(
        '/api/v1/customer-financial/payment-provider/charge')
        .set(prepared.actor.session.headers).set('X-CSRF-Token',prepared.actor.csrfToken)
        .type('application/json').send({idempotencyKey:'duplicate-charge',amountMinorUnits:100}));
      attempts.push(request(prepared.fixture.app).post(
        '/api/v1/customer-financial/offline-receipts')
        .set(prepared.actor.session.headers).set('X-CSRF-Token',prepared.actor.csrfToken)
        .type('application/json').send({idempotencyKey:'duplicate-offline',state:'check_cleared'}));
      attempts.push(request(prepared.fixture.app).get(
        route.replace(prepared.estimate,'x'.repeat(1024))).query(exactQuery)
        .set(prepared.actor.session.headers));
    }
    const results=await Promise.all(attempts);
    expect(results.every(value=>[400,403,404,405,413,414].includes(value.status))).toBe(true);
    expect(recoveryRead).not.toHaveBeenCalled();expect(await residue()).toEqual(before);
    expect(before.migration273).toBe(0);expect(transport).not.toHaveBeenCalled();
  },300000);
});
