'use strict';

const { v5: uuid } = require('uuid');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const executionContract = require('../operations/contract');
const progressContract = require('../progress/contract');
const evidenceContract = require('../fieldEvidence/contract');
const completionContract = require('../completion/contract');
const scheduling = require('./demoScheduling');
const workforce = require('./demoWorkforce');
const policy = require('./demoOperationsPolicy');
const VERSION = 'demo-owner-operations-v1';
const NS = '6381f256-1e8a-4d07-90a2-609e757a982d';
const EMPTY_REQUIREMENTS = Object.freeze({ checklists: [], inspections: [], files: [] });
const pin = value => ({ id: value.id, revision: value.revision, digest: value.digest });
const same = (a, b) => Boolean(a && b && a.id === b.id && a.revision === b.revision && a.digest === b.digest);
function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function seal(value) { return stableValue({ ...value, digest: sha256(value) }); }
function unsigned(value) { const copy = { ...value }; delete copy.digest; return copy; }
function validPin(value) { return value && /^[0-9a-f-]{36}$/.test(value.id || '') && Number.isSafeInteger(value.revision) && value.revision >= 1 && /^[0-9a-f]{64}$/.test(value.digest || ''); }
function ledger(state) { return state.operations || { version: VERSION, events: [] }; }
function validateState(state) {
  const value = ledger(state);
  if (value.version !== VERSION || !Array.isArray(value.events) || value.events.length > 24 || Buffer.byteLength(JSON.stringify(value)) > 1048576) fail(503, 'DEMO_OPERATIONS_STATE', 'Saved work could not be read. Refresh and try again.');
  const ids = new Set(state.graphs.map(g => g.ids.appointment || g.ids.work));
  const keys = new Set(), previous = new Map();
  for (const event of value.events.slice().reverse()) {
    if (!event || !ids.has(event.appointmentId) || keys.has(event.requestKey) || event.generation !== state.generation || sha256(unsigned(event)) !== event.digest || !event.work || !event.response) fail(503, 'DEMO_OPERATIONS_STATE', 'Saved work could not be read. Refresh and try again.');
    const before = previous.get(event.appointmentId);
    if (event.previousEventDigest !== (before ? before.digest : null) || (!before && event.action !== 'initialize') || before && event.work.execution.id !== before.work.execution.id) fail(503, 'DEMO_OPERATIONS_HISTORY', 'Saved work history could not be read.');
    if(!validPin(event.sourceAssignment)||event.sourceAssignment.id!==event.work.execution.assignmentId||
      (before?!same(event.sourceExecution,pin(before.work.execution)):event.sourceExecution!==null)||
      !validPin(event.work.execution)||sha256(unsigned(event.work.execution))!==event.work.execution.digest||
      !['progress','field','completion'].every(key=>Array.isArray(event.work[key])&&event.work[key].length<=24&&event.work[key].every(record=>validPin(record)&&record.executionId===event.work.execution.id&&sha256(unsigned(record))===record.digest)))
      fail(503,'DEMO_OPERATIONS_HISTORY','Saved work history could not be read.');
    keys.add(event.requestKey); previous.set(event.appointmentId, event);
  }
  return value;
}
function workFor(state, appointmentId) { return validateState(state).events.find(e => e.appointmentId === appointmentId)?.work || null; }
function context(workspace, state, appointmentId) {
  const graph = workspace.graphs.find(g => (g.ids.appointment || g.ids.work) === appointmentId);
  if (!graph) fail(404, 'DEMO_WORK_NOT_FOUND', 'That job is unavailable. Return to Operations and choose a job.');
  const assignment = scheduling.current(workspace, state, graph);
  const team = workforce.read(state);
  const candidate = workforce.candidate(team, { kind: assignment.workforceProfileId ? 'profile' : 'crew', id: assignment.workforceProfileId || assignment.workforceCrewId });
  const owner = team?.members.find(m => ['owner', 'admin'].includes(m.accessRole) && m.membershipStatus === 'active' && m.userStatus === 'active');
  return { graph, assignment, candidate, owner, work: workFor(state, appointmentId) };
}
function assertAuthority(ctx) {
  if (!ctx.owner) fail(403, 'DEMO_WORK_OWNER', 'Owner work controls are unavailable in this older demo. Reset starts a new demo and clears its saved changes.');
  if (!ctx.candidate || ctx.assignment.targetState !== 'assigned' || ctx.assignment.dispatchState !== 'dispatched' || ctx.assignment.scheduleState !== 'scheduled' || ['cancelled', 'completed'].includes(ctx.assignment.appointmentStatus)) fail(409, 'DEMO_WORK_DISPATCH', 'Assign, schedule and dispatch this job before changing recorded work. Refresh after a schedule change.');
}
function normalize(input, workspace, ctx) {
  const request = input.operations;
  if (!request || !['initialize', 'transition', 'progress', 'evidence', 'completion'].includes(request.family) || !request.body) fail(400, 'DEMO_WORK_INPUT', 'Choose a supported work action.');
  const common = { organizationId: workspace.tenant.id, actorUserId: workspace.viewer.id, actorAccessRole: 'owner', authSessionId: workspace.session.id,
    appointmentId: input.appointmentId, executionId: ctx.work?.execution.id, idempotencyKey: input.idempotencyKey, body: request.body };
  const normalizers = { initialize: executionContract.normalizeInitialization, transition: executionContract.normalizeTransition,
    progress: progressContract.normalizeProgressAction, evidence: evidenceContract.normalizeEvidenceAction, completion: completionContract.normalizeCompletionAction };
  try { return normalizers[request.family](common); } catch (error) {
    fail(error.status || 400, 'DEMO_WORK_INPUT', 'Check the required work details and refresh if the saved job changed.');
  }
}
function assertPins(ctx, input, family) {
  if (input.expectedAssignmentRevision !== ctx.assignment.revision || input.expectedAssignmentDigest !== ctx.assignment.digest) fail(409, 'DEMO_WORK_CHANGED', 'The assigned work changed. Refresh and review your action again.');
  if (family !== 'initialize' && (!ctx.work || (input.expectedExecutionRevision ?? input.expectedRevision) !== ctx.work.execution.revision || (input.expectedExecutionDigest ?? input.expectedDigest) !== ctx.work.execution.digest)) fail(409, 'DEMO_WORK_CHANGED', 'Recorded work changed. Refresh and review your action again.');
}
function evidenceRows(work, organizationId) {
  const convert = record => ({ id: record.id, organization_id: organizationId, execution_id: work.execution.id,
    root_id: record.rootId, previous_record_id: record.previousRecordId, revision: record.revision, canonical_digest: record.digest,
    evidence_type: record.document.kind, document: record.document });
  return { ...work.evidence, progress: work.progress.map(convert), field: work.field.map(convert) };
}
async function gateSnapshot(client, workspace, ctx, work, requirements, now) {
  const assignment = { id: ctx.assignment.id, revision: ctx.assignment.revision, canonical_digest: ctx.assignment.digest };
  const result = await client.query('SELECT public.canonical_demo_completion_gate_snapshot($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,$6::timestamptz) value',
    [workspace.tenant.id, work.execution.id, requirements, assignment, evidenceRows(work, workspace.tenant.id), now]);
  return result.rows[0].value;
}
async function lifecycle(client, before, action, returnState = null) {
  const result = await client.query('SELECT public.canonical_work_lifecycle_after($1,$2,$3) value', [before, action, returnState]);
  if (!result.rows[0].value) fail(409, 'DEMO_WORK_TRANSITION', 'That action no longer applies to this work. Refresh to see the available actions.');
  return result.rows[0].value;
}
function currentRecord(records, reference) {
  const record = records.find(r => same(r, reference));
  if (!record || records.some(r => r.previousRecordId === record.id)) fail(409, 'DEMO_WORK_RECORD_CHANGED', 'The selected record changed. Refresh before reviewing it again.');
  return record;
}
function timeZoneAuthority(workspace, state) {
  return { businessProfileId: uuid(workspace.session.id + ':business-profile', NS), version: state.generation,
    hash: sha256(workspace.configuration.businessProfile), timeZone: workspace.configuration.businessProfile.timeZone };
}
async function checkObservation(client, workspace, state, work, document, now) {
  if (sha256(document.timeZoneAuthority) !== sha256(timeZoneAuthority(workspace, state))) fail(409, 'DEMO_WORK_TIME_BASIS', 'The business time zone changed. Refresh before recording this observation.');
  for (const raw of [document.observedAt, document.resolution?.observedAt].filter(Boolean)) {
    const result = await client.query("SELECT $1::text::timestamptz <= $3::timestamptz + interval '5 minutes' AND $1::text::timestamptz AT TIME ZONE $2 = regexp_replace($1::text,'(Z|[+-][0-9]{2}:[0-9]{2})$','')::timestamp valid", [raw, document.timeZoneAuthority.timeZone, now]);
    if (result.rows[0].valid !== true) fail(400, 'DEMO_WORK_OBSERVED_TIME', 'Enter the observed time in the business time zone, without a future time.');
  }
  if (document.resolution && Date.parse(document.resolution.observedAt) < Date.parse(document.observedAt)) fail(400, 'DEMO_WORK_OBSERVED_TIME', 'The resolution cannot precede the original observation.');
  for (const p of [...document.evidence, ...(document.resolution?.evidence || []), ...(document.milestone?.checklist ? [document.milestone.checklist] : [])]) {
    if (!work.field.some(r => same(r, p))) fail(409, 'DEMO_WORK_EVIDENCE_CHANGED', 'Supporting evidence is unavailable. Refresh and choose the saved evidence again.');
  }
  if (document.milestone?.checklist && !work.field.some(r => same(r, document.milestone.checklist) && ['checklist', 'checklist_response'].includes(r.document.kind))) fail(400, 'DEMO_WORK_EVIDENCE_REQUIRED', 'Choose a saved checklist or checklist response.');
  if (document.followUp && !workforce.read(state)?.members.some(m => m.profileId === document.followUp.profileId && m.membershipStatus === 'active' && m.userStatus === 'active')) fail(400, 'DEMO_WORK_FOLLOW_UP', 'Choose a current team member for follow-up.');
}
function makeRecord(id, prior, document, input, now) {
  return seal({ id, rootId: prior ? prior.rootId : id, previousRecordId: prior ? prior.id : null,
    revision: prior ? prior.revision + 1 : 1, document, reason: input.reason, action: input.action,
    executionId: input.executionId, sourceExecutionRevision: input.expectedExecutionRevision, sourceExecutionDigest: input.expectedExecutionDigest,
    sourceAssignmentRevision: input.expectedAssignmentRevision, sourceAssignmentDigest: input.expectedAssignmentDigest,
    performedBy: input.performerProfileId, recordedBy: input.actorUserId, decidedAt: now.toISOString() });
}
async function apply(client, workspace, state, rawInput, now) {
  if (!policy.mutationsEnabled) fail(503, 'DEMO_OPERATIONS_PAUSED', 'New work updates are paused. Saved work and completion history remain available.');
  const ctx = context(workspace, state, rawInput.appointmentId); assertAuthority(ctx);
  const family = rawInput.operations.family, input = normalize(rawInput, workspace, ctx); assertPins(ctx, input, family);
  const previous = ledger(state).events.find(e => e.appointmentId === rawInput.appointmentId);
  const recordId = uuid(workspace.session.id + ':work-record:' + rawInput.idempotencyHash, NS);
  let work = ctx.work ? structuredClone(ctx.work) : null;
  let result;
  if (family === 'initialize') {
    if (work) fail(409, 'DEMO_WORK_EXISTS', 'Work is already recorded for this job. Open its saved work details.');
    const execution = seal({ id: uuid(workspace.session.id + ':execution:' + input.appointmentId, NS), appointmentId: input.appointmentId,
      operationId: ctx.graph.ids.operation, graphId: ctx.graph.ids.graph, opportunityId: ctx.graph.ids.opportunity || ctx.graph.ids.lead,
      assignmentId: ctx.assignment.id, lifecycleState: 'not_started', sourceAssignmentRevision: ctx.assignment.revision, sourceAssignmentDigest: ctx.assignment.digest,
      revision: 1, recordedByUserId: workspace.viewer.id, performedByProfileId: ctx.owner.profileId,
      lastAction: 'initialize', lastReason: input.reason, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    // This finite demo job has no labor/material/equipment records yet. That is
    // not a claim about the customer's physical work, stock or equipment safety.
    work = { execution, progress: [], field: [], completion: [], evidence: { complete: true, labor: [], materials: [], equipmentEvents: [], equipmentLedgers: [] } };
    result = { success: true, data: execution };
  } else if (family === 'transition') {
    const next = await lifecycle(client, work.execution.lifecycleState, input.action);
    work.execution = updatedExecution(work.execution, ctx, input, next, now);
    result = { success: true, data: work.execution };
  } else if (family === 'progress' || family === 'evidence') {
    if (!['in_progress', 'paused'].includes(work.execution.lifecycleState) || ctx.assignment.needsReview) fail(409, 'DEMO_WORK_REVIEW_REQUIRED', 'Resolve the current scheduling review before recording field details.');
    if (!ctx.candidate.members.some(m => m.profileId === input.performerProfileId)) fail(403, 'DEMO_WORK_PERFORMER', 'Choose someone on the currently assigned team.');
    const list = family === 'progress' ? work.progress : work.field;
    const reference = family === 'progress' ? (input.recordId ? { id: input.recordId, revision: input.expectedRecordRevision, digest: input.expectedRecordDigest } : null)
      : (input.subjectId ? { id: input.subjectId, revision: input.expectedSubjectRevision, digest: input.expectedSubjectDigest } : null);
    const referenced = reference ? currentRecord(list, reference) : null;
    const prior = family === 'evidence' && input.action === 'respond_item' ? null : referenced;
    if (prior && prior.performedBy !== input.performerProfileId) fail(403, 'DEMO_WORK_ATTRIBUTION', 'Keep the original person when reviewing or correcting this record.');
    let document = input.document;
    if (family === 'progress') {
      if (input.action === 'review' && document.outcome === 'worker_acknowledged' && input.performerProfileId !== ctx.owner.profileId) fail(403, 'DEMO_WORK_REVIEW_AUTHORITY', 'Use owner review when reviewing another person’s work.');
      if (prior) document = (await client.query('SELECT public.canonical_operations_progress_successor_document($1,$2::jsonb,$3,$4::jsonb) value', [input.action, prior.document, prior.document.kind, document])).rows[0].value;
      else if (input.action === 'record_progress' && list.some(r => r.document.kind === 'progress' && r.document.workKey === document.workKey && r.performedBy === input.performerProfileId)) fail(409, 'DEMO_PROGRESS_EXISTS', 'Progress for this work is already recorded. Update its latest record.');
      await checkObservation(client, workspace, state, work, document, now);
    } else {
      if (!['record_note', 'record_observation', 'create_checklist', 'respond_item', 'correct'].includes(input.action) || ['file', 'file_accessibility_correction'].includes(document.kind)) fail(400, 'DEMO_EVIDENCE_UNAVAILABLE', 'File upload and scanning are unavailable in this demo. Add a note or observation instead.');
      if (document.kind === 'checklist' && document.template !== null) fail(400,'DEMO_EVIDENCE_TEMPLATE','Use an original checklist in this demo; published company templates are not available.');
      if (prior && (prior.document.kind !== document.kind || ['checklist'].includes(document.kind))) fail(400, 'DEMO_EVIDENCE_CORRECTION', 'Keep the original evidence type when correcting a record.');
      for (const id of document.supportingEvidenceIds || []) if (!work.field.some(r => r.id === id)) fail(409, 'DEMO_EVIDENCE_LINK', 'Choose supporting evidence saved on this job.');
      if (document.kind === 'checklist_response') {
        const checklist = work.field.find(r => r.id === document.checklistId && r.document.kind === 'checklist');
        if (!checklist || work.field.some(r => r.previousRecordId === checklist.id) || !checklist.document.items.some(i => i.key === document.itemKey)) fail(409, 'DEMO_CHECKLIST_CHANGED', 'Refresh and choose an item on the current saved checklist.');
        if (prior && (prior.document.checklistId !== document.checklistId || prior.document.itemKey !== document.itemKey)) fail(400, 'DEMO_EVIDENCE_CORRECTION', 'Keep the original checklist item when correcting its response.');
      }
    }
    const valid = await client.query('SELECT public.canonical_operations_document_valid($1,$2,$3::jsonb) valid', [family, input.action, document]);
    if (valid.rows[0].valid !== true) fail(400, 'DEMO_WORK_INPUT', 'Check the required details before saving this record.');
    const record = makeRecord(recordId, prior, document, input, now); list.unshift(record);
    result = { success: true, data: record };
  } else {
    result = await complete(client, workspace, ctx, work, input, recordId, now);
  }
  const event = seal({ appointmentId: rawInput.appointmentId, requestKey: rawInput.idempotencyHash, generation: state.generation,
    action: input.action || 'initialize', family, previousEventDigest: previous?.digest || null,
    sourceAssignment: pin(ctx.assignment), sourceExecution: ctx.work ? pin(ctx.work.execution) : null,
    decidedAt: now.toISOString(), work, response: result });
  const next = stableValue({ ...state, operations: { version: VERSION, events: [event, ...ledger(state).events] } });
  validateState(next); return { state: next, response: result };
}
function updatedExecution(execution, ctx, input, next, now) {
  return seal({ ...unsigned(execution), lifecycleState: next, revision: execution.revision + 1,
    sourceAssignmentRevision: ctx.assignment.revision, sourceAssignmentDigest: ctx.assignment.digest,
    recordedByUserId: input.actorUserId, performedByProfileId: ctx.owner.profileId,
    lastAction: input.action, lastReason: input.reason, updatedAt: now.toISOString() });
}
async function complete(client, workspace, ctx, work, input, id, now) {
  const action = input.action, doc = input, before = work.execution.lifecycleState;
  let requirements = EMPTY_REQUIREMENTS, gates = { contractVersion: 'm23-completion-gates-v1', notEvaluated: true };
  let relatedProposalId = null, relatedCompletionId = null, prior = null, expiresAt = null, kind, document;
  const current = (reference, expectedKind) => {
    const record = work.completion.find(r => same(r, reference) && r.recordKind === expectedKind);
    if (!record || record.resultingExecutionRevision !== work.execution.revision || record.resultingExecutionDigest !== work.execution.digest) fail(409, 'DEMO_COMPLETION_CHANGED', 'The completion review changed. Refresh before deciding.');
    return record;
  };
  let returnState = null;
  if (action === 'propose_completion') {
    expiresAt = new Date(doc.expiresAt).toISOString();
    if (Date.parse(expiresAt) <= now.getTime() || Date.parse(expiresAt) > now.getTime() + 7 * 86400000) fail(400, 'DEMO_COMPLETION_EXPIRY', 'Choose a review expiry within the next seven days.');
    requirements = doc.gateRequirements; gates = await gateSnapshot(client, workspace, ctx, work, requirements, now);
    if (gates.hardGatesPassed !== true) fail(409, 'DEMO_COMPLETION_GATES', 'Resolve the outstanding readiness checks before requesting completion review.');
    kind = 'proposal'; document = { kind, contractVersion: completionContract.VERSION, returnState: before, gateRequirements: requirements };
  } else if (['approve_completion', 'withdraw_completion'].includes(action) || action === 'cancel_execution' && before === 'completion_pending') {
    const proposal = current(doc.proposal, 'proposal');
    if (before !== 'completion_pending' || work.completion.some(r => r.relatedProposalId === proposal.id && ['approval', 'withdrawal', 'cancellation'].includes(r.recordKind))) fail(409, 'DEMO_COMPLETION_CHANGED', 'This completion request was already resolved. Refresh its history.');
    relatedProposalId = proposal.id; requirements = proposal.gateRequirements; gates = proposal.gateSnapshot; returnState = proposal.lifecycleBefore;
    if (action === 'approve_completion') {
      if (Date.parse(proposal.expiresAt) <= now.getTime()) fail(410, 'DEMO_COMPLETION_EXPIRED', 'This completion request expired. Withdraw it and request a new review.');
      const currentGates = await gateSnapshot(client, workspace, ctx, work, requirements, now);
      if (sha256(currentGates) !== sha256(gates) || gates.hardGatesPassed !== true) fail(409, 'DEMO_COMPLETION_EVIDENCE_CHANGED', 'Supporting records changed. Withdraw this request and review the current evidence.');
    }
    kind = action === 'approve_completion' ? 'approval' : action === 'withdraw_completion' ? 'withdrawal' : 'cancellation';
    document = { kind, contractVersion: completionContract.VERSION, proposal: doc.proposal, ...(kind === 'withdrawal' ? { returnState } : {}) };
  } else if (action === 'cancel_execution') {
    if (doc.proposal !== null) fail(409, 'DEMO_COMPLETION_CHANGED', 'Refresh before cancelling the recorded work.');
    kind = 'cancellation'; document = { kind, contractVersion: completionContract.VERSION, proposal: null, cancelledFrom: before };
  } else if (action === 'reopen_execution' || action === 'resume_reopened') {
    const record = current(action === 'reopen_execution' ? doc.completion : doc.reopening, action === 'reopen_execution' ? 'approval' : 'reopening');
    relatedCompletionId = record.id; requirements = record.gateRequirements; gates = record.gateSnapshot;
    kind = action === 'reopen_execution' ? 'reopening' : 'resumption'; document = { kind, contractVersion: completionContract.VERSION,
      ...(kind === 'reopening' ? { originalCompletion: doc.completion, nextAction: doc.nextAction } : { reopening: doc.reopening }) };
  } else {
    prior = currentRecord(work.completion, doc.record); relatedProposalId = prior.relatedProposalId; relatedCompletionId = prior.relatedCompletionId;
    requirements = prior.gateRequirements; gates = prior.gateSnapshot; kind = 'correction';
    document = { kind, contractVersion: completionContract.VERSION, corrects: doc.record, subjectKind: prior.subjectKind, annotation: doc.annotation };
  }
  const after = await lifecycle(client, before, action, returnState);
  if (action !== 'correct_completion') work.execution = updatedExecution(work.execution, ctx, input, after, now);
  const record = seal({ id, rootId: prior ? prior.rootId : id, previousRecordId: prior?.id || null, revision: prior ? prior.revision + 1 : 1,
    executionId: work.execution.id, assignmentId: ctx.assignment.id, recordKind: kind, subjectKind: prior?.subjectKind || kind,
    lifecycleBefore: before, lifecycleAfter: after, resultingExecutionRevision: work.execution.revision, resultingExecutionDigest: work.execution.digest,
    relatedProposalId, relatedCompletionId, gateRequirements: requirements, gateSnapshot: gates, document, expiresAt,
    sourceExecutionRevision: input.expectedExecutionRevision, sourceExecutionDigest: input.expectedExecutionDigest,
    sourceAssignmentRevision: input.expectedAssignmentRevision, sourceAssignmentDigest: input.expectedAssignmentDigest,
    recordedBy: workspace.viewer.id, performedBy: ctx.owner.profileId, reason: input.reason, decidedAt: now.toISOString() });
  work.completion.unshift(record);
  return { success: true, data: work.execution, completionRecord: record };
}
function replay(workspace, state, input) {
  const ctx = context(workspace, state, input.appointmentId); assertAuthority(ctx);
  const found = validateState(state).events.find(e => e.requestKey === input.idempotencyHash && e.appointmentId === input.appointmentId);
  if (!found) fail(409, 'DEMO_WORK_REPLAY', 'This earlier attempt is unavailable. Refresh the saved work.');
  return found.response;
}
function completionBody(work, now) {
  const records = work.completion.map(r => ({ ...r, expired: r.expiresAt !== null && Date.parse(r.expiresAt) <= now.getTime() }));
  const activeProposal = work.execution.lifecycleState === 'completion_pending' ? records.find(r => r.recordKind === 'proposal' && r.resultingExecutionRevision === work.execution.revision && r.resultingExecutionDigest === work.execution.digest) : null;
  return { success: true, data: { execution: work.execution, activeProposal, records, totalRecordCount: records.length, truncated: false,
    authority: 'isolated_demo_postgresql', completionInferred: false } };
}
function completionReview(workspace, state, appointmentId, now) {
  const ctx = context(workspace, state, appointmentId);
  if (!ctx.work) fail(404, 'DEMO_WORK_NOT_FOUND', 'No work is recorded for this job yet.');
  let canMutate = policy.mutationsEnabled;
  try { assertAuthority(ctx); } catch (_) { canMutate = false; }
  return require('../completion/ownerReview').projectDemoOwnerReview(completionBody(ctx.work, now), {
    assignment_id: ctx.assignment.id, appointment_id: appointmentId, revision: ctx.assignment.revision, digest: ctx.assignment.digest,
    title: ctx.graph.work.title || ctx.graph.polaris.snapshot.service.label, server_now: now, mutationsEnabled: canMutate,
  }, { organizationId: workspace.tenant.id, actorUserId: workspace.viewer.id, actorAccessRole: 'owner', authSessionId: workspace.session.id });
}
async function readDetail(client, workspace, state, appointmentId, now) {
  const ctx = context(workspace, state, appointmentId);
  let available = policy.mutationsEnabled, unavailable = policy.mutationsEnabled ? null : 'New work updates are paused. Saved work remains available.';
  try { assertAuthority(ctx); } catch (error) { available = false; unavailable = error.message; }
  const work = ctx.work, stateName = work?.execution.lifecycleState;
  const actions = !available ? [] : !work ? ['initialize'] : stateName === 'not_started' ? ['start'] : stateName === 'in_progress' ? ['pause'] : stateName === 'paused' ? ['resume'] : [];
  if (available && work && ['in_progress','paused'].includes(stateName) && !ctx.assignment.needsReview) actions.push('progress','evidence');
  if (available && work && ['in_progress','paused','reopened'].includes(stateName)) actions.push('propose_completion');
  if (available && stateName === 'completion_pending') actions.push('withdraw_completion');
  return { version: 'owner-work-detail-v1', authority: 'isolated_demo_postgresql', simulated: true,
    appointmentId, graphId: ctx.graph.ids.graph, customerId: ctx.graph.ids.customer, title: ctx.graph.work.title || ctx.graph.polaris.snapshot.service.label, assignment: ctx.assignment,
    execution: work?.execution || null, progress: work?.progress || [], field: work?.field || [],
    completion: work ? completionBody(work, now).data : null,
    gates: work ? await gateSnapshot(client, workspace, ctx, work, EMPTY_REQUIREMENTS, now) : null,
    timeZoneAuthority: timeZoneAuthority(workspace, state), performers: ctx.candidate ? ctx.candidate.members.map(m => ({ id: m.profileId, name: m.name })) : [],
    allowedActions: actions, unavailable, evaluatedAt: now.toISOString(), demoWorkspaceRevision: workspace.integrity.revision,
    schedulingBasis: require('./demoOperationsBasis').read(state)?.appointments.some(a=>a.appointmentId===appointmentId)?'Simulated Main-Office Responsibility · Monday–Friday, 8 AM–5 PM. Geographic coverage is not verified.':null,
    evidenceLimit: 'This simulated job includes only its recorded evidence. File upload, labor, material use and equipment updates are not available here.' };
}
async function overview(client, workspace, state, filter, now) {
  if(!['active','all','completion_pending','completed'].includes(filter))fail(400,'DEMO_WORK_FILTER','Choose an available work status.');
  const records=[];
  for(const graph of workspace.graphs){
    const id=graph.ids.appointment||graph.ids.work,ctx=context(workspace,state,id),work=ctx.work;
    if(!work || filter==='active'&&['completed','cancelled'].includes(work.execution.lifecycleState)||['completed','completion_pending'].includes(filter)&&work.execution.lifecycleState!==filter)continue;
    const latest=values=>values.filter(r=>!values.some(next=>next.previousRecordId===r.id));
    const progress=latest(work.progress),field=latest(work.field),proposal=completionBody(work,now).data.activeProposal;
    const gates=proposal?await gateSnapshot(client,workspace,ctx,work,proposal.gateRequirements,now):null;
    const changed=proposal&&sha256(gates)!==sha256(proposal.gateSnapshot);
    const count=kind=>progress.filter(r=>r.document.kind===kind&&r.document.state!=='resolved').length;
    const allFacts=progress.filter(r=>r.document.kind==='progress');
    records.push({executionId:work.execution.id,appointmentId:id,title:graph.work.title||graph.polaris.snapshot.service.label,serviceType:graph.polaris.snapshot.service.label,
      createdAt:work.execution.createdAt,updatedAt:work.execution.updatedAt,lifecycleState:work.execution.lifecycleState,
      schedule:{state:ctx.assignment.scheduleState,start:ctx.assignment.scheduledStart,end:ctx.assignment.scheduledEnd,timeZone:workspace.configuration.businessProfile.timeZone},
      assignment:{kind:ctx.assignment.workforceProfileId?'worker':'crew',label:ctx.assignment.targetLabel||'Assigned Team',current:ctx.assignment.revision===work.execution.sourceAssignmentRevision&&ctx.assignment.digest===work.execution.sourceAssignmentDigest},
      progress:{recorded:allFacts.length,needsReview:progress.filter(r=>r.document.reviewState==='needs_review').length,uncertain:allFacts.filter(r=>r.document.uncertainty!=='measured').length},
      blockers:{open:count('blocker')},exceptions:{open:count('exception')},approval:{state:!proposal?'none':proposal.expired?'expired':changed?'changed':'pending'},
      evidence:{state:!proposal?'not_evaluated':changed?'changed':gates.hardGatesPassed?'ready_for_review':'incomplete',recorded:field.length},capacity:{status:'unknown',recordedConstraints:count('blocker')+count('exception')},
      ownerDetails:{progress:allFacts.slice(0,20).map(r=>({workKey:r.document.workKey,quantity:r.document.quantity?{completed:r.document.quantity.completed,total:r.document.quantity.total,unit:r.document.quantity.unit}:null,milestone:r.document.milestone?{key:r.document.milestone.key,state:r.document.milestone.state}:null,uncertainty:r.document.uncertainty,observedAt:new Date(r.document.observedAt).toISOString(),reviewState:r.document.reviewState})),progressTruncated:allFacts.length>20,
        evidenceCounts:{checklists:field.filter(r=>r.document.kind==='checklist').length,inspections:field.filter(r=>r.document.observationClass==='inspection').length,files:field.filter(r=>r.document.kind==='file').length,notes:field.filter(r=>r.document.kind==='note').length},
        operationalCounts:{laborIntervals:work.evidence.labor.length,materialMovements:work.evidence.materials.length,equipmentEvents:work.evidence.equipmentEvents.length},pendingProposal:proposal?{...pin(proposal),decidedAt:proposal.decidedAt,expiresAt:proposal.expiresAt}:null}});
  }
  const value={version:'m23-part9b-overview-v1',authority:'isolated_demo_postgresql',readOnly:true,scope:'owner_admin',evaluatedAt:now.toISOString(),filter,capacity:{status:'unknown'},pagination:{limit:25,offset:0,returned:records.length,total:records.length,nextCursor:null},records};
  return {...value,dataDigest:sha256(value)};
}
module.exports = { VERSION, EMPTY_REQUIREMENTS, validateState, ledger, workFor, context, assertAuthority, timeZoneAuthority, gateSnapshot, apply, replay, pin, completionBody, completionReview, readDetail, overview };
