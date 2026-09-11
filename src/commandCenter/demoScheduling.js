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
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
function ledger(state){return state.demoScheduling||{version:VERSION,previews:[],history:[]};}
function validateState(state){
 const value=ledger(state);if(value.version!==VERSION||!Array.isArray(value.previews)||!Array.isArray(value.history)||value.previews.length+value.history.length>24||Buffer.byteLength(JSON.stringify(value))>262144)fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');
 const ids=new Set(state.graphs.map(g=>g.ids.appointment||g.ids.work));const keys=new Set();
 for(const item of [...value.previews,...value.history]){
  if(!item||!ids.has(item.appointmentId)||typeof item.requestKey!=='string'||keys.has(item.requestKey)||!item.response||item.generation!==state.generation)fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');keys.add(item.requestKey);
  const unsigned={...item};delete unsigned.digest;if(sha256(unsigned)!==item.digest)fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');
 }
 const revisions=new Map();
 for(const item of value.history.slice().reverse()){
  const authority=item.response.scheduleAuthority,expected=(revisions.get(item.appointmentId)||1)+1;
  if(!authority||authority.appointmentId!==item.appointmentId||authority.revision!==expected||authority.targetState!=='unassigned'||authority.scheduleState!=='scheduled'||authority.dispatchState!=='not_dispatched'||!Number.isFinite(Date.parse(authority.scheduledStart))||!Number.isFinite(Date.parse(authority.scheduledEnd))||Date.parse(authority.scheduledEnd)<=Date.parse(authority.scheduledStart))fail(503,'DEMO_SCHEDULE_STATE_INVALID','Saved demo schedules could not be read.');
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
function evidence(workspace,proposal){
 // Display names are not staff identity or availability. Reuse the real engine
 // with an unassigned target and genuinely absent candidate evidence.
 const conflicts=evaluateConflictEvidence({proposal,candidate:null,appointment:{},businessProfile:workspace.configuration.businessProfile,skillAuthorityKnown:false,schedules:[],scheduleSetTruncated:false});
 const recommendation=evaluateRecommendationCandidates({candidates:[],businessProfile:workspace.configuration.businessProfile,globalEvidenceIncomplete:true,candidateSetTruncated:false});
 return {conflicts,recommendation};
}
function projection(workspace,state){
 validateState(state);
 const records=workspace.graphs.map(graph=>{
  const authority=current(workspace,state,graph),closed=['completed','cancelled'].includes(authority.appointmentStatus);
  const proposal={target:{kind:'unassigned',id:null},scheduledStart:authority.scheduledStart,scheduledEnd:authority.scheduledEnd,timeZone:workspace.configuration.businessProfile.timeZone};
  const conflict=evidence(workspace,proposal).conflicts;
  return {appointmentId:authority.appointmentId,graphId:graph.ids.graph,customer:{id:graph.ids.customer,name:graph.customer.name},work:{opportunityId:authority.opportunityId,title:graph.work.title||graph.polaris.snapshot.service.label,serviceType:graph.polaris.snapshot.service.key,appointmentStatus:authority.appointmentStatus},authority,conflict:{...conflict,digest:sha256(conflict),persisted:false,grantsMutation:false},flags:classifyRecord({appointment:{scheduleAuthority:authority}},conflict,new Date()),allowedActions:policy.mutationsEnabled&&!closed?[authority.scheduleState==='scheduled'?'reschedule':'schedule']:[],demoWorkspaceRevision:workspace.integrity.revision};
 });
 const operator={canRead:true,canMutate:policy.mutationsEnabled,simulated:true,reason:policy.mutationsEnabled?'demo_time_only':'demo_schedule_paused',targets:[],truncated:false,discovery:null,demoWorkspaceRevision:workspace.integrity.revision};
 const overview={version:'m22-part5-overview-v1',timeZone:workspace.configuration.businessProfile.timeZone,total:records.length,shown:records.length,truncated:false,page:{size:15,cursor:null,nextCursor:null,hasPrevious:false,hasNext:false,shown:records.length,total:records.length},records,categories:{unassigned:records.map(r=>r.appointmentId),due:[],overdue:[],atRisk:records.map(r=>r.appointmentId),conflicting:[]},counts:{unassigned:records.length,due:0,overdue:0,atRisk:records.length,conflicting:0},simulated:true};
 for(const category of Object.keys(overview.categories)){overview.categories[category]=records.filter(r=>r.flags[category]).map(r=>r.appointmentId);overview.counts[category]=overview.categories[category].length;}
 return {schedulingOperator:{...operator,digest:sha256(operator)},schedulingOverview:{...overview,digest:sha256(overview)}};
}
function recordFor(workspace,state,id){const g=workspace.graphs.find(g=>(g.ids.appointment||g.ids.work)===id);if(!g)fail(404,'DEMO_SCHEDULE_NOT_FOUND','That demo appointment is unavailable.');return{graph:g,authority:current(workspace,state,g)};}
function context(workspace,id,body,key){return{appointmentId:id,organizationId:workspace.tenant.id,actorUserId:workspace.viewer.id,authSessionId:workspace.session.id,body,idempotencyKey:key};}
function preview(workspace,state,input,now){
 const {authority}=recordFor(workspace,state,input.appointmentId),normalized=normalizeMutationPreview(context(workspace,input.appointmentId,input.scheduleBody,input.idempotencyKey));
 if(!['schedule','reschedule'].includes(normalized.action)||normalized.target.kind!=='unassigned'||normalized.target.id!==null||!normalized.scheduledStart||!normalized.scheduledEnd||normalized.appointmentStatus!==authority.appointmentStatus||['completed','cancelled'].includes(authority.appointmentStatus))fail(400,'DEMO_SCHEDULE_ACTION_UNSUPPORTED','Enter the start and end for this existing appointment. Assignment and status changes are unavailable here.');
 if(normalized.action!==(authority.scheduleState==='scheduled'?'reschedule':'schedule')||normalized.expectedRevision!==authority.revision||normalized.expectedDigest!==authority.digest||normalized.expectedTimeZone!==workspace.configuration.businessProfile.timeZone)fail(409,'DEMO_SCHEDULE_STALE','The schedule changed. Refresh and review the times again.');
 const evaluation=evidence(workspace,normalized.proposal),id=uuid(workspace.session.id+':preview:'+input.idempotencyHash,NS);
 const response={id,action:normalized.action,proposal:{...normalized.proposal,scheduleState:'scheduled',dispatchState:'not_dispatched'},...evaluation,warningDigests:evaluation.conflicts.warnings.map(sha256),reviewReasonDigests:evaluation.conflicts.reviewReasons.map(sha256),expiresAt:new Date(now.getTime()+15*60000).toISOString(),simulated:true,demoWorkspaceRevision:workspace.integrity.revision+1};
 response.previewDigest=sha256({response,assignmentDigest:authority.digest,generation:state.generation,sessionId:workspace.session.id,workspaceDigest:workspace.integrity.digest});
 return seal({appointmentId:input.appointmentId,requestKey:input.idempotencyHash,generation:state.generation,expectedAssignmentDigest:authority.digest,expectedAssignmentRevision:authority.revision,expectedWorkspaceRevision:workspace.integrity.revision+1,createdAt:now.toISOString(),reason:normalized.reason,response});
}
function approve(workspace,state,input,now){
 const normalized=normalizeMutationApproval(context(workspace,input.appointmentId,input.scheduleBody,input.idempotencyKey));
 const found=ledger(state).previews.find(p=>p.response.id===normalized.previewId&&p.appointmentId===input.appointmentId);
 if(!found||found.response.previewDigest!==normalized.previewDigest||found.generation!==state.generation)fail(409,'DEMO_SCHEDULE_PREVIEW_STALE','Refresh and review the proposed times again.');
 if(new Date(found.response.expiresAt).getTime()<=now.getTime())fail(410,'DEMO_SCHEDULE_PREVIEW_EXPIRED','This preview expired. Review the times again.');
 const {authority}=recordFor(workspace,state,input.appointmentId);
 if(found.expectedWorkspaceRevision!==workspace.integrity.revision||found.expectedAssignmentDigest!==authority.digest||found.expectedAssignmentRevision!==authority.revision)fail(409,'DEMO_SCHEDULE_STALE','The demo changed. Refresh and review the times again.');
 if(normalized.reason!==found.reason||sha256(normalized.acknowledgedWarningDigests)!==sha256(found.response.warningDigests.slice().sort())||sha256(normalized.acknowledgedReviewReasonDigests)!==sha256(found.response.reviewReasonDigests.slice().sort()))fail(400,'DEMO_SCHEDULE_ACK_REQUIRED','Review and acknowledge each scheduling warning before confirming.');
 const latest=evidence(workspace,found.response.proposal);if(sha256(latest.conflicts)!==sha256(found.response.conflicts)||sha256(latest.recommendation)!==sha256(found.response.recommendation)||latest.conflicts.hardConflicts.length)fail(409,'DEMO_SCHEDULE_EVIDENCE_CHANGED','Scheduling information changed. Review the times again.');
 const next={...authority,revision:authority.revision+1,scheduleState:'scheduled',scheduledStart:found.response.proposal.scheduledStart,scheduledEnd:found.response.proposal.scheduledEnd,needsReview:latest.conflicts.needsReview,reviewReasons:latest.conflicts.reviewReasons,lastAction:found.response.action,lastReason:normalized.reason,updatedAt:now.toISOString()};delete next.digest;
 const response={scheduleAuthority:seal(next),humanApproval:{id:uuid(workspace.session.id+':approval:'+input.idempotencyHash,NS),simulated:true},simulated:true,demoWorkspaceRevision:workspace.integrity.revision+1};
 return seal({appointmentId:input.appointmentId,requestKey:input.idempotencyHash,generation:state.generation,previewId:normalized.previewId,createdAt:now.toISOString(),response});
}
function apply(workspace,state,input,now){
 if(!policy.mutationsEnabled)fail(503,'DEMO_SCHEDULE_PAUSED','New demo schedule changes are paused. Saved times remain available.');
 const previous=validateState(state),isPreview=input.operation==='schedule_preview',entry=isPreview?preview(workspace,state,input,now):approve(workspace,state,input,now),next={...previous,[isPreview?'previews':'history']:[entry,...previous[isPreview?'previews':'history']]};
 const result=stableValue({...state,demoScheduling:next});validateState(result);return{state:result,response:entry.response};
}
function replay(state,input,now){const value=validateState(state),found=[...value.previews,...value.history].find(p=>p.requestKey===input.idempotencyHash);if(!found)fail(409,'DEMO_SCHEDULE_REPLAY_UNAVAILABLE','This earlier scheduling attempt is unavailable. Refresh the demo.');if(input.operation==='schedule_preview'&&new Date(found.response.expiresAt).getTime()<=now.getTime())fail(410,'DEMO_SCHEDULE_PREVIEW_EXPIRED','This preview expired. Review the times again.');return found.response;}
module.exports={VERSION,validateState,projection,current,apply,replay};
