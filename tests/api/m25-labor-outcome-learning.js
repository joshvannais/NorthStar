'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m25-labor-learning-local-disposable-secret';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
const{createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const{ingestLead}=require('../../src/services/canonicalGraphService');
const parts=require('../helpers/m24-cost-composition-input');
const contracts=require('../../src/operations/contract');
const operations=require('../../src/operations/repository');
const output=(process.argv.find(value=>value.startsWith('--output='))||'--output=m25-labor-learning-result.json').slice(9);
assert.ok(!fs.existsSync(output));

(async()=>{let f;const ledger={cases:[]};try{
 f=await createDatabaseFixture({operationalSchedule:true});
 const profileRow=(await f.ownerPool.query('SELECT raw_profile,version_label FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=true',[f.org])).rows[0];
 const external=crypto.randomUUID();
 const ingested=await ingestLead(f.runtimePool,{tenantContext:{organizationId:f.org,trusted:true},idempotencyKey:external,
  sourceVersion:'m25-labor-learning-fixture-v1',external:{customerId:external,callId:external,transcriptId:external,communicationId:external,appointmentId:external},
  customer:{name:'Synthetic labor learning customer',phone:'+15555550250',email:external+'@example.test',address:{line1:'25 Test Way',city:'Boston',state:'MA',postalCode:'02108'}},
  transcript:[{turnId:'scope',speaker:'customer',text:'I need a plumbing repair that is expected to take sixteen worker hours.'}],
  facts:[{variable:'laborHours',normalizedValue:16,evidenceText:'sixteen worker hours',speaker:'customer',evidenceTurnId:'scope',confidence:1}],
  service:{key:'plumbing',scope:{jobType:'repair',laborHours:16,description:'Synthetic plumbing repair'}},
  businessProfile:profileRow.raw_profile,businessProfileVersion:profileRow.version_label});
 assert.equal(ingested.status,201,JSON.stringify(ingested));f.estimateGraphs=[ingested.body];
 const estimate=ingested.body.ids.estimate;
 const owner=f.actors.owner,member=f.actors.member;
 const estimateRoute='/api/v1/canonical/estimates/'+estimate;
 const postEstimate=(path,body,key=crypto.randomUUID())=>request(f.app).post(estimateRoute+path).set(owner.session.headers).set('Idempotency-Key',key).send(body);
 const review=async()=>{const result=await request(f.app).get(estimateRoute+'/review').set(owner.session.headers);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.data;};

 let state=await review(),plan=parts.planBody(state,'labor');
 let response=await postEstimate('/labor-plan-preview',plan);assert.equal(response.status,200,JSON.stringify(response.body));
 parts.acceptPlanPreview(plan,response.body.data);response=await postEstimate('/labor-plans',plan);assert.equal(response.status,201,JSON.stringify(response.body));
 state=await review();let adoption=parts.adoptionBody(state,'labor');
 response=await postEstimate('/cost-adoption-preview',adoption);assert.equal(response.status,200,JSON.stringify(response.body));
 adoption.assessment=response.body.data.assessment;response=await postEstimate('/cost-adoptions',adoption);assert.equal(response.status,201,JSON.stringify(response.body));
 ledger.cases.push('A reviewed labor plan is adopted as the immutable estimate baseline.');

 // Upstream graph and scheduling linkage is an explicit synthetic seed in this Mission 25 test.
 // The migration role is used only for those upstream fixture functions because the retained
 // deferred execution trigger cannot complete under the non-table runtime role. Mission 25
 // consent and learning still run through mounted runtime APIs and guarded database entries.
 const work=await f.createExecution({useMigrationRoleForUpstreamSeed:true}),assignment=work.assignment;
 let execution=work.execution,result,normalized;
 const profile=f.profiles[f.org],laborBase={performerProfileId:member.actorUserId,expectedExecutionRevision:execution.revision,
  expectedExecutionDigest:execution.digest,expectedAssignmentRevision:Number(assignment.revision),expectedAssignmentDigest:assignment.digest,
  categoryContractVersion:contracts.LABOR_CATEGORY_CONTRACT_VERSION,categoryContractDigest:contracts.LABOR_CATEGORY_CONTRACT_DIGEST,
  businessProfileId:profile.businessProfileId,businessProfileVersion:profile.version,businessProfileHash:profile.hash,timeZone:profile.timeZone,
  reason:'Record accepted labor evidence for the synthetic outcome'};
 const observedStart=new Date(Date.now()-9*3600000),observedEnd=new Date(Date.now()-3600000);
 normalized=contracts.normalizeLaborAction({...owner,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{...laborBase,action:'record_manual',category:'production',
  observedStart:observedStart.toISOString(),observedEnd:observedEnd.toISOString()}});
 result=await operations.mutateLaborTime(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-learning-labor'});
 assert.equal(result.status,200,JSON.stringify(result.body));let interval=result.body.data;
 normalized=contracts.normalizeLaborAction({...owner,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{...laborBase,action:'review',intervalId:interval.id,
  expectedIntervalRevision:interval.revision,expectedIntervalDigest:interval.digest,reviewOutcome:'accepted'}});
 result=await operations.mutateLaborTime(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-learning-review'});
 assert.equal(result.status,200,JSON.stringify(result.body));interval=result.body.data;
 const completionInput=(action,extra={})=>require('../../src/completion/contract').normalizeCompletionAction({...owner,
  executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{action,expectedExecutionRevision:execution.revision,
   expectedExecutionDigest:execution.digest,expectedAssignmentRevision:Number(assignment.revision),expectedAssignmentDigest:assignment.digest,
   reason:'Explicit synthetic completion decision',...extra}});
 let completion=completionInput('propose_completion',{expiresAt:new Date(Date.now()+60000).toISOString(),gateRequirements:{checklists:[],inspections:[],files:[]}});
 let proposed=await require('../../src/completion/repository').mutateCompletion(f.ownerPool,{...completion,csrfToken:owner.csrfToken,requestCorrelationId:'m25-learning-propose'});
 let proposal=proposed.body.completionRecord;execution=proposed.body.data;
 completion=completionInput('approve_completion',{proposal:{id:proposal.id,revision:proposal.revision,digest:proposal.digest}});
 proposed=await require('../../src/completion/repository').mutateCompletion(f.ownerPool,{...completion,csrfToken:owner.csrfToken,requestCorrelationId:'m25-learning-approve'});
 execution=proposed.body.data;assert.equal(execution.lifecycleState,'completed');
 const estimateOpportunity=(await f.ownerPool.query('SELECT opportunity_id FROM canonical_estimates WHERE organization_id=$1 AND id=$2',[f.org,estimate])).rows[0].opportunity_id;
 await f.ownerPool.query('ALTER TABLE canonical_field_executions DISABLE TRIGGER USER');
 try{await f.ownerPool.query('UPDATE canonical_field_executions SET opportunity_id=$3 WHERE organization_id=$1 AND id=$2',[f.org,execution.id,estimateOpportunity]);}
 finally{await f.ownerPool.query('ALTER TABLE canonical_field_executions ENABLE TRIGGER USER');}
 ledger.cases.push('A synthetic upstream job provides completed work and accepted labor evidence without bypassing Mission 25 runtime authority.');

 const learning='/api/v1/learning';
 const write=(url,body,key=crypto.randomUUID(),actorValue=owner)=>request(f.app).post(learning+url).set(actorValue.session.headers)
  .set('X-CSRF-Token',actorValue.csrfToken).set('Idempotency-Key',key).send(body);
 let consent=(await request(f.app).get(learning+'/labor-duration-consent').set(owner.session.headers));
 assert.equal(consent.status,200);assert.equal(consent.body.data.active,false);
 const grant={action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use this business labor records to compare planned and recorded worker hours.',confirmed:true,confirmationVersion:'m25-labor-duration-consent-v1'};
 const grantKey=crypto.randomUUID();consent=await write('/labor-duration-consent',grant,grantKey);assert.equal(consent.status,201,JSON.stringify(consent.body));
 assert.equal((await write('/labor-duration-consent',grant,grantKey)).status,200);
 assert.equal((await write('/labor-duration-consent',grant,crypto.randomUUID(),member)).status,403);
 const consentPin=consent.body.data.consent;
 const observeBody={expectedConsentRevision:consentPin.revision,expectedConsentDigest:consentPin.digest,
  reason:'Compare this completed job with its adopted labor plan.',confirmed:true,confirmationVersion:'m25-labor-duration-observation-v1'};
 const bypassClient=await f.runtimePool.connect();let bypassError;
 try{await bypassClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await bypassClient.query('SELECT public.canonical_labor_outcome_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
   [f.org,owner.actorUserId,owner.actorAccessRole,owner.authSessionId,owner.csrfToken,crypto.randomUUID(),estimate,
    consentPin.revision,consentPin.digest,'Attempt an unconfirmed direct observation.',false,'m25-labor-duration-observation-v1']);
 }catch(error){bypassError=error;}finally{await bypassClient.query('ROLLBACK').catch(()=>{});bypassClient.release();}
 assert.equal(bypassError&&bypassError.code,'22023');
 assert.equal((await f.ownerPool.query('SELECT count(*)::int count FROM canonical_labor_outcome_observations')).rows[0].count,0);
 const observationKey=crypto.randomUUID();
 const observation=await write('/estimates/'+estimate+'/labor-duration-outcomes',observeBody,observationKey);
 assert.equal(observation.status,201,JSON.stringify(observation.body));assert.equal(observation.body.data.observation.plannedWorkerHours,'16.0000');
 assert.equal(observation.body.data.observation.recordedWorkerHoursExcludingBreaks,'8.0000');
 assert.equal(observation.body.data.observation.variancePercent,'-50.00');
 assert.equal(observation.body.data.observation.advisoryCode,'actual_below_plan');
 assert.equal(observation.body.data.observation.confirmed,true);
 assert.equal(observation.body.data.observation.confirmationVersion,'m25-labor-duration-observation-v1');
 assert.equal(observation.body.data.observation.sourceManifest.laborIntervals.length,1);
 assert.equal(observation.body.data.observation.sourceManifest.laborIntervals[0].includedInWorkerHours,true);
 assert.match(observation.body.data.observation.adoptionBoundary,/No rate, estimate, schedule or policy was changed/);
 assert.equal((await write('/estimates/'+estimate+'/labor-duration-outcomes',observeBody,observationKey)).status,200);
 assert.equal((await write('/estimates/'+estimate+'/labor-duration-outcomes',observeBody)).status,409);
 let learned=await request(f.app).get(learning+'/estimates/'+estimate+'/labor-duration-outcomes').set(owner.session.headers);
 assert.equal(learned.status,200);assert.equal(learned.body.data.current.fresh,true);assert.equal(learned.body.data.current.advisoryAvailable,true);
 ledger.cases.push('Current tenant consent produces one deterministic, provenance-pinned and advisory-only labor variance.');

 normalized=contracts.normalizeLaborAction({...owner,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{...laborBase,
  expectedExecutionRevision:execution.revision,expectedExecutionDigest:execution.digest,action:'correct',intervalId:interval.id,
  expectedIntervalRevision:interval.revision,expectedIntervalDigest:interval.digest,category:'production',
  observedStart:observedStart.toISOString(),observedEnd:new Date(observedEnd.getTime()+3600000).toISOString()}});
 result=await operations.mutateLaborTime(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-learning-correct'});
 assert.equal(result.status,200,JSON.stringify(result.body));interval=result.body.data;
 normalized=contracts.normalizeLaborAction({...owner,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{...laborBase,
  expectedExecutionRevision:execution.revision,expectedExecutionDigest:execution.digest,action:'review',intervalId:interval.id,
  expectedIntervalRevision:interval.revision,expectedIntervalDigest:interval.digest,reviewOutcome:'accepted'}});
 result=await operations.mutateLaborTime(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-learning-rereview'});
 assert.equal(result.status,200,JSON.stringify(result.body));
 learned=await request(f.app).get(learning+'/estimates/'+estimate+'/labor-duration-outcomes').set(owner.session.headers);
 assert.equal(learned.status,200);assert.equal(learned.body.data.current.fresh,false);assert.equal(learned.body.data.current.advisoryAvailable,false);
 assert.equal(learned.body.data.current.advisoryCode,null);assert.equal(learned.body.data.current.advisoryMessage,null);
 assert.equal(learned.body.data.history[0].advisoryCode,null);assert.equal(learned.body.data.history[0].advisoryMessage,null);
 assert.equal(learned.body.data.refreshRequired,true);
 const refreshed=await write('/estimates/'+estimate+'/labor-duration-outcomes',observeBody);
 assert.equal(refreshed.status,201,JSON.stringify(refreshed.body));assert.equal(refreshed.body.data.observation.revision,2);
 assert.equal(refreshed.body.data.observation.recordedWorkerHoursExcludingBreaks,'9.0000');
 ledger.cases.push('A corrected labor interval invalidates the earlier advice until a new immutable observation is recorded.');

 const revoke={action:'revoke',expectedRevision:consentPin.revision,expectedDigest:consentPin.digest,
  reason:'Stop using labor records for this learning purpose.',confirmed:true,confirmationVersion:'m25-labor-duration-consent-v1'};
 const revoked=await write('/labor-duration-consent',revoke);assert.equal(revoked.status,201,JSON.stringify(revoked.body));
 learned=await request(f.app).get(learning+'/estimates/'+estimate+'/labor-duration-outcomes').set(owner.session.headers);
 assert.equal(learned.status,200);assert.equal(learned.body.data.activeConsent,false);assert.equal(learned.body.data.current,null);assert.deepEqual(learned.body.data.history,[]);
 assert.equal((await write('/estimates/'+estimate+'/labor-duration-outcomes',observeBody)).status,409);
 assert.equal((await request(f.app).get(learning+'/estimates/'+estimate+'/labor-duration-outcomes').set(f.actors.otherOwner.session.headers)).status,200);
 const other=(await request(f.app).get(learning+'/estimates/'+estimate+'/labor-duration-outcomes').set(f.actors.otherOwner.session.headers)).body.data;
 assert.equal(other.activeConsent,false);assert.equal(other.current,null);
 const revokedConsent=revoked.body.data.consent;
 const regrantBody={action:'grant',expectedRevision:revokedConsent.revision,expectedDigest:revokedConsent.digest,
  reason:'Re-enable the same explicit labor comparison purpose.',confirmed:true,confirmationVersion:'m25-labor-duration-consent-v1'};
 const regranted=await write('/labor-duration-consent',regrantBody);assert.equal(regranted.status,201,JSON.stringify(regranted.body));
 const regrantPin=regranted.body.data.consent;
 const reobserved=await write('/estimates/'+estimate+'/labor-duration-outcomes',{...observeBody,
  expectedConsentRevision:regrantPin.revision,expectedConsentDigest:regrantPin.digest});
 assert.equal(reobserved.status,201,JSON.stringify(reobserved.body));assert.equal(reobserved.body.data.observation.revision,3);
 const finalRevoke=await write('/labor-duration-consent',{...revoke,expectedRevision:regrantPin.revision,expectedDigest:regrantPin.digest});
 assert.equal(finalRevoke.status,201,JSON.stringify(finalRevoke.body));
 learned=await request(f.app).get(learning+'/estimates/'+estimate+'/labor-duration-outcomes').set(owner.session.headers);
 assert.equal(learned.body.data.activeConsent,false);assert.equal(learned.body.data.current,null);
 ledger.cases.push('Consent revocation hides derived results, re-granting can re-observe the same sources, and another tenant receives no record existence signal.');

 const privileges=(await f.ownerPool.query("SELECT has_table_privilege($1,'canonical_learning_purpose_consents','SELECT,INSERT,UPDATE,DELETE') consent_table,has_table_privilege($1,'canonical_labor_outcome_observations','SELECT,INSERT,UPDATE,DELETE') outcome_table,has_function_privilege($1,'canonical_labor_learning_basis(uuid,uuid)','EXECUTE') helper,has_function_privilege($1,'canonical_labor_outcome_read(uuid,uuid,text,uuid,uuid)','EXECUTE') entry",[f.roles.runtime])).rows[0];
 assert.deepEqual(privileges,{consent_table:false,outcome_table:false,helper:false,entry:true});
 await assert.rejects(f.ownerPool.query('DELETE FROM canonical_labor_outcome_observations'));
 ledger.cases.push('Runtime access is limited to guarded entries and learning histories are immutable.');
 const migrationBytes=fs.readFileSync(require('node:path').join(__dirname,'../../migrations/083_canonical_labor_outcome_learning.sql'));
 const migrationDigest=crypto.createHash('sha256').update(migrationBytes).digest('hex');
 const migrationRows=(await f.ownerPool.query("SELECT trim(checksum) checksum,count(*) OVER()::int rows FROM _migrations WHERE filename='083_canonical_labor_outcome_learning.sql'")).rows;
 assert.deepEqual(migrationRows,[{checksum:migrationDigest,rows:1}]);
 ledger.cases.push('The exact LF migration checksum is recorded once in the disposable database.');
 ledger.pass=true;
}catch(error){ledger.error=error.stack;ledger.cause=error.cause&&{message:error.cause.message,code:error.cause.code,constraint:error.cause.constraint,detail:error.cause.detail};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(ledger,null,2));console.log(JSON.stringify(ledger));}})();
