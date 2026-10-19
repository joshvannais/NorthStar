'use strict';

jest.setTimeout(240000);

const workspace=require('../../src/commandCenter/workspace');
const providerBoundary=require('../../src/customerFinancial/paymentProviderBoundary');
const demoPart12=require('../../src/customerFinancial/demoReportingPart12Acceptance');
const contract=require('../../src/customerFinancial/fictionalDemoJourneyAcceptance');
const repository=require('../../src/customerFinancial/fictionalDemoJourneyAcceptanceRepository');
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
    expect(await ui.invalidPart14B(canonical.journeyAcceptance,part12,1)).toBe(false);
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

  test('repository rereads exact source and fails closed on drift, cross-record and demo mutation state',async()=>{
    const record={tenantId:TENANT,sessionId:SESSION,state:{...state,userCreatedMutation:{value:true}},
      revision:2,simulationCount:1,persisted:true,expiresAt:new Date('2026-10-20T12:00:00Z')};
    const current={contractVersion:'source',value:'current'};
    const changed={contractVersion:'source',value:'changed'};
    const bundleSpy=jest.spyOn(contract,'bundle').mockImplementation((source,ctx)=>({source,ctx}));
    const projectSpy=jest.spyOn(contract,'project').mockImplementation((raw,source,ctx)=>{
      if(providerBoundary.digest(raw.source)!==providerBoundary.digest(source)) throw new Error('changed');
      return {raw,ctx};
    });
    try{
      const readBundle=jest.fn().mockResolvedValue(current);
      const value=await repository.read(record,item.ids.estimate,{readBundle});
      expect(readBundle).toHaveBeenCalledTimes(2);
      expect(value.ctx).toMatchObject({tenantId:TENANT,sessionId:SESSION,workspaceRevision:2,
        canonicalBaseline:false,currentMutationKeyCount:1,simulationCount:1});
      const drifting=jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(changed);
      await expect(repository.read(record,item.ids.estimate,{readBundle:drifting}))
        .rejects.toMatchObject({code:'DEMO_FINANCIAL_JOURNEY_CHANGED',status:409});
      await expect(repository.read(record,'33333333-3333-4333-8333-333333333333',{readBundle}))
        .rejects.toMatchObject({code:'DEMO_FINANCIAL_JOURNEY_UNAVAILABLE',status:404});
    } finally {bundleSpy.mockRestore();projectSpy.mockRestore();}
  });
});