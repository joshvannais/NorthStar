'use strict';

const { assessCompletePriceFlowEvaluation } = require(
  '../../src/forecasting/completePriceFlowEvaluation');

const start = Date.UTC(2026, 2, 1);
const day = 86400000;
const iso = value => new Date(value).toISOString();

function fixture(count) {
  const comparisons = Array.from({ length: count }, (_, index) => ({
    forecastRunId: `run-${index}`,
    horizon: { startsAt: iso(start + index * day),
      endsAt: iso(start + (index + 1) * day) },
    status: 'paired',
  }));
  const window = {
    state: 'complete_saved_origin_window_observed', expectedUtcDays: 60,
    windowStart: iso(start), windowEnd: iso(start + 60 * day),
    storedOriginCount: count, matchingContextCount: count,
    excludedContextCount: 0,
    origins: comparisons.map(item => ({ runId: item.forecastRunId,
      eligibility: 'matching_context' })),
  };
  const backtest = {
    digest: 'a'.repeat(64), target: { key: 'revenue.approved_price_flow' },
    unit: { key: 'money', currency: 'USD' },
    calculationVersion: 'm26_price_flow_carry_forward_v1',
    reportingWindowBasis: { grain: 'day', timeZone: 'UTC',
      areaScope: 'tenant_all' }, comparisons,
  };
  const measurement = { backtestDigest: backtest.digest,
    originCount: count, statusCounts: { paired: count } };
  const reference = { descriptiveError: { state: 'descriptive_only',
    meanAbsolute: '999999999999999.000001' } };
  const later = { descriptiveError: { state: 'descriptive_only',
    meanAbsolute: '999999999999999.000002' } };
  return { window, backtest, measurement, reference, later };
}

function assess(fixtureValue) {
  const { window, backtest, measurement, reference, later } = fixtureValue;
  return assessCompletePriceFlowEvaluation(window, backtest,
    measurement, reference, later);
}

describe('Mission 26 Part 3C fixed supported-source evaluation window', () => {
  test('counts missing saved days without inventing a sufficient sample', () => {
    const result = assess(fixture(2));
    expect(result.denominator).toMatchObject({ expectedUtcDays: 60,
      missingSavedOriginDays: 58, registeredWindowComplete: false,
      pairedFraction: { numerator: 2, denominator: 60 } });
    expect(result.reference.observedSavedOriginDays).toBe(2);
    expect(result.later.observedSavedOriginDays).toBe(0);
    expect(result.sampleSufficiency).toMatchObject({ state: 'unavailable',
      reason: 'saved_origin_days_missing' });
    expect(result.drift.state).toBe('unavailable');
  });

  test('keeps even a complete fictional sixty-day window non-promoting', () => {
    const result = assess(fixture(60));
    expect(result.denominator).toMatchObject({
      matchingContextCount: 60, missingSavedOriginDays: 0,
      duplicateSavedOriginDays: 0, registeredWindowComplete: true,
      pairedFraction: { numerator: 60, denominator: 60 } });
    expect(result.reference.pairedCount).toBe(30);
    expect(result.later.pairedCount).toBe(30);
    expect(result.drift).toMatchObject({ state: 'descriptive_only',
      direction: 'higher_error', empiricalDriftVerdictAvailable: false });
    expect(result.sampleSufficiency).toMatchObject({ state: 'unavailable',
      reason: 'unsaved_and_off_platform_coverage_unverified' });
    expect(result.realAccuracyAvailable).toBe(false);
  });

  test('duplicate daily origin and changed context refuse window completeness', () => {
    const duplicated = fixture(60);
    duplicated.backtest.comparisons.push({
      ...duplicated.backtest.comparisons[0], forecastRunId: 'extra-run' });
    duplicated.window.origins.push({ runId: 'extra-run',
      eligibility: 'matching_context' });
    duplicated.window.storedOriginCount = 61;
    duplicated.window.matchingContextCount = 61;
    duplicated.measurement.originCount = 61;
    duplicated.measurement.statusCounts.paired = 61;
    expect(assess(duplicated).sampleSufficiency.reason)
      .toBe('duplicate_daily_origins');
    const changed = fixture(60);
    changed.window.origins.push({ runId: 'other-context',
      eligibility: 'excluded_context' });
    changed.window.storedOriginCount = 61;
    changed.window.excludedContextCount = 1;
    expect(assess(changed).sampleSufficiency.reason)
      .toBe('source_context_changed');
  });

  test('refuses a comparison or paired count outside the guarded population', () => {
    const changedRun = fixture(2);
    changedRun.backtest.comparisons[1].forecastRunId = 'unlisted-run';
    expect(() => assess(changedRun)).toThrow(
      'Guarded price-flow evaluation window is invalid.');
    const changedCount = fixture(2);
    changedCount.measurement.statusCounts.paired = 1;
    expect(() => assess(changedCount)).toThrow(
      'Guarded price-flow evaluation window is invalid.');
  });
});
