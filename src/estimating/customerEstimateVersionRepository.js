'use strict';
const contract=require('./customerEstimateVersionContract'),policy=require('./customerEstimateVersionPolicy');
const args=i=>[i.organizationId,i.actorUserId,i.actorAccessRole,i.authSessionId,i.estimateId];
function failure(e){if(e&&e.status)return e;const status=e?.code==='42501'?403:e?.code==='P0002'?404:['40001','40P01','23505'].includes(e?.code)?409:['22023','22P02','23514'].includes(e?.code)?400:e?.code==='54000'?429:503;return Object.assign(new Error(status===409?'The estimate or approval changed. Refresh and review it again.':status===400?'Review and confirm this customer estimate before issuing it.':status===403?'Your current account cannot issue customer estimates.':status===404?'This estimate is unavailable.':status===429?'This estimate reached its issued-version limit.':'Issued estimates are unavailable. Refresh to check saved history before retrying this same attempt.'),{status,code:'CUSTOMER_ESTIMATE_VERSION_UNAVAILABLE',cause:e});}
async function read(client,input){try{return(await client.query('SELECT public.canonical_customer_estimate_version_read($1,$2,$3,$4,$5) result',args(input))).rows[0].result;}catch(e){throw failure(e);}}
async function issue(pool,input,raw,document,approvalPin){
 const client=await pool.connect();let locked=false,discard=false;
 try{await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,8)');locked=true;await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
  if(!policy.mutationsEnabled){await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[...args(input).slice(0,4),input.csrfToken]);throw Object.assign(new Error('New estimate issuance is paused. Saved issued estimates remain available.'),{status:503,code:'CUSTOMER_ESTIMATE_ISSUANCE_PAUSED'});}
  const body=contract.envelope(raw,document,approvalPin),result=(await client.query('SELECT public.canonical_customer_estimate_version_issue($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,body])).rows[0].result;
  await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.csrfToken]);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,8)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
module.exports={read,issue,failure};
