'use strict';

const DIGEST=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE=/^[a-z0-9][a-z0-9._-]{1,63}$/;
const CONSENT_KEYS=['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion'];
const PROPOSAL_KEYS=['expectedConsentRevision','expectedConsentDigest','summaryIds','reason','confirmed','confirmationVersion'];
function fail(message='Cross-job proposal details are invalid.'){throw Object.assign(new Error(message),{code:'M25_JOB_OUTCOME_PROPOSAL_INPUT_INVALID',status:400});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');}
function text(value){return typeof value==='string'&&value===value.trim()&&value===value.normalize('NFC')&&value.length>=1&&value.length<=2000&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);}
function normalizeConsent(body){if(!exact(body,CONSENT_KEYS)||!['grant','revoke'].includes(body.action)||!Number.isInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>10000||!(body.expectedDigest==='none'||DIGEST.test(String(body.expectedDigest||'')))||((body.expectedRevision===0)!==(body.expectedDigest==='none'))||!text(body.reason)||body.confirmed!==true||body.confirmationVersion!=='m25-job-outcome-proposal-consent-v1')fail('Cross-job proposal permission details are invalid.');return Object.freeze({...body});}
function normalizeService(serviceKey){if(typeof serviceKey!=='string'||!SERVICE.test(serviceKey))fail();return serviceKey;}
function normalizeProposal(serviceKey,body){normalizeService(serviceKey);if(!exact(body,PROPOSAL_KEYS)||!Number.isInteger(body.expectedConsentRevision)||body.expectedConsentRevision<1||body.expectedConsentRevision>10000||!DIGEST.test(String(body.expectedConsentDigest||''))||!Array.isArray(body.summaryIds)||body.summaryIds.length<5||body.summaryIds.length>100||!text(body.reason)||body.confirmed!==true||body.confirmationVersion!=='m25-cross-job-proposal-generation-v1')fail();const ids=body.summaryIds.map(value=>String(value||'').toLowerCase());if(ids.some(value=>!UUID.test(value))||new Set(ids).size!==ids.length)fail();ids.sort();if(ids.some((value,index)=>value!==body.summaryIds[index]))fail('Select distinct job summaries in the displayed order.');return Object.freeze({serviceKey,...body,summaryIds:Object.freeze(ids)});}
function normalizeRead(serviceKey){return Object.freeze({serviceKey:normalizeService(serviceKey)});}
module.exports={normalizeConsent,normalizeProposal,normalizeRead};
