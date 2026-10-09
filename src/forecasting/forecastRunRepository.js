'use strict';

const { stableStringify, sha256 } = require('../services/businessProfileAdapter');
const { VERSION, normalizeForecastRunReceipt } = require('./forecastRunReceipt');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;
const ROLES = new Set(['owner', 'admin']);

function failure(code, status, message) {
  const error = new Error(message); error.code = code; error.status = status;
  return error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && keys.includes(key) && descriptor?.enumerable &&
      Object.hasOwn(descriptor, 'value');
  });
}
function dense(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
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
      !ROLES.has(actor.actorAccessRole) ||
      (mutation && (!KEY.test(actor.idempotencyKey || '') ||
        typeof actor.csrfToken !== 'string'))) {
    throw failure('FORECAST_RUN_ACCESS_RESTRICTED', 403,
      'Forecast run access is restricted.');
  }
}
function canonicalParts(receipt) {
  const normalized = normalizeForecastRunReceipt(receipt);
  const { digest: _digest, inputDigest: _inputDigest, resultDigest: _resultDigest,
    ...withoutDigests } = normalized;
  const inputIdentity = {
    organizationId: normalized.organizationId, asOf: normalized.asOf,
    settings: normalized.settings,
    sourceSnapshotDigest: normalized.sourceSnapshotDigest,
    reportingWindowDigest: normalized.reportingWindowDigest,
    featureSetDigest: normalized.featureSetDigest, algorithm: normalized.algorithm,
    calculationVersion: normalized.calculationVersion,
    outputContractVersion: normalized.outputContractVersion,
    targets: normalized.outputs.map(({ targetKey, targetVersion }) =>
      ({ targetKey, targetVersion })),
  };
  const resultIdentity = { outputs: normalized.outputs.map(value => ({ ...value })) };
  return { normalized, inputCanonical: stableStringify(inputIdentity),
    resultCanonical: stableStringify(resultIdentity),
    receiptCanonical: stableStringify({ ...withoutDigests,
      inputDigest: normalized.inputDigest, resultDigest: normalized.resultDigest }) };
}
function verifiedReceipt(value) {
  if (!exact(value, ['version','id','organizationId','asOf','createdAt','settings',
    'sourceSnapshotDigest','reportingWindowDigest','featureSetDigest','algorithm',
    'calculationVersion','outputContractVersion','outputs','supersedes',
    'supersessionReason','inputDigest','resultDigest','digest'])) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast run evidence is temporarily unavailable.');
  }
  const { inputDigest, resultDigest, digest, ...raw } = value;
  let normalized;
  try { normalized = normalizeForecastRunReceipt(raw); } catch {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast run evidence is temporarily unavailable.');
  }
  if (normalized.inputDigest !== inputDigest || normalized.resultDigest !== resultDigest ||
      normalized.digest !== digest) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast run evidence is temporarily unavailable.');
  }
  return normalized;
}
function verifiedValue(value, outputDigest) {
  if (!exact(value, ['targetKey','targetVersion','unit','value','outputDigest']) ||
      value.targetKey !== 'demand.inbound_leads' || value.targetVersion !== 'v1' ||
      value.outputDigest !== outputDigest || !DIGEST.test(value.outputDigest || '') ||
      !exact(value.unit, ['key','currency']) || value.unit.key !== 'count' ||
      value.unit.currency !== null || !exact(value.value, ['kind','amount']) ||
      value.value.kind !== 'point' || typeof value.value.amount !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/.test(value.value.amount)) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast run evidence is temporarily unavailable.');
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function verifiedCurrent(value, organizationId) {
  if (!exact(value, ['state','receipt','values','currentness','historyPosition']) || value.state !== 'current' ||
      !dense(value.values, 24) || !exact(value.currentness,
        ['sourceCurrent','algorithmCurrent','settingsRecorded','refreshRequired']) ||
      !exact(value.historyPosition, ['latest','superseded']) ||
      typeof value.historyPosition.latest !== 'boolean' ||
      typeof value.historyPosition.superseded !== 'boolean' ||
      value.currentness.sourceCurrent !== true || value.currentness.algorithmCurrent !== true ||
      value.currentness.settingsRecorded !== true || value.currentness.refreshRequired !== false) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast run evidence is temporarily unavailable.');
  }
  const receipt = verifiedReceipt(value.receipt);
  if (receipt.organizationId !== organizationId || value.values.length !== receipt.outputs.length) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast run evidence is temporarily unavailable.');
  }
  const values = value.values.map((item, index) =>
    verifiedValue(item, receipt.outputs[index].outputDigest));
  return freeze({ state: 'current', receipt, values,
    currentness: freeze({ ...value.currentness }),
    historyPosition: freeze({ ...value.historyPosition }) });
}
function verifiedEnvelope(value, organizationId) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state','reason','runs']) || ![
      'settings_not_enabled','source_or_algorithm_not_current','retained_inputs_unavailable',
      'settings_not_current','run_not_found',
    ].includes(value.reason) || value.runs !== null) {
      throw failure('FORECAST_RUN_UNAVAILABLE', 503,
        'Forecast run evidence is temporarily unavailable.');
    }
    return freeze({ state: 'unavailable', reason: value.reason, runs: null });
  }
  if (!exact(value, ['state','runs']) || value.state !== 'current' ||
      !dense(value.runs, 20)) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast run evidence is temporarily unavailable.');
  }
  return freeze({ state: 'current', runs: value.runs.map(item =>
    verifiedCurrent(item, organizationId)) });
}
function verifiedComparison(value) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state','reason','comparison']) || ![
      'source_or_algorithm_not_current','run_not_found','retained_inputs_unavailable',
      'settings_not_current',
    ].includes(value.reason) || value.comparison !== null) {
      throw failure('FORECAST_RUN_UNAVAILABLE', 503,
        'Forecast comparison is temporarily unavailable.');
    }
    return freeze({ state: 'unavailable', reason: value.reason, comparison: null });
  }
  if (!exact(value, ['state','leftRunId','rightRunId','leftRunDigest','rightRunDigest',
    'sameInputs','sameResults','digest']) ||
      !['reproduced','result_mismatch','input_changed'].includes(value.state) ||
      !UUID.test(value.leftRunId || '') || !UUID.test(value.rightRunId || '') ||
      value.leftRunId === value.rightRunId ||
      ![value.leftRunDigest,value.rightRunDigest,value.digest].every(item => DIGEST.test(item || '')) ||
      typeof value.sameInputs !== 'boolean' || typeof value.sameResults !== 'boolean' ||
      (value.state === 'reproduced' && (!value.sameInputs || !value.sameResults)) ||
      (value.state === 'result_mismatch' && (!value.sameInputs || value.sameResults)) ||
      (value.state === 'input_changed' && value.sameInputs)) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Forecast comparison is temporarily unavailable.');
  }
  return freeze({ ...value });
}
function verifiedRerun(value) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state','reason','runId','comparison']) || ![
      'source_or_algorithm_not_current','retained_inputs_unavailable','run_not_found',
      'settings_not_current','exact_executable_version_unavailable',
    ].includes(value.reason) || value.runId !== null || value.comparison !== null) {
      throw failure('FORECAST_RUN_UNAVAILABLE', 503,
        'Controlled rerun is temporarily unavailable.');
    }
    return freeze({ ...value });
  }
  if (!exact(value, ['state','runId','runDigest','storedResultDigest','freshResultDigest',
    'sameResults','automaticActionAuthorized']) ||
      !['reproduced','result_mismatch'].includes(value.state) ||
      !UUID.test(value.runId || '') ||
      ![value.runDigest,value.storedResultDigest,value.freshResultDigest]
        .every(item => DIGEST.test(item || '')) ||
      value.sameResults !== (value.state === 'reproduced') ||
      value.automaticActionAuthorized !== false) {
    throw failure('FORECAST_RUN_UNAVAILABLE', 503,
      'Controlled rerun is temporarily unavailable.');
  }
  return freeze({ ...value });
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const value = await work(client);
    await client.query('COMMIT'); return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}
