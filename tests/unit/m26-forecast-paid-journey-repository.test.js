'use strict';

const repository = require('../../src/forecasting/forecastPaidJourneyRepository');

const org = '55555555-5555-4555-8555-555555555555';
const user = '66666666-6666-4666-8666-666666666666';
const session = '77777777-7777-4777-8777-777777777777';
const runId = '11111111-1111-4111-8111-111111111111';
const originId = '22222222-2222-4222-8222-222222222222';
const D = value => value.repeat(64);
const readActor = { organizationId: org, actorUserId: user,
  actorAccessRole: 'owner', authSessionId: session };
const mutationActor = { ...readActor, csrfToken: 'csrf-token',
  idempotencyKey: 'part12a-paid-key-0001' };

function run() {
  return { id: runId, createdAt: '2026-10-09T12:00:00.000000Z',
    cutoffAt: '2026-10-09T11:59:59.000000Z',
    settings: { revision: 1, digest: D('1') },
    source: { positionId: '33333333-3333-4333-8333-333333333333',
      positionDigest: D('2'), sourceSnapshotDigest: D('3'),
      reportingWindowDigest: D('4'), featureSetDigest: D('5'),
      scope: 'northstar_supported_commercial_sources_at_capture',
      naturalHistoryValidated: false, wholeBusinessCoverageValidated: false },
    target: { key: 'revenue.approved_price_flow', definitionVersion: 'v1',
      semantic: 'future_human_approved_commercial_price_decisions' },
    horizon: { grain: 'month', startsAt: '2026-10-10T00:00:00.000000Z',
      endsAt: '2026-10-11T00:00:00.000000Z' },
    algorithm: { key: 'approved_price_carry_forward',
      version: 'm26-paid-approved-price-flow-v1', definitionDigest: D('6'),
      implementationDigest: D('7'), configurationDigest: D('8') },
    output: { predictionKind: 'deterministic_point', value: { amount: '0.00' },
      unit: { key: 'money', currency: 'USD' }, digest: D('9') },
    explanation: { summary: 'Synthetic deterministic approved-price explanation.',
      sourceCoverage: 'Current NorthStar-supported commercial records at capture time.',
      customerSafe: true, advisoryOnly: true, digest: D('a') },
    receipt: { organizationId: org, digest: D('b') },
    currentness: { state: 'unchanged_candidate', revision: 1, digest: D('c'),
      adviceDisplayAuthorized: false },
    review: { receiverAvailability: 'unavailable',
      receiverReason: 'no_exact_receiving_adapter', receiverHref: null,
      history: [], advisoryOnly: true, receiverMutationCount: 0 },
    automaticActionAuthorized: false, outboundCommunicationAuthorized: false };
}
function reviewEvent(action, expiry) {
  const paidRun = run();
  return { revision: 1, action, recordedAction: action,
    recordedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: expiry,
    organizationId: org, runId, actorUserId: user, actorAccessRole: 'owner',
    predecessorDigest: null, runDigest: D('b'), currentnessRevision: 1,
    currentnessDigest: D('c'), target: paidRun.target, horizon: paidRun.horizon,
    outputDigest: D('9'), recommendationType: 'review_approved_price_flow',
    receiving: { mission: null, workflow: null, recordId: null,
      expectedRevision: null, availability: 'unavailable', reason: 'no_exact_receiving_adapter' },
    evidence: { receiptDigest: D('b'), explanationDigest: D('a'),
      sourcePositionDigest: D('2') },
    uncertainty: { state: 'unquantified', calibratedIntervalAvailable: false,
      reason: 'empirical_calibration_unavailable' },
    missingInformation: ['natural_observation_history','empirical_calibration',
      'whole_business_coverage','live_provider_validation'],
    tradeoff: 'Review can inform a later independently authorized workflow; no receiver or operational state changes here.',
    digest: D('d') };
}
function envelope(state = 'current', replayed) {
  const value = { version: 'm26-paid-journey-v1', state,
    reason: state === 'current' || state === 'ready' ? null : 'source_not_current',
    run: state === 'current' ? run() : null,
    review: state === 'current' ? { availability: 'unavailable',
      reason: 'no_exact_receiving_adapter', requestReviewAvailable: true } : null,
    targetKey: 'revenue.approved_price_flow',
    syntheticImplementationEvidenceOnly: true, liveValidationAvailable: false,
    automaticActionAuthorized: false };
  if (replayed !== undefined) value.replayed = replayed;
  return value;
}
function pool(handler) {
  const client = { release: jest.fn(), query: jest.fn(async (sql, params) => {
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    return handler(sql, params);
  }) };
  return { connect: jest.fn(async () => client), client };
}

test('current keeps authenticated zero distinct and returns detached immutable evidence', async () => {
  const database = pool(async sql => {
    expect(sql).toContain('canonical_forecast_paid_journey_v1_current');
    return { rows: [{ value: envelope() }] };
  });
  const value = await repository.current(database, readActor);
  expect(value.run.output.value.amount).toBe('0.00');
  expect(value.run.review).toMatchObject({ receiverAvailability: 'unavailable',
    receiverHref: null, receiverMutationCount: 0 });
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(value.run.source)).toBe(true);
  expect(database.client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL TIME ZONE 'UTC'",
    "SET LOCAL lock_timeout = '2000ms'", "SET LOCAL statement_timeout = '8000ms'",
    'SELECT public.canonical_forecast_paid_journey_v1_current($1,$2,$3,$4) value',
    'COMMIT']);
});

