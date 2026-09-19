'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m25-native-equipment-utilization-local-secret';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
const{createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const output=(process.argv.find(value=>value.startsWith('--output='))||'--output=m25-native-equipment-utilization-result.json').slice(9);
assert.ok(!fs.existsSync(output));
(async()=>{let f;const ledger={cases:[]};try{
 f=await createEstimateReviewFixture();const owner=f.actors.owner,member=f.actors.member;
 const estimate=f.estimateGraphs[0].ids.estimate,estimateRoute='/api/v1/canonical/estimates/'+estimate;
 const read=async()=>{const r=await request(f.app).get(estimateRoute+'/review').set(owner.session.headers);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const post=(suffix,body,key=crypto.randomUUID())=>request(f.app).post(estimateRoute+suffix).set(owner.session.headers).set('Idempotency-Key',key).send(body);
 // The synthetic M23 execution seed predates the current entry-only runtime ACL.
 // Keep that fixture-only baseline on the migration role; every Slice A read and
 // mutation below still exercises the mounted least-privilege HTTP/runtime path.
 const createExecution=f.createExecution.bind(f);f.createExecution=(options={})=>createExecution({...options,useMigrationRoleForUpstreamSeed:true});
 const live=await require('../helpers/m24-readiness-asset').createReadinessAsset(f);f.createExecution=createExecution;
 let review=await read();const equipment=require('../helpers/m24-equipment-input');
 const inputs=equipment.inputs([equipment.line({assetId:live.asset.id,identity:live.identity,accessBasis:'owned',task:'Operate the reviewed auger',ownerReview:'Use the exact reviewed company asset.'})]);
 inputs.serviceKey=review.equipmentPlans.sources.serviceKey;
 let body={action:'save',expectedRevision:review.equipmentPlans.current?.revision||0,expectedDigest:review.equipmentPlans.current?.digest||'none',
  sourcePins:review.pins,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,
  inputs,currency:review.currency,reason:'Review the exact native asset for this planned job.',confirmed:true,confirmationVersion:'estimate-equipment-plan-v1'};
 let response=await post('/equipment-plan-preview',body);assert.equal(response.status,200,JSON.stringify(response.body));
 body.inputs.assessment={...response.body.data.assessment,acknowledged:true};response=await post('/equipment-plans',body);assert.equal(response.status,201,JSON.stringify(response.body));
 review=await read();body=require('../helpers/m24-equipment-cost-input').body(review);
 response=await post('/equipment-cost-preview',body);assert.equal(response.status,200,JSON.stringify(response.body));
 body.inputs.assessment={...response.body.data.assessment,acknowledged:true,explanation:'Use the declared eight planned equipment hours.'};
 response=await post('/equipment-cost-plans',body);assert.equal(response.status,201,JSON.stringify(response.body));
 review=await read();const cost=review.equipmentCostPlans.current;
 body={sourcePins:review.pins,expectedPlanId:cost.id,expectedPlanRevision:cost.revision,expectedPlanDigest:cost.digest,
  expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,
  reason:'Adopt the reviewed equipment plan and its declared hours.',confirmed:true,confirmationVersion:'estimate-cost-adoption-v2',
  changedComponent:'equipment',expectedComponents:review.equipmentCostComponents,assessment:{}};
 response=await post('/cost-adoption-preview',body);assert.equal(response.status,200,JSON.stringify(response.body));body.assessment=response.body.data.assessment;
 response=await post('/cost-adoptions',body);assert.equal(response.status,201,JSON.stringify(response.body));
 ledger.cases.push('One reviewed owned asset and eight planned hours are adopted through the existing estimate authority.');

 const start=new Date(Date.now()-5*3600000),end=new Date(start.getTime()+4*3600000);
 await live.record('check_out',{observedAt:start.toISOString()});await live.record('use',{observedAt:new Date(start.getTime()+3600000).toISOString()});
 const checkedIn=await live.record('check_in',{observedAt:end.toISOString()});
 let execution=live.work.execution,assignment=live.work.assignment;
 const completionContract=require('../../src/completion/contract'),completionRepo=require('../../src/completion/repository');
 const completionInput=(action,extra={})=>completionContract.normalizeCompletionAction({...owner,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{action,
  expectedExecutionRevision:Number(execution.revision),expectedExecutionDigest:execution.digest,
  expectedAssignmentRevision:Number(assignment.revision),expectedAssignmentDigest:assignment.digest,
  reason:'Complete the synthetic native equipment outcome.',...extra}});
 let normalized=completionInput('propose_completion',{expiresAt:new Date(Date.now()+60000).toISOString(),gateRequirements:{checklists:[],inspections:[],files:[]}});
 let result=await completionRepo.mutateCompletion(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-native-equipment-propose'});
 let proposal=result.body.completionRecord;execution=result.body.data;
 normalized=completionInput('approve_completion',{proposal:{id:proposal.id,revision:proposal.revision,digest:proposal.digest}});
 result=await completionRepo.mutateCompletion(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-native-equipment-approve'});
 execution=result.body.data;const approvedCompletion=result.body.completionRecord;assert.equal(execution.lifecycleState,'completed');
 const executionOpportunity=live.work.opportunity;
 const estimateOpportunity=(await f.ownerPool.query('SELECT opportunity_id FROM canonical_estimates WHERE organization_id=$1 AND id=$2',[f.org,estimate])).rows[0].opportunity_id;
 await f.ownerPool.query('ALTER TABLE canonical_field_executions DISABLE TRIGGER USER');
 try{await f.ownerPool.query('UPDATE canonical_field_executions SET opportunity_id=$3 WHERE organization_id=$1 AND id=$2',[f.org,execution.id,estimateOpportunity]);}
 finally{await f.ownerPool.query('ALTER TABLE canonical_field_executions ENABLE TRIGGER USER');}
 ledger.cases.push('Completed job evidence contains one exact four-hour check-out/use/check-in chain for the adopted asset.');

 const root='/api/v1/learning',write=(suffix,payload,key=crypto.randomUUID(),actor=owner)=>request(f.app).post(root+suffix).set(actor.session.headers)
  .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',key).send(payload);
 let consent=await request(f.app).get(root+'/native-equipment-utilization-consent').set(owner.session.headers);assert.equal(consent.status,200);assert.equal(consent.body.data.active,false);
 const grant={action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use exact NorthStar checkout intervals for native utilization learning.',confirmed:true,confirmationVersion:'m25-native-equipment-utilization-consent-v1'};
 const grantKey=crypto.randomUUID();consent=await write('/native-equipment-utilization-consent',grant,grantKey);assert.equal(consent.status,201,JSON.stringify(consent.body));
 assert.equal((await write('/native-equipment-utilization-consent',grant,grantKey)).status,200);assert.equal((await write('/native-equipment-utilization-consent',grant,crypto.randomUUID(),member)).status,403);
 const pin=consent.body.data.consent;assert.equal(pin.purpose,'native_equipment_checkout_variance_v1');
 const observe={expectedConsentRevision:pin.revision,expectedConsentDigest:pin.digest,
  reason:'Compare recorded checkout duration with the adopted equipment hours.',confirmed:true,confirmationVersion:'m25-native-equipment-utilization-observation-v1'};
 const directObserve=async(revision,digest,key=crypto.randomUUID())=>{const client=await f.runtimePool.connect();try{
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');const value=(await client.query(
   'SELECT public.canonical_native_equipment_utilization_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
   [f.org,owner.actorUserId,'owner',owner.authSessionId,owner.csrfToken,key,estimate,revision,digest,observe.reason,true,observe.confirmationVersion])).rows[0].value;
  await client.query('COMMIT');return value;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}};
 const invalidBefore=(await f.ownerPool.query('SELECT count(*)::int n FROM canonical_native_equipment_utilization_observations')).rows[0].n;
 for(const pins of [[null,pin.digest],[pin.revision,null],[null,null],[0,pin.digest],[pin.revision,'bad']])
  await assert.rejects(()=>directObserve(pins[0],pins[1]),error=>['22023','22P02'].includes(error.code));
 assert.equal((await f.ownerPool.query('SELECT count(*)::int n FROM canonical_native_equipment_utilization_observations')).rows[0].n,invalidBefore);
 const observationKey=crypto.randomUUID();let observed=await write('/estimates/'+estimate+'/native-equipment-utilization-outcomes',observe,observationKey);
 assert.equal(observed.status,201,JSON.stringify(observed.body));const first=observed.body.data.observation;
 assert.equal(first.plannedHours,'8.0000');assert.equal(first.recordedCheckoutHours,'4.0000');assert.equal(first.variancePercent,'-50.00');assert.equal(first.advisoryCode,'actual_below_plan');
 assert.equal(first.sourceManifest.lines[0].checkoutPairs,1);assert.deepEqual(first.sourceManifest.lines[0].events.map(event=>event.kind),['check_out','use','check_in']);
 assert.match(first.scopeNote,/do not prove engine-on time/i);assert.match(first.adoptionBoundary,/No estimate, price, schedule, asset record, cost allocation or business policy was changed/i);
 assert.equal((await write('/estimates/'+estimate+'/native-equipment-utilization-outcomes',observe,observationKey)).status,200);
 assert.equal((await write('/estimates/'+estimate+'/native-equipment-utilization-outcomes',observe)).status,409);
 let learned=await request(f.app).get(root+'/estimates/'+estimate+'/native-equipment-utilization-outcomes').set(owner.session.headers);
 assert.equal(learned.status,200);assert.equal(learned.body.data.current.fresh,true);assert.equal(learned.body.data.current.advisoryAvailable,true);
 ledger.cases.push('Explicit consent records one immutable provenance-pinned checkout-duration variance without claiming productive or operating time.');

 await f.ownerPool.query('ALTER TABLE canonical_field_executions DISABLE TRIGGER USER');
 try{await f.ownerPool.query('UPDATE canonical_field_executions SET opportunity_id=$3 WHERE organization_id=$1 AND id=$2',[f.org,execution.id,executionOpportunity]);}
 finally{await f.ownerPool.query('ALTER TABLE canonical_field_executions ENABLE TRIGGER USER');}
 normalized=completionInput('reopen_execution',{completion:{id:approvedCompletion.id,revision:approvedCompletion.revision,digest:approvedCompletion.digest},nextAction:'Correct the recorded equipment return time.'});
 result=await completionRepo.mutateCompletion(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-native-equipment-reopen'});
 execution=result.body.data;const reopening=result.body.completionRecord;
 normalized=completionInput('resume_reopened',{reopening:{id:reopening.id,revision:reopening.revision,digest:reopening.digest}});
 result=await completionRepo.mutateCompletion(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-native-equipment-resume'});execution=result.body.data;
 live.work.execution=execution;
 const correction=live.body('check_in',{action:'correct',correctsEventId:checkedIn.result.data.eventId,observedAt:new Date(end.getTime()+3600000).toISOString()});
 result=await live.repo.mutate(live.actor,live.work.execution.id,crypto.randomUUID(),correction,true);assert.ok(result.data?.eventId,JSON.stringify(result));
 normalized=completionInput('propose_completion',{expiresAt:new Date(Date.now()+60000).toISOString(),gateRequirements:{checklists:[],inspections:[],files:[]}});
 result=await completionRepo.mutateCompletion(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-native-equipment-repropose'});
 proposal=result.body.completionRecord;execution=result.body.data;live.work.execution=execution;
 normalized=completionInput('approve_completion',{proposal:{id:proposal.id,revision:proposal.revision,digest:proposal.digest}});
 result=await completionRepo.mutateCompletion(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-native-equipment-reapprove'});execution=result.body.data;live.work.execution=execution;
 await f.ownerPool.query('ALTER TABLE canonical_field_executions DISABLE TRIGGER USER');
 try{await f.ownerPool.query('UPDATE canonical_field_executions SET opportunity_id=$3 WHERE organization_id=$1 AND id=$2',[f.org,execution.id,estimateOpportunity]);}
 finally{await f.ownerPool.query('ALTER TABLE canonical_field_executions ENABLE TRIGGER USER');}
 learned=await request(f.app).get(root+'/estimates/'+estimate+'/native-equipment-utilization-outcomes').set(owner.session.headers);
 assert.equal(learned.body.data.current.fresh,false);assert.equal(learned.body.data.current.advisoryAvailable,false);assert.equal(learned.body.data.current.advisoryCode,null);
 let delayed=await write('/estimates/'+estimate+'/native-equipment-utilization-outcomes',observe,observationKey);
 assert.equal(delayed.status,200,JSON.stringify(delayed.body));assert.equal(delayed.body.data.replayed,true);
 assert.equal(delayed.body.data.observation.fresh,false);assert.equal(delayed.body.data.observation.advisoryAvailable,false);
 assert.equal(delayed.body.data.observation.advisoryCode,null);assert.equal(delayed.body.data.observation.advisoryMessage,null);
 assert.equal((await write('/estimates/'+estimate+'/native-equipment-utilization-outcomes',{...observe,reason:'A changed delayed request must conflict.'},observationKey)).status,409);
 observed=await write('/estimates/'+estimate+'/native-equipment-utilization-outcomes',observe);assert.equal(observed.status,201,JSON.stringify(observed.body));
 assert.equal(observed.body.data.observation.revision,2);assert.equal(observed.body.data.observation.recordedCheckoutHours,'5.0000');
 ledger.cases.push('An owner correction makes the prior advice stale until a new immutable observation pins the corrected event chain.');

 const revoke={action:'revoke',expectedRevision:pin.revision,expectedDigest:pin.digest,reason:'Stop native equipment utilization learning.',confirmed:true,confirmationVersion:'m25-native-equipment-utilization-consent-v1'};
 const revoked=await write('/native-equipment-utilization-consent',revoke);assert.equal(revoked.status,201,JSON.stringify(revoked.body));
 learned=await request(f.app).get(root+'/estimates/'+estimate+'/native-equipment-utilization-outcomes').set(owner.session.headers);
 assert.equal(learned.body.data.activeConsent,false);assert.equal(learned.body.data.current,null);assert.deepEqual(learned.body.data.history,[]);
 delayed=await write('/estimates/'+estimate+'/native-equipment-utilization-outcomes',observe,observationKey);
 assert.equal(delayed.status,200,JSON.stringify(delayed.body));assert.equal(delayed.body.data.replayed,true);
 assert.equal(delayed.body.data.observation.hiddenByConsent,true);assert.equal(delayed.body.data.observation.advisoryAvailable,false);
 assert.equal(delayed.body.data.observation.advisoryCode,null);assert.equal(delayed.body.data.observation.advisoryMessage,null);
 const other=await request(f.app).get(root+'/estimates/'+estimate+'/native-equipment-utilization-outcomes').set(f.actors.otherOwner.session.headers);
 assert.equal(other.status,200);assert.equal(other.body.data.activeConsent,false);assert.equal(other.body.data.current,null);
 ledger.cases.push('Consent revocation hides outcomes, and another tenant receives no record-existence signal.');

 const privileges=(await f.ownerPool.query("SELECT has_table_privilege($1,'canonical_equipment_learning_consents','SELECT,INSERT,UPDATE,DELETE') consents,has_table_privilege($1,'canonical_native_equipment_utilization_observations','SELECT,INSERT,UPDATE,DELETE') outcomes,has_function_privilege($1,'canonical_native_equipment_utilization_basis(uuid,uuid)','EXECUTE') helper,has_function_privilege($1,'canonical_native_equipment_utilization_read(uuid,uuid,text,uuid,uuid)','EXECUTE') entry",[f.roles.runtime])).rows[0];
 assert.deepEqual(privileges,{consents:false,outcomes:false,helper:false,entry:true});await assert.rejects(f.ownerPool.query('DELETE FROM canonical_native_equipment_utilization_observations'));
 const bytes=fs.readFileSync(path.join(__dirname,'../../migrations/096_canonical_native_equipment_utilization.sql'));
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');const rows=(await f.ownerPool.query("SELECT trim(checksum) checksum,count(*) OVER()::int rows FROM _migrations WHERE filename='096_canonical_native_equipment_utilization.sql'")).rows;
 assert.deepEqual(rows,[{checksum:digest,rows:1}]);ledger.cases.push('Runtime authority is entry-only, history is immutable, and the exact migration checksum is recorded once.');ledger.pass=true;
 }catch(error){ledger.error=error.stack;ledger.cause=error.cause&&{message:error.cause.message,code:error.cause.code,constraint:error.cause.constraint,detail:error.cause.detail};process.exitCode=1;}
 finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(ledger,null,2));console.log(JSON.stringify(ledger));}})();
