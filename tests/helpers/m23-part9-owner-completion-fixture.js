'use strict';

const id = n => `e2900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-09-09T12:00:00.000Z';
const input = { organizationId: id(1), actorUserId: id(2), actorAccessRole: 'owner', authSessionId: id(3) };

function rawRecord(kind = 'proposal', overrides = {}) {
  return {
    id: id(10), executionId: id(4), assignmentId: id(6), rootId: id(10), previousRecordId: null,
    recordKind: kind, subjectKind: kind, revision: 1, digest: 'd'.repeat(64),
    resultingExecutionRevision: 3, resultingExecutionDigest: 'a'.repeat(64),
    lifecycleBefore: 'in_progress', lifecycleAfter: 'completion_pending',
    decidedAt: NOW, expiresAt: '2026-09-09T13:00:00.000Z', reason: 'Recorded completion decision',
    relatedProposalId: null, relatedCompletionId: null,
    document: { kind, contractVersion: 'm23-completion-authority-v1', ...(kind === 'reopening' ? { nextAction: 'Recheck the completed seal' } : {}) },
    gateSnapshot: {
      contractVersion: 'm23-completion-gates-v1', executionId: id(4),
      requirements: { checklists: [], inspections: [], files: [] },
      labor: { count: 1 }, materials: { count: 2 }, progress: { count: 1 },
      fieldEvidence: { count: 3 }, equipment: { count: 0 }, hardGatesPassed: true,
      gateResults: ['required_checklists', 'required_inspections', 'required_files',
        'unresolved_blockers_or_exceptions', 'progress_review', 'open_labor_timers',
        'labor_review', 'material_review', 'equipment_checkout', 'equipment_downtime',
        'field_evidence_review'].map(gate => ({ gate, hard: true, passed: true })),
    }, ...overrides,
  };
}

function raw(state = 'completion_pending') {
  const record = rawRecord(state === 'completed' ? 'approval' : state === 'reopened' ? 'reopening' : 'proposal', {
    lifecycleAfter: state,
  });
  return { success: true, data: {
    execution: { id: id(4), appointmentId: id(5), assignmentId: id(6), revision: 3,
      digest: 'a'.repeat(64), sourceAssignmentRevision: 4, sourceAssignmentDigest: 'b'.repeat(64), lifecycleState: state },
    activeProposal: state === 'completion_pending' ? { ...record, expired: false } : null,
    records: [record], totalRecordCount: 1, truncated: false, authority: 'postgresql', completionInferred: false,
  } };
}

function context(overrides = {}) {
  return { assignment_id: id(6), appointment_id: id(5), revision: '4', digest: 'b'.repeat(64),
    title: 'Kitchen sink repair', onboarding_status: 'complete', subscription_status: 'active',
    server_now: NOW, trial_started_at: null, trial_ends_at: null, ...overrides };
}

async function createDatabaseFixture() {
  // Uses the existing synthetic accepted-scheduling baseline, not production
  // scheduling evidence. All completion reads/writes use mounted production code.
  return require('./m23-part9b-overview-fixture').createDatabaseFixture();
}

module.exports = { id, NOW, input, rawRecord, raw, context, createDatabaseFixture };
