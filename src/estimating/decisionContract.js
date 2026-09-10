'use strict';
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const VERSION = 'estimate-quote-preparation-v1';
const FIELDS = ['action','expectedRevision','expectedDigest','sourcePins','scopeSummary','priceBeforeTax','currency','reason','confirmed','confirmationVersion'];
function invalid(message='Review the scope, price and confirmation before saving.') {return Object.assign(new Error(message),{status:400,code:'ESTIMATE_DECISION_INVALID'});}
function normalizeDecision(body) {
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join('|')!==FIELDS.slice().sort().join('|')||Buffer.byteLength(JSON.stringify(body))>32768)throw invalid();
 if(!['approve','withdraw'].includes(body.action)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>10000||typeof body.expectedDigest!=='string'||!body.sourcePins||typeof body.sourcePins!=='object'||Array.isArray(body.sourcePins)||body.confirmed!==true||body.confirmationVersion!==VERSION||typeof body.currency!=='string'||typeof body.reason!=='string'||body.reason.trim().length<1||body.reason.trim().length>2000)throw invalid();
 if(body.action==='approve'&&(typeof body.scopeSummary!=='string'||!body.scopeSummary.trim()||body.scopeSummary.trim().length>4000||typeof body.priceBeforeTax!=='string'||!/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(body.priceBeforeTax)))throw invalid('Enter a scope summary and a nonnegative price with exactly two decimal places.');
 if(body.action==='withdraw'&&(body.scopeSummary!==null||body.priceBeforeTax!==null))throw invalid();
 return stableValue({...body,reason:body.reason.trim(),scopeSummary:body.scopeSummary===null?null:body.scopeSummary.trim()});
}
function projectDecisions(state, enabled, simulated=false) {
 const fields=['id','revision','digest','previousId','action','actorName','createdAt','sourcePins','scopeSummary','priceBeforeTax','currency','reason','confirmationVersion'];
 const project=event=>event?Object.fromEntries(fields.map(key=>[key,event[key]])):null;
 const current=project(state.current);
 return {current,history:(state.history||[]).map(project),total:state.total||0,truncated:state.truncated===true,simulated,canApprove:enabled,canWithdraw:enabled&&current?.action==='approve',
  status:current?.action==='approve'?'approved_for_quote_preparation':current?'withdrawn':'not_recorded_here',
  message:!current?'Approval is not recorded here. Confirm the job and price before preparing a customer quote.':current.action==='approve'?'Scope and price approved for quote preparation. Nothing has been sent to the customer.':'The approval was withdrawn. Review the job and price before preparing a quote.',
  recoveryMessage:enabled?null:'New decisions are paused. Saved reviews and history remain available.'};
}
function demoDecision(state, item, body, key, actorName, now) {
 const value=normalizeDecision(body),history=(state||[]).slice();const current=history[0]||null;
 const digest=sha256(value),replay=history.find(event=>event.requestKey===key);
 if(replay){if(replay.requestDigest!==digest)throw Object.assign(new Error('That save attempt was already used for different details.'),{status:409,code:'ESTIMATE_DECISION_CONFLICT'});return {history,receipt:replay,replayed:true};}
 if(value.expectedRevision!==(current?.revision||0)||value.expectedDigest!==(current?.digest||'none')||sha256(value.sourcePins)!==sha256(item.pins)||value.currency!==item.currency)throw Object.assign(new Error('The review changed. Refresh and review your entries before saving.'),{status:409,code:'ESTIMATE_DECISION_CONFLICT'});
 if(value.action==='withdraw'&&current?.action!=='approve')throw invalid();if(history.length>=20)throw Object.assign(new Error('This demo has reached its review limit. Reset the demo to practice again.'),{status:429,code:'DEMO_REVIEW_LIMIT'});
 const receipt={id:require('node:crypto').randomUUID(),revision:(current?.revision||0)+1,previousId:current?.id||null,action:value.action,sourcePins:item.pins,scopeSummary:value.scopeSummary,priceBeforeTax:value.priceBeforeTax,currency:item.currency,reason:value.reason,confirmationVersion:VERSION,actorName,createdAt:now.toISOString(),digest:sha256({digest,prior:current?.digest||null}),requestKey:key,requestDigest:digest};
 return {history:[receipt,...history],receipt,replayed:false};
}
module.exports={VERSION,normalizeDecision,projectDecisions,demoDecision};
