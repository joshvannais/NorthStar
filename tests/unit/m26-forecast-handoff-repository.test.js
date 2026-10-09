'use strict';

const repository = require('../../src/forecasting/forecastHandoffRepository');

const org = '55555555-5555-4555-8555-555555555555';
const user = '66666666-6666-4666-8666-666666666666';
const session = '77777777-7777-4777-8777-777777777777';
const runId = '11111111-1111-4111-8111-111111111111';
const proposalId = '22222222-2222-4222-8222-222222222222';
const D = character => character.repeat(64);
const readActor = { organizationId: org, actorUserId: user,
  actorAccessRole: 'owner', authSessionId: session };
const mutationActor = { ...readActor, csrfToken: 'csrf-token',
  idempotencyKey: 'part11d-request-key-0001' };
const candidate = { runId, runDigest: D('a'), targetKey: 'demand.inbound_leads',
  targetVersion: 'v1', horizon: { grain: 'month', localStart: '2026-11-01' },
  outputDigest: D('b'), currentness: { revision: 2, digest: D('c') },
  recommendation: { type: 'review_demand_capacity',
    summary: 'Review capacity for the authenticated saved forecast.',
    evidence: { predictionKind: 'point', amount: '0', unit: 'count',
      runDigest: D('a'), outputDigest: D('b') },
    uncertainty: { state: 'unquantified', drivers: ['retell_only'] },
    missingInformation: ['calibrated_interval','current_capacity_record',
      'exact_receiving_record'],
    tradeoff: 'Reviewing early may expose constraints, but no capacity record is proven.' },
  receiver: { mission: '22', workflow: 'calendar_capacity_review', recordId: null,
    expectedRevision: null, expectedDigest: null, availability: 'unavailable',
    reason: 'exact_receiving_record_not_available', href: null },
  advisoryOnly: true, navigationIsApproval: false,
  receiverRecheckRequired: true, automaticActionAuthorized: false };

function proposal(action = 'requested') {
  const dismissed = action === 'dismissed';
  const history = [{ revision: 1, action: 'requested',
    recordedAt: '2026-10-09T12:00:01.123456+00:00', actorUserId: user, digest: D('d') }];
  if (dismissed) history.push({ revision: 2, action: 'dismissed',
    recordedAt: '2026-10-09T12:00:02.000Z', actorUserId: user, digest: D('e') });
  return { version: repository.VERSION, id: proposalId, state: action,
    revision: dismissed ? 2 : 1, organizationId: org,
    createdAt: '2026-10-09T12:00:01.5+00:00', expiresAt: '2026-10-16T12:00:01.54+00:00',
    reviewer: { userId: user, accessRole: 'owner' },
    run: { id: runId, digest: D('a'), targetKey: 'demand.inbound_leads',
      targetVersion: 'v1', horizon: { grain: 'month', localStart: '2026-11-01' },
      outputDigest: D('b'), currentnessRevision: 2, currentnessDigest: D('c') },
    recommendation: { type: candidate.recommendation.type,
      evidence: candidate.recommendation.evidence,
      uncertainty: candidate.recommendation.uncertainty,
      missingInformation: candidate.recommendation.missingInformation,
      tradeoff: candidate.recommendation.tradeoff },
    receiver: candidate.receiver, history, advisoryOnly: true,
    navigationIsApproval: false, receiverRecheckRequired: true,
    automaticActionAuthorized: false, outboundCommunicationAuthorized: false,
    proposalDigest: D('f'), digest: dismissed ? D('2') : D('1') };
}

function envelope(proposals = []) {
  return { version: repository.VERSION, state: 'current', reason: null,
    candidate, proposals, automaticActionAuthorized: false,
    outboundCommunicationAuthorized: false };
}

function pool(handler) {
  const client = { release: jest.fn(), query: jest.fn(async (sql, params) => {
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    return handler(sql, params);
  }) };
  return { connect: jest.fn(async () => client), client };
}

test('strict current envelope preserves authenticated zero and returns detached immutable data', async () => {
  const database = pool(async sql => {
    expect(sql).toContain('canonical_forecast_handoff_v1_read');
    return { rows: [{ value: envelope([proposal()]) }] };
  });
  const result = await repository.list(database, readActor);
  expect(result.candidate.recommendation.evidence.amount).toBe('0');
  expect(result.candidate.receiver).toMatchObject({ availability: 'unavailable', href: null });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.candidate)).toBe(true);
  expect(database.client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL lock_timeout = '2000ms'",
    "SET LOCAL statement_timeout = '8000ms'",
    'SELECT public.canonical_forecast_handoff_v1_read($1,$2,$3,$4) value', 'COMMIT']);
});

