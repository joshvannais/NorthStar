'use strict';

const DIGEST=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMAINS=Object.freeze(['labor','travel','equipment','materials','customer','scope','financial']);
const KEYS=['expectedGraphRevision','expectedGraphDigest','requiredDomains','reason','confirmed','confirmationVersion'];
function fail(){throw Object.assign(new Error('Job outcome evidence review details are invalid.'),{code:'M25_JOB_OUTCOME_EVALUATION_INPUT_INVALID',status:400});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');}
function text(value){return typeof value==='string'&&value===value.trim()&&value===value.normalize('NFC')&&value.length>=1&&value.length<=2000&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);}
function normalizeRead(estimateId){if(!UUID.test(String(estimateId||'')))fail();return Object.freeze({estimateId:String(estimateId).toLowerCase()});}
function normalizeEvaluation(estimateId,body){
 if(!UUID.test(String(estimateId||''))||!exact(body,KEYS)||!Number.isInteger(body.expectedGraphRevision)||body.expectedGraphRevision<1||body.expectedGraphRevision>10000||!DIGEST.test(String(body.expectedGraphDigest||''))||!Array.isArray(body.requiredDomains)||body.requiredDomains.length<1||body.requiredDomains.length>7||body.requiredDomains.some(value=>!DOMAINS.includes(value))||new Set(body.requiredDomains).size!==body.requiredDomains.length||!text(body.reason)||body.confirmed!==true||body.confirmationVersion!=='m25-job-outcome-graph-evaluation-v1')fail();
 return Object.freeze({estimateId:String(estimateId).toLowerCase(),...body,requiredDomains:Object.freeze([...body.requiredDomains].sort())});
}
module.exports={DOMAINS,normalizeEvaluation,normalizeRead};
