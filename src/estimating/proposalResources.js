'use strict';
const {evaluateConflictEvidence}=require('../scheduling/conflictEvaluator');
const {sha256}=require('../services/businessProfileAdapter');
function assess(candidate,target,serviceKey,skillAuthorityKnown){
 const result=evaluateConflictEvidence({proposal:{target:{kind:target.kind,id:target.id},scheduledStart:null,scheduledEnd:null,timeZone:'UTC'},candidate,appointment:{serviceId:serviceKey,locationId:null},businessProfile:{},skillAuthorityKnown,schedules:[],scheduleSetTruncated:true,workloadSchedules:[],workloadSetTruncated:true});
 return{id:target.id,kind:target.kind,label:target.label,status:result.hardConflicts.length?'blocked':'needs_review',availability:'unknown',reasons:result.hardConflicts.length?['This resource does not meet the current recorded requirements.']:['Confirm the job time, location and current availability.'],evidenceDigest:sha256({candidate,serviceKey,skillAuthorityKnown})};
}
async function paid(client,input,serviceKey){
 const directory=require('../scheduling/operatorDirectory'),repository=require('../scheduling/conflictRepository');
 const page=await directory.loadSchedulingOperatorTargetPageFromSnapshot(client,{...input,query:'',cursor:null});
 if(!page.canRead)throw Object.assign(new Error('Your current account cannot review these resources.'),{status:403});
 const known=(await client.query('SELECT COUNT(*)::int count FROM public.workforce_skills WHERE organization_id=$1 AND lower(service_id)=lower($2)',[input.organizationId,serviceKey])).rows[0].count>0;
 const assignment=input.appointmentId?(await client.query('SELECT to_jsonb(a) value FROM public.canonical_schedule_assignments a WHERE organization_id=$1 AND appointment_id=$2',[input.organizationId,input.appointmentId])).rows[0]?.value:null;
 const profile=assignment?await require('../services/organizationAuthority').getActiveBusinessProfile(client,input.organizationId):null;
 const zone=profile?.rawProfile?.company?.timeZone;
 const workers=[];for(const target of page.targets.slice(0,12)){
  if(assignment?.scheduled_start&&assignment?.scheduled_end&&zone){
   const result=(await repository.evaluateInTransaction(client,{...input,expectedRevision:Number(assignment.revision),expectedDigest:assignment.canonical_digest.trim(),expectedTimeZone:zone,proposal:{target:{kind:target.kind,id:target.id},scheduledStart:assignment.scheduled_start,scheduledEnd:assignment.scheduled_end,timeZone:zone}})).data;
   workers.push({id:target.id,kind:target.kind,label:target.label,status:result.hardConflicts.length?'blocked':result.needsReview?'needs_review':'eligible_for_review',availability:result.needsReview?'needs_review':'reviewed_for_recorded_time',reasons:result.hardConflicts.length?['This resource conflicts with the current job requirements or schedule.']:['Review this resource for the recorded job time. No assignment has been made.'],evidenceDigest:result.digest});
  }else{const proposal={target:{kind:target.kind,id:target.id}},candidate=await repository.attachSkillsAndAvailability(client,input.organizationId,await repository.candidateEvidence(client,{...input,proposal}));workers.push(assess(candidate,target,serviceKey,known));}
 }
 return{workers,truncated:page.targets.length>12||page.page.truncated,digest:sha256({page:page.digest,workers})};
}
function demo(state,serviceKey,workspace=null,estimateId=null,now=new Date()){
 const workforce=require('../commandCenter/demoWorkforce'),basis=workforce.read(state),targets=workforce.targets(basis),scheduling=require('../commandCenter/demoScheduling');
 const graph=workspace?.graphs.find(g=>g.ids.estimate===estimateId),authority=graph?scheduling.current(workspace,state,graph):null;
 const workers=targets.slice(0,12).map(target=>{
  if(authority?.scheduledStart&&authority?.scheduledEnd){
   const proposal={target:{kind:target.kind,id:target.id},scheduledStart:authority.scheduledStart,scheduledEnd:authority.scheduledEnd,timeZone:workspace.configuration.businessProfile.timeZone},result=scheduling.evidence(workspace,proposal,state,graph,now).conflicts;
   return{id:target.id,kind:target.kind,label:target.label,status:result.hardConflicts.length?'blocked':result.needsReview?'needs_review':'eligible_for_review',availability:result.needsReview?'needs_review':'reviewed_for_recorded_time',reasons:result.hardConflicts.length?['This resource conflicts with the current job requirements or schedule.']:['Review this resource for the recorded job time. No assignment has been made.'],evidenceDigest:sha256({authority,result,basis:basis?.digest||null})};
  }
  return assess(workforce.candidate(basis,target),target,serviceKey,Boolean(basis?.serviceKeys.includes(serviceKey)));
 });
 return{workers,truncated:targets.length>12,digest:sha256({basis:basis?.digest||null,workers})};
}
module.exports={paid,demo,assess};
