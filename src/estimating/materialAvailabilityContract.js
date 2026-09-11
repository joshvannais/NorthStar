'use strict';
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const KEYS=Object.freeze(['kind','issuer','reference','observedOn','validThrough','location','availableQuantity','statedUnit','leadTimeDays','appliesToReviewedJob','exceptionReason']);
const REPLACEMENT_KEYS=Object.freeze(['previousPlanId','previousPlanRevision','previousPlanDigest','previousLineId','reason','suitabilityConfirmed']);
const KINDS=Object.freeze(['unknown','my_observation','company_record','supplier_statement']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const identity=v=>v===null?null:v.replace(/^[\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g,'');
const text=(v,max)=>typeof v==='string'&&identity(v).length>0&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);
const date=v=>typeof v==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v),'utf8').digest('hex');
function fail(message,status=400){throw Object.assign(new Error(message),{status,code:'MATERIAL_AVAILABILITY_INVALID'});}
function units(value){const[a,b='']=value.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));}
function quantity(value){const whole=value/1000000n,fraction=String(value%1000000n).padStart(6,'0').replace(/0+$/,'');return String(whole)+(fraction?'.'+fraction:'');}
function unknown(){return Object.fromEntries(KEYS.map(k=>[k,k==='kind'?'unknown':k==='appliesToReviewedJob'?false:null]));}
function validate(line){const e=line.availability;
 if(!exact(e,KEYS)||!KINDS.includes(e.kind))fail('Choose how material availability was checked.');
 if(e.kind==='unknown'){if(!isDeepStrictEqual(e,unknown()))fail('Leave unknown availability details blank.');return e;}
 for(const k of ['issuer','reference','location','exceptionReason'])if(e[k]!==null&&!text(e[k],k==='exceptionReason'?500:160))fail('Review the availability source details.');
 for(const k of ['observedOn','validThrough'])if(e[k]!==null&&!date(e[k]))fail('Enter a valid availability date or leave it unknown.');
 if(e.observedOn&&e.validThrough&&e.validThrough<e.observedOn)fail('The availability end date must follow the checked date.');
 if(e.kind==='company_record'&&!text(e.reference,160)||e.kind==='supplier_statement'&&(!text(e.issuer,160)||!text(e.reference,160)))fail('Enter the availability source and reference.');
 if(e.availableQuantity===null){if(e.statedUnit!==null)fail('Leave the unit blank when available quantity is unknown.');}
 else if(typeof e.availableQuantity!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(e.availableQuantity)||e.statedUnit!==line.unit||line.unit==='ea'&&units(e.availableQuantity)%1000000n)fail('Enter an available quantity in the same units as this material.');
 if(e.leadTimeDays!==null&&(!Number.isSafeInteger(e.leadTimeDays)||e.leadTimeDays<0||e.leadTimeDays>3650))fail('Enter reported lead time from 0 to 3650 calendar days.');
 if(typeof e.appliesToReviewedJob!=='boolean')fail('Review whether the availability applies to this job.');
 return e;
}
function validateReplacement(v){if(v===null)return;
 if(!exact(v,REPLACEMENT_KEYS)||!UUID.test(v.previousPlanId)||!UUID.test(v.previousLineId)||!Number.isSafeInteger(v.previousPlanRevision)||v.previousPlanRevision<1||v.previousPlanRevision>10000||typeof v.previousPlanDigest!=='string'||!/^[0-9a-f]{64}$/.test(v.previousPlanDigest)||!text(v.reason,500)||v.suitabilityConfirmed!==true)fail('Review the alternative and explain why it meets this job’s needs.');
}
function assess(inputs,results,{now=new Date()}={}){const asOfDate=now.toISOString().slice(0,10),pools=new Set();const rows=inputs.lines.map((line,i)=>{
 const e=validate(line);validateReplacement(line.replacement);const flags=[];
 if(e.kind==='unknown')flags.push('unknown');
 else {
  if(e.observedOn===null)flags.push('date_missing');else if(e.observedOn>asOfDate)fail('The checked date cannot be in the future.');
  if(e.validThrough===null)flags.push('end_date_missing');else if(e.validThrough<asOfDate)flags.push('expired');
  if(e.location===null)flags.push('place_unknown');
  if(!e.appliesToReviewedJob)flags.push('applicability_unconfirmed');
  if(e.availableQuantity===null)flags.push('quantity_unknown');
  if(e.reference!==null){const key=JSON.stringify([e.kind,identity(e.issuer),identity(e.reference),identity(e.location),e.observedOn,identity(line.evidence.materialSpecification)]);if(pools.has(key))fail('These materials refer to the same available supply. Combine them or record distinct sources.');pools.add(key);}
 }
 const required=units(results.lines[i].plannedQuantity),available=e.availableQuantity===null?null:units(e.availableQuantity);
 const shortage=available===null?null:quantity(required>available?required-available:0n),surplus=available===null?null:quantity(available>required?available-required:0n);
 return {lineId:line.lineId,evidenceDigest:digest([line.lineId,...KEYS.map(k=>e[k]===null?null:String(e[k]))]),flags,requiredQuantity:quantity(required),reportedQuantity:available===null?null:quantity(available),shortage,surplus,currentStatus:flags.length?'unknown':required>available?'reported_shortage':'reported_sufficient'};
 });return {asOfDate,lines:rows,digest:digest([asOfDate,...rows.flatMap(r=>[r.lineId,r.evidenceDigest,...r.flags,r.requiredQuantity,r.reportedQuantity,r.shortage,r.surplus,r.currentStatus])])};
}
function requireUsable(inputs,assessment){assessment.lines.forEach((r,i)=>{const e=inputs.lines[i].availability;if(r.flags.includes('applicability_unconfirmed'))fail('Confirm that the reported availability applies to this job.');if(r.flags.includes('expired')&&!text(e.exceptionReason,500))fail('Explain why you are using expired availability evidence.');});}
function checkSaved(inputs,results,options={},adopting=false){const a=assess(inputs,results,options),saved=inputs.availabilityAssessment;if(!saved||!isDeepStrictEqual(adopting?saved.lines:saved,adopting?a.lines:a))fail('Availability changed. Calculate and review the material plan again.',409);requireUsable(inputs,a);return a;}
function checkLineage(inputs,current){const previous=current?.action==='save'?current.inputs.lines||[]:[],byId=new Map(previous.map(x=>[x.lineId,x]));let replacements=0;
 for(const line of inputs.lines){validateReplacement(line.replacement);const old=byId.get(line.lineId);
  if(old){if(!isDeepStrictEqual(line.replacement,old.replacement??null))fail('Keep the saved alternative history when editing this material.');continue;}
  const r=line.replacement;if(r===null)continue;replacements++;
  if(!current||r.previousPlanId!==current.id||r.previousPlanRevision!==current.revision||r.previousPlanDigest!==current.digest||!byId.has(r.previousLineId)||inputs.lines.some(x=>x.lineId===r.previousLineId))fail('The material plan changed. Review the alternative again.',409);
  if(inputs.lines.length!==previous.length)fail('Replace one material at a time without adding other changes.');
  for(const oldLine of previous.filter(x=>x.lineId!==r.previousLineId)){const retained=inputs.lines.find(x=>x.lineId===oldLine.lineId);if(!retained||!isDeepStrictEqual(retained,oldLine))fail('Save other material changes before choosing this alternative.');}
 }
 if(replacements>1)fail('Choose one alternative at a time.');
}
module.exports={KEYS,REPLACEMENT_KEYS,KINDS,unknown,validate,validateReplacement,assess,requireUsable,checkSaved,checkLineage};
