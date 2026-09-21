'use strict';

const { VERSION, measureEvaluation } = require('../../src/forecasting/evaluationGates');
const { VERSION: OUTPUT_VERSION } = require('../../src/forecasting/outputContract');
const { VERSION: WINDOW_VERSION } = require('../../src/forecasting/timeSeriesWindows');
const { sha256 } = require('../../src/services/businessProfileAdapter');

const tenant = '55555555-5555-4555-8555-555555555555';
const start = '2026-03-01T00:00:00.000Z';
const end = '2026-04-01T00:00:00.000Z';
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

function run(index, amount) {
  const asOf = `2026-02-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`;
  const output = {
    contractVersion: OUTPUT_VERSION, organizationId: tenant, asOf,
    horizon: { startsAt: start, endsAt: end, grain: 'month' },
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
    unit: { key: 'count', currency: null },
    value: { kind: 'point', amount },
    confidence: { state: 'unavailable', backtestDigest: null },
    uncertainty: { state: 'unquantified', drivers: [] },
    evidenceCoverage: { included: 5, excluded: 0, missing: 0, stale: 0, conflicting: 0 },
    applicability: { serviceKey: null, areaKey: null, limits: [] },
    calculationVersion: 'm26-fixture-v1', sourceSnapshotDigest: 'a'.repeat(64),
  };
  const reportingWindow = {
    version: WINDOW_VERSION, organizationId: tenant,
    businessProfileId: '77777777-7777-4777-8777-777777777777',
    businessProfileVersion: 1, businessProfileHash: 'c'.repeat(64),
    timeZone: 'UTC', grain: 'month', serviceKey: null,
    areaScope: 'tenant_all', areaDigest: null,
    calendarState: 'known', calendarDigest: 'd'.repeat(64),
    localStartDate: '2026-03-01', localEndDate: '2026-04-01',
    startsAt: start, endsAt: end, elapsedMinutes: 44640,
    openMinutes: 0, openMinutesBasis: 'opening_local_date',
  };
  return { id: ids[index], savedAt: asOf, outputDigest: sha256(output),
    sourceSnapshotAsOf: asOf, latestSourceRecordedAt: asOf,
    reportingWindow, output };
}

function outcome(saved, id, amount) {
  return { id, forecastRunId: saved.id, organizationId: tenant,
    target: { ...saved.output.target }, horizon: { ...saved.output.horizon },
    unit: { ...saved.output.unit }, applicability: { ...saved.output.applicability },
    observedThrough: saved.output.horizon.endsAt,
    capturedAt: saved.output.horizon.endsAt, sourceDigest: 'b'.repeat(64),
    state: 'known', amount, reason: null };
}

