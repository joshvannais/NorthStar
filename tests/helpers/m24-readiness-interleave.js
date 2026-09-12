'use strict';
const assert=require('node:assert/strict');
const approvals=require('../../src/scheduling/approvalRepository');
const contract=require('../../src/scheduling/approvalContract');
// A deterministic scheduling transaction barrier, not an HTTP retry or fabricated
// event: the existing repository must handle the actual046 committed writer.
async function schedulingInterleave(f,live,appointment,events){
 const before=(await f.ownerPool.query('SELECT revision,rtrim(canonical_digest) digest,appointment_status,target_state,workforce_profile_id,workforce_crew_id,scheduled_start,scheduled_end FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',[f.org,appointment])).rows[0];
 const a=f.actors.owner,body={expectedRevision:Number(before.revision),expectedDigest:before.digest,expectedTimeZone:'UTC',action:before.target_state==='assigned'?(before.scheduled_start?'reschedule':'schedule'):'assign',target:before.target_state==='assigned'?{kind:before.workforce_crew_id?'crew':'profile',id:before.workforce_crew_id||before.workforce_profile_id}:{kind:'profile',id:f.actors.member.actorUserId},scheduledStart:before.target_state==='assigned'?new Date((before.scheduled_start?Date.parse(before.scheduled_start):Date.now()+86400000)+3600000).toISOString():(before.scheduled_start?new Date(before.scheduled_start).toISOString():null),scheduledEnd:before.target_state==='assigned'?new Date((before.scheduled_end?Date.parse(before.scheduled_end):Date.now()+90000000)+3600000).toISOString():(before.scheduled_end?new Date(before.scheduled_end).toISOString():null),appointmentStatus:before.appointment_status,reason:'Review current equipment before assigning this existing work'};
 const input={...a,...contract.normalizeMutationPreview({...a,appointmentId:appointment,body})};
 let barrierUsed=false,rollbacks=0,serializationFailures=0;
 const pool={async connect(){const client=await f.runtimePool.connect();return {release:discard=>client.release(discard),async query(sql,args){
  try{const result=await client.query(sql,args);
   if(sql==='BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE'&&!barrierUsed){barrierUsed=true;await client.query('SELECT txid_current_snapshot()');events.push('Scheduling snapshot established');await live.record('condition');events.push('Actual046 condition committed after scheduling snapshot');}
   if(sql==='ROLLBACK')rollbacks++;
   return result;
  }catch(error){if(error.code==='40001')serializationFailures++;throw error;}
 }};}};
 const initialCount=Number((await f.ownerPool.query('SELECT count(*) FROM canonical_schedule_mutation_previews WHERE organization_id=$1',[f.org])).rows[0].count);
 const result=await approvals.createMutationPreview(pool,input);
 assert.equal(result.status,201);assert.ok(barrierUsed);assert.ok(serializationFailures>=1);assert.ok(rollbacks>=1);
 const afterCount=Number((await f.ownerPool.query('SELECT count(*) FROM canonical_schedule_mutation_previews WHERE organization_id=$1',[f.org])).rows[0].count);assert.equal(afterCount,initialCount+1);
 const after=(await f.ownerPool.query('SELECT revision,rtrim(canonical_digest) digest,appointment_status,target_state,workforce_profile_id,workforce_crew_id,scheduled_start,scheduled_end FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',[f.org,appointment])).rows[0];assert.deepEqual(after,before);
 return {serializationFailures,rollbacks,previewsCommitted:1,assignmentUnchanged:true};
}
module.exports={schedulingInterleave};
