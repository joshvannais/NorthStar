'use strict';

const { deriveReportingWindow } = require('../../src/forecasting/timeSeriesWindows');
const { VERSION, buildInboundDemandCandidate } =
  require('../../src/forecasting/inboundDemandCandidate');

const organizationId = '11111111-1111-4111-8111-111111111111';
const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '17:00' }]));
hours.holidays = [];
function window(localStartDate, overrides = {}) {
  return deriveReportingWindow({ organizationId,
    businessProfileId: '22222222-2222-4222-8222-222222222222',
    businessProfileVersion: 3, businessProfileHash: 'a'.repeat(64),
    rawProfile: { company: { timeZone: 'UTC' }, hours },
    grain: 'day', localStartDate, serviceKey: null, areaScope: 'tenant_all',
    ...overrides });
}
const observation = (date, count, changes = {}) => ({
  window: window(date), count, state: 'complete',
  sourceRecordedThrough: window(date).endsAt,
  coverageReceiptDigest: 'b'.repeat(64), ...changes,
});
const candidate = (changes = {}) => ({
  version: VERSION, organizationId,
  asOf: '2026-09-20T00:00:00.000Z',
  horizon: { startsAt: window('2026-09-21').startsAt,
    endsAt: window('2026-09-21').endsAt, grain: 'day' },
  reportingWindow: window('2026-09-21'), sourceSnapshotDigest: 'c'.repeat(64),
  observations: [observation('2026-09-17', 1), observation('2026-09-18', 2),
    observation('2026-09-19', 0)], ...changes,
});

describe('Mission 26 Part 4A unmounted inbound demand candidate', () => {
  test('retains explicit Retell-only scope, uncalibrated uncertainty and a true zero observation', () => {
    const output = buildInboundDemandCandidate(candidate());
    expect(output).toMatchObject({ target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
      value: { kind: 'point', amount: '1' }, unit: { key: 'count', currency: null },
      confidence: { state: 'unavailable' },
      applicability: { serviceKey: null, areaKey: null, limits: ['retell_only'] },
      evidenceCoverage: { included: 3, missing: 0 } });
    expect(Object.isFrozen(output)).toBe(true);
    expect(buildInboundDemandCandidate(candidate({ observations: [
      observation('2026-09-17', 1), observation('2026-09-18', 1),
      observation('2026-09-19', 0)],
    })).value.amount).toBe('0.666667');
  });

  test('keeps missing coverage unavailable, never converts it into zero', () => {
    const output = buildInboundDemandCandidate(candidate({ observations: [
      observation('2026-09-17', 0), observation('2026-09-18', null,
        { state: 'incomplete' }), observation('2026-09-19', 0)],
    }));
    expect(output.value).toEqual({ kind: 'unavailable', reason: 'incomplete_source_coverage' });
    expect(output.evidenceCoverage.missing).toBe(1);
    expect(buildInboundDemandCandidate(candidate({ observations: [] })).value.reason)
      .toBe('insufficient_history');
  });

  test('refuses incompatible windows, including daylight exposure and unknown calendars', () => {
    const day = window('2026-03-08', {
      rawProfile: { company: { timeZone: 'America/New_York' }, hours },
    });
    const reference = window('2026-03-09', {
      rawProfile: { company: { timeZone: 'America/New_York' }, hours },
    });
    const input = candidate({ asOf: reference.startsAt, reportingWindow: reference,
      horizon: { startsAt: reference.startsAt, endsAt: reference.endsAt, grain: 'day' },
      observations: [
        observation('2026-03-06', 1, { window: window('2026-03-06', {
          rawProfile: { company: { timeZone: 'America/New_York' }, hours },
        }), sourceRecordedThrough: window('2026-03-06', {
          rawProfile: { company: { timeZone: 'America/New_York' }, hours },
        }).endsAt }),
        observation('2026-03-07', 1, { window: window('2026-03-07', {
          rawProfile: { company: { timeZone: 'America/New_York' }, hours },
        }), sourceRecordedThrough: window('2026-03-07', {
          rawProfile: { company: { timeZone: 'America/New_York' }, hours },
        }).endsAt }),
        observation('2026-03-08', 1, { window: day, sourceRecordedThrough: day.endsAt }),
      ] });
    expect(buildInboundDemandCandidate(input).value.reason).toBe('window_normalization_required');
  });

  test('rejects future leakage, duplicate periods, mixed tenant and unsupported filters', () => {
    for (const change of [
      { observations: [observation('2026-09-17', 0), observation('2026-09-17', 1)] },
      { observations: [observation('2026-09-17', 1,
        { sourceRecordedThrough: '2026-09-21T00:00:00.000Z' })] },
      { observations: [observation('2026-09-20', 1)] },
      { observations: [observation('2026-09-17', 1, { window: window('2026-09-17',
        { organizationId: '33333333-3333-4333-8333-333333333333' }) })] },
      { reportingWindow: window('2026-09-21', { serviceKey: 'tree' }) },
      { reportingWindow: window('2026-09-21', { areaScope: 'profile_area',
        rawProfile: { company: { timeZone: 'UTC' }, hours,
          serviceArea: { primaryTerritory: 'West' } } }) },
      { observations: [observation('2026-09-17', 0, { state: 'revoked' })] },
    ]) {
      let failure;
      try { buildInboundDemandCandidate(candidate(change)); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: 'M26_INBOUND_DEMAND_INVALID' });
    }
  });
});
