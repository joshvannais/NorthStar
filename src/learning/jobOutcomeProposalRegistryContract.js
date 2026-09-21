'use strict';

const DIGEST=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE=/^[a-z0-9][a-z0-9._-]{1,63}$/;
const PREVIEW_KEYS=['proposalId','expectedProposalDigest'];
const SAVE_KEYS=['proposalId','expectedProposalDigest','expectedPreviewDigest','expectedRegistryRevision','expectedRegistryDigest','reason','confirmed','confirmationVersion'];
function fail(message='Proposal registry details are invalid.'){throw Object.assign(new Error(message),{code:'M25_JOB_OUTCOME_REGISTRY_INPUT_INVALID',status:400});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');}
function text(value){return typeof value==='string'&&value===value.trim()&&value===value.normalize('NFC')&&value.length>=1&&value.length<=2000&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);}
function service(serviceKey){if(typeof serviceKey!=='string'||!SERVICE.test(serviceKey))fail();return serviceKey;}
function proposal(body){if(!exact(body,PREVIEW_KEYS)||!UUID.test(String(body.proposalId||''))||!DIGEST.test(String(body.expectedProposalDigest||'')))fail('Select a current proposal before reviewing its impact.');return Object.freeze({...body,proposalId:String(body.proposalId).toLowerCase()});}
function normalizePreview(serviceKey,body){return Object.freeze({serviceKey:service(serviceKey),...proposal(body)});}
function normalizeSave(serviceKey,body){if(!exact(body,SAVE_KEYS)||!UUID.test(String(body.proposalId||''))||!DIGEST.test(String(body.expectedProposalDigest||''))||!DIGEST.test(String(body.expectedPreviewDigest||''))||!Number.isInteger(body.expectedRegistryRevision)||body.expectedRegistryRevision<0||body.expectedRegistryRevision>10000||!(body.expectedRegistryDigest==='none'||DIGEST.test(String(body.expectedRegistryDigest||'')))||((body.expectedRegistryRevision===0)!==(body.expectedRegistryDigest==='none'))||!text(body.reason)||body.confirmed!==true||body.confirmationVersion!=='m25-job-outcome-proposal-registry-v1')fail();return Object.freeze({serviceKey:service(serviceKey),...body,proposalId:String(body.proposalId).toLowerCase()});}
function normalizeRead(serviceKey){return Object.freeze({serviceKey:service(serviceKey)});}
module.exports={normalizePreview,normalizeRead,normalizeSave};
