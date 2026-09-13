'use strict';
const p=require('./taxPreparation'),policy=require('./commercialWritePolicy'),{failure}=require('./commercialRepository');
const args=i=>[i.organizationId,i.actorUserId,i.actorAccessRole,i.authSessionId];
async function read(client,input,{acquisitionStatus}={}){try{
 const value=(await client.query('SELECT public.canonical_commercial_tax_read($1,$2,$3,$4) result',args(input))).rows[0].result;
 const research=(await client.query('SELECT public.canonical_tax_research_status($1,$2,$3) result',[input.organizationId,input.actorUserId,input.authSessionId])).rows[0].result;
 const status=typeof acquisitionStatus==='function'?acquisitionStatus(value.current?.inputs?.contexts||[]):{acquisitionEnabled:false,acquisitionState:'disconnected'};
 return {...value,research:{...research,...status,paused:!require('../polaris/connectedPolicy').researchEnabled}};
}catch(e){throw failure(e);}}
async function mutate(pool,input,raw){const client=await pool.connect();let locked=false,discard=false;try{
 await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
 await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
 if(!policy.mutationsEnabled||!policy.preparationEnabled){await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[...args(input),input.csrfToken]);throw Object.assign(new Error('New tax setup changes are paused. Refresh to check saved history.'),{status:503,code:'COMMERCIAL_PAUSED'});}
 const body=p.normalizeMutation(raw);const result=(await client.query('SELECT public.canonical_commercial_tax_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,body])).rows[0].result;
 await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[...args(input),input.csrfToken]);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}}
module.exports={read,mutate};