function captureInput(input) {
  if (!exact(input, ['expectedSettingsRevision','expectedSettingsDigest',
    'localHorizonStart','supersedes']) ||
      !Number.isInteger(input.expectedSettingsRevision) || input.expectedSettingsRevision < 1 ||
      !DIGEST.test(input.expectedSettingsDigest || '') ||
      !MONTH.test(input.localHorizonStart || '') ||
      !(input.supersedes === null || (exact(input.supersedes,
        ['runId','runDigest','reason']) && UUID.test(input.supersedes.runId || '') &&
        DIGEST.test(input.supersedes.runDigest || '') &&
        typeof input.supersedes.reason === 'string' &&
        /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(input.supersedes.reason) &&
        input.supersedes.reason.length <= 80))) {
    throw failure('FORECAST_RUN_REQUEST_INVALID', 400,
      'Check the forecast run request and try again.');
  }
  return input;
}
async function capture(pool, actor, rawInput) {
  identity(actor, true); const input = captureInput(rawInput);
  return transaction(pool, async client => {
    const requestDigest = sha256(input);
    const prepared = (await client.query(
      `SELECT public.canonical_forecast_run_v1_prepare(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, actor.idempotencyKey, requestDigest,
        input.expectedSettingsRevision, input.expectedSettingsDigest,
        input.localHorizonStart, input.supersedes?.runId || null,
        input.supersedes?.runDigest || null])).rows[0]?.value;
    if (prepared?.state === 'unavailable') return verifiedEnvelope({ ...prepared,
      runs: null }, actor.organizationId);
    if (prepared?.state === 'replay') {
      const replay = (await client.query(
        'SELECT public.canonical_forecast_run_v1_read($1,$2,$3,$4,$5) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, prepared.runId])).rows[0]?.value;
      if (replay?.state === 'unavailable') {
        return verifiedEnvelope({ ...replay, runs: null }, actor.organizationId);
      }
      const current = verifiedCurrent(replay, actor.organizationId);
      return freeze({ ...current, replayed: true });
    }
    if (!exact(prepared, ['state','id','organizationId','asOf','createdAt','settings',
      'sourceSnapshotDigest','reportingWindow','featureSetDigest','algorithm',
      'calculationVersion','outputContractVersion','output','supersedes']) ||
        prepared.state !== 'prepared' || !UUID.test(prepared.id || '') ||
        prepared.organizationId !== actor.organizationId ||
        !exact(prepared.settings, ['revision','digest']) ||
        prepared.settings.revision !== input.expectedSettingsRevision ||
        prepared.settings.digest !== input.expectedSettingsDigest ||
        !exact(prepared.algorithm,
          ['key','version','definitionDigest','implementationDigest','buildIdentity']) ||
        !exact(prepared.algorithm.buildIdentity, ['kind','procedure']) ||
        prepared.algorithm.buildIdentity.kind !== 'postgresql_function_definition_sha256' ||
        typeof prepared.algorithm.buildIdentity.procedure !== 'string' ||
        !exact(prepared.output, ['targetKey','targetVersion','payload','outputDigest']) ||
        !DIGEST.test(prepared.output.outputDigest || '')) {
      throw failure('FORECAST_RUN_UNAVAILABLE', 503,
        'Forecast run evidence is temporarily unavailable.');
    }
    const algorithm = { key: prepared.algorithm.key, version: prepared.algorithm.version,
      definitionDigest: prepared.algorithm.definitionDigest,
      implementationDigest: prepared.algorithm.implementationDigest,
      buildDigest: sha256({ ...prepared.algorithm.buildIdentity,
        implementationDigest: prepared.algorithm.implementationDigest }) };
    const receiptInput = { version: VERSION, id: prepared.id,
      organizationId: prepared.organizationId, asOf: prepared.asOf,
      createdAt: prepared.createdAt, settings: prepared.settings,
      sourceSnapshotDigest: prepared.sourceSnapshotDigest,
      reportingWindowDigest: sha256(prepared.reportingWindow),
      featureSetDigest: prepared.featureSetDigest, algorithm,
      calculationVersion: prepared.calculationVersion,
      outputContractVersion: prepared.outputContractVersion,
      outputs: [{ targetKey: prepared.output.targetKey,
        targetVersion: prepared.output.targetVersion,
        outputDigest: prepared.output.outputDigest }],
      supersedes: prepared.supersedes, supersessionReason:
        prepared.supersedes ? input.supersedes.reason : null };
    let canonical;
    try { canonical = canonicalParts(receiptInput); } catch {
      throw failure('FORECAST_RUN_UNAVAILABLE', 503,
        'Forecast run evidence is temporarily unavailable.');
    }
    const stored = (await client.query(
      `SELECT public.canonical_forecast_run_v1_commit(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.idempotencyKey, requestDigest,
        input.expectedSettingsRevision, input.expectedSettingsDigest,
        input.localHorizonStart, prepared.id, canonical.normalized,
        prepared.output.payload, canonical.inputCanonical, canonical.resultCanonical,
        canonical.receiptCanonical, input.supersedes?.reason || null])).rows[0]?.value;
    return freeze({ ...verifiedCurrent(stored, actor.organizationId), replayed: false });
  });
}
async function list(pool, actor) {
  identity(actor, false);
  return transaction(pool, async client => verifiedEnvelope((await client.query(
    'SELECT public.canonical_forecast_run_v1_list($1,$2,$3,$4) value',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId])).rows[0]?.value, actor.organizationId));
}
async function compare(pool, actor, leftRunId, rightRunId) {
  identity(actor, false);
  if (!UUID.test(leftRunId || '') || !UUID.test(rightRunId || '') ||
      leftRunId.toLowerCase() === rightRunId.toLowerCase()) {
    throw failure('FORECAST_RUN_REQUEST_INVALID', 400,
      'Choose two different forecast runs.');
  }
  return transaction(pool, async client => verifiedComparison((await client.query(
    'SELECT public.canonical_forecast_run_v1_compare($1,$2,$3,$4,$5,$6) value',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, leftRunId, rightRunId])).rows[0]?.value));
}
async function controlledRerun(pool, actor, runId) {
  identity(actor, true);
  if (!UUID.test(runId || '')) throw failure('FORECAST_RUN_REQUEST_INVALID', 400,
    'Choose a valid forecast run.');
  return transaction(pool, async client => verifiedRerun((await client.query(
    'SELECT public.canonical_forecast_run_v1_controlled_rerun($1,$2,$3,$4,$5,$6) value',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, actor.csrfToken, runId])).rows[0]?.value));
}

module.exports = { capture, list, compare, controlledRerun };
