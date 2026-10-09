'use strict';

const repository = require('../../src/forecasting/forecastRunRepository');

const org = '55555555-5555-4555-8555-555555555555';
const actor = { organizationId: org,
  actorUserId: '66666666-6666-4666-8666-666666666666', actorAccessRole: 'owner',
  authSessionId: '77777777-7777-4777-8777-777777777777', csrfToken: 'csrf',
  idempotencyKey: 'part11b-request-key-0001' };
const input = { expectedSettingsRevision: 2, expectedSettingsDigest: 'a'.repeat(64),
  localHorizonStart: '2026-11-01', supersedes: null };
const output = { contractVersion: 'm26-forecast-output-v1',
  target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
  unit: { key: 'count', currency: null }, value: { kind: 'point', amount: '0' },
  confidence: { state: 'unavailable', backtestDigest: null },
  uncertainty: { state: 'unquantified', drivers: ['retell_only'] },
  applicability: { serviceKey: null, areaKey: null, limits: ['retell_only'] },
  calculationVersion: 'm26-retell-three-month-mean-v2', researchOnly: true,
  realForecastEligible: false, paidNumericServing: false, forecastServingEnabled: false };
const prepared = { state: 'prepared', id: '11111111-1111-4111-8111-111111111111',
  organizationId: org, asOf: '2026-10-09T12:00:00.000000Z',
  createdAt: '2026-10-09T12:00:00.001Z', settings: { revision: 2, digest: 'a'.repeat(64) },
  sourceSnapshotDigest: 'b'.repeat(64), reportingWindow: { grain: 'month',
    localStart: '2026-11-01', startsAt: '2026-11-01T04:00:00.000000Z',
    endsAt: '2026-12-01T05:00:00.000000Z' }, featureSetDigest: 'c'.repeat(64),
  algorithm: { key: 'retell_three_complete_month_mean',
    version: 'm26-retell-three-month-mean-v2', definitionDigest: 'd'.repeat(64),
    implementationDigest: 'e'.repeat(64), buildDigest: '9'.repeat(64), buildIdentity: {
      kind: 'postgresql_function_definition_sha256',
      procedure: 'canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)' } },
  calculationVersion: 'm26-retell-three-month-mean-v2',
  outputContractVersion: 'm26-forecast-output-v1', output: {
    targetKey: 'demand.inbound_leads', targetVersion: 'v1', payload: output,
    outputDigest: 'f'.repeat(64) }, supersedes: null };

function projection(receipt) {
  return { state: 'current', receipt,
    values: [{ targetKey: 'demand.inbound_leads', targetVersion: 'v1',
      unit: { key: 'count', currency: null }, value: { kind: 'point', amount: '0' },
      outputDigest: 'f'.repeat(64) }], currentness: { sourceCurrent: true,
      algorithmCurrent: true, settingsRecorded: true, refreshRequired: false },
    historyPosition: { latest: true, superseded: false } };
}
function pool(handler) {
  const client = { release: jest.fn(), query: jest.fn(async (sql, params) => {
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    return handler(sql, params);
  }) };
  return { connect: jest.fn(async () => client), client };
}

test('builds the canonical receipt from trusted preparation and commits once atomically', async () => {
  let committed;
  const database = pool(async (sql, params) => {
    if (sql.includes('_prepare(')) return { rows: [{ value: prepared }] };
    if (sql.includes('_commit(')) {
      committed = params[10];
      return { rows: [{ value: projection(committed) }] };
    }
    throw new Error('Unexpected query');
  });
  const result = await repository.capture(database, actor, input);
  expect(result).toMatchObject({ state: 'current', replayed: false,
    values: [{ value: { amount: '0' } }] });
  expect(committed).toMatchObject({ version: 'm26-forecast-run-receipt-v2',
    id: prepared.id, organizationId: org, settings: prepared.settings,
    sourceSnapshotDigest: prepared.sourceSnapshotDigest,
    algorithm: { key: prepared.algorithm.key, version: prepared.algorithm.version,
      definitionDigest: prepared.algorithm.definitionDigest,
      implementationDigest: prepared.algorithm.implementationDigest,
      buildDigest: prepared.algorithm.buildDigest },
    outputs: [{ targetKey: 'demand.inbound_leads', targetVersion: 'v1',
      outputDigest: 'f'.repeat(64) }], inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
  expect(database.client.query.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
    'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL lock_timeout = '2000ms'",
    "SET LOCAL statement_timeout = '8000ms'", 'COMMIT' ]));
});

