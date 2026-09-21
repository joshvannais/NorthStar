'use strict';

const DIGEST=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE=/^[a-z0-9][a-z0-9._-]{1,63}$/;
const METRIC=/^[a-z][a-z0-9_]{1,63}$/;
const BASIS=/^[A-Za-z0-9._:/| -]{1,200}$/;
const AREAS=new Set(['labor_planning','travel_planning','equipment_planning','material_planning']);
const SELECTION_KEYS=['registryVersionId','expectedRegistryDigest','expectedPreviewDigest','planningArea','metricKey','basis'];
const ADOPT_KEYS=[...SELECTION_KEYS,'expectedSelectionDigest','expectedPlanningRevision','expectedPlanningDigest','reason','confirmed','confirmationVersion'];
const ROLLBACK_KEYS=['planningArea','metricKey','basis','expectedPlanningRevision','expectedPlanningDigest','rollbackToId','expectedRollbackToDigest','reason','confirmed','confirmationVersion'];
function fail(message='Planning value details are invalid.'){throw Object.assign(new Error(message),{code:'M25_JOB_OUTCOME_PLANNING_INPUT_INVALID',status:400});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');}
function text(value){return typeof value==='string'&&value===value.trim()&&value===value.normalize('NFC')&&value.length>=1&&value.length<=2000&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);}
function identity(serviceKey,body,keys){if(typeof serviceKey!=='string'||!SERVICE.test(serviceKey)||!exact(body,keys)||!AREAS.has(body.planningArea)||!METRIC.test(String(body.metricKey||''))||!BASIS.test(String(body.basis||'')))fail();return{serviceKey,planningArea:body.planningArea,metricKey:body.metricKey,basis:body.basis};}
function selection(serviceKey,body){const base=identity(serviceKey,body,SELECTION_KEYS);if(!UUID.test(String(body.registryVersionId||''))||!DIGEST.test(String(body.expectedRegistryDigest||''))||!DIGEST.test(String(body.expectedPreviewDigest||'')))fail('Select a current saved proposal preview before reviewing this planning value.');return Object.freeze({...base,registryVersionId:String(body.registryVersionId).toLowerCase(),expectedRegistryDigest:body.expectedRegistryDigest,expectedPreviewDigest:body.expectedPreviewDigest});}
function normalizePreview(serviceKey,body){return selection(serviceKey,body);}
function normalizeAdopt(serviceKey,body){const base=identity(serviceKey,body,ADOPT_KEYS);if(!UUID.test(String(body.registryVersionId||''))||!DIGEST.test(String(body.expectedRegistryDigest||''))||!DIGEST.test(String(body.expectedPreviewDigest||''))||!DIGEST.test(String(body.expectedSelectionDigest||''))||!Number.isInteger(body.expectedPlanningRevision)||body.expectedPlanningRevision<0||body.expectedPlanningRevision>10000||!(body.expectedPlanningDigest==='none'||DIGEST.test(String(body.expectedPlanningDigest||'')))||((body.expectedPlanningRevision===0)!==(body.expectedPlanningDigest==='none'))||!text(body.reason)||body.confirmed!==true||body.confirmationVersion!=='m25-job-outcome-planning-adoption-v1')fail();return Object.freeze({...base,...body,registryVersionId:String(body.registryVersionId).toLowerCase()});}
function normalizeRollback(serviceKey,body){const base=identity(serviceKey,body,ROLLBACK_KEYS);if(!Number.isInteger(body.expectedPlanningRevision)||body.expectedPlanningRevision<1||body.expectedPlanningRevision>10000||!DIGEST.test(String(body.expectedPlanningDigest||''))||!(body.rollbackToId===null||UUID.test(String(body.rollbackToId||'')))||!(body.expectedRollbackToDigest==='none'||DIGEST.test(String(body.expectedRollbackToDigest||'')))||((body.rollbackToId===null)!==(body.expectedRollbackToDigest==='none'))||!text(body.reason)||body.confirmed!==true||body.confirmationVersion!=='m25-job-outcome-planning-adoption-v1')fail();return Object.freeze({...base,...body,rollbackToId:body.rollbackToId===null?null:String(body.rollbackToId).toLowerCase()});}
function normalizeRead(serviceKey){if(typeof serviceKey!=='string'||!SERVICE.test(serviceKey))fail();return Object.freeze({serviceKey});}
module.exports={normalizeAdopt,normalizePreview,normalizeRead,normalizeRollback};
