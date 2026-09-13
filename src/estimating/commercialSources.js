'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter'),c=require('./commercialContract'),pricing=require('./pricingPlanContract');
function demo(state,item,review,now=new Date()){
 const base=require('./pricingSourceBasis').demo(state,item,review,now),prior=require('./pricingPolicySources').fromPricing(base,state.pricingPlans?.[item.ids.estimate]?.[0],review);
 const p=state.pricingPlans?.[item.ids.estimate]?.[0]||null,policy=state.pricingPolicies?.[item.ids.estimate]?.[0]||null,tax=state.taxProfiles?.[0]||null;
 const profile=state.workspace?.businessProfile||{},profilePin={id:'simulated-workspace',digest:sha256(profile)};
 const policyValid=policy?.action==='save'&&c.same(policy.sourcePins,review.pins)&&c.same(policy.pricingPin,prior.pricingPin)&&!!prior.pricingPin&&pricing.currentSource(policy.inputs.source,base);
 const {asOfDate,digest,...fixedBase}=base;
 const preparation=require('../commandCenter/demoTaxPreparation'),rules=preparation.rules(state),prepared=preparation.read(state,now);
 const eligible=rules.filter(r=>prepared.result.coverage.some(c=>c.state==='matched'&&c.rule.id===r.id&&c.rule.digest===r.digest));
 const payload=stableValue({sourcePins:review.pins,currency:review.currency,asOfDate,serviceKey:base.serviceKey,taxServiceKey:preparation.serviceIdentity(state,base.serviceKey),simulated:true,pricing:p,pricingPin:prior.pricingPin,pricingCurrent:!!prior.pricingPin,policy,policyPin:c.pin(policy),policyBasisCurrent:!!policyValid,profilePin,taxProfilePin:c.pin(tax),rulePins:rules.map(r=>({id:r.id,digest:r.digest})),validatedRules:eligible,sourceDigest:sha256(fixedBase),decision:review.decisions.current,decisionBasis:review.decisions.writeBasis,baseSources:base});
 return stableValue({...payload,digest:sha256(payload)});
}
function references(raw,input){return raw.simulated?raw.baseSources?.references||[]:require('./pricingSourceBasis').references(raw.baseSources||{},input);}
function visibleEvidence(evidence,raw,input){if(!evidence)return true;const sources={references:references(raw,input)};const pricingInputs=evidence.pricing?.inputs,policyInputs=evidence.policy?.inputs;return (!pricingInputs||pricing.sourceList(pricingInputs).every(s=>pricing.currentSource(s,sources)))&&(!policyInputs||pricing.currentSource(policyInputs.source,sources));}
function publicSources(raw){
 return stableValue({digest:raw.digest,asOfDate:raw.asOfDate,serviceKey:raw.serviceKey,...(raw.simulated?{taxServiceKey:raw.taxServiceKey}:{}),simulated:raw.simulated,currency:raw.currency,sourcePins:raw.sourcePins,decisionBasis:raw.decisionBasis,pricingPin:raw.pricingPin,pricingCurrent:raw.pricingCurrent,pricing:raw.pricingCurrent&&raw.pricing?{id:raw.pricing.id,result:raw.pricing.result}:null,policyPin:raw.policyPin,profilePin:raw.profilePin,taxProfilePin:raw.taxProfilePin,rulePins:raw.rulePins,validatedRules:raw.validatedRules,sourceDigest:raw.sourceDigest});
}
function project(data,review,raw,input,enabled,simulated,paused){
 function expose(e){if(!e)return null;const {evidence,requestKey,requestDigest,...safe}=e;const hidden=!visibleEvidence(evidence,raw,input);const state=c.currentState(e,raw,data.binding);return {...safe,inputs:hidden?null:safe.inputs,result:hidden?null:safe.result,reason:hidden?'A saved pricing source is no longer available.':safe.reason,sourceUnavailable:hidden,current:!hidden&&state.current,linkedApproval:!hidden&&state.linkedApproval===true};}
 const current=expose(data.current);let binding=null;
 if(current?.linkedApproval&&data.binding){const {requestKey,requestDigest,...publicBinding}=data.binding;binding=publicBinding;}
 const comparison=current&&!current.sourceUnavailable?c.comparison(data.current,raw):{state:'unavailable',reason:'source_unavailable',threshold:null,difference:null};
 return stableValue({contract:c.VERSION,simulated,canMutate:enabled&&review.isCurrent,mutationsPaused:paused,sourcePins:review.pins,decisionBasis:review.decisions.writeBasis,sources:publicSources(raw),current,history:(data.history||[]).map(expose),total:data.total||0,truncated:data.truncated===true,binding,comparison,customerSummary:binding?c.customerSummary(data.current,binding,raw):null,approvalState:binding?'commercial_approved':review.decisions.current?.action==='approve'?'scope_price_only':'not_approved'});
}
function applyCommercialPolicy(review){
 const terms=review.commercialTerms,plans=review.pricingPolicies,p=plans?.current;
 if(!terms?.binding||!terms.current?.current||terms.comparison.state==='unavailable'&&terms.comparison.reason!=='incomplete_policy'||!p?.sourceBasisCurrent||p.sourceUnavailable||!c.same(c.pin(p),terms.sources.policyPin)||!plans.sources.basis)return;
 const result=require('./pricingPolicyCalculation').calculate(p.inputs,review.currency,{...plans.sources.basis,reviewedPrice:terms.current.result.netBeforeTax});
 p.current=true;p.commercialApprovalCurrent=true;
 review.pricingPolicyCheck={state:result.threshold===null?'incomplete':'compared',result,message:'This policy is bound to the current full commercial approval. Tax collected is excluded from the price comparison.'+(p.currentAssessment?.cautions?.length?' Recorded source dates still need review.':'')};
}
module.exports={applyCommercialPolicy,demo,references,visibleEvidence,publicSources,project};
