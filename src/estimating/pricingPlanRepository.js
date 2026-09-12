'use strict';
const contract=require('./pricingPlanContract');
const policy=require('./pricingPlanPolicy');
function failure(error){if(error?.status)return error;const status=error?.code==='42501'?403:error?.code==='P0002'?404:['40001','40P01','23505'].includes(error?.code)?409:['22023','22P02','23514'].includes(error?.code)?400:error?.code==='54000'?429:503;return Object.assign(new Error(status===409?'The estimate or pricing sources changed. Refresh and review the pricing plan again.':status===400?'Review the pricing entries and confirmation.':status===403?'Your current account cannot review this pricing plan.':status===404?'This estimate is unavailable. Reopen the customer and choose an available estimate.':status===429?'Pricing cannot accept this entry. Saved history remains available.':'Pricing plans are unavailable. Refresh to check saved history.'),{status,code:'PRICING_PLAN_UNAVAILABLE'});}
const args=i=>[i.organizationId,i.actorUserId,i.actorAccessRole,i.authSessionId,i.estimateId];
async function readPlans(client,input){try{return(await client.query('SELECT public.canonical_pricing_plan_read($1,$2,$3,$4,$5) result',args(input))).rows[0].result;}catch(e){throw failure(e);}}
async function mutatePlan(pool,input,raw,verify){
 if(!policy.mutationsEnabled){const client=await pool.connect();let discard=false;try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query("SET LOCAL statement_timeout='10000ms'");await client.query("SET LOCAL lock_timeout='2000ms'");await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.csrfToken]);throw Object.assign(new Error('New pricing plans are paused. Refresh to check saved history.'),{status:503,code:'PRICING_PLAN_PAUSED'});}catch(e){throw failure(e);}finally{await client.query('ROLLBACK').catch(()=>{discard=true;});client.release(discard);}}
 const body=contract.normalize(raw),client=await pool.connect();let locked=false,discard=false;
 try{
  await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
  const result=(await client.query('SELECT public.canonical_pricing_plan_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,body])).rows[0].result;
  if(!result.replayed&&body.action==='save')await verify(client,body,result.receipt,new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now));
  await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.csrfToken]);await client.query('COMMIT');const {id,revision,digest,action}=result.receipt;return{replayed:result.replayed,receipt:{id,revision,digest,action}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
async function readSources(client,input){try{return(await client.query('SELECT public.canonical_pricing_sources($1,$2,$3,$4,$5,$6) result',[...args(input),input.selectedRevision||null])).rows[0].result;}catch(e){throw failure(e);}}
function presentSources(raw,input){return require('./pricingSourceBasis').present(raw,input);}
module.exports={readPlans,readSources,presentSources,mutatePlan,failure};