test('request and dismissal use exact identities, deterministic digests and one transaction', async () => {
  let requestParams, dismissParams;
  const createDatabase = pool(async (sql, params) => {
    requestParams = params;
    expect(sql).toContain('canonical_forecast_handoff_v1_request');
    return { rows: [{ value: { state: 'created', proposal: proposal() } }] };
  });
  const input = { runId, runDigest: D('a'), currentnessDigest: D('c'),
    expiresAt: '2026-10-16T12:00:01.000Z' };
  await expect(repository.requestReview(createDatabase, mutationActor, input))
    .resolves.toMatchObject({ state: 'created', proposal: { state: 'requested' } });
  expect(requestParams.slice(0, 6)).toEqual([org, user, 'owner', session,
    'csrf-token', 'part11d-request-key-0001']);
  expect(requestParams[6]).toMatch(/^[0-9a-f]{64}$/);
  expect(requestParams.slice(7)).toEqual([runId, D('a'), D('c'), input.expiresAt]);

  const dismissDatabase = pool(async (sql, params) => {
    dismissParams = params;
    expect(sql).toContain('canonical_forecast_handoff_v1_dismiss');
    return { rows: [{ value: { state: 'dismissed', proposal: proposal('dismissed') } }] };
  });
  await expect(repository.dismiss(dismissDatabase, mutationActor, proposalId,
    { expectedRevision: 1, expectedDigest: D('1') }))
    .resolves.toMatchObject({ state: 'dismissed', proposal: { revision: 2 } });
  expect(dismissParams.slice(0, 6)).toEqual([org, user, 'owner', session,
    'csrf-token', 'part11d-request-key-0001']);
  expect(dismissParams[6]).toMatch(/^[0-9a-f]{64}$/);
  expect(dismissParams.slice(7)).toEqual([proposalId, 1, D('1')]);
});

test('named unavailable responses are value-free and malformed evidence rolls back', async () => {
  const unavailable = pool(async () => ({ rows: [{ value: {
    version: repository.VERSION, state: 'unavailable', reason: 'run_stale',
    candidate: null, proposals: null, automaticActionAuthorized: false,
    outboundCommunicationAuthorized: false } }] }));
  await expect(repository.list(unavailable, readActor)).resolves.toMatchObject({
    state: 'unavailable', reason: 'run_stale', candidate: null, proposals: null });

  const expiredMutation = pool(async () => ({ rows: [{ value: {
    state: 'unavailable', reason: 'proposal_expired', proposal: null } }] }));
  await expect(repository.dismiss(expiredMutation, mutationActor, proposalId,
    { expectedRevision: 1, expectedDigest: D('1') })).resolves.toEqual({
    state: 'unavailable', reason: 'proposal_expired', proposal: null });

  const malformed = pool(async () => ({ rows: [{ value: envelope([{
    ...proposal(), receiver: { ...candidate.receiver, href: '/calendar' } }]) }] }));
  await expect(repository.list(malformed, readActor)).rejects.toMatchObject({
    code: 'FORECAST_HANDOFF_UNAVAILABLE', status: 503 });
  expect(malformed.client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
});

test('extra fields, missing CSRF, invalid expiry and stale revisions fail before SQL', async () => {
  const database = pool(async () => { throw new Error('SQL must not run'); });
  await expect(repository.requestReview(database, mutationActor,
    { runId, runDigest: D('a'), currentnessDigest: D('c'),
      expiresAt: '2026-10-16T12:00:01.000Z', extra: true }))
    .rejects.toMatchObject({ code: 'FORECAST_HANDOFF_REQUEST_INVALID', status: 400 });
  await expect(repository.requestReview(database, { ...mutationActor, csrfToken: null },
    { runId, runDigest: D('a'), currentnessDigest: D('c'), expiresAt: 'invalid' }))
    .rejects.toMatchObject({ code: 'FORECAST_HANDOFF_ACCESS_RESTRICTED', status: 403 });
  await expect(repository.dismiss(database, mutationActor, proposalId,
    { expectedRevision: 0, expectedDigest: D('1') }))
    .rejects.toMatchObject({ code: 'FORECAST_HANDOFF_REQUEST_INVALID', status: 400 });
  expect(database.connect).not.toHaveBeenCalled();
});
