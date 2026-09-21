'use strict';

const { deriveReportingWindow } = require('../../src/forecasting/timeSeriesWindows');
const { buildInboundDemandCandidate, VERSION: CANDIDATE_VERSION } =
  require('../../src/forecasting/inboundDemandCandidate');
const { projectInboundLeadObservations, VERSION } =
  require('../../src/forecasting/inboundLeadObservations');

const organizationId = '11111111-1111-4111-8111-111111111111';
const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '17:00' }]));
hours.holidays = [];
function window(date, serviceKey = null) {
  return deriveReportingWindow({ organizationId,
    businessProfileId: '22222222-2222-4222-8222-222222222222',
    businessProfileVersion: 1, businessProfileHash: 'a'.repeat(64),
    rawProfile: { company: { timeZone: 'UTC' }, hours },
    grain: 'day', localStartDate: date, serviceKey, areaScope: 'tenant_all' });
}
const period = date => ({ window: window(date), state: 'complete',
  sourceRecordedThrough: '2026-09-20T00:00:00.000Z',
  coverageReceiptDigest: 'b'.repeat(64) });
const lead = (id, date, changes = {}) => ({ organizationId, leadId: id,
  firstReceiptAt: `${date}T12:00:00.000Z`,
  reviewedAt: '2026-09-19T15:00:00.000Z',
  sourceDigest: 'c'.repeat(64), state: 'active', ...changes });
const input = (changes = {}) => ({ version: VERSION, organizationId,
  asOf: '2026-09-20T00:00:00.000Z', sourceSnapshotDigest: 'd'.repeat(64),
  leadReceipts: [lead('33333333-3333-4333-8333-333333333333', '2026-09-17'),
    lead('44444444-4444-4444-8444-444444444444', '2026-09-18')],
  periods: [period('2026-09-17'), period('2026-09-18'), period('2026-09-19')],
  ...changes });
function failure(change) {
  let error;
  try { projectInboundLeadObservations(input(change)); }
  catch (caught) { error = caught; }
  expect(error).toMatchObject({ code: 'M26_INBOUND_LEAD_OBSERVATION_INVALID' });
}

describe('Mission 26 Part 4A reviewed lead observation boundary', () => {
  test('counts first reviewed receipts once, preserves a complete zero and feeds only the unmounted candidate', () => {
    const projected = projectInboundLeadObservations(input());
    expect(projected.observations.map(item => item.count)).toEqual([1, 1, 0]);
    expect(Object.isFrozen(projected.observations[0].window)).toBe(true);
    const forecast = buildInboundDemandCandidate({ version: CANDIDATE_VERSION,
      organizationId, asOf: projected.asOf,
      horizon: { startsAt: window('2026-09-21').startsAt,
        endsAt: window('2026-09-21').endsAt, grain: 'day' },
      reportingWindow: window('2026-09-21'),
      sourceSnapshotDigest: projected.sourceSnapshotDigest,
      observations: projected.observations });
    expect(forecast.value).toEqual({ kind: 'point', amount: '0.666667' });
  });

  test('revoked or late-reviewed lead makes the affected period unavailable', () => {
    const revoked = projectInboundLeadObservations(input({ leadReceipts: [
      lead('33333333-3333-4333-8333-333333333333', '2026-09-17', { state: 'revoked' }),
    ] }));
    expect(revoked.observations[0]).toMatchObject({ state: 'revoked', count: null });
    const late = projectInboundLeadObservations(input({ periods: [
      { ...period('2026-09-17'), sourceRecordedThrough: '2026-09-18T00:00:00.000Z' },
      period('2026-09-18'), period('2026-09-19')],
    }));
    expect(late.observations[0]).toMatchObject({ state: 'incomplete', count: null });
    expect(buildInboundDemandCandidate({ version: CANDIDATE_VERSION, organizationId,
      asOf: late.asOf, reportingWindow: window('2026-09-21'),
      horizon: { startsAt: window('2026-09-21').startsAt,
        endsAt: window('2026-09-21').endsAt, grain: 'day' },
      sourceSnapshotDigest: late.sourceSnapshotDigest,
      observations: late.observations }).value.reason).toBe('incomplete_source_coverage');
  });

  test('rejects repeated or mixed tenant identity, future evidence and incompatible periods', () => {
    const current = input().leadReceipts[0];
    failure({ leadReceipts: [current, { ...current }] });
    failure({ leadReceipts: [{ ...current,
      organizationId: '55555555-5555-4555-8555-555555555555' }] });
    failure({ leadReceipts: [{ ...current,
      reviewedAt: '2026-09-21T00:00:00.000Z' }] });
    failure({ leadReceipts: [{ ...current,
      sourceDigest: { toString: () => 'c'.repeat(64) } }] });
    failure({ periods: [period('2026-09-17'), period('2026-09-17')] });
    failure({ periods: [period('2026-09-18'), period('2026-09-17')] });
    failure({ periods: [{ ...period('2026-09-17'), window: window('2026-09-17', 'roofing') }] });
    failure({ periods: [{ ...period('2026-09-17'),
      sourceRecordedThrough: '2026-09-22T00:00:00.000Z' }] });
    const sparse = [period('2026-09-17'), , period('2026-09-19')];
    sparse.extra = 1;
    failure({ periods: sparse });
  });
});
