'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { deriveReportingWindow } = require('../../src/forecasting/timeSeriesWindows');
const { captureView, readView } =
  require('../../src/forecasting/comparableApprovedEstimateMonthsV2');

const ORG = '21000000-0000-4000-8000-000000000001';
const PROFILE = '22000000-0000-4000-8000-000000000001';
const ANCHOR = '23000000-0000-4000-8000-000000000001';
const RECEIPT = '24000000-0000-4000-8000-000000000001';
const ESTIMATE = '25000000-0000-4000-8000-000000000001';
const DECISION = '26000000-0000-4000-8000-000000000001';

const profile = { company: { timeZone: 'America/New_York' },
  hours: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday'].map(day => [day, {
    open: '08:00', close: '17:00', lunch: '', emergency: false,
    afterHours: false, holiday: false,
  }])),
  headquarters: { latitude: 41.76, longitude: -72.67 },
  serviceArea: { maxRadiusMiles: 40, primaryTerritory: 'Fictional Connecticut' } };

function windows() {
  return ['2026-03-01', '2026-04-01'].map(localStartDate =>
    deriveReportingWindow({ organizationId: ORG, businessProfileId: PROFILE,
      businessProfileVersion: 1, businessProfileHash: 'a'.repeat(64),
      rawProfile: profile, grain: 'month', localStartDate,
      serviceKey: null, areaScope: 'tenant_all' }));
}

function micros(value) { return value.replace('.000Z', '.000000Z'); }

function windowDigest(pair) {
  return crypto.createHash('sha256').update([
    'm26-comparable-month-windows-v2', ORG, ANCHOR, pair[0].timeZone,
    pair[0].localStartDate, String(Date.parse(pair[0].startsAt)),
    String(Date.parse(pair[0].endsAt)), String(pair[0].elapsedMinutes),
    String(pair[0].openMinutes), pair[1].localStartDate,
    String(Date.parse(pair[1].startsAt)), String(Date.parse(pair[1].endsAt)),
    String(pair[1].elapsedMinutes), String(pair[1].openMinutes),
  ].join('|')).digest('hex');
}

function event(period, sourceOrder, observedAt) {
  return { estimateId: ESTIMATE, decisionId: DECISION, revision: sourceOrder,
    action: sourceOrder % 2 ? 'approve' : 'withdraw', digest: 'b'.repeat(64),
    sourceOrder, sourceObservedAt: observedAt,
    commitObservedAt: observedAt.replace('00.000000Z', '01.000000Z'), period };
}

function receipt(events = []) {
  const pair = windows();
  return { id: RECEIPT, version: 'm26-comparable-approved-estimate-months-v2',
    organizationId: ORG, profileAnchorId: ANCHOR,
    timeZone: pair[0].timeZone,
    firstLocalStartDate: pair[0].localStartDate,
    firstLocalEndDate: pair[0].localEndDate,
    firstStartsAt: micros(pair[0].startsAt), firstEndsAt: micros(pair[0].endsAt),
    firstElapsedMinutes: pair[0].elapsedMinutes, firstOpenMinutes: pair[0].openMinutes,
    secondLocalStartDate: pair[1].localStartDate,
    secondLocalEndDate: pair[1].localEndDate,
    secondStartsAt: micros(pair[1].startsAt), secondEndsAt: micros(pair[1].endsAt),
    secondElapsedMinutes: pair[1].elapsedMinutes, secondOpenMinutes: pair[1].openMinutes,
    openMinutesBasis: 'opening_local_date', windowsDigest: windowDigest(pair),
    capturedAt: '2026-05-02T12:00:00.000000Z',
    sourceScope: 'northstar_m24_approved_estimate_decisions',
    targetKey: 'pipeline.approved_estimates', sourceEvents: events,
    sourceEventCount: events.length,
    firstEventCount: events.filter(value => value.period === 'first').length,
    secondEventCount: events.filter(value => value.period === 'second').length,
    sourceSnapshotDigest: 'c'.repeat(64),
    coverage: { state: 'complete', scope: 'northstar_m24_decision_ledger',
      startsAt: '2026-02-01T12:00:00.000000Z',
      providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
      areaObservationCoverageVerified: false } };
}

