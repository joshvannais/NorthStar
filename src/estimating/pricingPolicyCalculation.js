'use strict';
const legacy=require('./pricingCalculation');
const {stableValue}=require('../services/businessProfileAdapter');
const VERSION='estimate-pricing-policy-v1';
function fail(message='Review the pricing policy entries.'){throw Object.assign(new Error(message),{status:400,code:'PRICING_POLICY_INVALID'});}
function money(v){try{return legacy.money(v);}catch(e){fail(e.message);}}
function amount(v){try{return legacy.decimal(v);}catch(e){fail(e.message);}}
function signed(v){return v===null?null:(v<0n?'-':'')+amount(v<0n?-v:v);}
// Ties are away from zero for signed displayed percentages, matching PostgreSQL round(numeric).
function ratio(n,d){if(d===0n)return null;const x=n*1000000n,a=x<0n?-x:x,r=(a*2n+d)/(2n*d);return{value:(x<0n&&r!==0n?'-':'')+`${r/10000n}.${String(r%10000n).padStart(4,'0')}`,approximate:a%d!==0n};}
function percent(v,max){if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,3})\.[0-9]{2}$/.test(v))fail('Enter a percentage with up to two decimal places.');const n=BigInt(v.replace('.',''));if(n>max)fail('The percentage is outside the supported range.');return n;}
function calculate(v,currency,basis){
 if(!['USD','CAD','EUR'].includes(currency)||!legacy.exact(v,['serviceKey','method','percent','contingency','minimum','source'])||!legacy.text(v.serviceKey,100)||!['unknown','markup','target_margin'].includes(v.method))fail();
 legacy.source(v.source);
 const rate=percent(v.percent,v.method==='target_margin'?9999n:100000n);if(v.method==='unknown'&&v.percent!==null)fail('Choose a pricing method before entering a percentage.');
 const c=v.contingency;if(!legacy.exact(c,['method','amount','percent','coverage'])||!['unknown','none','fixed','percent'].includes(c.method)||!legacy.exact(c.coverage,['status','explanation'])||!['unknown','declared_separate'].includes(c.coverage.status)||!legacy.text(c.coverage.explanation,1000,c.coverage.status==='unknown'))fail('Review the additional allowance and which expenses it covers.');
 const direct=money(basis.directCosts),overhead=basis.overhead;
 if(!overhead||!legacy.exact(overhead,['gross','alreadyIncluded','incremental','overlapResolved']))fail('Refresh to load the saved overhead.');
 const gross=money(overhead.gross),included=money(overhead.alreadyIncluded),h=money(overhead.incremental);
 if(gross!==null&&included!==null&&included>gross||h!==null&&(gross===null||included===null||gross-included!==h||overhead.overlapResolved!==true))fail('The saved overhead amounts do not agree. Refresh the pricing plan.');
 const base=direct===null||h===null?null:direct+h;amount(base);
 let allowance=null;
 if(c.method==='fixed'){if(c.percent!==null)fail();allowance=money(c.amount);}
 else if(c.method==='percent'){if(c.amount!==null)fail();const p=percent(c.percent,10000n);allowance=base===null||p===null?null:legacy.rounded(base*p,10000n);}
 else {if(c.amount!==null||c.percent!==null)fail();if(c.method==='none')allowance=0n;}
 amount(allowance);
 const coverageResolved=c.coverage.status==='declared_separate';
 const cost=base===null||allowance===null||!coverageResolved?null:base+allowance;amount(cost);
 let threshold=null;
 if(cost!==null&&rate!==null&&v.method!=='unknown'){const n=v.method==='markup'?cost*(10000n+rate):cost*10000n,d=v.method==='markup'?10000n:10000n-rate;threshold=(n+d-1n)/d;amount(threshold);}
 const m=v.minimum;if(!legacy.exact(m,['method','amount'])||!['none','fixed'].includes(m.method)||m.method==='none'&&m.amount!==null)fail('Choose a minimum-price rule and its amount.');const floor=m.method==='none'?0n:money(m.amount);
 const final=threshold===null||floor===null?null:threshold>floor?threshold:floor;
 const compare=p=>{p=money(p);return p===null?null:{price:amount(p),remaining:cost===null?null:signed(p-cost),thresholdDifference:final===null?null:signed(p-final),status:final===null?'unavailable':p<final?'below':p>final?'above':'at',fixedFloorDifference:m.method==='fixed'&&floor!==null?signed(p-floor):null,achievedMarkup:cost===null?null:ratio(p-cost,cost),achievedMargin:cost===null?null:ratio(p-cost,p)};};
 return stableValue({calculationVersion:VERSION,currency,directCosts:amount(direct),overhead,base:amount(base),allowance:amount(allowance),coverageResolved,policyCost:amount(cost),method:v.method,percent:v.percent,calculatedThreshold:amount(threshold),minimum:amount(floor),threshold:amount(final),binding:final===null?'unavailable':threshold===floor?'equal':floor>threshold?'minimum':'method',floorIncrease:threshold===null||floor===null?null:amount(floor>threshold?floor-threshold:0n),proposed:compare(basis.proposedBeforeTax),reviewed:compare(basis.reviewedPrice)});
}
module.exports={...legacy,VERSION,fail,money,decimal:amount,signed,ratio,percent,calculate};
