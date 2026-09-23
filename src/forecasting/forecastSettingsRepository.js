'use strict';

const { stableStringify, sha256 } = require('../services/businessProfileAdapter');
const { VERSION, defaultForecastSettings, normalizeForecastSettings } =
  require('./forecastSettingsContract');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;

function failure(code, status, message) {
  const error = new Error(message); error.code = code; error.status = status;
  return error;
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) &&
      Object.getOwnPropertyDescriptor(value, key).enumerable &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function identity(actor) {
  if (!exact(actor, ['organizationId', 'actorUserId', 'actorAccessRole',
    'authSessionId', 'csrfToken', 'idempotencyKey']) ||
      !UUID.test(actor.organizationId) || !UUID.test(actor.actorUserId) ||
      !UUID.test(actor.authSessionId) ||
      !['owner', 'admin'].includes(actor.actorAccessRole)) {
    throw failure('FORECAST_ACCESS_RESTRICTED', 403,
      'Forecast settings access is restricted.');
  }
}
function verified(value, organizationId) {
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

async function readCurrent(pool, actor) {
  identity({ ...actor, csrfToken: null, idempotencyKey: null });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const response = await client.query(
      'SELECT public.canonical_forecast_settings_read($1,$2,$3,$4) value',
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId]);
    const value = response.rows[0]?.value;
    const settings = value === null ?
      defaultForecastSettings(actor.organizationId) : verified(value, actor.organizationId);
    await client.query('COMMIT');
    return settings;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

async function capture(pool, actor, input) {
  identity(actor);
  if (!KEY.test(actor.idempotencyKey || '') ||
      !exact(input, ['expectedRevision', 'expectedDigest', 'settings']) ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0 || input.expectedRevision >= 1000000000 ||
      (input.expectedRevision === 0 ? input.expectedDigest !== null :
        typeof input.expectedDigest !== 'string' || !DIGEST.test(input.expectedDigest))) {
    throw failure('FORECAST_REQUEST_INVALID', 400,
      'The forecast settings request is invalid.');
  }
  if (input.settings?.enabled !== false) throw failure('FORECAST_TARGET_NOT_READY', 409,
    'This forecast target is not ready for owner settings yet.');
  let normalized;
  try {
    normalized = normalizeForecastSettings({ version: VERSION,
      organizationId: actor.organizationId,
      revision: input.expectedRevision + 1,
      effectiveAt: new Date().toISOString(),
      source: { kind: 'owner_reviewed', actorUserId: actor.actorUserId,
        supersedesDigest: input.expectedDigest },
      settings: input.settings });
  } catch {
    throw failure('FORECAST_REQUEST_INVALID', 400,
      'The forecast settings request is invalid.');
  }
  const { digest, ...body } = normalized;
  const canonicalJson = stableStringify(body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const response = await client.query(
      'SELECT public.canonical_forecast_settings_capture($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, actor.idempotencyKey,
        sha256(input), input.expectedRevision, input.expectedDigest,
        canonicalJson, normalized]);
    const saved = response.rows[0]?.value;
    if (!saved || typeof saved.replayed !== 'boolean') throw new Error('Invalid settings receipt');
    const settings = verified(saved.settings, actor.organizationId);
    await client.query('COMMIT');
    return { settings, replayed: saved.replayed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

module.exports = { readCurrent, capture };
