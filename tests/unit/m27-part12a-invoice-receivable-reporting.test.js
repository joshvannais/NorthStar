'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const receivableAging = require('../../src/customerFinancial/receivableAging');
const reporting = require('../../src/customerFinancial/invoiceReceivableReporting');
const repository = require('../../src/customerFinancial/invoiceReceivableReportingRepository');
const { createCustomerFinancialReportingRouter, hasRequestBody, hasFramedRequestBody,
  isInvoiceReceivableReadPath, rejectCustomerFinancialReportingReadBody } =
  require('../../src/routes/customerFinancialReporting');

const ROOT = path.resolve(__dirname,'../..');
const read = relative => fs.readFileSync(path.join(ROOT,relative),'utf8');
const source = { organizationId:'11111111-1111-4111-8111-111111111111',
  actorUserId:'22222222-2222-4222-8222-222222222222',actorAccessRole:'owner',
  authSessionId:'33333333-3333-4333-8333-333333333333' };

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function primitiveLeaves(value,pathParts=[],result=[]) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) value.forEach((item,index) =>
      primitiveLeaves(item,[...pathParts,index],result));
    else Object.keys(value).forEach(key =>
      primitiveLeaves(value[key],[...pathParts,key],result));
  } else result.push(pathParts);
  return result;
}
function mutateLeaf(value,pathParts) {
  let target=value;
  for (let index=0;index<pathParts.length-1;index+=1) target=target[pathParts[index]];
  const key=pathParts.at(-1); const current=target[key];
  if (typeof current === 'boolean') target[key]=!current;
  else if (typeof current === 'number') target[key]=current+1;
  else if (typeof current === 'string') target[key]=`${current}__forged`;
  else if (current === null) target[key]='__forged_null__';
  else throw new Error(`Unsupported reporting leaf ${pathParts.join('.')}`);
}

