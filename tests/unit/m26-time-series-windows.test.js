'use strict';

const { deriveReportingWindow, compareReportingWindows } =
  require('../../src/forecasting/timeSeriesWindows');

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const hours = Object.fromEntries(weekdays.map(day => [day, { open: '09:00', close: '17:00' }]));
hours.holidays = [];
const input = (overrides = {}) => ({
  organizationId: '11111111-1111-4111-8111-111111111111',
  businessProfileId: '22222222-2222-4222-8222-222222222222',
  businessProfileVersion: 3,
  businessProfileHash: 'a'.repeat(64),
  rawProfile: { company: { timeZone: 'America/New_York' }, hours },
  grain: 'day', localStartDate: '2026-03-08', serviceKey: 'plumbing',
  areaScope: 'tenant_all', ...overrides,
});
function expectUnavailable(action, reason) {
  let caught;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: 'M26_REPORTING_WINDOW_UNAVAILABLE', reason });
}

describe('Mission 26 Part 2B reporting windows', () => {
  test('uses local calendar boundaries across spring and fall daylight changes', () => {
    const spring = deriveReportingWindow(input());
    expect(spring.startsAt).toBe('2026-03-08T05:00:00.000Z');
    expect(spring.endsAt).toBe('2026-03-09T04:00:00.000Z');
    expect(spring.elapsedMinutes).toBe(1380);
    expect(spring.openMinutes).toBe(480);
    const fall = deriveReportingWindow(input({ localStartDate: '2026-11-01' }));
    expect(fall.elapsedMinutes).toBe(1500);
    expect(fall.openMinutes).toBe(480);
  });

  test('aligns week, month, quarter and year to local reporting dates', () => {
    for (const [grain, date, end] of [
      ['week', '2026-03-02', '2026-03-09'],
      ['month', '2026-03-01', '2026-04-01'],
      ['quarter', '2026-04-01', '2026-07-01'],
      ['year', '2028-01-01', '2029-01-01'],
    ]) {
      const window = deriveReportingWindow(input({ grain, localStartDate: date }));
      expect(window.localEndDate).toBe(end);
      expect(window.openMinutes).toBeGreaterThan(0);
    }
    expect(() => deriveReportingWindow(input({ grain: 'week', localStartDate: '2026-03-03' })))
      .toThrow('Forecast reporting window details are invalid.');
  });

  test('keeps unknown calendars and area scope explicit for comparisons', () => {
    const march = deriveReportingWindow(input({ grain: 'month', localStartDate: '2026-03-01' }));
    const april = deriveReportingWindow(input({ grain: 'month', localStartDate: '2026-04-01' }));
    expect(compareReportingWindows(march, april)).toMatchObject({
      comparableContext: true, normalizationRequired: true, reasons: [],
    });
    const missingHours = deriveReportingWindow(input({
      rawProfile: { company: { timeZone: 'America/New_York' } },
    }));
    expect(missingHours).toMatchObject({ calendarState: 'unknown', openMinutes: null });
    expect(compareReportingWindows(missingHours, deriveReportingWindow(input())))
      .toMatchObject({ comparableContext: false, reasons: ['calendar_unknown'] });
    expectUnavailable(() => deriveReportingWindow(input({ areaScope: 'profile_area' })),
      'service_area_unknown');
  });

  test('pins configured service area and refuses silent time-zone fallback', () => {
    const west = deriveReportingWindow(input({
      areaScope: 'profile_area',
      rawProfile: { company: { timeZone: 'America/New_York' }, hours,
        serviceArea: { primaryTerritory: 'West' } },
    }));
    const east = deriveReportingWindow(input({
      areaScope: 'profile_area',
      rawProfile: { company: { timeZone: 'America/New_York' }, hours,
        serviceArea: { primaryTerritory: 'East' } },
    }));
    expect(compareReportingWindows(west, east).reasons).toEqual(['area_changed']);
    expectUnavailable(() => deriveReportingWindow(input({
      areaScope: 'profile_area',
      rawProfile: { company: { timeZone: 'America/New_York' }, hours,
        serviceArea: { maxRadiusMiles: 25 } },
    })), 'service_area_unknown');
    expectUnavailable(() => deriveReportingWindow(input({ rawProfile: { company: {}, hours } })),
      'business_time_zone_unknown');
  });

  test('distinguishes a known closed holiday from missing or ambiguous hours', () => {
    const closedHours = { ...hours, holidays: [
      { id: 'closed-day', date: '2026-03-08', closed: true },
    ] };
    expect(deriveReportingWindow(input({
      rawProfile: { company: { timeZone: 'America/New_York' }, hours: closedHours },
    }))).toMatchObject({ calendarState: 'known', openMinutes: 0 });
    const ambiguousHours = { ...hours,
      sunday: { open: '01:00', close: '03:00' }, holidays: [] };
    expect(deriveReportingWindow(input({
      localStartDate: '2026-11-01',
      rawProfile: { company: { timeZone: 'America/New_York' }, hours: ambiguousHours },
    }))).toMatchObject({ calendarState: 'unknown', openMinutes: null });
  });
});
