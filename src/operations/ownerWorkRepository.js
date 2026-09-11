'use strict';
const { scheduleAuthority } = require('../scheduling/repository');
const { projectSubscription, canMutateInternal } = require('../accounts/subscriptionPolicy');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }

// New owner presentation adapter only. Existing paid authority routines, row
// loaders, normalizers and write endpoints remain the source of permission.
async function readOwnerWork(pool, actor, appointmentId) {
  if (!['owner','admin'].includes(actor.actorAccessRole)) fail(403,'Owner work controls are unavailable for this role.');
  const client=await pool.connect();let authorityLocked=false,workIdentity=null,discard=false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");await client.query("SET LOCAL lock_timeout='2s'");
    await client.query('SELECT pg_advisory_xact_lock_shared(230004,4)');
    const args=[actor.organizationId,actor.actorUserId,actor.actorAccessRole,actor.authSessionId];
    let cursor=null,found=null;
    for(let page=0;page<10;page++) {
      const overview=(await client.query("SELECT public.canonical_operational_overview_read($1,$2,$3,$4,'all',100,$5::jsonb) value",[...args,cursor])).rows[0].value;
      if(!overview || overview.scope!=='owner_admin')fail(403,'Owner work controls are unavailable.');
      found=overview.records.find(r=>r.appointmentId===appointmentId)||null;
      if(found||overview.pagination.nextCursor===null)break;
      const decoded=require('./overviewContract').normalizeOverviewRead({state:'all',limit:'100',cursor:overview.pagination.nextCursor});cursor=decoded.cursor;
      if(page===9)fail(503,'The work list could not be fully checked. Refresh before continuing.');
    }
    let execution=null,progress=[],field=[],completion=null;
    if(found) {
      // Discovery contributes only an identity. Protected reads below recheck
      // current actor/session/source in their own coherent snapshot and keep
      // their existing SHARE locks. No previous overview fields are returned.
      await client.query('COMMIT');
      await client.query("SET statement_timeout='5s'");await client.query("SET lock_timeout='2s'");
      await client.query('SELECT pg_advisory_lock_shared(230004,4)');authorityLocked=true;
      const identity=actor.organizationId+':'+found.executionId;
      await client.query('SELECT pg_advisory_lock_shared(230007,hashtext($1))',[identity]);workIdentity=identity;
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL statement_timeout='5s'");await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
      completion=(await client.query('SELECT public.canonical_completion_read($1,$2,$3,$4,$5) value',[...args,found.executionId])).rows[0].value.data;
      execution=completion.execution;
      if(!execution||execution.id!==found.executionId||execution.appointmentId!==appointmentId)fail(409,'The selected work changed. Refresh before continuing.');
    }
    const query=await client.query(`SELECT a.*,o.job_scope,o.service_type,
      b.id profile_id,b.version_number profile_version,rtrim(b.normalized_profile_hash) profile_hash,b.raw_profile#>>'{company,timeZone}' time_zone,
      onboarding.status onboarding_status,s.status subscription_status,s.trial_started_at,s.trial_ends_at,clock_timestamp() server_now
      FROM canonical_schedule_assignments a
      JOIN canonical_appointments appointment ON appointment.organization_id=a.organization_id AND appointment.id=a.appointment_id AND appointment.operation_id=a.operation_id AND appointment.graph_id=a.graph_id AND appointment.opportunity_id=a.opportunity_id
      JOIN canonical_opportunities o ON o.organization_id=a.organization_id AND o.id=a.opportunity_id AND o.operation_id=a.operation_id AND o.graph_id=a.graph_id
      JOIN canonical_transcripts t ON t.organization_id=a.organization_id AND t.operation_id=a.operation_id AND t.graph_id=a.graph_id
      JOIN canonical_business_profiles b ON b.organization_id=a.organization_id AND b.is_active
      JOIN organization_onboarding onboarding ON onboarding.organization_id=a.organization_id
      LEFT JOIN subscriptions s ON s.organization_id=a.organization_id
      WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.appointment_id=$2) AND lower(btrim(t.source)) IN ('lead','retell','voice')
      ORDER BY a.appointment_id LIMIT 251`,[actor.organizationId,appointmentId||null]);
    if(!appointmentId) {
      if(query.rows.length>250)fail(503,'The job list is too large to show here. Open the exact job from its work details.');
      await client.query('COMMIT');return{version:'owner-work-selection-v1',authority:'postgresql',records:query.rows.map(r=>({appointmentId:r.appointment_id,title:r.job_scope?.jobTitle||r.service_type||'Service appointment'}))};
    }
    if(query.rowCount!==1)fail(404,'That job is unavailable for owner work review.');
    const row=query.rows[0],assignment=scheduleAuthority({...row,assignment_id:row.id});
    if(found) {
      if(execution.assignmentId!==row.id)fail(409,'The selected assignment changed. Refresh before continuing.');
      // Bounded complete reads: never silently treat a truncated result as an
      // empty/current evidence set or offer predecessor controls over it.
      for(const [name,target] of [['canonical_progress_read','progress'],['canonical_field_evidence_read','field']]) {
        const result=(await client.query(`SELECT public.${name}($1,$2,$3,$4,$5,200,NULL,NULL,NULL) value`,[...args,found.executionId])).rows[0].value.body;
        if(result.truncated)fail(503,'This work has more records than this view can show. Use the existing detailed record views.');
        if(target==='progress')progress=result.data;else field=result.data;
      }
    }
    const people=(await client.query(`SELECT p.id,u.name FROM workforce_profiles p
      JOIN organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
      JOIN users u ON u.organization_id=m.organization_id AND u.id=m.user_id
      WHERE p.organization_id=$1 AND m.status='active' AND u.status='active' AND
      (p.id=$2::uuid OR EXISTS(SELECT 1 FROM workforce_crew_members cm WHERE cm.organization_id=p.organization_id AND cm.profile_id=p.id AND cm.crew_id=$3::uuid))
      ORDER BY p.id LIMIT 101`,[actor.organizationId,assignment.workforceProfileId,assignment.workforceCrewId])).rows;
    if(people.length>100)fail(503,'The assigned team could not be fully loaded.');
    const available=row.onboarding_status==='complete'&&canMutateInternal(projectSubscription(row))&&assignment.targetState==='assigned'&&assignment.dispatchState==='dispatched'&&assignment.scheduleState==='scheduled'&&!['completed','cancelled'].includes(assignment.appointmentStatus);
    const state=execution?.lifecycleState;
    const actions=!available?[]:!execution?['initialize']:state==='not_started'?['start']:state==='in_progress'?['pause']:state==='paused'?['resume']:[];
    if(available&&['in_progress','paused'].includes(state)&&!assignment.needsReview)actions.push('progress','evidence');
    if(available&&['in_progress','paused','reopened'].includes(state))actions.push('propose_completion');
    if(available&&state==='completion_pending')actions.push('withdraw_completion');
    const result={version:'owner-work-detail-v1',authority:'postgresql',simulated:false,appointmentId,title:row.job_scope?.jobTitle||row.service_type||'Service appointment',
      assignment,execution,progress,field,completion,gates:completion?.activeProposal?.gateSnapshot||null,
      timeZoneAuthority:{businessProfileId:row.profile_id,version:Number(row.profile_version),hash:row.profile_hash,timeZone:row.time_zone},
      performers:people,allowedActions:actions,unavailable:available?null:'Work changes require current account access and a scheduled, assigned, dispatched job.',evaluatedAt:new Date(row.server_now).toISOString(),
      evidenceLimit:'Recorded progress does not approve completion. Supporting evidence is checked again when completion is proposed and approved.'};
    await client.query('COMMIT');return result;
  } catch(error) {await client.query('ROLLBACK').catch(()=>{discard=true;});
    if(error.code==='42501')fail(403,'Your current access does not allow this work review.');
    if(['40001','40P01'].includes(error.code))fail(409,'The work changed. Refresh before continuing.');throw error;} finally {
    if(workIdentity)await client.query('SELECT pg_advisory_unlock_shared(230007,hashtext($1))',[workIdentity]).catch(()=>{discard=true;});
    if(authorityLocked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});
    await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);
  }
}
module.exports={readOwnerWork};
