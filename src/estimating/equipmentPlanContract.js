'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const VERSION='estimate-equipment-plan-v1';
const FIELDS=['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion'];
const IDENTITY=['manufacturer','model','modelYear','series','engine','configuration','attachments'];
const LINE=['lineId','task','assetId','identity','accessBasis','requirements','knowledgePins','ownerReview'];
const REQUIREMENT=['requirementId','label','kind','operator','value','unit','origin','scopeKey','specificationIndex'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(message='Review the equipment entries before continuing.',status=400){throw Object.assign(new Error(message),{status,code:'EQUIPMENT_PLAN_INVALID'});}
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v,max,blank=false){return typeof v==='string'&&(blank||v.trim().length>0)&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function number(v){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(v))return null;const[a,b='']=v.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));}
function identity(v){if(!exact(v,IDENTITY)||!IDENTITY.every(k=>v[k]===null||text(v[k],200)))fail('Review the equipment identity and configuration.');return v;}
function validate(inputs){
 if(!exact(inputs,['serviceKey','lines','assessment'])||!text(inputs.serviceKey,160)||!Array.isArray(inputs.lines)||inputs.lines.length<1||inputs.lines.length>12)fail('Add between 1 and 12 equipment items.');
 const ids=new Set(),requirements=new Set();
 for(const l of inputs.lines){
  if(!exact(l,LINE)||!UUID.test(l.lineId)||ids.has(l.lineId)||!text(l.task,160)||!(l.assetId===null||UUID.test(l.assetId))||!['unknown','owned','rented','financed'].includes(l.accessBasis)||!text(l.ownerReview,1000,true))fail();ids.add(l.lineId);identity(l.identity);
  if(!Array.isArray(l.requirements)||l.requirements.length>12||!Array.isArray(l.knowledgePins)||l.knowledgePins.length>12||new Set(l.knowledgePins).size!==l.knowledgePins.length||!l.knowledgePins.every(v=>UUID.test(v)))fail('Review the requirements and company references.');
  for(const q of l.requirements){
   if(!exact(q,REQUIREMENT)||!UUID.test(q.requirementId)||requirements.has(q.requirementId)||!text(q.label,120)||!['numeric','categorical'].includes(q.kind)||!['at_least','at_most','equals'].includes(q.operator)||!(q.value===null||text(q.value,240))||!text(q.unit,80,true)||!['recorded_job','caller_assertion','owner_entry'].includes(q.origin)||!(q.scopeKey===null||text(q.scopeKey,120))||!(q.specificationIndex===null||Number.isInteger(q.specificationIndex)&&q.specificationIndex>=0&&q.specificationIndex<48))fail('Review each requirement, its unit and source.');
   requirements.add(q.requirementId);if(q.kind==='numeric'&&q.value!==null&&number(q.value)===null)fail('Use a nonnegative number with no more than six decimal places.');if(q.kind==='categorical'&&q.operator!=='equals')fail('Text requirements use an exact match.');if(q.origin!=='recorded_job'&&q.scopeKey!==null)fail('Choose the correct source for this requirement.');
  }
 }
 return inputs;
}
function normalize(body){if(!exact(body,FIELDS)||!['save','withdraw'].includes(body.action)||![body.expectedRevision,body.expectedDecisionRevision].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=10000)||!text(body.expectedDigest,64)||!text(body.expectedDecisionDigest,64)||!body.sourcePins||typeof body.sourcePins!=='object'||Array.isArray(body.sourcePins)||body.confirmed!==true||body.confirmationVersion!==VERSION||!text(body.reason,2000)||!['USD','CAD','EUR'].includes(body.currency))fail();if(body.action==='save')validate(body.inputs);else if(body.inputs!==null)fail();return stableValue({...body,reason:body.reason.trim()});}
function basis(review){return review.decisions.writeBasis;}
function checkBasis(body,review,current){const d=basis(review);if(review.isCurrent===false||body.expectedRevision!==(current?.revision||0)||body.expectedDigest!==(current?.digest||'none')||body.expectedDecisionRevision!==d.revision||body.expectedDecisionDigest!==d.digest||sha256(body.sourcePins)!==sha256(review.pins)||body.currency!==review.currency||body.action==='save'&&body.inputs.serviceKey!==review.materialSourceContext.serviceKey)fail('The estimate or equipment plan changed. Refresh and review again.',409);}
function resolvedLine(line,sources){
 if(line.assetId){const asset=sources.assets.find(a=>a.id===line.assetId);if(!asset||asset.catalogueState!=='active')return {asset:null,research:null,issue:'asset_unavailable'};const fields=asset.privateConfiguration||{manufacturer:asset.manufacturer,model:asset.model,modelYear:asset.modelYear===null?null:String(asset.modelYear),series:null,engine:null,configuration:null,attachments:null};const id=Object.fromEntries(IDENTITY.map(k=>[k,fields[k]??null]));if(sha256(id)!==sha256(line.identity))return {asset,research:null,issue:'configuration_changed'};return {asset,research:asset.research,issue:asset.reviewState==='reviewed'?null:'source_needs_review'};}
 const reference=(sources.references||[]).find(r=>sha256(r.identity)===sha256(line.identity));return {asset:null,research:reference?.research||null,issue:null};
}
function evaluate(inputs,sources,now=new Date()){
 validate(inputs);if(!sources||!Array.isArray(sources.assets)||!Array.isArray(sources.references)||!Array.isArray(sources.knowledge))fail('Equipment sources are unavailable. Refresh and try again.',503);
 const result=inputs.lines.map(line=>{
  const found=resolvedLine(line,sources),research=found.research,flags=[];
  if(found.issue)flags.push(found.issue);
  const exactIdentity=IDENTITY.every(k=>line.identity[k]!==null);
  if(!exactIdentity)flags.push('identity_incomplete');
  const reviewed=exactIdentity&&!found.issue&&research?.state==='reviewed'&&Number.isFinite(Date.parse(research.freshUntil))&&Date.parse(research.freshUntil)>new Date(now).getTime();
  if(!reviewed)flags.push('reviewed_source_unavailable');
  const privateSources=line.knowledgePins.map(id=>sources.knowledge.find(k=>k.publicationId===id));if(privateSources.some(x=>!x))flags.push('company_reference_unavailable');
  const requirements=line.requirements.map(q=>{
   if(q.origin==='recorded_job'){const scope=sources.scope||{};if(!q.scopeKey||!Object.hasOwn(scope,q.scopeKey)||scope[q.scopeKey]===null||String(scope[q.scopeKey])!==q.value)fail('A recorded job fact changed. Refresh and review the requirement.',409);}
   const spec=q.specificationIndex===null?null:research?.specifications?.[q.specificationIndex];
   let status='needs_information';
   if(reviewed&&spec&&q.value!==null){if(q.kind==='numeric'){const required=number(q.value),available=number(spec.value);if(q.unit&&spec.unit===q.unit&&required!==null&&available!==null)status=(q.operator==='at_least'?available>=required:q.operator==='at_most'?available<=required:available===required)?'matches_reviewed_requirement':'conflicts_with_requirement';}else if(spec.unit===q.unit)status=spec.value===q.value?'matches_reviewed_requirement':'conflicts_with_requirement';}
   return {requirementId:q.requirementId,label:q.label,required:q.value,unit:q.unit,origin:q.origin,status,specification:reviewed&&spec?{name:spec.name,value:spec.value,unit:spec.unit,sourceOrdinal:spec.sourceOrdinal}:null};
  });
  const status=requirements.some(q=>q.status==='conflicts_with_requirement')?'conflicts_with_requirement':flags.length||!requirements.length||requirements.some(q=>q.status==='needs_information')?'needs_information':'matches_reviewed_requirements';
  return {lineId:line.lineId,task:line.task,identity:line.identity,accessBasis:line.accessBasis,accessBasisAuthority:'owner_declaration',status,flags,requirements,ownerReview:line.ownerReview,assetPin:found.asset?{id:found.asset.id,version:found.asset.version,digest:found.asset.assetDigest}:null,research:research?{...research}:null,companyReferences:privateSources.filter(Boolean)};
 });
 return stableValue({contract:VERSION,lines:result,scope:'Recorded requirements only; not a safety, availability or certification decision.',sourcesDigest:sources.authorityDigest||sha256(sources),assessedAt:new Date(now).toISOString()});
}
function assessment(result){return stableValue({sourcesDigest:result.sourcesDigest,lines:result.lines.map(l=>({lineId:l.lineId,status:l.status,flags:l.flags,requirements:l.requirements.map(q=>({requirementId:q.requirementId,status:q.status}))}))});}
function requireReview(inputs,sources,now){const result=evaluate(inputs,sources,now),a=inputs.assessment;if(!exact(a,['sourcesDigest','lines','acknowledged'])||a.acknowledged!==true||sha256({sourcesDigest:a.sourcesDigest,lines:a.lines})!==sha256(assessment(result)))fail('Preview the equipment sources again, then confirm the review.',409);return result;}
module.exports={VERSION,IDENTITY,normalize,validate,identity,number,basis,checkBasis,resolvedLine,evaluate,assessment,requireReview};
