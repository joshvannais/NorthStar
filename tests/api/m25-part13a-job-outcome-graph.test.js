'use strict';
const crypto=require('node:crypto');
const request=require('supertest');
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const token=(source,value)=>`ref_${sha(`${source}:${value}`)}`;

describe('Mission 25 Part 13A job outcome graph API',()=>{
 let f;
 beforeAll(async()=>{f=await createEstimateReviewFixture();},180000);
 afterAll(async()=>{if(f)await f.cleanup();},60000);

 test('connects exact current project and financial outcomes and masks every stale permission period',async()=>{
  const owner=f.actors.owner,estimate=f.estimateGraphs[0].ids.estimate;
  const post=(url,body,key=crypto.randomUUID(),actor=owner)=>request(f.app).post(url).set(actor.session.headers).set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',key).send(body);
  const before=(await f.ownerPool.query('SELECT snapshot_digest FROM canonical_estimates WHERE organization_id=$1 AND id=$2',[f.org,estimate])).rows[0].snapshot_digest;

  const projectSource='graph.projects',projectReference='project-graph-1',projectRoot=`/api/v1/learning/external-project-change-order-sources/${projectSource}`;
  let response=await post(`${projectRoot}/consent`,{action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use current project evidence for the job outcome graph.',confirmed:true,confirmationVersion:'m25-external-project-change-order-import-consent-v1'});
  expect(response.status).toBe(201);const projectSourceConsent=response.body.data.consent;
  const projectRecord={externalRecordId:'project-record-graph',externalVersion:1,state:'active',recordType:'project',customerReference:'customer-graph',jobReference:'job-graph',estimateReference:'estimate-graph',projectReference,changeOrderReference:null,recordState:'completed',originalContract:{status:'recorded',amount:'1000.00',currency:'USD'},currentContract:{status:'recorded',amount:'1100.00',currency:'USD'},changeOrderValue:null,occurredAt:'2026-09-15T12:00:00.000Z',endedAt:'2026-09-15T20:00:00.000Z',timeZone:'America/New_York',evidenceClass:'provider_recorded',providerEvidenceDigest:sha('project-graph-evidence'),sourceUpdatedAt:'2026-09-15T21:00:00.000Z'};
  response=await post(`${projectRoot}/batches`,{schemaVersion:'m25-external-project-change-order-v1',mode:'historical_backfill',expectedConsentRevision:projectSourceConsent.revision,expectedConsentDigest:projectSourceConsent.digest,cursorBefore:null,cursorAfter:null,complete:true,records:[projectRecord],reason:'Import the exact project outcome evidence.',confirmed:true,confirmationVersion:'m25-external-project-change-order-import-batch-v1'});
  expect(response.status).toBe(201);
  const projectMatchRoot=`/api/v1/learning/external-business-sources/project_change_order/${projectSource}`;
  let projectReview=(await request(f.app).get(`${projectMatchRoot}/matches`).set(owner.session.headers)).body.data;
  const projectTarget=projectReview.estimateTargets.find(value=>value.targetId===estimate);expect(projectTarget).toBeTruthy();
  const projectReferenceState=projectReview.references.find(value=>value.referenceKind==='project'&&value.externalReference===projectReference);expect(projectReferenceState).toBeTruthy();
  response=await post(`${projectMatchRoot}/matches`,{action:'link',referenceKind:'project',externalReference:projectReference,targetKind:'estimate',targetId:estimate,expectedRevision:0,expectedDigest:'none',expectedSourceDigest:projectReferenceState.sourceDigest,expectedTargetDigest:projectTarget.digest,reason:'Link the exact project to this job.',confirmed:true,confirmationVersion:'m25-external-business-reference-match-v1'});expect(response.status).toBe(201);
  const projectOutcomeRoot=`/api/v1/learning/external-project-outcome-sources/${projectSource}`;
  response=await post(`${projectOutcomeRoot}/consent`,{action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use the reviewed project outcome for this job.',confirmed:true,confirmationVersion:'m25-external-project-outcome-consent-v1'});expect(response.status).toBe(201);const projectPurpose=response.body.data.consent;
  response=await post(`${projectOutcomeRoot}/outcomes`,{estimateId:estimate,projectReference,expectedConsentRevision:projectPurpose.revision,expectedConsentDigest:projectPurpose.digest,reason:'Record the reviewed project outcome.',confirmed:true,confirmationVersion:'m25-external-project-outcome-observation-v1'});expect(response.status).toBe(201);const projectObservation=response.body.data.observation;expect(projectObservation.fresh).toBe(true);

  const financialSource='graph.financial',financialRoot=`/api/v1/learning/external-financial-sources/${financialSource}`;
  response=await post(`${financialRoot}/consent`,{action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use current financial evidence for the job outcome graph.',confirmed:true,confirmationVersion:'m25-external-financial-import-consent-v1'});expect(response.status).toBe(201);const financialSourceConsent=response.body.data.consent;
  const financialRecord=(id,reference,basis,amount)=>({externalRecordId:token(financialSource,id),externalVersion:1,state:'active',recordType:'accounting_entry',customerReference:token(financialSource,'customer'),jobReference:token(financialSource,'job'),estimateReference:token(financialSource,'estimate'),executionReference:null,projectReference:null,changeOrderReference:null,invoiceReference:null,paymentReference:null,collectionReference:null,accountingReference:token(financialSource,reference),recordState:'posted',amountClaim:{status:'recorded',amount,currency:'USD',basis},occurredAt:'2026-09-15T12:00:00.000Z',timeZone:'America/New_York',evidenceClass:'provider_recorded',providerEvidenceDigest:sha('financial-graph-evidence'),sourceUpdatedAt:'2026-09-15T17:00:00.000Z'});
  response=await post(`${financialRoot}/batches`,{schemaVersion:'m25-external-financial-evidence-v1',mode:'historical_backfill',expectedConsentRevision:financialSourceConsent.revision,expectedConsentDigest:financialSourceConsent.digest,cursorBefore:null,cursorAfter:null,complete:true,records:[financialRecord('revenue','revenue','revenue','1000.00'),financialRecord('cost','cost','direct_cost','400.00')],reason:'Import the exact financial outcome evidence.',confirmed:true,confirmationVersion:'m25-external-financial-import-batch-v1'});expect(response.status).toBe(201);
  const financialMatchRoot=`/api/v1/learning/external-business-sources/financial/${financialSource}`;
  for(const reference of['revenue','cost']){
   const state=(await request(f.app).get(`${financialMatchRoot}/matches`).set(owner.session.headers)).body.data;
   const target=state.estimateTargets.find(value=>value.targetId===estimate),source=state.references.find(value=>value.referenceKind==='accounting_entry'&&value.externalReference===token(financialSource,reference));expect(target).toBeTruthy();expect(source).toBeTruthy();
   response=await post(`${financialMatchRoot}/matches`,{action:'link',referenceKind:'accounting_entry',externalReference:token(financialSource,reference),targetKind:'estimate',targetId:estimate,expectedRevision:0,expectedDigest:'none',expectedSourceDigest:source.sourceDigest,expectedTargetDigest:target.digest,reason:'Link the exact financial record to this job.',confirmed:true,confirmationVersion:'m25-external-business-reference-match-v1'});expect(response.status).toBe(201);
  }
  const financialOutcomeRoot=`/api/v1/learning/external-financial-outcome-sources/${financialSource}`;
  response=await post(`${financialOutcomeRoot}/consent`,{action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use reviewed financial evidence for this job.',confirmed:true,confirmationVersion:'m25-external-financial-outcome-consent-v1'});expect(response.status).toBe(201);const financialPurpose=response.body.data.consent;
  response=await post(`${financialOutcomeRoot}/outcomes`,{estimateId:estimate,expectedConsentRevision:financialPurpose.revision,expectedConsentDigest:financialPurpose.digest,reason:'Record the reviewed financial outcome.',confirmed:true,confirmationVersion:'m25-external-financial-outcome-observation-v1'});expect(response.status).toBe(201);const financialObservation=response.body.data.observation;expect(financialObservation.fresh).toBe(true);

  response=await post('/api/v1/learning/job-outcome-graph/consent',{action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Review current project and financial outcomes together.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-consent-v1'});expect(response.status).toBe(201);const graphConsent=response.body.data.consent;
  await expect(f.ownerPool.query("INSERT INTO canonical_job_outcome_graph_consents(organization_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)VALUES($1,2,$2,'grant',$3,$3,$4,'Invalid repeated grant',true,'m25-job-outcome-graph-consent-v1',$5,$6,$7)",[f.org,graphConsent.id,owner.actorUserId,owner.authSessionId,sha('repeated-key'),sha('repeated-request'),sha('repeated-digest')])).rejects.toMatchObject({code:'23514'});
  const graphBody={expectedConsentRevision:graphConsent.revision,expectedConsentDigest:graphConsent.digest,nodes:[{nodeKind:'external_project',observationId:projectObservation.id,locator:{sourceKey:projectSource,projectReference}},{nodeKind:'external_financial',observationId:financialObservation.id,locator:{sourceKey:financialSource}}],reason:'Connect the exact current job outcomes.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-v1'};
  const graphKey=crypto.randomUUID();const concurrent=await Promise.all([post(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`,graphBody,graphKey),post(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`,graphBody,graphKey)]);
  expect(concurrent.map(value=>value.status).sort()).toEqual([200,201]);const graph=concurrent.find(value=>value.status===201).body.data.graph;expect(graph.fresh).toBe(true);expect(graph.domains).toEqual(['financial','scope']);expect(graph.nodes).toHaveLength(2);
  let read=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(owner.session.headers);expect(read.status).toBe(200);expect(read.body.data.current.available).toBe(true);
  const customer=(await f.ownerPool.query('SELECT c.id,c.updated_at::text updated_at FROM canonical_estimates e JOIN canonical_opportunities o ON o.organization_id=e.organization_id AND o.id=e.opportunity_id JOIN canonical_customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id WHERE e.organization_id=$1 AND e.id=$2',[f.org,estimate])).rows[0];
  await f.ownerPool.query("UPDATE canonical_customers SET updated_at=updated_at+interval '1 second' WHERE organization_id=$1 AND id=$2",[f.org,customer.id]);
  read=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(owner.session.headers);expect(read.body.data.current.fresh).toBe(false);expect(read.body.data.current.nodes).toEqual([]);
  await f.ownerPool.query('UPDATE canonical_customers SET updated_at=$3 WHERE organization_id=$1 AND id=$2',[f.org,customer.id,customer.updated_at]);
  read=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(owner.session.headers);expect(read.body.data.current.fresh).toBe(true);
  expect((await post(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`,{...graphBody,nodes:[graphBody.nodes[0],graphBody.nodes[0]]})).status).toBe(400);
  expect((await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(f.actors.member.session.headers)).status).toBe(403);
  const other=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(f.actors.otherOwner.session.headers);expect(other.status).toBe(409);

  response=await post(`${financialOutcomeRoot}/consent`,{action:'revoke',expectedRevision:financialPurpose.revision,expectedDigest:financialPurpose.digest,reason:'Stop using financial outcomes.',confirmed:true,confirmationVersion:'m25-external-financial-outcome-consent-v1'});expect(response.status).toBe(201);const revokedFinancial=response.body.data.consent;
  read=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(owner.session.headers);expect(read.body.data.current.fresh).toBe(false);expect(read.body.data.current.nodes).toEqual([]);
  expect((await post(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`,graphBody,graphKey)).status).toBe(409);
  response=await post(`${financialOutcomeRoot}/consent`,{action:'grant',expectedRevision:revokedFinancial.revision,expectedDigest:revokedFinancial.digest,reason:'Start a new financial outcome period.',confirmed:true,confirmationVersion:'m25-external-financial-outcome-consent-v1'});expect(response.status).toBe(201);
  read=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(owner.session.headers);expect(read.body.data.current.fresh).toBe(false);expect(read.body.data.current.nodes).toEqual([]);

  response=await post('/api/v1/learning/job-outcome-graph/consent',{action:'revoke',expectedRevision:graphConsent.revision,expectedDigest:graphConsent.digest,reason:'Stop reviewing connected job outcomes.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-consent-v1'});expect(response.status).toBe(201);const revokedGraph=response.body.data.consent;
  read=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(owner.session.headers);expect(read.body.data.activeConsent).toBe(false);expect(read.body.data.current).toBeNull();
  response=await post('/api/v1/learning/job-outcome-graph/consent',{action:'grant',expectedRevision:revokedGraph.revision,expectedDigest:revokedGraph.digest,reason:'Start a new job outcome review period.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-consent-v1'});expect(response.status).toBe(201);
  read=await request(f.app).get(`/api/v1/learning/estimates/${estimate}/job-outcome-graph`).set(owner.session.headers);expect(read.body.data.current).toBeNull();expect(read.body.data.total).toBe(0);

  const privilege=(await f.ownerPool.query("SELECT has_table_privilege($1,'canonical_job_outcome_graphs','SELECT,INSERT,UPDATE,DELETE') table_access,has_function_privilege($1,'canonical_job_outcome_graph_resolve_node(uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE') helper,has_function_privilege($1,'canonical_job_outcome_graph_read(uuid,uuid,text,uuid,uuid)','EXECUTE') entry",[f.roles.runtime])).rows[0];expect(privilege).toEqual({table_access:false,helper:false,entry:true});
  await expect(f.runtimePool.query('SELECT * FROM canonical_job_outcome_graphs')).rejects.toMatchObject({code:'42501'});await expect(f.ownerPool.query('DELETE FROM canonical_job_outcome_graphs')).rejects.toBeTruthy();
  const after=(await f.ownerPool.query('SELECT snapshot_digest FROM canonical_estimates WHERE organization_id=$1 AND id=$2',[f.org,estimate])).rows[0].snapshot_digest;expect(after).toBe(before);
 });
});
