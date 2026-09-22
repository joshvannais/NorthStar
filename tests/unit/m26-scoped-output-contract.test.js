'use strict';

const { sha256 } = require('../../src/services/businessProfileAdapter');
const base = require('../../src/forecasting/outputContract');
const { VERSION, SCOPE_VERSION, DIMENSIONS, normalizeScopedForecastOutput } =
  require('../../src/forecasting/scopedOutputContract');

const organizationId = '55555555-5555-4555-8555-555555555555';
const snapshot = 'a'.repeat(64);

function dimensions(changes = {}) {
  return { ...Object.fromEntries(Object.keys(DIMENSIONS).map(key => [key, null])),
    roleKey: 'certified_technician', ...changes };
}

function output(changes = {}) {
  const scope = { version: SCOPE_VERSION, dimensions: dimensions() };
  return {
    contractVersion: VERSION,
    organizationId,
    asOf: '2026-09-21T12:00:00.000Z',
    horizon: { startsAt: '2026-09-22T00:00:00.000Z', endsAt: '2026-09-23T00:00:00.000Z', grain: 'day' },
    target: { key: 'capacity.available_role_hours', definitionVersion: 'v1' },
    unit: { key: 'hours', currency: null },
    value: { kind: 'unavailable', reason: 'source_not_authenticated' },
    confidence: { state: 'unavailable', backtestDigest: null },
    uncertainty: { state: 'unquantified', drivers: ['availability_unknown'] },
    evidenceCoverage: { included: 0, excluded: 0, missing: 1, stale: 0, conflicting: 0 },
    applicability: { serviceKey: null, areaKey: null, limits: [] },
    calculationVersion: 'm26-capacity-v1',
    sourceSnapshotDigest: null,
    dimensionScope: { ...scope, digest: sha256(scope) },
    ...changes,
  };
}

function withDimensions(values) {
  const scope = { version: SCOPE_VERSION, dimensions: values };
  return output({ dimensionScope: { ...scope, digest: sha256(scope) } });
}

describe('Mission 26 Part 5B dimension-scoped output boundary', () => {
  test('keeps the existing v1 contract untouched and creates a detached frozen v2 shape', () => {
    const input = output();
    const result = normalizeScopedForecastOutput(input);
    expect(result.dimensionScope.dimensions.roleKey).toBe('certified_technician');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.dimensionScope.dimensions)).toBe(true);
    input.dimensionScope.dimensions.roleKey = 'changed';
    expect(result.dimensionScope.dimensions.roleKey).toBe('certified_technician');
    const { dimensionScope: _scope, ...unscoped } = output();
    expect(base.normalizeForecastOutput({ ...unscoped, contractVersion: base.VERSION }).contractVersion)
      .toBe(base.VERSION);
    expect(() => base.normalizeForecastOutput(output())).toThrow();
  });

  test('distinct role and asset identities have distinct canonical digests', () => {
    const first = output();
    const second = withDimensions(dimensions({ roleKey: 'operator' }));
    const third = withDimensions(dimensions({
      roleKey: null,
      assetId: '22222222-2222-4222-8222-222222222222',
      operatingClass: 'productive',
    }));
    expect(new Set([first, second, third].map(value =>
      normalizeScopedForecastOutput(value).dimensionScope.digest)).size).toBe(3);
  });

  test('rejects stale, missing and forged scope identity', () => {
    const changed = output();
    changed.dimensionScope.dimensions.roleKey = 'operator';
    for (const bad of [
      changed,
      withDimensions(dimensions({ roleKey: null })),
      withDimensions(dimensions({ roleKey: ['operator'] })),
      withDimensions(dimensions({ roleKey: 'Owner Operator' })),
      withDimensions(dimensions({ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase() })),
      output({ dimensionScope: { ...output().dimensionScope, secret: 'hidden' } }),
    ]) expect(() => normalizeScopedForecastOutput(bad)).toThrow('Forecast dimension scope is invalid.');
  });

  test('rejects arbitrary dimensions and malicious object shapes', () => {
    const extra = withDimensions({ ...dimensions(), customerName: 'Private Name' });
    const hidden = output();
    Object.defineProperty(hidden.dimensionScope.dimensions, 'hidden', { value: 'secret' });
    const getter = output();
    Object.defineProperty(getter.dimensionScope.dimensions, 'roleKey', {
      enumerable: true, get: () => 'operator',
    });
    for (const bad of [extra, hidden, getter, output({ dimensionScope: ['roleKey'] })]) {
      expect(() => normalizeScopedForecastOutput(bad)).toThrow('Forecast dimension scope is invalid.');
    }
  });

  test('retains v1 monetary, source-pin and calibration safeguards', () => {
    for (const bad of [
      output({ value: { kind: 'point', amount: '4' } }),
      output({ confidence: { state: 'calibrated', backtestDigest: 'b'.repeat(64) } }),
      output({ unit: { key: 'money', currency: null } }),
      output({ sourceSnapshotDigest: ['a'.repeat(64)] }),
    ]) expect(() => normalizeScopedForecastOutput(bad)).toThrow();
    expect(normalizeScopedForecastOutput(output({
      value: { kind: 'point', amount: '4' }, sourceSnapshotDigest: snapshot,
    })).value.amount).toBe('4');
  });
});