describe('Mission 26 Part 2B target-complete comparable months v2', () => {
  test('accepts complete selected-source zero while preserving broad boundaries', () => {
    const result = captureView({ state: 'complete', receipt: receipt(),
      replayed: false, sourceCurrent: true }, ORG, ANCHOR, windows());
    expect(result).toMatchObject({ state: 'current', sourceEventCount: 0,
      observationCoverageVerified: true, selectedSourceCoverageVerified: true,
      areaObservationCoverageVerified: false, providerCoverageVerified: false,
      wholeBusinessCoverageVerified: false, targetComplete: true,
      eligibleForForecast: false, forecastIssued: false,
      periods: [{ sourceDecisionCount: 0, completeSelectedSourceZero: true },
        { sourceDecisionCount: 0, completeSelectedSourceZero: true }] });
    expect(result.normalizationDimensions).toContain('elapsed_minutes');
  });

  test('validates bounded positive events against their exact local months', () => {
    const values = [
      event('first', 11, '2026-03-12T13:00:00.000000Z'),
      { ...event('second', 12, '2026-04-08T13:00:00.000000Z'),
        decisionId: '27000000-0000-4000-8000-000000000001' },
    ];
    expect(captureView({ state: 'complete', receipt: receipt(values),
      replayed: false, sourceCurrent: true }, ORG, ANCHOR, windows()))
      .toMatchObject({ periods: [{ sourceDecisionCount: 1 },
        { sourceDecisionCount: 1 }], sourceEventCount: 2 });
  });

  test('reports later source changes as stale without changing immutable counts', () => {
    expect(readView({ state: 'stale', sourceCurrent: false, receipt: receipt(),
      eligibleForForecast: false, forecastIssued: false }, ORG, ANCHOR, windows()))
      .toMatchObject({ state: 'stale', reason: 'source_changed',
        periods: [{ sourceDecisionCount: 0 }, { sourceDecisionCount: 0 }],
        sourceCurrent: false, eligibleForForecast: false, forecastIssued: false });
  });

  test('preserves explicit unavailable coverage without a partial receipt', () => {
    expect(captureView({ state: 'unavailable', reason: 'coverage_epoch_ineligible',
      receipt: null, replayed: false }, ORG, ANCHOR, windows()))
      .toMatchObject({ state: 'unavailable', receiptId: null,
        observationCoverageVerified: false, targetComplete: false });
  });

  test('keeps both persistence bounds fail closed before receipt insertion', () => {
    const migration = fs.readFileSync(path.resolve(__dirname,
      '../../migrations/212_canonical_forecast_comparable_months_v2.sql'), 'utf8');
    expect(migration).toContain('LIMIT 1001');
    expect(migration).toContain('jsonb_array_length(events)>1000');
    expect(migration).toContain('octet_length(events::text)>262144');
    expect(migration.indexOf('jsonb_array_length(events)>1000'))
      .toBeLessThan(migration.indexOf(
        'INSERT INTO public.canonical_forecast_comparable_month_v2_receipts'));
    const values = Array.from({ length: 1001 }, (_value, index) =>
      event('first', index + 1, '2026-03-12T13:00:00.000000Z'));
    expect(() => captureView({ state: 'complete', receipt: receipt(values),
      replayed: false, sourceCurrent: true }, ORG, ANCHOR, windows())).toThrow();
  });

  test.each([
    ['cross tenant', value => { value.receipt.organizationId = PROFILE; }],
    ['changed windows', value => { value.receipt.windowsDigest = 'd'.repeat(64); }],
    ['provider escalation', value => {
      value.receipt.coverage.providerCoverageVerified = true;
    }],
    ['out-of-window event', value => {
      value.receipt.sourceEvents = [event('first', 11, '2026-04-12T13:00:00.000000Z')];
      value.receipt.sourceEventCount = 1; value.receipt.firstEventCount = 1;
    }],
    ['unordered events', value => {
      value.receipt.sourceEvents = [
        event('first', 12, '2026-03-12T13:00:00.000000Z'),
        { ...event('first', 11, '2026-03-13T13:00:00.000000Z'),
          decisionId: '27000000-0000-4000-8000-000000000001' },
      ]; value.receipt.sourceEventCount = 2; value.receipt.firstEventCount = 2;
    }],
  ])('fails closed on %s', (_name, mutate) => {
    const value = { state: 'complete', receipt: receipt(),
      replayed: false, sourceCurrent: true };
    mutate(value);
    expect(() => captureView(value, ORG, ANCHOR, windows())).toThrow();
  });
});
