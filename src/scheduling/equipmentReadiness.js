'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const contract=require('../estimating/equipmentReadinessContract');
function extra(basis,proposal,now=new Date()){
 if(!basis||basis.notRecorded===true)return {hardConflicts:[],reviewReasons:[],digest:basis?.digest||'none'};
 const hardConflicts=[],reviewReasons=basis.sourceChanged?[{code:'equipment_readiness_changed'}]:[];
 if(basis.inputs){const assessed=contract.evaluate(basis.inputs,basis.evidence,now,proposal);for(const line of assessed.lines){for(const code of line.hard)hardConflicts.push({code:'equipment_'+code,lineId:line.lineId});for(const code of line.review)reviewReasons.push({code:'equipment_'+code,lineId:line.lineId});}}
 return {hardConflicts,reviewReasons,digest:basis.digest};
}
function merge(result,addition){
 const distinct=entries=>Array.from(new Map(entries.map(e=>[JSON.stringify(stableValue(e)),e])).entries()).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,e])=>e);
 const hardConflicts=distinct([...result.hardConflicts,...addition.hardConflicts]),reviewReasons=distinct([...result.reviewReasons,...addition.reviewReasons]);
 if(hardConflicts.length>256||reviewReasons.length>256)throw Object.assign(new Error('There is too much equipment evidence to review in this action. Review the equipment plan first.'),{status:429});
 return {...result,hardConflicts,reviewReasons,needsReview:reviewReasons.length>0,status:hardConflicts.length?'hard_conflict':reviewReasons.length?'needs_review':result.warnings.length?'warning':'clear'};
}
async function read(client,input){
 const p=input.proposal,t=p.target;
 return (await client.query('SELECT public.canonical_equipment_readiness_schedule_read($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.appointmentId,t.kind,t.id,p.scheduledStart,p.scheduledEnd,input.expectedTimeZone])).rows[0].result;
}
function demoBasis(state,item,proposal,now=new Date()){
 const saved=require('../commandCenter/demoScheduling').validateState(state).history.find(h=>h.appointmentId===item.ids.appointment)?.response.scheduleAuthority;
 const sameInstant=(a,b)=>a===null&&b===null||a!==null&&b!==null&&Date.parse(a)===Date.parse(b);
 if(proposal.target.kind==='unassigned'&&saved?.targetState==='assigned'&&saved.scheduleState===(proposal.scheduledStart===null?'unscheduled':'scheduled')&&sameInstant(saved.scheduledStart,proposal.scheduledStart)&&sameInstant(saved.scheduledEnd,proposal.scheduledEnd))return {notRecorded:true,digest:'none'};
 const plan=state.equipmentPlans?.[item.ids.estimate]?.[0],ready=state.equipmentReadinessPlans?.[item.ids.estimate]?.[0];
 if(!plan)return {notRecorded:true,digest:'none'};
 if(plan.action!=='save')return {notRecorded:false,sourceChanged:true,digest:sha256([plan.id,plan.digest,ready?.digest||null])};
 const current={planId:plan.id,revision:plan.revision,digest:plan.digest},sourceChanged=ready?.action!=='save'||sha256(ready.inputs.equipmentBasis)!==sha256(current);
 const inputs=sourceChanged?{equipmentBasis:current,replacement:null,assessment:null,lines:plan.inputs.lines.map(l=>({lineId:l.lineId,required:true,notRequiredReason:'',quantity:null,start:null,end:null,timeZone:item.snapshot.businessProfile?.company?.timeZone||'UTC',location:'',source:{kind:'my_observation',label:'',reference:'',observedAt:null,validUntil:null,quantity:null,start:null,end:null,condition:'unknown',restrictions:'',location:'',leadTime:null,leadTimeUnit:null},maintenance:{dueAt:null,meterKey:null,threshold:null,unit:null,reference:''},alternatives:[]}))}:ready.inputs;
 const evidence=require('../commandCenter/demoEquipmentReadiness').rawSources(state,item,null,now),workforce=require('../commandCenter/demoWorkforce'),candidate=workforce.candidate(workforce.read(state),proposal.target);
 for(const fact of evidence.lines){if(fact.declaredCheckout)fact.declaredCheckout.targetMatches=!!candidate&&candidate.members.some(m=>m.profileId===fact.declaredCheckout.operatorId);}
 const payload={notRecorded:false,sourceChanged,inputs,evidence,readinessPin:ready?{id:ready.id,revision:ready.revision,digest:ready.digest}:null};
 return {...payload,digest:sha256(payload)};
}
module.exports={extra,merge,read,demoBasis};
