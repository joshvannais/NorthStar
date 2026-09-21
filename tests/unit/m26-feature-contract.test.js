'use strict';

const { DEFINITION_VERSION, VALUE_VERSION, normalizeFeatureDefinition,
  normalizeFeatureValue } = require('../../src/forecasting/featureContract');
const { deriveReportingWindow } = require('../../src/forecasting/timeSeriesWindows');
const { registeredFeatureDefinition, normalizeRegisteredFeatureValue } =
  require('../../src/forecasting/featureDefinitions');
const { sha256 } = require('../../src/services/businessProfileAdapter');

const org = '11111111-1111-4111-8111-111111111111';
const profile = '22222222-2222-4222-8222-222222222222';
const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday'].map(day =>
  [day, { open: '09:00', close: '17:00' }]));
hours.holidays = [];

function definition(changes = {}) {
  return {
    contractVersion: DEFINITION_VERSION,
    key: 'pipeline.approved_estimate_stock', definitionVersion: 'v1',
    sourceKinds: ['estimate_decision'], sourcePurposeKey: 'forecast_pipeline',
    sourceTargetKey: 'pipeline.approved_estimates',
    derivationKey: 'active_decision_count', temporalBasis: 'as_of_stock',
    unit: { key: 'count', currency: null, scale: 0 }, allowsNegative: false,
    ...changes,
  };
}

function value(changes = {}) {
  return {
    contractVersion: VALUE_VERSION, organizationId: org,
    definitionKey: 'pipeline.approved_estimate_stock', definitionVersion: 'v1',
    definitionDigest: sha256(normalizeFeatureDefinition(definition())),
    asOf: '2026-09-21T12:00:00.000000Z', reportingWindow: null,
    sourceSnapshotDigest: 'a'.repeat(64),
    latestSourceRecordedAt: '2026-09-21T11:59:59.999999Z',
    state: 'known', amount: '4', reason: null,
    unit: { key: 'count', currency: null, scale: 0 },
    ...changes,
  };
}

function reportingWindow() {
  return deriveReportingWindow({
    organizationId: org, businessProfileId: profile, businessProfileVersion: 2,
    businessProfileHash: 'b'.repeat(64),
    rawProfile: { company: { timeZone: 'America/New_York' }, hours },
    grain: 'day', localStartDate: '2026-09-20', serviceKey: 'plumbing',
    areaScope: 'tenant_all',
  });
}

