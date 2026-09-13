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
 const orgs=[];
 // Seed older unsupported setups, including deliberately incomplete profile data.
 // Enqueue/evaluate/discovery still use the real granted routines and worker.
 for(let i=0;i<8;i++){
  const org=crypto.randomUUID();orgs.push(org);
  await f.ownerPool.query('INSERT INTO organizations(id,name,email) VALUES($1,$2,$3)',[org,'Backfill Fixture '+i,'backfill-'+i+'@example.test']);
  await f.ownerPool.query(`INSERT INTO canonical_tax_profiles(organization_id,revision,inputs,body,actor_user_id,request_key_hash,request_digest,digest) VALUES($1,1,$2,$3,$4,$5,$5,$5)`,[org,body.inputs,body,actor.actorUserId,crypto.createHash('sha256').update(org).digest('hex')]);
  await f.ownerPool.query('SELECT public.canonical_commercial_tax_enqueue($1)',[org]);
 }
 for(let i=0;i<4;i++)await preparation.tick();
 const full=orgs[0],prep=(await f.ownerPool.query('SELECT * FROM canonical_tax_preparation_jobs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1',[full])).rows[0];
 await f.ownerPool.query(`INSERT INTO canonical_tax_research_jobs(organization_id,preparation_job_id,input_digest,rules_digest,public_context_digest,public_context,as_of_date,state,attempts) SELECT $1,$2,$3,$4,public.canonical_completion_digest(jsonb_build_object('fixture',n)),jsonb_build_object('fixture',n),$5,'exhausted',3 FROM generate_series(1,1000) n`,[full,prep.id,prep.input_digest,prep.rules_digest,prep.as_of_date]);
 const firstBatches=await Promise.all([f.runtimePool.query('SELECT public.canonical_tax_research_enqueue(NULL) n'),f.runtimePool.query('SELECT public.canonical_tax_research_enqueue(NULL) n')]);const admitted=firstBatches.map(r=>r.rows[0].n);result.concurrentFirstBatches=admitted;assert.ok(admitted.every(n=>n>=0&&n<=5));assert.ok(admitted.reduce((a,b)=>a+b,0)>=5);
 const second=(await f.runtimePool.query('SELECT public.canonical_tax_research_enqueue(NULL) n')).rows[0].n;assert.equal(admitted.reduce((a,b)=>a+b,0)+second,8);
 assert.equal((await f.runtimePool.query('SELECT public.canonical_tax_research_enqueue(NULL) n')).rows[0].n,0);
 const counts=(await f.ownerPool.query('SELECT organization_id,count(*)::int n FROM canonical_tax_research_jobs GROUP BY organization_id')).rows;result.counts=counts;assert.equal(counts.find(x=>x.organization_id===full).n,1000);for(const org of orgs.slice(1))assert.equal(counts.find(x=>x.organization_id===org).n,1);
 result.cases.push('runtime NULL discovery admits maximum five organizations; second batch advances beyond first five; exhausted full tenant skipped without starvation');
 const repeated=await Promise.all([f.runtimePool.query('SELECT public.canonical_tax_research_enqueue(NULL) n'),f.runtimePool.query('SELECT public.canonical_tax_research_enqueue(NULL) n')]);assert.deepEqual(repeated.map(r=>r.rows[0].n),[0,0]);
 assert.equal((await f.ownerPool.query('SELECT count(*)::int n FROM canonical_tax_research_jobs')).rows[0].n,1008);
 result.cases.push('repeated and concurrent runtime backfill preserves all immutable identities and bounded counts');
 result.pass=true;
}catch(e){result.error={message:e.message,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})();
