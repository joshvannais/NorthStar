'use strict';
const crypto = require('crypto');
const contract = require('../../public/js/completion-review-contract');
const { projectSubscription, canMutateInternal } = require('../accounts/subscriptionPolicy');
const pin = record => ({ id: record.id, revision: record.revision, digest: record.digest });
function invalid() { throw new Error('COMPLETION_REVIEW_INVALID'); }

function projectReview(body, context, input, demo) {
  if (!input || !['owner', 'admin'].includes(input.actorAccessRole) || !body || body.success !== true || !body.data || !context) invalid();
  const data = body.data, execution = data.execution;
  if (data.authority !== (demo ? 'isolated_demo_postgresql' : 'postgresql') || data.completionInferred !== false || !execution || !Array.isArray(data.records) ||
    data.records.length > 200 || input.executionId && execution.id !== input.executionId ||
    context.assignment_id !== execution.assignmentId || context.appointment_id !== execution.appointmentId) invalid();
  const assignment = { id: context.assignment_id, revision: Number(context.revision), digest: context.digest,
    changed: Number(context.revision) !== execution.sourceAssignmentRevision || context.digest !== execution.sourceAssignmentDigest };
  const records = data.records.map(record => {
    if (record.executionId !== execution.id || record.assignmentId !== execution.assignmentId || !record.document) invalid();
    return { ...pin(record), rootId: record.rootId, previousRecordId: record.previousRecordId, kind: record.recordKind,
      subjectKind: record.subjectKind, decidedAt: record.decidedAt, reason: record.reason,
      note: record.recordKind === 'correction' ? record.document.annotation && record.document.annotation.note : null,
      nextAction: record.recordKind === 'reopening' ? record.document.nextAction : record.recordKind === 'correction'
        ? record.document.annotation && record.document.annotation.nextAction : null,
      lifecycleBefore: record.lifecycleBefore, lifecycleAfter: record.lifecycleAfter };
  });
  const proposal = data.activeProposal;
  let projectedProposal = null;
  if (proposal) {
    if (proposal.executionId !== execution.id || proposal.assignmentId !== execution.assignmentId || proposal.recordKind !== 'proposal' ||
      proposal.resultingExecutionRevision !== execution.revision || proposal.resultingExecutionDigest !== execution.digest) invalid();
    const gates = proposal.gateSnapshot;
    if (!gates || gates.contractVersion !== 'm23-completion-gates-v1' || gates.executionId !== execution.id ||
      !Array.isArray(gates.gateResults) || !gates.requirements) invalid();
    projectedProposal = { pin: pin(proposal), decidedAt: proposal.decidedAt, expiresAt: proposal.expiresAt, expired: proposal.expired,
      reason: proposal.reason, gates: gates.gateResults.map(gate => ({ code: gate.gate, passed: gate.passed, count: gate.count === undefined ? null : gate.count })),
      evidenceCounts: Object.fromEntries(['checklists', 'inspections', 'files'].map(key => {
        if (!Array.isArray(gates.requirements[key]) || gates.requirements[key].length > 20) invalid();
        return [key, gates.requirements[key].length];
      }).concat(['labor', 'materials', 'progress', 'fieldEvidence', 'equipment'].map(key => [key, gates[key] && gates[key].count]))) };
  }
  const readOnlyReason = demo ? (context.mutationsEnabled ? null : 'operations_paused') : context.onboarding_status !== 'complete' ? 'onboarding_incomplete' :
    canMutateInternal(projectSubscription(context)) ? null : 'subscription_read_only';
  const commands = [];
  const add = (action, record) => commands.push({ action, target: record ? pin(record) : null });
  if (readOnlyReason === null) {
    if (proposal && !proposal.expired) add('approve_completion', proposal);
    if (!['completed', 'cancelled'].includes(execution.lifecycleState)) add('cancel_execution', proposal);
    const current = kind => data.records.find(record => record.recordKind === kind &&
      record.resultingExecutionRevision === execution.revision && record.resultingExecutionDigest === execution.digest);
    if (execution.lifecycleState === 'completed' && current('approval')) add('reopen_execution', current('approval'));
    if (execution.lifecycleState === 'reopened' && current('reopening')) add('resume_reopened', current('reopening'));
    if (data.truncated === false) for (const record of data.records) {
      if (!data.records.some(successor => successor.previousRecordId === record.id)) add('correct_completion', record);
    }
  }
  return contract.validate({ version: contract.VERSION, authority: demo ? 'isolated_demo_postgresql' : 'postgresql',
    scopeDigest: crypto.createHash('sha256').update(JSON.stringify([input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId])).digest('hex'),
    evaluatedAt: new Date(context.server_now).toISOString(), title: context.title,
    execution: { id: execution.id, appointmentId: execution.appointmentId, lifecycleState: execution.lifecycleState,
      revision: execution.revision, digest: execution.digest, assignment },
    proposal: projectedProposal, history: { records, total: data.totalRecordCount, truncated: data.truncated }, commands, readOnlyReason }, { demo: demo === true });
}
function projectOwnerReview(body, context, input) { return projectReview(body, context, input, false); }
function projectDemoOwnerReview(body, context, input) { return projectReview(body, context, input, true); }
module.exports = { projectOwnerReview, projectDemoOwnerReview };
