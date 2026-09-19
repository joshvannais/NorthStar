'use strict';
const crypto=require('node:crypto');
const contract=require('../../src/learning/jobOutcomeGraphContract');
const repository=require('../../src/learning/jobOutcomeGraphRepository');
const digest='a'.repeat(64),estimateId=crypto.randomUUID();
const nodes=()=>[
 {nodeKind:'external_financial',observationId:crypto.randomUUID(),locator:{sourceKey:'finance.primary'}},
 {nodeKind:'external_project',observationId:crypto.randomUUID(),locator:{sourceKey:'projects.primary',projectReference:'project-ref-1'}},
];
describe('Mission 25 job outcome graph contract',()=>{
 test('accepts exact consent, estimate and bounded cross-source nodes',()=>{
  expect(contract.normalizeConsent({action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Review current job outcomes together.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-consent-v1'}).action).toBe('grant');
  const value=contract.normalizeGraph(estimateId,{expectedConsentRevision:1,expectedConsentDigest:digest,nodes:nodes(),reason:'Connect the exact current job outcomes.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-v1'});
  expect(value.estimateId).toBe(estimateId);expect(value.nodes).toHaveLength(2);
 });
 test('rejects extras, duplicate nodes, raw communication references and missing pins',()=>{
  const valid={expectedConsentRevision:1,expectedConsentDigest:digest,nodes:nodes(),reason:'Connect the exact current job outcomes.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-v1'};
  for(const mutate of[
   x=>{x.extra=true;},x=>{x.expectedConsentDigest='none';},x=>{x.nodes=[x.nodes[0],x.nodes[0]];},
   x=>{x.nodes[0].locator={sourceKey:'Finance Bad'};},x=>{x.confirmed=false;},
  ]){const value=structuredClone(valid);mutate(value);expect(()=>contract.normalizeGraph(estimateId,value)).toThrow('Job outcome review details are invalid.');}
  expect(()=>contract.normalizeGraph(estimateId,{...valid,nodes:[valid.nodes[0],{nodeKind:'external_customer',observationId:crypto.randomUUID(),locator:{crmSourceKey:'crm.primary',communicationSourceKey:'comms.primary',crmEstimateReference:'estimate-ref',communicationEstimateReference:'raw-message-id'}}]})).toThrow();
 });
 test('maps changed, missing and conflict failures to plain messages',async()=>{
  const pool=error=>({connect:async()=>({query:async sql=>{if(sql.startsWith('SELECT public.'))throw error;return{rows:[]};},release(){}})});
  const input={organizationId:'1',actorUserId:'2',actorAccessRole:'owner',authSessionId:'3',csrfToken:'x',idempotencyKey:'1234567890123456',estimateId,expectedConsentRevision:1,expectedConsentDigest:digest,nodes:nodes(),reason:'Connect outcomes.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-v1'};
  await expect(repository.build(pool({code:'40001'}),input)).rejects.toMatchObject({status:409,code:'M25_JOB_OUTCOME_GRAPH_CHANGED'});
  await expect(repository.build(pool({code:'P0002',constraint:'job_outcome_graph_node_unavailable'}),input)).rejects.toMatchObject({status:409,message:'Two or more current outcome sources for this job are required.'});
  await expect(repository.build(pool({code:'23505'}),input)).rejects.toMatchObject({status:409,code:'M25_JOB_OUTCOME_GRAPH_KEY_CONFLICT'});
 });
});
