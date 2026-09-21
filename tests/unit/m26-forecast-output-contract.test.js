'use strict';

const { VERSION, normalizeForecastOutput } = require('../../src/forecasting/outputContract');

const digest = 'a'.repeat(64);
const backtestDigest = 'b'.repeat(64);

function output(overrides = {}) {
  return {
    contractVersion: VERSION,
    organizationId: '55555555-5555-4555-8555-555555555555',
    asOf: '2026-09-21T12:00:00.000Z',
    horizon: { startsAt: '2026-09-21T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', grain: 'month' },
    target: { key: 'demand.lead_count', definitionVersion: 'v1' },
    unit: { key: 'count', currency: null },
    value: { kind: 'point', amount: '12' },
    confidence: { state: 'unavailable', backtestDigest: null },
    uncertainty: { state: 'unquantified', drivers: ['limited_history'] },
    evidenceCoverage: { included: 8, excluded: 1, missing: 2, stale: 0, conflicting: 0 },
    applicability: { serviceKey: null, areaKey: null, limits: ['tenant_history_only'] },
    calculationVersion: 'm26-demand-v1',
    sourceSnapshotDigest: digest,
    ...overrides,
  };
}

describe('Mission 26 Part 1B forecast output shape', () => {
  test('accepts a pinned deterministic point and freezes the normalized output', () => {
    const input = output();
    const normalized = normalizeForecastOutput(input);
    expect(normalized).toEqual(input);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.horizon)).toBe(true);
    input.value.amount = '99';
    expect(normalized.value.amount).toBe('12');
  });

  test('keeps insufficient evidence unavailable rather than turning it into zero', () => {
    const normalized = normalizeForecastOutput(output({
      value: { kind: 'unavailable', reason: 'insufficient_history' },
      sourceSnapshotDigest: null,
      evidenceCoverage: { included: 0, excluded: 0, missing: 4, stale: 1, conflicting: 0 },
    }));
    expect(normalized.value).toEqual({ kind: 'unavailable', reason: 'insufficient_history' });
    expect(() => normalizeForecastOutput(output({ sourceSnapshotDigest: null }))).toThrow('Forecast output details are invalid.');
  });

  test('separates a deterministic scenario range from a calibrated interval', () => {
    const scenario = normalizeForecastOutput(output({
      value: { kind: 'range', lower: '-5.25', central: '0', upper: '4.125', basis: 'deterministic_scenario' },
      uncertainty: { state: 'deterministic_scenario', drivers: ['weather_exposure'] },
    }));
    expect(scenario.confidence.state).toBe('unavailable');
    const calibrated = normalizeForecastOutput(output({
      value: { kind: 'range', lower: '8', central: '12', upper: '17', basis: 'calibrated_interval' },
      confidence: { state: 'calibrated', backtestDigest },
      uncertainty: { state: 'calibrated_interval', drivers: ['seasonal_demand'] },
    }));
    expect(calibrated.confidence.backtestDigest).toBe(backtestDigest);
    expect(() => normalizeForecastOutput(output({
      value: { kind: 'range', lower: '8', central: '12', upper: '17', basis: 'calibrated_interval' },
      uncertainty: { state: 'calibrated_interval', drivers: [] },
    }))).toThrow('Forecast output details are invalid.');
  });

  test('rejects invalid time windows and any ambiguous as-of time', () => {
    for (const bad of [
      output({ asOf: '2026-09-21T08:00:00-04:00' }),
      output({ asOf: '2026-10-01T00:00:00.000Z' }),
      output({ horizon: { startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-09-21T00:00:00.000Z', grain: 'day' } }),
      output({ horizon: { startsAt: '2026-02-30T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', grain: 'month' } }),
    ]) expect(() => normalizeForecastOutput(bad)).toThrow('Forecast output details are invalid.');
  });

  test('rejects numeric or reversed amounts without floating-point arithmetic', () => {
    for (const bad of [
      output({ value: { kind: 'point', amount: 12 } }),
      output({ value: { kind: 'point', amount: '01.00' } }),
      output({ value: { kind: 'point', amount: '-0.000' } }),
      output({ confidence: { state: 'calibrated', backtestDigest } }),
      output({ value: { kind: 'range', lower: '12.000001', central: '12', upper: '13', basis: 'deterministic_scenario' }, uncertainty: { state: 'deterministic_scenario', drivers: [] } }),
    ]) expect(() => normalizeForecastOutput(bad)).toThrow('Forecast output details are invalid.');
  });

  test('requires exact currency, coverage and scope fields', () => {
    expect(normalizeForecastOutput(output({ unit: { key: 'money', currency: 'USD' } })).unit.currency).toBe('USD');
    for (const bad of [
      output({ unit: { key: 'money', currency: null } }),
      output({ unit: { key: 'count', currency: 'USD' } }),
      output({ evidenceCoverage: { included: -1, excluded: 1, missing: 0, stale: 0, conflicting: 0 } }),
      output({ applicability: { serviceKey: null, areaKey: null, limits: ['same_code', 'same_code'] } }),
      output({ secretCustomerName: 'Should never be accepted' }),
    ]) expect(() => normalizeForecastOutput(bad)).toThrow('Forecast output details are invalid.');
    const hidden = output();
    Object.defineProperty(hidden, 'toJSON', { value: () => ({}) });
    expect(() => normalizeForecastOutput(hidden)).toThrow('Forecast output details are invalid.');
  });
});
