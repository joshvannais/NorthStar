'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const p=require('./pricingCalculation'),math=require('./commercialCalculation'),decisions=require('./decisionContract');
const VERSION=math.VERSION;
const FIELDS=['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion','evidenceDigest'];
function changed(message='The commercial review changed. Refresh and review the current charges and tax treatment.'){throw Object.assign(new Error(message),{status:409,code:'COMMERCIAL_CHANGED'});}
const pin=r=>r?{id:r.id,revision:r.revision,digest:r.digest}:null;
const same=(a,b)=>sha256(a??null)===sha256(b??null);
function normalize(b){
 if(!p.exact(b,FIELDS)||!['save','withdraw'].includes(b.action)||![b.expectedRevision,b.expectedDecisionRevision].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=10000)||!p.text(b.expectedDigest,64)||!p.text(b.expectedDecisionDigest,64)||!b.sourcePins||typeof b.sourcePins!=='object'||Array.isArray(b.sourcePins)||!['USD','CAD','EUR'].includes(b.currency)||!p.text(b.reason,2000)||b.confirmed!==true||b.confirmationVersion!==VERSION||typeof b.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.evidenceDigest)||b.action==='withdraw'&&b.inputs!==null)math.fail('Review the commercial entries and confirmation.');
 return stableValue({...b,reason:b.reason.trim()});
}
// The explicit non-decision basis permits only the wrapper's own resulting decision.
// Source builders must supply current, authorized pins, not client declarations.
function authorityPin(s){return stableValue({sourcePins:s.sourcePins,pricingPin:s.pricingPin,policyPin:s.policyPin,profilePin:s.profilePin,taxProfilePin:s.taxProfilePin,rulePins:s.rulePins,sourceDigest:s.sourceDigest,currency:s.currency});}
function preview(inputs,currency,sources,now){
 if(sources.asOfDate!==new Date(now).toISOString().slice(0,10))changed('The review date changed. Refresh and calculate the terms again.');
 if(!sources.pricingPin||!sources.pricing?.result||sources.pricingCurrent!==true||currency!==sources.currency)changed('Save a current pricing plan before reviewing commercial terms.');
 const result=math.calculate(inputs,currency,{pricing:sources.pricing.result,serviceKey:sources.serviceKey,...(sources.simulated?{taxServiceKey:sources.taxServiceKey}:{}),simulated:sources.simulated,validatedRules:sources.validatedRules});
 return stableValue({result,evidenceDigest:sources.digest,authorityPin:authorityPin(sources)});
}
function checkBasis(b,review,current){require('./pricingPlanContract').checkBasis(b,review,current);}
function demoPlan(history,review,raw,key,now,sources){
 const b=normalize(raw),requestDigest=sha256(b),old=history.find(e=>e.requestKey===key);
 if(old){if(old.requestDigest!==requestDigest)changed('This save attempt was already used for different entries.');return {receipt:old,replayed:true};}
 checkBasis(b,review,history[0]);let value=null;
 if(b.action==='save'){if(b.evidenceDigest!==sources.digest)changed();value=preview(b.inputs,b.currency,sources,now);}
 else if(history[0]?.action!=='save')math.fail('There are no saved commercial terms to withdraw.');
 if(history.length>=20)throw Object.assign(new Error('This demo has reached its commercial history limit. Saved history remains available. Resetting clears its practice work.'),{status:429,code:'COMMERCIAL_HISTORY_LIMIT'});
 const receipt={id:require('node:crypto').randomUUID(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,...b,result:value?.result||null,authorityPin:value?.authorityPin||history[0]?.authorityPin,evidence:b.action==='save'?sources:null,actorName:'Demo Reviewer',createdAt:now.toISOString(),requestKey:key,requestDigest,digest:sha256({body:b,sources:b.action==='save'?sources:null,previous:history[0]?.digest||null})};
 return {receipt,replayed:false};
}
function currentState(terms,sources,binding){
 if(!terms||terms.action!=='save')return {current:false,reason:'not_recorded'};
 if(sources.pricingCurrent!==true||!same(terms.authorityPin,authorityPin(sources)))return {current:false,reason:'basis_changed'};
 const before={revision:terms.expectedDecisionRevision,digest:terms.expectedDecisionDigest};
 const self=binding&&same(binding.termsPin,pin(terms))&&same(binding.authorityPin,terms.authorityPin)&&same(binding.previousDecisionBasis,before)&&same(binding.decisionPin&&{revision:binding.decisionPin.revision,digest:binding.decisionPin.digest},sources.decisionBasis)&&binding.decisionPin.id===sources.decision?.id&&sources.decision.action==='approve'&&sources.decision.priceBeforeTax===terms.result?.netBeforeTax&&same(sources.decision.sourcePins,terms.sourcePins);
 if(!same(before,sources.decisionBasis)&&!self)return {current:false,reason:'decision_changed'};
 return {current:true,linkedApproval:!!self};
}
function comparison(terms,sources){
 const net=math.money(terms?.result?.netBeforeTax??null),policy=sources.policy;
 if(!policy||policy.action!=='save')return {state:'unavailable',reason:'no_policy',threshold:null,difference:null};
 if(sources.policyBasisCurrent!==true||policy.expectedDecisionRevision!==terms.expectedDecisionRevision||policy.expectedDecisionDigest!==terms.expectedDecisionDigest)return {state:'unavailable',reason:'changed_policy',threshold:null,difference:null};
 const threshold=math.money(policy.result?.threshold??null);
 if(net===null||threshold===null)return {state:'unavailable',reason:'incomplete_policy',threshold:null,difference:null};
 const difference=net-threshold;
 return {state:difference<0n?'below':difference>0n?'above':'at',reason:null,threshold:math.amount(threshold),difference:(difference<0n?'-':'')+math.amount(difference<0n?-difference:difference)};
}
const APPROVAL_FIELDS=['termsPin','evidenceDigest','expectedDecisionRevision','expectedDecisionDigest','scopeSummary','reason','confirmed','confirmationVersion','exceptions'];
function normalizeApproval(b){
 if(!p.exact(b,APPROVAL_FIELDS)||!p.exact(b.termsPin,['id','revision','digest'])||!p.text(b.termsPin.id,80)||!Number.isSafeInteger(b.termsPin.revision)||b.termsPin.revision<1||typeof b.termsPin.digest!=='string'||!/^[a-f0-9]{64}$/.test(b.termsPin.digest)||typeof b.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.evidenceDigest)||!Number.isSafeInteger(b.expectedDecisionRevision)||b.expectedDecisionRevision<0||!p.text(b.expectedDecisionDigest,64)||!p.text(b.scopeSummary,4000)||!p.text(b.reason,2000)||b.confirmed!==true||b.confirmationVersion!==VERSION||!p.exact(b.exceptions,['policyReason','policyUnknownAcknowledged','ownerRecordedTaxAcknowledged'])||!p.text(b.exceptions.policyReason,2000,true)||typeof b.exceptions.policyUnknownAcknowledged!=='boolean'||typeof b.exceptions.ownerRecordedTaxAcknowledged!=='boolean')math.fail('Review the full commercial approval and its acknowledgments.');
 return stableValue({...b,scopeSummary:b.scopeSummary.trim(),reason:b.reason.trim(),exceptions:{...b.exceptions,policyReason:b.exceptions.policyReason.trim()}});
}
function approvalDecision(raw,terms,sources,now){
 const b=normalizeApproval(raw);
 if(!same(b.termsPin,pin(terms))||b.evidenceDigest!==sources.digest||!same({revision:b.expectedDecisionRevision,digest:b.expectedDecisionDigest},sources.decisionBasis)||!currentState(terms,sources,null).current)changed();
 const result=preview(terms.inputs,terms.currency,sources,now).result;
 if(!same(result,terms.result))changed();
 if(!result.complete)math.fail('Resolve the missing charges and tax treatment before approving the total.');
 const policy=comparison(terms,sources);
 if(policy.state==='below'&&!b.exceptions.policyReason)math.fail('Record why you are approving a price below the current policy.');
 if(policy.state==='unavailable'&&!b.exceptions.policyUnknownAcknowledged)math.fail('Acknowledge that a current policy comparison is unavailable.');
 if(result.taxAuthority==='owner_recorded'&&!b.exceptions.ownerRecordedTaxAcknowledged)math.fail('Confirm that you reviewed the owner-recorded tax treatment.');
 return {body:b,policy,decision:decisions.normalizeDecision({action:'approve',expectedRevision:b.expectedDecisionRevision,expectedDigest:b.expectedDecisionDigest,sourcePins:terms.sourcePins,scopeSummary:b.scopeSummary,priceBeforeTax:result.netBeforeTax,currency:terms.currency,reason:b.reason,confirmed:true,confirmationVersion:decisions.VERSION})};
}
function customerSummary(terms,binding,sources){
 if(!currentState(terms,sources,binding).linkedApproval)return null;
 // Explicit customer allowlist: no private cost/policy/source/registration payload.
 return stableValue({termsPin:pin(terms),decisionPin:binding.decisionPin,currency:terms.currency,scopeSummary:binding.scopeSummary,lines:terms.result.lines,adjustments:terms.result.adjustments,taxGroups:terms.result.taxGroups,netBeforeTax:terms.result.netBeforeTax,tax:terms.result.tax,total:terms.result.total,payments:terms.result.payments,taxAuthority:terms.result.taxAuthority});
}
module.exports={VERSION,FIELDS,normalize,normalizeApproval,pin,same,authorityPin,preview,checkBasis,demoPlan,currentState,comparison,approvalDecision,customerSummary,changed};
