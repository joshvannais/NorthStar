'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const {buildKnowledgeProjection}=require('../knowledge/projection');
const contract=require('./equipmentPlanContract');
const policy=require('./equipmentPlanPolicy');
function request(input){return {organizationId:input.organizationId,actorUserId:input.actorUserId,consumer:'northstar_assistant',audience:'internal',capabilities:['operational_capabilities','services','availability'],maximumEntries:32};}
function presentSources(raw,input){
 const projection=buildKnowledgeProjection(request(input),raw.knowledgeRows||[]).projection;
 const knowledge=Array.from(new Map(projection.items.filter(i=>i.state==='published').map(i=>{const entry={...projection.sources[i.sourceIndex],label:i.label||'Company Reference',content:i.content};return [entry.publicationId,entry];})).values());
 return stableValue({assets:raw.assets||[],references:raw.references||[],knowledge,scope:raw.scope||{},serviceKey:raw.serviceKey,truncated:raw.truncated===true||projection.truncated,authorityDigest:raw.digest});
}
function failure(error){if(error?.status)return error;const status=error?.code==='42501'?403:error?.code==='P0002'?404:['40001','40P01','23505'].includes(error?.code)?409:['22023','22P02','23514'].includes(error?.code)?400:error?.code==='54000'?429:503;return Object.assign(new Error(status===409?'The equipment sources or estimate changed. Refresh and review again.':status===400?'Check the equipment entries and confirmation.':status===403?'Your current account cannot review this equipment.':status===404?'This estimate is unavailable. Reopen the customer and choose an available estimate.':'Equipment planning is unavailable. Refresh to check saved history.'),{status,code:'EQUIPMENT_PLAN_UNAVAILABLE'});}
function args(input){return [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.estimateId];}
async function readSources(client,input,inputs=null){try{return(await client.query('SELECT public.canonical_equipment_plan_sources($1,$2,$3,$4,$5,$6::jsonb) result',[...args(input),inputs])).rows[0].result;}catch(e){throw failure(e);}}
async function readPlans(client,input){try{return(await client.query('SELECT public.canonical_equipment_plan_read($1,$2,$3,$4,$5) result',args(input))).rows[0].result;}catch(e){throw failure(e);}}
// Equipment's released actor helper locks authority rows even for a read.
// Acquire its existing supporting-source fence before the snapshot is established.
async function withReadSnapshot(pool,operation){
 const client=await pool.connect();let locked=false,discard=false;
 try{await client.query("SET statement_timeout='15000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
  const result=await operation(client);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw e;}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
async function mutatePlan(pool,input,raw){
 if(!policy.mutationsEnabled)throw Object.assign(new Error('New equipment plans are paused. Refresh to check saved history.'),{status:503,code:'EQUIPMENT_PLAN_PAUSED'});
 const body=contract.normalize(raw),client=await pool.connect();let locked=false,discard=false;
 try{
  await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
  const result=(await client.query('SELECT public.canonical_equipment_plan_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,body])).rows[0].result;
  // SQL resolves and stores actual evidence. Shared evaluator validates before commit;
  // a rejected comparison rolls back the complete immutable receipt.
  if(!result.replayed&&body.action==='save'){
   const evidence=await readSources(client,input,body.inputs);
   contract.requireReview(body.inputs,presentSources(evidence,input),new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now));
   if(evidence.digest!==result.receipt.evidence.digest)throw Object.assign(new Error('Equipment sources changed. Preview again.'),{status:409});
  }
  await client.query('COMMIT');
  const {evidence,...receipt}=result.receipt;return {...result,receipt};
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
async function project(client,data,review,rawSources,input,simulated,now=new Date(),sourceReader=null){
 const currentSources=presentSources(rawSources,input),currentPrivate=new Set(currentSources.knowledge.map(k=>k.publicationId));
 async function expose(e){if(!e)return null;const {evidence,requestKey,requestDigest,...entry}=e;let result=null,currentEvidence=null; if(e.action==='save'){try{currentEvidence=sourceReader?await sourceReader(e.inputs):await readSources(client,input,e.inputs);}catch(error){if(error.status!==409)throw error;}}
  if(e.action==='save'&&evidence){const safe={...evidence,knowledgeRows:(evidence.knowledgeRows||[]).filter(k=>currentPrivate.has(k.publication_id))};result=contract.evaluate(e.inputs,presentSources(safe,input),new Date(e.createdAt));}
  return {...entry,result,sourceBasisCurrent:sha256(e.sourcePins)===sha256(review.pins),currentSourcesChanged:!!evidence&&evidence.digest!==currentEvidence?.digest};
 }
 return stableValue({contract:contract.VERSION,simulated,canMutate:review.isCurrent&&policy.mutationsEnabled,mutationsPaused:!policy.mutationsEnabled,sourcePins:review.pins,decisionBasis:contract.basis(review),sources:currentSources,current:await expose(data.current),history:await Promise.all((data.history||[]).map(expose)),total:data.total||0,truncated:data.truncated===true});
}
module.exports={withReadSnapshot,request,presentSources,failure,readSources,readPlans,mutatePlan,project};
