'use strict';
const contract=require('./equipmentCostPlanContract');
const policy=require('./equipmentCostPlanPolicy');
function failure(error){if(error?.status)return error;const status=error?.code==='42501'?403:error?.code==='P0002'?404:['40001','40P01','23505'].includes(error?.code)?409:['22023','22P02','23514'].includes(error?.code)?400:error?.code==='54000'?429:503;return Object.assign(new Error(status===409?'The estimate or equipment sources changed. Refresh and review the costs again.':status===400?'Review the equipment costs and confirmation.':status===403?'Your current account cannot review these costs.':status===404?'This estimate is unavailable. Reopen the customer and choose an available estimate.':status===429?'Equipment cost history cannot accept another entry right now. Saved history remains available.':'Equipment cost planning is unavailable. Refresh to check saved history.'),{status,code:'EQUIPMENT_COST_UNAVAILABLE'});}
const args=i=>[i.organizationId,i.actorUserId,i.actorAccessRole,i.authSessionId,i.estimateId];
async function readPlans(client,input){try{return(await client.query('SELECT public.canonical_equipment_cost_read($1,$2,$3,$4,$5) result',args(input))).rows[0].result;}catch(e){throw failure(e);}}
async function mutatePlan(pool,input,raw,verify){
 if(!policy.mutationsEnabled)throw Object.assign(new Error('New equipment costs are paused. Refresh to check saved history.'),{status:503,code:'EQUIPMENT_COST_PAUSED'});
 const body=contract.normalize(raw),client=await pool.connect();let locked=false,discard=false;
 try{
  await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
  const result=(await client.query('SELECT public.canonical_equipment_cost_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,body])).rows[0].result;
  if(!result.replayed&&body.action==='save')await verify(client,body,result.receipt,new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now));
  await client.query('COMMIT');const {evidence,...receipt}=result.receipt;return{...result,receipt};
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
module.exports={readPlans,mutatePlan,failure};
