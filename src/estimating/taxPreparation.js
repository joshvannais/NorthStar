'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const {exact,text,day}=require('./pricingCalculation');
const LEGACY_VERSION='tax-preparation-v1',v2=require('./taxApplicability'),VERSION=v2.VERSION;
function invalid(){throw Object.assign(new Error('Review the tax setup entries and their source dates.'),{status:400,code:'TAX_PROFILE_INVALID'});}
function normalizeLegacy(value){
 if(!exact(value,['contexts'])||!Array.isArray(value.contexts)||value.contexts.length>12)invalid();
 const ids=new Set();
 for(const c of value.contexts){
  if(!exact(c,['id','country','region','locality','jurisdiction','serviceKey','classification','registration','registrationReference','collectionBasis','exemptionReference','effectiveOn','endsOn','sourceNote','sourceReference','acknowledged'])||!text(c.id,80)||ids.has(c.id)||!['country','region','locality','jurisdiction','serviceKey','classification','registrationReference','collectionBasis','exemptionReference','sourceNote','sourceReference'].every(k=>text(c[k],k==='sourceNote'?1000:300,true))||!['unknown','registered','not_registered','exempt'].includes(c.registration)||typeof c.acknowledged!=='boolean'||c.effectiveOn!==null&&!day(c.effectiveOn)||c.endsOn!==null&&!day(c.endsOn)||c.effectiveOn&&c.endsOn&&c.endsOn<c.effectiveOn)invalid();
  ids.add(c.id);
  if(c.registration==='unknown'&&(c.registrationReference||c.exemptionReference))invalid();
  if(c.registration!=='exempt'&&c.exemptionReference)invalid();
 }
 return stableValue(value);
}
function normalize(value){if(value?.version===VERSION){if(!exact(value,['version','contexts']))invalid();return stableValue({version:VERSION,...normalizeLegacy({contexts:value.contexts})});}if(Object.hasOwn(value||{},'version'))invalid();return normalizeLegacy(value);}

