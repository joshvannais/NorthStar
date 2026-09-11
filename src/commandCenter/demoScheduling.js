'use strict';
const {v5:uuid}=require('uuid');
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const {normalizeMutationPreview,normalizeMutationApproval}=require('../scheduling/approvalContract');
const {evaluateConflictEvidence}=require('../scheduling/conflictEvaluator');
const {evaluateRecommendationCandidates}=require('../scheduling/routeRecommendationEvaluator');
const policy=require('./demoSchedulingPolicy');
const {classifyRecord}=require('../scheduling/overviewRepository');
const NS='f38b8f66-4367-40f4-a197-87eb7ec49562';
const VERSION='demo-schedule-times-v1';
const workforce=require('./demoWorkforce');
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
function ledger(state){return state.demoScheduling||{version:VERSION,previews:[],history:[]};}
function validateState(state){
 workforce.read(state);
 const value=ledger(state);if(value.version!==VERSION||!Array.isArray(value.previews)||!Array.isArray(value.history)||value.previews.length+value.history.length>24||Buffer.byteLength(JSON.stringify(value))>262144)fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');
 const ids=new Set(state.graphs.map(g=>g.ids.appointment||g.ids.work));const keys=new Set();
 for(const item of [...value.previews,...value.history]){
  if(!item||!ids.has(item.appointmentId)||typeof item.requestKey!=='string'||keys.has(item.requestKey)||!item.response||item.generation!==state.generation)fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');keys.add(item.requestKey);
  const unsigned={...item};delete unsigned.digest;if(sha256(unsigned)!==item.digest)fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');
 }
 const revisions=new Map(),prior=new Map();
 for(const item of value.history.slice().reverse()){
  const authority=item.response.scheduleAuthority,expected=(revisions.get(item.appointmentId)||1)+1;
  if(!authority||authority.appointmentId!==item.appointmentId||authority.revision!==expected||!['unassigned','assigned'].includes(authority.targetState)||!['unscheduled','scheduled'].includes(authority.scheduleState)||!['not_dispatched','dispatched','revoked'].includes(authority.dispatchState)||(authority.scheduleState==='scheduled'?(!Number.isFinite(Date.parse(authority.scheduledStart))||!Number.isFinite(Date.parse(authority.scheduledEnd))||Date.parse(authority.scheduledEnd)<=Date.parse(authority.scheduledStart)):(authority.scheduledStart!==null||authority.scheduledEnd!==null))||(authority.targetState==='unassigned'?(authority.workforceProfileId!==null||authority.workforceCrewId!==null):Boolean(authority.workforceProfileId)===Boolean(authority.workforceCrewId)))fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');
  const previous=prior.get(item.appointmentId);
  if(['assign','reassign','unassign'].includes(authority.lastAction)){
   if((previous&&(previous.scheduleState!==authority.scheduleState||previous.scheduledStart!==authority.scheduledStart||previous.scheduledEnd!==authority.scheduledEnd))||(!previous&&authority.scheduleState!=='unscheduled')||(authority.lastAction==='assign'&&previous&&previous.targetState!=='unassigned')||(authority.lastAction==='reassign'&&(!previous||previous.targetState!=='assigned'||sha256(targetFor(previous))===sha256(targetFor(authority))))||(authority.lastAction==='unassign'&&(!previous||previous.targetState!=='assigned'||authority.targetState!=='unassigned')))fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved team changes could not be read.');
  }
  const action=authority.lastAction;
  const expectedDispatch=action==='dispatch'?'dispatched':previous&&previous.dispatchState==='dispatched'&&['reassign','unassign','reschedule'].includes(action)?'revoked':previous?previous.dispatchState:'not_dispatched';
  if(!['assign','reassign','unassign','schedule','reschedule','dispatch'].includes(action)||authority.dispatchState!==expectedDispatch)fail(503,'DEMO_DISPATCH_HISTORY_INVALID','Saved dispatch history could not be read.');
  if(action==='dispatch'&&(!previous||previous.targetState!=='assigned'||previous.scheduleState!=='scheduled'||previous.dispatchState==='dispatched'||['completed','cancelled'].includes(previous.appointmentStatus)||sha256(targetFor(previous))!==sha256(targetFor(authority))||previous.scheduledStart!==authority.scheduledStart||previous.scheduledEnd!==authority.scheduledEnd||previous.appointmentStatus!==authority.appointmentStatus))fail(503,'DEMO_DISPATCH_HISTORY_INVALID','Saved dispatch history could not be read.');
  if(action==='reschedule'&&previous&&previous.scheduledStart===authority.scheduledStart&&previous.scheduledEnd===authority.scheduledEnd&&previous.dispatchState==='dispatched')fail(503,'DEMO_DISPATCH_HISTORY_INVALID','Saved dispatch history could not be read.');
  prior.set(item.appointmentId,authority);
  const unsigned={...authority};delete unsigned.digest;if(sha256(unsigned)!==authority.digest)fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');revisions.set(item.appointmentId,expected);
 }
 return value;
}
function seal(value){return stableValue({...value,digest:sha256(value)});}
function current(workspace,state,graph){
 const appointmentId=graph.ids.appointment||graph.ids.work,entry=ledger(state).history.find(h=>h.appointmentId===appointmentId);
 if(entry)return entry.response.scheduleAuthority;
 const originalStatus=graph.work.originalStatus||graph.work.status||null;
 const appointmentStatus=['preferred','scheduled','cancelled','completed'].includes(originalStatus)?originalStatus:'preferred';
 const value={id:uuid(workspace.session.id+':'+appointmentId,NS),appointmentId,operationId:graph.ids.operation,graphId:graph.ids.graph,opportunityId:graph.ids.opportunity||graph.ids.lead,targetState:'unassigned',workforceProfileId:null,workforceCrewId:null,scheduleState:'unscheduled',dispatchState:'not_dispatched',scheduledStart:null,scheduledEnd:null,appointmentStatus,originalStatus,needsReview:true,reviewReasons:[{code:'target_unassigned'},{code:'schedule_incomplete'}],revision:1,lastAction:null,lastReason:null,updatedAt:state.createdAt};
 return seal(value);
}
function targetFor(authority){return authority.targetState==='unassigned'?{kind:'unassigned',id:null}:{kind:authority.workforceProfileId?'profile':'crew',id:authority.workforceProfileId||authority.workforceCrewId};}
function evidence(workspace,proposal,state,graph){
 const v=workforce.read(state),candidate=workforce.candidate(v,proposal.target);
 const basis=require('./demoOperationsBasis').read(state),jobBasis=basis?.appointments.find(a=>a.appointmentId===(graph.ids.appointment||graph.ids.work));
 const profile=jobBasis?{...workspace.configuration.businessProfile,hours:basis.hours}:workspace.configuration.businessProfile;
 const schedules=workspace.graphs.filter(g=>g.ids.graph!==graph.ids.graph).map(g=>current(workspace,state,g)).filter(a=>a.scheduleState==='scheduled'&&a.targetState==='assigned').map(a=>({assignmentId:a.id,profileIds:(workforce.candidate(v,targetFor(a))||{members:[]}).members.map(m=>m.profileId),scheduledStart:a.scheduledStart,scheduledEnd:a.scheduledEnd,approved:true}));
 const appointment={serviceId:graph.work.serviceType||graph.polaris.snapshot.service.key,locationId:null};
 // Job location scope is not inferred from its postal address.
 const scope=graph.lead&&graph.lead.scope||graph.work.scope||{};if(typeof scope.locationId==='string')appointment.locationId=scope.locationId;
 if(jobBasis)appointment.locationId=jobBasis.locationId;
 function evaluate(c){return proposal.scheduledStart===null?{status:'needs_review',hardConflicts:[],warnings:[],needsReview:true,reviewReasons:[{code:'appointment_schedule_unavailable'}]}:evaluateConflictEvidence({proposal:{...proposal,target:c?{kind:c.kind,id:c.targetId}:proposal.target},candidate:c,appointment,businessProfile:profile,skillAuthorityKnown:Boolean(v&&v.serviceKeys.includes(appointment.serviceId)),schedules,scheduleSetTruncated:false,workloadSchedules:schedules,workloadSetTruncated:false});}
 const conflicts=evaluate(candidate);
 const recommendation=evaluateRecommendationCandidates({candidates:workforce.targets(v).map(t=>({kind:t.kind,id:t.id,label:t.label,homeLocationId:'headquarters',authority:{simulated:true,evidenceDigest:v.digest},conflicts:evaluate(workforce.candidate(v,t))})),businessProfile:workspace.configuration.businessProfile,destinationLocationId:appointment.locationId,globalEvidenceIncomplete:!v,candidateSetTruncated:false});
 return {conflicts,recommendation};
}
function projection(workspace,state){
 validateState(state);
 const records=workspace.graphs.map(graph=>{
  const authority=current(workspace,state,graph),closed=['completed','cancelled'].includes(authority.appointmentStatus);
  const proposal={target:targetFor(authority),scheduledStart:authority.scheduledStart,scheduledEnd:authority.scheduledEnd,timeZone:workspace.configuration.businessProfile.timeZone};
  const conflict=evidence(workspace,proposal,state,graph).conflicts;
  return {appointmentId:authority.appointmentId,graphId:graph.ids.graph,customer:{id:graph.ids.customer,name:graph.customer.name},work:{opportunityId:authority.opportunityId,title:graph.work.title||graph.polaris.snapshot.service.label,serviceType:graph.polaris.snapshot.service.key,appointmentStatus:authority.appointmentStatus},authority,conflict:{...conflict,digest:sha256(conflict),persisted:false,grantsMutation:false},flags:classifyRecord({appointment:{scheduleAuthority:authority}},conflict,new Date()),allowedActions:policy.mutationsEnabled&&!closed?[authority.scheduleState==='scheduled'?'reschedule':'schedule',...(workforce.read(state)?(authority.targetState==='unassigned'?['assign']:['reassign','unassign']):[]),...(workforce.read(state)&&authority.targetState==='assigned'&&authority.scheduleState==='scheduled'&&authority.dispatchState!=='dispatched'?['dispatch']:[])]:[],demoWorkspaceRevision:workspace.integrity.revision};
 });
 const v=workforce.read(state),targets=workforce.targets(v),firstPage=workforce.page(v,workspace.tenant.id,{});
 const operator={canRead:true,canMutate:policy.mutationsEnabled,simulated:true,reason:policy.mutationsEnabled?(v?'demo_assignment':'demo_time_only'):'demo_schedule_paused',targets:targets.slice(0,100),truncated:targets.length>100,discovery:v?{version:firstPage.version,endpoint:'/api/v1/canonical/operator-targets',pageSize:25,shown:Math.min(targets.length,100),total:targets.length,truncated:targets.length>100}:null,workforceAvailable:Boolean(v),demoWorkspaceRevision:workspace.integrity.revision};
 const overview={version:'m22-part5-overview-v1',timeZone:workspace.configuration.businessProfile.timeZone,total:records.length,shown:records.length,truncated:false,page:{size:15,cursor:null,nextCursor:null,hasPrevious:false,hasNext:false,shown:records.length,total:records.length},records,categories:{unassigned:records.map(r=>r.appointmentId),due:[],overdue:[],atRisk:records.map(r=>r.appointmentId),conflicting:[]},counts:{unassigned:records.length,due:0,overdue:0,atRisk:records.length,conflicting:0},simulated:true};
 for(const category of Object.keys(overview.categories)){overview.categories[category]=records.filter(r=>r.flags[category]).map(r=>r.appointmentId);overview.counts[category]=overview.categories[category].length;}
 return {schedulingOperator:{...operator,digest:sha256(operator)},schedulingOverview:{...overview,digest:sha256(overview)}};
}
function recordFor(workspace,state,id){const g=workspace.graphs.find(g=>(g.ids.appointment||g.ids.work)===id);if(!g)fail(404,'DEMO_SCHEDULE_NOT_FOUND','That demo appointment is unavailable.');return{graph:g,authority:current(workspace,state,g)};}
function context(workspace,id,body,key){return{appointmentId:id,organizationId:workspace.tenant.id,actorUserId:workspace.viewer.id,authSessionId:workspace.session.id,body,idempotencyKey:key};}
function preview(workspace,state,input,now){
 const {authority,graph}=recordFor(workspace,state,input.appointmentId),normalized=normalizeMutationPreview(context(workspace,input.appointmentId,input.scheduleBody,input.idempotencyKey));
 const assignment=['assign','reassign','unassign'].includes(normalized.action),oldTarget=targetFor(authority);
 if(!['schedule','reschedule','assign','reassign','unassign','dispatch'].includes(normalized.action)||normalized.appointmentStatus!==authority.appointmentStatus||['completed','cancelled'].includes(authority.appointmentStatus))fail(400,'DEMO_SCHEDULE_ACTION_UNSUPPORTED','Choose a supported change for this appointment.');
 if(normalized.expectedRevision!==authority.revision||normalized.expectedDigest!==authority.digest||normalized.expectedTimeZone!==workspace.configuration.businessProfile.timeZone)fail(409,'DEMO_SCHEDULE_STALE','The schedule changed. Refresh and review again.');
 if(assignment){
  if(!workforce.read(state))fail(400,'DEMO_WORKFORCE_MISSING','This older demo has no saved team details. Reset starts a new demo and clears its current changes.');
  if(normalized.scheduledStart!==authority.scheduledStart||normalized.scheduledEnd!==authority.scheduledEnd)fail(400,'DEMO_ASSIGNMENT_TIMES_CHANGED','Keep the existing times when changing the team.');
  if((normalized.action==='assign'&&(authority.targetState!=='unassigned'||normalized.target.kind==='unassigned'))||(normalized.action==='reassign'&&(authority.targetState!=='assigned'||normalized.target.kind==='unassigned'||sha256(normalized.target)===sha256(oldTarget)))||(normalized.action==='unassign'&&(authority.targetState!=='assigned'||normalized.target.kind!=='unassigned')))fail(400,'DEMO_ASSIGNMENT_TRANSITION','Choose a different available worker or crew.');
 }else if(normalized.action==='dispatch'){
  if(!workforce.read(state)||authority.targetState!=='assigned'||authority.scheduleState!=='scheduled'||authority.dispatchState==='dispatched'||sha256(normalized.target)!==sha256(oldTarget)||normalized.scheduledStart!==authority.scheduledStart||normalized.scheduledEnd!==authority.scheduledEnd)fail(400,'DEMO_DISPATCH_TRANSITION','Dispatch requires the current assigned team and saved appointment times.');
 }else if(normalized.action!==(authority.scheduleState==='scheduled'?'reschedule':'schedule')||!normalized.scheduledStart||!normalized.scheduledEnd||sha256(normalized.target)!==sha256(oldTarget))fail(400,'DEMO_SCHEDULE_ACTION_UNSUPPORTED','Enter both times and keep the current team.');
 if(normalized.action==='reschedule'&&normalized.scheduledStart===authority.scheduledStart&&normalized.scheduledEnd===authority.scheduledEnd)fail(400,'DEMO_SCHEDULE_UNCHANGED','Enter a different start or end time before reviewing a change.');
 if(normalized.target.kind!=='unassigned'&&!workforce.candidate(workforce.read(state),normalized.target))fail(400,'DEMO_TARGET_UNAVAILABLE','That worker or crew is unavailable.');
 const evaluation=evidence(workspace,normalized.proposal,state,graph),id=uuid(workspace.session.id+':preview:'+input.idempotencyHash,NS);
 const response={id,action:normalized.action,proposal:{...normalized.proposal,scheduleState:normalized.scheduledStart?'scheduled':'unscheduled',dispatchState:normalized.action==='dispatch'?'dispatched':authority.dispatchState==='dispatched'&&['reassign','unassign','reschedule'].includes(normalized.action)?'revoked':authority.dispatchState},...evaluation,warningDigests:evaluation.conflicts.warnings.map(sha256),reviewReasonDigests:evaluation.conflicts.reviewReasons.map(sha256),expiresAt:new Date(now.getTime()+15*60000).toISOString(),simulated:true,demoWorkspaceRevision:workspace.integrity.revision+1};
 response.previewDigest=sha256({response,assignmentDigest:authority.digest,generation:state.generation,sessionId:workspace.session.id,workspaceDigest:workspace.integrity.digest});
 return seal({appointmentId:input.appointmentId,requestKey:input.idempotencyHash,generation:state.generation,expectedAssignmentDigest:authority.digest,expectedAssignmentRevision:authority.revision,expectedWorkspaceRevision:workspace.integrity.revision+1,workforceDigest:workforce.read(state)?.digest||null,createdAt:now.toISOString(),reason:normalized.reason,response});
}
function approve(workspace,state,input,now){
 const normalized=normalizeMutationApproval(context(workspace,input.appointmentId,input.scheduleBody,input.idempotencyKey));
 const found=ledger(state).previews.find(p=>p.response.id===normalized.previewId&&p.appointmentId===input.appointmentId);
 if(!found||found.response.previewDigest!==normalized.previewDigest||found.generation!==state.generation)fail(409,'DEMO_SCHEDULE_PREVIEW_STALE','Refresh and review the proposed change again.');
 if(new Date(found.response.expiresAt).getTime()<=now.getTime())fail(410,'DEMO_SCHEDULE_PREVIEW_EXPIRED','This preview expired. Review the appointment again.');
 const {authority,graph}=recordFor(workspace,state,input.appointmentId);
 if((found.workforceDigest!==undefined&&found.workforceDigest!==(workforce.read(state)?.digest||null))||found.expectedWorkspaceRevision!==workspace.integrity.revision||found.expectedAssignmentDigest!==authority.digest||found.expectedAssignmentRevision!==authority.revision)fail(409,'DEMO_SCHEDULE_STALE','The demo changed. Refresh and review the appointment again.');
 if(normalized.reason!==found.reason||sha256(normalized.acknowledgedWarningDigests)!==sha256(found.response.warningDigests.slice().sort())||sha256(normalized.acknowledgedReviewReasonDigests)!==sha256(found.response.reviewReasonDigests.slice().sort()))fail(400,'DEMO_SCHEDULE_ACK_REQUIRED','Review and acknowledge each scheduling warning before confirming.');
 const latest=evidence(workspace,found.response.proposal,state,graph);if(sha256(latest.conflicts)!==sha256(found.response.conflicts)||sha256(latest.recommendation)!==sha256(found.response.recommendation)||latest.conflicts.hardConflicts.length)fail(409,'DEMO_SCHEDULE_EVIDENCE_CHANGED','Scheduling information changed. Review the appointment again.');
 const next={...authority,dispatchState:found.response.proposal.dispatchState,revision:authority.revision+1,targetState:found.response.proposal.target.kind==='unassigned'?'unassigned':'assigned',workforceProfileId:found.response.proposal.target.kind==='profile'?found.response.proposal.target.id:null,workforceCrewId:found.response.proposal.target.kind==='crew'?found.response.proposal.target.id:null,targetLabel:workforce.targets(workforce.read(state)).find(t=>t.kind===found.response.proposal.target.kind&&t.id===found.response.proposal.target.id)?.label||null,scheduleState:found.response.proposal.scheduledStart?'scheduled':'unscheduled',scheduledStart:found.response.proposal.scheduledStart,scheduledEnd:found.response.proposal.scheduledEnd,needsReview:latest.conflicts.needsReview,reviewReasons:latest.conflicts.reviewReasons,lastAction:found.response.action,lastReason:normalized.reason,updatedAt:now.toISOString()};delete next.digest;
 const response={scheduleAuthority:seal(next),humanApproval:{id:uuid(workspace.session.id+':approval:'+input.idempotencyHash,NS),simulated:true},simulated:true,demoWorkspaceRevision:workspace.integrity.revision+1};
 return seal({appointmentId:input.appointmentId,requestKey:input.idempotencyHash,generation:state.generation,previewId:normalized.previewId,createdAt:now.toISOString(),response});
}
function apply(workspace,state,input,now){
 if(!policy.mutationsEnabled)fail(503,'DEMO_SCHEDULE_PAUSED','New demo schedule changes are paused. Saved appointments remain available.');
 const previous=validateState(state),isPreview=input.operation==='schedule_preview',entry=isPreview?preview(workspace,state,input,now):approve(workspace,state,input,now),next={...previous,[isPreview?'previews':'history']:[entry,...previous[isPreview?'previews':'history']]};
 const result=stableValue({...state,demoScheduling:next});validateState(result);return{state:result,response:entry.response};
}
function replay(state,input,now){const value=validateState(state),found=[...value.previews,...value.history].find(p=>p.requestKey===input.idempotencyHash);if(!found)fail(409,'DEMO_SCHEDULE_REPLAY_UNAVAILABLE','This earlier scheduling attempt is unavailable. Refresh the demo.');if(input.operation==='schedule_preview'&&new Date(found.response.expiresAt).getTime()<=now.getTime())fail(410,'DEMO_SCHEDULE_PREVIEW_EXPIRED','This preview expired. Review the appointment again.');return found.response;}
module.exports={VERSION,validateState,projection,current,apply,replay};
