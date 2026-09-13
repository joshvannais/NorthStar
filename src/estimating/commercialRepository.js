'use strict';
const contract=require('./commercialContract'),policy=require('./commercialWritePolicy');
const args=i=>[i.organizationId,i.actorUserId,i.actorAccessRole,i.authSessionId,i.estimateId];
function failure(e){if(e?.status)return e;const status=e?.code==='42501'?403:e?.code==='P0002'?404:['40001','40P01','23505'].includes(e?.code)?409:['22023','22P02','23514'].includes(e?.code)?400:e?.code==='54000'?429:503;return Object.assign(new Error(status===409?'The review changed. Refresh and review the commercial terms again.':status===400?'Review the amounts, tax treatment and confirmation.':status===403?'Your current account cannot change these terms.':status===404?'This estimate is unavailable. Reopen the customer and choose an available estimate.':status===429?'Commercial terms cannot accept this entry. Saved history remains available.':'Commercial terms are unavailable. Refresh to check saved history before retrying this same attempt.'),{status,code:'COMMERCIAL_UNAVAILABLE'});}
async function read(client,input){try{return (await client.query('SELECT public.canonical_commercial_read($1,$2,$3,$4,$5) result',args(input))).rows[0].result;}catch(e){throw failure(e);}}
async function sources(client,input){try{return (await client.query('SELECT public.canonical_commercial_sources($1,$2,$3,$4,$5,$6) result',[...args(input),input.selectedRevision||null])).rows[0].result;}catch(e){throw failure(e);}}
async function mutation(pool,input,raw,{approve=false,preview=false}={}){
 const client=await pool.connect();let locked=false,discard=false;
 try{
  await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
  if(!policy.mutationsEnabled){await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.csrfToken]);throw Object.assign(new Error('New commercial terms and approvals are paused. Refresh to check saved history.'),{status:503,code:'COMMERCIAL_PAUSED'});}
  const body=approve?contract.normalizeApproval(raw):contract.normalize(raw);
  if(preview){
   // The protected preview shares the exact mutation lock/authority entry without writing a receipt.
   // A rolled-back save exercises SQL authority and calculation; no draft is persisted.
   const result=(await client.query('SELECT public.canonical_commercial_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,'preview:'+require('node:crypto').randomUUID(),body])).rows[0].result;
   const source=await sources(client,input),now=new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now);const expected=contract.preview(body.inputs,body.currency,source,now);
   if(!contract.same(expected.result,result.receipt.result))throw new Error('Commercial calculation mismatch');
   await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.csrfToken]);await client.query('ROLLBACK');return expected;
  }
  const fn=approve?'canonical_commercial_approve':'canonical_commercial_mutate';
  const result=(await client.query(`SELECT public.${fn}($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result`,[...args(input),input.csrfToken,input.idempotencyKey,body])).rows[0].result;
  if(!result.replayed){const source=await sources(client,input);if(approve){const data=await read(client,input);if(!contract.currentState(data.current,source,result.receipt).linkedApproval)throw new Error('Commercial binding mismatch');}else if(body.action==='save'){const expected=contract.preview(body.inputs,body.currency,source,new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now));if(!contract.same(expected.result,result.receipt.result))throw new Error('Commercial calculation mismatch');}}
  await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.csrfToken]);await client.query('COMMIT');return {replayed:result.replayed,receipt:{id:result.receipt.id,revision:result.receipt.revision,digest:result.receipt.digest,action:approve?'approve':result.receipt.action}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
module.exports={read,sources,mutation,failure};
