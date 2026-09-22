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
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) return null;
  const captured = {};
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    captured[key] = descriptor.value;
  }
  return captured;
}
function captureDense(values, max) {
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(values, 'length');
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      lengthDescriptor.value > max) return null;
  const length = lengthDescriptor.value;
  const own = Reflect.ownKeys(values);
  if (own.length !== length + 1 || own.some(key => key !== 'length' &&
      (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) return null;
  const captured = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    captured.push(descriptor.value);
  }
  return captured;
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
  const root = record(input, ['version', 'organizationId', 'revision', 'effectiveAt',
    'source', 'settings']);
  const source = root && record(root.source, ['kind', 'actorUserId', 'supersedesDigest']);
  const settings = root && record(root.settings, ['enabled', 'targets', 'horizons',
    'scenarioDisplay', 'comparisonDisplay', 'alertDelivery', 'actionPolicy']);
  const targets = settings && captureDense(settings.targets, 24);
  const rawHorizons = settings && captureDense(settings.horizons, 12);
  if (!root || root.version !== VERSION ||
    typeof root.organizationId !== 'string' || !UUID.test(root.organizationId) ||
    !Number.isInteger(root.revision) || root.revision < 1 || root.revision > 1000000000 ||
    !instant(root.effectiveAt) || !source || source.kind !== 'owner_reviewed' ||
    typeof source.actorUserId !== 'string' || !UUID.test(source.actorUserId) ||
    !(source.supersedesDigest === null ||
      (typeof source.supersedesDigest === 'string' && DIGEST.test(source.supersedesDigest))) ||
    (root.revision === 1 ? source.supersedesDigest !== null : source.supersedesDigest === null) ||
    !settings || typeof settings.enabled !== 'boolean' || !targets ||
    !targets.every(value => typeof value === 'string' && value.length <= 80 && TOKEN.test(value)) ||
    new Set(targets).size !== targets.length || !rawHorizons ||
    !['withhold', 'deterministic_when_eligible', 'calibrated_when_eligible']
      .includes(settings.scenarioDisplay) ||
    !['none', 'prior', 'actual', 'prior_and_actual'].includes(settings.comparisonDisplay) ||
    !['off', 'in_app_review_only'].includes(settings.alertDelivery) ||
    settings.actionPolicy !== 'review_required') invalid();
  const horizons = rawHorizons.map(horizon => record(horizon, ['grain', 'periods']));
  const horizonKeys = new Set();
  for (const horizon of horizons) {
    if (!horizon || !GRAINS.has(horizon.grain) ||
      !Number.isInteger(horizon.periods) || horizon.periods < 1 || horizon.periods > 100 ||
      horizonKeys.has(horizon.grain)) invalid();
    horizonKeys.add(horizon.grain);
  }
  if (settings.enabled && (targets.length === 0 || horizons.length === 0)) invalid();
  if (!settings.enabled && (targets.length > 0 || horizons.length > 0 ||
      settings.scenarioDisplay !== 'withhold' || settings.comparisonDisplay !== 'none' ||
      settings.alertDelivery !== 'off')) invalid();
  const normalized = { version: VERSION, organizationId: root.organizationId.toLowerCase(),
    revision: root.revision, effectiveAt: root.effectiveAt,
    source: { kind: source.kind, actorUserId: source.actorUserId.toLowerCase(),
      supersedesDigest: source.supersedesDigest },
    settings: { enabled: settings.enabled, targets: [...targets].sort(),
      horizons: horizons.map(item => ({ ...item }))
        .sort((left, right) => left.grain.localeCompare(right.grain)),
      scenarioDisplay: settings.scenarioDisplay,
      comparisonDisplay: settings.comparisonDisplay,
      alertDelivery: settings.alertDelivery,
      actionPolicy: settings.actionPolicy } };
  return freeze({ ...normalized, digest: sha256(normalized) });
}

module.exports = { VERSION, defaultForecastSettings, normalizeForecastSettings };
