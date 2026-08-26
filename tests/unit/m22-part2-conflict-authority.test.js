'use strict';

const {
  ConflictContractError,
  MAXIMUM_INTERVALS,
  normalizeAvailabilityMutation,
  normalizeConflictEvaluation,
} = require('../../src/scheduling/conflictContract');
const { evaluateConflictEvidence } = require('../../src/scheduling/conflictEvaluator');

const PROFILE = 'a8000000-0000-4000-8000-000000000001';
const CREW = 'a8100000-0000-4000-8000-000000000001';
const APPOINTMENT = 'a7000000-0000-4000-8000-000000000001';
const DIGEST = 'a'.repeat(64);

function weekdays(open = '08:00', close = '18:00') {
  return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .reduce(function (result, day) {
      result[day] = { open, close, lunch: '', emergency: false, afterHours: false, holiday: false };
      return result;
    }, { holidays: [] });
}

function baseInput() {
  return {
    proposal: {
      target: { kind: 'profile', id: PROFILE },
      scheduledStart: '2027-03-08T15:00:00.000Z',
      scheduledEnd: '2027-03-08T16:00:00.000Z',
      submittedScheduledStart: '2027-03-08T10:00:00-05:00',
      submittedScheduledEnd: '2027-03-08T11:00:00-05:00',
      timeZone: 'America/New_York',
    },
    businessProfile: {
      company: { timeZone: 'America/New_York' },
      headquarters: { additionalOffices: [{ id: 'north', name: 'North' }] },
      hours: weekdays(),
      scheduling: { maxJobsPerDay: 4, workDayLength: 8, appointmentBuffer: 15, travelBuffer: 10 },
      crew: { maxCrewSize: 4 },
    },
    appointment: { serviceId: 'plumbing', locationId: 'headquarters' },
    skillAuthorityKnown: true,
    candidate: {
      exists: true,
      kind: 'profile',
      targetId: PROFILE,
      locationId: 'headquarters',
      members: [{
        profileId: PROFILE,
        membershipStatus: 'active',
        userStatus: 'active',
        serviceIds: ['plumbing'],
        availability: {
          coverageStart: '2027-03-01T05:00:00.000Z',
          coverageEnd: '2027-04-01T04:00:00.000Z',
          intervals: [{
            ordinal: 0,
            kind: 'available',
            start: '2027-03-01T05:00:00.000Z',
            end: '2027-04-01T04:00:00.000Z',
          }],
        },
      }],
    },
    schedules: [],
    scheduleSetTruncated: false,
  };
}

