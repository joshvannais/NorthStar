'use strict';

const { deriveReportingWindow } = require('../../src/forecasting/timeSeriesWindows');
const { VERSION, describeTransitionRate } = require('../../src/forecasting/transitionRateDiagnostic');

const organizationId = '11111111-1111-4111-8111-111111111111';
const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '17:00' }]));
hours.holidays = [];
function window(localStartDate, overrides = {}) {
  return deriveReportingWindow({ organizationId,
    businessProfileId: '22222222-2222-4222-8222-222222222222',
    businessProfileVersion: 1, businessProfileHash: 'a'.repeat(64),
    rawProfile: { company: { timeZone: 'UTC' }, hours }, grain: 'day',
    localStartDate, serviceKey: null, areaScope: 'tenant_all', ...overrides });
}
function cohort(localStartDate, eligibleCount, transitionedCount, overrides = {}) {
  const period = window(localStartDate);
  return { targetKey: 'demand.booking_transition', window: period,
    freezeAt: new Date(Date.parse(period.startsAt) - 86400000).toISOString(),
    sourceRecordedThrough: period.endsAt, cohortDigest: localStartDate === '2026-09-17' ?
      'b'.repeat(64) : localStartDate === '2026-09-18' ? 'c'.repeat(64) : 'd'.repeat(64),
    outcomeDigest: 'e'.repeat(64), state: 'complete', eligibleCount,
    transitionedCount, unresolvedCount: 0, ...overrides };
}
function input(overrides = {}) {
  return { version: VERSION, organizationId, targetKey: 'demand.booking_transition',
    asOf: '2026-09-20T00:00:00.000Z', reportingWindow: window('2026-09-21'),
    sourceSnapshotDigest: 'f'.repeat(64), cohorts: [
      cohort('2026-09-17', 2, 1), cohort('2026-09-18', 10, 9),
      cohort('2026-09-19', 3, 0)], ...overrides };
}

test('reports a pooled observed rate, never a calibrated booking probability', () => {
  const result = describeTransitionRate(input());
  expect(result).toMatchObject({ state: 'descriptive_only', observedRate: '0.666667',
    eligibleCount: '15', transitionedCount: '10', includedCohorts: 3,
    sourceAuthenticated: false, confidence: 'unavailable', forecastIssued: false });
  expect(Object.isFrozen(result)).toBe(true);
  expect(describeTransitionRate(input({ cohorts: [cohort('2026-09-17', 8, 0)] })))
    .toMatchObject({ state: 'descriptive_only', observedRate: '0' });
  for (const targetKey of ['demand.qualification_transition',
    'demand.estimate_request_transition', 'demand.booking_cancellation']) {
    expect(describeTransitionRate(input({ targetKey, cohorts: input().cohorts.map(item =>
      ({ ...item, targetKey })) })).targetKey).toBe(targetKey);
  }
});

test('missing, revoked, incomparable and zero-denominator cohorts stay unavailable', () => {
  const historical = input().cohorts;
  expect(describeTransitionRate(input({ cohorts: [historical[0],
    { ...historical[1], state: 'incomplete', outcomeDigest: null, unresolvedCount: 1 },
    historical[2]] }))).toMatchObject({ state: 'unavailable',
    reason: 'incomplete_outcome_coverage', observedRate: null });
  expect(describeTransitionRate(input({ cohorts: [{ ...historical[0], state: 'revoked' }] })))
    .toMatchObject({ state: 'unavailable', reason: 'incomplete_outcome_coverage' });
  expect(describeTransitionRate(input({ cohorts: [cohort('2026-09-17', 0, 0)] })))
    .toMatchObject({ state: 'unavailable', reason: 'zero_eligible_cohort' });
  expect(describeTransitionRate(input({ cohorts: [] })))
    .toMatchObject({ state: 'unavailable', reason: 'insufficient_history' });
  const changed = window('2026-09-17', { rawProfile: {
    company: { timeZone: 'America/New_York' }, hours } });
  expect(describeTransitionRate(input({ cohorts: [{ ...historical[0], window: changed,
    freezeAt: new Date(Date.parse(changed.startsAt) - 86400000).toISOString(),
    sourceRecordedThrough: changed.endsAt }] }))).toMatchObject({
    state: 'unavailable', reason: 'incomparable_cohorts' });
  expect(describeTransitionRate(input({ cohorts: [{ ...historical[0],
    freezeAt: new Date(Date.parse(historical[0].window.startsAt) - 3600000).toISOString() }] })))
    .toMatchObject({ state: 'unavailable', reason: 'incomparable_cohorts' });
});

test('rejects future leakage, duplicate windows and impossible transitions', () => {
  const old = input().cohorts[0];
  for (const changes of [
    { cohorts: [{ ...old, sourceRecordedThrough: '2026-09-21T00:00:00.000Z' }] },
    { cohorts: [old, { ...old, cohortDigest: '9'.repeat(64) }] },
    { cohorts: [{ ...old, transitionedCount: 3 }] },
    { cohorts: [{ ...old, unresolvedCount: 2 }] },
    { cohorts: [{ ...old, freezeAt: old.window.startsAt }] },
    { cohorts: [{ ...old, state: 'complete', outcomeDigest: null }] },
    { cohorts: [{ ...old, targetKey: 'demand.qualification_transition' }] },
    { targetKey: 'demand.bookings' },
    { reportingWindow: window('2026-09-19') },
    { cohorts: [{ ...old, window: window('2026-09-17', {
      organizationId: '33333333-3333-4333-8333-333333333333' }) }] },
  ]) {
    expect(() => describeTransitionRate(input(changes)))
      .toThrow(expect.objectContaining({ code: 'M26_TRANSITION_COHORT_INVALID' }));
  }
});

test('never coerces digest objects into authenticated-looking strings', () => {
  const masquerade = () => ({ toString: () => 'a'.repeat(64) });
  for (const changes of [
    { sourceSnapshotDigest: masquerade() },
    { cohorts: [cohort('2026-09-17', 2, 1, { cohortDigest: masquerade() }),
      cohort('2026-09-18', 2, 1, { cohortDigest: masquerade() })] },
    { cohorts: [cohort('2026-09-17', 2, 1, { outcomeDigest: masquerade() })] },
  ]) {
    expect(() => describeTransitionRate(input(changes)))
      .toThrow(expect.objectContaining({ code: 'M26_TRANSITION_COHORT_INVALID' }));
  }
});
