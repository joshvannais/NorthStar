'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const calculation=require('./travelCalculation');
const {VERSION,exact,text,calculate,fail}=calculation;
const FIELDS=['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion'];
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function conflict(message){throw Object.assign(new Error(message),{status:409,code:'TRAVEL_REVIEW_CHANGED'});}
function normalize(body){
 if(!exact(body,FIELDS)||!['save','withdraw'].includes(body.action)||![body.expectedRevision,body.expectedDecisionRevision].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=10000)||!(body.expectedRevision===0?body.expectedDigest==='none':digest(body.expectedDigest))||!(body.expectedDecisionRevision===0?body.expectedDecisionDigest==='none':digest(body.expectedDecisionDigest))||!body.sourcePins||typeof body.sourcePins!=='object'||Array.isArray(body.sourcePins)||body.confirmed!==true||body.confirmationVersion!==VERSION||!text(body.reason,2000)||!['USD','CAD','EUR'].includes(body.currency))fail('Review the travel entries and confirmation.');
 if(body.action==='save')calculate(body.inputs,body.currency);else if(body.inputs!==null)fail('A withdrawal cannot contain a new plan.');return stableValue({...body,reason:body.reason.trim()});
}
function sourceAssessment(inputs,now=new Date()){
 const date=new Date(now).toISOString().slice(0,10),cautions=[];
 for(const l of [...inputs.trips,...inputs.logistics,...inputs.access,...inputs.hauls,...inputs.hauls.filter(h=>h.detail?.density).map(h=>({lineId:h.lineId,source:h.detail.density.source})),...(inputs.stagePlan?.resources||[]).map(r=>({...r,lineId:r.resourceId})),...(inputs.stagePlan?.stages||[]).map(r=>({...r,lineId:r.stageId}))]){const e=l.source,codes=[];if(!e.effectiveOn)codes.push('date_unknown');else if(e.effectiveOn>date)codes.push('not_yet_effective');if(!e.endsOn)codes.push('freshness_unknown');else if(e.endsOn<date)codes.push('expired');if(!e.geography.trim())codes.push('applicability_unknown');if(codes.length)cautions.push({lineId:l.lineId,codes});}
 for(const t of inputs.trips){const codes=[];if(t.origin.kind==='declared'||t.destination.kind==='declared')codes.push('location_declared');if(t.distance.value===null)codes.push('distance_unknown');else if(t.distance.basis==='straight_line')codes.push('not_driving_distance');if(t.time.value===null)codes.push('travel_time_unknown');if(codes.length)cautions.push({lineId:t.lineId,codes});}
 return stableValue({date,cautions});
}
function checkSources(inputs,sources){
 require('./travelResourceBasis').check(inputs,sources);
 if(inputs.serviceKey!==sources.serviceKey)conflict('The job service changed. Refresh and review the travel plan.');
 for(const t of inputs.trips)for(const k of ['origin','destination']){const l=t[k];if(l.kind==='declared')continue;const current=(sources.locations||[]).find(x=>x.kind===l.kind&&x.sourceId===l.sourceId);if(!current||sha256(current)!==sha256(l))conflict('A saved location changed or is unavailable. Refresh and choose it again.');}
}
function assess(inputs,sources,now){checkSources(inputs,sources);return stableValue({...sourceAssessment(inputs,now),sourcesDigest:sources.digest});}
function checkEvidence(inputs,currency,sources,now){
 calculate(inputs,currency);const expected=assess(inputs,sources,now),a=inputs.assessment;
 if(!exact(a,['date','cautions','sourcesDigest','acknowledged','explanation'])||a.acknowledged!==true||!text(a.explanation,1000,expected.cautions.length===0)||sha256({date:a.date,cautions:a.cautions,sourcesDigest:a.sourcesDigest})!==sha256(expected))conflict('Calculate again, review the travel sources and confirm the assumptions.');return expected;
}
function checkBasis(body,review,current){const d=review.decisions.writeBasis;if(review.isCurrent===false||body.expectedRevision!==(current?.revision||0)||body.expectedDigest!==(current?.digest||'none')||body.expectedDecisionRevision!==d.revision||body.expectedDecisionDigest!==d.digest||sha256(body.sourcePins)!==sha256(review.pins)||body.currency!==review.currency||body.action==='save'&&body.inputs.serviceKey!==review.materialSourceContext.serviceKey)conflict('The estimate, travel plan or price review changed. Refresh and review again.');}
function project(data,review,canMutate,simulated=false,mutationsPaused=false,now=new Date()){
 const expose=e=>e?{...Object.fromEntries(Object.entries(e).filter(([k])=>!['requestKey','requestDigest','evidence'].includes(k))),result:e.action==='save'?calculate(e.inputs,e.currency):null,currentAssessment:e.action==='save'?sourceAssessment(e.inputs,now):null,sourceBasisCurrent:sha256(e.sourcePins)===sha256(review.pins)}:null;
 return stableValue({contract:VERSION,sourcePins:review.pins,serviceKey:review.materialSourceContext?.serviceKey||null,simulated,canMutate,mutationsPaused,decisionBasis:review.decisions.writeBasis,current:expose(data.current),history:(data.history||[]).map(expose),total:data.total||0,truncated:data.truncated===true});
}
function demoPlan(history,review,raw,key,now,sources){
 const body=normalize(raw),requestDigest=sha256(body),old=history.find(e=>e.requestKey===key);if(old){if(old.requestDigest!==requestDigest)conflict('This save attempt changed. Refresh before saving again.');return{receipt:old,replayed:true};}
 checkBasis(body,review,history[0]);if(body.action==='save')checkEvidence(body.inputs,body.currency,sources,now);else if(history[0]?.action!=='save')fail('There is no saved travel plan to withdraw.');
 if(history.length>=20)throw Object.assign(new Error('This demo has reached its travel history limit. Saved history remains available. Resetting the demo clears its practice work.'),{status:429,code:'TRAVEL_HISTORY_LIMIT'});
 return{replayed:false,receipt:{id:require('node:crypto').randomUUID(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,calculationVersion:VERSION,...body,evidence:body.action==='save'?sources:null,actorName:'Demo Reviewer',createdAt:now.toISOString(),digest:sha256({body,sources:body.action==='save'?sources:null,previous:history[0]?.digest||null}),requestKey:key,requestDigest}};
}
module.exports={VERSION,normalize,calculate,sourceAssessment,checkSources,assess,checkEvidence,checkBasis,project,demoPlan};
