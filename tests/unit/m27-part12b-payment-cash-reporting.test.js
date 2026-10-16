'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const request = require('supertest');
const reporting = require('../../src/customerFinancial/paymentCashReporting');
const repository = require('../../src/customerFinancial/paymentCashReportingRepository');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialPaymentCashReportingRouter,
  rejectCustomerFinancialPaymentCashReportingReadBody, isPaymentCashReadPath } =
  require('../../src/routes/customerFinancialPaymentCashReporting');

const ROOT = path.resolve(__dirname,'../..');
const read = relative => fs.readFileSync(path.join(ROOT,relative),'utf8');
const UUIDS = Object.freeze({
  organizationId:'11111111-1111-4111-8111-111111111111',
  actorUserId:'22222222-2222-4222-8222-222222222222',
  authSessionId:'33333333-3333-4333-8333-333333333333',
});
const clone = value => JSON.parse(JSON.stringify(value));

function rawRequest(server,{pathName='/api/v1/customer-financial/reporting/payment-cash',
  method='GET',headers={},body}={}) {
  return new Promise((resolve,reject) => {
    const address=server.address();
    const req=http.request({host:'127.0.0.1',port:address.port,path:pathName,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
        text:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);if(body !== undefined) req.write(body);req.end();
  });
}

function unitApp({readFn=jest.fn(async()=>reporting.unavailable()),
  throttle=jest.fn((_req,_res,next)=>next())}={}) {
  const app=express();
  app.use(rejectCustomerFinancialPaymentCashReportingReadBody);
  app.use(express.json({verify(req,_res,buffer){req.rawBody=buffer.toString();}}));
  app.use(express.urlencoded({extended:false}));
  app.use((req,_res,next)=>{req.tenantContext={organizationId:UUIDS.organizationId,
    userId:UUIDS.actorUserId};req.userRole='owner';req.authSession={id:UUIDS.authSessionId};next();});
  app.use('/api/v1/customer-financial/reporting',
    createCustomerFinancialPaymentCashReportingRouter({auth:(_req,_res,next)=>next(),
      role:(_req,_res,next)=>next(),read:readFn,throttle}));
  app.use((_req,res)=>res.status(404).json({error:'not found'}));
  return {app,readFn,throttle};
}

describe('Mission 27 Part 12B payment and cash reporting',() => {
  test('freezes every required aggregate with separate coverage and launch support',() => {
    const value=reporting.unavailable();
    expect(value.contractVersion).toBe('m27-payment-cash-reporting-v1');
    expect(value.factOrder).toEqual([
      'provider_authorized_amount','provider_captured_amount','provider_settled_amount',
      'provider_refunded_amount','provider_disputed_amount','provider_reversed_amount',
      'provider_fee_amount','offline_cash_received_amount','check_clearance_unknown_amount',
      'check_cleared_amount','check_returned_amount','offline_reversed_amount',
      'offline_correction_amount',
    ]);
    expect(value.facts.map(item=>item.fact)).toEqual(value.factOrder);
    expect(value.facts).toHaveLength(13);
    expect(value.facts.every(item=>item.value === null && item.currency === null &&
      item.coverage.complete === false && item.coverage.totalSourceRecordCount === null &&
      item.launchMatrixSupport.currentAuthorityAvailable === false &&
      item.launchMatrixSupport.positiveRuntimeAvailable === false)).toBe(true);
    expect(value.facts.find(item=>item.fact === 'check_cleared_amount')).toMatchObject({
      state:'check_clearance_authority_unavailable',
      reason:'check_clearance_authority_unavailable',
      launchMatrixSupport:{support:'disabled',requiredAuthority:'authenticated_bank_clearance'},
    });
    expect(value.facts.find(item=>item.fact === 'check_returned_amount')).toMatchObject({
      state:'returned_check_authority_unavailable',
      reason:'returned_check_authority_unavailable',
    });
    expect(value.separationContract).toMatchObject({
      acceptedOfflineCashReceiptMayImplyProviderSettlement:false,
      checkClearanceUnknownMayImplyCheckCleared:false,
      checkClearanceUnknownMayImplySettledCash:false,
      offlineCorrectionMayRewritePriorEvidence:false,
    });
    expect(value.coverageSummary).toEqual(expect.objectContaining({requiredFactCount:13,
      completeFactCount:0,incompleteFactCount:13,allFactsComplete:false,
      unknownOrMissingFactMayBecomeZero:false}));
    expect(value.sourceWitnesses.map(item=>item.source)).toEqual(reporting.SOURCE_ORDER);
    expect(()=>reporting.project(value,reporting.defaultSources())).not.toThrow();
  });

  test('rejects every forged source or report semantic leaf and structural contradiction',() => {
    const sources=reporting.defaultSources();
    const canonical=reporting.unavailable(sources);
    const sourceSemanticMutations=[
      value=>{value.providerEventNormalization.contractVersion='forged';},
      value=>{value.providerEventNormalization.stateContract[1].normalized=true;},
      value=>{value.providerEventNormalization.normalization.providerState='authorized';},
      value=>{value.providerEventNormalization.authority.paymentSuccessAuthorizesSettlement=true;},
      value=>{value.settlementPayoutReconciliation.contractVersion='forged';},
      value=>{value.settlementPayoutReconciliation.fundsPolicy.supportedMode='live';},
      value=>{value.settlementPayoutReconciliation.projection.feeMinorUnits='0';},
      value=>{value.settlementPayoutReconciliation.safeguards.captureMayImplySettlement=true;},
      value=>{value.offlinePaymentReadiness.contractVersion='forged';},
      value=>{value.offlinePaymentReadiness.cashSemantics.providerSettlementClaimed=true;},
      value=>{value.offlinePaymentReadiness.checkSemantics.clearedTransitionEnabled=true;},
      value=>{value.offlinePaymentReadiness.clearedCheckSemantics.currentProjectionState='check_cleared';},
      value=>{value.offlinePaymentReadiness.returnedCheckSemantics.currentProjectionState='check_returned';},
      value=>{value.offlinePaymentReadiness.offlineReversalSemantics.inPlaceEditAllowed=true;},
      value=>{value.paymentOutcomeReadiness.contractVersion='forged';},
      value=>{value.paymentOutcomeReadiness.providerOutcomePolicy.authenticatedProviderEvidenceOnly=false;},
      value=>{value.paymentOutcomeReadiness.offlineOutcomePolicy.checkUnknownMayBecomeClearedCash=true;},
      value=>{value.paymentOutcomeReadiness.axes[6].accepted=true;},
      value=>{value.paymentOutcomeReadiness.projection.providerFeeMinorUnits='0';},
    ];
    for (const mutate of sourceSemanticMutations) {
      const value=clone(sources);mutate(value);
      expect(()=>reporting.sourceBundle(value)).toThrow(/boundary invalid/);
    }
    const factFieldMutations=[];
    for (let index=0;index<canonical.facts.length;index+=1) {
      factFieldMutations.push(
        value=>{value.facts[index].state='forged';},
        value=>{value.facts[index].reason='forged';},
        value=>{value.facts[index].value='0';},
        value=>{value.facts[index].currency='USD';},
        value=>{value.facts[index].coverage.complete=true;},
        value=>{value.facts[index].coverage.sourceDigest='a'.repeat(64);},
        value=>{value.facts[index].coverage.totalSourceRecordCount=0;},
        value=>{value.facts[index].launchMatrixSupport.support='forged';},
        value=>{value.facts[index].launchMatrixSupport.currentAuthorityAvailable=true;},
        value=>{value.facts[index].launchMatrixSupport.mayInferFromAnotherFact=true;},
      );
    }
    for (const mutate of factFieldMutations) {
      const value=clone(canonical);mutate(value);
      expect(()=>reporting.project(value,sources)).toThrow(
        'Payment and cash reporting boundary invalid');
    }
    const contradictions=[
      value=>{delete value.facts[0].coverage;},
      value=>{value.facts.reverse();},
      value=>{value.facts[1]=clone(value.facts[0]);},
      value=>{value.facts[0].fact='provider_settled_amount';},
      value=>{value.facts[7].launchMatrixSupport.support='supported_test_mode';},
      value=>{value.facts[9].state='unavailable';},
      value=>{value.facts[10].state='check_clearance_unknown';},
      value=>{value.facts[7].coverage.sourceDigest=value.facts[0].coverage.sourceDigest;},
      value=>{value.sourceWitnesses.reverse();},
      value=>{value.sourceWitnesses[1]=clone(value.sourceWitnesses[0]);},
      value=>{value.sourceWitnesses[0].digest='a'.repeat(64);},
      value=>{value.sourceOrder=['paymentOutcomeReadiness',...value.sourceOrder.slice(1)];},
      value=>{value.separationContract.acceptedOfflineCashReceiptMayImplyProviderSettlement=true;},
      value=>{value.coverageSummary.completeFactCount=13;},
      value=>{value.launchMatrix.checkClearedTransitionSupport='supported';},
      value=>{value.extra='forged';},
    ];
    for (const contradict of contradictions) {
      const value=clone(canonical);contradict(value);
      expect(()=>reporting.project(value,sources)).toThrow(
        'Payment and cash reporting boundary invalid');
    }
    const sourceStructures=[
      value=>{delete value.providerEventNormalization;},
      value=>{value.extra=clone(value.paymentOutcomeReadiness);},
      value=>{value.providerEventNormalization=clone(value.paymentOutcomeReadiness);},
      value=>{const first=value.providerEventNormalization;
        delete value.providerEventNormalization;value.providerEventNormalization=first;},
    ];
    for (const contradict of sourceStructures) {
      const value=clone(sources);contradict(value);
      expect(()=>reporting.sourceBundle(value)).toThrow();
    }
  });

  test('repository validates source identity and revalidates exact source before and after',async () => {
    const source={...UUIDS,actorAccessRole:'owner'};
    const readSources=jest.fn(async()=>clone(reporting.defaultSources()));
    await expect(repository.read(source,{readSources})).resolves.toEqual(reporting.unavailable());
    expect(readSources).toHaveBeenCalledTimes(2);
    for (const invalid of [null,{},[] ,{...source,actorAccessRole:'member'},
      {...source,organizationId:'not-a-uuid'}, {...source,extra:true}]) {
      await expect(repository.read(invalid,{readSources})).rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_PAYMENT_CASH_REPORTING_RESTRICTED',status:403});
    }
    const changed=clone(reporting.defaultSources());
    changed.paymentOutcomeReadiness.reason='forged';
    await expect(repository.read(source,{readSources:jest.fn()
      .mockResolvedValueOnce(reporting.defaultSources()).mockResolvedValueOnce(changed)}))
      .rejects.toThrow(/boundary invalid/);
  });

  test('route matcher mirrors case-insensitive Express paths and excludes every near miss',() => {
    const equivalents=[
      '/api/v1/customer-financial/reporting/payment-cash',
      '/API/v1/customer-financial/reporting/payment-cash',
      '/api/V1/CUSTOMER-FINANCIAL/REPORTING/PAYMENT-CASH',
      '/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG//PaYmEnT-CaSh/',
      '/api/v1/customer-financial/reporting/payment-cash/',
    ];
    equivalents.forEach(value=>expect(isPaymentCashReadPath(value)).toBe(true));
    const nearMisses=[
      '/api//v1/customer-financial/reporting/payment-cash',
      '/api/v1/customer-financial//reporting/payment-cash',
      '/api/v1/customer-financial/reporting///payment-cash',
      '/api/v1/customer-financial/reporting/payment-cash//',
      '/api/v1/customer-financial/reporting/%2e/payment-cash',
      '/api/v1/customer-financial/reporting\\payment-cash',
      '/api/v1/customer-financial/reporting/%70ayment-cash',
      '/api/v1/customer-financial/reporting/payment%2Dcash',
      '/api/v1/customer-financial/reporting%2Fpayment-cash',
      '/api/v1/customer-financial/reporting/payment-cash-extra',
      '/x/api/v1/customer-financial/reporting/payment-cash',
    ];
    nearMisses.forEach(value=>expect(isPaymentCashReadPath(value)).toBe(false));
  });

  test('all body shapes and equivalent paths fail before parser, throttle or read',async () => {
    const mounted=unitApp();
    const server=await new Promise((resolve,reject)=>{
      const listener=mounted.app.listen(0,'127.0.0.1',()=>resolve(listener));
      listener.on('error',reject);
    });
    try {
      const bodyCases=[
        {body:'"sk_secret_scalar"',headers:{'Content-Type':'application/json'}},
        {body:'123456789',headers:{'Content-Type':'application/json'}},
        {body:'true',headers:{'Content-Type':'application/json'}},
        {body:'null',headers:{'Content-Type':'application/json'}},
        {body:'{}',headers:{'Content-Type':'application/json'}},
        {body:'[]',headers:{'Content-Type':'application/json'}},
        {body:'{"account":"acct_secret"',headers:{'Content-Type':'application/json'}},
        {body:'account=acct_secret',headers:{'Content-Type':'application/x-www-form-urlencoded'}},
        {body:'identity=victim',headers:{'Content-Type':'text/plain'}},
        {body:Buffer.from([0,1,2,3]),headers:{'Content-Type':'application/octet-stream'}},
        {body:'secret=chunked',headers:{'Content-Type':'text/plain',
          'Transfer-Encoding':'chunked'}},
      ];
      const equivalents=[
        '/api/v1/customer-financial/reporting/payment-cash',
        '/API/v1/customer-financial/reporting/payment-cash',
        '/api/V1/CUSTOMER-FINANCIAL/REPORTING/PAYMENT-CASH',
        '/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG/PaYmEnT-CaSh/',
        '/api/v1/customer-financial/reporting//payment-cash',
      ];
      for (const pathName of equivalents) {
        for (const bodyCase of bodyCases) {
          const headers={...bodyCase.headers};
          if (!headers['Transfer-Encoding']) {
            headers['Content-Length']=String(Buffer.byteLength(bodyCase.body));
          }
          const response=await rawRequest(server,{pathName,headers,body:bodyCase.body});
          expect(response.status).toBe(400);
          expect(response.headers['cache-control']).toContain('private');
          expect(response.headers['cache-control']).toContain('no-store');
          expect(JSON.parse(response.text)).toEqual({success:false,error:{
            category:'CUSTOMER_FINANCIAL_PAYMENT_CASH_REPORTING_INVALID',
            message:'Review the exact current payment and cash facts.'}});
          expect(response.text).not.toMatch(/secret|victim|acct|123456789|identity/);
        }
      }
      expect(mounted.readFn).not.toHaveBeenCalled();
      expect(mounted.throttle).not.toHaveBeenCalled();
      for (const pathName of equivalents) {
        const valid=await rawRequest(server,{pathName,headers:{'Content-Length':'0'}});
        expect(valid.status).toBe(200);
      }
      expect(mounted.readFn).toHaveBeenCalledTimes(equivalents.length);
      expect(mounted.throttle).toHaveBeenCalledTimes(equivalents.length);
    } finally {
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });

  test('query, methods, CORS, and near-miss routes fail closed without widened entry',async () => {
    const mounted=unitApp();
    const exact='/api/v1/customer-financial/reporting/payment-cash';
    const query=await request(mounted.app).get(`${exact}?credential=sk_secret&amount=100`);
    expect(query.status).toBe(400);expect(JSON.stringify(query.body)).not.toMatch(/sk_secret|100/);
    expect(mounted.readFn).not.toHaveBeenCalled();expect(mounted.throttle).not.toHaveBeenCalled();
    for (const method of ['head','options','post','put','patch','delete']) {
      const response=await request(mounted.app)[method](exact);
      expect(response.status).toBe(405);expect(response.headers.allow).toBeUndefined();
    }
    expect(mounted.readFn).not.toHaveBeenCalled();
    const nearMisses=[
      '/api/v1/customer-financial/reportingpayment-cash',
      '/api//v1/customer-financial/reporting/payment-cash',
      '/api/v1/customer-financial//reporting/payment-cash',
      '/api/v1/customer-financial/reporting///payment-cash',
      '/api/v1/customer-financial/reporting/payment-cash//',
      '/api/v1/customer-financial/reporting/%70ayment-cash',
      '/api/v1/customer-financial/reporting/payment%2Dcash',
      '/api/v1/customer-financial/reporting%2Fpayment-cash',
      '/api/v1/customer-financial/reporting%5Cpayment-cash',
      '/api/v1/customer-financial/reporting/payment-cash%2F',
      '/api/v1/customer-financial/reporting/payment-cas',
      '/api/v1/customer-financial/reporting/payment-cash-extra',
      '/x/api/v1/customer-financial/reporting/payment-cash',
    ];
    for (const pathName of nearMisses) {
      expect((await request(mounted.app).get(pathName)).status).toBe(404);
    }
    // Superagent follows WHATWG canonicalization before sending these strings,
    // so the mounted app receives the exact protected path. Prove that their
    // canonicalized body-bearing form is still stopped by the pre-parser gate.
    for (const pathName of [
      '/api/v1/customer-financial/reporting/./payment-cash',
      '/api/v1/customer-financial/reporting/x/../payment-cash',
      '/api/v1/customer-financial/reporting/%2e/payment-cash',
      '/api/v1/customer-financial/reporting/x/%2e%2e/payment-cash',
      '/api/v1/customer-financial/reporting\\payment-cash',
    ]) {
      expect((await request(mounted.app).get(pathName)).status).toBe(200);
      const rejected=await request(mounted.app).get(pathName).type('json')
        .send('"sk_canonicalized_secret"');
      expect(rejected.status).toBe(400);
      expect(rejected.headers['cache-control']).toContain('private');
      expect(JSON.stringify(rejected.body)).not.toContain('sk_canonicalized_secret');
    }
    const corsCases=[
      '/api/v1/customer-financial/reporting/payment-cash',
      '/API/V1/CUSTOMER-FINANCIAL/REPORTING/PAYMENT-CASH/',
      '/api/v1/customer-financial/reporting//payment-cash',
    ];
    for (const url of corsCases) {
      const req={path:url,header:name=>name === 'Origin' ? 'http://localhost:3000' : undefined};
      await new Promise(resolve=>corsOptions(req,(_error,options)=>{
        expect(options.methods).toEqual(['GET']);expect(options.preflightContinue).toBe(true);
        resolve();
      }));
    }
  });

  test('adds no mutation, demo route, external transport, table or migration 273',() => {
    const sourceCode=[read('src/customerFinancial/paymentCashReporting.js'),
      read('src/customerFinancial/paymentCashReportingRepository.js'),
      read('src/routes/customerFinancialPaymentCashReporting.js')].join('\n');
    expect(sourceCode).not.toMatch(/INSERT|UPDATE|DELETE|https\.request|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('payment-cash');
    expect(read('src/server.js')).toContain('rejectCustomerFinancialPaymentCashReportingReadBody');
    expect(read('src/server.js').indexOf(
      'app.use(rejectCustomerFinancialPaymentCashReportingReadBody)'))
      .toBeLessThan(read('src/server.js').indexOf('app.use(express.json({'));
    expect(read('src/middleware/security.js')).toContain('payment-cash');
    const migrations=fs.readdirSync(path.join(ROOT,'migrations'))
      .filter(name=>name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name=>/^273_/.test(name))).toBe(false);
  });
});
