'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const readiness=require('../src/scheduling/travelReadiness');
const {fixture,id}=require('./helpers/m24-travel-input');
const {sha256}=require('../src/services/businessProfileAdapter');
const now=new Date('2026-09-12T12:00:00Z');
const proposal={target:{kind:'profile',id:id(90)},scheduledStart:'2026-09-12T13:00:00Z',scheduledEnd:'2026-09-12T14:00:00Z'};
function plan(){const inputs=fixture();inputs.access=[{lineId:id(8),label:'Reported Access Closure',status:'closed',start:'2026-09-12T12:30:00Z',end:'2026-09-12T14:30:00Z',appliesToJob:true,source:{...inputs.trips[0].source,effectiveOn:'2026-09-12',endsOn:'2026-09-12',geography:'Declared Job Site'}}];return{id:id(50),revision:1,digest:'a'.repeat(64),sourcePins:{estimateId:id(60)},action:'save',inputs};}
function selected(p){return{id:id(70),revision:2,digest:'b'.repeat(64),componentManifest:{travel:{kind:'plan',id:p.id,revision:p.revision,digest:p.digest,sourcePins:p.sourcePins}}};}
function sources(p){return{serviceKey:p.inputs.serviceKey,locations:[],serviceArea:{},bufferMinutes:null};}
test('current withdrawal retains still-adopted access constraint and exact lineage',()=>{const p=plan(),withdrawn={...p,id:id(51),revision:2,digest:'c'.repeat(64),action:'withdraw',inputs:null};const basis=readiness.fromHistory([withdrawn,p],selected(p),sources(p),{targetState:'assigned',scheduleState:'scheduled',...proposal},proposal);const result=readiness.extra(basis,proposal,now);assert.ok(result.hardConflicts.some(x=>x.code==='travel_access_closed'));assert.equal(basis.adoptionPin.travel.id,p.id);assert.ok(result.reviewReasons.some(x=>x.code==='travel_plan_changed'));});
test('missing or mismatched adopted history fails closed instead of omitting constraints',()=>{const p=plan();assert.throws(()=>readiness.fromHistory([],selected(p),sources(p),{},proposal),e=>e.status===409);const changed={...p,sourcePins:{estimateId:id(61)}};assert.throws(()=>readiness.fromHistory([changed],selected(p),sources(p),{},proposal),e=>e.status===409);});
test('expired or unknown access evidence needs review rather than asserting current closure',()=>{const p=plan();for(const end of [null,'2026-09-11']){p.inputs.access[0].source.endsOn=end;const result=readiness.extra({inputs:p.inputs,sources:sources(p),digest:sha256(p)},proposal,now);assert.equal(result.hardConflicts.length,0);assert.ok(result.reviewReasons.some(x=>x.code==='travel_access_needs_review'));}});
test('only actual unassignment with unchanged times qualifies as cleanup',()=>{const current={targetState:'assigned',scheduleState:'scheduled',scheduledStart:proposal.scheduledStart,scheduledEnd:proposal.scheduledEnd};assert.equal(readiness.cleanup(current,{...proposal,target:{kind:'unassigned'}}),true);assert.equal(readiness.cleanup({...current,targetState:'unassigned'},{...proposal,target:{kind:'unassigned'}}),false);assert.equal(readiness.cleanup(current,{...proposal,target:{kind:'unassigned'},scheduledEnd:'2026-09-12T15:00:00Z'}),false);assert.equal(readiness.cleanup({...current,scheduleState:'unscheduled',scheduledStart:null,scheduledEnd:null},{target:{kind:'unassigned'},scheduledStart:null,scheduledEnd:null}),true);});

test('recorded target home matches only exact saved business origin, never verifies a route',()=>{
 const p=plan(),origin={kind:'business_location',label:'',sourceId:'headquarters',sourceDigest:'a'.repeat(64),latitude:null,longitude:null};p.inputs.trips[0].origin=origin;
 for(const targetOrigin of ['headquarters','different',null]){
 const source={...sources(p),locations:[origin],targetOrigin};const result=readiness.extra({inputs:p.inputs,sources:source,digest:sha256(source)},proposal,now);
 assert.equal(result.reviewReasons.some(r=>r.code==='travel_target_origin_unknown'),targetOrigin!=='headquarters');assert.ok(result.reviewReasons.some(r=>r.code==='travel_driving_route_unverified'));
 }
 p.inputs.trips[0].origin={...origin,kind:'declared'};assert.ok(readiness.extra({inputs:p.inputs,sources:{...sources(p),targetOrigin:'headquarters'},digest:'test'},proposal,now).reviewReasons.some(r=>r.code==='travel_target_origin_unknown'));
});

test('shared demo binding uses recorded eligible worker and crew homes without retrofitting old sessions',()=>{
 const state=require('../src/commandCenter/workspace').createInitialDemoState('11111111-1111-4111-8111-111111111111',now,{seed:'fence-company'}),g=state.graphs[0],item={ids:g.ids,snapshot:g.polaris.snapshot},travel=require('../src/commandCenter/demoTravel'),workforce=require('../src/commandCenter/demoWorkforce');
 const p=plan(),source=travel.sources(state,item);p.inputs.serviceKey=source.serviceKey;p.inputs.trips[0].origin=structuredClone(source.locations.find(l=>l.kind==='business_location'));p.evidence={digest:source.digest};state.travelPlans={[g.ids.estimate]:[p]};
 for(const target of workforce.targets(state.schedulingWorkforce).filter(t=>t.kind==='crew'||t.accessRole==='member')){
 const input={...proposal,target:{kind:target.kind,id:target.id}},basis=readiness.demoBasis(state,item,input,now);assert.equal(basis.sources.targetOrigin,'headquarters');assert.ok(!readiness.extra(basis,input,now).reviewReasons.some(r=>r.code==='travel_target_origin_unknown'));
 const original=structuredClone(state.schedulingWorkforce),record=target.kind==='profile'?state.schedulingWorkforce.members.find(m=>m.profileId===target.id):state.schedulingWorkforce.crews.find(c=>c.id===target.id);record.homeLocationId='other';delete state.schedulingWorkforce.digest;state.schedulingWorkforce.digest=sha256(state.schedulingWorkforce);const changed=readiness.demoBasis(state,item,input,now);assert.notEqual(changed.digest,basis.digest);assert.ok(readiness.extra(changed,input,now).reviewReasons.some(r=>r.code==='travel_target_origin_unknown'));state.schedulingWorkforce=original;
 }
 delete state.schedulingWorkforce;const before=JSON.stringify(state),legacy=readiness.demoBasis(state,item,proposal,now);assert.equal(legacy.sources.targetOrigin,null);assert.equal(JSON.stringify(state),before);
});
