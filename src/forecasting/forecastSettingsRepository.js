'use strict';

const { stableStringify, sha256 } = require('../services/businessProfileAdapter');
const { VERSION, defaultForecastSettings, normalizeForecastSettings } =
  require('./forecastSettingsContract');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const ROLES = new Set(['owner', 'admin']);
const PROOF_KEYS = ['sourceAuthority','targetRegistration','algorithmPromotion',
  'intervalCalibration','actualFinality','issuanceEligibility'];

function failure(code, status, message) {
  const error = new Error(message); error.code = code; error.status = status;
  return error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function identity(actor, mutation) {
  const keys = mutation ? ['organizationId','actorUserId','actorAccessRole','authSessionId',
    'csrfToken','idempotencyKey'] :
    ['organizationId','actorUserId','actorAccessRole','authSessionId'];
  if (!exact(actor, keys) || !UUID.test(actor.organizationId || '') ||
      !UUID.test(actor.actorUserId || '') || !UUID.test(actor.authSessionId || '') ||
      !ROLES.has(actor.actorAccessRole)) {
    throw failure('FORECAST_SETTINGS_ACCESS_RESTRICTED', 403,
      'Forecast settings access is restricted.');
  }
}
function verifiedSettings(value, organizationId) {
  if (!value || value.organizationId !== organizationId ||
      typeof value.digest !== 'string' || !DIGEST.test(value.digest)) {
    throw failure('FORECAST_SETTINGS_UNAVAILABLE', 503,
      'Forecast settings are temporarily unavailable.');
  }
  const { digest, ...body } = value;
  let normalized;
  try { normalized = normalizeForecastSettings(body); } catch {
    throw failure('FORECAST_SETTINGS_UNAVAILABLE', 503,
      'Forecast settings are temporarily unavailable.');
  }
  if (normalized.digest !== digest) throw failure('FORECAST_SETTINGS_UNAVAILABLE', 503,
    'Forecast settings are temporarily unavailable.');
  return normalized;
}
function verifiedAuthority(value) {
  if (!exact(value, ['version','targets','limits','preferenceProves',
    'automaticActionAuthorized']) ||
      value.version !== 'm26-forecast-settings-authority-v1' ||
      !Array.isArray(value.targets) || value.targets.length > 1 ||
      !exact(value.limits, ['targets','horizons','periodsPerHorizon']) ||
      value.limits.targets !== 24 || value.limits.horizons !== 12 ||
      value.limits.periodsPerHorizon !== 100 ||
      !exact(value.preferenceProves, PROOF_KEYS) ||
      PROOF_KEYS.some(key => value.preferenceProves[key] !== false) ||
      value.automaticActionAuthorized !== false) {
    throw failure('FORECAST_SETTINGS_UNAVAILABLE', 503,
      'Forecast settings authority is temporarily unavailable.');
  }
  if (value.targets.length === 1) {
    const target = value.targets[0];
    if (!exact(target, ['key','label','definitionVersion','unit','sourceScope','algorithmKey',
      'algorithmVersion','algorithmDefinitionDigest','implementationDigest','supportedGrains']) ||
        target.key !== 'demand.inbound_leads' || target.label !== 'Inbound leads' ||
        target.definitionVersion !== 'v1' || target.unit !== 'count' ||
        target.sourceScope !== 'retell_only_tenant_all' ||
        target.algorithmKey !== 'retell_three_complete_month_mean' ||
        target.algorithmVersion !== 'm26-retell-three-month-mean-v2' ||
        !DIGEST.test(target.algorithmDefinitionDigest || '') ||
        !DIGEST.test(target.implementationDigest || '') ||
        !Array.isArray(target.supportedGrains) || target.supportedGrains.length !== 1 ||
        target.supportedGrains[0] !== 'month') {
      throw failure('FORECAST_SETTINGS_UNAVAILABLE', 503,
        'Forecast settings authority is temporarily unavailable.');
    }
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function verifiedEnvelope(value, organizationId, allowReplay) {
  const keys = value?.state === 'unavailable' ?
    ['state','reason','settings','authority', ...(allowReplay ? ['replayed'] : [])] :
    ['state','settings','authority', ...(allowReplay ? ['replayed'] : [])];
  if (!exact(value, keys) || !['current','unavailable'].includes(value.state) ||
      (allowReplay && typeof value.replayed !== 'boolean')) {
    throw failure('FORECAST_SETTINGS_UNAVAILABLE', 503,
      'Forecast settings are temporarily unavailable.');
  }
  const authority = verifiedAuthority(value.authority);
  if (value.state === 'unavailable') {
    if (value.reason !== 'selected_target_algorithm_or_source_authority_changed' ||
        value.settings !== null) throw failure('FORECAST_SETTINGS_UNAVAILABLE', 503,
      'Forecast settings are temporarily unavailable.');
    return freeze({ state: 'unavailable', reason: value.reason, settings: null, authority,
      ...(allowReplay ? { replayed: value.replayed } : {}) });
  }
  const settings = value.settings === null ? defaultForecastSettings(organizationId) :
    verifiedSettings(value.settings, organizationId);
  return freeze({ state: 'current', settings, authority,
    ...(allowReplay ? { replayed: value.replayed } : {}) });
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const value = await work(client);
    await client.query('COMMIT'); return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

async function readCurrent(pool, actor) {
  identity(actor, false);
  return transaction(pool, async client => {
    const response = await client.query(
      'SELECT public.canonical_forecast_settings_v1_read($1,$2,$3,$4) value',
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
    return verifiedEnvelope(response.rows[0]?.value, actor.organizationId, false);
  });
}

async function capture(pool, actor, input) {
  identity(actor, true);
  if (!KEY.test(actor.idempotencyKey || '') ||
      !exact(input, ['expectedRevision','expectedDigest','settings']) ||
      !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      input.expectedRevision >= 1000000000 ||
      (input.expectedRevision === 0 ? input.expectedDigest !== null :
        typeof input.expectedDigest !== 'string' || !DIGEST.test(input.expectedDigest))) {
    throw failure('FORECAST_SETTINGS_REQUEST_INVALID', 400,
      'Check the forecast settings request and try again.');
  }
  let normalized;
  try {
    normalized = normalizeForecastSettings({ version: VERSION,
      organizationId: actor.organizationId, revision: input.expectedRevision + 1,
      effectiveAt: new Date().toISOString(), source: { kind: 'owner_reviewed',
        actorUserId: actor.actorUserId, supersedesDigest: input.expectedDigest },
      settings: input.settings });
  } catch {
    throw failure('FORECAST_SETTINGS_REQUEST_INVALID', 400,
      'Check the forecast settings request and try again.');
  }
  const { digest: _digest, ...body } = normalized;
  const canonicalJson = stableStringify(body);
  return transaction(pool, async client => {
    const response = await client.query(
      'SELECT public.canonical_forecast_settings_v1_capture($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, actor.idempotencyKey, sha256(input),
        input.expectedRevision, input.expectedDigest, canonicalJson, normalized]);
    return verifiedEnvelope(response.rows[0]?.value, actor.organizationId, true);
  });
}

module.exports = { readCurrent, capture };
