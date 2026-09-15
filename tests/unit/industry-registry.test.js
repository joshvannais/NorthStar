'use strict';
const w=require('../../src/commandCenter/workspace');
const space=require('../../src/commandCenter/scenarioSpace');
const registry=require('../../src/commandCenter/industryRegistry');
const intelligence=require('../../src/commandCenter/industryIntelligence');
const contract=require('../../public/js/command-center-contract');
const {calculateCanonicalPolaris}=require('../../src/services/canonicalPolarisCalculation');
const tenantId='11111111-1111-4111-8111-111111111111',createdAt='2026-09-15T12:00:00Z';
function graph(key,selection={}){return w.buildSimulatedGraph({tenantId,createdAt,key,scenarioSelection:{...space.DEFAULT_SELECTION,service:'tree',...selection}});}
test('registry coverage is honest and existing service definitions remain present',()=>{
 expect(registry.definitions.map(x=>x.key)).toEqual(['fence','roofing','hvac','plumbing','electrical','concrete','tree']);
 expect(registry.coverage.requiredReviewedProfiles).toBe(200);expect(registry.coverage.reviewedProfiles).toBe(0);
 expect(intelligence.packs.tree.review.countsTowardReviewedIndustryTarget).toBe(false);
});
test('six coherent ordinary tree families are deterministic, canonical and do not invent resources',()=>{
 const found=new Map();for(let i=0;i<80;i++){const selection=i===0?{intent:'inspection'}:i===1?{urgency:'safety_emergency',intent:'inspection',outcome:'needs_information',scheduling:'flexible'}:{};
 const g=graph('family-'+i,selection),id=g.polaris.snapshot.service.scope.jobType;
 expect(graph('family-'+i,selection)).toEqual(g);found.set(id,g);
 expect(g.polaris.snapshot).toEqual(calculateCanonicalPolaris(g.polaris.syntheticCalculation.input));
 expect(g.polaris.snapshot.knownDirectCosts).toBeNull();expect(g.polaris.snapshot.actualCrewAssignment).toBeNull();expect(g.polaris.snapshot.travel.distanceMiles).toBeNull();
 expect(g.work.assignedTo).toBeNull();expect(g.polaris.snapshot.service.scope.assessmentQuestions.length).toBeGreaterThan(2);
 expect(g.communication.transcript.some(t=>t.text===intelligence.packs.tree.operations[id].statement)).toBe(true);
 expect(g.polaris.facts.find(f=>f.variable==='jobType').normalizedValue).toBe(id);
 expect(g.polaris.snapshot.service.scope).not.toHaveProperty('linearFeet');
 }
 expect([...found.keys()].sort()).toEqual(Object.keys(intelligence.packs.tree.operations).sort());
 expect(found.get('storm').polaris.snapshot.risk.emergency).toBe(true);
 expect(found.get('hauling').polaris.snapshot.service.scope.disposalPreference).toMatch(/not requesting tree cutting/);
 expect(found.get('visit').polaris.snapshot.service.scope.disposalPreference).toMatch(/No cutting/);
});
test('new and reset registry sessions remain deterministic and historical objects untouched',()=>{
 const all=new Set();for(let i=0;i<24;i++){const args={seed:'registry-reset-'+i,generation:i+1},state=w.createInitialDemoState(tenantId,createdAt,args),before=JSON.stringify(state);
 expect(w.createInitialDemoState(tenantId,createdAt,args)).toEqual(state);
 for(const g of state.graphs){all.add(g.lead.serviceType);expect(g.polaris.snapshot).toEqual(calculateCanonicalPolaris(g.polaris.syntheticCalculation.input));}
 graph('another-'+i);expect(JSON.stringify(state)).toBe(before);}
 expect([...all].sort()).toEqual(registry.definitions.map(d=>d.key).sort());
});
test('registry choice resolution scales to 200 profiles without Cartesian catalog expansion',()=>{
 const s=structuredClone(space.publicScenarioSpace()),d=s.dimensions.find(d=>d.id==='service'),tree=d.options.find(o=>o.id==='tree');
 d.options=Array.from({length:200},(_,i)=>({...tree,id:'review-test-'+i}));
 const choice=contract.resolveDemoScenario(s,{...space.DEFAULT_SELECTION,service:'random',intent:'new_estimate'},()=>0.99,null);
 expect(choice.service).toBe('review-test-198');expect(choice.business).toBe(space.DEFAULT_SELECTION.business);
 expect(contract.resolveDemoScenario(space.publicScenarioSpace(),{...space.DEFAULT_SELECTION,service:'tree'},()=>0.5,null).service).toBe('tree');
});
test('registry emergency rules agree in server generation and pending choices',()=>{
 const bad=[{service:'fence',intent:'tree_removal'},{service:'tree',intent:'tree_storm',urgency:'planning'},{service:'tree',intent:'tree_pruning',urgency:'safety_emergency'}];
 for(const change of bad){const selection={...space.DEFAULT_SELECTION,...change};expect(contract.resolveDemoScenario(space.publicScenarioSpace(),selection,()=>0,null)).toBeNull();expect(()=>graph('reject',selection)).toThrow(/matching service details/);}
 for(const op of Object.keys(intelligence.packs.tree.operations)){const selection={...space.DEFAULT_SELECTION,service:'tree',intent:'tree_'+op,urgency:op==='storm'?'safety_emergency':'planning',outcome:'needs_information',scheduling:'flexible'};expect(contract.resolveDemoScenario(space.publicScenarioSpace(),selection,()=>0,null)).toEqual(selection);expect(graph('explicit-'+op,selection).polaris.snapshot.service.scope.jobType).toBe(op);}
});
