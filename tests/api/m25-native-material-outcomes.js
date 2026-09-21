'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m25-native-material-outcome-local-secret';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
const{createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const contracts=require('../../src/operations/contract'),operations=require('../../src/operations/repository');
const output=(process.argv.find(value=>value.startsWith('--output='))||'--output=m25-native-material-outcomes-result.json').slice(9);assert.ok(!fs.existsSync(output));
(async()=>{let f;const ledger={cases:[]};try{
 f=await createEstimateReviewFixture();const owner=f.actors.owner,member=f.actors.member;
 const estimate=f.estimateGraphs[0].ids.estimate,estimateRoute='/api/v1/canonical/estimates/'+estimate;
 const read=async()=>{const r=await request(f.app).get(estimateRoute+'/review').set(owner.session.headers);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const postEstimate=(suffix,body,key=crypto.randomUUID())=>request(f.app).post(estimateRoute+suffix).set(owner.session.headers).set('Idempotency-Key',key).send(body);
 let review=await read();const helpers=require('../helpers/m24-cost-composition-input');let body=helpers.planBody(review,'material','20.00');
 let response=await postEstimate('/material-plan-preview',body);assert.equal(response.status,200,JSON.stringify(response.body));helpers.acceptPlanPreview(body,response.body.data);
 response=await postEstimate('/material-plans',body);assert.equal(response.status,201,JSON.stringify(response.body));review=await read();
 body=helpers.adoptionBody(review,'material');response=await postEstimate('/cost-adoption-preview',body);assert.equal(response.status,200,JSON.stringify(response.body));
 body.assessment=response.body.data.assessment;response=await postEstimate('/cost-adoptions',body);assert.equal(response.status,201,JSON.stringify(response.body));review=await read();
 const adopted=review.costComponents.material,plan=review.materialPlans.history.find(value=>value.id===adopted.id);assert(plan);const lines=plan.inputs.lines;
 ledger.cases.push('A current adopted two-line Mission 24 material plan is the only planned quantity authority.');

 const createExecution=f.createExecution.bind(f);const work=await createExecution({useMigrationRoleForUpstreamSeed:true});
 const reviewMovement=async recorded=>{
  const reviewed=contracts.normalizeMaterialAction({...owner,executionId:work.execution.id,idempotencyKey:crypto.randomUUID(),body:{
   action:'review',performerProfileId:member.actorUserId,movementId:recorded.id,expectedMovementRevision:Number(recorded.revision),expectedMovementDigest:recorded.digest,
   reviewOutcome:'accepted',unitContractVersion:contracts.MATERIAL_UNIT_CONTRACT_VERSION,unitContractDigest:contracts.MATERIAL_UNIT_CONTRACT_DIGEST,
   expectedExecutionRevision:Number(work.execution.revision),expectedExecutionDigest:work.execution.digest,
   expectedAssignmentRevision:Number(work.assignment.revision),expectedAssignmentDigest:work.assignment.digest,
   reason:'Accept exact synthetic job material evidence.'}});
  return (await operations.mutateMaterialInventory(f.ownerPool,{...reviewed,csrfToken:owner.csrfToken,requestCorrelationId:'m25-material-review'})).body.data.material;
 };
 const movement=async(kind,itemKey,quantity,unit='ft',adjustmentDirection=null,accept=true)=>{
  const normalized=contracts.normalizeMaterialAction({...owner,executionId:work.execution.id,idempotencyKey:crypto.randomUUID(),body:{
   action:'record',performerProfileId:member.actorUserId,movementKind:kind,itemKey,description:'Recorded synthetic job material',quantity,unitCode:unit,
   unitContractVersion:contracts.MATERIAL_UNIT_CONTRACT_VERSION,unitContractDigest:contracts.MATERIAL_UNIT_CONTRACT_DIGEST,locationKey:'truck-1',
   ...(adjustmentDirection?{adjustmentDirection}:{}),
   expectedExecutionRevision:Number(work.execution.revision),expectedExecutionDigest:work.execution.digest,
   expectedAssignmentRevision:Number(work.assignment.revision),expectedAssignmentDigest:work.assignment.digest,
   reason:'Record exact synthetic job material evidence.'}});
  let result=(await operations.mutateMaterialInventory(f.ownerPool,{...normalized,csrfToken:owner.csrfToken,requestCorrelationId:'m25-material-record'})).body.data;
  const recorded=result.material;
  return accept?reviewMovement(recorded):recorded;
 };
 await movement('adjustment','cedar-boards','20','ft','increase');await movement('adjustment','support-boards','20','ft','increase');await movement('adjustment','wrong-unit','20','ea','increase');
 await movement('consumed','cedar-boards','4.5');await movement('waste','cedar-boards','0.5');await movement('consumed','support-boards','6');
 await movement('consumed','wrong-unit','1','ea');
 const completionContract=require('../../src/completion/contract'),completionRepo=require('../../src/completion/repository');
 let execution=work.execution,assignment=work.assignment;
 const completion=async(action,extra={})=>{const input=completionContract.normalizeCompletionAction({...owner,executionId:execution.id,idempotencyKey:crypto.randomUUID(),body:{action,
  expectedExecutionRevision:Number(execution.revision),expectedExecutionDigest:execution.digest,expectedAssignmentRevision:Number(assignment.revision),expectedAssignmentDigest:assignment.digest,
  reason:'Complete the synthetic native material outcome.',...(action==='propose_completion'?{expiresAt:new Date(Date.now()+60000).toISOString(),gateRequirements:{checklists:[],inspections:[],files:[]}}:{}),...extra}});
  const result=await completionRepo.mutateCompletion(f.ownerPool,{...input,csrfToken:owner.csrfToken,requestCorrelationId:'m25-native-material-completion'});execution=result.body.data;work.execution=execution;return result;};
 let proposed=await completion('propose_completion');let proposal=proposed.body.completionRecord;
 let approved=await completion('approve_completion',{proposal:{id:proposal.id,revision:proposal.revision,digest:proposal.digest}});const approvedCompletion=approved.body.completionRecord;assert.equal(work.execution.lifecycleState,'completed');
 const estimateOpportunity=(await f.ownerPool.query('SELECT opportunity_id FROM canonical_estimates WHERE organization_id=$1 AND id=$2',[f.org,estimate])).rows[0].opportunity_id;
 await f.ownerPool.query('ALTER TABLE canonical_field_executions DISABLE TRIGGER USER');
 try{await f.ownerPool.query('UPDATE canonical_field_executions SET opportunity_id=$3 WHERE organization_id=$1 AND id=$2',[f.org,work.execution.id,estimateOpportunity]);}
 finally{await f.ownerPool.query('ALTER TABLE canonical_field_executions ENABLE TRIGGER USER');}
 ledger.cases.push('The exact selected completed execution contains reviewed consumption and waste movements with explicit units.');

 const root='/api/v1/learning',write=(suffix,payload,key=crypto.randomUUID(),actor=owner)=>request(f.app).post(root+suffix).set(actor.session.headers)
  .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',key).send(payload);
 let consent=await request(f.app).get(root+'/native-material-outcome-consent').set(owner.session.headers);assert.equal(consent.status,200);assert.equal(consent.body.data.active,false);
 const grant={action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use reviewed NorthStar material movement evidence for quantity learning.',confirmed:true,confirmationVersion:'m25-native-material-outcome-consent-v1'};
 const grantKey=crypto.randomUUID();consent=await write('/native-material-outcome-consent',grant,grantKey);assert.equal(consent.status,201,JSON.stringify(consent.body));
 assert.equal((await write('/native-material-outcome-consent',grant,grantKey)).status,200);assert.equal((await write('/native-material-outcome-consent',grant,crypto.randomUUID(),member)).status,403);
 let pin=consent.body.data.consent;const route=`/estimates/${estimate}/executions/${work.execution.id}/native-material-outcomes`;
 const bindings=[{lineId:lines[0].lineId,itemKey:'cedar-boards'},{lineId:lines[1].lineId,itemKey:'support-boards'}];
 let observe={expectedConsentRevision:pin.revision,expectedConsentDigest:pin.digest,bindings,reason:'Compare exact reviewed use with the adopted material quantities.',confirmed:true,confirmationVersion:'m25-native-material-outcome-observation-v1'};
 assert.equal((await write(route,{...observe,bindings:[bindings[0],bindings[0]]})).status,400);
 assert.equal((await write(route,{...observe,bindings:[bindings[0]]})).status,409);
 assert.equal((await write(route,{...observe,bindings:[bindings[0],{lineId:crypto.randomUUID(),itemKey:'support-boards'}]})).status,409);
 assert.equal((await write(route,{...observe,bindings:[{lineId:lines[0].lineId,itemKey:'wrong-unit'},bindings[1]]})).status,409);
 const sourceBefore=(await f.ownerPool.query('SELECT e.snapshot_digest estimate,p.digest plan,x.canonical_digest execution FROM canonical_estimates e,canonical_material_plans p,canonical_field_executions x WHERE e.organization_id=$1 AND e.id=$2 AND p.organization_id=e.organization_id AND p.id=$3 AND x.organization_id=e.organization_id AND x.id=$4',[f.org,estimate,plan.id,work.execution.id])).rows[0];
 const observationKey=crypto.randomUUID();const concurrent=await Promise.all([write(route,observe,observationKey),write(route,observe,observationKey)]);
 assert.deepEqual(concurrent.map(value=>value.status).sort(),[200,201]);assert.equal(concurrent[0].body.data.observation.id,concurrent[1].body.data.observation.id);
 let observed=concurrent.find(value=>value.status===201);assert(observed,JSON.stringify(concurrent.map(value=>value.body)));
 const first=observed.body.data.observation;assert.equal(first.result.lineCount,2);assert.equal(first.result.comparedLineCount,2);assert.equal(first.advisoryCode,'some_above_plan');
 assert.deepEqual(first.result.lines.map(line=>[line.itemKey,line.plannedQuantity,line.recordedUsedQuantity,line.unit]).sort((a,b)=>a[0].localeCompare(b[0])),[['cedar-boards','5.000000','5.000000','ft'],['support-boards','5.000000','6.000000','ft']]);
 assert.match(first.scopeNote,/Returns, transfers and adjustments do not establish use/i);assert.match(first.adoptionBoundary,/No estimate, price, job, inventory balance, purchase, vendor record or business policy was changed/i);
 assert.equal((await write(route,observe,observationKey)).status,200);assert.equal((await write(route,observe)).status,409);
 const sourceAfter=(await f.ownerPool.query('SELECT e.snapshot_digest estimate,p.digest plan,x.canonical_digest execution FROM canonical_estimates e,canonical_material_plans p,canonical_field_executions x WHERE e.organization_id=$1 AND e.id=$2 AND p.organization_id=e.organization_id AND p.id=$3 AND x.organization_id=e.organization_id AND x.id=$4',[f.org,estimate,plan.id,work.execution.id])).rows[0];assert.deepEqual(sourceAfter,sourceBefore);
 let learned=await request(f.app).get(root+route).set(owner.session.headers);assert.equal(learned.status,200);assert.equal(learned.body.data.current.fresh,true);
 ledger.cases.push('Purpose-specific consent records one immutable two-line comparison without matching names or converting units.');

 await f.ownerPool.query('ALTER TABLE canonical_field_executions DISABLE TRIGGER USER');
 try{await f.ownerPool.query('UPDATE canonical_field_executions SET opportunity_id=$3 WHERE organization_id=$1 AND id=$2',[f.org,work.execution.id,work.opportunity]);}
 finally{await f.ownerPool.query('ALTER TABLE canonical_field_executions ENABLE TRIGGER USER');}
 let reopened=await completion('reopen_execution',{completion:{id:approvedCompletion.id,revision:approvedCompletion.revision,digest:approvedCompletion.digest},nextAction:'Record corrected material use.'});
 await completion('resume_reopened',{reopening:{id:reopened.body.completionRecord.id,revision:reopened.body.completionRecord.revision,digest:reopened.body.completionRecord.digest}});
 const pending=await movement('waste','support-boards','1','ft',null,false);
 learned=await request(f.app).get(root+route).set(owner.session.headers);assert.equal(learned.status,200);assert.equal(learned.body.data.current.fresh,false);assert.equal(learned.body.data.current.advisoryAvailable,false);
 assert.equal((await write(route,observe,observationKey)).body.data.observation.advisoryAvailable,false);
 await reviewMovement(pending);proposed=await completion('propose_completion');proposal=proposed.body.completionRecord;
 await completion('approve_completion',{proposal:{id:proposal.id,revision:proposal.revision,digest:proposal.digest}});
 await f.ownerPool.query('ALTER TABLE canonical_field_executions DISABLE TRIGGER USER');
 try{await f.ownerPool.query('UPDATE canonical_field_executions SET opportunity_id=$3 WHERE organization_id=$1 AND id=$2',[f.org,work.execution.id,estimateOpportunity]);}
 finally{await f.ownerPool.query('ALTER TABLE canonical_field_executions ENABLE TRIGGER USER');}
 observed=await write(route,observe);assert.equal(observed.status,201,JSON.stringify(observed.body));assert.equal(observed.body.data.observation.revision,2);
 assert.equal(observed.body.data.observation.result.lines.find(line=>line.itemKey==='support-boards').recordedUsedQuantity,'7.000000');
 ledger.cases.push('Review changes and newly accepted movement evidence stale and mask earlier advice until a new observation pins the complete current set.');

 const revoke={action:'revoke',expectedRevision:pin.revision,expectedDigest:pin.digest,reason:'Stop native material outcome learning.',confirmed:true,confirmationVersion:'m25-native-material-outcome-consent-v1'};
 let revoked=await write('/native-material-outcome-consent',revoke);assert.equal(revoked.status,201);learned=await request(f.app).get(root+route).set(owner.session.headers);
 assert.equal(learned.body.data.activeConsent,false);assert.equal(learned.body.data.current,null);assert.deepEqual(learned.body.data.history,[]);
 let replay=await write(route,observe,observationKey);assert.equal(replay.status,200);assert.equal(replay.body.data.observation.hiddenByConsent,true);
 const revokedPin=revoked.body.data.consent;const regrant={...grant,expectedRevision:revokedPin.revision,expectedDigest:revokedPin.digest};consent=await write('/native-material-outcome-consent',regrant);assert.equal(consent.status,201);
 learned=await request(f.app).get(root+route).set(owner.session.headers);assert.equal(learned.body.data.activeConsent,true);assert.equal(learned.body.data.current,null);assert.deepEqual(learned.body.data.history,[]);assert.equal(learned.body.data.total,0);
 pin=consent.body.data.consent;observe={...observe,expectedConsentRevision:pin.revision,expectedConsentDigest:pin.digest};observed=await write(route,observe);assert.equal(observed.status,201);assert.equal(observed.body.data.observation.revision,3);
 const other=await request(f.app).get(root+route).set(f.actors.otherOwner.session.headers);assert.equal(other.status,200);assert.equal(other.body.data.activeConsent,false);
 ledger.cases.push('Revocation hides the derived history, and regrant starts a new consent period without reviving prior observations or leaking across tenants.');

 const privileges=(await f.ownerPool.query("SELECT has_table_privilege($1,'canonical_material_learning_consents','SELECT,INSERT,UPDATE,DELETE') consents,has_table_privilege($1,'canonical_native_material_outcome_observations','SELECT,INSERT,UPDATE,DELETE') outcomes,has_function_privilege($1,'canonical_native_material_outcome_basis(uuid,uuid,uuid,jsonb)','EXECUTE') helper,has_function_privilege($1,'canonical_native_material_outcome_read(uuid,uuid,text,uuid,uuid,uuid)','EXECUTE') entry",[f.roles.runtime])).rows[0];
 assert.deepEqual(privileges,{consents:false,outcomes:false,helper:false,entry:true});await assert.rejects(f.ownerPool.query('DELETE FROM canonical_native_material_outcome_observations'));
 const bytes=fs.readFileSync(path.join(__dirname,'../../migrations/105_canonical_native_material_outcomes.sql'));const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const rows=(await f.ownerPool.query("SELECT trim(checksum) checksum,count(*) OVER()::int rows FROM _migrations WHERE filename='105_canonical_native_material_outcomes.sql'")).rows;assert.deepEqual(rows,[{checksum:digest,rows:1}]);
 ledger.cases.push('Runtime authority is entry-only, records are immutable, and the exact migration checksum is applied once.');ledger.pass=true;
 }catch(error){ledger.error=error.stack;ledger.cause=error.cause&&{message:error.cause.message,code:error.cause.code,constraint:error.cause.constraint,detail:error.cause.detail};process.exitCode=1;}
 finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(ledger,null,2));console.log(JSON.stringify(ledger));}})();