function normalizeMutation(b){if(!exact(b,['expectedRevision','expectedDigest','expectedProfileVersion','inputs','reason','confirmed','confirmationVersion'])||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||b.expectedRevision>10000||!text(b.expectedDigest,64)||!text(b.expectedProfileVersion,100)||!text(b.reason,2000)||b.confirmed!==true||![LEGACY_VERSION,VERSION].includes(b.confirmationVersion)||b.confirmationVersion!==((b.inputs&&b.inputs.version)||LEGACY_VERSION))invalid();return stableValue({...b,reason:b.reason.trim(),inputs:normalize(b.inputs)});}
// Only declared locations, services and collection facts influence preparation.
// Financial rates, taxId, voice settings and customer records are deliberately absent.
function relevantProfile(raw,declared={version:VERSION,contexts:[]}){
 const location=v=>({street:typeof v?.street==='string'?v.street:'',city:typeof v?.city==='string'?v.city:'',state:typeof v?.state==='string'?v.state:'',zip:typeof v?.zip==='string'?v.zip:'',country:typeof v?.country==='string'?v.country:''});
 return stableValue({version:declared.version===VERSION?VERSION:LEGACY_VERSION,headquarters:location(raw?.headquarters),offices:(raw?.headquarters?.additionalOffices||[]).map(o=>({id:o.id,...location(o)})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),serviceArea:raw?.serviceArea||null,services:(raw?.services||[]).map(s=>({id:s.id,name:s.name||'',description:s.description||''})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),declared:normalize(declared)});
}
function preparationInput(raw,declared){const inputs=relevantProfile(raw,declared);return {inputs,digest:sha256(inputs),version:inputs.version};}
function evaluate(inputs,rules,asOfDate,{simulated=false}={}){
 if(inputs?.version===VERSION){
  if(!day(asOfDate)||!Array.isArray(rules)||rules.length>1000||inputs.declared?.version!==VERSION)invalid();normalize(inputs.declared);if(rules.some(r=>![LEGACY_VERSION,VERSION].includes(r?.version)))invalid();const eligible=rules.filter(r=>r.version===VERSION).map(r=>{v2.rule(v2.content(r),{simulated});return r;}).filter(r=>r.active&&asOfDate>=r.reviewedOn&&asOfDate<=r.reviewValidThrough);
  // Company preparation checks current review/context only. Exact legal dates remain
  // on original rules and are checked against the selected transaction in calculation.
  const old=evaluate({...inputs,version:LEGACY_VERSION,declared:{contexts:inputs.declared.contexts}},[],asOfDate,{simulated});
  const coverage=old.coverage.map(row=>{if(row.missing.length)return row;const c=inputs.declared.contexts.find(c=>c.id===row.contextId),matches=eligible.filter(r=>['country','region','locality','jurisdiction','serviceKey','classification','registration','collectionBasis'].every(k=>r[k]===c[k])&&typeof r.id==='string'&&/^[a-f0-9]{64}$/.test(r.digest));return {...row,state:matches.length===1?'matched':matches.length>1?'conflicting_coverage':'unsupported',rule:matches.length===1?{id:matches[0].id,digest:matches[0].digest}:null};});
  const state=old.missing.length||coverage.some(c=>c.state==='missing_inputs')?'missing_inputs':coverage.length&&coverage.every(c=>c.state==='matched')?'matched':'unsupported';
  return stableValue({...old,version:VERSION,inputDigest:sha256(inputs),coverage,state});
 }
 if(inputs?.version!==LEGACY_VERSION||!day(asOfDate)||!Array.isArray(rules)||rules.length>1000)invalid();
 const declared=normalize(inputs.declared),missing=[];
 if(!inputs.headquarters?.country||!inputs.headquarters?.state||!inputs.headquarters?.city)missing.push('operating_location');
 if(!inputs.services?.length)missing.push('services');
 if(!declared.contexts.length)missing.push('collection_context');
 const coverage=declared.contexts.map(c=>{
  const gaps=[];
  for(const field of ['country','region','jurisdiction','serviceKey','classification','collectionBasis','sourceNote','sourceReference'])if(!c[field].trim())gaps.push(field);
  if(!inputs.services.some(s=>s.id===c.serviceKey))gaps.push('supported_service');
  if(c.registration==='unknown')gaps.push('registration');
  if(c.registration==='registered'&&!c.registrationReference.trim())gaps.push('registration_reference');
  if(c.registration==='exempt'&&!c.exemptionReference.trim())gaps.push('exemption_reference');
  if(!c.acknowledged)gaps.push('acknowledgment');
  if(!c.effectiveOn)gaps.push('effective_date');
  if(c.effectiveOn&&asOfDate<c.effectiveOn||c.endsOn&&asOfDate>c.endsOn)gaps.push('applicability_date');
  // Exact source-controlled coverage only. No location inference or owner promotion.
  const matches=gaps.length?[]:rules.filter(r=>r.validation==='validated'&&r.simulated===simulated&&r.version===LEGACY_VERSION&&r.country===c.country&&r.region===c.region&&r.locality===c.locality&&r.jurisdiction===c.jurisdiction&&r.serviceKey===c.serviceKey&&r.classification===c.classification&&r.registration===c.registration&&r.collectionBasis===c.collectionBasis&&day(r.effectiveOn)&&asOfDate>=r.effectiveOn&&day(r.endsOn)&&asOfDate<=r.endsOn&&typeof r.id==='string'&&/^[a-f0-9]{64}$/.test(r.digest)&&r.active===true);
  return {contextId:c.id,state:gaps.length?'missing_inputs':matches.length===1?'matched':matches.length>1?'conflicting_coverage':'unsupported',missing:gaps,rule:matches.length===1?{id:matches[0].id,digest:matches[0].digest}:null};
 });
 const state=missing.length||coverage.some(c=>c.state==='missing_inputs')?'missing_inputs':coverage.length&&coverage.every(c=>c.state==='matched')?'matched':'unsupported';
 return stableValue({version:LEGACY_VERSION,asOfDate,inputDigest:sha256(inputs),simulated,state,missing,coverage});
}
function status(result){
 if(!result)return {state:'pending',message:'Tax preparation is pending. You can continue setting up your business.'};
 if(result.state==='missing_inputs')return {state:result.state,message:'Add the missing business and collection details to continue tax preparation.'};
 if(result.state==='matched')return {state:result.state,message:result.simulated?'Simulated tax coverage matches these practice details. Review each jobâ€™s treatment before approval.':'Recorded tax coverage matches this setup. Review each jobâ€™s location, date and treatment before approval.'};
 return {state:'unsupported',message:'Validated tax coverage is not available for this setup. An owner can record externally reviewed treatment for a job.'};
}
module.exports={VERSION,normalize,normalizeMutation,relevantProfile,preparationInput,evaluate,status};
