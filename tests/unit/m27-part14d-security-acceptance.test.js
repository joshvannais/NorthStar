'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cors=require('cors');
const express=require('express');
const request=require('supertest');
const {financialLifecycleRecoveryAcceptanceBoundary}=
  require('../../src/middleware/financialLifecycleRecoveryAcceptanceBoundary');
const {customerFinancialUnsupportedBoundary,customerFinancialParserError,
  customerFinancialNotFound}=
  require('../../src/middleware/customerFinancialUnsupportedBoundary');
const {corsOptions}=require('../../src/middleware/security');
const {createCustomerFinancialEditableEstimateRouter}=
  require('../../src/routes/customerFinancialEditableEstimate');
const {createCustomerFinancialProviderConnectionRouter}=
  require('../../src/routes/customerFinancialProviderConnection');

const ROOT=path.resolve(__dirname,'..','..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const TENANT='44444444-4444-4444-8444-444444444444';
const USER='55555555-5555-4555-8555-555555555555';
const SESSION='66666666-6666-4666-8666-666666666666';
const ESTIMATE='77777777-7777-4777-8777-777777777777';
const RECEIPT='22222222-2222-4222-8222-222222222222';
const DIGEST='a'.repeat(64);
const ROUTE=`/api/v1/customer-financial/editable-estimates/${ESTIMATE}`+
  '/financial-lifecycle-recovery-acceptance';
const QUERY={handoffReceiptId:RECEIPT,handoffReceiptDigest:DIGEST};
const HEADERS={'X-Test-Auth':'current','X-Test-Role':'owner'};

function auth(req,res,next){
  if(req.get('X-Test-Auth')!=='current') return res.status(401).json({success:false});
  req.tenantContext={organizationId:TENANT,userId:USER};
  req.authSession={id:SESSION};req.userRole=req.get('X-Test-Role')||'owner';return next();
}
function owner(req,res,next){return req.userRole==='owner'?next():
  res.status(403).json({success:false});}
function buildApp(options={}){
  const app=express();
  app.use(financialLifecycleRecoveryAcceptanceBoundary);
  app.use(customerFinancialUnsupportedBoundary);
  app.use(cors(corsOptions));app.use(express.json({limit:'32kb'}));
  app.use(customerFinancialParserError);
  app.use('/api/v1/customer-financial/editable-estimates',
    createCustomerFinancialEditableEstimateRouter({auth,role:owner,recoveryRole:owner,
      throttle:options.throttle||((_req,_res,next)=>next()),poolProvider:()=>({}),
      invoiceDraftWorkflowCapability:options.invoiceDraftWorkflowCapability||jest.fn(),
      financialLifecycleRecoveryAcceptanceRead:options.read||jest.fn(async()=>({
        contractVersion:'m27-financial-lifecycle-recovery-acceptance-v1',
        state:'incomplete_required_evidence',reason:'financial_lifecycle_recovery_evidence_unavailable',
        value:null,mode:'paid',fictional:false,providerCallCount:0,providerMutationCount:0,
        receiverMutationCount:0,accountingMutationCount:0,databaseMutationCount:0,
        liveMoneyMovementCount:0}))}));
  if(options.provider){app.use('/api/v1/customer-financial/payment-provider/connection',
    createCustomerFinancialProviderConnectionRouter({auth,role:owner,
      throttle:(_req,_res,next)=>next(),read:options.provider.read,
      attempt:options.provider.attempt}));}
  app.use('/api/v1/customer-financial',customerFinancialNotFound);
  return app;
}

describe('Mission 27 Part 14D integrated security acceptance',()=>{
  test('locks the exact complete Part 14D matrix and exclusions',()=>{
    const architecture=read('docs/architecture/MISSION_27_PART14D_SECURITY_ACCEPTANCE.md');
    const roadmap=read('docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md');
    const exact=['Tenant and record','Role and session','CSRF and mutation origin','Public link',
      'Webhook','Provider account and credentials','Direct table','Secret and PII',
      'Amount integrity','Duplicate charge','Duplicate offline receipt','Offline evidence',
      'Abuse and bounded denial'];
    let offset=-1;
    for(const name of exact){const next=architecture.indexOf(`| ${name} |`);
      expect(next).toBeGreaterThan(offset);offset=next;}
    expect(roadmap).toContain('| D | Tenant, role, CSRF, public-link, webhook, provider-account, direct-table, secret, PII, amount-tampering, duplicate-charge, duplicate-offline-receipt, offline-evidence tampering, and denial-of-service security acceptance. |');
    expect(architecture).toContain('Part 14E owns the complete rendered matrix');
    expect(architecture).toContain('does not make Part 14D accepted, audited, merged or deployed');
    expect(architecture).not.toMatch(/live-money validation (?:passed|accepted)|provider sandbox accepted/i);
  });

  test('private owner read is noncacheable while session and role substitution fail closed',async()=>{
    const repository=jest.fn(async()=>({contractVersion:'m27-security-safe-v1',
      value:null,providerCallCount:0,databaseMutationCount:0,liveMoneyMovementCount:0}));
    const app=buildApp({read:repository});
    const allowed=await request(app).get(ROUTE).query(QUERY).set(HEADERS);
    expect(allowed.status).toBe(200);expect(allowed.headers['cache-control']).toContain('private');
    expect(allowed.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(allowed.body)).not.toMatch(/organizationId|actorUserId|authSessionId|customer@example|acct_|sk_/i);
    expect((await request(app).get(ROUTE).query(QUERY)).status).toBe(401);
    for(const role of ['admin','member','viewer']){
      expect((await request(app).get(ROUTE).query(QUERY)
        .set({...HEADERS,'X-Test-Role':role})).status).toBe(403);}
    expect(repository).toHaveBeenCalledTimes(1);
  });

  test('method path query body secret PII amount and abuse inputs reject before repository',async()=>{
    const repository=jest.fn();const throttle=jest.fn((_req,_res,next)=>next());
    const app=buildApp({read:repository,throttle});
    const attacks=[
      ()=>request(app).get(ROUTE).query({...QUERY,tenantId:TENANT,providerAccountId:'acct_victim',
        credential:'sk_secret',email:'customer@example.test',amountMinorUnits:'999999'}).set(HEADERS),
      ()=>request(app).get(ROUTE).query(QUERY).set(HEADERS).type('application/json')
        .send({offlineEvidence:'check_cleared',bankSettlement:true,amountMinorUnits:999999}),
      ()=>request(app).get(ROUTE.replace(ESTIMATE,'x'.repeat(2048))).query(QUERY).set(HEADERS),
    ];
    for(const attack of attacks){const response=await attack();expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(JSON.stringify(response.body||{})).not.toMatch(/acct_victim|sk_secret|customer@example|999999|check_cleared/);}
    for(const method of ['head','options','post','put','patch','delete','trace','propfind']){
      const response=await request(app)[method](ROUTE).query(QUERY).set(HEADERS)
        .type('application/json').send('"sk_method_secret"');
      expect(response.status).toBe(405);expect(response.headers.allow).toBe('GET');
      expect(JSON.stringify(response.body||{})).not.toMatch(/sk_method_secret/);}
    expect(repository).not.toHaveBeenCalled();
    // Exact-query validation follows the authenticated rate-limit boundary;
    // body/method/malformed-path cases are rejected before it.
    expect(throttle).toHaveBeenCalledTimes(1);
  });

  test('CSRF and provider lifecycle boundaries deny before any effect',async()=>{
    const provider={read:jest.fn(async()=>({state:'unavailable'})),attempt:jest.fn()};
    const capability=jest.fn();
    const app=buildApp({provider,read:jest.fn(),invoiceDraftWorkflowCapability:capability});
    const base=`/api/v1/customer-financial/editable-estimates/${ESTIMATE}`;
    const missing=await request(app).post(`${base}/invoice-draft/workflow-capability`)
      .set(HEADERS).send({confirmed:true,
        confirmationVersion:'m27-invoice-draft-workflow-capability-v1'});
    expect(missing.status).toBe(403);
    const widened=await request(app).post('/api/v1/customer-financial/payment-provider/connection/actions?providerAccountId=acct_victim&credential=sk_secret&amount=100')
      .set(HEADERS).set('X-CSRF-Token','wrong-but-long-csrf-token')
      .send({operation:'connect',confirmed:true,reason:'Review test connection now.'});
    expect(widened.status).toBe(400);expect(provider.attempt).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/acct_victim|sk_secret|100/);
  });

  test('unsupported financial namespaces return one fixed private nonreflective denial',async()=>{
    const repository=jest.fn();const throttle=jest.fn((_req,_res,next)=>next());
    const provider={read:jest.fn(),attempt:jest.fn()};
    const app=buildApp({read:repository,throttle,provider});
    const attacks=[
      ['get','/api/v1/customer-financial/public/invoices/sk_secret_customer-999999-check_cleared'],
      ['post','/api/v1/customer-financial/PUBLIC/invoices/customer%40example.test'],
      ['options','/api/v1/customer-financial/payment-provider/webhook/acct_victim'],
      ['put','/api/v1/customer-financial/payment-provider/charge/sk_live_secret'],
      ['patch','/api/v1/customer-financial/offline-receipts/check_cleared'],
      ['delete','/api/v1/customer-financial/public%2Finvoices%2Fcustomer@example.test'],
    ];
    const exact={success:false,error:{category:'CUSTOMER_FINANCIAL_RESOURCE_UNAVAILABLE',
      message:'The requested customer financial resource is unavailable.'}};
    for(const [method,pathname] of attacks){
      const response=await request(app)[method](pathname+'?credential=sk_query&amount=999999')
        .set(HEADERS).set('Content-Type','application/json')
        .send('{"nested":{"secret":"sk_body","email":"customer@example.test"}');
      expect(response.status).toBe(404);expect(response.body).toEqual(exact);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-request-id']).toBeUndefined();
      expect(response.headers['x-correlation-id']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(
        /sk_|customer@example|999999|check_cleared|acct_victim|public%2f/i);
    }
    expect(repository).not.toHaveBeenCalled();expect(throttle).not.toHaveBeenCalled();
    expect(provider.read).not.toHaveBeenCalled();expect(provider.attempt).not.toHaveBeenCalled();
  });

  test('canonical financial routes still pass while all other namespace fallthrough is fixed',async()=>{
    const repository=jest.fn(async()=>({contractVersion:'m27-security-safe-v1',value:null,
      providerCallCount:0,databaseMutationCount:0,liveMoneyMovementCount:0}));
    const app=buildApp({read:repository});
    expect((await request(app).get(ROUTE).query(QUERY).set(HEADERS)).status).toBe(200);
    expect(repository).toHaveBeenCalledTimes(1);
    const absent=await request(app).get(
      '/api/v1/customer-financial/unrecognized/sk_secret_customer@example.test_999999');
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual({success:false,error:{
      category:'CUSTOMER_FINANCIAL_RESOURCE_UNAVAILABLE',
      message:'The requested customer financial resource is unavailable.'}});
    expect(absent.headers['cache-control']).toContain('private');
    expect(absent.headers['x-request-id']).toBeUndefined();
    expect(JSON.stringify(absent.body)).not.toMatch(/sk_secret|customer@example|999999|requestId/i);
    const malformed=await request(app).post(
      '/api/v1/customer-financial/unrecognized/sk_secret_customer@example.test_999999')
      .set('Content-Type','application/json').send('{"nested":"sk_body"');
    expect(malformed.status).toBe(404);
    expect(malformed.body).toEqual(absent.body);
    expect(malformed.headers['cache-control']).toContain('private');
    expect(malformed.headers['x-request-id']).toBeUndefined();
    expect(JSON.stringify(malformed.body)).not.toMatch(/sk_|customer@example|999999|requestId/i);
    const outside=await request(app).get('/api/not-customer-financial/sk_secret_negative-control');
    expect(outside.status).toBe(404);
    expect(outside.body).not.toEqual({success:false,error:{
      category:'CUSTOMER_FINANCIAL_RESOURCE_UNAVAILABLE',
      message:'The requested customer financial resource is unavailable.'}});
  });

  test('mounted inventory exposes no financial public-link webhook charge or offline-receipt mutation',()=>{
    const server=read('src/server.js');const editable=read('src/routes/customerFinancialEditableEstimate.js');
    const demo=read('src/routes/demo.js');const provider=read('src/routes/customerFinancialProviderConnection.js');
    const earlyBoundary=server.indexOf('app.use(customerFinancialUnsupportedBoundary)');
    const cors=server.indexOf('app.use(cors(corsOptions))');
    const correlation=server.indexOf('app.use(correlationId)');
    const parserError=server.indexOf('app.use(customerFinancialParserError)');
    const securityHeaders=server.indexOf('app.use(securityHeaders)');
    const finalBoundary=server.indexOf("app.use('/api/v1/customer-financial', customerFinancialNotFound)");
    const globalNotFound=server.indexOf('app.use(notFound)');
    expect(earlyBoundary).toBeGreaterThan(-1);
    expect(cors).toBeGreaterThan(earlyBoundary);
    expect(correlation).toBeGreaterThan(earlyBoundary);
    expect(parserError).toBeGreaterThan(correlation);
    expect(securityHeaders).toBeGreaterThan(parserError);
    expect(finalBoundary).toBeGreaterThan(-1);
    expect(globalNotFound).toBeGreaterThan(finalBoundary);
    expect(server).toContain("app.use('/api/v1/customer-financial/editable-estimates'");
    expect(server).not.toMatch(/app\.(?:post|put|patch|delete)\(['"]\/api\/v1\/customer-financial\/(?:public|webhook|charge|offline-receipt)/);
    expect(editable).toContain("router.get('/:estimateId/financial-lifecycle-recovery-acceptance'");
    expect(editable).not.toContain("router.post('/:estimateId/financial-lifecycle-recovery-acceptance'");
    expect(demo).not.toContain('financial-lifecycle-recovery-acceptance');
    expect(provider).toContain("router.post('/actions'");
    expect(provider).not.toMatch(/rawSecret|providerAccountId|paymentInstrument|bankAccount/);
    const migrations=fs.readdirSync(path.join(ROOT,'migrations'));
    expect(migrations.some(name=>/^273_/.test(name))).toBe(false);
    expect(read('migrations/268_customer_financial_invoice_draft_origin_v1.sql'))
      .toMatch(/REVOKE ALL ON TABLE[\s\S]+FROM PUBLIC[\s\S]+GRANT EXECUTE ON FUNCTION[\s\S]+TO northstar_app_runtime/i);
  });
});