describe('Mission 26 Part 2C feature boundary', () => {
  test('only the source-controlled definition is registered', () => {
    expect(registeredFeatureDefinition('pipeline.approved_estimate_stock', 'v1'))
      .toMatchObject({ sourceKinds: ['estimate_decision'],
        derivationKey: 'active_decision_count', unit: { key: 'count', scale: 0 } });
    expect(registeredFeatureDefinition('pipeline.approved_estimate_stock', 'v2')).toBeNull();
    expect(normalizeRegisteredFeatureValue(value({ amount: '0',
      latestSourceRecordedAt: null })).amount).toBe('0');
    expect(() => normalizeRegisteredFeatureValue(value({ amount: '4',
      latestSourceRecordedAt: null })))
      .toThrow('Forecast feature source record time is required.');
    expect(() => normalizeRegisteredFeatureValue(value({ definitionVersion: 'v2' })))
      .toThrow('Forecast feature definition is not registered.');
  });
  test('pins a detached, versioned exact-unit definition', () => {
    const source = definition();
    const result = normalizeFeatureDefinition(source);
    source.sourceKinds[0] = 'other';
    source.unit.key = 'money';
    expect(result).toMatchObject({ sourceKinds: ['estimate_decision'],
      unit: { key: 'count', currency: null, scale: 0 } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceKinds)).toBe(true);
    expect(() => normalizeFeatureDefinition(definition({ sourceKinds: ['work', 'work'] })))
      .toThrow('Forecast feature details are invalid.');
    expect(() => normalizeFeatureDefinition(definition({ unexpected: 1 })))
      .toThrow('Forecast feature details are invalid.');
  });

  test('requires exact monetary currency and precision while preserving nonmoney units', () => {
    expect(normalizeFeatureDefinition(definition({
      unit: { key: 'money', currency: 'USD', scale: 2 },
    })).unit).toEqual({ key: 'money', currency: 'USD', scale: 2 });
    for (const unit of [
      { key: 'money', currency: null, scale: 2 },
      { key: 'money', currency: 'usd', scale: 2 },
      { key: 'count', currency: 'USD', scale: 0 },
      { key: 'count', currency: null, scale: 7 },
    ]) expect(() => normalizeFeatureDefinition(definition({ unit })))
      .toThrow('Forecast feature details are invalid.');
    const monetary = definition({ key: 'cost.labor', unit: {
      key: 'money', currency: 'USD', scale: 2 }, allowsNegative: true });
    const monetaryValue = value({ definitionKey: 'cost.labor',
      definitionDigest: sha256(normalizeFeatureDefinition(monetary)),
      unit: monetary.unit, amount: '-12.34' });
    expect(normalizeFeatureValue(monetaryValue, monetary).amount).toBe('-12.34');
    expect(() => normalizeFeatureValue({ ...monetaryValue, amount: '-12.345' }, monetary))
      .toThrow('Forecast feature details are invalid.');
    expect(() => normalizeFeatureValue({ ...monetaryValue,
      unit: { ...monetary.unit, currency: 'EUR' } }, monetary))
      .toThrow('Forecast feature details are invalid.');
  });

  test('keeps known zero distinct from missing and rejects invented or imprecise numbers', () => {
    const declared = normalizeFeatureDefinition(definition());
    expect(normalizeFeatureValue(value({ amount: '0' }), declared))
      .toMatchObject({ state: 'known', amount: '0' });
    // An authorized empty snapshot can establish zero without a latest row.
    expect(normalizeFeatureValue(value({ amount: '0', latestSourceRecordedAt: null }), declared))
      .toMatchObject({ state: 'known', amount: '0', latestSourceRecordedAt: null });
    for (const amount of [null, 0, '-1', '1.5', '1e3', '-0', '01']) {
      expect(() => normalizeFeatureValue(value({ amount }), declared))
        .toThrow('Forecast feature details are invalid.');
    }
    expect(normalizeFeatureValue(value({ state: 'missing', amount: null,
      reason: 'source_absent', latestSourceRecordedAt: null }), declared))
      .toMatchObject({ state: 'missing', amount: null, reason: 'source_absent' });
  });

  test('stale, conflicting and inapplicable states cannot carry a usable amount', () => {
    const declared = definition();
    for (const state of ['stale', 'conflicting']) {
      const unusable = value({ state, amount: null, reason: 'review_required' });
      expect(normalizeFeatureValue(unusable, declared).state).toBe(state);
      expect(() => normalizeFeatureValue({ ...unusable, amount: '4' }, declared))
        .toThrow('Forecast feature details are invalid.');
      expect(() => normalizeFeatureValue({ ...unusable, sourceSnapshotDigest: null }, declared))
        .toThrow('Forecast feature details are invalid.');
    }
    expect(normalizeFeatureValue(value({ state: 'inapplicable', amount: null,
      reason: 'service_not_supported', sourceSnapshotDigest: null,
      latestSourceRecordedAt: null }), declared).state).toBe('inapplicable');
  });

  test('refuses currency, definition, source time and unexplained field changes', () => {
    const declared = definition();
    for (const change of [
      { unit: { key: 'money', currency: 'USD', scale: 2 } },
      { definitionVersion: 'v2' },
      { definitionDigest: 'b'.repeat(64) },
      { latestSourceRecordedAt: '2026-09-21T12:00:00.000001Z' },
      { sourceSnapshotDigest: null },
      { extra: 'payload' },
    ]) expect(() => normalizeFeatureValue(value(change), declared))
      .toThrow('Forecast feature details are invalid.');
  });

  test('requires a structurally valid, tenant-matched historical window for window features', () => {
    const declared = definition({ temporalBasis: 'observed_window' });
    const window = reportingWindow();
    const windowValue = value({ reportingWindow: window,
      definitionDigest: sha256(normalizeFeatureDefinition(declared)) });
    const accepted = normalizeFeatureValue(windowValue, declared);
    expect(accepted.reportingWindow.localStartDate).toBe('2026-09-20');
    expect(Object.isFrozen(accepted.reportingWindow)).toBe(true);
    for (const reportingWindow of [null, { ...window, elapsedMinutes: 1 },
      { ...window, organizationId: profile }, { ...window, extra: 'private' }]) {
      expect(() => normalizeFeatureValue({ ...windowValue, reportingWindow }, declared))
        .toThrow('Forecast feature details are invalid.');
    }
    expect(() => normalizeFeatureValue({ ...windowValue,
      asOf: '2026-09-20T12:00:00.000Z' }, declared))
      .toThrow('Forecast feature details are invalid.');
    expect(() => normalizeFeatureValue(windowValue, definition()))
      .toThrow('Forecast feature details are invalid.');
  });
});
