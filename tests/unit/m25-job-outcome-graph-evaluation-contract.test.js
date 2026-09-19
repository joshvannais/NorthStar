'use strict';
const crypto=require('node:crypto');
const contract=require('../../src/learning/jobOutcomeGraphEvaluationContract');
const repository=require('../../src/learning/jobOutcomeGraphEvaluationRepository');
const estimateId=crypto.randomUUID(),digest='a'.repeat(64);
const valid=()=>({expectedGraphRevision:1,expectedGraphDigest:digest,requiredDomains:['scope','financial'],reason:'Review current evidence coverage.',confirmed:true,confirmationVersion:'m25-job-outcome-graph-evaluation-v1'});
describe('Mission 25 Part 13B evaluation contract',()=>{
 test('normalizes a bounded explicit required-domain set',()=>{const value=contract.normalizeEvaluation(estimateId,valid());expect(value.requiredDomains).toEqual(['financial','scope']);expect(value.estimateId).toBe(estimateId);});
 test('rejects inferred, duplicate, extra and unsupported requirements',()=>{for(const mutate of[x=>{x.requiredDomains=[];},x=>{x.requiredDomains=['scope','scope'];},x=>{x.requiredDomains=['pricing'];},x=>{x.extra=true;},x=>{x.confirmed=false;}]){const value=valid();mutate(value);expect(()=>contract.normalizeEvaluation(estimateId,value)).toThrow('Job outcome evidence review details are invalid.');}});
 test('maps changed, missing, conflict and restricted states to plain messages',async()=>{const pool=error=>({connect:async()=>({query:async sql=>{if(sql.startsWith('SELECT public.'))throw error;return{rows:[]};},release(){}})});const input={organizationId:'1',actorUserId:'2',actorAccessRole:'owner',authSessionId:'3',csrfToken:'x',idempotencyKey:'1234567890123456',estimateId,...valid()};await expect(repository.build(pool({code:'40001'}),input)).rejects.toMatchObject({status:409,code:'M25_JOB_OUTCOME_EVALUATION_CHANGED'});await expect(repository.build(pool({code:'P0002',constraint:'job_outcome_evaluation_graph_unavailable'}),input)).rejects.toMatchObject({status:409,message:'A current connected job outcome graph is required.'});await expect(repository.build(pool({code:'23505'}),input)).rejects.toMatchObject({status:409,code:'M25_JOB_OUTCOME_EVALUATION_KEY_CONFLICT'});await expect(repository.build(pool({code:'42501'}),input)).rejects.toMatchObject({status:403});});
});
