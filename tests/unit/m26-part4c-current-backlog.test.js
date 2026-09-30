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
    const candidateStart = sql.indexOf('SELECT count(*)::integer INTO candidate_count');
    const preflight = sql.indexOf('LIMIT 501) bounded_candidates');
    const refusal = sql.indexOf('IF candidate_count>500');
    const enrichment = sql.indexOf('WITH candidates AS');
    const assignmentFence = sql.indexOf(
      'LOCK TABLE public.canonical_schedule_assignments IN SHARE ROW EXCLUSIVE MODE');
    const eventFence = sql.indexOf(
      'LOCK TABLE public.canonical_forecast_schedule_booking_events\n IN SHARE ROW EXCLUSIVE MODE');
    const backfill = sql.indexOf(
      'INSERT INTO public.canonical_forecast_current_backlog_booking_positions');
    const eventTrigger = sql.indexOf(
      'CREATE TRIGGER canonical_forecast_current_backlog_booking_event_sync');
    const assignmentTrigger = sql.indexOf(
      'CREATE TRIGGER canonical_forecast_current_backlog_assignment_sync');
    const captureStart = sql.indexOf(
      'CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_capture');
    const captureEnd = sql.indexOf(
      'CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_read');
    expect(candidateStart).toBeGreaterThan(0);
    expect(preflight).toBeGreaterThan(candidateStart);
    expect(refusal).toBeGreaterThan(preflight);
    expect(enrichment).toBeGreaterThan(refusal);
    expect(sql).toContain("'knownSubsetOnly',TRUE,'sourceCoverageComplete',FALSE");
    expect(sql).toContain("'plannedPersonMinutes',NULL");
    expect(sql).toContain('canonical_forecast_current_backlog_booking_positions_active');
    expect(sql.slice(captureStart, captureEnd)).not.toContain(
      'LOCK TABLE public.canonical_schedule_assignments');
    expect(sql.slice(captureStart, captureEnd)).not.toContain(
      'LOCK TABLE public.canonical_field_executions');
    expect(sql.slice(candidateStart, enrichment)).toContain(
      'canonical_forecast_current_backlog_booking_positions');
    expect(sql.slice(candidateStart, enrichment)).not.toContain(
      'canonical_forecast_schedule_booking_events');
    expect(sql).toContain('execution_value.assignment_id<>assignment.id');
    expect(sql).toContain('execution_value.source_assignment_revision<>assignment.revision');
    expect(sql).toContain("rtrim(execution_value.source_assignment_digest)<>");
    expect(assignmentFence).toBeGreaterThan(0);
    expect(eventFence).toBeGreaterThan(assignmentFence);
    expect(backfill).toBeGreaterThan(eventFence);
    expect(eventTrigger).toBeGreaterThan(backfill);
    expect(assignmentTrigger).toBeGreaterThan(eventTrigger);
    expect(sql).toContain('REVOKE ALL ON TABLE public.canonical_forecast_current_backlog_snapshots FROM PUBLIC');
  });
});
