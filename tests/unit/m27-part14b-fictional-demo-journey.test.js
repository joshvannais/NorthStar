'use strict';

jest.setTimeout(240000);

const workspace=require('../../src/commandCenter/workspace');
const providerBoundary=require('../../src/customerFinancial/paymentProviderBoundary');
const demoPart12=require('../../src/customerFinancial/demoReportingPart12Acceptance');
const contract=require('../../src/customerFinancial/fictionalDemoJourneyAcceptance');
const repository=require('../../src/customerFinancial/fictionalDemoJourneyAcceptanceRepository');
const httpBoundary=require('../../src/customerFinancial/fictionalDemoJourneyAcceptanceHttpBoundary');
const earlyBoundary=require('../../src/middleware/fictionalDemoJourneyAcceptanceBoundary');
const ui=require('../../public/js/customer-financial-invoice-preview');

const TENANT='11111111-1111-4111-8111-111111111111';
const SESSION='22222222-2222-4222-8222-222222222222';
const clone=value=>JSON.parse(JSON.stringify(value));
let state,item,part12,context,canonical;

beforeAll(()=>{
  state=workspace.createInitialDemoState(TENANT,new Date('2026-10-19T12:00:00Z'),
    {seed:'part14b-fictional-demo-journey'});
  const view=workspace.buildDemoWorkspace({tenantId:TENANT,sessionId:SESSION,state,
    revision:1,simulationCount:0,persisted:true,
    expiresAt:new Date('2026-10-20T12:00:00Z')});
  item=workspace.demoCanonicalItems(view)[0];
  part12=demoPart12.bundle(item,1);
  context={tenantId:TENANT,sessionId:SESSION,estimateId:item.ids.estimate,
    workspaceRevision:1,workspaceGeneration:state.generation,
    workspaceSeedDigest:state.seed,workspaceStateDigest:providerBoundary.digest(state),
    canonicalBaseline:true,currentMutationKeyCount:0,simulationCount:0};
  canonical=contract.bundle(part12,context);
});

