'use strict';

const { readDeclaredAvailabilitySnapshot } = require('../../src/forecasting/declaredAvailabilitySnapshot');

const organizationId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const authSessionId = '33333333-3333-4333-8333-333333333333';
const workerId = '44444444-4444-4444-8444-444444444444';
const start = '2026-10-02T12:00:00.000Z';
const end = '2026-10-02T16:00:00.000Z';
const input = () => ({ organizationId, actorUserId, actorAccessRole: 'owner',
  authSessionId, expectedTimeZone: 'America/New_York',
  horizon: { startsAt: start, endsAt: end } });

function fixture(options = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (options.failOn && sql.includes(options.failOn)) throw new Error('database offline');
      if (sql.startsWith('BEGIN') || sql.startsWith('SET LOCAL') ||
          sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('SELECT id FROM public.organizations')) return { rowCount: 1, rows: [{ id: organizationId }] };
      if (sql.includes('JOIN public.auth_sessions session')) return { rows: [{
        id: actorUserId, role: 'owner', status: options.actorStatus || 'active',
        membership_status: options.actorStatus || 'active', operational_role: 'owner',
        session_status: 'active', access_expires_at: '2027-01-01T00:00:00.000Z',
        subscription_status: 'active', onboarding_status: 'complete',
      }] };
      if (sql.includes('FROM public.organization_onboarding onboarding')) return {
        rowCount: 1, rows: [{ id: organizationId, version_number: 3,
          normalized_profile_hash: 'a'.repeat(64),
          raw_profile: { hours: { friday: { open: '08:00', close: '17:00' } } },
          time_zone: 'America/New_York' }],
      };
      if (sql.includes('pg_current_snapshot()')) return { rows: [{
        observed_at: '2026-09-22T02:00:00.100001Z', snapshot_id: '100:100:' }] };
      if (sql.includes('FROM public.workforce_profiles profile') && sql.includes('JOIN public.users account')) {
        return { rows: options.roster || [{ profile_id: workerId,
          operational_role: 'technician', home_location_id: 'headquarters',
          profile_updated_at: '2026-09-21T12:00:00.000Z',
          membership_updated_at: '2026-09-21T12:00:00.000Z' }] };
      }
      if (sql.includes('FROM public.workforce_profile_skills relation')) return { rows: [] };
      if (sql.includes('FROM public.canonical_workforce_availability_authorities')) return {
        rowCount: options.noAvailability ? 0 : 1, rows:
        options.noAvailability ? [] : [{ workforce_profile_id: workerId, id: authSessionId,
          revision: 2, canonical_digest: 'b'.repeat(64),
          coverage_start: start, coverage_end: end,
          updated_at: '2026-09-21T12:00:00.000Z' }] };
      if (sql.includes('FROM public.canonical_workforce_availability_intervals interval')) return {
        rows: [{ workforce_profile_id: workerId, ordinal: 0, interval_kind: 'available',
          starts_at: start, ends_at: end }],
      };
      if (sql.includes('FROM public.canonical_schedule_assignments assignment')) return {
        rows: options.schedules || [],
      };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { released = true; },
  };
  return { pool: { connect: async () => client }, calls,
    get released() { return released; } };
}

