'use strict';
const crypto = require('node:crypto');
const KINDS = Object.freeze(['my_estimate','company_record','supplier_quote','published_reference']);
const KEYS = Object.freeze(['kind','issuer','reference','effectiveOn','validThrough','countryCode','region','locality','serviceKey','materialSpecification','statedUnit','statedCurrency','statedUnitPrice','appliesToReviewedJob','exceptionReason']);
function fail(message,status=400){throw Object.assign(new Error(message),{status,code:'MATERIAL_SOURCE_INVALID'});}
function exact(o,keys){return o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));}
function text(v,max){return typeof v==='string'&&v.trim().length>0&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function date(v){return typeof v==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function utcDate(now=new Date()){return now.toISOString().slice(0,10);}
function digest(parts){return crypto.createHash('sha256').update(JSON.stringify(parts),'utf8').digest('hex');}
function validate(line,currency){const e=line.evidence;if(!exact(e,KEYS)||!KINDS.includes(e.kind))fail('Choose a cost source for each material.');
 for(const k of ['issuer','reference','region','locality','serviceKey','materialSpecification','exceptionReason'])if(e[k]!==null&&!text(e[k],k==='exceptionReason'?500:160))fail('Review the cost source details.');
 for(const k of ['effectiveOn','validThrough'])if(e[k]!==null&&!date(e[k]))fail('Enter a valid source date or leave it blank.');
 if(e.effectiveOn&&e.validThrough&&e.validThrough<e.effectiveOn)fail('The source end date must not precede its start date.');
 if(e.countryCode!==null&&(typeof e.countryCode!=='string'||!/^[A-Z]{2}$/.test(e.countryCode)))fail('Choose a country or leave it unknown.');
 if(e.kind!=='my_estimate'&&(!text(e.reference,160)||(e.kind!=='company_record'&&!text(e.issuer,160))))fail('Enter the source name and document reference.');
 if(e.statedUnit!==line.unit||e.statedCurrency!==currency||e.statedUnitPrice!==line.unitPrice)fail('The source unit, currency and price must match this material.');
 if(typeof e.appliesToReviewedJob!=='boolean')fail('Review whether this source applies to this job.');
 return e;
}
function assess(inputs,currency,{now=new Date(),serviceKey=null}={}){const asOfDate=utcDate(now),seen=new Map();const lines=inputs.lines.map(line=>{const e=validate(line,currency),flags=[];
 if(e.effectiveOn===null)flags.push('date_missing');else if(e.effectiveOn>asOfDate)flags.push('not_effective');
 if(e.validThrough===null)flags.push('end_date_missing');else if(e.validThrough<asOfDate)flags.push('expired');
 if(e.countryCode===null)flags.push('place_unknown');
 if(e.serviceKey!==null&&serviceKey!==null&&e.serviceKey!==serviceKey)flags.push('service_mismatch');
 if(!e.appliesToReviewedJob)flags.push('applicability_unconfirmed');
 const ref=e.reference&&e.issuer?JSON.stringify([e.issuer.trim(),e.reference.trim(),e.materialSpecification,e.effectiveOn]):null;
 if(ref){const old=seen.get(ref);if(old&&(old.price!==line.unitPrice||old.unit!==line.unit||old.currency!==currency)){flags.push('conflict');old.flags.push('conflict');}else if(!old)seen.set(ref,{price:line.unitPrice,unit:line.unit,currency,flags});}
 return {lineId:line.lineId,evidenceDigest:digest([line.lineId,...KEYS.map(k=>e[k]===null?null:String(e[k]))]),flags};
 });
 for(let i=0;i<inputs.lines.length;i++){const a=inputs.lines[i],e=a.evidence;if(!e.issuer||!e.reference)continue;for(const b of inputs.lines){const f=b.evidence;if(f.issuer&&f.reference&&JSON.stringify([e.issuer.trim(),e.reference.trim(),e.materialSpecification,e.effectiveOn])===JSON.stringify([f.issuer.trim(),f.reference.trim(),f.materialSpecification,f.effectiveOn])&&(a.unitPrice!==b.unitPrice||a.unit!==b.unit))lines[i].flags.push('conflict');}}
 for(const row of lines)row.flags=[...new Set(row.flags)];
 return {asOfDate,lines,digest:digest([asOfDate,...lines.flatMap(l=>[l.lineId,l.evidenceDigest,...l.flags])])};
}
function requireUsable(inputs,assessment){for(let i=0;i<assessment.lines.length;i++){const flags=assessment.lines[i].flags,e=inputs.lines[i].evidence;
 if(flags.some(f=>['conflict','service_mismatch','applicability_unconfirmed'].includes(f)))fail('Resolve the conflicting source or confirm its job applicability before saving.');
 if(flags.some(f=>['expired','not_effective'].includes(f))&&!text(e.exceptionReason,500))fail('Explain why you are using a source outside its recorded dates.');
 // Missing dates/place are acknowledged by the explicit job attestation and whole-plan consent;
 // they never require a made-up date or an exception reason, including My Cost Estimate.
 }}
function checkSaved(inputs,currency,options={},adoption=false){const assessment=assess(inputs,currency,options),saved=inputs.sourceAssessment;
 if(!saved||(!adoption&&!require('node:util').isDeepStrictEqual(saved,assessment))||(adoption&&!require('node:util').isDeepStrictEqual(saved.lines,assessment.lines)))fail('The cost source review changed. Calculate and review the material plan again.',409);
 requireUsable(inputs,assessment);return assessment;
}
module.exports={KINDS,KEYS,validate,assess,checkSaved,requireUsable,utcDate};
