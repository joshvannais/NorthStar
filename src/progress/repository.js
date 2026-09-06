'use strict';

function mapped(cause) {
  if(cause && cause.status) return cause;
  const status = cause && ['40001','40P01','23505'].includes(cause.code) ? 409 :
    cause && cause.code === '42501' ? 403 : cause && ['22023','22P02','22007','22008'].includes(cause.code) ? 400 :
    cause && cause.code === '54000' ? 429 : 503;
  const error=new Error(status===409?'Operational facts changed; refresh before retrying.':'Operational evidence is unavailable.');
  Object.assign(error,{status,statusCode:status,code:status===409?'PROGRESS_CONFLICT':status===403?'PROGRESS_FORBIDDEN':status===400?'INVALID_PROGRESS_REQUEST':'PROGRESS_UNAVAILABLE',cause});return error;
}
async function transaction(pool, write, operation, identity) {
  if(!pool || typeof pool.connect!=='function')throw mapped();
  for(let attempt=0;attempt<3;attempt+=1){
    const client=await pool.connect();let locked=false,workLocked=false,discard=false;
    try{
      await client.query("SET statement_timeout='5000ms'");await client.query("SET lock_timeout='2000ms'");
      await client.query("SET idle_in_transaction_session_timeout='5000ms'");
      // Acquire before snapshot. The database independently checks the released MVCC fence.
      await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
      await client.query(write?'SELECT pg_advisory_lock(230007,hashtext($1))':'SELECT pg_advisory_lock_shared(230007,hashtext($1))',[identity]);workLocked=true;
      await client.query(write?'BEGIN ISOLATION LEVEL SERIALIZABLE':'BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const value=(await operation(client)).rows[0]?.result;
      if(!value || Buffer.byteLength(JSON.stringify(value),'utf8')>3000000)throw mapped();
      await client.query('COMMIT');return value;
    }catch(cause){
      await client.query('ROLLBACK').catch(()=>{discard=true;});
      if(write && ['40001','40P01'].includes(cause.code) && !/stale|changed/.test(cause.constraint||'') && attempt<2)continue;
      throw mapped(cause);
    }finally{
      if(workLocked)await client.query(write?'SELECT pg_advisory_unlock(230007,hashtext($1))':'SELECT pg_advisory_unlock_shared(230007,hashtext($1))',[identity]).catch(()=>{discard=true;});
      if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});
      await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);
    }
  }
}
async function mutateProgress(pool,input){
  return transaction(pool,true,client=>client.query('SELECT public.canonical_progress_mutate($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::bigint,$13::text,$14::bigint,$15::text,$16::jsonb,$17::text,$18::text,$19::text) AS result',
    [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.csrfToken,input.executionId,input.action,input.performerProfileId,
      input.recordId,input.expectedRecordRevision,input.expectedRecordDigest,input.expectedExecutionRevision,input.expectedExecutionDigest,
      input.expectedAssignmentRevision,input.expectedAssignmentDigest,input.document,input.idempotencyKey,input.reason,input.requestCorrelationId]),input.organizationId+':'+input.executionId);
}
async function readProgress(pool,input){
  if(input.cursor && input.cursor.executionId!==input.executionId)throw mapped({code:'22023'});
  return transaction(pool,false,client=>client.query('SELECT public.canonical_progress_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::timestamptz,$8::timestamptz,$9::uuid) AS result',
    [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.executionId,input.limit,input.cursor?.cutoff,input.cursor?.lastTime,input.cursor?.lastId]),input.organizationId+':'+input.executionId);
}
module.exports={mutateProgress,readProgress};
