'use strict';
const {normalize}=require('./laborPlanContract');
const policy=require('./laborPlanPolicy');
function failure(error){if(error?.status)return error;const status=error?.code==='42501'?403:error?.code==='P0002'?404:['40001','40P01','23505'].includes(error?.code)?409:['22023','22P02'].includes(error?.code)?400:error?.code==='54000'?429:503;return Object.assign(new Error(status===409?'The review changed. Refresh and review your entries before saving.':status===400?'Review the labor inputs and confirmation before saving.':status===403?'Your current account cannot save this review.':'Labor plans are unavailable. Try again.'),{status,code:'LABOR_PLAN_UNAVAILABLE'});}
async function readPlans(client,input){const args=[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.estimateId];try{return(await client.query('SELECT public.canonical_labor_plan_read($1,$2,$3,$4,$5) result',args)).rows[0].result;}catch(error){throw failure(error);}}
async function mutatePlan(pool,input,raw){
 if(!policy.mutationsEnabled)throw Object.assign(new Error('New labor plans are paused. Saved plans remain available.'),{status:503,code:'LABOR_PLAN_PAUSED'});
 const body=normalize(raw),client=await pool.connect(); let discard=false;
 try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL statement_timeout='10000ms'");await client.query("SET LOCAL lock_timeout='2000ms'");await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
 const args=[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.estimateId,input.csrfToken,input.idempotencyKey,body];
 const result=(await client.query('SELECT public.canonical_labor_plan_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',args)).rows[0].result;await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(error);}finally{client.release(discard);}
}
module.exports={readPlans,mutatePlan};
