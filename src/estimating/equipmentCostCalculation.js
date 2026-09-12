'use strict';

// All arithmetic is rational cents. A line is rounded once, after combining its
// equipment-only contributions; displayed rates never feed the calculation.
const {stableValue}=require('../services/businessProfileAdapter');
const VERSION='estimate-equipment-cost-plan-v1';
const MAX=99999999999999n, SCALE=1000000n;
const CATEGORIES=['capital_recovery','debt_service','interest','insurance','maintenance','operating','fuel_energy','consumables'];
const LINE_KEYS=['lineId','access','method','notApplicableReason','plannedHours','rental','allocation','operating','fees','source'];
function fail(message='Review the equipment cost entries.'){throw Object.assign(new Error(message),{status:400,code:'EQUIPMENT_COST_INVALID'});}
function exact(v,keys){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v,max,blank=false){return typeof v==='string'&&(blank||v.trim().length>0)&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function quantity(v){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(v))fail('Enter a nonnegative quantity with up to six decimal places.');const[a,b='']=v.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(6,'0'));}
function money(v){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(v))fail('Enter a cost with two decimal places, or leave it unknown.');return BigInt(v.replace('.',''));}
function decimal(v){return v===null?null:String(v/100n)+'.'+String(v%100n).padStart(2,'0');}
function gcd(a,b){while(b){const r=a%b;a=b;b=r;}return a;}
function rational(n,d=1n){if(d<=0n)fail('Usable equipment hours must be greater than zero.');const g=gcd(n,d);return{n:n/g,d:d/g};}
function add(a,b){return rational(a.n*b.d+b.n*a.d,a.d*b.d);}
function round(v){return(v.n*2n+v.d)/(v.d*2n);}
function source(v){
 if(!exact(v,['kind','issuer','reference','note','effectiveOn','endsOn','geography'])||!['my_estimate','company_reference','published_reference'].includes(v.kind)||!text(v.issuer,160,true)||!text(v.reference,300,true)||!text(v.note,500,true)||!text(v.geography,160,true))fail('Review the equipment cost source.');
 if(v.kind!=='my_estimate'&&!v.issuer.trim()&&!v.reference.trim())fail('Name the company or published reference.');
 for(const k of ['effectiveOn','endsOn'])if(v[k]!==null&&(typeof v[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v[k])||v[k]<'1000-01-01'||!Number.isFinite(Date.parse(v[k]))||new Date(v[k]).toISOString().slice(0,10)!==v[k]))fail('Enter a valid source date or leave it blank.');
 if(v.effectiveOn&&v.endsOn&&v.endsOn<v.effectiveOn)fail('The source end date must follow its effective date.');
}
function coverage(v){
 if(!exact(v,['status','basis','note'])||!['covered','unaccounted','unknown'].includes(v.status)||!text(v.note,500,true))fail('Review where the operator and travel costs are covered.');
 if(v.status==='covered'){if(!v.basis||typeof v.basis!=='object'||Array.isArray(v.basis)||!text(v.note,500))fail('Identify the reviewed cost basis and explain its coverage.');}
 else if(v.basis!==null)fail('Unconfirmed coverage cannot identify an approved cost basis.');
}
function charge(v,missing,outside,label){
 if(!exact(v,['amount','scope','split']))fail('Review the equipment charge and what it includes.');
 const amount=money(v.amount);
 if(v.scope==='equipment_only'){
  if(v.split!==null)fail('An equipment-only charge cannot also have a mixed-cost split.');
  if(amount===null)missing.push(label);
  return amount;
 }
 if(v.scope!=='mixed'||!exact(v.split,['equipment','operator','travel','overhead','operatorCoverage','travelCoverage']))fail('Separate the equipment share of the mixed charge.');
 const s=v.split,parts=['equipment','operator','travel','overhead'].map(k=>money(s[k]));
 coverage(s.operatorCoverage);coverage(s.travelCoverage);
 if(amount===null||parts.some(p=>p===null))missing.push(label+' allocation');
 else if(parts.reduce((a,b)=>a+b,0n)!==amount)fail('The equipment, operator, travel and overhead shares must equal the quoted total.');
 for(const[k,i]of[['operator',1],['travel',2]])if(parts[i]===null||(parts[i]>0n&&s[k+'Coverage'].status!=='covered'))outside.push({kind:k,label,amount:decimal(parts[i]),status:s[k+'Coverage'].status});
 return parts[0];
}
function calculateLine(l,index){
 if(!exact(l,LINE_KEYS)||typeof l.lineId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(l.lineId)||!['owned','rented','financed','proposed','unknown'].includes(l.access))fail('Review the saved equipment line.');
 source(l.source);
 if(l.method==='not_applicable'){
  if(!text(l.notApplicableReason,500)||[l.plannedHours,l.rental,l.allocation,l.operating].some(v=>v!==null)||!Array.isArray(l.fees)||l.fees.length)fail('Explain why this equipment has no applicable job cost.');
  return{lineId:l.lineId,index:index+1,total:'0.00',knownCostSubtotal:'0.00',complete:true,missing:[],outsideCoverage:[],exactKnownCents:{numerator:'0',denominator:'1'}};
 }
 if(l.notApplicableReason!==null)fail('Remove the not-applicable explanation when entering equipment costs.');
 const hours=quantity(l.plannedHours),missing=[],outside=[],charged=new Set();let sum=rational(0n);
 function include(c,n=1n,d=1n){if(c!==null&&n!==null)sum=add(sum,rational(c*n,d));}
 function category(k){if(!CATEGORIES.includes(k)||charged.has(k))fail('A cost category cannot be charged more than once.');charged.add(k);}
 if(l.method==='rental'){
  if(l.allocation!==null||!exact(l.rental,['unit','quantity','minimumQuantity','charge'])||!['hour','day','week','month','job'].includes(l.rental.unit))fail('Choose the rental billing unit and quantity.');
  const r=l.rental,q=quantity(r.quantity),minimum=quantity(r.minimumQuantity);
  if(r.unit==='job'&&q!==SCALE)fail('A per-job rental uses one billed job.');
  if(q===null)missing.push('Billed quantity');
  if(q!==null&&minimum!==null&&q<minimum)fail('The billed quantity must meet the stated rental minimum.');
  include(charge(r.charge,missing,outside,'Rental cost'),q,SCALE);
 }else if(['economic_recovery','financing_cash'].includes(l.method)){
  if(l.rental!==null||!exact(l.allocation,['period','usableHours','pool','includedCategories','additionalCosts'])||!['month','year'].includes(l.allocation.period))fail('Use one period for the cost pool and usable equipment hours.');
  const a=l.allocation,usable=quantity(a.usableHours);
  if(usable===0n)fail('Usable equipment hours must be greater than zero.');
  if(usable===null)missing.push('Usable equipment hours');if(hours===null)missing.push('Planned equipment hours');
  if(!Array.isArray(a.includedCategories)||a.includedCategories.length>6||!Array.isArray(a.additionalCosts)||a.additionalCosts.length>4)fail('Review the costs included in the equipment pool.');
  const required=l.method==='economic_recovery'?'capital_recovery':'debt_service',forbidden=l.method==='economic_recovery'?'debt_service':'capital_recovery';
  for(const k of a.includedCategories)category(k);
  if(!charged.has(required)||charged.has(forbidden))fail('Use either economic recovery or financing cash allocation, without adding both.');
  const pool=charge(a.pool,missing,outside,'Equipment cost pool');
  if(usable!==null&&hours!==null)include(pool,hours,usable);
  for(const c of a.additionalCosts){
   if(!exact(c,['category','label','charge'])||!text(c.label,160)||c.category===forbidden)fail('Review the separate period costs.');category(c.category);
   const value=charge(c.charge,missing,outside,c.label);if(usable!==null&&hours!==null)include(value,hours,usable);
  }
 }else fail('Choose a rental, economic recovery or financing cost method.');
 if(!exact(l.operating,['mode','allIn','fuelEnergy','consumables','maintenance']))fail('Review the equipment operating costs.');
 const op=l.operating;
 function operatingRate(entry,label,k){
  if(!exact(entry,['status','rate'])||!['known','not_applicable','unknown'].includes(entry.status))fail('Mark each operating cost as known, not applicable or unknown.');
  if(entry.status==='known'){category(k);const c=charge(entry.rate,missing,outside,label);if(hours===null)missing.push('Planned equipment hours');include(c,hours,SCALE);}
  else{if(entry.rate!==null)fail('Only a known operating cost can contain a rate.');if(entry.status==='unknown')missing.push(label);}
 }
 if(op.mode==='all_in'){
  if([op.fuelEnergy,op.consumables,op.maintenance].some(v=>v!==null))fail('An all-in operating rate cannot add separate operating rates.');
  if(op.allIn?.status==='known'&&['operating','fuel_energy','consumables','maintenance'].some(k=>charged.has(k)))fail('Operating costs already in the pool cannot be charged again.');
  operatingRate(op.allIn,'Equipment operating cost','operating');
 }else if(op.mode==='separate'){
  if(op.allIn!==null)fail('Separate operating rates cannot include an all-in rate.');
  if(charged.has('operating')&&[op.fuelEnergy,op.consumables,op.maintenance].some(v=>v?.status==='known'))fail('The equipment pool already includes operating costs.');
  operatingRate(op.fuelEnergy,'Fuel or energy','fuel_energy');operatingRate(op.consumables,'Consumables','consumables');operatingRate(op.maintenance,'Maintenance','maintenance');
 }else fail('Choose all-in or separate operating costs.');
 if(!Array.isArray(l.fees)||l.fees.length>4)fail('Add no more than four separate equipment-only job fees.');
 for(const fee of l.fees){if(!exact(fee,['category','label','amount'])||!text(fee.label,160)||!text(fee.category,80)||charged.has(fee.category)||['operator','travel','delivery','tax','deposit','overhead','capital_recovery','debt_service'].includes(fee.category))fail('Use distinct, nonrefundable equipment-only fees.');charged.add(fee.category);const c=money(fee.amount);if(c===null)missing.push(fee.label);include(c);}
 const cents=round(sum);if(cents>MAX)fail('This equipment cost is too large. Review its hours and rates.');
 const complete=missing.length===0&&outside.length===0;
 return{lineId:l.lineId,index:index+1,total:complete?decimal(cents):null,knownCostSubtotal:decimal(cents),complete,missing:[...new Set(missing)],outsideCoverage:outside,exactKnownCents:{numerator:String(sum.n),denominator:String(sum.d)}};
}
function calculate(inputs,currency){
 if(!inputs||!Array.isArray(inputs.lines)||inputs.lines.length<1||inputs.lines.length>12||!['USD','CAD','EUR'].includes(currency))fail('Add costs for one to twelve equipment lines in the estimate currency.');
 const ids=new Set();const lines=inputs.lines.map((l,i)=>{const r=calculateLine(l,i),id=r.lineId.toLowerCase();if(ids.has(id))fail('Each equipment line can appear only once.');ids.add(id);return r;});
 const subtotal=lines.reduce((n,l)=>n+money(l.knownCostSubtotal),0n);if(subtotal>MAX)fail('The combined equipment cost is too large. Review the entries.');
 const complete=lines.every(l=>l.complete);
 return stableValue({contract:VERSION,currency,lines,total:complete?decimal(subtotal):null,knownCostSubtotal:decimal(subtotal),complete,rounding:'Each equipment line is rounded to cents before adding.'});
}
module.exports={VERSION,calculate,calculateLine,quantity,money,decimal,source,exact,text,fail};
