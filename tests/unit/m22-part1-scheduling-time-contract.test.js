'use strict';

const time = require('../../public/js/scheduling-time-contract');

describe('Mission 22 Part 1 tenant scheduling time contract', () => {
  test('resolves a unique New York wall clock without consulting the host zone', () => {
    expect(time.resolveWallTime('2027-01-15', '09:30', 'America/New_York')).toMatchObject({
      status: 'unique',
      candidates: [{
        rfc3339: '2027-01-15T09:30:00-05:00',
        instant: '2027-01-15T14:30:00.000Z',
        offset: '-05:00',
      }],
    });
  });

  test('rejects a spring-forward gap and requires both explicit fall-back occurrences', () => {
    expect(time.resolveWallTime('2027-03-14', '02:30', 'America/New_York')).toMatchObject({
      status: 'gap', candidates: [],
    });
    expect(time.resolveWallTime('2027-11-07', '01:30', 'America/New_York')).toMatchObject({
      status: 'ambiguous',
      candidates: [
        { occurrence: 'first', offset: '-04:00', rfc3339: '2027-11-07T01:30:00-04:00' },
        { occurrence: 'second', offset: '-05:00', rfc3339: '2027-11-07T01:30:00-05:00' },
      ],
    });
  });

  test('handles a non-hour DST transition, midnight, overnight and multiday values', () => {
    expect(time.resolveWallTime('2027-10-03', '02:15', 'Australia/Lord_Howe').status).toBe('gap');
    expect(time.resolveWallTime('2027-04-04', '01:45', 'Australia/Lord_Howe')).toMatchObject({
      status: 'ambiguous',
      candidates: [{ offset: '+11:00' }, { offset: '+10:30' }],
    });
    expect(time.resolveWallTime('2027-01-15', '00:00', 'America/New_York').candidates[0].instant)
      .toBe('2027-01-15T05:00:00.000Z');
    const start = time.resolveWallTime('2027-01-15', '23:30', 'America/New_York').candidates[0];
    const overnight = time.resolveWallTime('2027-01-16', '01:00', 'America/New_York').candidates[0];
    const multiday = time.resolveWallTime('2027-01-18', '01:00', 'America/New_York').candidates[0];
    expect(new Date(overnight.instant).getTime()).toBeGreaterThan(new Date(start.instant).getTime());
    expect(new Date(multiday.instant).getTime()).toBeGreaterThan(new Date(overnight.instant).getTime());
  });

  test('strictly parses RFC3339 and validates wall clock plus offset against the zone', () => {
    expect(time.validateRfc3339InZone('2027-11-07T01:30:00-04:00', 'America/New_York')).toMatchObject({
      instant: '2027-11-07T05:30:00.000Z', offsetMinutes: -240,
    });
    expect(time.validateRfc3339InZone('2027-11-07T01:30:00-05:00', 'America/New_York')).toMatchObject({
      instant: '2027-11-07T06:30:00.000Z', offsetMinutes: -300,
    });
    expect(() => time.validateRfc3339InZone('2027-03-14T02:30:00-05:00', 'America/New_York'))
      .toThrow(expect.objectContaining({ code: 'ZONE_OFFSET_MISMATCH' }));
    expect(() => time.validateRfc3339InZone('2027-07-01T09:00:00Z', 'America/New_York'))
      .toThrow(expect.objectContaining({ code: 'ZONE_OFFSET_MISMATCH' }));
    expect(() => time.parseRfc3339('2027-02-30T09:00:00-05:00'))
      .toThrow(expect.objectContaining({ code: 'INVALID_RFC3339' }));
    expect(() => time.parseRfc3339('2027-01-15T09:00:00'))
      .toThrow(expect.objectContaining({ code: 'INVALID_RFC3339' }));
  });

  test('formats canonical instants in the tenant zone, not the process zone', () => {
    expect(time.formatInstant('2027-07-01T13:15:00.000Z', 'America/New_York')).toMatchObject({
      date: '2027-07-01', time: '09:15', offset: '-04:00',
    });
    expect(time.formatInstant('2027-07-01T13:15:00.000Z', 'America/Los_Angeles')).toMatchObject({
      date: '2027-07-01', time: '06:15', offset: '-07:00',
    });
  });
});
