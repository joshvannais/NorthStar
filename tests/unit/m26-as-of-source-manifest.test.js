'use strict';

const { VERSION, normalizeAsOfSourceManifest } = require('../../src/forecasting/asOfSourceManifest');

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const org = '55555555-5555-4555-8555-555555555555';
const source = (overrides = {}) => ({
  sourceKind: 'scheduled_work', sourceId: a, revision: 2, digest: 'a'.repeat(64),
  recordedAt: '2026-09-20T12:00:00.000Z',
  eventAt: '2026-10-10T12:00:00.000Z', state: 'active', ...overrides,
});
const manifest = (overrides = {}) => ({
  version: VERSION, organizationId: org, asOf: '2026-09-21T12:00:00.000Z',
  capturedAt: '2026-09-21T12:15:00.000Z', purposeKey: 'forecast_demand',
  targetKey: 'demand.lead_count', sources: [source()], ...overrides,
});

describe('Mission 26 Part 2A as-of source manifest', () => {
  test('pins a revision already recorded at the cutoff and detaches the result', () => {
    const input = manifest();
    const result = normalizeAsOfSourceManifest(input);
    expect(result).toEqual(input);
    expect(Object.isFrozen(result.sources[0])).toBe(true);
    input.sources[0].revision = 3;
    expect(result.sources[0].revision).toBe(2);
  });

  test('future work known before the cutoff is permitted, but a later correction is not', () => {
    expect(normalizeAsOfSourceManifest(manifest()).sources[0].eventAt)
      .toBe('2026-10-10T12:00:00.000Z');
    expect(() => normalizeAsOfSourceManifest(manifest({ sources: [source({
      revision: 3, recordedAt: '2026-09-21T12:00:00.001Z',
    })] }))).toThrow('Forecast source snapshot details are invalid.');
    // The work happened before the cutoff, but NorthStar received it later.
    expect(() => normalizeAsOfSourceManifest(manifest({ sources: [source({
      sourceKind: 'imported_actual', eventAt: '2026-08-01T12:00:00.000Z',
      recordedAt: '2026-09-22T12:00:00.000Z',
    })] }))).toThrow('Forecast source snapshot details are invalid.');
  });

  test('rejects a future cutoff, malformed time, duplicate identity and hidden keys', () => {
    for (const value of [
      manifest({ asOf: '2026-09-21T12:15:00.001Z' }),
      manifest({ asOf: '2026-09-21T08:00:00.000-04:00' }),
      manifest({ sources: [source(), source({ revision: 1 })] }),
      manifest({ sources: [source({ eventAt: '2026-02-30T00:00:00.000Z' })] }),
      manifest({ sources: [source({ customerName: 'Private' })] }),
    ]) expect(() => normalizeAsOfSourceManifest(value)).toThrow('Forecast source snapshot details are invalid.');
  });

  test('normalizes source order and permits an explicit no-evidence manifest', () => {
    const result = normalizeAsOfSourceManifest(manifest({ sources: [
      source({ sourceKind: 'work', sourceId: b }),
      source({ sourceKind: 'lead', sourceId: a }),
    ] }));
    expect(result.sources.map(item => item.sourceKind)).toEqual(['lead', 'work']);
    expect(normalizeAsOfSourceManifest(manifest({ sources: [] })).sources).toEqual([]);
  });

  test('compares microsecond database instants without losing precision', () => {
    const cutoff = '2026-09-21T12:00:00.123456Z';
    expect(normalizeAsOfSourceManifest(manifest({
      asOf: cutoff, capturedAt: cutoff,
      sources: [source({ recordedAt: '2026-09-21T12:00:00.123455Z' })],
    })).sources).toHaveLength(1);
    expect(() => normalizeAsOfSourceManifest(manifest({
      asOf: cutoff, capturedAt: cutoff,
      sources: [source({ recordedAt: '2026-09-21T12:00:00.123457Z' })],
    }))).toThrow('Forecast source snapshot details are invalid.');
    expect(() => normalizeAsOfSourceManifest(manifest({
      asOf: cutoff, capturedAt: '2026-09-21T12:00:00.123Z',
    }))).toThrow('Forecast source snapshot details are invalid.');
  });
});