test('issue pins exact settings and origin identities and preserves named value-free replay state', async () => {
  let parameters;
  const database = pool(async (sql, params) => {
    expect(sql).toContain('canonical_forecast_paid_journey_v1_issue');
    parameters = params; return { rows: [{ value: envelope('current', false) }] };
  });
  const input = { expectedSettingsRevision: 1, expectedSettingsDigest: D('1'),
    approvedPriceOriginId: originId,
    reason: ' Synthetic owner-reviewed paid journey issue evidence. ' };
  await expect(repository.issue(database, mutationActor, input)).resolves.toMatchObject({
    state: 'current', replayed: false, run: { id: runId } });
  expect(parameters.slice(0, 6)).toEqual([org, user, 'owner', session,
    'csrf-token', 'part12a-paid-key-0001']);
  expect(parameters[6]).toMatch(/^[0-9a-f]{64}$/);
  expect(parameters.slice(7)).toEqual([1, D('1'), originId,
    'Synthetic owner-reviewed paid journey issue evidence.']);

  const unavailable = pool(async () => ({ rows: [{ value: envelope('unavailable', true) }] }));
  await expect(repository.issue(unavailable, mutationActor, {
    expectedSettingsRevision: 1, expectedSettingsDigest: D('1'),
    approvedPriceOriginId: originId, reason: 'Synthetic replay after source loss.' }))
    .resolves.toMatchObject({ state: 'unavailable', reason: 'source_not_current',
      run: null, review: null, replayed: true });
});

test('rerun and review use exact immutable identities and allow a still-current dismissal expiry', async () => {
  let rerunParameters, reviewParameters;
  const rerunDb = pool(async (sql, params) => {
    expect(sql).toContain('canonical_forecast_paid_journey_v1_rerun');
    rerunParameters = params; return { rows: [{ value: { state: 'reproduced',
      runId, runDigest: D('b'), storedOutputDigest: D('9'), freshOutputDigest: D('9'),
      sameResults: true, automaticActionAuthorized: false } }] };
  });
  await expect(repository.rerun(rerunDb, mutationActor, runId)).resolves.toMatchObject({
    state: 'reproduced', sameResults: true });
  expect(rerunParameters).toEqual([org, user, 'owner', session, 'csrf-token', runId]);

  const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const reviewDb = pool(async (sql, params) => {
    expect(sql).toContain('canonical_forecast_paid_journey_v1_review');
    reviewParameters = params;
    const journey = envelope();
    journey.run.review.history = [reviewEvent('dismissed', expiry)];
    return { rows: [{ value: { state: 'dismissed', journey } }] };
  });
  await expect(repository.review(reviewDb, mutationActor, { runId,
    runDigest: D('b'), currentnessDigest: D('c'), action: 'dismissed',
    expectedRevision: 1, expectedDigest: D('d'), expiresAt: expiry }))
    .resolves.toMatchObject({ state: 'dismissed', journey: { state: 'current' } });
  expect(reviewParameters.slice(0, 6)).toEqual([org, user, 'owner', session,
    'csrf-token', 'part12a-paid-key-0001']);
  expect(reviewParameters[6]).toMatch(/^[0-9a-f]{64}$/);
  expect(reviewParameters.slice(7)).toEqual([runId, D('b'), D('c'),
    'dismissed', 1, D('d'), expiry]);
});

test('malformed authority, receipts, extra fields and expired review requests fail closed', async () => {
  const database = pool(async () => { throw new Error('SQL must not run'); });
  await expect(repository.current(database, { ...readActor, actorAccessRole: 'member' }))
    .rejects.toMatchObject({ code: 'FORECAST_PAID_JOURNEY_ACCESS_RESTRICTED', status: 403 });
  await expect(repository.issue(database, mutationActor, {
    expectedSettingsRevision: 1, expectedSettingsDigest: D('1'),
    approvedPriceOriginId: originId, reason: 'Valid-looking reason.', extra: true }))
    .rejects.toMatchObject({ code: 'FORECAST_PAID_JOURNEY_REQUEST_INVALID', status: 400 });
  await expect(repository.review(database, mutationActor, { runId,
    runDigest: D('b'), currentnessDigest: D('c'), action: 'requested',
    expectedRevision: null, expectedDigest: null,
    expiresAt: new Date(Date.now() + 60000).toISOString() }))
    .rejects.toMatchObject({ code: 'FORECAST_PAID_JOURNEY_REQUEST_INVALID', status: 400 });
  expect(database.connect).not.toHaveBeenCalled();

  const malformed = pool(async () => ({ rows: [{ value: {
    ...envelope(), run: { ...run(), receipt: { organizationId: org, digest: 'bad' } } } }] }));
  await expect(repository.current(malformed, readActor)).rejects.toMatchObject({
    code: 'FORECAST_PAID_JOURNEY_UNAVAILABLE', status: 503 });
  expect(malformed.client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
});
