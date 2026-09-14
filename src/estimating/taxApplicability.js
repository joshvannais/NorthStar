'use strict';
const {exact,text,day}=require('./pricingCalculation');
const VERSION='tax-preparation-v2',COMMERCIAL='estimate-commercial-terms-v2';
const property=['residential','commercial','mixed','other'],work=['maintenance','repair','new_construction','capital_improvement','other'],exemption=['none','claimed'];
// Explicit ECMAScript whitespace set shared byte-for-byte with075; never rewrite evidence.
const blankReference=v=>typeof v==='string'&&/^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/.test(v);
const operation=v=>typeof v==='string'&&/^[a-z][a-z0-9_]{0,99}$/.test(v);
function fail(){throw Object.assign(new Error('Review the job details, source dates and tax coverage.'),{status:400,code:'TAX_PROFILE_INVALID'});}
function facts(v){
 if(!exact(v,['serviceOperation','propertyUse','workContext','customerExemption','evidenceRef'])||!(v.serviceOperation===null||operation(v.serviceOperation))||!['unknown',...property].includes(v.propertyUse)||!['unknown',...work].includes(v.workContext)||!['unknown',...exemption].includes(v.customerExemption)||!exact(v.evidenceRef,['serviceOperation','propertyUse','workContext','customerExemption']))fail();
 for(const k of ['serviceOperation','propertyUse','workContext','customerExemption'])if(!text(v.evidenceRef[k],1000,true)||v[k]!==null&&v[k]!=='unknown'&&blankReference(v.evidenceRef[k]))fail();
 return v;
}
function applicability(v){
 if(!exact(v,['serviceOperations','propertyUses','workContexts','customerExemptions']))fail();
 for(const[k,valid]of [['serviceOperations',operation],['propertyUses',x=>property.includes(x)],['workContexts',x=>work.includes(x)],['customerExemptions',x=>exemption.includes(x)]])if(!Array.isArray(v[k])||!v[k].length||v[k].length>12||new Set(v[k]).size!==v[k].length||!v[k].every(valid))fail();return v;
}
function rule(v,{simulated=false}={}){
 const keys=['version','validation','simulated','active','treatment','behavior','ratePercent','legalEffectiveOn','legalEndsOn','reviewedOn','reviewValidThrough','registration','collectionBasis','country','region','locality','jurisdiction','serviceKey','classification','applicability'];
 if(!exact(v,keys)||v.version!==VERSION||v.validation!=='validated'||v.simulated!==simulated||typeof v.active!=='boolean'||!['taxable','zero_rate','exempt'].includes(v.treatment)||!['exclusive','inclusive'].includes(v.behavior)||typeof v.ratePercent!=='string'||!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,4})?$/.test(v.ratePercent)||Number(v.ratePercent)>100||['zero_rate','exempt'].includes(v.treatment)&&Number(v.ratePercent)!==0||!day(v.legalEffectiveOn)||v.legalEndsOn!==null&&!day(v.legalEndsOn)||v.legalEndsOn!==null&&v.legalEndsOn<v.legalEffectiveOn||!day(v.reviewedOn)||!day(v.reviewValidThrough)||v.reviewValidThrough<v.reviewedOn||!['unknown','registered','not_registered','exempt'].includes(v.registration)||!['country','region','locality','jurisdiction','serviceKey','classification','collectionBasis'].every(k=>text(v[k],k==='collectionBasis'?1000:300,k==='locality')))fail();applicability(v.applicability);return v;
}
function current(r,transactionDate,currentDate){return day(transactionDate)&&day(currentDate)&&transactionDate>=r.legalEffectiveOn&&(r.legalEndsOn===null||transactionDate<=r.legalEndsOn)&&currentDate>=r.reviewedOn&&currentDate<=r.reviewValidThrough;}
function matches(f,a){facts(f);applicability(a);for(const [k,list]of [['serviceOperation','serviceOperations'],['propertyUse','propertyUses'],['workContext','workContexts'],['customerExemption','customerExemptions']])if(f[k]!==null&&f[k]!=='unknown'&&!a[list].includes(f[k]))fail();return f.serviceOperation!==null&&f.propertyUse!=='unknown'&&f.workContext!=='unknown'&&f.customerExemption!=='unknown'&&a.serviceOperations.includes(f.serviceOperation)&&a.propertyUses.includes(f.propertyUse)&&a.workContexts.includes(f.workContext)&&a.customerExemptions.includes(f.customerExemption);}
function content(r){const {id,digest,...v}=r;return v;}
module.exports={VERSION,COMMERCIAL,facts,applicability,rule,current,matches,content,fail};
