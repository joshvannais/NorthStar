'use strict';

const crypto=require('node:crypto');
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const CONFIRMATION_VERSION='customer-estimate-issue-v1';

function invalid(message='Review and confirm this customer estimate before issuing it.'){
  throw Object.assign(new Error(message),{status:400,code:'CUSTOMER_ESTIMATE_ISSUE_INVALID'});
}
function normalize(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['reason','confirmed','confirmationVersion'].includes(k))||raw.confirmed!==true||raw.confirmationVersion!==CONFIRMATION_VERSION||typeof raw.reason!=='string')invalid();
  const reason=raw.reason.trim().replace(/\s+/g,' ');if(!reason||reason.length>1000)invalid();
  return Object.freeze(stableValue({reason,confirmed:true,confirmationVersion:CONFIRMATION_VERSION}));
}
function issuedDocument(preview){
  if(!preview||preview.contract!=='NorthStarCustomerEstimatePreview/v1'||preview.state!=='preview')invalid('The approved customer estimate is unavailable. Refresh and review it again.');
  return Object.freeze(stableValue({...preview,state:'issued',notice:preview.notice&&preview.notice.startsWith('Fictional')?preview.notice:'Issued estimate. Delivery and customer response have not been recorded.',capabilities:{downloadPdf:true,downloadImage:true,accept:false,askQuestion:false}}));
}
function envelope(body,document,approvalPin){
  const normalized=normalize(body);if(!approvalPin||typeof approvalPin.id!=='string'||typeof approvalPin.digest!=='string')invalid('The current approval is unavailable. Review the estimate again.');
  return Object.freeze(stableValue({...normalized,approvalPin:{id:approvalPin.id,digest:approvalPin.digest},document}));
}
function demoIssue(history,body,document,approvalPin,requestKey,actorName,createdAt){
  const value=envelope(body,document,approvalPin),requestDigest=sha256(value),prior=(history||[]).find(x=>x.requestKey===requestKey);
  if(prior){if(prior.requestDigest!==requestDigest)invalid('This issue attempt was changed. Refresh and try again.');return{receipt:prior,replayed:true};}
  const already=(history||[]).find(x=>x.approvalPin&&x.approvalPin.id===approvalPin.id);if(already)return{receipt:already,replayed:true};
  const revision=(history&&history[0]?history[0].revision:0)+1;if(revision>10000)throw Object.assign(new Error('This estimate reached its issued-version limit.'),{status:429,code:'CUSTOMER_ESTIMATE_HISTORY_LIMIT'});
  const receipt=Object.freeze(stableValue({id:crypto.randomUUID(),revision,previousId:history&&history[0]?history[0].id:null,actorName:actorName||'Company reviewer',reason:value.reason,approvalPin:value.approvalPin,document:value.document,documentDigest:sha256(value.document),requestKey,requestDigest,createdAt:new Date(createdAt).toISOString()}));
  return{receipt,replayed:false};
}

module.exports={CONFIRMATION_VERSION,normalize,issuedDocument,envelope,demoIssue,invalid};
