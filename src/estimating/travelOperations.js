'use strict';
// Declared logistics facts only. No tree yield, route, skills or productivity inference.
const m=require('./travelCalculation');
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const one=()=>m.rational(1n),zero=()=>m.rational(0n);
const cmp=(a,b)=>a.n*b.d-b.n*a.d;
const sub=(a,b)=>m.rational(a.n*b.d-b.n*a.d,a.d*b.d);
const div=(a,b)=>m.rational(a.n*b.d,a.d*b.n);
const min=(a,b)=>cmp(a,b)<=0n?a:b;
const max=(a,b)=>cmp(a,b)>=0n?a:b;
const ceil=a=>(a.n+a.d-1n)/a.d;
const out=a=>a===null?null:m.fraction(a);
function invalid(message){m.fail(message,'TRAVEL_OPERATIONS_INVALID');}
function identity(v){if(typeof v!=='string'||!m.UUID.test(v))invalid('Review the logistics entry.');}
function dimension(v,kind){
 if(!m.exact(v,['applicable','reason','unit','output','retained','capacity','existing'])||![true,false,null].includes(v.applicable)||!(kind==='volume'?['yd3','m3']:['lb','kg']).includes(v.unit))invalid('Choose the load units and what is known.');
 const values={};for(const k of ['output','retained','capacity','existing'])values[k]=m.qty(v[k]);
 if(v.applicable===false){if(!m.text(v.reason,500)||Object.values(values).some(x=>x!==null))invalid('Explain why this capacity does not apply.');return{applicable:false,unit:v.unit,known:true};}
 if(v.reason!==null)invalid('Remove the non-applicable explanation for a required capacity.');
 if(values.output!==null&&values.retained!==null&&values.retained>values.output)invalid('The quantity retained onsite cannot exceed the output.');
 if(values.capacity!==null&&values.existing!==null&&values.existing>values.capacity)invalid('The existing load exceeds the recorded usable capacity.');
 if(values.capacity===0n)invalid('Usable capacity must be greater than zero, or unknown.');
 return{applicable:v.applicable,unit:v.unit,known:v.applicable===true&&Object.values(values).every(x=>x!==null),...values};
}
function baseLoads(h){
 if(!m.exact(h,['lineId','label','material','homogeneous','volume','mass','initialLoadOwner','initialLoadNote','source'])||!m.text(h.label,160)||!m.text(h.material,160)||typeof h.homogeneous!=='boolean'||!['this_job','other_job','unknown'].includes(h.initialLoadOwner)||!m.text(h.initialLoadNote,500))invalid('Describe the load and who owns disposal of existing contents.');
 identity(h.lineId);m.source(h.source);
 const dimensions={volume:dimension(h.volume,'volume'),mass:dimension(h.mass,'mass')},required=Object.entries(dimensions).filter(([,d])=>d.applicable!==false);
 if(!required.length)invalid('Record at least one applicable load capacity.');
 const cautions=[];
 if(!h.homogeneous)cautions.push('Mixed materials need separately measured loads; no average density is assumed.');
 if(required.some(([,d])=>!d.known))cautions.push('Output, retained quantity, usable capacity or existing load is unknown.');
 if(h.initialLoadOwner==='unknown')cautions.push('Review who pays for disposal of existing contents.');
 // No conversion between mass and volume: both dimensions must be explicitly
 // recorded here. An externally sourced conversion can be recorded as a fact,
 // but this calculation never manufactures density.
 const basis=stableValue({volume:h.volume,mass:h.mass,initialLoadOwner:h.initialLoadOwner});
 if(!h.homogeneous||required.some(([,d])=>!d.known))return{lineId:h.lineId,complete:false,additionalLoads:null,firstLoad:null,lastLoad:null,basis,cautions,existingDisposalIncluded:false};
 const active=required.map(([kind,d])=>({kind,...d,remaining:d.output-d.retained}));
 const positive=active.filter(d=>d.remaining>0n);
 if(positive.length&&active.some(d=>d.remaining===0n))invalid('Recorded mass and volume conflict. Review the remaining material.');
 if(!positive.length)return{lineId:h.lineId,complete:h.initialLoadOwner!=='unknown',additionalLoads:0,firstLoad:null,lastLoad:null,basis,cautions:[...cautions,'Zero new material does not remove disposal of existing contents.'],existingDisposalIncluded:false};
 let firstFraction=one(),emptyFraction=one();
 for(const d of positive){firstFraction=min(firstFraction,m.rational(d.capacity-d.existing,d.remaining));emptyFraction=min(emptyFraction,m.rational(d.capacity,d.remaining));}
 const remainingFraction=sub(one(),firstFraction),afterFirst=remainingFraction.n?ceil(div(remainingFraction,emptyFraction)):0n;
 const firstHasMaterial=firstFraction.n>0n,additionalLoads=(firstHasMaterial?1n:0n)+afterFirst;
 if(additionalLoads>1000n)invalid('The load count exceeds 1000. Review the quantity and capacity.');
 const finalFraction=afterFirst?sub(remainingFraction,m.multiply(emptyFraction,m.rational(afterFirst-1n))):firstFraction;
 function quantities(f){return Object.fromEntries(positive.map(d=>[d.kind,{unit:d.unit,quantity:out(m.multiply(m.rational(d.remaining,m.SCALE),f))}]));}
 const initialClearanceRequired=!firstHasMaterial&&positive.some(d=>d.existing>0n);
 if(initialClearanceRequired)cautions.push('Existing contents must be cleared before loading this job; their disposal is separate.');
 return stableValue({lineId:h.lineId,complete:h.initialLoadOwner!=='unknown',additionalLoads:Number(additionalLoads),firstLoad:quantities(firstHasMaterial?firstFraction:min(emptyFraction,one())),lastLoad:quantities(finalFraction),lastLoadPartial:cmp(finalFraction,emptyFraction)<0,initialClearanceRequired,existingDisposalIncluded:false,basis,cautions});
}
function loads(raw){
 const detail=require('./travelHaulDetail'),p=detail.prepare(raw);
 if(p.detail?.orderedLoads.length)return stableValue(detail.ordered(p.inputs,p.detail));
 const result=baseLoads(p.inputs);if(!p.detail)return result;
 result.basis={...result.basis,detail:p.detail,rawVolume:raw.volume,rawMass:raw.mass};result.densityDerived=p.densityDerived;
 if(p.densityUnresolved){result.complete=false;result.additionalLoads=null;result.cautions.push('Density or volume is unknown, or the conversion exceeds six-decimal quantity precision. Record measured mass.');}
 return stableValue(result);
}
function stages(input){
 if(!m.exact(input,['resources','stages'])||!Array.isArray(input.resources)||!Array.isArray(input.stages)||input.resources.length>12||input.stages.length>12)invalid('Use up to 12 resources and 12 declared work stages.');
 const resources=new Map(),done=new Map(),cautions=[];
 if(!input.stages.length)cautions.push({kind:'stages_not_recorded'});
 for(const r of input.resources){const fields=Object.hasOwn(r,'binding')?['resourceId','label','kind','available','source','binding']:['resourceId','label','kind','available','source'];if(!m.exact(r,fields)||!m.text(r.label,160)||!['person','equipment'].includes(r.kind)||![true,false,null].includes(r.available))invalid('Review the people and equipment needed for these stages.');identity(r.resourceId);m.source(r.source);require('./travelResourceBasis').binding(r);if(resources.has(r.resourceId))invalid('Each resource can appear only once.');resources.set(r.resourceId,r);}
 let elapsed=zero(),unknown=false;
 for(const s of input.stages){
  if(!m.exact(s,Object.hasOwn(s,'presence')?['stageId','label','kind','duration','unit','dependencies','resourceIds','source','presence']:['stageId','label','kind','duration','unit','dependencies','resourceIds','source'])||(Object.hasOwn(s,'presence')&&!['onsite','away','unknown'].includes(s.presence))||!m.text(s.label,160)||!['travel','loading','queue','unloading','onsite','other'].includes(s.kind)||!['min','hour'].includes(s.unit)||!Array.isArray(s.dependencies)||!Array.isArray(s.resourceIds)||s.dependencies.length>12||s.resourceIds.length>12)invalid('Review the stage duration, dependencies and resources.');
  identity(s.stageId);m.source(s.source);if(done.has(s.stageId)||new Set(s.dependencies).size!==s.dependencies.length||new Set(s.resourceIds).size!==s.resourceIds.length)invalid('Each stage and relationship can appear only once.');
  if(s.dependencies.some(id=>!done.has(id)))invalid('A stage can depend only on an earlier recorded stage.');
  if(s.resourceIds.some(id=>!resources.has(id)))invalid('Choose a recorded resource for every stage allocation.');
  const q=m.qty(s.duration),duration=q===null?null:m.rational(q*(s.unit==='hour'?60n:1n),m.SCALE);
  let start=zero();for(const id of s.dependencies){const prior=done.get(id);if(prior.end===null){start=null;break;}start=max(start,prior.end);}
  const end=start===null||duration===null?null:m.add(start,duration);if(end===null)unknown=true;else elapsed=max(elapsed,end);
  const row={stageId:s.stageId,label:s.label,kind:s.kind,start,end,duration,resourceIds:s.resourceIds};
  if(!s.resourceIds.length)cautions.push({kind:'resource_requirements_unknown',stage:s.label});
  for(const id of s.resourceIds){const r=resources.get(id);if(r.available!==true)cautions.push({kind:r.available===false?'unavailable':'unknown_availability',resource:r.label,stage:s.label});
   if(start!==null&&end!==null)for(const previous of done.values())if(previous.start!==null&&previous.end!==null&&previous.resourceIds.includes(id)&&cmp(start,previous.end)<0&&cmp(previous.start,end)<0)cautions.push({kind:'parallel_resource_conflict',resource:r.label,stages:[previous.label,s.label]});
  }
  done.set(s.stageId,row);
 }
 const personMinutes=[...done.values()].reduce((sum,s)=>s.duration===null||sum===null?null:m.add(sum,m.multiply(s.duration,m.rational(BigInt(s.resourceIds.filter(id=>resources.get(id).kind==='person').length)))),zero());
 return stableValue({declaredElapsedMinutes:unknown?null:out(elapsed),feasibleElapsedMinutes:unknown||cautions.length?null:out(elapsed),personMinutes:out(personMinutes),cautions,stages:[...done.values()].map(s=>({...s,start:out(s.start),end:out(s.end),duration:out(s.duration)})),meaning:'Declared timing is separate from labor cost, skills and actual availability. Appointment times are unchanged.'});
}
function bindLoads(groups,bindings,trips){
 if(!Array.isArray(groups)||groups.length>12||!Array.isArray(bindings)||bindings.length>36)invalid('Review the load groups and their route legs.');
 const calculated=new Map(),usedTrips=new Set(),groupRoles=new Set(),cautions=[];
 for(const h of groups){if(calculated.has(h.lineId))invalid('Each load group can appear only once.');calculated.set(h.lineId,loads(h));}
 for(const b of bindings){
  if(!m.exact(b,['groupId','tripId','role','countBasis'])||!['outbound','return','final'].includes(b.role)||!['all_loads','except_last','once'].includes(b.countBasis))invalid('Identify each outbound, return or final route leg.');
  const group=calculated.get(b.groupId),trip=trips.find(t=>t.lineId===b.tripId);
  if(!group||!trip||usedTrips.has(b.tripId)||groupRoles.has(b.groupId+':'+b.role))invalid('Bind each route line and group leg only once.');
  usedTrips.add(b.tripId);groupRoles.add(b.groupId+':'+b.role);
  if(trip.returnIncluded)invalid('Bound load legs are one-way. Record each return and final destination separately.');
  if(b.role==='outbound'&&b.countBasis!=='all_loads'||b.role==='final'&&b.countBasis!=='once')invalid('Use all loads for outbound legs and one trip for the final destination.');
  if(group.additionalLoads===null){cautions.push({groupId:b.groupId,kind:'load_count_unknown'});continue;}
  const expected=b.countBasis==='all_loads'?group.additionalLoads:b.countBasis==='except_last'?Math.max(0,group.additionalLoads-1):group.additionalLoads>0?1:0;
  if(trip.trips*trip.vehicles!==expected)invalid('The route vehicle-trip count does not match the reviewed loads. Recalculate and review the route legs.');
 }
 for(const [groupId,g]of calculated){
  const bound=Object.fromEntries(bindings.filter(b=>b.groupId===groupId).map(b=>[b.role,trips.find(t=>t.lineId===b.tripId)])),outbound=bound.outbound,returning=bound.return,final=bound.final;
  if(g.additionalLoads!==0&&!outbound)cautions.push({groupId,kind:'outbound_leg_missing'});
  if(outbound&&returning&&(sha256(returning.origin)!==sha256(outbound.destination)||sha256(returning.destination)!==sha256(outbound.origin)))invalid('The return leg must connect the recorded disposal destination and job origin.');
  const returnCount=returning?returning.trips*returning.vehicles:0;
  if(g.additionalLoads>0&&returnCount<g.additionalLoads-1)cautions.push({groupId,kind:'between_load_returns_missing'});
  if(g.additionalLoads>0&&!final&&returnCount<g.additionalLoads)cautions.push({groupId,kind:'final_destination_unknown'});
  if(outbound&&final){const expectedOrigin=returnCount===g.additionalLoads?outbound.origin:outbound.destination;if(sha256(final.origin)!==sha256(expectedOrigin))invalid('The final leg must start where the last recorded disposal or return ends.');}
 }
 return stableValue({groups:[...calculated.values()],bindings,cautions,complete:[...calculated.values()].every(g=>g.complete)&&cautions.length===0});
}
module.exports={loads,stages,bindLoads};
