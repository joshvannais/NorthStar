'use strict';

const { VERSION, buildRollingBacktest } = require('../../src/forecasting/rollingBacktest');
const { VERSION: OUTPUT_VERSION } = require('../../src/forecasting/outputContract');
const { VERSION: WINDOW_VERSION } = require('../../src/forecasting/timeSeriesWindows');
const { sha256 } = require('../../src/services/businessProfileAdapter');

const organizationId = '55555555-5555-4555-8555-555555555555';
const snapshotDigest = 'a'.repeat(64);
const actualDigest = 'b'.repeat(64);

function output(asOf, startsAt, endsAt, amount = '10') {
  return {
    contractVersion: OUTPUT_VERSION, organizationId, asOf,
    horizon: { startsAt, endsAt, grain: 'month' },
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
    unit: { key: 'count', currency: null },
    value: { kind: 'point', amount },
    confidence: { state: 'unavailable', backtestDigest: null },
    uncertainty: { state: 'unquantified', drivers: [] },
    evidenceCoverage: { included: 5, excluded: 0, missing: 0, stale: 0, conflicting: 0 },
    applicability: { serviceKey: null, areaKey: null, limits: [] },
    calculationVersion: 'm26-fixture-v1', sourceSnapshotDigest: snapshotDigest,
  };
}

function run(id, asOf, startsAt, endsAt, amount) {
  const forecast = output(asOf, startsAt, endsAt, amount);
  return { id, savedAt: asOf, outputDigest: sha256(forecast),
    sourceSnapshotAsOf: asOf, latestSourceRecordedAt: asOf,
    reportingWindow: {
      version: WINDOW_VERSION, organizationId,
      businessProfileId: '77777777-7777-4777-8777-777777777777',
      businessProfileVersion: 1, businessProfileHash: 'c'.repeat(64),
      timeZone: 'UTC', grain: forecast.horizon.grain,
      serviceKey: null, areaScope: 'tenant_all', areaDigest: null,
      calendarState: 'known', calendarDigest: 'd'.repeat(64),
      localStartDate: startsAt.slice(0, 10), localEndDate: endsAt.slice(0, 10),
      startsAt, endsAt, elapsedMinutes: (Date.parse(endsAt) - Date.parse(startsAt)) / 60000,
      openMinutes: 0, openMinutesBasis: 'opening_local_date',
    }, output: forecast };
}

function outcome(runReceipt, id, amount = '8') {
  return {
    id, forecastRunId: runReceipt.id, organizationId,
    target: { ...runReceipt.output.target }, horizon: { ...runReceipt.output.horizon },
    unit: { ...runReceipt.output.unit },
    applicability: { ...runReceipt.output.applicability },
    observedThrough: runReceipt.output.horizon.endsAt,
    capturedAt: runReceipt.output.horizon.endsAt,
    sourceDigest: actualDigest, state: 'known', amount, reason: null,
  };
}

const first = () => run('11111111-1111-4111-8111-111111111111',
  '2026-01-31T20:00:00.000Z', '2026-02-01T00:00:00.000Z',
  '2026-03-01T00:00:00.000Z', '10');
const second = () => run('22222222-2222-4222-8222-222222222222',
  '2026-02-28T20:00:00.000Z', '2026-03-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z', '12');

