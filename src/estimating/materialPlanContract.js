"use strict";
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const VERSION='estimate-material-plan-v1';
const V2='estimate-material-plan-v2';
const VERSIONS=Object.freeze([VERSION,V2]);
const UNITS=Object.freeze({ea:'Items',m:'Metres',m2:'Square metres',m3:'Cubic metres',ft:'Feet',ft2:'Square feet',ft3:'Cubic feet',yd3:'Cubic yards',kg:'Kilograms',lb:'Pounds',l:'Litres',gal:'US liquid gallons'});
const KEYS=['material','quantity','unit','wastePercent','unitPrice','sourceType','sourceNote','priceDate'];
const FIELDS=['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion'];
function fail(message='Review the material quantities, price and source before continuing.',status=400){throw Object.assign(new Error(message),{status,code:'MATERIAL_PLAN_INVALID'});}
function object(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));}
function text(v,max){return typeof v==='string'&&v.trim().length>0&&Array.from(v.trim()).length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function scaled(v,digits){const [a,b='']=v.split('.');return BigInt(a)*10n**BigInt(digits)+BigInt(b.padEnd(digits,'0'));}
function decimal(v,digits){const scale=10n**BigInt(digits);return String(v/scale)+'.'+String(v%scale).padStart(digits,'0');}
function quantity(v){return decimal(v,6).replace(/\.?0+$/,'');}
function calculateLine(inputs,currency){
 if(!object(inputs,KEYS)||!['USD','CAD','EUR'].includes(currency)||!text(inputs.material,160)||!text(inputs.sourceNote,1000)||!Object.prototype.hasOwnProperty.call(UNITS,inputs.unit)||!['my_estimate','entered_price'].includes(inputs.sourceType))fail();
 if(typeof inputs.quantity!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(inputs.quantity)||typeof inputs.wastePercent!=='string'||!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$/.test(inputs.wastePercent)||typeof inputs.unitPrice!=='string'||!/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(inputs.unitPrice))fail();
 if(inputs.priceDate!==null&&(typeof inputs.priceDate!=='string'||!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(inputs.priceDate)||!Number.isFinite(Date.parse(inputs.priceDate))||new Date(inputs.priceDate).toISOString().slice(0,10)!==inputs.priceDate))fail('Enter a valid price date or leave it blank.');
 const q=scaled(inputs.quantity,6),w=scaled(inputs.wastePercent,2),price=scaled(inputs.unitPrice,2);if(q<=0n||w>10000n||inputs.unit==='ea'&&q%1000000n)fail();
 const divisor=inputs.unit==='ea'?10000000000n:10000n;const planned=(q*(10000n+w)+divisor-1n)/divisor*(inputs.unit==='ea'?1000000n:1n);const cents=(planned*price+500000n)/1000000n;if(cents>99999999999999n)fail('This material total is too large. Review the quantity and price.');
 return stableValue({contract:VERSION,quantity:quantity(q),additionalQuantity:quantity(planned-q),plannedQuantity:quantity(planned),unit:inputs.unit,unitLabel:UNITS[inputs.unit],unitPrice:inputs.unitPrice,total:decimal(cents,2),currency,rounding:inputs.unit==='ea'?'Waste-inclusive quantities are rounded up to whole items.':'Waste-inclusive quantities are rounded up to six decimal places.'});
}
function calculate(inputs,currency,version=VERSION){
 if(version===VERSION)return calculateLine(inputs,currency);
 if(version!==V2||!object(inputs,['lines'])||!Array.isArray(inputs.lines)||inputs.lines.length<1||inputs.lines.length>20)fail('Add between 1 and 20 materials to this plan.');
 const ids=new Set();let total=0n;
 const lines=inputs.lines.map((line,index)=>{
  if(!object(line,['lineId',...KEYS])||typeof line.lineId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(line.lineId)||ids.has(line.lineId.toLowerCase()))fail('Review the separate material entries before continuing.');
  ids.add(line.lineId.toLowerCase());
  let result;try{result=calculateLine(Object.fromEntries(KEYS.map(key=>[key,line[key]])),currency);}catch(error){fail('Material '+(index+1)+': '+error.message);}
  total+=scaled(result.total,2);
  return {lineId:line.lineId,material:line.material,...result};
 });
 if(total>99999999999999n)fail('The combined material cost is too large. Review the quantities and prices.');
 return stableValue({contract:V2,lines,lineCount:lines.length,total:decimal(total,2),currency,rounding:'The plan total adds each material cost after rounding to cents.'});
}
function normalize(body){if(!object(body,FIELDS)||!['save','withdraw'].includes(body.action)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>10000||!Number.isSafeInteger(body.expectedDecisionRevision)||body.expectedDecisionRevision<0||body.expectedDecisionRevision>10000||typeof body.expectedDigest!=='string'||typeof body.expectedDecisionDigest!=='string'||!body.sourcePins||typeof body.sourcePins!=='object'||Array.isArray(body.sourcePins)||body.confirmed!==true||!VERSIONS.includes(body.confirmationVersion)||!text(body.reason,2000))fail();if(body.action==='save')calculate(body.inputs,body.currency,body.confirmationVersion);else if(body.inputs!==null||!['USD','CAD','EUR'].includes(body.currency))fail();return stableValue({...body,reason:body.reason.trim()});}
function decisionBasis(decision){return {revision:decision?.revision||0,digest:decision?.digest||'none'};}
function checkBasis(body,review,current){if(body.confirmationVersion===VERSION&&current?.calculationVersion===V2)fail('This plan contains multiple materials. Refresh and review the whole plan before saving.',409);const b=review.decisions?.writeBasis||decisionBasis(review.decisions?.current);if(body.expectedRevision!==(current?.revision||0)||body.expectedDigest!==(current?.digest||'none')||body.expectedDecisionRevision!==b.revision||body.expectedDecisionDigest!==b.digest||sha256(body.sourcePins)!==sha256(review.pins)||body.currency!==review.currency)fail('The estimate or review changed. Refresh and review this plan again.',409);}
function project(data,review,canMutate,simulated=false,mutationsPaused=false){const basis=review.decisions?.writeBasis||decisionBasis(review.decisions?.current);const expose=e=>e?{...Object.fromEntries(['id','revision','digest','previousId','action','actorName','createdAt','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmationVersion','calculationVersion'].map(k=>[k,e[k]])),result:e.action==='save'?calculate(e.inputs,e.currency,e.calculationVersion):null,sourceBasisCurrent:sha256(e.sourcePins)===sha256(review.pins),decisionBasisCurrent:!!review.decisions?.current&&sha256(e.sourcePins)===sha256(review.pins)&&sha256(review.decisions.current.sourcePins)===sha256(review.pins)&&e.expectedDecisionRevision===basis.revision&&e.expectedDecisionDigest===basis.digest}:null;return stableValue({contract:V2,sourcePins:review.pins,simulated,canMutate,mutationsPaused,current:expose(data.current),history:(data.history||[]).map(expose),total:data.total||0,truncated:data.truncated===true,decisionBasis:basis});}
function demoPlan(history,review,raw,key,now){const body=normalize(raw),digest=sha256(body),existing=history.find(e=>e.requestKey===key);if(existing){if(existing.requestDigest!==digest)fail('This save attempt changed. Refresh before saving again.',409);return {receipt:existing,replayed:true};}checkBasis(body,review,history[0]);if(body.action==='withdraw'&&history[0]?.action!=='save')fail('There is no current material plan to withdraw.');if(history.length>=20)fail('This demo has reached its material-plan limit. Reset the demo to start again.',429);const receipt={id:require('node:crypto').randomUUID(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,calculationVersion:body.confirmationVersion,...body,actorName:'Demo reviewer',createdAt:now.toISOString(),digest:sha256({body,previous:history[0]?.digest||null}),requestKey:key,requestDigest:digest};return {receipt,replayed:false};}
module.exports={VERSION,V2,VERSIONS,UNITS,calculate,normalize,decisionBasis,checkBasis,project,demoPlan};