describe('Mission 26 Part 3C descriptive evaluation boundary', () => {
  test('keeps the full denominator, zero actual and deterministic exact-unit error', () => {
    const a = run(0, '10');
    const b = run(1, '6');
    const c = run(2, '20');
    const input = { version: VERSION, runs: [c, b, a], outcomes: [
      outcome(a, '44444444-4444-4444-8444-444444444444', '8'),
      outcome(b, '66666666-6666-4666-8666-666666666666', '0'),
    ] };
    const result = measureEvaluation(input);
    expect(result).toMatchObject({ originCount: 3, comparisonCount: 3,
      statusCounts: { paired: 2, outcome_unavailable: 1,
        forecast_unavailable: 0, window_normalization_required: 0 },
      descriptiveError: { state: 'descriptive_only', pairedCount: 2,
        totalAbsolute: '8', meanAbsolute: '4', meanSigned: '4' },
      sampleSufficiency: { state: 'unavailable' },
      calibration: { state: 'unavailable' }, drift: { state: 'unavailable' } });
    expect(result.unavailableReasonCounts).toEqual({ outcome_not_supplied: 1 });
    expect(result.predictionAsOfRange).toEqual({
      earliest: a.output.asOf, latest: c.output.asOf });
    expect(result.outcomeCutoffRange).toEqual({ earliest: end, latest: end });
    expect(result.digest).toBe(measureEvaluation(input).digest);
    expect(Object.isFrozen(result.statusCounts)).toBe(true);
  });

  test('allows a fractional expected count against an integer observed count', () => {
    const saved = run(0, '10.5');
    const result = measureEvaluation({ version: VERSION, runs: [saved], outcomes: [
      outcome(saved, '44444444-4444-4444-8444-444444444444', '10'),
    ] });
    expect(result.descriptiveError).toMatchObject({ totalAbsolute: '0.5',
      meanAbsolute: '0.5', meanSigned: '0.5' });
  });

  test('withholds error when no actual outcome is paired', () => {
    const result = measureEvaluation({ version: VERSION, runs: [run(0, '10')], outcomes: [] });
    expect(result.descriptiveError).toMatchObject({ state: 'unavailable',
      reason: 'no_paired_actuals', totalAbsolute: null });
    expect(result.statusCounts.outcome_unavailable).toBe(1);
  });

  test('retains distinct unfinalized reasons and their cutoff bounds', () => {
    const a = run(0, '10');
    const b = run(1, '12');
    const revoked = outcome(a, '44444444-4444-4444-8444-444444444444', '1');
    Object.assign(revoked, { state: 'revoked', amount: null, reason: 'source_revoked',
      sourceDigest: null, observedThrough: null });
    const pending = outcome(b, '66666666-6666-4666-8666-666666666666', '1');
    Object.assign(pending, { state: 'pending', amount: null, reason: 'source_pending',
      sourceDigest: null, observedThrough: null });
    const result = measureEvaluation({ version: VERSION, runs: [a, b],
      outcomes: [pending, revoked] });
    expect(result.statusCounts.outcome_unavailable).toBe(2);
    expect(result.unavailableReasonCounts).toEqual({ source_pending: 1, source_revoked: 1 });
    expect(result.outcomeCutoffRange).toEqual({ earliest: null, latest: null });
    expect(result.descriptiveError.state).toBe('unavailable');
  });

  test('keeps a finalized outcome out of error until its window is normalized', () => {
    const first = run(0, '10');
    const later = run(1, '12');
    later.output.horizon = { startsAt: '2026-04-01T00:00:00.000Z',
      endsAt: '2026-05-01T00:00:00.000Z', grain: 'month' };
    later.outputDigest = sha256(later.output);
    Object.assign(later.reportingWindow, {
      localStartDate: '2026-04-01', localEndDate: '2026-05-01',
      startsAt: later.output.horizon.startsAt, endsAt: later.output.horizon.endsAt,
      elapsedMinutes: 43200,
    });
    const result = measureEvaluation({ version: VERSION, runs: [first, later],
      outcomes: [outcome(first, '44444444-4444-4444-8444-444444444444', '8'),
        outcome(later, '66666666-6666-4666-8666-666666666666', '11')] });
    expect(result.statusCounts).toMatchObject({ paired: 1, window_normalization_required: 1 });
    expect(result.descriptiveError).toMatchObject({ pairedCount: 1, totalAbsolute: '2' });
  });

  test('separates scenario envelopes from statistical interval observations', () => {
    const scenario = run(0, '10');
    scenario.output.value = { kind: 'range', lower: '5', central: '10',
      upper: '15', basis: 'deterministic_scenario' };
    scenario.output.uncertainty.state = 'deterministic_scenario';
    scenario.outputDigest = sha256(scenario.output);
    const interval = run(1, '10');
    interval.output.value = { kind: 'range', lower: '5', central: '10',
      upper: '15', basis: 'calibrated_interval' };
    interval.output.uncertainty.state = 'calibrated_interval';
    interval.output.confidence = { state: 'calibrated', backtestDigest: 'e'.repeat(64) };
    interval.outputDigest = sha256(interval.output);
    const result = measureEvaluation({ version: VERSION, runs: [scenario, interval],
      outcomes: [outcome(scenario, '44444444-4444-4444-8444-444444444444', '12'),
        outcome(interval, '66666666-6666-4666-8666-666666666666', '16')] });
    expect(result.valueKinds).toEqual({ pointCount: 0, scenarioEnvelopeCount: 1,
      scenarioEnvelopeHits: 1, calibratedIntervalCount: 1, calibratedIntervalHits: 0 });
    expect(result.calibration.state).toBe('unavailable');
  });

  test('refuses malformed evaluation input and mixed algorithm versions', () => {
    const first = run(0, '10');
    const second = run(1, '12');
    second.output.calculationVersion = 'another-version';
    second.outputDigest = sha256(second.output);
    expect(() => measureEvaluation({ version: VERSION, runs: [first, second], outcomes: [] }))
      .toThrow('Rolling backtest comparison details are invalid.');
    expect(() => measureEvaluation({ version: VERSION, runs: [first], outcomes: [],
      threshold: 1 })).toThrow('Forecast evaluation details are invalid.');
  });

  test('rounds a negative money mean at six-place ties away from zero', () => {
    const a = run(0, '0');
    const b = run(1, '0');
    for (const saved of [a, b]) {
      saved.output.target.key = 'revenue.approved_price_flow';
      saved.output.unit = { key: 'money', currency: 'USD' };
      saved.outputDigest = sha256(saved.output);
    }
    const result = measureEvaluation({ version: VERSION, runs: [a, b],
      outcomes: [outcome(a, '44444444-4444-4444-8444-444444444444', '0.000001'),
        outcome(b, '66666666-6666-4666-8666-666666666666', '0')] });
    expect(result.descriptiveError).toMatchObject({ totalAbsolute: '0.000001',
      meanAbsolute: '0.000001', meanSigned: '-0.000001' });
  });

});