describe('Mission 27 Part 14B resettable fictional demo financial journey',()=>{
  test('projects every exact fictional lifecycle stage with offline clearance truth and zero effects',()=>{
    const value=canonical.journeyAcceptance;
    expect(canonical.contractVersion).toBe(contract.ENVELOPE_VERSION);
    expect(value.lifecycle.stages.map(stage=>stage.name)).toEqual(contract.STAGE_ORDER);
    expect(value.lifecycle.stages.map(stage=>stage.state)).toEqual(contract.STAGE_STATES);
    expect(value.launchMatrix).toMatchObject({rolloutStage:'disabled',liveCapabilityEnabled:false,
      partialProviderPaymentsEnabled:false,multiInvoiceProviderPaymentsEnabled:false,
      offlineCashReceiptEnabled:true,offlineCheckReceiptEnabled:true,
      checkClearedTransitionEnabled:false,
      checkClearanceState:'check_clearance_authority_unavailable'});
    expect(value.reset).toMatchObject({canonicalBaseline:true,currentMutationKeyCount:0,
      currentSimulationCount:0,resetRestoresCanonicalBaseline:true,
      resetRemovesUserCreatedDemoMutations:true,resetMayReadOrMutatePaidData:false});
    for(const key of ['providerCallCount','providerMutationCount','receiverMutationCount',
      'outboundMessageCount','accountingMutationCount','downstreamMutationCount',
      'paidRepositoryReadCount','productionDatabaseMutationCount','liveMoneyMovementCount']) {
      expect(value[key]).toBe(0);
    }
    expect(JSON.stringify(value)).not.toMatch(/sk_live|sk_test|acct_|customer@example|11111111-1111/i);
  });

  test('rejects semantic drift and malformed nonplain inputs before accepting the envelope',()=>{
    const forged=clone(canonical);
    forged.journeyAcceptance.lifecycle.stages[14].state='check_cleared';
    expect(()=>contract.project(forged,part12,context)).toThrow(
      'Fictional demo financial journey acceptance invalid');
    let getterCalls=0;
    const accessor={};Object.defineProperty(accessor,'contractVersion',{
      enumerable:true,get(){getterCalls+=1;return contract.ENVELOPE_VERSION;}});
    expect(()=>contract.project(accessor,part12,context)).toThrow();
    expect(getterCalls).toBe(0);
    const proxied=new Proxy(clone(canonical),{get(){throw new Error('proxy trap invoked');}});
    expect(()=>contract.project(proxied,part12,context)).toThrow(
      'Fictional demo financial journey acceptance invalid');
  });

  test('browser accepts the canonical complete contract and rejects reordered, leaked or contradictory values',async()=>{
    expect(await ui.invalidPart14B(clone(canonical.journeyAcceptance),part12,1)).toBe(false);
    const mutations=[
      value=>value.lifecycle.stages.reverse(),
      value=>{value.lifecycle.stages[14].state='check_cleared';},
      value=>{value.isolation.paidRepositoryReadAllowed=true;},
      value=>{value.providerCallCount=1;},
      value=>{value.providerAccountId='acct_forged';},
      value=>{value.sourceWitness.digest='f'.repeat(64);},
      value=>{delete value.reset.canonicalBaseline;},
    ];
    for(const mutate of mutations){const value=clone(canonical.journeyAcceptance);mutate(value);
      expect(await ui.invalidPart14B(value,part12,1)).toBe(true);}
  });

  test('browser recursively rejects every poisoned Part14B node without reading accessors',async()=>{
    const mutations=[
      value=>{value.sourceWitness.extra='sk_secret';},
      value=>{value.journeyBinding.tenantScopeDigest='acct_forged';},
      value=>{value.launchMatrix.providerMethod='bank';},
      value=>{value.lifecycle.extra={recipientEmail:'victim@example.com'};},
      value=>{value.lifecycle.stages[8].sourceReason='customer@example.com';},
      value=>{value.reset.endpoint='/api/v1/private';},
      value=>{value.isolation.credentialOrSecretAllowed=true;},
      value=>{value.acceptance.productionJourneyAccepted=true;},
      value=>{value.providerAccountId='acct_forged';},
      value=>{Object.defineProperty(value.lifecycle.stages[0],'toJSON',{
        value(){return {};},enumerable:false});},
      value=>{Object.setPrototypeOf(value.reset,{credential:'sk_proto'});},
      value=>{value.lifecycle.stages[0][Symbol('credential')]='sk_symbol';},
    ];
    for(const mutate of mutations){const value=clone(canonical.journeyAcceptance);mutate(value);
      expect(await ui.invalidPart14B(value,part12,1)).toBe(true);}
    let getterCalls=0;
    const accessor=clone(canonical.journeyAcceptance);
    Object.defineProperty(accessor.sourceWitness,'digest',{enumerable:true,configurable:true,
      get(){getterCalls+=1;return canonical.journeyAcceptance.sourceWitness.digest;}});
    expect(await ui.invalidPart14B(accessor,part12,1)).toBe(true);
    expect(getterCalls).toBe(0);
  });

  test('exports one immutable production operation and no constructible Part14B authority',async()=>{
    expect(Object.getPrototypeOf(repository)).toBeNull();
    expect(Object.isFrozen(repository)).toBe(true);
    expect(Reflect.ownKeys(repository)).toEqual([]);
    for(const alias of ['read','recordContext','serializeResponse','bundle','project','load',
      'withCurrentReadAuthority','token','transaction']) expect(repository[alias]).toBeUndefined();
    const modulePath=require.resolve('../../src/commandCenter/demoRepository');
    const api=require(modulePath);
    const {DemoCommandCenterRepository,deliverFictionalDemoJourney}=api;
    expect(Object.getPrototypeOf(api)).toBeNull();expect(Object.isFrozen(api)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(api,'deliverFictionalDemoJourney')).toMatchObject({
      value:deliverFictionalDemoJourney,enumerable:true,writable:false,configurable:false});
    expect(DemoCommandCenterRepository.prototype.withCurrentReadAuthority).toBeUndefined();
    expect(DemoCommandCenterRepository.prototype.deliverFictionalDemoJourney).toBeUndefined();
    let poolReads=0;
    class Derived extends DemoCommandCenterRepository {}
    for(const value of [new DemoCommandCenterRepository(),
      new DemoCommandCenterRepository(()=>{poolReads+=1;return {};}),new Derived(),
      Object.create(DemoCommandCenterRepository.prototype),
      new Proxy(new DemoCommandCenterRepository(()=>{poolReads+=1;return {};}),{})]) {
      expect(value.deliverFictionalDemoJourney).toBeUndefined();
      expect(value.withCurrentReadAuthority).toBeUndefined();
    }
    expect(poolReads).toBe(0);
    expect(()=>{api.deliverFictionalDemoJourney=()=>{};}).toThrow();
    expect(()=>delete api.deliverFictionalDemoJourney).toThrow();
    expect(()=>Object.defineProperty(api,'deliverFictionalDemoJourney',{value:()=>{}})).toThrow();
    expect(()=>Object.setPrototypeOf(api,{})).toThrow();
    const moduleRecord=require.cache[modulePath];
    expect(Object.getOwnPropertyDescriptor(moduleRecord,'exports')).toMatchObject({
      value:api,writable:false,configurable:false});
    expect(()=>{moduleRecord.exports={};}).toThrow();
    expect(()=>Object.defineProperty(moduleRecord,'exports',{value:{}})).toThrow();
    const injected=new DemoCommandCenterRepository(()=>{poolReads+=1;return {};});
    Object.defineProperty(injected,'deliverFictionalDemoJourney',{
      value:deliverFictionalDemoJourney,writable:true,configurable:true});
    await expect(injected.deliverFictionalDemoJourney({method:'POST'},{}))
      .rejects.toMatchObject({status:503,code:'DEMO_COMMAND_CENTER_UNAVAILABLE'});
    await expect(deliverFictionalDemoJourney.call(injected,{method:'POST'},{}))
      .rejects.toMatchObject({status:503,code:'DEMO_COMMAND_CENTER_UNAVAILABLE'});
    await expect(deliverFictionalDemoJourney.bind(injected)({method:'POST'},{}))
      .rejects.toMatchObject({status:503,code:'DEMO_COMMAND_CENTER_UNAVAILABLE'});
    expect(poolReads).toBe(0);
  });

  test('browser data-only gate rejects poison in every embedded part before invoking accessors',async()=>{
    expect(ui.copyFictionalDemoEnvelope(clone(canonical))).toEqual(canonical);
    const paths=[
      ['part12Bundle','preview'],['part12Bundle','part5Acceptance'],
      ['part12Bundle','part6Acceptance'],['part12Bundle','part7Acceptance'],
      ['part12Bundle','part9Acceptance'],['part12Bundle','part10Acceptance'],
      ['part12Bundle','part11SourceContracts'],['part12Bundle','part11Acceptance'],
      ['part12Bundle','part12Acceptance'],['journeyAcceptance'],
    ];
    for(const path of paths){
      const value=clone(canonical);let target=value;
      for(const key of path) target=target[key];
      if(Array.isArray(target)) target=target[0];
      let getterCalls=0;
      Object.defineProperty(target,'contractVersion',{enumerable:true,configurable:true,
        get(){getterCalls+=1;return 'forged';}});
      expect(ui.copyFictionalDemoEnvelope(value)).toBeNull();
      expect(getterCalls).toBe(0);
    }
    let proxyCalls=0;
    const proxied=new Proxy(clone(canonical),{
      getPrototypeOf(){proxyCalls+=1;return Object.prototype;},
      ownKeys(){proxyCalls+=1;return [];},
      getOwnPropertyDescriptor(){proxyCalls+=1;return undefined;},
      get(){proxyCalls+=1;return undefined;},
    });
    expect(ui.copyFictionalDemoEnvelope(proxied)).toBeNull();
    expect(proxyCalls).toBe(0);
    for(const mutate of [
      value=>{value.part12Bundle.preview.providerAccountId='acct_forged';},
      value=>{value.part12Bundle.part5Acceptance.secret='sk_secret';},
      value=>{value.part12Bundle.part6Acceptance.recipientEmail='victim@example.com';},
      value=>{value.part12Bundle.part7Acceptance.customerToken='tok_private';},
      value=>{value.part12Bundle.part9Acceptance.paymentCard='4242424242424242';},
      value=>{value.part12Bundle.part10Acceptance.customerAddress='private';},
      value=>{value.part12Bundle.part11Acceptance.accountingCredential='private';},
      value=>{value.part12Bundle.part12Acceptance.privateTenantId=TENANT;},
    ]) { const value=clone(canonical);mutate(value);
      expect(await ui.projectPart14B(value.journeyAcceptance,value.part12Bundle,1)).toBeNull(); }
  });

  test('pre-parser boundary covers every Express parameter shape before session or source entry',()=>{
    const base='/api/demo/customer-financial/invoice-drafts/';
    const suffix='/part14b-acceptance';
    for(const segment of [item.ids.estimate,item.ids.estimate.toUpperCase(),'not-a-uuid','.'.repeat(2),
      'x'.repeat(4096),'caf%C3%A9','%2F','%252F','%E0%A4%A','..','\\paid-id']) {
      expect(httpBoundary.isFictionalDemoJourneyAcceptancePath(base+segment+suffix)).toBe(true);
    }
    for(const near of [base+suffix,base+'/'+suffix,base+item.ids.estimate+'//part14b-acceptance',
      '/api/demo/customer-financial/invoice-drafts/'+item.ids.estimate+'/part14b-acceptance/extra']) {
      expect(httpBoundary.isFictionalDemoJourneyAcceptancePath(near)).toBe(false);
    }
    function invoke(overrides={}) {
      const headers={};let status=null,body=null,next=0;
      const req={path:base+'not-a-uuid'+suffix,method:'GET',originalUrl:base+'not-a-uuid'+suffix,
        rawHeaders:[],headers:{},...overrides};
      const res={set(name,value){headers[name.toLowerCase()]=value;return this;},
        vary(value){headers.vary=value;return this;},removeHeader(name){delete headers[name.toLowerCase()];},
        status(value){status=value;return this;},json(value){body=value;return this;}};
      earlyBoundary.fictionalDemoJourneyAcceptanceBoundary(req,res,()=>{next+=1;});
      return {headers,status,body,next};
    }
    for(const testCase of [
      {},
      {path:base+item.ids.estimate+suffix,originalUrl:base+item.ids.estimate+suffix+'?secret=x'},
      {path:base+item.ids.estimate+suffix,originalUrl:base+item.ids.estimate+suffix,
        rawHeaders:['Content-Type','application/json'],headers:{'content-type':'application/json'}},
      {path:base+item.ids.estimate+suffix,originalUrl:base+item.ids.estimate+suffix,
        rawHeaders:['Content-Length','12'],headers:{'content-length':'12'}},
    ]) {
      const result=invoke(testCase);expect(result.status).toBe(400);expect(result.next).toBe(0);
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.headers['x-request-id']).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toMatch(/secret|not-a-uuid|4096/);
    }
    const method=invoke({method:'OPTIONS'});expect(method.status).toBe(405);
    expect(method.headers.allow).toBe('GET');expect(method.next).toBe(0);
  });
});
