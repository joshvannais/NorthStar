'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='local-connected-fixture-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const repo=require('../../src/estimating/taxPreparationRepository');
const {TaxPreparationWorker}=require('../../src/estimating/taxPreparationWorker');
const {TaxResearchWorker}=require('../../src/estimating/taxResearchWorker');
const {createTaxSourceAcquisition}=require('../../src/estimating/taxSourceAcquisition');
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(output&&!fs.existsSync(output));const result={cases:[],pass:false};
(async()=>{let f;try{
 f=await createEstimateReviewFixture();const actor=f.actors.owner;
 const client=await f.runtimePool.connect();let read;try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');read=await repo.read(client,actor);await client.query('ROLLBACK');}finally{client.release();}
 const service=read.services[0].id;
 const body={expectedRevision:0,expectedDigest:'none',expectedProfileVersion:read.expectedProfileVersion,inputs:{contexts:[{id:'fixture-context',country:'US',region:'XX',locality:'',jurisdiction:'Fixture jurisdiction',serviceKey:service,classification:'fixture',registration:'registered',registrationReference:'PRIVATE-REGISTRATION-NOT-FOR-TRANSPORT',collectionBasis:'External review needed',exemptionReference:'',effectiveOn:null,endsOn:null,sourceNote:'Progressive fixture information',sourceReference:'Owner record',acknowledged:true}]},reason:'Record private test setup without fabricated tax coverage',confirmed:true,confirmationVersion:read.version};
 await repo.mutate(f.runtimePool,{...actor,idempotencyKey:crypto.randomUUID()},body);
 const preparation=new TaxPreparationWorker({getPool:()=>f.runtimePool,batchSize:5});await preparation.tick();
 const research=new TaxResearchWorker({getPool:()=>f.runtimePool});assert.equal((await research.tick()).adapterUnavailable,true);
 let jobs=(await f.ownerPool.query('SELECT * FROM canonical_tax_research_jobs WHERE organization_id=$1',[f.org])).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].attempts,0);assert.ok(!JSON.stringify(jobs[0].public_context).includes('PRIVATE'));
 await research.tick();assert.equal((await f.ownerPool.query('SELECT count(*)::int n FROM canonical_tax_research_jobs WHERE organization_id=$1',[f.org])).rows[0].n,1);
 result.cases.push('actual owner setup/preparation -> older unsupported backfill, dedupe and missing-adapter pending state without consuming attempts');
 const claim=async()=>(await f.runtimePool.query('SELECT public.canonical_tax_research_claim() result')).rows[0].result;
 const job=await claim();assert.ok(job);
 const acquired=await createTaxSourceAcquisition({allowedOrigins:new Set(['https://official.example']),transport:{acquire:async()=>[{url:'https://official.example/source',content:'Synthetic current source only',effectiveOn:null,endsOn:null,coverage:'Fixture',exclusions:'No verified coverage'}]}})(job.context);
 const holder=await f.ownerPool.connect();try{
 await holder.query('BEGIN');await holder.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[f.org]);
 // Local fixture shortens the ordinary 60-second lease solely to exercise a real wait across expiry.
 await f.ownerPool.query("UPDATE canonical_tax_research_jobs SET lease_until=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",[job.id]);
 const finishing=f.runtimePool.query('SELECT public.canonical_tax_research_finish($1,$2,$3) result',[job.id,job.leaseToken,acquired]);
 await holder.query('SELECT pg_sleep(0.35)');await holder.query('COMMIT');
 const finished=(await finishing).rows[0].result;assert.equal(finished.disposition,'expired');result.expired=finished;
 }finally{await holder.query('ROLLBACK');holder.release();}
 const second=await claim();assert.equal(second.id,job.id);assert.notEqual(second.leaseToken,job.leaseToken);
 await assert.rejects(f.runtimePool.query('SELECT public.canonical_tax_research_finish($1,$2,$3)',[job.id,job.leaseToken,acquired]),e=>e.code==='40001');
 const valid=(await f.runtimePool.query('SELECT public.canonical_tax_research_finish($1,$2,$3) result',[second.id,second.leaseToken,acquired])).rows[0].result;assert.equal(valid.disposition,'candidate');
 const history=(await f.ownerPool.query('SELECT attempt,disposition FROM canonical_tax_research_candidates WHERE job_id=$1 ORDER BY attempt',[job.id])).rows;assert.deepEqual(history,[{attempt:1,disposition:'expired'},{attempt:2,disposition:'candidate'}]);result.history=history;
 assert.equal((await f.ownerPool.query('SELECT count(*)::int n FROM canonical_tax_rule_versions')).rows[0].n,0);
 result.cases.push('actual organization lock wait crosses shortened fixture lease; post-wait expiry retained, old lease cannot finish after new claim, next current lease records candidate without tax validation');
 result.pass=true;
}catch(e){result.error={message:e.message,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})();
