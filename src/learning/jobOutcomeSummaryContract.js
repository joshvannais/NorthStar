'use strict';

const DIGEST=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS=['expectedEvaluationRevision','expectedEvaluationDigest','reason','confirmed','confirmationVersion'];
function fail(){throw Object.assign(new Error('Job outcome summary details are invalid.'),{code:'M25_JOB_OUTCOME_SUMMARY_INPUT_INVALID',status:400});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');}
function text(value){return typeof value==='string'&&value===value.trim()&&value===value.normalize('NFC')&&value.length>=1&&value.length<=2000&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);}
function normalizeRead(estimateId){if(!UUID.test(String(estimateId||'')))fail();return Object.freeze({estimateId:String(estimateId).toLowerCase()});}
function normalizeSummary(estimateId,body){
 if(!UUID.test(String(estimateId||''))||!exact(body,KEYS)||!Number.isInteger(body.expectedEvaluationRevision)||body.expectedEvaluationRevision<1||body.expectedEvaluationRevision>10000||!DIGEST.test(String(body.expectedEvaluationDigest||''))||!text(body.reason)||body.confirmed!==true||body.confirmationVersion!=='m25-job-outcome-summary-v1')fail();
 return Object.freeze({estimateId:String(estimateId).toLowerCase(),...body});
}
module.exports={normalizeRead,normalizeSummary};