test('reads guarded M22 availability without claiming capacity or qualification', async () => {
  const source = fixture();
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result.state).toBe('source_snapshot');
  expect(result.basis.members).toHaveLength(1);
  expect(result.basis.members[0].availability.revision).toBe(2);
  expect(result.basis.members[0].availability.intervals).toHaveLength(1);
  expect(result.basis.approvedScheduledAssignments).toEqual([]);
  expect(result.sourceAuthenticated).toBe(true);
  expect(result.temporalCutoffVerified).toBe(false);
  expect(result.basis.observedAt).toBe('2026-09-22T02:00:00.100001Z');
  expect(result.basis.snapshotId).toBe('100:100:');
  expect(result.roleQualificationVerified).toBe(false);
  expect(result.reviewedWorkProfilesRead).toBe(true);
  expect(result.basis.members[0].reviewedWorkProfile).toBeNull();
  expect(result.commitmentsCovered).toBe(false);
  expect(result.approvedScheduleIntervalsRead).toBe(true);
  expect(result.forecastIssued).toBe(false);
  expect(result.sourceSnapshotDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(Object.isFrozen(result.basis.members[0].availability.intervals)).toBe(true);
  expect(source.calls.some(call => call.sql.includes('JOIN public.auth_sessions session'))).toBe(true);
  expect(source.calls.findIndex(call => call.sql.includes('pg_current_snapshot()'))).toBeGreaterThan(
    source.calls.findIndex(call => call.sql.startsWith('SELECT id FROM public.organizations')));
  expect(source.calls.some(call => call.sql.includes("profile.organization_id = $1"))).toBe(true);
  expect(source.calls.some(call => call.sql.includes('($2::uuid IS NULL OR assignment.id <> $2::uuid)'))).toBe(true);
  expect(source.calls.at(-1).sql).toBe('COMMIT');
  expect(source.released).toBe(true);
});

test('preserves approved certification evidence without claiming job qualification', async () => {
  const source = fixture({ roster: [{ profile_id: workerId,
    operational_role: 'technician', home_location_id: 'headquarters',
    profile_updated_at: '2026-09-21T12:00:00.000Z',
    membership_updated_at: '2026-09-21T12:00:00.000Z',
    work_profile_event_id: authSessionId, work_profile_revision: 2,
    work_profile_status: 'approved', work_profile_recorded_at: '2026-09-21T13:00:00.000Z',
    verified_certification_ids: ['cert-a'],
    work_profile_certifications: [{ id: 'cert-a', expiresOn: '2026-12-31' }],
  }] });
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result.basis.members[0].reviewedWorkProfile).toEqual({
    eventId: authSessionId, revision: 2, reviewStatus: 'approved',
    recordedAt: '2026-09-21T13:00:00.000Z',
    approvalRecordedCertifications: [{ id: 'cert-a', expiresOn: '2026-12-31' }],
  });
  expect(result.roleQualificationVerified).toBe(false);
  expect(result.forecastIssued).toBe(false);
  expect(Object.isFrozen(result.basis.members[0].reviewedWorkProfile.approvalRecordedCertifications)).toBe(true);
  expect(source.calls.some(call => call.sql.includes('FROM public.canonical_work_profile_events event'))).toBe(true);
});

test('a revoked profile cannot retain reviewed certification authority', async () => {
  const source = fixture({ roster: [{ profile_id: workerId,
    operational_role: 'technician', home_location_id: 'headquarters',
    profile_updated_at: start, membership_updated_at: start,
    work_profile_event_id: authSessionId, work_profile_revision: 3,
    work_profile_status: 'revoked', work_profile_recorded_at: start,
    verified_certification_ids: [],
    work_profile_certifications: [{ id: 'cert-a', expiresOn: null }],
  }] });
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result.basis.members[0].reviewedWorkProfile.reviewStatus).toBe('revoked');
  expect(result.basis.members[0].reviewedWorkProfile.approvalRecordedCertifications).toEqual([]);
  expect(result.roleQualificationVerified).toBe(false);
});

