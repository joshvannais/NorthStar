"use strict";
// Read-only deterministic projection. No model execution, calculator inputs or approvals.
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const {buildEstimateReview}=require('../services/estimateReview');
const policy=require('./groundedRecommendationPolicy');
const VERSION='NorthStarGroundedRecommendations/v1';
const UNKNOWN=/^(unknown|unavailable|not recorded|not sure|unsure|n\/a)$/i;
const UNITS={linearFeet:'ft',sqft:'sq_ft',squareFeet:'sq_ft',acres:'acre',laborHours:'person_hour',hours:'hour',tonnage:'ton',seer:'SEER'};
// Explicit recursive types: no coercion, fuzzy matching, discarded fields, or guessed units.
function typedScope(scope){
 if(!scope||typeof scope!=='object'||Array.isArray(scope)||!Object.keys(scope).length)return null;
 let count=0;
 function read(v,key,container,depth){
  if(++count>128||depth>4||v===null||v===undefined)return null;
  if(typeof v==='boolean')return {type:'boolean',value:v};
  if(typeof v==='number'){
   if(!Number.isFinite(v)||v<0)return null;
   const unit=UNITS[key]||container[key+'Unit'];
   if(typeof unit!=='string'||!unit.trim()||UNKNOWN.test(unit))return null;
   return {type:'measurement',value:v,unit};
  }
  if(typeof v==='string')return v.trim()&&!UNKNOWN.test(v.trim())&&v.length<=500?{type:'text',value:v}:null;
  if(Array.isArray(v)){if(v.length>24)return null;const values=v.map(x=>read(x,key,container,depth+1));return values.every(Boolean)?{type:'array',value:values}:null;}
  if(typeof v==='object'){const value={};for(const k of Object.keys(v).sort()){if(k.length>100)return null;value[k]=read(v[k],k,v,depth+1);if(!value[k])return null;}return Object.keys(value).length?{type:'object',value}:null;}
  return null;
 }
 return read(scope,'scope',scope,0);
}
function comparisonKey(item){const s=item?.snapshot?.service,currency=item?.estimate?.currency;
 if(s?.supported!==true||typeof s.key!=='string'||!s.key.trim()||UNKNOWN.test(s.key)||!(/^[A-Z]{3}$/).test(currency||''))return null;
 const scope=typedScope(s.scope);return scope?sha256({service:s.key,currency,scope}):null;
}
function comparisons(item,candidates=[],hasMore=false){
 const key=comparisonKey(item),page=candidates.slice(0,50),eligible=[];
 if(key&&Number.isFinite(Date.parse(item.snapshotCreatedAt)))for(const c of page){if(c.ids?.estimate===item.ids?.estimate||!c.snapshotCreatedAt||!Number.isFinite(Date.parse(c.snapshotCreatedAt))||Date.parse(c.snapshotCreatedAt)>=Date.parse(item.snapshotCreatedAt)||comparisonKey(c)!==key)continue;
  try{const r=buildEstimateReview(c);eligible.push({sourcePins:{estimateId:r.pins.estimateId,snapshotId:r.pins.snapshotId,snapshotDigest:r.pins.snapshotDigest,calculationVersion:r.pins.calculationVersion,normalizedInputFingerprint:r.pins.normalizedInputFingerprint},recordedAt:r.recordedAt,currency:r.currency,amount:r.rows[0].amount,sourceState:r.rows[0].sourceState});}catch(_){/* Incomplete provenance cannot establish a comparison. */}
 }
 eligible.sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt)||a.sourcePins.estimateId.localeCompare(b.sourcePins.estimateId));
 // Pins are protocol provenance only. UI never renders identities.
 return {state:key?'searched':'scope_unavailable',examined:page.length,eligible:eligible.length,truncated:hasMore||candidates.length>50,examples:eligible.slice(0,3)};
}
function build(review,item,options={}){
 const now=new Date(options.now||Date.now()).toISOString();
 if(!policy.enabled)return {contract:VERSION,state:'unavailable',message:'Review suggestions are temporarily unavailable. Your saved estimate and history remain available.',items:[],sources:[],comparisons:{state:'unavailable',examples:[]}};
 const rows=[],sources=[],save=x=>x?.action==='save',at=(id,label,kind,detail={})=>{const value={id,label,kind,...detail};if(!sources.some(x=>x.id===id))sources.push(value);return id;};
 const add=(id,priority,title,reason,action,refs)=>rows.push({id,priority,title,reason,action:review.isCurrent?action:null,sourceIds:refs});
 const selected=at('selected','Selected Estimate','calculated_result',{recordedAt:review.recordedAt,pins:review.pins});
 if((review.missing||[]).length||review.financialCosts?.knownDirectCosts===null)add('costs',1,'Complete The Cost Basis','Some applicable costs or reviewed allocations are missing. Ask the owner or estimator to review them before relying on the total.','costs',[selected]);
 const definitions=[['material','materialPlans','materials'],['labor','laborPlans','labor'],['equipment','equipmentPlans','equipment'],['equipment_cost','equipmentCostPlans','equipment_cost'],['travel','travelPlans','travel'],['pricing','pricingPlans','pricing'],['policy','pricingPolicies','policy'],['commercial','commercialTerms','commercial']];
 for(const [id,key,action]of definitions){const p=review[key]?.current;if(!save(p))continue;
  const ref=at(id,'Saved '+({equipment_cost:'Equipment Costs',policy:'Pricing Policy',commercial:'Commercial Terms'}[id]||id[0].toUpperCase()+id.slice(1)),'owner_declaration',{recordedAt:p.createdAt,pins:{id:p.id,revision:p.revision,digest:p.digest}});
  if(p.sourceUnavailable||p.currentSourcesChanged||p.sourceBasisCurrent===false||p.decisionBasisCurrent===false)add(id+'_changed',1,'Review Changed Sources','The saved basis or an authorized source changed. Refresh and review the available facts; the earlier record remains in history.',action,[ref,selected]);
  else if((p.currentAssessment?.cautions||p.currentSourceAssessment?.cautions||[]).length)add(id+'_dates',1,'Review Source Dates','The dates or applicability of this declared source need review. Exact arithmetic does not establish that the source is current.',action,[ref]);
 }
 for(const [id,p,action]of [['readiness',review.equipmentReadiness?.current,'readiness'],['travel_access',review.travelPlans?.current,'travel'],['included_travel',review.adoptedTravelPlan,'travel']]){if(!save(p))continue;const r=p.resourceReview||p.result;const status=r?.status;
  if(p.currentSourcesChanged||status==='blocked'||status==='needs_review'||status==='needsReview'||r?.needsReview===true)add(id, status==='blocked'?0:1,status==='blocked'?'Resolve The Recorded Conflict':'Review Work Resources','Review the current source, access, timing and work-record constraints before scheduling. This suggestion does not reserve equipment or approve its use.',action,[selected]);
 }
 const equipment=review.equipmentPlans?.current;
 if(save(equipment)){
  const lines=equipment.result?.lines||[];
  if(lines.some(l=>l.status!=='matches_reviewed_requirements'))add('requirements',1,'Confirm Equipment Requirements','Some recorded requirements conflict or need information. Review the exact equipment configuration and relevant job facts.','equipment',[selected]);
  // Only explicitly selected publications that remain in the CURRENT authorized source projection.
  const selectedPublications=new Set((equipment.inputs?.lines||[]).flatMap(l=>l.knowledgePins||[]));
  for(const k of (review.equipmentPlans?.sources?.knowledge||[]).filter(k=>selectedPublications.has(k.publicationId)).slice(0,12))at('publication:'+k.publicationId,'Selected Company Reference','reviewed_source',{publicationId:k.publicationId,digest:k.digest||k.publicationDigest||null,label:k.label||'Selected Company Reference',content:k.content,freshness:'unknown'});
  for(const l of lines)if(l.research&&l.research.state==='reviewed')at('equipment-reference:'+l.lineId,equipment.currentSourcesChanged?'Earlier Equipment Reference â€” Sources Changed':'Reviewed Equipment Reference','reviewed_source',{recordedAt:l.research.reviewedAt||null,validUntil:l.research.freshUntil||null,freshness:!l.research.freshUntil?'unknown':Date.parse(l.research.freshUntil)<=Date.parse(now)?'expired':'recorded_end_date',limitations:'Recorded requirements only; not safety, availability or certification clearance.'});
 }
 for(const [id,p]of [['current_material',review.materialPlans?.current],['included_material',review.adoptedMaterialPlan]])if(save(p)){
  const availability=p.currentAvailabilityAssessment?.lines||[],cost=p.currentSourceAssessment?.lines||[];
  if(availability.some(l=>l.currentStatus==='reported_shortage'))add(id+'_shortage',0,'Review The Reported Material Shortfall','The reported supply is below the planned quantity. Review the source and alternatives; this is not a stock reservation.','materials',[selected]);
  if(availability.some(l=>l.flags?.length)||cost.some(l=>l.flags?.length))add(id+'_evidence',1,'Review Material Evidence','Some source dates, quantities, locations or applicability are unknown or need review. Preserve the included plan until a replacement is deliberately adopted.','materials',[selected]);
 }
 const policyCheck=review.pricingPolicyCheck;
 if(policyCheck&&['changed','incomplete'].includes(policyCheck.state))add('policy_review',1,'Review The Pricing Policy','The saved policy cannot yet support a current complete comparison. Review its sources and the selected price.','policy',[selected]);
 if(policyCheck?.state==='compared'&&[policyCheck.result?.proposed,policyCheck.result?.reviewed].some(x=>x?.status==='below'))add('policy_floor',0,'Review The Price Below Policy','The recorded proposal or reviewed price is below the saved policy threshold. Review the exact comparison and any required exception before approval.','policy',[selected]);
 if(review.commercialTerms?.approvalState!=='commercial_approved')add('approval',2,'Review Price And Terms','A current full commercial approval is not recorded for this basis. Review price, terms and tax treatment before preparing customer output.','commercial',[selected]);
 if(!comparisonKey(item))add('scope',2,'Confirm Comparison Details','A matching earlier estimate needs a supported service and complete typed quantities and units. Ask the owner or estimator for missing technical details.','costs',[selected]);
 const dedup=Array.from(new Map(rows.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id)).map(x=>[x.id,x])).values());
 return stableValue({contract:VERSION,state:'ready',simulated:review.simulated===true,assessedAt:now,basisDigest:sha256(review),selectedRevision:review.selectedRevision,historical:review.isCurrent===false,items:dedup.slice(0,8),omitted:Math.max(0,dedup.length-8),sources,comparisons:comparisons(item,options.candidates,options.hasMore),message:'Suggestions from saved facts and calculations. No model-generated analysis or market-price verification.'});
}
module.exports={VERSION,typedScope,comparisonKey,comparisons,build};
