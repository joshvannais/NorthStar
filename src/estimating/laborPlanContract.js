'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const VERSION='estimate-labor-plan-v1';
const UNITS=Object.freeze({ea:'Items',ft:'Feet',ft2:'Square Feet',m:'Metres',m2:'Square Metres',yd3:'Cubic Yards',m3:'Cubic Metres'});
const FIELDS=['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion'];
const LINE=['lineId','task','basis','workerHours','people','elapsedHours','quantity','unit','hoursPerUnit','rateMode','hourlyCost','burdenPercent','quantitySource','rateSource'];
const EVIDENCE=['kind','reference','note','effectiveOn','endsOn','geography'];
const MAX=99999999999999n;
function fail(message='Review the labor entries before continuing.',status=400){throw Object.assign(new Error(message),{status,code:'LABOR_PLAN_INVALID'});}
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v,max,blank=false){return typeof v==='string'&&(blank||v.trim().length>0)&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function scaled(v,digits,whole=9){if(typeof v!=='string'||!new RegExp('^(0|[1-9][0-9]{0,'+(whole-1)+'})(\\.[0-9]{1,'+digits+'})?$').test(v))fail('Use a nonnegative number with no more than '+digits+' decimal places.');const[a,b='']=v.split('.');return BigInt(a)*10n**BigInt(digits)+BigInt(b.padEnd(digits,'0'));}
function money(v){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(v))fail('Enter the hourly cost with two decimal places, or leave it blank.');return scaled(v,2,12);}
function decimal(v,d=2){const s=10n**BigInt(d);return String(v/s)+'.'+String(v%s).padStart(d,'0');}
function gcd(a,b){while(b){const t=b;b=a%b;a=t;}return a;}
function rational(n,d){const g=gcd(n,d);return {numerator:String(n/g),denominator:String(d/g)};}
function displayHours(n,d){const v=(n*1000000n+d/2n)/d;return decimal(v,6).replace(/\.?0+$/,'');}
function date(v){if(v===null)return;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1000-01-01'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Enter a valid source date or leave it blank.');}
function evidence(v){if(!exact(v,EVIDENCE)||!['my_estimate','company_reference','published_reference'].includes(v.kind)||!text(v.reference,300,true)||!text(v.note,500,true)||!text(v.geography,160,true))fail('Review the labor source information.');if(v.kind!=='my_estimate'&&!v.reference.trim())fail('Name the company or published reference.');date(v.effectiveOn);date(v.endsOn);if(v.effectiveOn&&v.endsOn&&v.endsOn<v.effectiveOn)fail('The source end date must follow its effective date.');}
function calculate(inputs,currency){
 if(!exact(inputs,['serviceKey','lines','assessment'])||!text(inputs.serviceKey,160)||!['USD','CAD','EUR'].includes(currency)||!Array.isArray(inputs.lines)||inputs.lines.length<1||inputs.lines.length>20)fail('Add between 1 and 20 tasks for this service.');
 const ids=new Set();let total=0n,complete=true,hoursN=0n;const hoursD=1000000000000n;
 const lines=inputs.lines.map((l,index)=>{
  if(!exact(l,LINE)||typeof l.lineId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(l.lineId)||ids.has(l.lineId.toLowerCase())||!text(l.task,160))fail('Give each separate task a name.');ids.add(l.lineId.toLowerCase());
  evidence(l.quantitySource);evidence(l.rateSource);let n,d,elapsed=null;
  if(l.basis==='worker_hours'){if([l.people,l.elapsedHours,l.quantity,l.unit,l.hoursPerUnit].some(v=>v!==null))fail('Review the selected work-time method.');n=scaled(l.workerHours,6);d=1000000n;}
  else if(l.basis==='people_time'){if([l.workerHours,l.quantity,l.unit,l.hoursPerUnit].some(v=>v!==null)||!Number.isInteger(l.people)||l.people<1||l.people>100)fail('Enter between 1 and 100 people and their work time.');n=scaled(l.elapsedHours,6)*BigInt(l.people);d=1000000n;elapsed=l.elapsedHours;}
  else if(l.basis==='quantity_productivity'){if([l.workerHours,l.people,l.elapsedHours].some(v=>v!==null)||!Object.hasOwn(UNITS,l.unit))fail('Choose a supported quantity unit.');const q=scaled(l.quantity,6);if(l.unit==='ea'&&q%1000000n)fail('Enter a whole number of items.');n=q*scaled(l.hoursPerUnit,6);d=hoursD;}
  else fail('Choose how to estimate the work time.');
  const rate=money(l.hourlyCost);let burden=null;
  if(l.rateMode==='all_in'){if(l.burdenPercent!==null)fail('An all-in hourly cost cannot add another labor burden.');burden=0n;}
  else if(l.rateMode==='base_burden'){if(l.burdenPercent!==null){burden=scaled(l.burdenPercent,2,3);if(burden>10000n)fail('Labor burden must be between 0 and 100 percent.');}}
  else fail('Choose a base hourly cost or an all-in hourly cost.');
  const missing=[];if(rate===null)missing.push('Hourly cost');if(burden===null)missing.push('Labor burden');let cents=null;
  if(!missing.length){const numerator=n*rate*(10000n+burden),denominator=d*10000n;cents=(numerator+denominator/2n)/denominator;if(cents>MAX)fail('This task cost is too large. Review the hours and rate.');total+=cents;}else complete=false;
  hoursN+=n*(hoursD/d);
  return {lineId:l.lineId,task:l.task,workerHours:displayHours(n,d),exactWorkerHours:rational(n,d),elapsedHours:elapsed,total:cents===null?null:decimal(cents),missing,index:index+1};
 });
 if(total>MAX)fail('The combined labor cost is too large. Review the tasks.');
 return stableValue({contract:VERSION,lines,workerHours:displayHours(hoursN,hoursD),exactWorkerHours:rational(hoursN,hoursD),total:complete?decimal(total):null,knownCostSubtotal:decimal(total),complete,currency,elapsedHours:null,rounding:'Each task cost is rounded to cents before adding. Displayed worker-hours are rounded to six decimal places.'});
}
function assess(inputs,now=new Date()){
 const today=new Date(now).toISOString().slice(0,10),cautions=[];
 for(const l of inputs.lines)for(const key of ['quantitySource','rateSource']){const e=l[key],codes=[];if(!e.effectiveOn)codes.push('date_unknown');else if(e.effectiveOn>today)codes.push('not_yet_effective');if(!e.endsOn)codes.push('freshness_unknown');else if(e.endsOn<today)codes.push('expired');if(!e.geography.trim())codes.push('applicability_unknown');if(codes.length)cautions.push({lineId:l.lineId,source:key,codes});}
 return stableValue({date:today,cautions});
}
function checkEvidence(inputs,serviceKey,now){if(inputs.serviceKey!==serviceKey)fail('The selected service changed. Refresh and review the tasks.',409);const assessment=assess(inputs,now),a=inputs.assessment;if(!exact(a,['date','cautions','acknowledged','explanation'])||sha256({date:a.date,cautions:a.cautions})!==sha256(assessment)||a.acknowledged!==true||!text(a.explanation,1000,assessment.cautions.length===0))fail('Calculate again, then acknowledge the source limitations and explain the assumptions.');return assessment;}
function normalize(body){if(!exact(body,FIELDS)||!['save','withdraw'].includes(body.action)||![body.expectedRevision,body.expectedDecisionRevision].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=10000)||typeof body.expectedDigest!=='string'||typeof body.expectedDecisionDigest!=='string'||!body.sourcePins||typeof body.sourcePins!=='object'||Array.isArray(body.sourcePins)||body.confirmed!==true||body.confirmationVersion!==VERSION||!text(body.reason,2000)||!['USD','CAD','EUR'].includes(body.currency))fail();if(body.action==='save')calculate(body.inputs,body.currency);else if(body.inputs!==null)fail();return stableValue({...body,reason:body.reason.trim()});}
function basis(review){return review.decisions?.writeBasis||{revision:review.decisions?.current?.revision||0,digest:review.decisions?.current?.digest||'none'};}
function checkBasis(body,review,current){if(body.action==='save'&&body.inputs.serviceKey!==review.materialSourceContext?.serviceKey)fail('The selected service changed. Refresh and review the tasks.',409);const b=basis(review);if(review.isCurrent===false||body.expectedRevision!==(current?.revision||0)||body.expectedDigest!==(current?.digest||'none')||body.expectedDecisionRevision!==b.revision||body.expectedDecisionDigest!==b.digest||sha256(body.sourcePins)!==sha256(review.pins)||body.currency!==review.currency)fail('The estimate or review changed. Refresh and calculate again before confirming.',409);}
function project(data,review,canMutate,simulated=false,mutationsPaused=false,now=new Date()){const expose=e=>e?{...Object.fromEntries(Object.entries(e).filter(([k])=>!['requestKey','requestDigest'].includes(k))),result:e.action==='save'?calculate(e.inputs,e.currency):null,currentAssessment:e.action==='save'?assess(e.inputs,now):null,sourceBasisCurrent:sha256(e.sourcePins)===sha256(review.pins)}:null;return stableValue({contract:VERSION,sourcePins:review.pins,serviceKey:review.materialSourceContext?.serviceKey||null,simulated,canMutate,mutationsPaused,decisionBasis:basis(review),current:expose(data.current),history:(data.history||[]).map(expose),total:data.total||0,truncated:data.truncated===true});}
function demoPlan(history,review,raw,key,now){const body=normalize(raw),digest=sha256(body),old=history.find(e=>e.requestKey===key);if(old){if(old.requestDigest!==digest)fail('This save attempt changed. Refresh before saving again.',409);return{receipt:old,replayed:true};}checkBasis(body,review,history[0]);if(body.action==='save')checkEvidence(body.inputs,review.materialSourceContext?.serviceKey,now);if(body.action==='withdraw'&&history[0]?.action!=='save')fail('There is no saved labor plan to withdraw.');if(history.length>=20)fail('This demo has reached its labor-plan limit. Saved history remains available. Resetting the demo clears its saved practice work.',429);return{replayed:false,receipt:{id:require('node:crypto').randomUUID(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,calculationVersion:VERSION,...body,actorName:'Demo Reviewer',createdAt:now.toISOString(),digest:sha256({body,previous:history[0]?.digest||null}),requestKey:key,requestDigest:digest}};}
module.exports={VERSION,UNITS,calculate,assess,checkEvidence,normalize,checkBasis,project,demoPlan};
