'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const equipment=require('./demoEquipmentPlans');
const planContract=require('../estimating/equipmentPlanContract');
const contract=require('../estimating/equipmentReadinessContract');
const repository=require('../estimating/equipmentReadinessRepository');
const VERSION='demo-equipment-readiness-basis-v1';
function createEquipmentBasis(seed,createdAt){
 const basis=equipment.create(seed,createdAt),original=basis.assets[0];
 const extra=['Downtime Example','Fault And Maintenance Example','Unknown History Example','Held For First Demo Job','Held For Second Demo Job'].map(name=>({...original,id:require('uuid').v5(String(seed)+':'+name,'311d4d87-1275-441f-b054-87c03dcc8bcc'),name:'Practice Auger — '+name}));
 return stableValue({...basis,readinessVersion:VERSION,assets:[original,...extra]});
}
function create(seed,createdAt,graphs=[],team=null){
 const basis=createEquipmentBasis(seed,createdAt),at=new Date(createdAt).toISOString();
 const worker=team?.members.find(m=>m.accessRole==='member');
 const checkouts=worker?basis.assets.slice(4,6).flatMap((asset,i)=>{const graph=graphs[i];return graph?[{assetId:asset.id,checkoutJob:{appointmentId:graph.ids.appointment,operatorId:worker.id,executionId:null},events:[{revision:1,kind:'declared_checkout',observedAt:at,description:'Simulated equipment hold for this existing demo job; execution has not been initialized.'}],state:{revision:1,effectiveFactCount:1,checkedOutExecution:null,operator:worker.id,downtime:false,recordedFault:false,readings:{},availability:'unknown'}}]:[];}):[];
 return stableValue({version:VERSION,simulated:true,createdAt:at,assets:basis.assets.slice(0,3).map((a,i)=>{const kinds=i===1?['downtime_start']:i===2?['fault','maintenance']:['condition'];return {assetId:a.id,events:kinds.map((kind,n)=>({revision:n+1,kind,observedAt:at,description:'Authored practice equipment record; condition still requires a current human review.'})),state:{revision:kinds.length,effectiveFactCount:kinds.length,checkedOutExecution:null,operator:null,downtime:i===1,recordedFault:i===2,readings:{},availability:i===1?'recorded_unavailable':i===2?'needs_review':'unknown'}};}).concat(checkouts)});
}
function rawSources(state,item,inputs=null,now=new Date()){
 const plan=state.equipmentPlans?.[item.ids.estimate]?.[0],basis=plan?.action==='save'?{planId:plan.id,revision:plan.revision,digest:plan.digest}:null;
 if(inputs){contract.validate(inputs);if(sha256(inputs.equipmentBasis)!==sha256(basis))contract.fail('The equipment plan changed. Refresh and review again.',409);if(inputs.lines.length!==plan.inputs.lines.length||inputs.lines.some(l=>!plan.inputs.lines.some(p=>p.lineId===l.lineId)))contract.fail('Review every item in the saved equipment plan.');}
 if(!basis)return {equipmentBasis:null,lines:[],digest:sha256({equipment:plan?.id||null,action:plan?.action||null})};
 const sources=equipment.sources(state,item,plan.inputs),operational=state.equipmentReadinessBasis?.version===VERSION?state.equipmentReadinessBasis:null;
 const adopted=state.estimateRevisions?.[item.ids.estimate]?.[0]?.componentManifest?.equipment?.equipmentBasis;
 function fact(l,sources,diverged){
  const found=planContract.resolvedLine(l,sources),record=operational?.assets.find(a=>a.assetId===l.assetId),events=record?.events||[];
  let requirementStatus='needs_information';try{requirementStatus=planContract.evaluate({...plan.inputs,lines:[l]},sources,now).lines[0].status;}catch(error){if(error.status!==409)throw error;}
  const checkout=record?.checkoutJob,actual=checkout?require('./demoOperations').workFor(state,checkout.appointmentId)?.execution:null,currentAppointment=item.ids.appointment;
  const checkoutFact=checkout?{appointmentId:checkout.appointmentId,operatorId:checkout.operatorId,currentJob:checkout.appointmentId===currentAppointment,targetMatches:false,executionKnown:!!actual&&actual.appointmentId===checkout.appointmentId,executionId:actual?.appointmentId===checkout.appointmentId?actual.id:null}:null;
  return {declaredCheckout:checkoutFact,lineId:l.lineId,assetId:l.assetId,ledgerRevision:record?.state?.revision||0,ledgerDigest:record?sha256(record):null,complete:!!record&&record.state.revision===events.length&&events.every((e,i)=>e.revision===i+1),recordedAt:record?operational.createdAt:null,observedAt:events.at(-1)?.observedAt||null,state:record?.state||{},meterReset:events.filter(e=>e.reading!==undefined).at(-1)?.kind==='meter_reset',meterResets:Object.fromEntries(events.filter(e=>e.kind==='meter_reset'&&e.meterKey).map(e=>[e.meterKey,e.observedAt])),observations:events.filter(e=>['condition','fault','maintenance','downtime_start','downtime_end'].includes(e.kind)).slice(-4).reverse().map(e=>({kind:e.kind,observedAt:e.observedAt,description:e.description})),currentJob:false,targetMatches:false,sourceCurrent:!!found.asset&&!found.issue&&found.asset.reviewState==='reviewed',requirementStatus,basisDiverged:diverged};
 }
 const lines=plan.inputs.lines.map(l=>fact(l,sources,!!adopted&&adopted.planId!==plan.id));
 const comparison=inputs||(state.equipmentReadinessPlans?.[item.ids.estimate]||[]).find(p=>p.action==='save'&&sha256(p.inputs.equipmentBasis)===sha256(basis))?.inputs;
 const alternatives=(comparison?.lines||[]).flatMap(l=>l.alternatives.map(a=>{const original=plan.inputs.lines.find(x=>x.lineId===l.lineId),candidate={...original,assetId:a.assetId,identity:a.identity,requirements:original.requirements.map(q=>({...q,specificationIndex:null}))},candidateSources=equipment.sources(state,item,{...plan.inputs,lines:[candidate]});return {...fact(candidate,candidateSources,true),alternativeId:a.alternativeId,sourceDigest:candidateSources.authorityDigest};}));
 const payload=stableValue({equipmentBasis:basis,equipmentSourceDigest:sources.authorityDigest,lines,alternatives});return {...payload,digest:sha256(payload)};
}
function replacementCheck(state,item,inputs){
 const p=inputs.replacement;if(!p)return;
 const old=(state.equipmentReadinessPlans?.[item.ids.estimate]||[]).find(e=>e.id===p.readinessId&&e.action==='save'),line=old?.inputs.lines.find(l=>l.lineId===p.lineId),alternative=line?.alternatives.find(a=>a.alternativeId===p.alternativeId);
 const plan=state.equipmentPlans?.[item.ids.estimate]?.[0],next=plan?.inputs?.lines.find(l=>l.lineId===p.lineId);
 if(!old||sha256(old.inputs.equipmentBasis)!==sha256(p.equipmentBasis)||!alternative||!next||plan.revision<=p.equipmentBasis.revision||next.assetId!==alternative.assetId||sha256(next.identity)!==sha256(alternative.identity))contract.fail('Save the selected replacement in the equipment plan, then review readiness again.',409);
}
function save(state,item,history,review,raw,key,now){
 const body=contract.normalize(raw),requestDigest=sha256(body),old=history.find(e=>e.requestKey===key);
 if(old){if(old.requestDigest!==requestDigest)contract.fail('This save attempt changed. Refresh and review again.',409);return {receipt:old,replayed:true};}
 contract.checkBasis(body,review,history[0]);if(body.action==='withdraw'&&history[0]?.action!=='save')contract.fail('There is no saved readiness review to withdraw.');
 if(history.length>=20)contract.fail('This demo cannot accept another equipment readiness entry. Saved history remains available. Resetting the demo clears its practice work.',429);
 const evidence=body.action==='save'?rawSources(state,item,body.inputs,now):null;
 if(evidence){replacementCheck(state,item,body.inputs);contract.requireReview(body.inputs,evidence,now);}
 const receipt={id:require('node:crypto').randomUUID(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,...body,calculationVersion:contract.VERSION,actorName:'Demo Reviewer',createdAt:now.toISOString(),evidence,requestKey:key,requestDigest,digest:sha256({body,evidence,previous:history[0]?.digest||null})};return{receipt,replayed:false};
}
async function project(state,item,review,now=new Date()){
 const history=state.equipmentReadinessPlans?.[item.ids.estimate]||[];
 return repository.project(null,{current:history[0]||null,history,total:history.length},review,equipment.actor(item),true,now,inputs=>rawSources(state,item,inputs,now));
}
module.exports={VERSION,createEquipmentBasis,create,rawSources,replacementCheck,save,project};
