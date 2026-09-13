'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const math=require('./pricingCalculation'),legacy=require('./materialAdoptionContract');
function basis(item,review){
 const direct=review.pins.revision?review.financialCosts?.knownDirectCosts:legacy.decimal(legacy.recordedCents(item.snapshot.knownDirectCosts));
 const overheadIncluded=[],l=review.adoptedLaborPlan;
 if(l){const result=require('./laborPlanContract').calculate(l.inputs,l.currency);for(const row of result.lines){const input=l.inputs.lines.find(x=>x.lineId===row.lineId);if(row.total!==null)overheadIncluded.push({referenceId:`labor:${l.id}:${row.lineId}`,label:input.task,amount:row.total,meaning:'Maximum recorded task cost. Any overhead share is your declared allocation, not a verified split.'});}}
 return stableValue({directCosts:direct??null,overheadIncluded,componentManifest:review.componentManifest||null,coverage:review.coverageAssessment||null});
}
function references(raw,input){const {buildKnowledgeProjection}=require('../knowledge/projection');const p=buildKnowledgeProjection({organizationId:input.organizationId,actorUserId:input.actorUserId,consumer:'northstar_assistant',audience:'internal',capabilities:['financial_constraints','services'],maximumEntries:32},raw.knowledgeRows||[]).projection;const rows=[];if(raw.profilePin)rows.push({kind:'profile',referenceId:raw.profilePin.id,digest:raw.profilePin.digest,label:'Current Business Profile',content:raw.pricingProfile});for(const item of p.items)if(item.state==='published'){const s=p.sources[item.sourceIndex];if(!rows.some(r=>r.referenceId===s.publicationId))rows.push({kind:'published_knowledge',referenceId:s.publicationId,digest:s.canonicalDigest,label:item.label||'Company Reference',content:item.content});}return rows;}
function present(raw,input){const refs=references(raw,input);return stableValue({serviceKey:raw.serviceKey,basis:raw.basis,asOfDate:raw.asOfDate,references:refs,digest:raw.digest});}
function demo(state,item,review,now=new Date()){
 const profile=state.workspace?.businessProfile||{},raw=require('../commandCenter/demoEquipmentPlans').rawSources(state,item),payload=stableValue({serviceKey:item.snapshot.service.key,basis:basis(item,review),asOfDate:now.toISOString().slice(0,10),profilePin:{id:'simulated-workspace',digest:sha256(profile)},pricingProfile:profile.pricing||profile.canonicalPricing||{},knowledgeRows:raw.knowledgeRows||[]});const source={...payload,digest:sha256(payload)};return present(source,require('../commandCenter/demoEquipmentPlans').actor(item));
}
module.exports={basis,references,present,demo};
