"use strict";
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const m=require('./travelCalculation');
function reference(plan,lineId){return{planId:plan.id,revision:plan.revision,digest:plan.digest,lineId};}
function choices(equipmentPlans,laborPlan,equipmentCurrent){
 const equipment=[];for(const plan of equipmentPlans){if(!plan||plan.action!=='save')continue;const current=equipmentCurrent(plan);for(const line of plan.inputs.lines){const pin=reference(plan,line.lineId);if(!equipment.some(e=>sha256(e.pin)===sha256(pin)))equipment.push({pin,label:[line.identity?.manufacturer,line.identity?.model,line.identity?.configuration].filter(Boolean).join(' ')||'Recorded Equipment',sourceCurrent:current});}}
 const labor=laborPlan?.action==='save'?laborPlan.inputs.lines.map(line=>({pin:reference(laborPlan,line.lineId),label:line.task,people:line.basis==='people_time'?line.people:null})):[];
 return stableValue({equipment,labor});
}
function validateReference(v){return m.exact(v,['planId','revision','digest','lineId'])&&[v.planId,v.lineId].every(s=>typeof s==='string'&&m.UUID.test(s))&&Number.isSafeInteger(v.revision)&&v.revision>0&&v.revision<=10000&&typeof v.digest==='string'&&/^[a-f0-9]{64}$/.test(v.digest);}
function binding(r){const b=r.binding??null;if(b===null)return null;if(!m.exact(b,['component','reference','position'])||!['equipment','labor'].includes(b.component)||!validateReference(b.reference)||b.component!==(r.kind==='person'?'labor':'equipment')||(b.component==='equipment'?b.position!==null:!Number.isSafeInteger(b.position)||b.position<1||b.position>100))m.fail('Choose a recorded task position or equipment item.','TRAVEL_OPERATIONS_INVALID');return b;}
function check(inputs,sources){
 const available=sources.resourceChoices||{equipment:[],labor:[]},unknown=[],seen=new Set();
 function find(component,reference){const row=available[component]?.find(x=>sha256(x.pin)===sha256(reference));if(!row||component==='equipment'&&!row.sourceCurrent)throw Object.assign(new Error('A selected task or equipment source changed. Refresh and choose the current saved basis.'),{status:409,code:'TRAVEL_REVIEW_CHANGED'});return row;}
 for(const h of inputs.hauls){const ref=h.detail?.equipmentBasis;if(ref)find('equipment',ref);else unknown.push({kind:'haul_equipment_unknown',lineId:h.lineId});}
 for(const r of inputs.stagePlan?.resources||[]){const b=binding(r);if(!b){unknown.push({kind:'resource_basis_unknown',resourceId:r.resourceId});continue;}const row=find(b.component,b.reference),key=sha256(b);if(seen.has(key))m.fail('Use each recorded task position or equipment item only once.','TRAVEL_OPERATIONS_INVALID');seen.add(key);if(b.component==='labor'){if(row.people===null)unknown.push({kind:'task_headcount_unknown',resourceId:r.resourceId});else if(b.position>row.people)m.fail('The crew position exceeds the people recorded for this task.','TRAVEL_OPERATIONS_INVALID');}}
 return{unknown};
}
function review(inputs,sources){
 let checked;try{checked=check(inputs,sources);}catch(e){return{needsReview:true,unknown:[{kind:'resource_source_changed'}],absenceWindows:[]};}
 for(const stage of inputs.stagePlan?.stages||[])if(!stage.presence||stage.presence==='unknown')checked.unknown.push({kind:'stage_presence_unknown',stageId:stage.stageId});
 const stages=inputs.stagePlan?require('./travelOperations').stages(inputs.stagePlan):null,windows=[];
 if(!stages)return{needsReview:checked.unknown.length>0,unknown:checked.unknown,absenceWindows:[]};
 const fraction=f=>m.rational(BigInt(f.numerator),BigInt(f.denominator)),compare=(a,b)=>{const n=a.n*b.d-b.n*a.d;return n<0n?-1:n>0n?1:0;};
 const points=new Map();for(const stage of stages.stages)for(const f of [stage.start,stage.end])if(f){const r=fraction(f);points.set(r.n+'/'+r.d,r);}
 const times=[...points.values()].sort(compare),resources=inputs.stagePlan.resources,byId=new Map(resources.map(r=>[r.resourceId,r]));
 for(let i=1;i<times.length;i++){const start=times[i-1],end=times[i];if(compare(start,end)>=0)continue;const active=stages.stages.filter(s=>s.start&&s.end&&compare(fraction(s.start),end)<0&&compare(start,fraction(s.end))<0);
 for(const task of sources.resourceChoices?.labor||[]){const away=new Set(),onsite=new Set();let unknown=false;const affected=[];
 for(const stage of active){const raw=inputs.stagePlan.stages.find(s=>s.stageId===stage.stageId),people=stage.resourceIds.map(id=>byId.get(id)).filter(r=>r.kind==='person'&&r.binding?.component==='labor'&&sha256(r.binding.reference)===sha256(task.pin));if(!people.length)continue;affected.push(stage.label);for(const person of people){if(raw.presence==='away')away.add(person.binding.position);else if(raw.presence==='onsite')onsite.add(person.binding.position);else unknown=true;}}
 if(affected.length)windows.push({task:task.label,taskPin:task.pin,start:m.fraction(start),end:m.fraction(end),recordedPeople:task.people,awayPositions:away.size,explicitOnsitePositions:onsite.size,positionsNotAssignedAway:task.people===null?null:task.people-away.size,remainingOnsite:unknown||task.people===null||new Set([...away,...onsite]).size!==task.people||[...away].some(position=>onsite.has(position))?null:onsite.size,stages:affected,presenceUnknown:unknown});
 }}
 return{needsReview:checked.unknown.length>0||stages.feasibleElapsedMinutes===null||windows.some(w=>w.remainingOnsite===null),unknown:checked.unknown,absenceWindows:windows,meaning:'Declared task positions are not verified employees, skills or availability. Unallocated people are not assumed productive.'};
}
module.exports={reference,choices,validateReference,binding,check,review};
