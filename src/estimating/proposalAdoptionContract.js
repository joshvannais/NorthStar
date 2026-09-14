'use strict';

const {stableValue,sha256}=require('../services/businessProfileAdapter');
const proposal=require('./estimateProposal');
const VERSION='estimate-proposal-adoption-v1';
const KINDS=Object.freeze(['materials','labor','equipment','travel','pricing']);
const HASH=/^[a-f0-9]{64}$/;
function fail(message,status=400,code='PROPOSAL_ADOPTION_INVALID'){
 throw Object.assign(new Error(message),{status,code});
}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
function normalize(raw,{preview=false}={}){
 if(!exact(raw,['version','draft','selection','previousReceipt','coverage','pricingPolicy','expectedReviewDigest','confirmed','reason'])||raw.version!==VERSION||Buffer.byteLength(JSON.stringify(raw))>131072)fail('Review the prepared estimate and confirmation.');
 const draft=proposal.normalize(raw.draft);
 if(!draft.expectedBasisDigest)fail('Prepare and review the current estimate before adopting it.');
 if(!exact(raw.selection,KINDS)||KINDS.some(k=>!['retain','replace'].includes(raw.selection[k])))fail('Choose which saved plans to keep and which to replace.');
 if(!KINDS.slice(0,4).some(k=>raw.selection[k]==='replace'))fail('Choose at least one cost plan to replace. Use Edit for a price-only change.');
 if(raw.previousReceipt!==null&&(!exact(raw.previousReceipt,['id','revision','digest'])||! /^[a-f0-9-]{36}$/.test(raw.previousReceipt.id)||!Number.isSafeInteger(raw.previousReceipt.revision)||raw.previousReceipt.revision<1||raw.previousReceipt.revision>10000||!HASH.test(raw.previousReceipt.digest)))fail('Refresh to check the saved estimate history.',409);
 if(!exact(raw.coverage,['costs','overhead']))fail('Review which costs are already included.');
 if(raw.pricingPolicy!==null&&(!exact(raw.pricingPolicy,['inputs','sourceDigest','currentPin'])||!HASH.test(raw.pricingPolicy.sourceDigest)||raw.selection.pricing!=='replace'))fail('Review the pricing policy with the proposed price.');
 if(raw.pricingPolicy?.currentPin!==undefined&&raw.pricingPolicy.currentPin!==null&&(!exact(raw.pricingPolicy.currentPin,['id','revision','digest'])||!HASH.test(raw.pricingPolicy.currentPin.digest)||!Number.isSafeInteger(raw.pricingPolicy.currentPin.revision)))fail('Refresh to check the saved pricing policy.',409);
 if(typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>2000||/[\u0000-\u001f\u007f-\u009f]/.test(raw.reason))fail('Add a short reason for this estimate change.');
 if(typeof raw.confirmed!=='boolean'||(!preview&&raw.confirmed!==true))fail('Review and confirm the prepared estimate before adopting it.');
 if(!(preview&&raw.expectedReviewDigest===null)&&!HASH.test(raw.expectedReviewDigest))fail('Calculate and review the prepared estimate before adopting it.');
 return stableValue({...raw,draft});
}
function requestDigest(body){return sha256(normalize(body));}
function checkReplay(history,body,key){
 const prior=history.find(r=>r.requestKey===key);
 if(!prior)return null;
 if(!HASH.test(prior.requestDigest||'')||prior.requestDigest!==requestDigest(body))fail('This save attempt was used for different entries. Refresh before starting another review.',409,'PROPOSAL_ADOPTION_KEY_CONFLICT');
 return prior;
}
function assertCurrent(review,body,now){
 if(review.version!==VERSION||!HASH.test(review.reviewDigest||'')||review.reviewDigest!==body.expectedReviewDigest)fail('The prepared estimate changed. Refresh and review it again.',409);
 if(!Number.isFinite(Date.parse(review.expiresAt))||Date.parse(review.expiresAt)<=new Date(now).getTime())fail('This estimate review expired. Refresh and review it again.',410);
 if(review.state!=='ready'||review.completeCost===null)fail('Finish the required cost details before adopting this estimate.');
}
module.exports={VERSION,KINDS,normalize,requestDigest,checkReplay,assertCurrent,fail};
