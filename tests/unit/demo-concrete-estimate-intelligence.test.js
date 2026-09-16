'use strict';

const crypto=require('crypto');
const {createInitialDemoState,buildSimulatedGraph}=require('../../src/commandCenter/workspace');
const {DEFAULT_SELECTION}=require('../../src/commandCenter/scenarioSpace');
const {repairKnownConcreteBusinessProfile,repairKnownConcreteCostExample}=require('../../src/commandCenter/demoRepository');
const {sha256}=require('../../src/services/businessProfileAdapter');

const tenantId='11111111-1111-4111-8111-111111111111';
const at='2026-09-15T14:00:00Z';
const seed=value=>crypto.createHash('sha256').update(value).digest('hex');

function initialWithConcrete() {
  for(let index=0;index<100;index+=1){
    const state=createInitialDemoState(tenantId,at,{seed:seed('concrete-'+index)});
    if(state.graphs.some(graph=>graph.lead.serviceType==='concrete'))return state;
  }
  throw new Error('The deterministic test seeds did not create a concrete example.');
}

test('720 square-foot concrete pricing derives volume, materials and profit from the simulated business profile',()=>{
  const state=initialWithConcrete(),graph=state.graphs.find(item=>item.lead.serviceType==='concrete'),value=graph.polaris.snapshot;
  expect(value.service.scope.squareFeet).toBe(720);
  expect(value.service.scope.slabThicknessInches).toBe(4);
  expect(value.service.scope.wastePercent).toBe(10);
  expect(value.service.scope.concreteOrderCubicYards).toBe(9.78);
  expect(value.pricingLineItems.find(line=>line.code==='profile-concrete-ready-mix')).toMatchObject({category:'materials',customerCharge:1830.82});
  expect(value.materialsCharge).toBe(3170.02);
  expect(value.knownDirectMaterialCost).toBe(2966.68);
  expect(value.knownDirectCosts).toBeGreaterThan(6500);
  expect(value.netMarginPercent).toBeGreaterThan(25);
  expect(value.netMarginPercent).toBeLessThan(40);
  expect(graph.polaris.syntheticCalculation.details.researchBasis.sources).toHaveLength(2);
  expect(JSON.stringify(value)).not.toMatch(/Illustrative material charge|fictional-materials/);
});

test('concrete scenarios scale with recorded area and omit removal charges when removal is not recorded',()=>{
  const state=createInitialDemoState(tenantId,at,{seed:seed('scaled-concrete')});
  const graph=buildSimulatedGraph({tenantId,key:'scaled-concrete-lead',createdAt:'2026-09-15T15:00:00Z',workspace:state.workspace,scenarioSelection:{...DEFAULT_SELECTION,service:'concrete'}});
  const value=graph.polaris.snapshot,area=value.service.scope.squareFeet;
  expect(value.customerFacingPrice).toBeGreaterThan(area*10);
  expect(value.customerFacingPrice).toBeLessThan(area*22);
  expect(value.materialsCharge).toBeGreaterThan(area*3);
  expect(value.knownDirectMaterialCost).toBeGreaterThan(area*3);
  if(value.service.scope.existingRemoval!==true){
    expect(value.pricingLineItems.some(line=>line.code==='profile-concrete-removal-equipment')).toBe(false);
    expect(value.pricingLineItems.some(line=>line.code==='profile-concrete-removal-disposal')).toBe(false);
  }
});

test('saved demo sessions with the released USD 600 concrete placeholder are repaired on read',()=>{
  const state=initialWithConcrete(),graph=state.graphs.find(item=>item.lead.serviceType==='concrete');
  graph.polaris.syntheticCalculation.input.businessProfile.version='fictional-cost-example-v1';
  graph.polaris.snapshot.materialsCharge=600;
  graph.polaris.snapshot.pricingLineItems=[{code:'profile-fictional-materials',label:'Illustrative material charge',category:'materials',customerCharge:600}];
  const repaired=repairKnownConcreteCostExample(state),updated=repaired.graphs.find(item=>item.ids.graph===graph.ids.graph);
  expect(updated.polaris.snapshot.materialsCharge).toBe(3170.02);
  expect(updated.polaris.snapshot.netMarginPercent).toBeGreaterThan(25);
  expect(updated.polaris.syntheticCalculation.input.businessProfile.version).toBe('fictional-concrete-cost-profile-v2');
});

test('saved workspaces gain the concrete cost book without discarding their graphs',()=>{
  const state=initialWithConcrete();
  delete state.workspace.businessProfile.industryProfiles.concrete;
  state.graphs=state.graphs.map(graph=>{
    graph.businessProfile=state.workspace.businessProfile;
    delete graph.projectionDigest;
    graph.projectionDigest=sha256(graph);
    return graph;
  });
  const repaired=repairKnownConcreteBusinessProfile(state);
  expect(repaired.workspace.businessProfile.industryProfiles.concrete.version).toBe('simulated-concrete-business-profile-v1');
  expect(repaired.graphs.map(graph=>graph.ids.graph)).toEqual(state.graphs.map(graph=>graph.ids.graph));
  expect(repaired.graphs.every(graph=>graph.businessProfile.industryProfiles.concrete)).toBe(true);
});
