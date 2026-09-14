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
 const body={expectedRevision:0,expectedDigest:'none',expectedProfileVersion:read.expectedProfileVersion,inputs:{version:'tax-preparation-v2',contexts:[{id:'fixture-context',country:'US',region:'XX',locality:'',jurisdiction:'Fixture jurisdiction',serviceKey:service,classification:'fixture',registration:'registered',registrationReference:'PRIVATE-REGISTRATION-NOT-FOR-TRANSPORT',collectionBasis:'External review needed',exemptionReference:'',effectiveOn:null,endsOn:null,sourceNote:'Progressive fixture information',sourceReference:'Owner record',acknowledged:true}]},reason:'Record private test setup without fabricated tax coverage',confirmed:true,confirmationVersion:read.version};
 await repo.mutate(f.runtimePool,{...actor,idempotencyKey:crypto.randomUUID()},body);
 const preparation=new TaxPreparationWorker({getPool:()=>f.runtimePool,batchSize:5});await preparation.tick();
 const research=new TaxResearchWorker({getPool:()=>f.runtimePool});assert.equal((await research.tick()).adapterUnavailable,true);
 let jobs=(await f.ownerPool.query('SELECT * FROM canonical_tax_research_jobs WHERE organization_id=$1',[f.org])).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].attempts,0);assert.ok(!JSON.stringify(jobs[0].public_context).includes('PRIVATE'));
 await research.tick();assert.equal((await f.ownerPool.query('SELECT count(*)::int n FROM canonical_tax_research_jobs WHERE organization_id=$1',[f.org])).rows[0].n,1);
 result.cases.push('actual owner setup/preparation -> older unsupported backfill, dedupe and missing-adapter pending state without consuming attempts');
 let acquired;
 research.acquire=createTaxSourceAcquisition({allowedOrigins:new Set(['https://official.example']),transport:{acquire:async context=>{acquired=context;return [{url:'https://official.example/fixture',content:'Synthetic source requires independent review.',effectiveOn:'2020-01-01',endsOn:null,coverage:'Fixture only',exclusions:'No validated tax treatment'}];}}});
 assert.equal((await research.tick()).processed,1);assert.ok(!JSON.stringify(acquired).includes('PRIVATE'));
 const candidates=(await f.ownerPool.query('SELECT * FROM canonical_tax_research_candidates WHERE organization_id=$1',[f.org])).rows;assert.equal(candidates.length,1);assert.equal(candidates[0].disposition,'candidate');assert.equal((await f.ownerPool.query('SELECT count(*)::int n FROM canonical_tax_rule_versions')).rows[0].n,0);
 await assert.rejects(f.runtimePool.query('INSERT INTO canonical_tax_rule_versions DEFAULT VALUES'),e=>e.code==='42501');
 await assert.rejects(f.ownerPool.query('DELETE FROM canonical_tax_research_candidates'),e=>e.code==='23514');
 result.cases.push('candidate source/date/hash saved immutably; private context excluded; runtime cannot publish validated rules');
 const publication=require('../../src/estimating/taxCoveragePublication'),{stableStringify}=require('../../src/services/businessProfileAdapter'),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
 const persisted=(await f.ownerPool.query('SELECT content::text "contentText",digest FROM canonical_tax_research_candidates WHERE id=$1',[candidates[0].id])).rows[0],source=JSON.parse(persisted.contentText).candidates[0];
 const rule={...source.context,version:'tax-preparation-v2',validation:'validated',simulated:false,active:true,treatment:'zero_rate',behavior:'exclusive',ratePercent:'0',legalEffectiveOn:'2020-01-01',legalEndsOn:null,reviewedOn:new Date().toISOString().slice(0,10),reviewValidThrough:'2099-12-31',applicability:{serviceOperations:['practice_service'],propertyUses:['residential'],workContexts:['maintenance'],customerExemptions:['none']},registration:'registered',collectionBasis:'Synthetic local coverage fixture only'};
 const input={candidates:[persisted],registry:[],manifest:{version:'tax-coverage-review-v2',mode:'synthetic_fixture',review:{authorId:'local-fixture-author',reviewerId:'local-fixture-reviewer',reviewedOn:new Date().toISOString().slice(0,10),verdict:'approved',evidenceDigest:hash('Synthetic local review; no real independent tax validation')},entries:[{ruleKey:'connected-fixture-only',expectedRevision:0,expectedDigest:'none',candidateDigest:persisted.digest,sourceDigest:source.contentDigest,reviewedRuleDigest:hash(stableStringify(rule)),rule}]}};
 const artifact=publication.buildCoverageArtifact(input);assert.equal(publication.verifyCoverageArtifact(artifact,input).writes,0);result.artifact=artifact;
 // Explicit disposable migration-owner fixture publication only; this executor is not mounted or shipped as an automatic publisher.
 const publisher=await f.ownerPool.connect();try{await publisher.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await publisher.query('LOCK TABLE canonical_tax_rule_versions IN SHARE ROW EXCLUSIVE MODE');assert.equal((await publisher.query('SELECT count(*)::int n FROM canonical_tax_rule_versions')).rows[0].n,0);for(const op of artifact.operations)await publisher.query("INSERT INTO canonical_tax_rule_versions(version,rule_key,revision,content,digest) VALUES('tax-preparation-v2',$1,$2,$3,$4)",[op.ruleKey,op.revision,op.content,op.digest]);await publisher.query('COMMIT');}finally{await publisher.query('ROLLBACK');publisher.release();}
 await preparation.tick();const currentClient=await f.runtimePool.connect();let current;try{await currentClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');current=await repo.read(currentClient,actor);await currentClient.query('ROLLBACK');}finally{currentClient.release();}
 result.afterFixturePublication=current;assert.equal(current.resultCurrent,true);assert.notEqual(current.rulesDigest,jobs[0].rules_digest);assert.equal(current.result.state,'missing_inputs');assert.ok(current.result.coverage.some(c=>c.missing.includes('effective_date')));
 const dated=structuredClone(body);dated.expectedRevision=current.current.revision;dated.expectedDigest=current.current.digest;dated.expectedProfileVersion=current.expectedProfileVersion;dated.inputs.contexts[0].effectiveOn='2026-01-01';dated.inputs.contexts[0].collectionBasis=rule.collectionBasis;await repo.mutate(f.runtimePool,{...actor,idempotencyKey:crypto.randomUUID()},dated);await preparation.tick();const rc=await f.runtimePool.connect();let reviewed;try{await rc.query('BEGIN ISOLATION LEVEL REPEATABLE READ');reviewed=await repo.read(rc,actor);await rc.query('ROLLBACK');}finally{rc.release();}result.afterOwnerDate=reviewed;assert.ok(reviewed.result.coverage.some(c=>c.state==='matched'),JSON.stringify(reviewed.result));assert.equal(reviewed.result.state,'missing_inputs');assert.ok(reviewed.result.missing.includes('operating_location'));

 assert.throws(()=>publication.verifyCoverageArtifact(artifact,{...input,registry:[{ruleKey:artifact.operations[0].ruleKey,revision:1,digest:artifact.operations[0].digest}]}));
 assert.deepEqual((await f.ownerPool.query('SELECT * FROM canonical_tax_research_candidates WHERE organization_id=$1',[f.org])).rows,candidates);
 result.cases.push('synthetic offline artifact -> explicit disposable owner publication -> existing automatic preparation observes new rule digest, requires owner date and still retains unknown operating location; stale artifact rejects and candidate evidence stays immutable; no real coverage claim');
 result.pass=true;
}catch(e){result.error={message:e.message,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})();
