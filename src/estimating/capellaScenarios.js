 'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const math=require('./pricingPolicyCalculation'),sourceContract=require('./pricingPlanContract');
const VERSION='NorthStarCapellaScenarios/v1',MAX=99999999999999n;
function fail(message,status=400){throw Object.assign(new Error(message),{status,code:status===409?'CAPELLA_BASIS_CHANGED':'CAPELLA_SCENARIO_INVALID'});}
function cents(v){try{return math.money(v);}catch(_){return null;}}
function delta(v){if(v===null)return null;if(typeof v!=='string'||!/^(-?)(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(v))fail('Enter each change as an amount with two decimal places.');return BigInt(v.replace('.',''));}
function add(v,d){if(v===null||d===null)return null;const n=v+d;if(n<0n||n>MAX)fail('A changed cost or price is outside the supported range.');return n;}
function sum(a,b){if(a===null||b===null)return null;return add(a,b);}
function pin(v){return v?{id:v.id,revision:v.revision,digest:v.digest}:null;}
function basis(review,item,now=new Date()){
 const pricing=review.pricingPlans,policy=review.pricingPolicies,p=pricing?.current;
 const direct=review.pins.revision?review.financialCosts?.knownDirectCosts:require('./pricingSourceBasis').basis(item,review).directCosts;
 const valid=p?.action==='save'&&p.sourceBasisCurrent===true&&!p.sourceUnavailable&&p.result?.directCosts===(direct??null);
 const d=review.decisions?.current,reviewed=d?.action==='approve'&&sha256(d.sourcePins)===sha256(review.pins)&&d.currency===review.currency?d:null;
 const commercial=review.commercialTerms,full=!!(commercial?.binding&&commercial.current?.current&&commercial.customerSummary);
 const sources=pricing?.sources||{},refs=(sources.references||[]).map(r=>({kind:r.kind,referenceId:r.referenceId,digest:r.digest,label:r.label}));
 const overhead=valid?p.result?.overhead:null;
 const prices=[];if(reviewed&&cents(reviewed.priceBeforeTax)!==null)prices.push({id:'reviewed',label:full?'Reviewed Net Price Before Tax':'Reviewed Scope And Price Before Tax',amount:full?commercial.current.result.netBeforeTax:reviewed.priceBeforeTax});if(valid&&cents(p.result?.proposedBeforeTax)!==null)prices.push({id:'proposed',label:'Saved Proposed Price Before Tax',amount:p.result.proposedBeforeTax});
 const policyCurrent=policy?.current,policyValid=policyCurrent?.current===true&&!policyCurrent.sourceUnavailable&&!!review.pricingPolicyCheck?.result;
 const payload={contract:VERSION,currency:review.currency,simulated:review.simulated===true,sourcePins:review.pins,selectedRevision:review.selectedRevision,historical:review.isCurrent===false,date:now.toISOString().slice(0,10),directCosts:direct??null,overhead:overhead||null,prices,references:refs,decision:pin(d),pricing:pin(p),policy:policyValid?{pin:pin(policyCurrent),inputs:policyCurrent.inputs}:null,commercial:full?{pin:pin(commercial.current),binding:commercial.binding}:null,componentManifest:review.componentManifest||null,coverage:review.coverageAssessment||null,sourceDigest:sources.digest||null,policySourcesDigest:policy?.sources?.digest||null,sourceCautions:{pricing:p?.currentAssessment||null,policy:policyCurrent?.currentAssessment||null},readiness:{notices:review.groundedRecommendations?.items.filter(x=>['readiness','travel_access','included_travel'].includes(x.id))||[],equipment:review.equipmentReadiness?{current:pin(review.equipmentReadiness.current),sources:review.equipmentReadiness.sources||null}:null,travel:review.travelPlans?{current:pin(review.travelPlans.current),resource:review.travelPlans.current?.resourceReview||null}:null,adoptedTravel:review.adoptedTravelPlan?{pin:pin(review.adoptedTravelPlan),resource:review.adoptedTravelPlan.resourceReview||null}:null}};
 return stableValue({...payload,digest:sha256(payload),enabled:require('./capellaScenarioPolicy').enabled});
}
function result(D,H,P,overhead,policy,currency){
 const C=sum(D,H),remaining=C===null||P===null?null:P-C;let check=null;
 if(policy){const r=math.calculate(policy.inputs,currency,{directCosts:math.decimal(D),overhead:{gross:math.decimal(H),alreadyIncluded:'0.00',incremental:math.decimal(H),overlapResolved:H!==null},proposedBeforeTax:math.decimal(P),reviewedPrice:null});check={allowance:r.allowance,policyBudget:r.policyCost,threshold:r.threshold,binding:r.binding,comparison:r.proposed,method:r.method,percent:r.percent,minimum:r.minimum};}
 return {directCosts:math.decimal(D),incrementalOverhead:math.decimal(H),netBeforeTax:math.decimal(P),modeledCosts:math.decimal(C),remaining:math.signed(remaining),breakEven:math.decimal(C),shortfall:remaining===null?null:math.decimal(remaining<0n?-remaining:0n),margin:remaining===null?null:math.ratio(remaining,P),markup:remaining===null?null:math.ratio(remaining,C),policy:check};
}
function calculate(b,input){
 if(!b.enabled)fail('Scenario analysis is temporarily unavailable. Your saved estimate and history remain available.',503);
 if(!math.exact(input,['basisDigest','priceBasis','scenarios']))fail('Check the scenario entries.');
 if(input.basisDigest!==b.digest)fail('The estimate or sources changed. Refresh before calculating again.',409);
 if(!Array.isArray(input.scenarios)||input.scenarios.length>2)fail('Use at most one favorable and one adverse scenario.');
 const chosen=b.prices.find(p=>p.id===input.priceBasis);if(!chosen)fail('Select an available saved price before calculating.');
 const D=cents(b.directCosts),rawH=b.overhead,H=rawH?.overlapResolved===true?cents(rawH.incremental):null,P=cents(chosen.amount),base=result(D,H,P,rawH,b.policy,b.currency),seen=new Set();
 const scenarios=input.scenarios.map(v=>{
  if(!math.exact(v,['kind','directChange','overheadChange','priceChange','overheadSeparate','source'])||!['favorable','adverse'].includes(v.kind)||seen.has(v.kind)||typeof v.overheadSeparate!=='boolean')fail('Review the scenario entries.');seen.add(v.kind);
  math.source(v.source);if(!v.source.note?.trim())fail('Explain the assumptions behind each scenario.');if(!sourceContract.currentSource(v.source,{references:b.references}))fail('A selected source changed or is unavailable. Refresh and choose an available source.',409);
  const dd=delta(v.directChange),dh=delta(v.overheadChange),dp=delta(v.priceChange),d2=add(D,dd),h2=v.overheadSeparate?add(H,dh):null,p2=add(P,dp),r=result(d2,h2,p2,rawH,b.policy,b.currency);
  const shift=r.remaining===null||base.remaining===null?null:delta(r.remaining)-delta(base.remaining);if(shift!==null&&(v.kind==='favorable'&&shift<0n||v.kind==='adverse'&&shift>0n))fail('Favorable must leave at least the base amount remaining; adverse must leave no more. Review the changes.');
  const s=v.source,cautions=[];if(!s.effectiveOn)cautions.push('Date Not Recorded');else if(s.effectiveOn>b.date)cautions.push('Not Yet Effective');if(!s.endsOn)cautions.push('Freshness Unknown');else if(s.endsOn<b.date)cautions.push('Source Date Has Passed');
  return {kind:v.kind,assumptions:v,cautions,result:r,changeInRemaining:math.signed(shift)};
 });
 return stableValue({contract:VERSION,basisDigest:b.digest,assumptionsDigest:sha256(input),sourcePins:b.sourcePins,selectedRevision:b.selectedRevision,currency:b.currency,simulated:b.simulated,historical:b.historical,priceLabel:chosen.label,base,scenarios,sensitivity:{costIncrease:'1.00',remainingDecrease:'1.00',netPriceIncrease:'1.00',remainingIncrease:'1.00'},limitation:'Unsaved assumptions, not a prediction or approval. Tax collected is excluded. Financial results do not establish safe or available resources.'});
}
module.exports={VERSION,basis,calculate,delta,result};