test('inconsistent reviewed-certification evidence fails closed', async () => {
  const source = fixture({ roster: [{ profile_id: workerId,
    operational_role: 'technician', home_location_id: 'headquarters',
    profile_updated_at: start, membership_updated_at: start,
    work_profile_event_id: authSessionId, work_profile_revision: 2,
    work_profile_status: 'approved', work_profile_recorded_at: start,
    verified_certification_ids: ['missing'],
    work_profile_certifications: [{ id: 'cert-a', expiresOn: null }],
  }] });
  await expect(readDeclaredAvailabilitySnapshot(source.pool, input())).rejects.toMatchObject({
    code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', status: 503 });
  expect(source.calls.at(-1).sql).toBe('ROLLBACK');
});

const scheduled = overrides => ({ id: authSessionId, revision: 2,
  canonical_digest: 'c'.repeat(64), scheduled_start: start, scheduled_end: end,
  approved: true, profile_ids: [workerId], targets_truncated: false,
  ...overrides });

test('includes approved scheduled worker intervals from the same transaction', async () => {
  const source = fixture({ schedules: [scheduled()] });
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result.state).toBe('source_snapshot');
  expect(result.basis.approvedScheduledAssignments).toEqual([{
    assignmentId: authSessionId, revision: 2, digest: 'c'.repeat(64),
    scheduledStart: start, scheduledEnd: end, approved: true, profileIds: [workerId],
  }]);
  expect(Object.isFrozen(result.basis.approvedScheduledAssignments[0].profileIds)).toBe(true);
  expect(source.calls.find(call => call.sql.includes('FROM public.canonical_schedule_assignments assignment'))
    .params[1]).toBeNull();
  expect(result.commitmentsCovered).toBe(false);
  expect(result.forecastIssued).toBe(false);
});

test.each([
  [scheduled({ approved: false })],
  [scheduled({ profile_ids: [] })],
  [scheduled({ profile_ids: [actorUserId] })],
])('unapproved or unresolved worker assignment withholds the source', async schedule => {
  const source = fixture({ schedules: [schedule] });
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result).toEqual({ state: 'unavailable', reason: 'schedule_commitment_unresolved',
    forecastIssued: false });
});

test('bounded schedule evidence is unavailable, never silently partial', async () => {
  const source = fixture({ schedules: Array.from({ length: 1001 }, () => scheduled()) });
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result.reason).toBe('schedule_evidence_bounded');
});

test('missing declared availability withholds the source snapshot', async () => {
  const source = fixture({ noAvailability: true });
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result).toEqual({ state: 'unavailable', reason: 'declared_availability_incomplete', forecastIssued: false });
  expect(source.released).toBe(true);
});

test('a horizon that begins before the observed snapshot time is withheld', async () => {
  const source = fixture();
  const result = await readDeclaredAvailabilitySnapshot(source.pool, {
    ...input(), horizon: { startsAt: '2026-09-22T02:00:00.100Z', endsAt: end },
  });
  expect(result.reason).toBe('working_hours_or_future_window_unavailable');
});

test('the owning M22 permission check refuses an inactive actor', async () => {
  const source = fixture({ actorStatus: 'inactive' });
  await expect(readDeclaredAvailabilitySnapshot(source.pool, input())).rejects.toMatchObject({
    code: 'M22_EVALUATION_FORBIDDEN', status: 403 });
  expect(source.calls.at(-1).sql).toBe('ROLLBACK');
  expect(source.released).toBe(true);
});

test('bounded roster never becomes a complete snapshot', async () => {
  const row = { profile_id: workerId, operational_role: 'technician',
    profile_updated_at: start, membership_updated_at: start };
  const source = fixture({ roster: Array.from({ length: 101 }, () => row) });
  const result = await readDeclaredAvailabilitySnapshot(source.pool, input());
  expect(result.reason).toBe('workforce_evidence_bounded');
  expect(source.calls.some(call => call.sql.includes('FROM public.workforce_profile_skills relation'))).toBe(false);
});

test('malformed window is rejected before database access', async () => {
  const source = fixture();
  await expect(readDeclaredAvailabilitySnapshot(source.pool,
    { ...input(), horizon: { startsAt: end, endsAt: start } }))
    .rejects.toMatchObject({ code: 'M26_AVAILABILITY_SNAPSHOT_INVALID' });
  expect(source.calls).toHaveLength(0);
});

test('database failures roll back and cannot expose partial evidence', async () => {
  const source = fixture({ failOn: 'FROM public.canonical_workforce_availability_authorities' });
  await expect(readDeclaredAvailabilitySnapshot(source.pool, input())).rejects.toMatchObject({
    code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', status: 503 });
  expect(source.calls.at(-1).sql).toBe('ROLLBACK');
  expect(source.released).toBe(true);
});
