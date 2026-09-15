'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const contract=require('./proposalAdoptionContract'),proposal=require('./estimateProposal'),recipeEngine=require('./proposalRecipe');
const composition=require('./travelCostComposition'),equipment=require('./equipmentPlanContract'),cost=require('./equipmentCostPlanContract');
const labor=require('./laborPlanContract'),travel=require('./travelPlanContract'),pricing=require('./pricingPlanContract');
const names={materials:'materialPlans',labor:'laborPlans',equipment:'equipmentPlans',travel:'travelPlans',pricing:'pricingPlans'};
function draftId(value){const h=sha256(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
function pin(p){return p?{id:p.id,revision:p.revision,digest:p.digest,action:p.action}:null;}
function bindOverhead(inputs,laborPlan,replacing){
 const value=stableValue(inputs);
 for(const part of value.overhead.coverage.included){
  if(part.referenceId.startsWith('labor:prepared:')){
   const lineId=part.referenceId.slice('labor:prepared:'.length);
   if(!replacing||!laborPlan?.inputs.lines.some(l=>l.lineId===lineId))contract.fail('Choose the exact work cost covering this overhead.');
   part.referenceId='labor:'+laborPlan.id+':'+lineId;
  }
 }
 return value;
}
function build(context,raw,{equipmentSources=context.sources,history=[]}={}){
 const body=contract.normalize(raw,{preview:true}),{review,item,sources,now}=context;
 if(item.calculationVersion!==require('./materialAdoptionContract').BASE_VERSION)contract.fail('This earlier estimate cannot adopt new cost plans. Keep its original record and prepare a supported estimate.');
 const base=proposal.build(context,body.draft);
 const available=proposal.applicableRecipes(sources,item,body.draft.overrides);
 if(available.length!==1||!base.recipe||base.readiness==='blocked')contract.fail('Resolve the recipe or resource questions before adopting this estimate.');
 const recipe=recipeEngine.normalize(available[0].recipe),facts={...sources.facts};
 for(const o of body.draft.overrides)facts[o.fieldId]={value:o.value,unit:o.unit,source:o.reason};
 const evaluation=recipeEngine.evaluate(recipe,facts,new Date(now));
 if(evaluation.state!=='calculated'||base.questions.some(q=>!q.id.endsWith('_saved')&&!['resource_readiness','cost_coverage'].includes(q.id)))contract.fail('Finish the required job and source details before adopting this estimate.');
 const current=history[0]||null;if(sha256(body.previousReceipt)!==sha256(current?{id:current.id,revision:current.revision,digest:current.digest}:null))contract.fail('Saved estimate history changed. Refresh and review it again.',409);
 const plans={},inputs={},writes={},componentPins={};
 for(const kind of contract.KINDS){
  const saved=review[names[kind]]?.current;componentPins[kind]=pin(saved);
  if(body.selection[kind]==='retain'){
   const retained={materials:review.adoptedMaterialPlan,labor:review.adoptedLaborPlan,travel:review.adoptedTravelPlan,pricing:saved,equipment:null}[kind]||null;
   if(retained&&(!retained.inputs||retained.action!=='save'||retained.sourceUnavailable))contract.fail('A retained cost source is unavailable. Review the saved estimate before adopting a replacement.',409);
   plans[kind]=retained;continue;
  }
  const c=recipe.components.find(c=>c.kind===kind);if(!c)contract.fail('The current recipe does not provide this replacement.');
  const value=proposal.inputsFor(c,evaluation,review.currency);if(!value)contract.fail('Complete the measured quantities before adopting the estimate.');
  if(kind==='labor')value.assessment={...labor.assess(value,now),acknowledged:true,explanation:body.reason};
  if(kind==='equipment')value.assessment={...equipment.assessment(equipment.evaluate(value,equipmentSources,new Date(now))),acknowledged:true};
  if(kind==='travel')value.assessment={...travel.assess(value,review.travelPlans.sources,now),acknowledged:true,explanation:body.reason};
  if(kind==='pricing'){
   if(!body.coverage.overhead)contract.fail('Review which overhead costs are already included.');
   value.overhead.coverage=stableValue(body.coverage.overhead);
  }
  inputs[kind]=value;
  const p={id:draftId({basis:base.basisDigest,kind,inputs:value}),revision:(saved?.revision||0)+1,digest:sha256(value),action:'save',sourcePins:review.pins,currency:review.currency,inputs:value,calculationVersion:c.version};plans[kind]=p;
  writes[kind]={action:'save',expectedRevision:saved?.revision||0,expectedDigest:saved?.digest||'none',sourcePins:review.pins,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,inputs:value,currency:review.currency,reason:body.reason,confirmed:true,confirmationVersion:c.version};
 }
 componentPins.equipmentCost=pin(review.equipmentCostPlans?.current);
 let equipmentCost=review.adoptedEquipmentCostPlan||null;
 if(body.selection.equipment==='replace'){
  const value={serviceKey:item.snapshot.service.key,equipmentBasis:cost.reference(plans.equipment),lines:stableValue(recipe.equipmentCostLines),assessment:null};
  const assessed=equipment.evaluate(plans.equipment.inputs,equipmentSources,new Date(now));
  value.assessment={...cost.assess(value,assessed,now),acknowledged:true,explanation:body.reason};
  cost.checkEquipmentBasis(value,plans.equipment,equipmentSources,new Date(now));cost.calculate(value,review.currency);
  equipmentCost={id:draftId({basis:base.basisDigest,kind:'equipmentCost',inputs:value}),revision:(review.equipmentCostPlans?.current?.revision||0)+1,digest:sha256(value),action:'save',sourcePins:review.pins,currency:review.currency,inputs:value,calculationVersion:cost.VERSION};
  writes.equipmentCost={...writes.equipment,inputs:value,expectedRevision:review.equipmentCostPlans?.current?.revision||0,expectedDigest:review.equipmentCostPlans?.current?.digest||'none',confirmationVersion:cost.VERSION};
 }
 const pair={material:plans.materials,labor:plans.labor,equipment:equipmentCost,travel:plans.travel};
 const coverage={...body.coverage.costs,componentManifest:composition.manifest(pair)};
 const choicesReview={...review,adoptedMaterialPlan:pair.material,adoptedLaborPlan:pair.labor,adoptedEquipmentCostPlan:pair.equipment,adoptedTravelPlan:pair.travel,materialPlans:{current:pair.material},laborPlans:{current:pair.labor},equipmentCostPlans:{current:pair.equipment},travelPlans:{current:pair.travel}};
 const choiceSet=composition.coverageChoices(choicesReview),coverageOptions=choiceSet.travel||choiceSet.equipment||choiceSet.labor||choiceSet.material||null;
 if(coverageOptions&&!coverageOptions.unavailable&&((coverageOptions.equipmentOutside.length&&!coverage.equipmentOutside.length)||(coverageOptions.travelOutside.length&&!coverage.travelOutside.length))){
  return {body,review:stableValue({version:contract.VERSION,state:'incomplete',incompleteReason:'coverage',coverageOptions,reviewDigest:sha256({base:base.basisDigest,body,componentPins,coverageOptions}),completeCost:null,price:null,financialCosts:null,policy:null,overheadOptions:[],sourcePins:review.pins,componentPins,recipe:base.recipe,selection:body.selection,expiresAt:base.expiresAt}),writes,pair,coverage,recipePin:base.recipe.source,recipe};
 }
 const result=composition.calculate(item,pair,coverage);
 if(result.knownDirectCosts===null)contract.fail('Complete every applicable cost before adopting this estimate.');
 const hypothetical={...review,financialCosts:result,componentManifest:composition.manifest(pair),coverageAssessment:coverage,adoptedLaborPlan:pair.labor};
 // The aggregate review has a new cost basis even before a durable child ID exists.
 const priceBasis={...require('./pricingSourceBasis').basis(item,{...hypothetical,pins:{...review.pins,revision:{calculationVersion:composition.VERSION}}}),directCosts:result.knownDirectCosts};
 let priceResult=null;if(writes.pricing){const source={...review.pricingPlans.sources,basis:priceBasis};priceResult=pricing.preview(bindOverhead(writes.pricing.inputs,pair.labor,body.selection.labor==='replace'),review.currency,source,now).result;}
 let policyResult=null;
 if(body.pricingPolicy){
  const policy=require('./pricingPolicyContract'),saved=review.pricingPolicies.current,existingSources=review.pricingPolicies.sources;
  if(body.pricingPolicy.sourceDigest!==existingSources.digest||sha256(body.pricingPolicy.currentPin)!==sha256(saved?policy.pin(saved):null))contract.fail('The saved policy or its sources changed. Refresh and review again.',409);
  const candidate={...plans.pricing,result:priceResult},newSources=require('./pricingPolicySources').fromPricing({...review.pricingPlans.sources,basis:priceBasis},candidate,{...review,decisions:{current:null}});
  policyResult=policy.preview(body.pricingPolicy.inputs,review.currency,newSources,now).result;
  if(policyResult.threshold===null)contract.fail('Complete the pricing policy before adopting it.');
  writes.pricingPolicy={...writes.pricing,inputs:stableValue(body.pricingPolicy.inputs),expectedRevision:saved?.revision||0,expectedDigest:saved?.digest||'none',confirmationVersion:policy.VERSION,evidenceDigest:newSources.digest,pricingPin:policy.pin(candidate)};
 }
 const digestBody={version:contract.VERSION,sourcePins:review.pins,basisDigest:base.basisDigest,recipe:base.recipe,componentPins,decisionBasis:review.decisions.writeBasis,inputs,selection:body.selection,coverage,pricingPolicy:body.pricingPolicy,result,priceResult,policyResult,previousReceipt:body.previousReceipt,expiresAt:base.expiresAt};
 const reviewResult=stableValue({version:contract.VERSION,state:writes.pricing&&(priceResult.costWithOverhead===null||priceResult.proposedBeforeTax===null)?'incomplete':'ready',overheadOptions:priceBasis.overheadIncluded.map(v=>({...v,referenceId:body.selection.labor==='replace'?v.referenceId.replace('labor:'+pair.labor.id+':','labor:prepared:'):v.referenceId})),reviewDigest:sha256(digestBody),coverageOptions,completeCost:result.knownDirectCosts,financialCosts:result,price:priceResult,policy:policyResult,sourcePins:review.pins,componentPins,recipe:base.recipe,selection:body.selection,expiresAt:base.expiresAt,notice:'Saving retains the original estimate and adds these reviewed cost plans and the proposed price. Price approval is a separate review.'});
 return{body,review:reviewResult,writes,pair,coverage,recipePin:base.recipe.source,recipe,priceBasis};
}
module.exports={build,pin,draftId,bindOverhead};