test('idempotent replay returns the exact stored receipt without preparation or re-execution', async () => {
  const initial = await repository.capture(pool(async (sql, params) => {
    if (sql.includes('_prepare(')) return { rows: [{ value: prepared }] };
    if (sql.includes('_commit(')) return { rows: [{ value: projection(params[10]) }] };
    throw new Error('Unexpected query');
  }), actor, input);
  let reads = 0;
  const normalizedDatabase = pool(async (sql) => {
    if (sql.includes('_prepare(')) return { rows: [{ value: { state: 'replay',
      runId: prepared.id, runDigest: '1'.repeat(64) } }] };
    if (sql.includes('_read(')) {
      reads += 1;
      return { rows: [{ value: { state: initial.state, receipt: initial.receipt,
        values: initial.values, currentness: initial.currentness,
        historyPosition: { latest: false, superseded: false } } }] };
    }
    throw new Error('Unexpected query');
  });
  const result = await repository.capture(normalizedDatabase, actor, input);
  expect(result.replayed).toBe(true);
  expect(result.historyPosition.latest).toBe(false);
  expect(reads).toBe(1);
  expect(normalizedDatabase.client.query.mock.calls.some(call => call[0].includes('_commit('))).toBe(false);
});

test('empty authenticated history is current while stale retained evidence is value-free', async () => {
  const emptyDatabase = pool(async sql => {
    if (sql.includes('_list(')) return { rows: [{ value: { state: 'current', runs: [] } }] };
    throw new Error('Unexpected query');
  });
  await expect(repository.list(emptyDatabase, {
    organizationId: actor.organizationId, actorUserId: actor.actorUserId,
    actorAccessRole: actor.actorAccessRole, authSessionId: actor.authSessionId,
  })).resolves.toEqual({ state: 'current', runs: [] });
  const staleDatabase = pool(async sql => {
    if (sql.includes('_list(')) return { rows: [{ value: { state: 'unavailable',
      reason: 'retained_inputs_unavailable', runs: null } }] };
    throw new Error('Unexpected query');
  });
  await expect(repository.list(staleDatabase, {
    organizationId: actor.organizationId, actorUserId: actor.actorUserId,
    actorAccessRole: actor.actorAccessRole, authSessionId: actor.authSessionId,
  })).resolves.toEqual({ state: 'unavailable',
    reason: 'retained_inputs_unavailable', runs: null });
});

test('comparison and controlled rerun preserve bounded statements and named outcomes', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  const comparisonDatabase = pool(async sql => {
    if (sql.includes('_compare(')) return { rows: [{ value: { state: 'input_changed',
      leftRunId: prepared.id, rightRunId: other, leftRunDigest: '1'.repeat(64),
      rightRunDigest: '2'.repeat(64), sameInputs: false, sameResults: true,
      digest: '3'.repeat(64) } }] };
    throw new Error('Unexpected query');
  });
  await expect(repository.compare(comparisonDatabase, {
    organizationId: actor.organizationId, actorUserId: actor.actorUserId,
    actorAccessRole: actor.actorAccessRole, authSessionId: actor.authSessionId,
  }, prepared.id, other)).resolves.toMatchObject({ state: 'input_changed',
    sameInputs: false, sameResults: true });
  const rerunDatabase = pool(async sql => {
    if (sql.includes('_controlled_rerun(')) return { rows: [{ value: {
      state: 'reproduced', runId: prepared.id, runDigest: '1'.repeat(64),
      storedResultDigest: '2'.repeat(64), freshResultDigest: '2'.repeat(64),
      sameResults: true, automaticActionAuthorized: false } }] };
    throw new Error('Unexpected query');
  });
  await expect(repository.controlledRerun(rerunDatabase, actor, prepared.id))
    .resolves.toMatchObject({ state: 'reproduced', sameResults: true,
      automaticActionAuthorized: false });
});

test('malformed caller and server evidence fail closed without a transaction commit', async () => {
  await expect(repository.capture(pool(async () => ({ rows: [] })), actor,
    { ...input, extra: true })).rejects.toMatchObject({
    code: 'FORECAST_RUN_REQUEST_INVALID', status: 400 });
  const malformed = pool(async sql => {
    if (sql.includes('_prepare(')) return { rows: [{ value: { ...prepared,
      sourceSnapshotDigest: 'not-a-digest' } }] };
    throw new Error('Unexpected query');
  });
  await expect(repository.capture(malformed, actor, input)).rejects.toMatchObject({
    code: 'FORECAST_RUN_UNAVAILABLE', status: 503 });
  expect(malformed.client.query.mock.calls.some(call => call[0] === 'ROLLBACK')).toBe(true);
});

test('post-capture unavailable rolls back before returning the named value-free boundary', async () => {
  const unavailable = pool(async sql => {
    if (sql.includes('_prepare(')) {
      const error = new Error('Forecast run post-capture evidence unavailable');
      error.code = 'P11B1'; error.detail = 'source_or_algorithm_not_current';
      throw error;
    }
    throw new Error('Unexpected query');
  });
  await expect(repository.capture(unavailable, actor, input)).resolves.toEqual({
    state: 'unavailable', reason: 'source_or_algorithm_not_current', runs: null,
  });
  const statements = unavailable.client.query.mock.calls.map(call => call[0]);
  expect(statements).toContain('ROLLBACK');
  expect(statements).not.toContain('COMMIT');
});
