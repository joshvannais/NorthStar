'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const calculation=require('./equipmentCostCalculation');
const equipment=require('./equipmentPlanContract');
const {VERSION,exact,text,calculate}=calculation;
const FIELDS=['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion'];
function fail(message='Review the equipment cost entries before continuing.',status=400){throw Object.assign(new Error(message),{status,code:'EQUIPMENT_COST_INVALID'});}
function digest(v){return typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);}
function reference(plan){return{planId:plan.id,revision:plan.revision,digest:plan.digest,sourcePins:plan.sourcePins};}
function validate(inputs,currency){
 if(!exact(inputs,['serviceKey','equipmentBasis','lines','assessment'])||!text(inputs.serviceKey,160)||!exact(inputs.equipmentBasis,['planId','revision','digest','sourcePins'])||typeof inputs.equipmentBasis.planId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inputs.equipmentBasis.planId)||!Number.isInteger(inputs.equipmentBasis.revision)||inputs.equipmentBasis.revision<1||inputs.equipmentBasis.revision>10000||!digest(inputs.equipmentBasis.digest)||!inputs.equipmentBasis.sourcePins||typeof inputs.equipmentBasis.sourcePins!=='object'||Array.isArray(inputs.equipmentBasis.sourcePins))fail('Choose a saved equipment review and enter its costs.');
 return calculate(inputs,currency);
}
function normalize(body){
 if(!exact(body,FIELDS)||!['save','withdraw'].includes(body.action)||![body.expectedRevision,body.expectedDecisionRevision].every(n=>Number.isInteger(n)&&n>=0&&n<=10000)||!(body.expectedRevision===0?body.expectedDigest==='none':digest(body.expectedDigest))||!(body.expectedDecisionRevision===0?body.expectedDecisionDigest==='none':digest(body.expectedDecisionDigest))||!body.sourcePins||typeof body.sourcePins!=='object'||Array.isArray(body.sourcePins)||body.confirmed!==true||body.confirmationVersion!==VERSION||!text(body.reason,2000)||!['USD','CAD','EUR'].includes(body.currency))fail();
 if(body.action==='save')validate(body.inputs,body.currency);else if(body.inputs!==null)fail();
 return stableValue({...body,reason:body.reason.trim()});
}
function sourceAssessment(inputs,now=new Date()){
 const date=new Date(now).toISOString().slice(0,10),cautions=[];
 for(const l of inputs.lines){const e=l.source,codes=[];if(!e.effectiveOn)codes.push('date_unknown');else if(e.effectiveOn>date)codes.push('not_yet_effective');if(!e.endsOn)codes.push('freshness_unknown');else if(e.endsOn<date)codes.push('expired');if(!e.geography.trim())codes.push('applicability_unknown');if(l.method==='rental'&&l.rental.minimumQuantity===null)codes.push('rental_minimum_unknown');if(codes.length)cautions.push({lineId:l.lineId,codes});}
 return stableValue({date,cautions});
}
function assess(inputs,equipmentResult,now=new Date()){return stableValue({...sourceAssessment(inputs,now),equipmentAssessment:equipment.assessment(equipmentResult)});}
function checkEquipmentBasis(inputs,plan,sources,now){
 if(!plan||plan.action!=='save'||sha256(reference(plan))!==sha256(inputs.equipmentBasis)||plan.inputs.serviceKey!==inputs.serviceKey||sources.serviceKey!==inputs.serviceKey)fail('The saved equipment review changed. Refresh and review the equipment before entering costs.',409);
 const expected=plan.inputs.lines.map(l=>l.lineId.toLowerCase()).sort(),actual=inputs.lines.map(l=>l.lineId.toLowerCase()).sort();
 if(sha256(expected)!==sha256(actual))fail('Enter one cost entry for every item in the saved equipment review.');
 for(const l of inputs.lines){const saved=plan.inputs.lines.find(p=>p.lineId.toLowerCase()===l.lineId.toLowerCase());if(l.access!==saved.accessBasis)fail('The equipment access basis changed. Review the equipment first.',409);}
 const result=equipment.evaluate(plan.inputs,sources,now);
 if(plan.evidence?.digest&&plan.evidence.digest!==result.sourcesDigest)fail('An equipment source changed. Review the equipment before saving costs.',409);
 if(result.lines.some(l=>l.flags.includes('asset_unavailable')||l.flags.includes('configuration_changed')||l.flags.includes('company_reference_unavailable')))fail('An equipment source changed. Review the equipment before saving costs.',409);
 return result;
}
function checkCoverage(inputs,currentOutsideBasis){
 for(const l of inputs.lines){
  const charges=[l.rental?.charge,l.allocation?.pool,...(l.allocation?.additionalCosts||[]).map(c=>c.charge),...[l.operating?.allIn,l.operating?.fuelEnergy,l.operating?.consumables,l.operating?.maintenance].map(r=>r?.rate)].filter(Boolean);
  for(const c of charges)if(c.scope==='mixed')for(const k of ['operator','travel']){const cover=c.split[k+'Coverage'];if(cover.status==='covered'&&sha256(cover.basis)!==sha256(currentOutsideBasis[k]))fail('The reviewed labor or travel basis changed. Review the mixed-cost coverage again.',409);}
 }
}
function checkEvidence(inputs,currency,plan,sources,outsideBasis,now){
 validate(inputs,currency);const result=checkEquipmentBasis(inputs,plan,sources,now);checkCoverage(inputs,outsideBasis);
 const expected=assess(inputs,result,now),a=inputs.assessment;
 if(!exact(a,['date','cautions','equipmentAssessment','acknowledged','explanation'])||a.acknowledged!==true||!text(a.explanation,1000,expected.cautions.length===0)||sha256({date:a.date,cautions:a.cautions,equipmentAssessment:a.equipmentAssessment})!==sha256(expected))fail('Calculate again, review the equipment and cost sources, then confirm the assumptions.',409);
 return{result:calculate(inputs,currency),assessment:expected};
}
function checkBasis(body,review,current){const d=review.decisions.writeBasis;if(review.isCurrent===false||body.expectedRevision!==(current?.revision||0)||body.expectedDigest!==(current?.digest||'none')||body.expectedDecisionRevision!==d.revision||body.expectedDecisionDigest!==d.digest||sha256(body.sourcePins)!==sha256(review.pins)||body.currency!==review.currency||body.action==='save'&&body.inputs.serviceKey!==review.materialSourceContext.serviceKey)fail('The estimate, equipment costs or price review changed. Refresh and review again.',409);}
function project(data,review,canMutate,simulated=false,mutationsPaused=false,now=new Date()){
 const expose=e=>e?{...Object.fromEntries(Object.entries(e).filter(([k])=>!['evidence','requestKey','requestDigest'].includes(k))),result:e.action==='save'?calculate(e.inputs,e.currency):null,currentSourceAssessment:e.action==='save'?sourceAssessment(e.inputs,now):null,sourceBasisCurrent:sha256(e.sourcePins)===sha256(review.pins)}:null;
 return stableValue({contract:VERSION,sourcePins:review.pins,serviceKey:review.materialSourceContext?.serviceKey||null,simulated,canMutate,mutationsPaused,decisionBasis:review.decisions.writeBasis,current:expose(data.current),history:(data.history||[]).map(expose),total:data.total||0,truncated:data.truncated===true});
}
function demoPlan(history,review,raw,key,now,plan,sources,outsideBasis){
 const body=normalize(raw),digest=sha256(body),old=history.find(e=>e.requestKey===key);
 if(old){if(old.requestDigest!==digest)fail('This save attempt changed. Refresh before saving again.',409);return{receipt:old,replayed:true};}
 checkBasis(body,review,history[0]);if(body.action==='save')checkEvidence(body.inputs,body.currency,plan,sources,outsideBasis,now);
 if(body.action==='withdraw'&&history[0]?.action!=='save')fail('There is no saved equipment cost plan to withdraw.');
 if(history.length>=20)fail('This demo has reached its equipment cost history limit. Saved history remains available. Resetting the demo clears its saved practice work.',429);
 return{replayed:false,receipt:{id:require('node:crypto').randomUUID(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,calculationVersion:VERSION,...body,actorName:'Demo Reviewer',createdAt:now.toISOString(),digest:sha256({body,previous:history[0]?.digest||null}),requestKey:key,requestDigest:digest}};
}
module.exports={VERSION,validate,normalize,reference,assess,sourceAssessment,checkEquipmentBasis,checkCoverage,checkEvidence,checkBasis,calculate,project,demoPlan};
