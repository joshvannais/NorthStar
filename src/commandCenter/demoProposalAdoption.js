'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const revision=require('../estimating/estimateRevisionReview'),contract=require('../estimating/proposalAdoptionContract');
const builder=require('../estimating/proposalAdoptionReview'),composition=require('../estimating/travelCostComposition');
const equipment=require('./demoEquipmentPlans'),equipmentCost=require('../estimating/equipmentCostPlanContract');
const uuid=()=>require('node:crypto').randomUUID();
function data(state,id,key){const history=state[key]?.[id]||[];return{current:history[0]||null,history,total:history.length};}
async function review(record,item,now){
 const state=record.state,id=item.ids.estimate,selected=revision.selectDemoRevision(item,state.estimateRevisions?.[id]||[]),r=revision.buildRevisionReview(item,selected,{simulated:true});
 r.decisions=revision.projectSelectedDemoDecisions(state.estimateDecisions?.[id]||[],r,require('../estimating/decisionPolicy').mutationsEnabled);r.demoWorkspaceRevision=record.revision;
 r.equipmentPlans=await equipment.project(state,item,r);
 for(const[k,c]of [['materialPlans','materialPlanContract'],['laborPlans','laborPlanContract'],['equipmentCostPlans','equipmentCostPlanContract']])r[k]=require('../estimating/'+c).project(data(state,id,k),r,true,true,false,now);
 r.travelPlans=require('./demoTravel').project(state,item,r);
 r.pricingPlans=require('../estimating/pricingPlanContract').project(data(state,id,'pricingPlans'),r,require('../estimating/pricingSourceBasis').demo(state,item,r,now),true,true,false,now);
 r.pricingPolicies=require('../estimating/pricingPolicyContract').project(data(state,id,'pricingPolicies'),r,require('../estimating/pricingPolicySources').demo(state,item,r,now),true,true,false,now);
 return r;
}
async function prepare(record,item,body,workspace,now){
 require('../estimating/proposalAdoptionRepository').checkPolicy(body);
 const r=await review(record,item,now),context=require('../estimating/estimateProposalRepository').demoContext(record,r,item,now,workspace);
 const recipe=context.sources.knowledge.find(k=>k.content?.estimateProposalRecipe?.serviceKey===item.snapshot.service.key)?.content.estimateProposalRecipe;
 const eq=recipe?.components.find(c=>c.kind==='equipment')?.inputs;
 return{...builder.build(context,body,{equipmentSources:equipment.sources(record.state,item,eq),history:data(record.state,item.ids.estimate,'proposalAdoptions').history}),loadedReview:r};
}
async function apply(record,item,body,key,workspace,now){
 body=contract.normalize(body);require('../estimating/proposalAdoptionRepository').checkPolicy(body);
 const id=item.ids.estimate,history=data(record.state,id,'proposalAdoptions').history,old=contract.checkReplay(history,body,key);
 if(old)return{state:record.state,receipt:old,replayed:true};
 if(history.length>=20)contract.fail('This demo has reached its saved estimate limit. History remains available. Resetting clears its practice work.',429,'PROPOSAL_ADOPTION_HISTORY_LIMIT');
 const histories={materials:['materialPlans'],labor:['laborPlans'],equipment:['equipmentPlans','equipmentCostPlans'],travel:['travelPlans'],pricing:['pricingPlans']};
 const selectedHistory=Object.entries(histories).filter(([kind])=>body.selection[kind]==='replace').flatMap(([,keys])=>keys);if(body.pricingPolicy)selectedHistory.push('pricingPolicies');
 if(selectedHistory.some(k=>data(record.state,id,k).history.length>=20))contract.fail('This demo has reached a saved-plan limit. History remains available. Resetting clears its practice work.',429,'PROPOSAL_ADOPTION_HISTORY_LIMIT');
 const prepared=await prepare(record,item,body,workspace,now);contract.assertCurrent(prepared.review,body,now);
 const state=stableValue(record.state),r=prepared.loadedReview,receipts={};
 function append(k,receipt){const h=data(state,id,k).history;state[k]={...state[k],[id]:[receipt,...h]};return receipt;}
 for(const kind of ['materials','labor','equipment','equipmentCost','travel']){
  const raw=prepared.writes[kind];if(!raw)continue;
  const subkey=sha256({key,kind}),keys={materials:'materialPlans',labor:'laborPlans',equipment:'equipmentPlans',equipmentCost:'equipmentCostPlans',travel:'travelPlans'},k=keys[kind],h=data(state,id,k).history;
  let result;
  if(kind==='equipment')result=equipment.save(state,item,h,r,raw,subkey,now);
  else if(kind==='equipmentCost'){
   raw.inputs.equipmentBasis=equipmentCost.reference(receipts.equipment);
   result=equipmentCost.demoPlan(h,r,raw,subkey,now,receipts.equipment,equipment.sources(state,item,receipts.equipment.inputs),require('../estimating/equipmentCostComposition').outsideBasis(revision.selectDemoRevision(item,state.estimateRevisions?.[id]||[]),{...item,sourcePins:r.pins}));
  }else if(kind==='travel'){
   const sources=require('./demoTravel').sources(state,item);raw.inputs.assessment.sourcesDigest=sources.digest;
   result=require('../estimating/travelPlanContract').demoPlan(h,r,raw,subkey,now,sources);
   result.receipt.evidence=sources;
  }else result=require('../estimating/'+(kind==='materials'?'materialPlanContract':'laborPlanContract')).demoPlan(h,r,raw,subkey,now);
  receipts[kind]=append(k,result.receipt);
 }
 const existing=revision.selectDemoRevision(item,state.estimateRevisions?.[id]||[]),pair={material:receipts.materials||prepared.pair.material,labor:receipts.labor||prepared.pair.labor,equipment:receipts.equipmentCost||prepared.pair.equipment,travel:receipts.travel||prepared.pair.travel};
 const coverage={...body.coverage.costs,componentManifest:composition.manifest(pair)},calculated=composition.calculate(item,pair,coverage);
 if(calculated.knownDirectCosts!==prepared.review.completeCost)contract.fail('The resulting costs changed. Refresh and review again.',409);
 if((state.estimateRevisions?.[id]||[]).length>=20)contract.fail('This demo has reached its estimate history limit. Saved history remains available. Resetting clears its practice work.',429,'PROPOSAL_ADOPTION_HISTORY_LIMIT');
 const childId=uuid(),number=existing.currentRevision+1,fingerprint=sha256({original:existing.originalPins,parent:r.pins,components:composition.manifest(pair),coverage,calculationVersion:composition.VERSION}),digest=sha256({id:childId,number,fingerprint,body});
 const child={id:childId,revision:number,previousId:existing.selected?.id||null,digest,materialPlanId:pair.material?.id||null,materialPlan:pair.material,laborPlanId:pair.labor?.id||null,laborPlan:pair.labor,equipmentCostPlanId:pair.equipment?.id||null,equipmentCostPlan:pair.equipment,travelPlanId:pair.travel?.id||null,travelPlan:pair.travel,sourcePins:r.pins,originalSourcePins:existing.originalPins,componentManifest:composition.manifest(pair),coverageAssessment:coverage,changedComponent:'prepared',calculationVersion:composition.VERSION,confirmationVersion:composition.VERSION,inputFingerprint:fingerprint,reason:body.reason,expectedDecisionRevision:r.decisions.writeBasis.revision,expectedDecisionDigest:r.decisions.writeBasis.digest,createdAt:now.toISOString(),actorName:'Demo reviewer',requestKey:sha256({key,kind:'child'}),requestDigest:sha256(body),pins:{...existing.originalPins,revision:{id:childId,number,digest,calculationVersion:composition.VERSION,inputFingerprint:fingerprint}}};append('estimateRevisions',child);
 const childReview=await review({...record,state},item,now);
 if(prepared.writes.pricing){const raw=prepared.writes.pricing,sources=require('../estimating/pricingSourceBasis').demo(state,item,childReview,now);raw.inputs=builder.bindOverhead(raw.inputs,pair.labor,body.selection.labor==='replace');raw.sourcePins=childReview.pins;raw.evidenceDigest=sources.digest;const result=require('../estimating/pricingPlanContract').demoPlan(data(state,id,'pricingPlans').history,childReview,raw,sha256({key,kind:'pricing'}),now,sources);receipts.pricing=append('pricingPlans',result.receipt);if(sha256(receipts.pricing.result)!==sha256(prepared.review.price))contract.fail('The proposed price changed. Refresh and review again.',409);}
 if(prepared.writes.pricingPolicy){const raw=prepared.writes.pricingPolicy,sources=require('../estimating/pricingPolicySources').demo(state,item,childReview,now);raw.sourcePins=childReview.pins;raw.evidenceDigest=sources.digest;raw.pricingPin=sources.pricingPin;const result=require('../estimating/pricingPolicyContract').demoPlan(data(state,id,'pricingPolicies').history,childReview,raw,sha256({key,kind:'policy'}),now,sources);receipts.pricingPolicy=append('pricingPolicies',result.receipt);if(sha256(result.receipt.result)!==sha256(prepared.review.policy))contract.fail('The pricing policy changed. Refresh and review again.',409);}
 const receipt={id:uuid(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,version:contract.VERSION,sourcePins:r.pins,originalSourcePins:existing.originalPins,parentId:existing.selected?.id||null,childId,componentManifest:child.componentManifest,pricingPlanId:receipts.pricing?.id||null,pricingPolicyId:receipts.pricingPolicy?.id||null,recipePin:prepared.recipePin,body,reviewedResult:prepared.review,createdAt:now.toISOString(),actorName:'Demo reviewer',requestKey:key,requestDigest:contract.requestDigest(body)};receipt.digest=sha256({body,child:child.digest,previous:history[0]?.digest||null,receipts});append('proposalAdoptions',receipt);
 return{state:stableValue(state),receipt,replayed:false};
}
function publicReceipt(r){if(!r)return null;const{requestKey,requestDigest,body,reviewedResult,recipePin,...safe}=r;return safe;}
module.exports={prepare,apply,review,publicReceipt};
