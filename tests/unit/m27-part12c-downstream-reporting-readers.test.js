'use strict';

const fs=require('fs');
const http=require('http');
const path=require('path');
const express=require('express');
const request=require('supertest');
const readers=require('../../src/customerFinancial/downstreamReportingReaders');
const repository=require('../../src/customerFinancial/downstreamReportingReadersRepository');
const {corsOptions}=require('../../src/middleware/security');
const {createCustomerFinancialDownstreamReportingRouter,
  rejectCustomerFinancialDownstreamReportingBody,isDownstreamReadersPath}=
  require('../../src/routes/customerFinancialDownstreamReporting');

const ROOT=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(ROOT,relative),'utf8');
const UUIDS=Object.freeze({
  organizationId:'11111111-1111-4111-8111-111111111111',
  actorUserId:'22222222-2222-4222-8222-222222222222',
  authSessionId:'33333333-3333-4333-8333-333333333333',
});
const clone=value=>JSON.parse(JSON.stringify(value));

function rawRequest(server,{pathName='/api/v1/customer-financial/reporting/downstream-readers',
  method='GET',headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    const address=server.address();
    const pending=http.request({host:'127.0.0.1',port:address.port,path:pathName,method,headers},
      response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));
        response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,
          text:Buffer.concat(chunks).toString('utf8')}));});
    pending.on('error',reject);if(body !== undefined) pending.write(body);pending.end();
  });
}

function unitApp({readFn=jest.fn(async()=>readers.unavailable()),
  throttle=jest.fn((_req,_res,next)=>next())}={}) {
  const app=express();
  app.use(rejectCustomerFinancialDownstreamReportingBody);
  app.use(express.json({verify(req,_res,buffer){req.rawBody=buffer.toString();}}));
  app.use(express.urlencoded({extended:false}));
  app.use((req,_res,next)=>{req.tenantContext={organizationId:UUIDS.organizationId,
    userId:UUIDS.actorUserId};req.userRole='owner';req.authSession={id:UUIDS.authSessionId};next();});
  app.use('/api/v1/customer-financial/reporting',
    createCustomerFinancialDownstreamReportingRouter({auth:(_req,_res,next)=>next(),
      role:(_req,_res,next)=>next(),read:readFn,throttle}));
  app.use((_req,res)=>res.status(404).json({error:'not found'}));
  return {app,readFn,throttle};
}

function leafPaths(value,prefix=[]) {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.keys(value).flatMap(key=>leafPaths(value[key],[...prefix,key]));
}

function mutateLeaf(value,pathSegments) {
  let parent=value;
  for (const segment of pathSegments.slice(0,-1)) parent=parent[segment];
  const key=pathSegments.at(-1);
  const current=parent[key];
  if (current === null) parent[key]='forged';
  else if (typeof current === 'boolean') parent[key]=!current;
  else if (typeof current === 'number') parent[key]=current + 1;
  else if (typeof current === 'string') parent[key]=`${current}-forged`;
  else throw new Error(`Unsupported leaf at ${pathSegments.join('.')}`);
}

