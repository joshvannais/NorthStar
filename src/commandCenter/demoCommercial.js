'use strict';
const c=require('../estimating/commercialContract'),sources=require('../estimating/commercialSources'),{stableValue,sha256}=require('../services/businessProfileAdapter');
function context(workspace,state,estimate,now){const item=require('./workspace').demoCanonicalItems(workspace).find(i=>i.ids.estimate===estimate);if(!item)throw Object.assign(new Error('That demo estimate is unavailable.'),{status:404,code:'COMMERCIAL_UNAVAILABLE'});const {selectDemoRevision,buildRevisionReview,projectSelectedDemoDecisions}=require('../estimating/estimateRevisionReview');const review=buildRevisionReview(item,selectDemoRevision(item,state.estimateRevisions?.[estimate]||[]),{simulated:true});review.decisions=projectSelectedDemoDecisions(state.estimateDecisions?.[estimate]||[],review,true);return {item,review,sources:sources.demo(state,item,review,now)};}
function apply(workspace,state,input,now){
 if(input.operation==='tax_profile')return require('./demoTaxPreparation').apply(state,input.plan,input.idempotencyHash,now);
 const x=context(workspace,state,input.estimateId,now),termsHistory=state.commercialTerms?.[input.estimateId]||[];
 if(input.operation==='commercial_terms'){const r=c.demoPlan(termsHistory,x.review,input.plan,input.idempotencyHash,now,x.sources);return stableValue({...state,commercialTerms:{...state.commercialTerms,[input.estimateId]:r.replayed?termsHistory:[r.receipt,...termsHistory]}});}
 const history=state.commercialApprovals?.[input.estimateId]||[],old=history.find(e=>e.requestKey===input.idempotencyHash),body=c.normalizeApproval(input.plan),requestDigest=sha256(body);
 if(old){if(old.requestDigest!==requestDigest)c.changed('This approval attempt was already used for different entries.');return state;}
 if(history.length>=20)throw Object.assign(new Error('This demo has reached its commercial approval history limit. Saved history remains available. Resetting clears its practice work.'),{status:429,code:'COMMERCIAL_HISTORY_LIMIT'});
 const terms=termsHistory[0],checked=c.approvalDecision(body,terms,x.sources,now);
 const d=require('../estimating/decisionContract').demoDecision(state.estimateDecisions?.[input.estimateId]||[],{...x.item,pins:x.review.pins,currency:x.review.currency},checked.decision,'commercial:'+input.idempotencyHash,'Demo Reviewer',now);
 if(d.replayed)c.changed('An earlier scope and price receipt cannot establish this commercial approval.');
 const binding={id:require('node:crypto').randomUUID(),termsPin:c.pin(terms),decisionPin:c.pin(d.receipt),previousDecisionBasis:x.sources.decisionBasis,authorityPin:terms.authorityPin,scopeSummary:body.scopeSummary,reason:body.reason,exceptions:body.exceptions,policyComparison:checked.policy,createdAt:now.toISOString(),requestKey:input.idempotencyHash,requestDigest,digest:sha256({terms:terms.id,decision:d.receipt.id,body,authority:terms.authorityPin})};
 return stableValue({...state,estimateDecisions:{...state.estimateDecisions,[input.estimateId]:d.history},commercialApprovals:{...state.commercialApprovals,[input.estimateId]:[binding,...history]}});
}
function verify(workspace,oldState,nextState,input,now){
 if(input.operation==='tax_profile'){const expected=require('./demoTaxPreparation').read(nextState,now).result;if(!c.same(expected,nextState.taxPreparationResult))c.changed('The tax preparation date changed. Refresh and review the setup again.');return;}
 const before=context(workspace,oldState,input.estimateId,now),terms=nextState.commercialTerms?.[input.estimateId]?.[0];
 if(input.operation==='commercial_terms'&&terms?.action==='save'){if(terms.evidenceDigest!==before.sources.digest)c.changed();if(!c.same(c.preview(terms.inputs,terms.currency,before.sources,now).result,terms.result))c.changed();}
 if(input.operation==='commercial_ok'){c.approvalDecision(input.plan,oldState.commercialTerms?.[input.estimateId]?.[0],before.sources,now);const after=context(workspace,nextState,input.estimateId,now),binding=nextState.commercialApprovals?.[input.estimateId]?.[0];if(!c.currentState(terms,after.sources,binding).linkedApproval)c.changed();}
}
function replay(state,input){const history=input.operation==='tax_profile'?state.taxProfiles||[]:input.operation==='commercial_terms'?state.commercialTerms?.[input.estimateId]||[]:state.commercialApprovals?.[input.estimateId]||[];const e=history.find(r=>r.requestKey===input.idempotencyHash);if(!e||e.requestDigest!==sha256(input.plan))c.changed('This attempt does not match its saved history. Refresh and review the saved entries.');}
module.exports={context,apply,verify,replay};