function rawRequest(server,{pathName='/api/v1/customer-financial/reporting/invoice-receivables',
  method='GET',body,headers={}}={}) {
  return new Promise((resolve,reject) => {
    const address=server.address();
    const req=http.request({host:'127.0.0.1',port:address.port,path:pathName,
      method,headers},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
        text:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    req.end(body);
  });
}

describe('Mission 27 Part 12A source-backed invoice and receivable reporting',() => {
  test('projects five ordered value-free facts with complete-coverage indicators',() => {
    const sourceValue=receivableAging.unavailable();
    const value=reporting.unavailable(sourceValue);
    expect(reporting.project(clone(value),sourceValue)).toEqual(value);
    expect(value).toMatchObject({ contractVersion:'m27-invoice-receivable-reporting-v1',
      policyVersion:'mission27.launch.v1',state:'incomplete',
      reason:'invoice_receivable_reporting_coverage_incomplete',value:null,
      exactSourceRevalidatedBeforeAndAfterProjection:true,reportRowCount:0,
      browserDerivedValueCount:0,providerCallCount:0,providerMutationCount:0,
      receiverMutationCount:0,accountingMutationCount:0,
      downstreamReaderMutationCount:0,liveMoneyMovementCount:0 });
    expect(value.factOrder).toEqual(['issued_amount','outstanding_amount','aging',
      'disputed_amount','invoice_lifecycle_counts']);
    expect(value.facts.map(item=>item.fact)).toEqual(value.factOrder);
    expect(value.facts.every(item => item.state === 'unavailable' && item.value === null &&
      item.currency === null && item.coverage.state === 'incomplete' &&
      item.coverage.complete === false && item.coverage.completenessProven === false &&
      item.coverage.missingRecordsOrValuesMayBecomeZero === false)).toBe(true);
    expect(value.facts.map(item=>item.coverage)).toEqual(
      value.facts.map(()=>value.facts[0].coverage));
    expect(value.sourceWitness).toEqual({ contractVersion:'m27-receivable-aging-v1',
      state:'incomplete',reason:'receivable_population_incomplete',
      digest:providerBoundary.digest(sourceValue),
      requestContextCurrentnessRevalidated:true,
      receivableProjectionCurrentnessRevalidated:false });
  });

  test('preserves exact money, aging, dispute, lifecycle and coverage meanings',() => {
    const value=reporting.unavailable();
    expect(value.amountContract).toEqual({ supportedCurrency:'USD',
      integerMinorUnitsRequired:true,oneMatchingCurrencyRequired:true,
      issuedOutstandingAndDisputedRemainSeparate:true,
      disputedAmountMayRewriteIssuedOrOutstandingAmount:false,
      missingAmountMayBecomeZero:false,partialCoverageAmountMayBePresentedAsComplete:false,
      browserArithmeticAllowed:false });
    expect(value.agingContract.exactBuckets).toEqual(receivableAging.AGING_BUCKETS);
    expect(value.agingContract).toMatchObject({
      issuedDueDateAndTrustedServerClockRequired:true,
      missingDueDateOrBalanceMayEnterBucket:false,
      overdueStateMayAuthorizeReminderFeeCollectionOrCharge:false,
      counts:null,outstandingMinorUnits:null });
    expect(value.lifecycleCountContract.exactOrthogonalAxes).toEqual([
      'documentRevision','delivery','paymentBalance','dueAging','disputeRefund',
      'settlement','accountingHandoff']);
    expect(value.lifecycleCountContract).toMatchObject({
      completeIssuedInvoicePopulationRequired:true,everyAxisRetained:true,
      oneDisplayStatusMayReplaceOrthogonalAxes:false,missingCountMayBecomeZero:false,
      counts:null });
    expect(value.coverageSummary).toEqual({ state:'incomplete',
      reason:'issued_receivable_population_unavailable',requiredFactCount:5,
      completeFactCount:0,incompleteFactCount:5,allFactsComplete:false,sourceAsOf:null,
      reportCurrency:null,reportMayBePresentedAsComplete:false,
      partialFactsMayBeSummedOrCompared:false,unknownOrMissingFactMayBecomeZero:false });
  });

  test('rejects every semantic leaf and structural source/fact forgery',() => {
    const sourceValue=receivableAging.unavailable();
    const canonical=reporting.unavailable(sourceValue);
    const failures=[];
    const leaves=primitiveLeaves(canonical);
    expect(leaves.length).toBeGreaterThan(150);
    for (const leaf of leaves) {
      const changed=clone(canonical); mutateLeaf(changed,leaf);
      try { reporting.project(changed,sourceValue); failures.push(leaf.join('.')); }
      catch (error) { expect(error.message).toBe('Invoice and receivable reporting boundary invalid'); }
    }
    const structural=[
      value=>{delete value.sourceWitness;},
      value=>{value.sourceWitness.extra='forged';},
      value=>{value.facts.reverse();},
      value=>{value.factOrder.reverse();},
      value=>{value.facts[0]=clone(value.facts[1]);},
      value=>{value.facts[0].fact='renamed';},
      value=>{value.facts.pop();},
      value=>{value.facts.push(clone(value.facts[0]));},
      value=>{value.facts[0].coverage.complete=true;},
      value=>{value.facts[0].coverage.sourceDigest='f'.repeat(64);},
    ];
    for (const mutate of structural) {
      const changed=clone(canonical);mutate(changed);
      expect(()=>reporting.project(changed,sourceValue)).toThrow(
        'Invoice and receivable reporting boundary invalid');
    }
    const forgedSource=clone(sourceValue);forgedSource.coverage.complete=true;
    const forgedReport=clone(canonical);
    forgedReport.sourceWitness.digest=providerBoundary.digest(forgedSource);
    forgedReport.facts.forEach(item=>{item.coverage.sourceDigest=forgedReport.sourceWitness.digest;});
    expect(()=>reporting.project(forgedReport,forgedSource)).toThrow(
      'Receivable-aging boundary invalid');
    expect(failures).toEqual([]);
  });

  test('revalidates the exact source before and after projection',async () => {
    const canonical=receivableAging.unavailable();
    const readReceivables=jest.fn().mockResolvedValue(canonical);
    await expect(repository.read(source,{readReceivables}))
      .resolves.toEqual(reporting.unavailable(canonical));
    expect(readReceivables).toHaveBeenCalledTimes(2);
    const changed=clone(canonical);changed.projection.projectionDigest='f'.repeat(64);
    readReceivables.mockReset().mockResolvedValueOnce(canonical).mockResolvedValueOnce(changed);
    await expect(repository.read(source,{readReceivables})).rejects.toThrow(
      'Receivable-aging boundary invalid');
    for (const invalid of [null,{}, {...source,actorAccessRole:'member'},
      {...source,organizationId:'victim'}, {...source,extra:'widened'}]) {
      await expect(repository.read(invalid,{readReceivables})).rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_REPORTING_RESTRICTED',status:403 });
    }
  });

  test('matches exactly the case-insensitive mounted Express route equivalence set',() => {
    const equivalents=[
      '/api/v1/customer-financial/reporting/invoice-receivables',
      '/API/v1/customer-financial/reporting/invoice-receivables',
      '/api/V1/customer-financial/reporting/invoice-receivables',
      '/api/v1/CUSTOMER-FINANCIAL/reporting/invoice-receivables',
      '/api/v1/customer-financial/REPORTING/invoice-receivables',
      '/api/v1/customer-financial/reporting/INVOICE-RECEIVABLES',
      '/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG/InVoIcE-ReCeIvAbLeS',
      '/api/v1/customer-financial/reporting/invoice-receivables/',
      '/API/V1/CUSTOMER-FINANCIAL/REPORTING/INVOICE-RECEIVABLES/',
      '/api/v1/customer-financial/reporting//invoice-receivables',
      '/API/V1/CUSTOMER-FINANCIAL/REPORTING//INVOICE-RECEIVABLES/',
    ];
    const nearMisses=[
      '/api/v1/customer-financial/reportinginvoice-receivables',
      '/api//v1/customer-financial/reporting/invoice-receivables',
      '/api/v1/customer-financial//reporting/invoice-receivables',
      '/api/v1/customer-financial/reporting///invoice-receivables',
      '/api/v1/customer-financial/reporting/invoice-receivables//',
      '/api/v1/customer-financial/reporting/./invoice-receivables',
      '/api/v1/customer-financial/reporting/x/../invoice-receivables',
      '/api/v1/customer-financial/reporting/%2e/invoice-receivables',
      '/api/v1/customer-financial/reporting/x/%2e%2e/invoice-receivables',
      '/api/v1/customer-financial/reporting\\invoice-receivables',
      '/api/v1/customer-financial/reporting/%69nvoice-receivables',
      '/api/v1/customer-financial/reporting/invoice%2Dreceivables',
      '/api/v1/customer-financial/reporting%2Finvoice-receivables',
      '/api/v1/customer-financial/reporting%5Cinvoice-receivables',
      '/api/v1/customer-financial/reporting/invoice-receivables%2F',
      '/api/v1/customer-financial/reporting/invoice-receivable',
      '/api/v1/customer-financial/reporting/invoice-receivables-extra',
      '/x/api/v1/customer-financial/reporting/invoice-receivables',
    ];
    for (const pathname of equivalents) {
      expect(isInvoiceReceivableReadPath(pathname)).toBe(true);
    }
    for (const pathname of nearMisses) {
      expect(isInvoiceReceivableReadPath(pathname)).toBe(false);
    }
  });

  test('mounts an exact private GET and rejects queries and methods before source access',async () => {
    const repositoryRead=jest.fn().mockResolvedValue(reporting.unavailable());
    const throttle=jest.fn((_req,_res,next)=>next());
    const app=express();
    app.use(rejectCustomerFinancialReportingReadBody);
    app.use(express.json({verify(req,_res,buffer){req.rawBody=buffer.toString();}}));
    app.use((req,_res,next)=>{req.tenantContext={organizationId:source.organizationId,
      userId:source.actorUserId};req.userRole='owner';
      req.authSession={id:source.authSessionId};next();});
    app.use('/api/v1/customer-financial/reporting',
      createCustomerFinancialReportingRouter({read:repositoryRead,
        auth:(_req,_res,next)=>next(),role:(_req,_res,next)=>next(),
        throttle}));
    const pathName='/api/v1/customer-financial/reporting/invoice-receivables';
    const widened=await request(app).get(pathName)
      .query({tenantId:'victim',issuedMinorUnits:'0',lifecycleState:'paid'});
    expect(widened.status).toBe(400);expect(repositoryRead).not.toHaveBeenCalled();
    expect(throttle).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|paid|issuedMinorUnits/);
    const bodyCases=[
      {name:'JSON object',configure:req=>req.type('json').send({tenantId:'victim',
        accountId:'acct_secret',amountMinorUnits:'100',credential:'sk_secret'})},
      {name:'JSON array',configure:req=>req.type('json').send([
        {customerIdentity:'victim',providerAccountId:'acct_secret'}])},
      {name:'empty JSON object',configure:req=>req.type('json').send({})},
      {name:'JSON string',configure:req=>req.type('json').send('"sk_secret_scalar"')},
      {name:'JSON number',configure:req=>req.type('json').send('123456789')},
      {name:'JSON boolean',configure:req=>req.type('json').send('true')},
      {name:'JSON null',configure:req=>req.type('json').send('null')},
      {name:'malformed JSON',configure:req=>req.type('json')
        .send('{"credential":"sk_secret"')},
      {name:'form body',configure:req=>req.type('form').send(
        {accountId:'acct_secret',amountMinorUnits:'100'})},
      {name:'text body',configure:req=>req.type('text').send('credential=sk_secret')},
      {name:'buffer body',configure:req=>req.type('application/octet-stream')
        .send(Buffer.from('customerIdentity=victim'))},
    ];
    for (const bodyCase of bodyCases) {
      const response=await bodyCase.configure(request(app).get(pathName));
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toContain('private');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.body).toEqual({success:false,error:{
        category:'CUSTOMER_FINANCIAL_REPORTING_INVALID',
        message:'Review the exact current invoice and receivable facts.'}});
      expect(JSON.stringify(response.body)).not.toMatch(
        /victim|acct_secret|sk_secret|123456789|amountMinorUnits|customerIdentity|credential/);
      expect(repositoryRead).not.toHaveBeenCalled();
      expect(throttle).not.toHaveBeenCalled();
    }
    const head=await request(app).head(pathName);
    const options=await request(app).options(pathName);
    const post=await request(app).post(pathName).send({amountMinorUnits:'0'});
    expect([head.status,options.status,post.status]).toEqual([405,405,405]);
    expect(options.headers.allow).toBeUndefined();
    expect(repositoryRead).not.toHaveBeenCalled();
    const response=await request(app).get(pathName);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.body.data).toEqual(reporting.unavailable());
    expect(repositoryRead).toHaveBeenCalledTimes(1);
    expect(throttle).toHaveBeenCalledTimes(1);
  });

  test('rejects every framed, parsed and injected body-presence shape',() => {
    const cases=[
      [{headers:{'content-length':'1'}},true],
      [{headers:{'content-length':'000'}},false],
      [{headers:{'content-length':'not-a-number'}},true],
      [{headers:{'transfer-encoding':'chunked'}},true],
      [{headers:{},rawBody:'{}'},true],
      [{headers:{'content-length':'2'},body:{}},true],
      [{headers:{},body:{}},false],
      [{headers:{},body:[]},true],
      [{headers:{},body:null},true],
      [{headers:{},body:0},true],
      [{headers:{},body:false},true],
      [{headers:{},body:'credential'},true],
      [{headers:{},body:Buffer.from('credential')},true],
      [{headers:{},rawBody:'',body:''},false],
      [{headers:{}},false],
    ];
    for (const [req,expected] of cases) expect(hasRequestBody(req)).toBe(expected);
    const framedCases=[
      [{headers:{'content-length':'1'},rawHeaders:['Content-Length','1']},true],
      [{headers:{'content-length':'0'},rawHeaders:['Content-Length','0']},false],
      [{headers:{'content-length':'invalid'},rawHeaders:['Content-Length','invalid']},true],
      [{headers:{'content-length':'0'},rawHeaders:[
        'Content-Length','0','Content-Length','0']},true],
      [{headers:{'transfer-encoding':'chunked'},rawHeaders:[
        'Transfer-Encoding','chunked']},true],
      [{headers:{},rawHeaders:[]},false],
    ];
    for (const [req,expected] of framedCases) expect(hasFramedRequestBody(req)).toBe(expected);
  });

  test('pre-parser route-equivalence and raw-body matrices match mounted Express',async () => {
    const repositoryRead=jest.fn().mockResolvedValue(reporting.unavailable());
    const throttle=jest.fn((_req,_res,next)=>next());
    const app=express();
    app.use(rejectCustomerFinancialReportingReadBody);
    app.use(express.json({verify(req,_res,buffer){req.rawBody=buffer.toString();}}));
    app.use((req,_res,next)=>{req.tenantContext={organizationId:source.organizationId,
      userId:source.actorUserId};req.userRole='owner';
      req.authSession={id:source.authSessionId};next();});
    app.use('/api/v1/customer-financial/reporting',
      createCustomerFinancialReportingRouter({read:repositoryRead,
        auth:(_req,_res,next)=>next(),role:(_req,_res,next)=>next(),throttle}));
    app.get('/unrelated',(req,res)=>res.json({accepted:req.body}));
    const server=await new Promise((resolve,reject)=>{
      const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));
      listener.on('error',reject);
    });
    try {
      const cases=[
        {body:'"sk_secret_scalar"',headers:{'Content-Type':'application/json'}},
        {body:'123456789',headers:{'Content-Type':'application/json'}},
        {body:'true',headers:{'Content-Type':'application/json'}},
        {body:'null',headers:{'Content-Type':'application/json'}},
        {body:'{"credential":"sk_secret"',headers:{'Content-Type':'application/json'}},
        {body:'credential=sk_secret',headers:{'Content-Type':'text/plain'}},
        {body:Buffer.from([0,1,2,3]),headers:{'Content-Type':'application/octet-stream'}},
        {body:'identity=victim',headers:{'Content-Type':'text/plain',
          'Transfer-Encoding':'chunked'}},
      ];
      for (const bodyCase of cases) {
        const body=bodyCase.body;
        const headers={...bodyCase.headers};
        if (!headers['Transfer-Encoding']) headers['Content-Length']=Buffer.byteLength(body);
        const response=await rawRequest(server,{body,headers});
        expect(response.status).toBe(400);
        expect(response.headers['cache-control']).toContain('private');
        expect(response.headers['cache-control']).toContain('no-store');
        expect(JSON.parse(response.text)).toEqual({success:false,error:{
          category:'CUSTOMER_FINANCIAL_REPORTING_INVALID',
          message:'Review the exact current invoice and receivable facts.'}});
        expect(response.text).not.toMatch(/victim|sk_secret|123456789|credential|identity/);
      }
      const protectedPaths=[
        {pathName:'/api/v1/customer-financial/reporting/invoice-receivables',
          emptyStatus:200},
        {pathName:'/API/v1/customer-financial/reporting/invoice-receivables',
          emptyStatus:200},
        {pathName:'/api/V1/customer-financial/reporting/invoice-receivables',
          emptyStatus:200},
        {pathName:'/api/v1/CUSTOMER-FINANCIAL/reporting/invoice-receivables',
          emptyStatus:200},
        {pathName:'/api/v1/customer-financial/REPORTING/invoice-receivables',
          emptyStatus:200},
        {pathName:'/api/v1/customer-financial/reporting/INVOICE-RECEIVABLES',
          emptyStatus:200},
        {pathName:'/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG/InVoIcE-ReCeIvAbLeS/',
          emptyStatus:200},
        {pathName:'/api/v1/customer-financial/reporting//invoice-receivables',
          emptyStatus:200},
        {pathName:'/API/V1/CUSTOMER-FINANCIAL/REPORTING//INVOICE-RECEIVABLES/',
          emptyStatus:200},
        {pathName:'/api/v1/customer-financial/reporting/invoice-receivables?tenant=victim',
          emptyStatus:400},
      ];
      for (const pathCase of protectedPaths) {
        const body='"sk_path_secret"';
        const response=await rawRequest(server,{pathName:pathCase.pathName,body,
          headers:{'Content-Type':'application/json',
            'Content-Length':String(Buffer.byteLength(body))}});
        expect(response.status).toBe(400);
        expect(response.headers['cache-control']).toContain('private');
        expect(response.headers['cache-control']).toContain('no-store');
        expect(JSON.parse(response.text)).toEqual({success:false,error:{
          category:'CUSTOMER_FINANCIAL_REPORTING_INVALID',
          message:'Review the exact current invoice and receivable facts.'}});
        expect(response.text).not.toMatch(/sk_path_secret|tenant|victim/);
      }
      expect(repositoryRead).not.toHaveBeenCalled();
      expect(throttle).not.toHaveBeenCalled();
      for (const pathCase of protectedPaths) {
        const response=await rawRequest(server,{pathName:pathCase.pathName,
          headers:{'Content-Length':'0'}});
        expect(response.status).toBe(pathCase.emptyStatus);
        expect(response.headers['cache-control']).toContain('private');
        expect(response.headers['cache-control']).toContain('no-store');
      }
      const successfulEmptyPaths=protectedPaths.filter(item=>item.emptyStatus === 200).length;
      expect(repositoryRead).toHaveBeenCalledTimes(successfulEmptyPaths);
      expect(throttle).toHaveBeenCalledTimes(successfulEmptyPaths);
      for (const pathCase of protectedPaths) {
        for (const method of ['HEAD','OPTIONS','POST','PUT','PATCH','DELETE']) {
          const response=await rawRequest(server,{pathName:pathCase.pathName,method});
          expect(response.status).toBe(405);
          expect(response.headers.allow).toBeUndefined();
        }
      }
      expect(repositoryRead).toHaveBeenCalledTimes(successfulEmptyPaths);
      expect(throttle).toHaveBeenCalledTimes(successfulEmptyPaths);
      const nearMisses=[
        '/api/v1/customer-financial/reportinginvoice-receivables',
        '/api//v1/customer-financial/reporting/invoice-receivables',
        '/api/v1/customer-financial//reporting/invoice-receivables',
        '/api/v1/customer-financial/reporting///invoice-receivables',
        '/api/v1/customer-financial/reporting/invoice-receivables//',
        '/api/v1/customer-financial/reporting/./invoice-receivables',
        '/api/v1/customer-financial/reporting/x/../invoice-receivables',
        '/api/v1/customer-financial/reporting/%2e/invoice-receivables',
        '/api/v1/customer-financial/reporting/x/%2e%2e/invoice-receivables',
        '/api/v1/customer-financial/reporting\\invoice-receivables',
        '/api/v1/customer-financial/reporting/%69nvoice-receivables',
        '/api/v1/customer-financial/reporting/invoice%2Dreceivables',
        '/api/v1/customer-financial/reporting%2Finvoice-receivables',
        '/api/v1/customer-financial/reporting%5Cinvoice-receivables',
        '/api/v1/customer-financial/reporting/invoice-receivables%2F',
        '/api/v1/customer-financial/reporting/invoice-receivable',
        '/api/v1/customer-financial/reporting/invoice-receivables-extra',
        '/x/api/v1/customer-financial/reporting/invoice-receivables',
      ];
      for (const pathName of nearMisses) {
        const response=await rawRequest(server,{pathName,body:'{}',
          headers:{'Content-Type':'application/json','Content-Length':'2'}});
        expect(response.status).toBe(404);
        expect(response.text).not.toContain('CUSTOMER_FINANCIAL_REPORTING_INVALID');
      }
      const empty=await rawRequest(server,{headers:{'Content-Length':'0'}});
      expect(empty.status).toBe(200);
      const trailing=await rawRequest(server,{
        pathName:'/api/v1/customer-financial/reporting/invoice-receivables/',
        body:'account=acct_secret',headers:{'Content-Type':'text/plain',
          'Content-Length':String(Buffer.byteLength('account=acct_secret'))}});
      expect(trailing.status).toBe(400);
      const unrelated=await rawRequest(server,{pathName:'/unrelated',body:'{}',
        headers:{'Content-Type':'application/json','Content-Length':'2'}});
      expect(unrelated.status).toBe(200);
      expect(repositoryRead).toHaveBeenCalledTimes(successfulEmptyPaths+1);
      expect(throttle).toHaveBeenCalledTimes(successfulEmptyPaths+1);
    } finally {
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });

  test('adds no mutation, demo surface, transport, table or migration 273',() => {
    const sourceCode=[read('src/customerFinancial/invoiceReceivableReporting.js'),
      read('src/customerFinancial/invoiceReceivableReportingRepository.js'),
      read('src/routes/customerFinancialReporting.js')].join('\n');
    expect(sourceCode).not.toMatch(/INSERT|UPDATE|DELETE|https\.request|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('invoice-receivables');
    expect(read('src/server.js')).toContain(
      "app.use('/api/v1/customer-financial/reporting'");
    expect(read('src/server.js').indexOf('app.use(rejectCustomerFinancialReportingReadBody)'))
      .toBeLessThan(read('src/server.js').indexOf('app.use(express.json({'));
    expect(read('src/middleware/security.js')).toContain(
      "'/api/v1/customer-financial/reporting/invoice-receivables'");
    const migrations=fs.readdirSync(path.join(ROOT,'migrations'))
      .filter(name=>name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name=>/^273_/.test(name))).toBe(false);
  });
});
