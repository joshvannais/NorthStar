'use strict';

const { VERSION, MAX_INTERVALS, summarizeRoleTimePosition } =
  require('../../src/forecasting/roleTimePositionDiagnostic');

const organizationId = '55555555-5555-4555-8555-555555555555';
const asOf = '2026-09-21T12:00:00.000Z';
const interval = (startsAt, endsAt) => ({ startsAt, endsAt });
const at = hour => `2026-09-22T${String(hour).padStart(2, '0')}:00:00.000Z`;

function worker(overrides = {}) {
  return {
    workerId: '11111111-1111-4111-8111-111111111111',
    organizationId, revision: 1, digest: 'b'.repeat(64), recordedAt: asOf,
    employmentState: 'active', qualificationState: 'qualified',
    workingIntervals: [interval(at(9), at(17))],
    declaredAvailableIntervals: [interval(at(9), at(17))],
    declaredUnavailableIntervals: [], approvedCommitmentIntervals: [],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    version: VERSION, organizationId, asOf,
    horizon: { startsAt: at(0), endsAt: '2026-09-23T00:00:00.000Z' },
    roleKey: 'tree_climber', sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', recordedThrough: asOf, hasMore: false },
    workers: [worker()], ...overrides,
  };
}

describe('Mission 26 Part 5B role-time position prerequisite', () => {
  test('intersects declared hours and removes overlapping absences and commitments without double count', () => {
    const first = worker({
      declaredUnavailableIntervals: [interval(at(12), at(13))],
      approvedCommitmentIntervals: [interval(at(10), at(12)), interval(at(11), at(12))],
    });
    const second = worker({
      workerId: '22222222-2222-4222-8222-222222222222',
      workingIntervals: [interval(at(9), at(12))],
      declaredAvailableIntervals: [interval(at(9), at(12))],
      approvedCommitmentIntervals: [interval(at(10), at(11))],
    });
    const result = summarizeRoleTimePosition(input({ workers: [first, second] }));
    expect(result.declaredUncommittedPersonMinutes).toBe(420);
    expect(result.eligibleWorkerCount).toBe(2);
    expect(result.sourceAuthenticated).toBe(false);
    expect(result.forecastIssued).toBe(false);
    expect(result.resourceConstraintsChecked).toBe(false);
  });

  test('clips work to the horizon and unions adjacent or overlapping declared periods', () => {
    const result = summarizeRoleTimePosition(input({ workers: [worker({
      workingIntervals: [interval('2026-09-21T20:00:00.000Z', at(12)),
        interval(at(11), '2026-09-23T04:00:00.000Z')],
      declaredAvailableIntervals: [interval('2026-09-21T20:00:00.000Z', at(12)),
        interval(at(12), '2026-09-23T04:00:00.000Z')],
      approvedCommitmentIntervals: [interval('2026-09-21T20:00:00.000Z', at(1)),
        interval(at(23), '2026-09-23T04:00:00.000Z')],
    })] }));
    expect(result.declaredUncommittedPersonMinutes).toBe(22 * 60);
  });

  test('interval arithmetic agrees with an independent minute-by-minute oracle', () => {
    let seed = 17;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const makeRanges = () => Array.from({ length: 8 }, () => {
      const start = next() % 23;
      const end = start + 1 + next() % (24 - start);
      return interval(at(start), end === 24 ? '2026-09-23T00:00:00.000Z' : at(end));
    });
    const activeAt = (ranges, minute) => ranges.some(range =>
      Date.parse(range.startsAt) <= Date.parse(at(0)) + minute * 60000 &&
      Date.parse(range.endsAt) > Date.parse(at(0)) + minute * 60000);
    for (let sample = 0; sample < 40; sample += 1) {
      const workingIntervals = makeRanges();
      const declaredAvailableIntervals = makeRanges();
      const declaredUnavailableIntervals = makeRanges();
      const approvedCommitmentIntervals = makeRanges();
      let expected = 0;
      for (let minute = 0; minute < 1440; minute += 1) {
        if (activeAt(workingIntervals, minute) && activeAt(declaredAvailableIntervals, minute) &&
            !activeAt(declaredUnavailableIntervals, minute) &&
            !activeAt(approvedCommitmentIntervals, minute)) expected += 1;
      }
      const actual = summarizeRoleTimePosition(input({ workers: [worker({
        workingIntervals, declaredAvailableIntervals, declaredUnavailableIntervals,
        approvedCommitmentIntervals,
      })] }));
      expect(actual.declaredUncommittedPersonMinutes).toBe(expected);
    }
  });

  test('an empty qualified roster is zero only under a complete exact-cutoff claim', () => {
    const complete = summarizeRoleTimePosition(input({ workers: [] }));
    expect(complete.declaredUncommittedPersonMinutes).toBe(0);
    expect(complete.state).toBe('descriptive_only');
    const incomplete = summarizeRoleTimePosition(input({ workers: [],
      coverage: { state: 'incomplete', recordedThrough: asOf, hasMore: false } }));
    expect(incomplete.declaredUncommittedPersonMinutes).toBeNull();
    expect(incomplete.reason).toBe('incomplete_source_coverage');
  });

  test('unknown worker or incomplete pagination withholds the entire total', () => {
    const unknown = summarizeRoleTimePosition(input({ workers: [worker({ qualificationState: 'unknown' })] }));
    expect(unknown.reason).toBe('unresolved_worker_basis');
    expect(unknown.declaredUncommittedPersonMinutes).toBeNull();
    const truncated = summarizeRoleTimePosition(input({ coverage: {
      state: 'complete', recordedThrough: asOf, hasMore: true,
    } }));
    expect(truncated.reason).toBe('incomplete_source_coverage');
  });

  test('inactive or known unqualified people do not become role capacity', () => {
    const result = summarizeRoleTimePosition(input({ workers: [
      worker({ qualificationState: 'not_qualified' }),
      worker({ workerId: '22222222-2222-4222-8222-222222222222', employmentState: 'inactive' }),
    ] }));
    expect(result.declaredUncommittedPersonMinutes).toBe(0);
    expect(result.eligibleWorkerCount).toBe(0);
  });

  test('rejects duplicate, other-tenant, future, malformed and oversized evidence', () => {
    const candidate = worker();
    const failures = [
      input({ workers: [candidate, candidate] }),
      input({ workers: [worker({ organizationId: '66666666-6666-4666-8666-666666666666' })] }),
      input({ workers: [worker({ recordedAt: '2026-09-22T00:00:00.000Z' })] }),
      input({ workers: [worker({ workingIntervals: [interval(at(9), '2026-09-22T17:00:01.000Z')] })] }),
      input({ horizon: { startsAt: at(12), endsAt: at(9) } }),
      input({ workers: [worker({ workingIntervals: Array(MAX_INTERVALS + 1).fill(interval(at(9), at(10))) })] }),
    ];
    for (const bad of failures) expect(() => summarizeRoleTimePosition(bad))
      .toThrow('Role time position details are invalid.');
  });
});
