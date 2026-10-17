'use strict';

jest.setTimeout(300000);

const cors=require('cors');
const express=require('express');
const request=require('supertest');
const workspace=require('../../src/commandCenter/workspace');
const contract=require('../../src/customerFinancial/reportingPart12Acceptance');
const repository=require('../../src/customerFinancial/reportingPart12AcceptanceRepository');
const providerBoundary=require('../../src/customerFinancial/paymentProviderBoundary');
const demo=require('../../src/customerFinancial/demoReportingPart12Acceptance');
const ui=require('../../public/js/customer-financial-invoice-preview');
const {corsOptions}=require('../../src/middleware/security');
const {reportingPart12AcceptanceBoundary}=
  require('../../src/middleware/reportingPart12AcceptanceBoundary');
const {createCustomerFinancialEditableEstimateRouter}=
  require('../../src/routes/customerFinancialEditableEstimate');

const ESTIMATE='11111111-1111-4111-8111-111111111111';
const RECEIPT='22222222-2222-4222-8222-222222222222';
const DIGEST='a'.repeat(64);
const TENANT='44444444-4444-4444-8444-444444444444';
const USER='55555555-5555-4555-8555-555555555555';
const SESSION='66666666-6666-4666-8666-666666666666';
const clone=value=>JSON.parse(JSON.stringify(value));
let canonical;

beforeAll(()=>{
  const state=workspace.createInitialDemoState(TENANT,new Date('2026-10-15T12:00:00Z'),
    {seed:'part12d-reporting-acceptance'});
  const view=workspace.buildDemoWorkspace({tenantId:TENANT,sessionId:ESTIMATE,state,
    revision:1,simulationCount:0,persisted:true,
    expiresAt:new Date('2026-10-16T12:00:00Z')});
  canonical=demo.bundle(workspace.demoCanonicalItems(view)[0],1);
});

function mutateLeaf(target,path) {
  let parent=target;
  for (let index=0;index<path.length-1;index+=1) parent=parent[path[index]];
  const key=path.at(-1); const value=parent[key];
  if (typeof value==='boolean') parent[key]=!value;
  else if (typeof value==='number') parent[key]=value+1;
  else if (typeof value==='string') parent[key]=`${value}__forged`;
  else if (value===null) parent[key]='__forged_null__';
  else throw new Error(`Unsupported leaf ${path.join('.')}`);
}

function semanticLeafPaths(value) {
  const paths=[];
  const dynamic=new Set(['mode','fictional','previewWitness.mode','previewWitness.draftRevision',
    'previewWitness.draftDigest','previewWitness.previewDigest','part11Witness.digest']);
  function visit(current,path) {
    if (current&&typeof current==='object') {
      if (Array.isArray(current)) current.forEach((entry,index)=>visit(entry,[...path,index]));
      else Object.keys(current).forEach(key=>visit(current[key],[...path,key]));
      return;
    }
    if (!dynamic.has(path.join('.'))) paths.push(path);
  }
  visit(value,[]); return paths;
}

function canonicalPart11() {
  return {contractVersion:'m27-accounting-part11-preview-bundle-v1',
    preview:canonical.preview,part5Acceptance:canonical.part5Acceptance,
    part6Acceptance:canonical.part6Acceptance,part7Acceptance:canonical.part7Acceptance,
    part9Acceptance:canonical.part9Acceptance,part10Acceptance:canonical.part10Acceptance,
    part11SourceContracts:canonical.part11SourceContracts,
    part11Acceptance:canonical.part11Acceptance};
}

function app(read) {
  const application=express();
  application.use(reportingPart12AcceptanceBoundary);
  application.use(cors(corsOptions));
  application.use(express.json({verify(req,_res,buffer){req.rawBody=buffer.toString();}}));
  const auth=(req,_res,next)=>{req.tenantContext={organizationId:TENANT,userId:USER};
    req.authSession={id:SESSION};req.userRole='owner';next();};
  const role=(_req,_res,next)=>next();
  const throttle=(_req,_res,next)=>next();
  application.use('/api/v1/customer-financial/editable-estimates',
    createCustomerFinancialEditableEstimateRouter({auth,role,throttle,
      poolProvider:()=>({}),reportingPart12AcceptanceRead:read}));
  return application;
}

