'use strict';

const { VERSION, defaultForecastSettings, normalizeForecastSettings: normalize } =
  require('../../src/forecasting/forecastSettingsContract');

const org = '55555555-5555-4555-8555-555555555555';
const owner = '66666666-6666-4666-8666-666666666666';
function candidate(revision = 1) {
  return { version: VERSION, organizationId: org, revision,
    effectiveAt: '2026-09-22T17:00:00.000Z', source: { kind: 'owner_reviewed',
      actorUserId: owner, supersedesDigest: revision === 1 ? null : 'a'.repeat(64) },
    settings: { enabled: true,
      targets: ['demand.inbound_leads', 'revenue.approved_price_flow'],
      horizons: [{ grain: 'month', periods: 3 }, { grain: 'week', periods: 4 }],
      scenarioDisplay: 'deterministic_when_eligible',
      comparisonDisplay: 'prior_and_actual', alertDelivery: 'in_app_review_only',
      actionPolicy: 'review_required' } };
}

test('system default issues no forecast, target, alert or automatic action', () => {
  const result = defaultForecastSettings(org.toUpperCase());
  expect(result).toMatchObject({ organizationId: org, revision: 0,
    source: { kind: 'system_default', actorUserId: null },
    settings: { enabled: false, targets: [], horizons: [],
      scenarioDisplay: 'withhold', comparisonDisplay: 'none',
      alertDelivery: 'off', actionPolicy: 'review_required' } });
  expect(Object.isFrozen(result.settings)).toBe(true);
});

test('normalizes explicit owner-reviewed settings deterministically', () => {
  const first = normalize(candidate());
  const reordered = candidate();
  reordered.settings.targets.reverse();
  reordered.settings.horizons.reverse();
  const second = normalize(reordered);
  expect(second.digest).toBe(first.digest);
  expect(first.settings.targets).toEqual([
    'demand.inbound_leads', 'revenue.approved_price_flow']);
  expect(first.settings.horizons.map(item => item.grain)).toEqual(['month', 'week']);
  expect(Object.isFrozen(first.settings.horizons[0])).toBe(true);
});

test('later revision must pin a superseded settings digest', () => {
  const later = candidate(2);
  expect(normalize(later).source.supersedesDigest).toBe('a'.repeat(64));
  later.source.supersedesDigest = null;
  expect(() => normalize(later)).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_SETTINGS_INVALID' }));
  const first = candidate(1);
  first.source.supersedesDigest = 'a'.repeat(64);
  expect(() => normalize(first)).toThrow();
});

test('disabled settings cannot retain hidden targets, horizons or alerts', () => {
  const value = candidate();
  value.settings.enabled = false;
  expect(() => normalize(value)).toThrow();
  value.settings.targets = [];
  value.settings.horizons = [];
  value.settings.scenarioDisplay = 'withhold';
  value.settings.comparisonDisplay = 'none';
  value.settings.alertDelivery = 'off';
  expect(normalize(value).settings.enabled).toBe(false);
});

test('rejects duplicate or unbounded horizons, automatic action and hidden keys', () => {
  const duplicate = candidate();
  duplicate.settings.horizons.push({ grain: 'week', periods: 8 });
  expect(() => normalize(duplicate)).toThrow();
  const unbounded = candidate();
  unbounded.settings.horizons[0].periods = 101;
  expect(() => normalize(unbounded)).toThrow();
  const automatic = candidate();
  automatic.settings.actionPolicy = 'automatic';
  expect(() => normalize(automatic)).toThrow();
  const hidden = candidate();
  Object.defineProperty(hidden.settings, 'silentApproval', { value: true });
  expect(() => normalize(hidden)).toThrow();
});

test('rejects forged array prototypes that could bypass target or horizon checks', () => {
  const targetBypass = candidate();
  targetBypass.settings.targets = [{ not: 'a target' }];
  Object.setPrototypeOf(targetBypass.settings.targets,
    Object.assign(Object.create(Array.prototype), { every() { return true; } }));
  expect(() => normalize(targetBypass)).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_SETTINGS_INVALID' }));

  const horizonBypass = candidate();
  Object.setPrototypeOf(horizonBypass.settings.horizons,
    Object.assign(Object.create(Array.prototype), {
      map() { return [{ grain: 'year', periods: 999 }]; },
      [Symbol.iterator]: function* () { yield { grain: 'month', periods: 3 }; },
    }));
  expect(() => normalize(horizonBypass)).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_SETTINGS_INVALID' }));
});

test('owner preference cannot label an interval calibrated or authenticate a source', () => {
  const value = candidate();
  value.settings.scenarioDisplay = 'calibrated_when_eligible';
  const result = normalize(value);
  expect(result.settings.scenarioDisplay).toBe('calibrated_when_eligible');
  expect(result).not.toHaveProperty('sourceAuthenticated');
  expect(result).not.toHaveProperty('forecastIssued');
});
