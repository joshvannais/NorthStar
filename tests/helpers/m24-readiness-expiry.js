'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EquipmentRepository}=require('../../src/equipment/repository');
async function receiptWaitExpiry(f,live,recorded=null){
 const key=recorded?.key||crypto.randomUUID(),body=recorded?.input||live.body('condition'),a=live.actor;
 const original=(await f.ownerPool.query('SELECT access_expires_at FROM auth_sessions WHERE id=$1',[a.sessionId])).rows[0].access_expires_at;
 const before=(await f.ownerPool.query('SELECT revision,digest FROM canonical_equipment_ledgers WHERE organization_id=$1 AND asset_id=$2',[f.org,live.asset.id])).rows;
 const receiptCount=Number((await f.ownerPool.query('SELECT count(*) FROM canonical_equipment_receipts WHERE organization_id=$1',[f.org])).rows[0].count);
 const blocker=await f.ownerPool.connect();let pending,pid,observed=false;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[f.org+a.userId+a.sessionId+crypto.createHash('sha256').update(key).digest('hex')]);
  const expires=(await f.ownerPool.query("UPDATE auth_sessions SET access_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1 RETURNING access_expires_at",[a.sessionId])).rows[0].access_expires_at;
  const pool={async connect(){const c=await f.runtimePool.connect();pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;return c;}};
  pending=new EquipmentRepository(pool).mutate(a,live.work.execution.id,key,body,true).then(value=>({value}),error=>({error}));
  const deadline=Date.now()+1600;
  while(Date.now()<deadline){if(pid){const q=await f.ownerPool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) blocked",[pid]);if(q.rows[0].blocked){observed=true;break;}}await new Promise(r=>setTimeout(r,10));}
  assert.ok(observed,'Actual046 writer must be observed waiting on the held receipt key');
  const remaining=new Date(expires).getTime()-Date.now()+30;if(remaining>0)await new Promise(r=>setTimeout(r,remaining));
  await blocker.query('COMMIT');const outcome=await pending;assert.equal(outcome.error?.status,403,'Expired actor must not receive a new event or historical replay');
  assert.deepEqual((await f.ownerPool.query('SELECT revision,digest FROM canonical_equipment_ledgers WHERE organization_id=$1 AND asset_id=$2',[f.org,live.asset.id])).rows,before);
  assert.equal(Number((await f.ownerPool.query('SELECT count(*) FROM canonical_equipment_receipts WHERE organization_id=$1',[f.org])).rows[0].count),receiptCount);
  return {kind:recorded?'historical replay':'new event',receiptWaitObserved:observed,status:403,ledgerAndReceiptsUnchanged:true};
 }finally{await blocker.query('ROLLBACK');if(pending)await pending;await f.ownerPool.query('UPDATE auth_sessions SET access_expires_at=$2 WHERE id=$1',[a.sessionId,original]);blocker.release();}
}
async function schedulingFenceExpiry(f,live,appointment,mode){
 const actor=f.actors.owner,contract=require('../../src/scheduling/approvalContract'),repo=require('../../src/scheduling/approvalRepository');
 const assignment=(await f.ownerPool.query('SELECT * FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',[f.org,appointment])).rows[0];
 const body={expectedRevision:Number(assignment.revision),expectedDigest:assignment.canonical_digest.trim(),expectedTimeZone:'UTC',action:'assign',target:{kind:'profile',id:f.actors.member.actorUserId},scheduledStart:assignment.scheduled_start?.toISOString()||null,scheduledEnd:assignment.scheduled_end?.toISOString()||null,appointmentStatus:assignment.appointment_status,reason:'Review the current equipment arrangement'};
 let input={...actor,...contract.normalizeMutationPreview({...actor,appointmentId:appointment,body})};
 if(mode==='approval'){const p=(await repo.createMutationPreview(f.runtimePool,input)).body.data;input={...actor,...contract.normalizeMutationApproval({...actor,appointmentId:appointment,idempotencyKey:crypto.randomUUID(),body:{previewId:p.id,previewDigest:p.previewDigest,acknowledgedWarningDigests:p.warningDigests,acknowledgedReviewReasonDigests:p.reviewReasonDigests,reason:body.reason}})};}
 const original=(await f.ownerPool.query('SELECT access_expires_at FROM auth_sessions WHERE id=$1',[actor.authSessionId])).rows[0].access_expires_at;
 const query='SELECT (SELECT jsonb_agg(to_jsonb(a)) FROM canonical_schedule_assignments a) assignments,(SELECT jsonb_agg(to_jsonb(p)) FROM canonical_schedule_mutation_previews p) previews,(SELECT jsonb_agg(to_jsonb(r)) FROM canonical_schedule_human_idempotency r) receipts,(SELECT jsonb_agg(to_jsonb(f)) FROM canonical_equipment_readiness_fences f) fences',before=JSON.stringify((await f.ownerPool.query(query)).rows);
 const blocker=await f.ownerPool.connect();let pending,pid,observed=false;try{
 await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[f.org+':equipment:'+live.asset.id]);const expires=(await f.ownerPool.query("UPDATE auth_sessions SET access_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1 RETURNING access_expires_at",[actor.authSessionId])).rows[0].access_expires_at;
 const pool={async connect(){const c=await f.runtimePool.connect();pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;return c;}};pending=(mode==='approval'?repo.approveMutation(pool,input):repo.createMutationPreview(pool,input)).then(value=>({value}),error=>({error}));
 const deadline=Date.now()+1600;while(Date.now()<deadline){if(pid&&(await f.ownerPool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) blocked",[pid])).rows[0].blocked){observed=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(observed,'Scheduling transaction reaches the held equipment fence');const remaining=new Date(expires).getTime()-Date.now()+30;if(remaining>0)await new Promise(r=>setTimeout(r,remaining));await blocker.query('COMMIT');const result=await pending;assert.equal(result.error?.status,403);assert.equal(JSON.stringify((await f.ownerPool.query(query)).rows),before);return{mode,equipmentWaitObserved:true,status:403,previewAssignmentReceiptFenceUnchanged:true};
 }finally{await blocker.query('ROLLBACK');if(pending)await pending;await f.ownerPool.query('UPDATE auth_sessions SET access_expires_at=$2 WHERE id=$1',[actor.authSessionId,original]);blocker.release();}
}
module.exports={receiptWaitExpiry,schedulingFenceExpiry};