describe('Mission 26 Part 3B bounded rolling comparison contract', () => {
  test('orders successive origins, retains observed zero and yields reproducible receipts', () => {
    const one = first();
    const two = second();
    const input = { version: VERSION, runs: [two, one],
      outcomes: [outcome(two, '44444444-4444-4444-8444-444444444444', '9'),
        outcome(one, '33333333-3333-4333-8333-333333333333', '0')] };
    const result = buildRollingBacktest(input);
    expect(result.originCount).toBe(2);
    expect(result.comparisons.map(pair => pair.forecastRunId)).toEqual([one.id, two.id]);
    expect(result.comparisons[0].outcomeAmount).toBe('0');
    expect(result.comparisons[0].status).toBe('paired');
    expect(result.calculationVersion).toBe('m26-fixture-v1');
    expect(result.comparisons[0].reportingWindowDigest).toBe(sha256(one.reportingWindow));
    expect(result.comparisons[1].windowNormalizationRequired).toBe(true);
    expect(result.comparisons[1]).toMatchObject({ status: 'window_normalization_required',
      outcomeAmount: null, reason: 'window_normalization_required' });
    expect(result.digest).toBe(buildRollingBacktest(input).digest);
    expect(Object.isFrozen(result.comparisons[0])).toBe(true);
    input.outcomes[1].amount = '100';
    expect(result.comparisons[0].outcomeAmount).toBe('0');
  });

  test('missing or unfinalized outcomes do not become zero or paired evidence', () => {
    const one = first();
    const two = second();
    const pending = outcome(two, '44444444-4444-4444-8444-444444444444');
    Object.assign(pending, { state: 'pending', amount: null, reason: 'source_not_final',
      sourceDigest: null, observedThrough: null });
    const result = buildRollingBacktest({ version: VERSION, runs: [one, two], outcomes: [pending] });
    expect(result.comparisons.map(pair => [pair.status, pair.reason, pair.outcomeAmount])).toEqual([
      ['outcome_unavailable', 'outcome_not_supplied', null],
      ['outcome_unavailable', 'source_not_final', null],
    ]);
  });

  test('forecast without an amount never becomes a numeric comparison', () => {
    const one = first();
    one.output.value = { kind: 'unavailable', reason: 'insufficient_history' };
    one.output.sourceSnapshotDigest = null;
    one.sourceSnapshotAsOf = null;
    one.latestSourceRecordedAt = null;
    one.outputDigest = sha256(one.output);
    const result = buildRollingBacktest({ version: VERSION, runs: [one],
      outcomes: [outcome(one, '33333333-3333-4333-8333-333333333333')] });
    expect(result.comparisons[0]).toMatchObject({ status: 'forecast_unavailable',
      reason: 'insufficient_history', outcomeAmount: null });
  });

  test('rejects forecast save after horizon start and past-start nowcasts', () => {
    const late = first();
    late.savedAt = '2026-02-01T01:00:00.000Z';
    const nowcast = first();
    nowcast.output.asOf = '2026-02-15T00:00:00.000Z';
    nowcast.savedAt = nowcast.output.asOf;
    nowcast.sourceSnapshotAsOf = nowcast.output.asOf;
    nowcast.latestSourceRecordedAt = nowcast.output.asOf;
    nowcast.outputDigest = sha256(nowcast.output);
    for (const candidate of [late, nowcast]) {
      expect(() => buildRollingBacktest({ version: VERSION, runs: [candidate], outcomes: [] }))
        .toThrow('Rolling backtest comparison details are invalid.');
    }
  });

  test('rejects a source record later than the historical prediction cutoff', () => {
    const one = first();
    one.latestSourceRecordedAt = '2026-02-01T00:00:00.000Z';
    expect(() => buildRollingBacktest({ version: VERSION, runs: [one], outcomes: [] }))
      .toThrow('Rolling backtest comparison details are invalid.');
  });

  test('rejects a saved-output digest that does not match the frozen envelope', () => {
    const one = first();
    one.outputDigest = 'c'.repeat(64);
    expect(() => buildRollingBacktest({ version: VERSION, runs: [one], outcomes: [] }))
      .toThrow('Rolling backtest comparison details are invalid.');
  });

  test('rejects crossed tenant, target, period and unit outcome identities', () => {
    const one = first();
    for (const change of [
      row => { row.organizationId = '66666666-6666-4666-8666-666666666666'; },
      row => { row.target.key = 'revenue.approved_price_flow'; },
      row => { row.horizon.endsAt = '2026-04-01T00:00:00.000Z'; },
      row => { row.unit.key = 'money'; row.unit.currency = 'USD'; },
      row => { row.observedThrough = '2026-02-28T00:00:00.000Z'; },
      row => { row.applicability.limits.extra = 'hidden'; },
    ]) {
      const actual = outcome(one, '33333333-3333-4333-8333-333333333333');
      change(actual);
      expect(() => buildRollingBacktest({ version: VERSION, runs: [one], outcomes: [actual] }))
        .toThrow('Rolling backtest comparison details are invalid.');
    }
  });

  test('rejects duplicate, orphan, sparse and oversized inputs', () => {
    const one = first();
    const actual = outcome(one, '33333333-3333-4333-8333-333333333333');
    const sparse = Array(2); sparse[0] = one;
    const disguisedSparse = Array(1); disguisedSparse.extra = 'hidden';
    for (const input of [
      { version: VERSION, runs: [one, one], outcomes: [] },
      { version: VERSION, runs: [one], outcomes: [actual, actual] },
      { version: VERSION, runs: [second()], outcomes: [actual] },
      { version: VERSION, runs: sparse, outcomes: [] },
      { version: VERSION, runs: disguisedSparse, outcomes: [] },
      { version: VERSION, runs: Array(101).fill(one), outcomes: [] },
    ]) {
      try { buildRollingBacktest(input); throw new Error('accepted malformed input'); }
      catch (error) { expect(error.code).toBe('M26_BACKTEST_COMPARISON_INVALID'); }
    }
  });

  test('rejects sparse applicability hidden by an extra key', () => {
    const one = first();
    one.output.applicability.limits = ['a'];
    one.outputDigest = sha256(one.output);
    const actual = outcome(one, '33333333-3333-4333-8333-333333333333');
    actual.applicability.limits = Array(1);
    actual.applicability.limits.extra = 'hidden';
    expect(() => buildRollingBacktest({ version: VERSION, runs: [one], outcomes: [actual] }))
      .toThrow('Rolling backtest comparison details are invalid.');
  });

  test('does not pool mixed algorithms or reporting-window contexts', () => {
    const one = first();
    const algorithm = second();
    algorithm.output.calculationVersion = 'another-algorithm';
    algorithm.outputDigest = sha256(algorithm.output);
    const grain = run('33333333-3333-4333-8333-333333333333',
      '2026-12-31T20:00:00.000Z', '2027-01-01T00:00:00.000Z',
      '2028-01-01T00:00:00.000Z', '12');
    grain.output.horizon.grain = 'year';
    grain.outputDigest = sha256(grain.output);
    grain.reportingWindow.grain = 'year';
    const zone = run('44444444-4444-4444-8444-444444444444',
      '2026-02-28T20:00:00.000Z', '2026-03-01T05:00:00.000Z',
      '2026-04-01T04:00:00.000Z', '12');
    zone.reportingWindow.timeZone = 'America/New_York';
    for (const candidate of [algorithm, grain, zone]) {
      expect(() => buildRollingBacktest({ version: VERSION,
        runs: [one, candidate], outcomes: [] }))
        .toThrow('Rolling backtest comparison details are invalid.');
    }
  });

  test('blocks scoped and cohort targets until a compatible immutable run identity exists', () => {
    const one = first();
    for (const key of ['resource.asset_utilization_hours', 'resource.material_consumption',
      'capacity.available_role_hours', 'demand.booking_transition']) {
      const candidate = structuredClone(one);
      candidate.output.target.key = key;
      candidate.outputDigest = sha256(candidate.output);
      expect(() => buildRollingBacktest({ version: VERSION, runs: [candidate], outcomes: [] }))
        .toThrow('Rolling backtest comparison details are invalid.');
    }
  });
});