describe('Mission 27 Part 12D whole Part 12 acceptance',()=>{
  test('rereads and reprojects every complete source snapshot on every request',async()=>{
    const preview={contractVersion:'preview',revision:1,digest:'b'.repeat(64)};
    const part11={preview,part11Acceptance:{previewWitness:{draftRevision:1}}};
    const sources={part11,invoiceReceivableReporting:{state:'unavailable'},
      paymentCashReporting:{state:'unavailable'},downstreamReportingReaders:{state:'unavailable'}};
    const result={contractVersion:'m27-reporting-part12-preview-bundle-v1'};
    const derive=jest.spyOn(contract,'derive').mockReturnValue(sources);
    const unavailable=jest.spyOn(contract,'unavailable').mockReturnValue({state:'incomplete'});
    const bundle=jest.spyOn(contract,'bundle').mockReturnValue(result);
    const readPart11=jest.fn().mockResolvedValue(part11);
    const readSources=jest.fn().mockResolvedValue(sources);
    const readPreview=jest.fn().mockResolvedValue(preview);
    const source={organizationId:TENANT,actorUserId:USER,authSessionId:SESSION,
      actorAccessRole:'owner'};
    try {
      expect(await repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,
        {readPart11,readSources,readPreview})).toBe(result);
      expect(await repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,
        {readPart11,readSources,readPreview})).toBe(result);
      expect(readPart11).toHaveBeenCalledTimes(2);
      expect(readSources).toHaveBeenCalledTimes(4);
      expect(readPreview).toHaveBeenCalledTimes(4);
      expect(derive).toHaveBeenCalledTimes(4);
      expect(bundle).toHaveBeenCalledTimes(2);
    } finally {
      derive.mockRestore();unavailable.mockRestore();bundle.mockRestore();
    }
  });

  test.each([
    ['Part 11 semantic',(value,version)=>{value.part11.semantic=version;}],
    ['Part 11 source',(value,version)=>{value.part11.sources=[{state:version}];}],
    ['Part 11 digest',(value,version)=>{value.part11.digest=
      (version==='source-v1'?'a':'b').repeat(64);} ],
    ['Part 11 currentness',(value,version)=>{value.preview={contractVersion:'preview',
      revision:version==='source-v1'?1:2,digest:(version==='source-v1'?'b':'c').repeat(64)};
      value.part11.preview=value.preview;}],
    ['Part 12A semantic',(value,version)=>{value.invoiceReceivableReporting.reason=version;}],
    ['Part 12A source',(value,version)=>{value.invoiceReceivableReporting.sourceState=version;}],
    ['Part 12A digest',(value,version)=>{value.invoiceReceivableReporting.digest=
      (version==='source-v1'?'a':'b').repeat(64);} ],
    ['Part 12A currentness',(value,version)=>{
      value.invoiceReceivableReporting.currentnessWitness=version;}],
    ['Part 12B semantic',(value,version)=>{value.paymentCashReporting.reason=version;}],
    ['Part 12B source',(value,version)=>{value.paymentCashReporting.sourceState=version;}],
    ['Part 12B digest',(value,version)=>{value.paymentCashReporting.digest=
      (version==='source-v1'?'a':'b').repeat(64);} ],
    ['Part 12B currentness',(value,version)=>{
      value.paymentCashReporting.currentnessWitness=version;}],
    ['Part 12C semantic',(value,version)=>{value.downstreamReportingReaders.reason=version;}],
    ['Part 12C source',(value,version)=>{value.downstreamReportingReaders.sourceState=version;}],
    ['Part 12C digest',(value,version)=>{value.downstreamReportingReaders.digest=
      (version==='source-v1'?'a':'b').repeat(64);} ],
    ['Part 12C currentness',(value,version)=>{
      value.downstreamReportingReaders.currentnessWitness=version;}],
  ])('warm second request returns the exact corrected %s snapshot instead of stale state',
    async(_name,correct)=>{
      const preview={contractVersion:'preview',revision:1,digest:'b'.repeat(64)};
      const make=(version)=>{const value={preview:clone(preview),part11:{preview:clone(preview)},
        invoiceReceivableReporting:{reason:'unavailable'},
        paymentCashReporting:{reason:'unavailable'},
        downstreamReportingReaders:{reason:'unavailable'}};correct(value,version);return value;};
      const first=make('source-v1'); const second=make('source-v2');
      const part11Reads=[first.part11,second.part11];
      const sourceReads=[first,first,second,second];
      const readPart11=jest.fn().mockImplementation(async()=>part11Reads.shift());
      const readSources=jest.fn().mockImplementation(async()=>sourceReads.shift());
      const previews=[first.preview,first.preview,second.preview,second.preview];
      const readPreview=jest.fn().mockImplementation(async()=>previews.shift());
      const derive=jest.spyOn(contract,'derive').mockImplementation((part11,sources)=>
        ({...sources,part11}));
      const unavailable=jest.spyOn(contract,'unavailable').mockReturnValue({state:'incomplete'});
      const bundle=jest.spyOn(contract,'bundle').mockImplementation((part11,_acceptance,sources)=>
        ({snapshotDigest:providerBoundary.digest({part11,sources})}));
      const source={organizationId:TENANT,actorUserId:USER,authSessionId:SESSION,
        actorAccessRole:'owner'};
      try {
        const v1=await repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,
          {readPart11,readSources,readPreview});
        const v2=await repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,
          {readPart11,readSources,readPreview});
        expect(v2.snapshotDigest).not.toBe(v1.snapshotDigest);
        expect(v2.snapshotDigest).toBe(providerBoundary.digest({part11:second.part11,
          sources:{...second,part11:second.part11}}));
        expect(readPart11).toHaveBeenCalledTimes(2);
        expect(readSources).toHaveBeenCalledTimes(4);
      } finally {
        derive.mockRestore();unavailable.mockRestore();bundle.mockRestore();
      }
    });

  test.each([
    ['Part 12A source correction',value=>{value.invoiceReceivableReporting.reason='corrected';}],
    ['Part 12B digest-bearing correction',value=>{value.paymentCashReporting.digest='f'.repeat(64);}],
    ['Part 12C reader reorder',value=>{value.downstreamReportingReaders.readers.reverse();}],
    ['renamed source',value=>{value.invoiceReceivableReporting.contractVersion='renamed';}],
    ['missing source',value=>{delete value.paymentCashReporting;}],
    ['joint forgery',value=>{value.downstreamReportingReaders.reason='forged';
      value.downstreamReportingReaders.digest=providerBoundary.digest(value.downstreamReportingReaders);}],
  ])('rejects mixed before/after %s and never emits a bundle',async(_name,mutate)=>{
    const preview={contractVersion:'preview',revision:1,digest:'b'.repeat(64)};
    const base={part11:{preview},invoiceReceivableReporting:{reason:'unavailable'},
      paymentCashReporting:{reason:'unavailable'},
      downstreamReportingReaders:{reason:'unavailable',readers:[1,2,3]}};
    const changed=clone(base); mutate(changed);
    const readPart11=jest.fn().mockResolvedValue(base.part11);
    const readSources=jest.fn()
      .mockResolvedValueOnce(base).mockResolvedValueOnce(changed);
    const readPreview=jest.fn().mockResolvedValue(preview);
    const derive=jest.spyOn(contract,'derive').mockImplementation((part11,sources)=>
      ({...sources,part11}));
    const bundle=jest.spyOn(contract,'bundle');
    const source={organizationId:TENANT,actorUserId:USER,authSessionId:SESSION,
      actorAccessRole:'owner'};
    try {
      await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,
        {readPart11,readSources,readPreview})).rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_REPORTING_PART12_CHANGED',status:409});
      expect(bundle).not.toHaveBeenCalled();
      expect(readPart11).toHaveBeenCalledTimes(1);
      expect(readSources).toHaveBeenCalledTimes(2);
    } finally { derive.mockRestore();bundle.mockRestore(); }
  });

  test('keeps concurrent cross-tenant requests isolated without reusable request state',async()=>{
    const preview={contractVersion:'preview',revision:1,digest:'b'.repeat(64)};
    const sourceA={organizationId:TENANT,actorUserId:USER,authSessionId:SESSION,
      actorAccessRole:'owner'};
    const sourceB={...sourceA,organizationId:'77777777-7777-4777-8777-777777777777'};
    const readPart11=jest.fn(async(_pool,source)=>({preview,tenant:source.organizationId}));
    const readSources=jest.fn(async source=>({tenant:source.organizationId,
      invoiceReceivableReporting:{},paymentCashReporting:{},downstreamReportingReaders:{}}));
    const readPreview=jest.fn().mockResolvedValue(preview);
    const derive=jest.spyOn(contract,'derive').mockImplementation((part11,sources)=>
      ({...sources,part11}));
    const unavailable=jest.spyOn(contract,'unavailable').mockReturnValue({state:'incomplete'});
    const bundle=jest.spyOn(contract,'bundle').mockImplementation((part11,_acceptance,sources)=>
      ({part11Tenant:part11.tenant,sourceTenant:sources.tenant}));
    try {
      const [a,b]=await Promise.all([
        repository.readBundle({},sourceA,ESTIMATE,RECEIPT,DIGEST,
          {readPart11,readSources,readPreview}),
        repository.readBundle({},sourceB,ESTIMATE,RECEIPT,DIGEST,
          {readPart11,readSources,readPreview}),
      ]);
      expect(a).toEqual({part11Tenant:TENANT,sourceTenant:TENANT});
      expect(b).toEqual({part11Tenant:sourceB.organizationId,sourceTenant:sourceB.organizationId});
      expect(readPart11).toHaveBeenCalledTimes(2);
      expect(readSources).toHaveBeenCalledTimes(4);
    } finally {
      derive.mockRestore();unavailable.mockRestore();bundle.mockRestore();
    }
  });

  test('exports no trust grant and strictly rejects forged, cloned, wrapped, replayed or mutated Part 11 values',()=>{
    expect(Object.keys(contract).filter(key=>/trust|mark|server.*bundle/i.test(key))).toEqual([]);
    const valid=clone(canonicalPart11());
    expect(()=>contract.derive(valid)).not.toThrow();
    const attempts=[
      ()=>{const value=clone(canonicalPart11());value.part11Acceptance.accountingMutationCount=1;
        return value;},
      ()=>({value:clone(canonicalPart11())}),
      ()=>Object.assign(Object.create(clone(canonicalPart11())),
        {part11Acceptance:{...clone(canonical.part11Acceptance),accountingMutationCount:1}}),
      ()=>{const value=clone(canonicalPart11());value.preview.draftRevision+=1;return value;},
      ()=>{const value=clone(canonicalPart11());
        value.part11SourceContracts.part11A.exportRecordCount=1;
        value.part11Acceptance.sourceParts[0].digest=
          providerBoundary.digest(value.part11SourceContracts.part11A);return value;},
    ];
    for (const attempt of attempts) expect(()=>contract.derive(attempt())).toThrow();
    valid.part11Acceptance.accountingMutationCount=1;
    expect(()=>contract.derive(valid)).toThrow();
  });

  test('freezes complete source, surface, drilldown, privacy and no-effect truth',async()=>{
    expect(canonical.contractVersion).toBe('m27-reporting-part12-preview-bundle-v1');
    expect(canonical.part12Acceptance).toMatchObject({
      contractVersion:'m27-reporting-part12-acceptance-v1',state:'incomplete',
      reason:'part12_reporting_evidence_incomplete',mode:'demo',fictional:true,
      sourceOrder:['12A','12B','12C'],surfaceOrder:['command_center','customer_finance'],
      drilldownOrder:['invoice_receivables','payment_cash','downstream_readers'],
      reportingContract:{completeCoverageRequired:true,
        missingUnknownOrUnavailableMayBecomeZero:false,browserDerivedValuesAllowed:false,
        legacyZeroFallbackAllowed:false},
      downstreamBoundary:{mission25ExactAcceptedObservationsOnly:true,
        mission26SourceCompleteHistoryAndAcceptedCalibrationRequired:true,
        mission26ForecastAvailable:false,mission33PlatformFactsOnly:true,
        mission33MayInspectTenantDetail:false,crossTenantTrainingAllowed:false},
      acceptance:{wholePart12FunctionalBoundaryPresent:true,paidDemoIsolationAccepted:true,
        legacyZeroFallbackRemoved:true,independentWholeHeadAuditAccepted:false,
        productionPerformanceSlaAccepted:false,firstPayingCustomerLiveMoneyValidated:false,
        founderVisualApprovalAccepted:false},
      reportRowCount:0,drilldownRowCount:0,browserDerivedValueCount:0,
      legacyZeroFallbackCount:0,providerCallCount:0,receiverMutationCount:0,
      accountingMutationCount:0,liveMoneyMovementCount:0,
    });
    expect(await ui.invalidPart12(canonical.part12Acceptance,'demo')).toBe(false);
    expect(await ui.samePart12Witness(canonical.preview,canonical.part12Acceptance,
      canonical.part11Acceptance)).toBe(true);
  });

  test('table-driven server and client matrices reject every contradictory semantic leaf',async()=>{
    const sources=contract.derive({contractVersion:'m27-accounting-part11-preview-bundle-v1',
      preview:canonical.preview,part5Acceptance:canonical.part5Acceptance,
      part6Acceptance:canonical.part6Acceptance,part7Acceptance:canonical.part7Acceptance,
      part9Acceptance:canonical.part9Acceptance,part10Acceptance:canonical.part10Acceptance,
      part11SourceContracts:canonical.part11SourceContracts,
      part11Acceptance:canonical.part11Acceptance});
    const paths=semanticLeafPaths(canonical.part12Acceptance);
    expect(paths.length).toBeGreaterThan(100);
    for (const path of paths) {
      const forged=clone(canonical.part12Acceptance); mutateLeaf(forged,path);
      expect(()=>contract.project(forged,'demo',sources.part11,sources)).toThrow(
        'Reporting Part 12 acceptance invalid');
      expect(await ui.invalidPart12(forged,'demo')).toBe(true);
    }
    const structural=[
      value=>value.sourceWitnesses.reverse(),value=>value.surfaces.reverse(),
      value=>value.drilldowns.reverse(),value=>value.sourceWitnesses.pop(),
      value=>{value.providerAccountId='acct_secret';},
    ];
    for (const mutate of structural) {
      const forged=clone(canonical.part12Acceptance); mutate(forged);
      expect(()=>contract.project(forged,'demo',sources.part11,sources)).toThrow();
      expect(await ui.invalidPart12(forged,'demo')).toBe(true);
    }
  });

  test('binds Part 12 to the exact Part 11 witness and exact immutable source digests',async()=>{
    for (const forge of [
      value=>{value.sourceWitnesses[0].digest='e'.repeat(64);},
      value=>{value.sourceWitnesses[1].part='12C';},
      value=>{value.sourceWitnesses[2].state='current';},
    ]) {
      const changed=clone(canonical.part12Acceptance); forge(changed);
      expect(await ui.invalidPart12(changed,'demo')).toBe(true);
    }
    const wrongDigest=clone(canonical.part12Acceptance);
    wrongDigest.part11Witness.digest='f'.repeat(64);
    expect(await ui.invalidPart12(wrongDigest,'demo')).toBe(false);
    expect(await ui.samePart12Witness(canonical.preview,wrongDigest,
      canonical.part11Acceptance)).toBe(false);
    const wrongPart11=clone(canonical.part11Acceptance);
    wrongPart11.accountingMutationCount=1;
    expect(await ui.samePart12Witness(canonical.preview,canonical.part12Acceptance,
      wrongPart11)).toBe(false);
  });

  test.each([
    ['POST',undefined],['PUT','secret-account-amount'],['PATCH','{"secret":"value"}'],
    ['DELETE',Buffer.from([1,2,3])],['HEAD',undefined],['OPTIONS','malformed{'],
  ])('rejects %s before parser, auth, throttle or repository with fixed private denial',
    async(method,body)=>{
      let reads=0; const server=app(async()=>{reads+=1;return canonical;});
      let call=request(server)[method.toLowerCase()](
        `/api/v1/customer-financial/editable-estimates/${ESTIMATE}/reporting-part12-acceptance`)
        .set('Origin','https://northstar-os.ai');
      if (body!==undefined) call=call.set('Content-Type','application/json').send(body);
      const response=await call;
      expect(response.status).toBe(405);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers.allow).toBe('GET');
      expect(response.headers['access-control-allow-methods']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/secret|account|amount|value/i);
      expect(reads).toBe(0);
    });

  test.each([
    ['application/json','{"secret":"value"}'],['application/json','"secret-value"'],
    ['application/json','null'],['application/json','malformed{'],
    ['text/plain','tenant-account-amount'],['application/octet-stream',Buffer.from([0,1,2])],
  ])('rejects body-bearing GET %s before global parsing without reflection',async(type,body)=>{
    let reads=0; const server=app(async()=>{reads+=1;return canonical;});
    const response=await request(server)
      .get(`/API/V1/CUSTOMER-FINANCIAL/EDITABLE-ESTIMATES/${ESTIMATE}/REPORTING-PART12-ACCEPTANCE/?handoffReceiptId=${RECEIPT}&handoffReceiptDigest=${DIGEST}`)
      .set('Content-Type',type).send(body);
    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/secret|tenant-account|malformed/i);
    expect(reads).toBe(0);
  });

  test('accepts only the exact empty-body GET query and reaches the repository once',async()=>{
    let reads=0; const server=app(async()=>{reads+=1;return canonical;});
    const response=await request(server)
      .get(`/api/v1/customer-financial/editable-estimates/${ESTIMATE}/reporting-part12-acceptance`)
      .query({handoffReceiptId:RECEIPT,handoffReceiptDigest:DIGEST})
      .set('Content-Length','0');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data.contractVersion).toBe('m27-reporting-part12-preview-bundle-v1');
    expect(reads).toBe(1);
  });
});
