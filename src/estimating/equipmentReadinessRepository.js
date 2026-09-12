'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const contract=require('./equipmentReadinessContract');
const policy=require('./equipmentReadinessPolicy');
const {withReadSnapshot}=require('./equipmentPlanRepository');
const args=i=>[i.organizationId,i.actorUserId,i.actorAccessRole,i.authSessionId,i.estimateId];
function failure(error){
 if(error?.status)return error;
 const status=error?.code==='42501'?403:error?.code==='P0002'?404:['40001','40P01','23505'].includes(error?.code)?409:['22023','22P02','23514','22007','22008'].includes(error?.code)?400:error?.code==='54000'?429:503;
 return Object.assign(new Error(status===409?'The equipment or estimate changed. Refresh and review again.':status===400?'Review the equipment quantities, dates and confirmation.':status===403?'Your current account cannot review this equipment.':status===404?'This estimate is unavailable. Reopen the customer and choose an available estimate.':status===429?'Equipment readiness history cannot accept another entry right now. Saved history remains available.':'Equipment readiness is unavailable. Refresh to check saved history.'),{status,code:'EQUIPMENT_READINESS_UNAVAILABLE'});
}
async function readSources(client,input,inputs=null){try{return(await client.query('SELECT public.canonical_equipment_readiness_sources($1,$2,$3,$4,$5,$6::jsonb) result',[...args(input),inputs])).rows[0].result;}catch(e){throw failure(e);}}
async function readPlans(client,input){try{return(await client.query('SELECT public.canonical_equipment_readiness_read($1,$2,$3,$4,$5) result',args(input))).rows[0].result;}catch(e){throw failure(e);}}
async function mutatePlan(pool,input,raw){
 if(!policy.mutationsEnabled)throw Object.assign(new Error('New equipment readiness entries are paused. Refresh to check saved history.'),{status:503,code:'EQUIPMENT_READINESS_PAUSED'});
 const body=contract.normalize(raw),client=await pool.connect();let locked=false,discard=false;
 try{
  await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
  const result=(await client.query('SELECT public.canonical_equipment_readiness_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,body])).rows[0].result;
  if(!result.replayed&&body.action==='save'){
   const evidence=await readSources(client,input,body.inputs),now=new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now);
   contract.requireReview(body.inputs,evidence,now);
   if(evidence.digest!==result.receipt.evidence.digest)throw Object.assign(new Error('Equipment evidence changed. Refresh and review again.'),{status:409});
  }
  await client.query('COMMIT');const {evidence,...receipt}=result.receipt;return {...result,receipt};
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
// Historical receipts retain their assessment, while operational details always come
// from the current authorized read. Private equipment configurations never leave here.
function presentEvidence(raw){
 const fact=f=>({lineId:f.lineId,alternativeId:f.alternativeId||null,assetId:f.assetId,complete:f.complete,sourceCurrent:f.sourceCurrent,requirementStatus:f.requirementStatus,recordedAt:f.recordedAt,observedAt:f.observedAt,basisDiverged:f.basisDiverged,observations:f.observations||[],declaredCheckout:f.declaredCheckout?{currentJob:f.declaredCheckout.currentJob,executionKnown:f.declaredCheckout.executionKnown}:null,operational:{downtime:f.state?.downtime===true,recordedFault:f.state?.recordedFault===true,checkedOut:!!f.state?.checkedOutExecution,currentJob:f.currentJob===true,meterReset:f.meterReset===true}});
 return stableValue({equipmentBasis:raw.equipmentBasis,lines:(raw.lines||[]).map(fact),alternatives:(raw.alternatives||[]).map(fact),digest:raw.digest});
}
async function project(client,data,review,input,simulated,now=new Date(),sourceReader=null){
 const sources=sourceReader?await sourceReader(null):await readSources(client,input);
 async function expose(entry){if(!entry)return null;const {evidence,requestKey,requestDigest,...e}=entry;let result=null,changed=false;
  if(e.action==='save'){
   if(sha256(e.inputs.equipmentBasis)!==sha256(sources.equipmentBasis))changed=true;
   else try{const current=sourceReader?await sourceReader(e.inputs):await readSources(client,input,e.inputs);result=contract.evaluate(e.inputs,current,now);changed=current.digest!==evidence?.digest;}
   catch(error){if(error.status!==409)throw error;changed=true;}
  }
  return {...e,recordedAssessment:e.inputs?.assessment||null,result,currentSourcesChanged:changed,sourceBasisCurrent:sha256(e.sourcePins)===sha256(review.pins)};
 }
 return stableValue({contract:contract.VERSION,simulated,canMutate:review.isCurrent&&policy.mutationsEnabled,mutationsPaused:!policy.mutationsEnabled,sourcePins:review.pins,decisionBasis:review.decisions.writeBasis,sources:presentEvidence(sources),current:await expose(data.current),history:await Promise.all((data.history||[]).map(expose)),total:data.total||0,truncated:data.truncated===true});
}
module.exports={failure,readSources,readPlans,mutatePlan,project,presentEvidence,withReadSnapshot};