describe('Mission 27 Part 12C downstream reporting readers',()=>{
  test('freezes exact minimized Mission 25, 26 and 33 unavailable readers',()=>{
    const value=readers.unavailable();
    expect(value.contractVersion).toBe('m27-downstream-reporting-readers-v1');
    expect(value.readerOrder).toEqual(['mission25','mission26','mission33']);
    expect(value.readers.map(item=>item.reader)).toEqual(value.readerOrder);
    expect(value.readers.map(item=>item.destinationContractVersion)).toEqual([
      'mission25.tenant_edit_observation.v1',
      'mission26.collection_forecast.evidence.v1',
      'mission33.platform_financial_fact.v1',
    ]);
    expect(value.readers.every(item=>item.state === 'unavailable' && item.value === null &&
      item.purposePermissionCurrent === false && item.sourceCurrentnessRevalidated === false &&
      item.completeCoverageAvailable === false && item.emittedRecordCount === 0 &&
      item.downstreamWriteCount === 0 && item.automaticApplicationCount === 0)).toBe(true);
    expect(value.readers[0].prohibitions).toEqual(expect.arrayContaining([
      'cross_tenant_training','automatic_price_or_policy_application']));
    expect(value.readers[1].requiredEvidence).toEqual(expect.arrayContaining([
      'source_complete_historical_evidence','accepted_calibration']));
    expect(value.readers[1].prohibitions).toEqual(expect.arrayContaining([
      'earned_revenue_inference','forecast_as_fact','automatic_collection_action']));
    expect(value.readers[2].prohibitions).toEqual(expect.arrayContaining([
      'tenant_detail_inspection','raw_tenant_content','cross_company_disclosure']));
    expect(value.coverageEvidence).toMatchObject({invoiceReceivableComplete:false,
      paymentCashComplete:false,downstreamCoverageComplete:false,
      zeroEmittedRecordsProvesZeroFinancialActivity:false});
    expect(Object.values(value.mutationBoundary).every(item=>item === false)).toBe(true);
    expect(value).toMatchObject({reportRowCount:0,learningObservationCount:0,
      forecastCount:0,platformFactCount:0,providerCallCount:0,providerMutationCount:0,
      receiverMutationCount:0,accountingMutationCount:0,
      downstreamReaderMutationCount:0,liveMoneyMovementCount:0});
    expect(()=>readers.project(value,readers.defaultSources())).not.toThrow();
  });

  test('rejects every forged source/output semantic leaf and structural contradiction',()=>{
    const sources=readers.defaultSources();
    const sourceSemanticMutations=[
      value=>{value.invoiceReceivableReporting.contractVersion='forged';},
      value=>{value.invoiceReceivableReporting.state='complete';},
      value=>{value.invoiceReceivableReporting.sourceWitness.digest='a'.repeat(64);},
      value=>{value.invoiceReceivableReporting.facts[0].value=0;},
      value=>{value.invoiceReceivableReporting.facts[0].coverage.complete=true;},
      value=>{value.invoiceReceivableReporting.coverageSummary.allFactsComplete=true;},
      value=>{value.invoiceReceivableReporting.access.tenantCrossingAllowed=true;},
      value=>{value.invoiceReceivableReporting.privacy.tenantOrCustomerIdentityExposed=true;},
      value=>{value.paymentCashReporting.contractVersion='forged';},
      value=>{value.paymentCashReporting.state='complete';},
      value=>{value.paymentCashReporting.sourceWitnesses[0].digest='a'.repeat(64);},
      value=>{value.paymentCashReporting.facts[0].value=0;},
      value=>{value.paymentCashReporting.facts[0].coverage.complete=true;},
      value=>{value.paymentCashReporting.coverageSummary.allFactsComplete=true;},
      value=>{value.paymentCashReporting.launchMatrix.providerMode='live';},
      value=>{value.paymentCashReporting.separationContract
        .acceptedOfflineCashReceiptMayImplyProviderSettlement=true;},
      value=>{value.paymentCashReporting.access.tenantCrossingAllowed=true;},
      value=>{value.paymentCashReporting.privacy.tenantOrCustomerIdentityExposed=true;},
    ];
    for (const mutate of sourceSemanticMutations) {
      const value=clone(sources);mutate(value);
      expect(()=>readers.sourceBundle(value)).toThrow();
    }
    const canonical=readers.unavailable(sources);
    for (const pathSegments of leafPaths(canonical)) {
      const value=clone(canonical);mutateLeaf(value,pathSegments);
      expect(readers.isExactProjection(value,canonical)).toBe(false);
    }
    const reportStructures=[
      value=>{delete value.readers;},value=>{value.extra='forged';},
      value=>{value.readers.reverse();},value=>{value.readers[1]=clone(value.readers[0]);},
      value=>{value.readerOrder.reverse();},value=>{value.sourceWitnesses.reverse();},
      value=>{value.sourceWitnesses[1]=clone(value.sourceWitnesses[0]);},
      value=>{value.readers[0].allowedEvidence.reverse();},
      value=>{value.readers[1].requiredEvidence.push('forged');},
      value=>{value.readers[2].prohibitions[0]='tenant_detail_allowed';},
    ];
    for (const contradict of reportStructures) {
      const value=clone(canonical);contradict(value);
      expect(readers.isExactProjection(value,canonical)).toBe(false);
    }
    const sourceStructures=[
      value=>{delete value.invoiceReceivableReporting;},
      value=>{value.extra=clone(value.paymentCashReporting);},
      value=>{value.invoiceReceivableReporting=clone(value.paymentCashReporting);},
      value=>{const first=value.invoiceReceivableReporting;
        delete value.invoiceReceivableReporting;value.invoiceReceivableReporting=first;},
    ];
    for (const contradict of sourceStructures) {
      const value=clone(sources);contradict(value);
      expect(()=>readers.sourceBundle(value)).toThrow();
    }
    const forged=clone(canonical);forged.readers[0].purposePermissionCurrent=true;
    expect(()=>readers.project(forged,sources)).toThrow(
      'Downstream reporting readers boundary invalid');
  });

  test('repository validates identity and revalidates both exact sources before and after',async()=>{
    const source={...UUIDS,actorAccessRole:'owner'};
    const readSources=jest.fn(async()=>clone(readers.defaultSources()));
    await expect(repository.read(source,{readSources})).resolves.toEqual(readers.unavailable());
    expect(readSources).toHaveBeenCalledTimes(2);
    for (const invalid of [null,{},[],{...source,actorAccessRole:'member'},
      {...source,organizationId:'not-a-uuid'},{...source,extra:true}]) {
      await expect(repository.read(invalid,{readSources})).rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_DOWNSTREAM_READERS_RESTRICTED',status:403});
    }
    const changed=clone(readers.defaultSources());
    changed.paymentCashReporting.reason='forged';
    await expect(repository.read(source,{readSources:jest.fn()
      .mockResolvedValueOnce(readers.defaultSources()).mockResolvedValueOnce(changed)}))
      .rejects.toThrow();
  });

  test('route matcher exactly mirrors protected Express path equivalence',()=>{
    for (const value of [
      '/api/v1/customer-financial/reporting/downstream-readers',
      '/API/v1/customer-financial/reporting/downstream-readers',
      '/api/V1/CUSTOMER-FINANCIAL/REPORTING/DOWNSTREAM-READERS',
      '/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG//DoWnStReAm-ReAdErS/',
      '/api/v1/customer-financial/reporting/downstream-readers/',
    ]) expect(isDownstreamReadersPath(value)).toBe(true);
    for (const value of [
      '/api//v1/customer-financial/reporting/downstream-readers',
      '/api/v1/customer-financial//reporting/downstream-readers',
      '/api/v1/customer-financial/reporting///downstream-readers',
      '/api/v1/customer-financial/reporting/downstream-readers//',
      '/api/v1/customer-financial/reporting/%2e/downstream-readers',
      '/api/v1/customer-financial/reporting\\downstream-readers',
      '/api/v1/customer-financial/reporting/%64ownstream-readers',
      '/api/v1/customer-financial/reporting/downstream%2Dreaders',
      '/api/v1/customer-financial/reporting%2Fdownstream-readers',
      '/api/v1/customer-financial/reporting/downstream-readers-extra',
      '/x/api/v1/customer-financial/reporting/downstream-readers',
    ]) expect(isDownstreamReadersPath(value)).toBe(false);
  });

  test('owns the protected path method body framing and CORS cross-product before parsing',async()=>{
    const mounted=unitApp();
    const server=await new Promise((resolve,reject)=>{
      const listener=mounted.app.listen(0,'127.0.0.1',()=>resolve(listener));
      listener.on('error',reject);
    });
    try {
      const bodyCases=[
        {body:undefined,headers:{}},{body:undefined,headers:{'Content-Length':'0'}},
        {body:'"sk_secret_scalar"',headers:{'Content-Type':'application/json'}},
        {body:'123456789',headers:{'Content-Type':'application/json'}},
        {body:'true',headers:{'Content-Type':'application/json'}},
        {body:'null',headers:{'Content-Type':'application/json'}},
        {body:'{"tenant":"victim"}',headers:{'Content-Type':'application/json'}},
        {body:'[{"amount":100}]',headers:{'Content-Type':'application/json'}},
        {body:'{"credential":"sk_secret"',headers:{'Content-Type':'application/json'}},
        {body:'account=acct_secret',headers:{'Content-Type':'application/x-www-form-urlencoded'}},
        {body:'identity=victim',headers:{'Content-Type':'text/plain'}},
        {body:Buffer.from([0,1,2,3]),headers:{'Content-Type':'application/octet-stream'}},
        {body:'secret=chunked',headers:{'Content-Type':'text/plain','Transfer-Encoding':'chunked'}},
      ];
      const methods=['GET','HEAD','OPTIONS','POST','PUT','PATCH','DELETE','TRACE','PROPFIND'];
      const equivalents=[
        '/api/v1/customer-financial/reporting/downstream-readers',
        '/API/V1/CUSTOMER-FINANCIAL/REPORTING/DOWNSTREAM-READERS/',
        '/ApI/V1/CuStOmEr-FiNaNcIaL/RePoRtInG//DoWnStReAm-ReAdErS',
        '/api/v1/customer-financial/reporting/downstream-readers?tenant=victim',
      ];
      const cases=[];
      for (const pathName of equivalents) for (const method of methods) {
        for (const bodyCase of bodyCases) {
          const headers={...bodyCase.headers};
          if (bodyCase.body !== undefined && !headers['Transfer-Encoding']) {
            headers['Content-Length']=String(Buffer.byteLength(bodyCase.body));
          }
          cases.push({pathName,method,bodyCase,execute:()=>rawRequest(server,
            {pathName,method,headers,body:bodyCase.body})});
        }
      }
      const responses=[];
      for (let offset=0;offset<cases.length;offset+=24) {
        responses.push(...await Promise.all(cases.slice(offset,offset+24).map(item=>item.execute())));
      }
      let validGetCount=0;
      for (let index=0;index<cases.length;index+=1) {
        const item=cases[index];const response=responses[index];
        const empty=item.bodyCase.body === undefined &&
          !item.bodyCase.headers['Transfer-Encoding'] &&
          (!item.bodyCase.headers['Content-Length'] ||
            item.bodyCase.headers['Content-Length'] === '0');
        const hasQuery=item.pathName.includes('?');
        if (item.method === 'GET' && empty && !hasQuery) {
          expect(response.status).toBe(200);validGetCount += 1;continue;
        }
        expect(response.status).toBe(item.method === 'GET' ? 400 : 405);
        expect(response.headers['cache-control']).toContain('private');
        expect(response.headers['cache-control']).toContain('no-store');
        expect(response.headers.allow).toBeUndefined();
        if (item.method !== 'HEAD') {
          expect(JSON.parse(response.text)).toEqual(item.method === 'GET' ?
            {success:false,error:{category:'CUSTOMER_FINANCIAL_DOWNSTREAM_READERS_INVALID',
              message:'Review the exact current downstream reporting evidence.'}} :
            {success:false,error:{
              category:'CUSTOMER_FINANCIAL_DOWNSTREAM_READERS_METHOD_NOT_ALLOWED',
              message:'Use the exact downstream reporting read boundary.'}});
        }
        expect(response.text).not.toMatch(/secret|victim|acct|123456789|identity|credential/i);
      }
      expect(validGetCount).toBe(6);
      expect(mounted.readFn).toHaveBeenCalledTimes(validGetCount);
      expect(mounted.throttle).toHaveBeenCalledTimes(validGetCount);
    } finally {
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }

    for (const url of [
      '/api/v1/customer-financial/reporting/downstream-readers',
      '/API/V1/CUSTOMER-FINANCIAL/REPORTING/DOWNSTREAM-READERS/',
      '/api/v1/customer-financial/reporting//downstream-readers',
    ]) {
      const req={path:url,header:name=>name === 'Origin' ? 'http://localhost:3000' : undefined};
      await new Promise(resolve=>corsOptions(req,(_error,options)=>{
        expect(options.methods).toEqual(['GET']);expect(options.preflightContinue).toBe(true);
        resolve();
      }));
    }
  });

  test('near misses stay unrelated and static wiring keeps the boundary before parsing',async()=>{
    const mounted=unitApp();
    for (const pathName of [
      '/api//v1/customer-financial/reporting/downstream-readers',
      '/api/v1/customer-financial//reporting/downstream-readers',
      '/api/v1/customer-financial/reporting///downstream-readers',
      '/api/v1/customer-financial/reporting/downstream-readers//',
      '/api/v1/customer-financial/reporting/%64ownstream-readers',
      '/api/v1/customer-financial/reporting/downstream%2Dreaders',
      '/api/v1/customer-financial/reporting%2Fdownstream-readers',
      '/api/v1/customer-financial/reporting/downstream-readers-extra',
    ]) expect((await request(mounted.app).get(pathName)).status).toBe(404);
    expect(mounted.readFn).not.toHaveBeenCalled();expect(mounted.throttle).not.toHaveBeenCalled();
    const server=read('src/server.js');const security=read('src/middleware/security.js');
    expect(server.indexOf('app.use(rejectCustomerFinancialDownstreamReportingBody);'))
      .toBeLessThan(server.indexOf('app.use(express.json({'));
    expect(server).toMatch(/createCustomerFinancialDownstreamReportingRouter/);
    expect(security).toMatch(/isDownstreamReadersPath/);
    expect(security).toMatch(/DOWNSTREAM_READERS_CORS_METHODS/);
    const roadmap=read('docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md');
    expect(roadmap).toMatch(/Exact minimized Mission 25\/26\/33 readers/);
    expect(roadmap).toMatch(/Mission 26 may forecast collections only after it separately accepts source-complete historical evidence and calibration/);
    expect(roadmap).toMatch(/Mission 33 receives platform-level facts only under its own authority and cannot inspect tenant detail/);
  });
});
