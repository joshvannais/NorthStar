'use strict';
const {stableValue}=require('../services/businessProfileAdapter');
const VERSION='estimate-pricing-plan-v1';
const MAX=99999999999999n;
const UNITS=['each','person_hour','elapsed_hour','ft','sq_ft','cu_yd','m','sq_m','cu_m','lb','kg','US_gal','L'];
function fail(message='Review the pricing entries.'){throw Object.assign(new Error(message),{status:400,code:'PRICING_PLAN_INVALID'});}
function exact(v,keys){return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');}
function text(v,max=160,empty=false){return typeof v==='string'&&Array.from(v).length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function decimal(n){if(n===null)return null;if(n<0n||n>MAX)fail('The calculated amount is too large. Review the pricing entries.');return `${n/100n}.${String(n%100n).padStart(2,'0')}`;}
function money(v){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(v))fail('Enter a nonnegative amount with two decimal places.');return BigInt(v.replace('.',''));}
function quantity(v){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$/.test(v))fail('Use a nonnegative number with up to four decimal places.');const [w,f='']=v.split('.');return BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));}
function rounded(n,d){if(d<=0n)fail('Enter a positive allocation total.');return (n*2n+d)/(d*2n);}
function day(v){return typeof v==='string'&&v>='1000-01-01'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
function source(v){if(!exact(v,['kind','referenceId','digest','note','effectiveOn','endsOn'])||!['owner_estimate','profile','published_knowledge'].includes(v.kind)||!text(v.note,1000,true)||v.effectiveOn!==null&&!day(v.effectiveOn)||v.endsOn!==null&&!day(v.endsOn)||v.effectiveOn&&v.endsOn&&v.endsOn<v.effectiveOn)fail('Review the source and its dates.');if(v.kind==='owner_estimate'){if(v.referenceId!==null||v.digest!==null)fail('An owner estimate cannot claim a verified reference.');}else if(!text(v.referenceId,200)||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest))fail('Choose an available saved source.');}
function calculate(v,currency,basis={directCosts:null,overheadIncluded:[]}){
 if(!['USD','CAD','EUR'].includes(currency)||!exact(v,['serviceKey','lines','payments','overhead'])||!text(v.serviceKey,100)||!Array.isArray(v.lines)||v.lines.length<1||v.lines.length>12)fail('Use between one and twelve pricing lines.');
 const ids=new Set(),parents=new Map(),rows=[],missing=[];
 for(const l of v.lines){
  if(!exact(l,['lineId','label','kind','quantity','unit','rate','amount','scope','includes','period','source'])||!text(l.lineId,80)||ids.has(l.lineId)||!text(l.label)||!['fixed','unit','package','retainer'].includes(l.kind)||!text(l.scope,2000,true)||!Array.isArray(l.includes)||l.includes.length>11)fail('Review the pricing line and its label.');ids.add(l.lineId);source(l.source);
  let amount=null;
  if(['fixed','package'].includes(l.kind)){if(l.quantity!==null||l.unit!==null||l.rate!==null||l.period!==null)fail('Fixed charges do not use a quantity or period.');amount=money(l.amount);}
  else {if(l.amount!==null)fail('Use the quantity and rate for this charge.');const q=quantity(l.quantity),r=quantity(l.rate);amount=q===null||r===null?null:rounded(q*r,1000000n);if(l.kind==='unit'){if(!UNITS.includes(l.unit)||l.period!==null)fail('Choose the measured unit for this charge.');}else{if(l.unit!=='period'||!exact(l.period,['label','startsOn','endsOn'])||!text(l.period.label)||!day(l.period.startsOn)||!day(l.period.endsOn)||l.period.endsOn<l.period.startsOn||q!==null&&(q<=0n||q%10000n!==0n)||!l.scope.trim())fail('Describe the finite retainer period, inclusions and whole number of periods.');}}
  if(l.kind!=='package'&&l.includes.length)fail('Only a package can include other pricing lines.');
  if(l.kind==='package'&&!l.scope.trim())fail('Describe what the package includes.');
  for(const id of l.includes){if(!text(id,80)||id===l.lineId||parents.has(id))fail('A charge can be included in only one package.');parents.set(id,l.lineId);}
  rows.push({lineId:l.lineId,label:l.label,kind:l.kind,amount:decimal(amount),includedIn:null});
 }
 for(const [id,parent]of parents){if(!ids.has(id))fail('Choose an existing line included in the package.');const seen=new Set([id]);let p=parent;while(p){if(seen.has(p))fail('Packages cannot include each other in a cycle.');seen.add(p);p=parents.get(p);}}
 let subtotal=0n,complete=true;for(const row of rows){row.includedIn=parents.get(row.lineId)||null;if(row.includedIn)continue;if(row.amount===null){complete=false;missing.push(row.lineId);}else subtotal+=money(row.amount);}decimal(subtotal);if(!complete)subtotal=null;
 const p=v.payments;if(!exact(p,['mode','balanceId','stages'])||!['none','amount','share'].includes(p.mode)||!Array.isArray(p.stages)||p.stages.length>12)fail('Review the proposed payment stages.');
 let payments=[],deposits=0,total=0n;const paymentIds=new Set();
 if(p.mode==='none'){if(p.stages.length||p.balanceId!==null)fail('Remove payment stages when no schedule is selected.');}
 else {if(!p.stages.length||!text(p.balanceId,80))fail('Choose the final balance stage.');for(const s of p.stages){if(!exact(s,['stageId','label','kind','value'])||!text(s.stageId,80)||paymentIds.has(s.stageId)||!text(s.label)||!['deposit','milestone','balance'].includes(s.kind))fail('Review the payment stage names.');paymentIds.add(s.stageId);if(s.kind==='deposit')deposits++;let n=p.mode==='amount'?money(s.value):typeof s.value==='string'&&/^(0|[1-9][0-9]{0,2})\.[0-9]{2}$/.test(s.value)?BigInt(s.value.replace('.','')):null;if(n===null||p.mode==='share'&&n>10000n)fail('Enter each payment amount or percentage.');total+=n;payments.push({stageId:s.stageId,label:s.label,kind:s.kind,amount:subtotal===null?null:p.mode==='amount'?decimal(n):decimal(n*subtotal/10000n),share:p.mode==='share'?s.value:null});}
  if(deposits>1||p.stages.filter(s=>s.kind==='balance').length!==1||p.stages.at(-1).stageId!==p.balanceId||p.stages.at(-1).kind!=='balance')fail('Use one final balance stage and at most one deposit.');if(p.mode==='share'&&total!==10000n||p.mode==='amount'&&subtotal!==null&&total!==subtotal)fail('Payment stages must equal the proposed charge.');if(p.mode==='share'&&subtotal!==null){const sum=payments.reduce((n,s)=>n+money(s.amount),0n);payments.at(-1).amount=decimal(money(payments.at(-1).amount)+subtotal-sum);}}
 const o=v.overhead;if(!exact(o,['method','amount','percent','period','source','coverage'])||!['unknown','fixed','percent','period'].includes(o.method))fail('Choose the overhead allocation method.');source(o.source);
 const direct=money(basis.directCosts);let gross=null;
 if(o.method==='fixed'){if(o.percent!==null||o.period!==null)fail();gross=money(o.amount);}
 else if(o.method==='percent'){if(o.amount!==null||o.period!==null)fail();const rate=quantity(o.percent);if(rate!==null&&rate>1000000n)fail('Overhead percentage must be between zero and one hundred.');gross=direct===null||rate===null?null:rounded(direct*rate,1000000n);}
 else if(o.method==='period'){if(o.amount!==null||o.percent!==null||!exact(o.period,['startsOn','endsOn','pool','jobUnits','totalUnits','unit'])||!day(o.period.startsOn)||!day(o.period.endsOn)||o.period.endsOn<o.period.startsOn||!['person_hour','job'].includes(o.period.unit))fail('Review the overhead period and matching allocation units.');const pool=money(o.period.pool),j=quantity(o.period.jobUnits),t=quantity(o.period.totalUnits);if(t!==null&&t<=0n||j!==null&&t!==null&&j>t)fail('Job units cannot exceed the positive period total.');gross=pool===null||j===null||t===null?null:rounded(pool*j,t);}
 else if(o.amount!==null||o.percent!==null||o.period!==null)fail();
 const coverage=o.coverage;if(!exact(coverage,['status','explanation','included'])||!['unknown','disjoint','allocated'].includes(coverage.status)||!text(coverage.explanation,1000,coverage.status==='unknown')||!Array.isArray(coverage.included)||coverage.included.length>12||coverage.status!=='allocated'&&coverage.included.length||coverage.status==='allocated'&&!coverage.included.length)fail('Review which overhead costs are already included.');
 let included=0n;const used=new Set();for(const c of coverage.included){if(!exact(c,['referenceId','amount'])||!text(c.referenceId,200)||used.has(c.referenceId))fail('An included overhead amount can be used only once.');used.add(c.referenceId);const ref=(basis.overheadIncluded||[]).find(r=>r.referenceId===c.referenceId),amount=money(c.amount);if(!ref||amount===null||amount>money(ref.amount))fail('Review the recorded amount already included.');included+=amount;}
 if(gross!==null&&included>gross)fail('Already included overhead cannot exceed the allocation.');
 const overlapResolved=coverage.status!=='unknown'&&basis.overheadUnresolved!==true;
 const incremental=gross===null||!overlapResolved?null:gross-included;
 return stableValue({calculationVersion:VERSION,currency,lines:rows,proposedBeforeTax:decimal(subtotal),payments,missingLines:missing,overhead:{gross:decimal(gross),alreadyIncluded:decimal(included),incremental:decimal(incremental),overlapResolved},directCosts:decimal(direct),costWithOverhead:direct===null||incremental===null?null:decimal(direct+incremental)});
}
module.exports={VERSION,UNITS,MAX,exact,text,fail,money,quantity,decimal,rounded,day,source,calculate};
