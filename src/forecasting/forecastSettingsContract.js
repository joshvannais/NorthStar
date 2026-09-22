'use strict';

const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-forecast-settings-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GRAINS = new Set(['week', 'month', 'quarter']);

function invalid() {
  const error = new Error('Forecast settings details are invalid.');
  error.code = 'M26_FORECAST_SETTINGS_INVALID';
  throw error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function dense(values, max) {
  if (!Array.isArray(values) || values.length > max ||
      Reflect.ownKeys(values).length !== values.length + 1) return false;
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function defaultForecastSettings(organizationId) {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) invalid();
  const settings = { enabled: false, targets: [], horizons: [],
    scenarioDisplay: 'withhold', comparisonDisplay: 'none',
    alertDelivery: 'off', actionPolicy: 'review_required' };
  return freeze({ version: VERSION, organizationId: organizationId.toLowerCase(),
    revision: 0, effectiveAt: null, source: { kind: 'system_default',
      actorUserId: null, supersedesDigest: null }, settings,
    digest: sha256({ version: VERSION, organizationId: organizationId.toLowerCase(),
      revision: 0, effectiveAt: null, source: { kind: 'system_default',
        actorUserId: null, supersedesDigest: null }, settings }) });
}
function normalizeForecastSettings(input) {
  if (!exact(input, ['version', 'organizationId', 'revision', 'effectiveAt',
    'source', 'settings']) || input.version !== VERSION ||
    typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
    !Number.isInteger(input.revision) || input.revision < 1 || input.revision > 1000000000 ||
    !instant(input.effectiveAt) ||
    !exact(input.source, ['kind', 'actorUserId', 'supersedesDigest']) ||
    input.source.kind !== 'owner_reviewed' ||
    typeof input.source.actorUserId !== 'string' || !UUID.test(input.source.actorUserId) ||
    !(input.source.supersedesDigest === null ||
      (typeof input.source.supersedesDigest === 'string' && DIGEST.test(input.source.supersedesDigest))) ||
    (input.revision === 1 ? input.source.supersedesDigest !== null :
      input.source.supersedesDigest === null)) invalid();
  const settings = input.settings;
  if (!exact(settings, ['enabled', 'targets', 'horizons', 'scenarioDisplay',
    'comparisonDisplay', 'alertDelivery', 'actionPolicy']) ||
    typeof settings.enabled !== 'boolean' || !dense(settings.targets, 24) ||
    !settings.targets.every(value => typeof value === 'string' && value.length <= 80 &&
      TOKEN.test(value)) || new Set(settings.targets).size !== settings.targets.length ||
    !dense(settings.horizons, 12) ||
    !['withhold', 'deterministic_when_eligible', 'calibrated_when_eligible']
      .includes(settings.scenarioDisplay) ||
    !['none', 'prior', 'actual', 'prior_and_actual'].includes(settings.comparisonDisplay) ||
    !['off', 'in_app_review_only'].includes(settings.alertDelivery) ||
    settings.actionPolicy !== 'review_required') invalid();
  const horizonKeys = new Set();
  for (const horizon of settings.horizons) {
    if (!exact(horizon, ['grain', 'periods']) || !GRAINS.has(horizon.grain) ||
      !Number.isInteger(horizon.periods) || horizon.periods < 1 || horizon.periods > 100 ||
      horizonKeys.has(horizon.grain)) invalid();
    horizonKeys.add(horizon.grain);
  }
  if (settings.enabled && (settings.targets.length === 0 || settings.horizons.length === 0)) invalid();
  if (!settings.enabled && (settings.targets.length > 0 || settings.horizons.length > 0 ||
      settings.scenarioDisplay !== 'withhold' || settings.comparisonDisplay !== 'none' ||
      settings.alertDelivery !== 'off')) invalid();
  const normalized = { version: VERSION, organizationId: input.organizationId.toLowerCase(),
    revision: input.revision, effectiveAt: input.effectiveAt,
    source: { kind: input.source.kind,
      actorUserId: input.source.actorUserId.toLowerCase(),
      supersedesDigest: input.source.supersedesDigest },
    settings: { enabled: settings.enabled, targets: [...settings.targets].sort(),
      horizons: settings.horizons.map(item => ({ ...item }))
        .sort((left, right) => left.grain.localeCompare(right.grain)),
      scenarioDisplay: settings.scenarioDisplay,
      comparisonDisplay: settings.comparisonDisplay,
      alertDelivery: settings.alertDelivery,
      actionPolicy: settings.actionPolicy } };
  return freeze({ ...normalized, digest: sha256(normalized) });
}

module.exports = { VERSION, defaultForecastSettings, normalizeForecastSettings };
