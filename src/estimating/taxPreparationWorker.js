'use strict';
const preparation=require('./taxPreparation');
const policy=require('./commercialWritePolicy');
class TaxPreparationWorker{
 constructor({getPool,intervalMs=10000,batchSize=3}={}){
  if(typeof getPool!=='function')throw new TypeError('Tax preparation requires a database pool getter');
  this.getPool=getPool;this.intervalMs=Number.isInteger(intervalMs)&&intervalMs>=1000&&intervalMs<=60000?intervalMs:10000;
  this.batchSize=Number.isInteger(batchSize)&&batchSize>=1&&batchSize<=5?batchSize:3;this.running=false;this.stopped=true;this.timer=null;
 }
 async transaction(callback){const pool=this.getPool();if(!pool)return null;const client=await pool.connect();let discard=false;try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query("SET LOCAL statement_timeout='5000ms'");await client.query("SET LOCAL lock_timeout='1000ms'");await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");const value=await callback(client);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw e;}finally{client.release(discard);}}
 async tick(){
  if(this.running||!policy.preparationEnabled)return {processed:0,paused:!policy.preparationEnabled};this.running=true;let processed=0;
  try{
   await this.transaction(client=>client.query('SELECT public.canonical_commercial_tax_backfill($1)',[5]));
   for(let i=0;i<this.batchSize;i++){
    if(!policy.preparationEnabled)break;
    const job=await this.transaction(async client=>(await client.query('SELECT public.canonical_commercial_tax_claim() result')).rows[0].result);if(!job)break;
    // Pure local matching only. No transport, credentials, model or network adapter.
    let result;try{result={...preparation.evaluate(job.inputs,job.rules,job.asOfDate,{simulated:false}),inputDigest:job.inputDigest};}catch(_){result={};}
    if(!policy.preparationEnabled)break;
    await this.transaction(client=>client.query('SELECT public.canonical_commercial_tax_finish($1,$2,$3::jsonb)',[job.id,job.leaseToken,result]));processed++;
   }
   return {processed,paused:false};
  }finally{this.running=false;}
 }
 start(){if(!this.stopped)return;this.stopped=false;const next=async()=>{if(this.stopped)return;try{await this.tick();}catch(_){/* Durable lease/attempt bounds preserve retry; no private payload logging. */}if(!this.stopped){this.timer=setTimeout(next,this.intervalMs);this.timer.unref?.();}};this.timer=setTimeout(next,this.intervalMs);this.timer.unref?.();}
 stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=null;}
}
module.exports={TaxPreparationWorker};
