'use strict';

const { VERSION, summarizeOperatingWindows } = require('../../src/forecasting/operatingWindowPosition');

const organizationId = '11111111-1111-4111-8111-111111111111';
const closed = () => ({ open: '', close: '' });
function week(overrides = {}) {
  return { sunday: closed(), monday: closed(), tuesday: closed(),
    wednesday: closed(), thursday: closed(), friday: closed(),
    saturday: closed(), ...overrides };
}
function input(hours, startsAt = '2026-10-05T00:00:00.000Z',
  endsAt = '2026-10-06T00:00:00.000Z', timeZone = 'UTC') {
  return { version: VERSION, organizationId, sourceSnapshotDigest: 'a'.repeat(64),
    horizon: { startsAt, endsAt }, timeZone, hours };
}

test('uses Mission 22 company hours and lunch while making no worker-capacity claim', () => {
  const result = summarizeOperatingWindows(input(week({ monday: {
    open: '08:00', close: '17:00', lunch: '12:00-13:00' } })));
  expect(result.state).toBe('descriptive_only');
  expect(result.companyOperatingMinutes).toBe(480);
  expect(result.operatingIntervals).toEqual([
    { startsAt: '2026-10-05T08:00:00.000Z', endsAt: '2026-10-05T12:00:00.000Z' },
    { startsAt: '2026-10-05T13:00:00.000Z', endsAt: '2026-10-05T17:00:00.000Z' },
  ]);
  expect(result.workerAvailabilityVerified).toBe(false);
  expect(result.forecastIssued).toBe(false);
  expect(Object.isFrozen(result.operatingIntervals[0])).toBe(true);
});

test('includes overnight hours opened on the previous local date', () => {
  const result = summarizeOperatingWindows(input(week({ monday: {
    open: '22:00', close: '02:00' } }),
  '2026-10-06T00:00:00.000Z', '2026-10-06T03:00:00.000Z'));
  expect(result.companyOperatingMinutes).toBe(120);
  expect(result.operatingIntervals).toEqual([{
    startsAt: '2026-10-06T00:00:00.000Z', endsAt: '2026-10-06T02:00:00.000Z',
  }]);
});

test('a known closed calendar yields zero company hours, not missing data', () => {
  const result = summarizeOperatingWindows(input(week()));
  expect(result.state).toBe('descriptive_only');
  expect(result.companyOperatingMinutes).toBe(0);
});

test('a missing weekday withholds the total', () => {
  const result = summarizeOperatingWindows(input({ sunday: closed() }));
  expect(result.state).toBe('unavailable');
  expect(result.reason).toBe('operating_hours_unresolved');
  expect(result.companyOperatingMinutes).toBeNull();
});

test.each([
  ['2026-03-08T06:00:00.000Z', '2026-03-08T10:00:00.000Z',
    { open: '02:30', close: '04:00' }],
  ['2026-11-01T04:00:00.000Z', '2026-11-01T09:00:00.000Z',
    { open: '01:30', close: '03:00' }],
])('ambiguous or nonexistent DST wall times stay unavailable', (start, end, sunday) => {
  const result = summarizeOperatingWindows(input(week({ sunday }), start, end,
    'America/New_York'));
  expect(result.state).toBe('unavailable');
  expect(result.reason).toBe('operating_hours_unresolved');
});

test('a valid overnight fall-back window includes the repeated hour', () => {
  const result = summarizeOperatingWindows(input(week({ sunday: {
    open: '00:30', close: '03:30' } }),
  '2026-11-01T04:00:00.000Z', '2026-11-01T10:00:00.000Z',
  'America/New_York'));
  expect(result.state).toBe('descriptive_only');
  expect(result.companyOperatingMinutes).toBe(240);
});

test('malformed or oversized windows are rejected', () => {
  expect(() => summarizeOperatingWindows(input(week(),
    '2026-10-06T00:00:00.000Z', '2026-10-05T00:00:00.000Z')))
    .toThrow(expect.objectContaining({ code: 'M26_OPERATING_WINDOW_INVALID' }));
  expect(() => summarizeOperatingWindows({ ...input(week()), surprise: true }))
    .toThrow(expect.objectContaining({ code: 'M26_OPERATING_WINDOW_INVALID' }));
});
