'use strict';

const EXECUTION = 'e1900000-0000-4000-8000-000000000001';
const APPOINTMENT = 'd1900000-0000-4000-8000-000000000001';
const INSTANT = '2026-09-08T12:00:00.000000Z';

function record(scope = 'owner_admin', overrides = {}) {
  const value = {
    executionId: EXECUTION, appointmentId: APPOINTMENT,
    title: 'Kitchen sink repair', serviceType: 'Plumbing',
    createdAt: INSTANT, updatedAt: INSTANT, lifecycleState: 'in_progress',
    schedule: { state: 'scheduled', start: '2026-09-08T13:00:00.000000Z',
      end: '2026-09-08T15:00:00.000000Z', timeZone: 'America/New_York' },
    assignment: { kind: 'worker', label: 'Alex Rivera', current: true },
    progress: { recorded: 1, needsReview: 1, uncertain: 0 },
    blockers: { open: 0 }, exceptions: { open: 0 },
    approval: { state: 'none' },
    evidence: { state: 'not_evaluated', recorded: 2 },
    capacity: { status: 'unknown', recordedConstraints: 0 },
  };
  if (scope === 'owner_admin') {
    value.ownerDetails = {
      progress: [{ workKey: 'sink', quantity: { completed: '1', total: '2', unit: 'ea' },
        milestone: null, uncertainty: 'measured', observedAt: INSTANT, reviewState: 'needs_review' }],
      progressTruncated: false,
      evidenceCounts: { checklists: 1, inspections: 0, files: 0, notes: 1 },
      operationalCounts: { laborIntervals: 1, materialMovements: 0, equipmentEvents: 0 },
      pendingProposal: null,
    };
  }
  return { ...value, ...overrides };
}

function overview(scope = 'owner_admin', overrides = {}) {
  return {
    version: 'm23-part9b-overview-v1', authority: 'postgresql', readOnly: true,
    scope, evaluatedAt: INSTANT, dataDigest: 'a'.repeat(64),
    filter: 'active', capacity: { status: 'unknown' },
    pagination: { limit: 25, offset: 0, returned: 1, total: 1, nextCursor: null },
    records: [record(scope)], ...overrides,
  };
}

module.exports = { EXECUTION, APPOINTMENT, INSTANT, record, overview };
