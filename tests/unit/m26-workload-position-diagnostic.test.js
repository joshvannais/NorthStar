'use strict';

const { VERSION, MAX_RECORDS, summarizeWorkloadPosition } =
  require('../../src/forecasting/workloadPositionDiagnostic');

const organizationId = 'b5000000-0000-4000-8000-000000000001';
const asOf = '2026-09-21T12:00:00.000Z';
const workId = n => `b6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const work = (n, changes = {}) => ({
  workId: workId(n), organizationId, revision: 2, digest: 'a'.repeat(64),
  recordedAt: '2026-09-21T11:00:00.000Z', approvalState: 'approved',
  scheduleState: 'scheduled', progressState: 'not_started',
  remainingPersonMinutes: 120, remainingBasis: 'approved_plan', ...changes,
});
const input = (records, changes = {}) => ({
  version: VERSION, organizationId, asOf, sourceSnapshotDigest: 'b'.repeat(64),
  coverage: { state: 'complete', recordedThrough: asOf, hasMore: false },
  records, ...changes,
});
const run = value => summarizeWorkloadPosition(value);

describe('Mission 26 Part 5A workload position diagnostic', () => {
  test('separates scheduled and unscheduled approved remaining person-minutes without counting completed work', () => {
    const result = run(input([
      work(1), work(2, { scheduleState: 'unscheduled', remainingPersonMinutes: 91 }),
      work(3, { progressState: 'accepted_complete', scheduleState: 'unknown',
        remainingPersonMinutes: 0, remainingBasis: null }),
    ]));
    expect(result).toMatchObject({ state: 'descriptive_only', organizationId, asOf,
      sourceSnapshotDigest: 'b'.repeat(64), scheduledPersonMinutes: 120,
      unscheduledPersonMinutes: 91, totalPersonMinutes: 211, includedWorkCount: 2,
      reviewedRecordCount: 3, sourceAuthenticated: false, forecastIssued: false });
  });

  test('in-progress work requires a reviewed remaining-work basis', () => {
    expect(run(input([work(1, { progressState: 'in_progress' })]))).toMatchObject({
      state: 'unavailable', reason: 'unresolved_work_basis', totalPersonMinutes: null,
    });
    expect(run(input([work(1, { progressState: 'in_progress', remainingBasis: 'reviewed_remaining',
      remainingPersonMinutes: 35 })]))).toMatchObject({
      state: 'descriptive_only', totalPersonMinutes: 35,
    });
  });

  test.each([
    { approvalState: 'unapproved' }, { approvalState: 'unknown' },
    { scheduleState: 'unknown' }, { progressState: 'unknown' },
    { remainingPersonMinutes: null }, { remainingBasis: null },
    { progressState: 'accepted_complete', remainingPersonMinutes: 1 },
  ])('withholds the whole total when a consequential work state is unresolved: %p', change => {
    const result = run(input([work(1), work(2, change)]));
    expect(result).toMatchObject({ state: 'unavailable', reason: 'unresolved_work_basis',
      scheduledPersonMinutes: null, unscheduledPersonMinutes: null,
      totalPersonMinutes: null, includedWorkCount: null });
  });

  test.each([
    { state: 'incomplete', recordedThrough: asOf, hasMore: false },
    { state: 'revoked', recordedThrough: asOf, hasMore: false },
    { state: 'complete', recordedThrough: asOf, hasMore: true },
    { state: 'complete', recordedThrough: '2026-09-21T11:59:59.000Z', hasMore: false },
    { state: 'complete', recordedThrough: '2026-09-21T12:00:01.000Z', hasMore: false },
  ])('does not turn an incomplete or off-cutoff source into zero workload: %p', coverage => {
    expect(run(input([], { coverage }))).toMatchObject({ state: 'unavailable',
      reason: 'incomplete_source_coverage', totalPersonMinutes: null });
  });

  test('a complete empty source is still only a descriptive diagnostic, never an issued forecast', () => {
    expect(run(input([]))).toMatchObject({ state: 'descriptive_only',
      totalPersonMinutes: 0, sourceAuthenticated: false, forecastIssued: false });
  });

  test('rejects duplicate, cross-tenant, future, malformed and over-bound work records', () => {
    for (const records of [
      [work(1), work(1)], [work(1, { organizationId: workId(9) })],
      [work(1, { recordedAt: '2026-09-21T12:00:01.000Z' })],
      [work(1, { remainingPersonMinutes: -1 })],
      Array.from({ length: MAX_RECORDS + 1 }, (_, n) => work(n + 1)),
    ]) {
      expect(() => run(input(records))).toThrow('Workload position details are invalid.');
    }
  });
});