describe('Mission 22 Part 2 conflict contract', () => {
  test('normalizes exact availability evidence into stable UTC ordering', () => {
    const result = normalizeAvailabilityMutation({
      profileId: PROFILE,
      idempotencyKey: 'availability-key-00000001',
      body: {
        expectedRevision: 0,
        expectedDigest: null,
        expectedTimeZone: 'America/New_York',
        coverageStart: '2027-03-01T00:00:00-05:00',
        coverageEnd: '2027-04-01T00:00:00-04:00',
        intervals: [
          { kind: 'unavailable', start: '2027-03-10T14:00:00-05:00', end: '2027-03-10T15:00:00-05:00' },
          { kind: 'available', start: '2027-03-08T08:00:00-05:00', end: '2027-03-08T17:00:00-05:00' },
        ],
        reason: 'Dispatcher declared the reviewed availability window.',
      },
    });
    expect(result.intervals).toEqual([
      { ordinal: 0, kind: 'available', start: '2027-03-08T13:00:00.000Z', end: '2027-03-08T22:00:00.000Z' },
      { ordinal: 1, kind: 'unavailable', start: '2027-03-10T19:00:00.000Z', end: '2027-03-10T20:00:00.000Z' },
    ]);
    expect(result.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.idempotencyKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('enforces explicit resource and time-zone boundaries with stable 4xx identities', () => {
    expect(MAXIMUM_INTERVALS).toBe(512);
    const base = {
      profileId: PROFILE,
      idempotencyKey: 'availability-key-00000002',
      body: {
        expectedRevision: 0,
        expectedDigest: null,
        expectedTimeZone: 'America/New_York',
        coverageStart: '2027-01-01T00:00:00-05:00',
        coverageEnd: '2027-12-31T00:00:00-05:00',
        intervals: [],
        reason: 'Reviewed availability.',
      },
    };
    expect(() => normalizeAvailabilityMutation({
      ...base,
      body: { ...base.body, intervals: Array.from({ length: 513 }, () => ({
        kind: 'available', start: '2027-01-02T09:00:00-05:00', end: '2027-01-02T10:00:00-05:00',
      })) },
    })).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_AVAILABILITY_INTERVAL' }));
    expect(() => normalizeConflictEvaluation({
      appointmentId: APPOINTMENT,
      body: {
        expectedRevision: 1, expectedDigest: DIGEST, expectedTimeZone: 'America/New_York',
        target: { kind: 'profile', id: PROFILE },
        scheduledStart: '2027-03-14T02:30:00-05:00',
        scheduledEnd: '2027-03-14T04:00:00-04:00',
      },
    })).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_EVALUATION_INTERVAL' }));
  });

  test('accepts either explicit occurrence of a local fold and preserves the selected instant', () => {
    const first = normalizeConflictEvaluation({
      appointmentId: APPOINTMENT,
      body: {
        expectedRevision: 1, expectedDigest: DIGEST, expectedTimeZone: 'America/New_York',
        target: { kind: 'crew', id: CREW },
        scheduledStart: '2027-11-07T01:15:00-04:00', scheduledEnd: '2027-11-07T01:45:00-04:00',
      },
    });
    const second = normalizeConflictEvaluation({
      appointmentId: APPOINTMENT,
      body: {
        expectedRevision: 1, expectedDigest: DIGEST, expectedTimeZone: 'America/New_York',
        target: { kind: 'crew', id: CREW },
        scheduledStart: '2027-11-07T01:15:00-05:00', scheduledEnd: '2027-11-07T01:45:00-05:00',
      },
    });
    expect(first.proposal.scheduledStart).toBe('2027-11-07T05:15:00.000Z');
    expect(second.proposal.scheduledStart).toBe('2027-11-07T06:15:00.000Z');
  });

  test('rejects unsupported fields, ambiguous target shapes, and duplicate intervals', () => {
    expect(() => normalizeConflictEvaluation({
      appointmentId: APPOINTMENT,
      body: {
        expectedRevision: 1, expectedDigest: DIGEST, expectedTimeZone: 'America/New_York',
        target: { kind: 'unassigned', id: PROFILE },
        scheduledStart: '2027-03-08T10:00:00-05:00', scheduledEnd: '2027-03-08T11:00:00-05:00',
      },
    })).toThrow(ConflictContractError);
    expect(() => normalizeConflictEvaluation({
      appointmentId: APPOINTMENT,
      body: {
        expectedRevision: '1', expectedDigest: DIGEST, expectedTimeZone: 'America/New_York',
        target: { kind: 'profile', id: PROFILE },
        scheduledStart: '2027-03-08T10:00:00-05:00', scheduledEnd: '2027-03-08T11:00:00-05:00',
      },
    })).toThrow(expect.objectContaining({ code: 'INVALID_EVALUATION_PRECONDITION' }));
  });
});

describe('Mission 22 Part 2 deterministic evaluator', () => {
  test('returns clear only from complete current authority', () => {
    const result = evaluateConflictEvidence(baseInput());
    expect(result).toEqual({
      version: 1,
      status: 'clear',
      hardConflicts: [],
      warnings: [],
      needsReview: false,
      reviewReasons: [],
    });
  });

  test('classifies explicit unavailability, active-person overlap, skill and location mismatch as stable hard conflicts', () => {
    const input = baseInput();
    input.candidate.locationId = 'north';
    input.candidate.members[0].serviceIds = ['electrical'];
    input.candidate.members[0].availability.intervals.push({
      ordinal: 1, kind: 'unavailable',
      start: input.proposal.scheduledStart, end: input.proposal.scheduledEnd,
    });
    input.schedules.push({
      assignmentId: 'b7000000-0000-4000-8000-000000000001',
      revision: 2, digest: 'b'.repeat(64), approved: true,
      scheduledStart: input.proposal.scheduledStart, scheduledEnd: input.proposal.scheduledEnd,
      profileIds: [PROFILE],
    });
    const first = evaluateConflictEvidence(input);
    const second = evaluateConflictEvidence(JSON.parse(JSON.stringify(input)));
    expect(first).toEqual(second);
    expect(first.status).toBe('hard_conflict');
    expect(first.hardConflicts.map(value => value.code)).toEqual([
      'approved_schedule_overlap', 'declared_unavailable', 'location_scope_mismatch', 'required_skill_mismatch',
    ]);
  });

  test('keeps unapproved legacy overlap and missing/stale authority visible as needs_review', () => {
    const input = baseInput();
    input.candidate.members[0].availability = null;
    input.skillAuthorityKnown = false;
    input.appointment.locationId = null;
    input.schedules.push({
      assignmentId: 'b7000000-0000-4000-8000-000000000002',
      revision: 1, digest: 'c'.repeat(64), approved: false,
      scheduledStart: input.proposal.scheduledStart, scheduledEnd: input.proposal.scheduledEnd,
      profileIds: [PROFILE],
    });
    const result = evaluateConflictEvidence(input);
    expect(result.status).toBe('needs_review');
    expect(result.hardConflicts).toEqual([]);
    expect(result.reviewReasons.map(value => value.code)).toEqual([
      'availability_authority_missing', 'location_scope_authority_missing',
      'overlap_authority_unapproved', 'required_skill_authority_missing',
    ]);
  });

  test('treats Business Profile hours and capacity thresholds as warnings, never implicit hard overrides', () => {
    const input = baseInput();
    input.proposal.scheduledStart = '2027-03-08T23:00:00.000Z';
    input.proposal.scheduledEnd = '2027-03-09T00:00:00.000Z';
    input.schedules.push({
      assignmentId: 'b7000000-0000-4000-8000-000000000003',
      revision: 2, digest: 'd'.repeat(64), approved: true,
      scheduledStart: '2027-03-08T15:00:00.000Z', scheduledEnd: '2027-03-08T23:00:00.000Z',
      profileIds: [PROFILE],
    });
    input.businessProfile.scheduling.maxJobsPerDay = 1;
    input.businessProfile.scheduling.workDayLength = 8;
    input.businessProfile.scheduling.appointmentBuffer = 0;
    input.businessProfile.scheduling.travelBuffer = 0;
    const result = evaluateConflictEvidence(input);
    expect(result.status).toBe('warning');
    expect(result.hardConflicts).toEqual([]);
    expect(result.warnings.map(value => value.code)).toEqual([
      'max_jobs_per_day_threshold', 'outside_working_hours', 'workday_length_threshold',
    ]);
  });

  test('handles overnight authority and fails closed on DST-ambiguous working-hour evidence', () => {
    const overnight = baseInput();
    overnight.businessProfile.hours = weekdays('', '');
    overnight.businessProfile.hours.friday = { open: '22:00', close: '06:00', lunch: '' };
    overnight.proposal.scheduledStart = '2027-03-13T06:00:00.000Z';
    overnight.proposal.scheduledEnd = '2027-03-13T07:00:00.000Z';
    expect(evaluateConflictEvidence(overnight).warnings).toEqual([]);

    const fold = baseInput();
    fold.businessProfile.hours.sunday = { open: '01:00', close: '03:00', lunch: '' };
    fold.proposal.scheduledStart = '2027-11-07T05:30:00.000Z';
    fold.proposal.scheduledEnd = '2027-11-07T06:00:00.000Z';
    const result = evaluateConflictEvidence(fold);
    expect(result.status).toBe('needs_review');
    expect(result.reviewReasons.map(value => value.code)).toContain('working_hours_authority_incomplete');
  });

  test('expands crew-member conflicts and preserves simultaneous-work/resource-bound review', () => {
    const input = baseInput();
    const other = 'a8000000-0000-4000-8000-000000000002';
    input.proposal.target = { kind: 'crew', id: CREW };
    input.candidate.kind = 'crew';
    input.candidate.targetId = CREW;
    input.candidate.membersTruncated = true;
    input.candidate.skillEvidenceTruncated = true;
    input.candidate.availabilityEvidenceTruncated = true;
    input.candidate.members.push({ ...input.candidate.members[0], profileId: other });
    input.schedules.push({
      assignmentId: 'b7000000-0000-4000-8000-000000000004',
      revision: 2, digest: 'e'.repeat(64), approved: true,
      scheduledStart: input.proposal.scheduledStart, scheduledEnd: input.proposal.scheduledEnd,
      profileIds: [other],
    });
    input.scheduleSetTruncated = true;
    const result = evaluateConflictEvidence(input);
    expect(result.hardConflicts).toContainEqual({
      code: 'approved_schedule_overlap',
      assignmentId: 'b7000000-0000-4000-8000-000000000004',
      profileId: other,
    });
    expect(result.reviewReasons.map(value => value.code)).toEqual([
      'availability_authority_bounded', 'crew_membership_bounded',
      'required_skill_authority_bounded', 'schedule_evidence_bounded',
    ]);
  });

  test('never returns clear from a partial crew set even when every visible member is conflict-free', () => {
    const input = baseInput();
    input.proposal.target = { kind: 'crew', id: CREW };
    input.candidate.kind = 'crew';
    input.candidate.targetId = CREW;
    input.candidate.membersTruncated = true;
    const result = evaluateConflictEvidence(input);
    expect(result).toMatchObject({
      status: 'needs_review', hardConflicts: [], needsReview: true,
      reviewReasons: [{ code: 'crew_membership_bounded', crewId: CREW }],
    });
  });

  test('bounds deterministic conflict arrays and marks every partial result for review', () => {
    const input = baseInput();
    input.schedules = Array.from({ length: 300 }, (_, index) => ({
      assignmentId: `bounded-overlap-${String(index).padStart(3, '0')}`,
      revision: 2,
      digest: shaDigest(index),
      approved: true,
      scheduledStart: input.proposal.scheduledStart,
      scheduledEnd: input.proposal.scheduledEnd,
      profileIds: [PROFILE],
    }));
    const result = evaluateConflictEvidence(input);
    expect(result.status).toBe('hard_conflict');
    expect(result.hardConflicts).toHaveLength(256);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContainEqual({
      code: 'conflict_evidence_bounded',
      hardConflictCount: 300,
      reviewReasonCount: 0,
      warningCount: 2,
    });
  });
});

function shaDigest(index) {
  return index.toString(16).padStart(64, '0');
}
