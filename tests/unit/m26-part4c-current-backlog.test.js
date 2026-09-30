'use strict';

const fs = require('node:fs');
const { safeSnapshot } = require('../../src/routes/forecastCurrentBacklog');

const id = '11111111-1111-4111-8111-111111111111';
const digest = 'a'.repeat(64);
const base = {
  id, version: 'm26-current-backlog-position-v1',
  targetKey: 'demand.current_backlog_position.v1', state: 'descriptive_subset',
  reason: null, capturedAt: '2026-09-30T06:00:00.000000Z',
  approvedUnscheduledCount: 1, approvedScheduledCount: 2,
  workInProgressCount: 3, completedCount: 4, unresolvedLinkageCount: 0,
  knownBacklogCount: 6, plannedPersonMinutes: null,
  backlogHoursState: 'unavailable',
  backlogHoursReason: 'approved_person_hour_plan_missing',
  sourceDigest: digest, snapshotDigest: digest,
  sourceAuthority: 'northstar_authenticated_booking_schedule_and_execution_current_position',
  sourceAuthenticated: true, knownSubsetOnly: true, sourceCoverageComplete: false,
  offPlatformCoverageVerified: false, providerCoverageVerified: false,
  probabilityCalibrated: false, forecastIssued: false, paidNumericServing: false,
};

describe('Mission 26 Part 4C current backlog boundary', () => {
  test('accepts a bounded descriptive subset and rejects fabricated numeric authority', () => {
    expect(safeSnapshot(base, id)).toEqual(base);
    for (const change of [
      { knownBacklogCount: 7 }, { plannedPersonMinutes: 120 },
      { sourceCoverageComplete: true }, { forecastIssued: true },
      { paidNumericServing: true }, { probabilityCalibrated: true },
      { id: 'not-a-uuid' }, { capturedAt: '2026-09-31T00:00:00Z' },
    ]) expect(safeSnapshot({ ...base, ...change }, id)).toBeNull();
  });

  test('requires exact unavailable, partial and stale shapes', () => {
    expect(safeSnapshot({ ...base, state: 'partial',
      reason: 'unresolved_linkage_present', unresolvedLinkageCount: 1 })).not.toBeNull();
    expect(safeSnapshot({ ...base, state: 'unavailable',
      reason: 'no_authenticated_approved_booking_history',
      approvedUnscheduledCount: 0, approvedScheduledCount: 0,
      workInProgressCount: 0, completedCount: 0,
      unresolvedLinkageCount: 0, knownBacklogCount: 0 })).not.toBeNull();
    expect(safeSnapshot({ ...base, state: 'source_stale',
      reason: 'source_changed_after_capture',
      approvedUnscheduledCount: 0, approvedScheduledCount: 0,
      workInProgressCount: 0, completedCount: 0,
      unresolvedLinkageCount: 0, knownBacklogCount: 0,
      sourceAuthenticated: false, sourceDigest: null, snapshotDigest: null })).not.toBeNull();
  });

  test('migration bounds identities before enrichment and keeps private authority false', () => {
    const sql = fs.readFileSync(
      'migrations/207_canonical_forecast_current_backlog_position.sql', 'utf8');
    const preflight = sql.indexOf('LIMIT 501) bounded_candidates');
    const refusal = sql.indexOf('IF candidate_count>500');
    const enrichment = sql.indexOf('WITH candidates AS');
    expect(preflight).toBeGreaterThan(0);
    expect(refusal).toBeGreaterThan(preflight);
    expect(enrichment).toBeGreaterThan(refusal);
    expect(sql).toContain("'knownSubsetOnly',TRUE,'sourceCoverageComplete',FALSE");
    expect(sql).toContain("'plannedPersonMinutes',NULL");
    expect(sql).toContain('LOCK TABLE public.canonical_schedule_assignments IN SHARE MODE NOWAIT');
    expect(sql).toContain('LOCK TABLE public.canonical_field_executions IN SHARE MODE NOWAIT');
    expect(sql).toContain('REVOKE ALL ON TABLE public.canonical_forecast_current_backlog_snapshots FROM PUBLIC');
  });
});
