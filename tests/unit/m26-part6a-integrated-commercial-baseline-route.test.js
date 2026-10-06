'use strict';

const express = require('express');
const request = require('supertest');
const { createForecastBookingReviewsRouter } =
  require('../../src/routes/forecastBookingReviews');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const POSITION = '44444444-4444-4444-8444-444444444444';
const ORIGIN = '55555555-5555-4555-8555-555555555555';
const RECEIPT = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-integrated-baseline-key-0001';

function currentValue() {
  return {
    state: 'northstar_integrated_commercial_baseline',
    version: 'm26-integrated-commercial-baseline-v1', positionId: POSITION,
    asOf: '2026-10-06T00:00:00.000000Z',
    scope: 'northstar_supported_commercial_sources_at_capture', currency: 'USD',
    authorizedEstimateBeforeTax: '0.00', approvedPriceBeforeTax: '1250.00',
    bookedWorkBeforeTax: '0.00',
    commercialStatuses: {
      currentIssuedEstimateCount: 0, staleIssuedEstimateCount: 0,
      issuedVersionSourceCount: 0, activeApprovedPriceCount: 1,
      withdrawnPriceCount: 0, ownerReviewedUnconfirmedCount: 0,
      correctedAwaitingConfirmationCount: 0, correctedFormerlyConfirmedCount: 0,
      ownerConfirmedBookedCount: 0, bookingConfirmationSourceCount: 0,
      cancelledBookingCount: 0, cancelledFormerlyConfirmedCount: 0,
    },
    sourceCapture: {
      method: 'migration_fenced_current_state_v1', sourceDigest: DIGEST,
      approvedCoverageStartsAt: '2026-09-01T00:00:00.000000Z',
      approvedCoverageStartOrder: 0, approvedHighWaterOrder: 1,
      commercialHighWaterOrder: 0, commercialReviewHighWaterOrder: 0,
    },
    futureApprovedPriceBaseline: {
      runId: ORIGIN, targetKey: 'revenue.approved_price_flow',
      definitionVersion: 'v1',
      calculationVersion: 'm26_price_flow_carry_forward_v1',
      calendarTimeZone: 'UTC', profileAnchorId: POSITION,
      profileProofDigest: DIGEST,
      methodRegistrationVersion: 'm26_selected_m24_deterministic_closure_v1',
      methodGovernanceRegistrationVersion:
        'm26_complete_window_deterministic_closure_v2',
      methodGovernanceClosureDigest: DIGEST,
      integratedMethodRegistrationVersion:
        'm26_integrated_commercial_price_closure_v1',
      integratedMethodClosureDigest: DIGEST,
      horizonStartsAt: '2029-01-01T00:00:00.000000Z',
      horizonEndsAt: '2029-01-02T00:00:00.000000Z',
      sourceReceiptId: RECEIPT, sourceSnapshotDigest: DIGEST,
      receiptDigest: DIGEST, originProofDigest: DIGEST,
      captureCommitObservedAt: '2026-10-05T23:59:59.000000Z',
      preHorizonCommitVerified: true, genuineFutureAtRead: true,
      amountStoredPrivately: true, valueWithheld: true,
      realForecastEligible: false, paidNumericServing: false,
    },
    replayed: false, sourceCurrent: true,
    sourceCohortsCompleteAtCapture: true, captureTimeEquivalentVerified: true,
    naturalObservationPeriodVerified: false,
    futureApprovedPriceBaselineVerified: true,
    wholeBusinessCoverageVerified: false, earnedRevenueMeasured: false,
    collectedCashMeasured: false, forecastIssued: false,
    automaticActionAuthorized: false,
  };
}

function currentReadValue() {
  const value = currentValue();
  delete value.replayed;
  value.currentAtRead = true;
  return value;
}

function application(value, role = 'owner') {
  const app = express(); app.use(express.json());
  const auth = (req, _res, next) => {
    req.user = { id: USER }; req.orgId = ORG;
    req.tenantContext = { organizationId: ORG, userId: USER };
    req.userRole = role; req.authSession = { id: SESSION }; next();
  };
  const client = { query: jest.fn(async sql => sql.startsWith('SELECT public.') ?
    { rows: [{ value }] } : { rows: [] }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  app.use('/api/v1/forecast/booking-reviews', createForecastBookingReviewsRouter({
    auth, throttle: (_req, _res, next) => next(), poolProvider: () => pool,
  }));
  return { app, pool, client };
}

test('integrated capture uses server identity and exposes only the minimized baseline', async () => {
  const value = currentValue();
  value.commercialStatuses.privateCount = 9;
  const poisoned = application(value);
  const rejected = await request(poisoned.app)
    .post('/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'server-csrf')
    .send({ approvedPriceOriginId: ORIGIN,
      confirmationVersion: 'integrated-commercial-baseline-v1', confirmed: true,
      reason: 'Capture the supported commercial sources.' });
  expect(rejected.status).toBe(503);
  expect(JSON.stringify(rejected.body)).not.toContain('privateCount');
  expect(poisoned.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');

  const valid = application(currentValue());
  const response = await request(valid.app)
    .post('/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'server-csrf')
    .send({ approvedPriceOriginId: ORIGIN,
      confirmationVersion: 'integrated-commercial-baseline-v1', confirmed: true,
      reason: 'Capture the supported commercial sources.' });
  expect(response.status).toBe(201);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers.vary).toContain('Cookie');
  expect(response.body.data).toMatchObject({
    state: 'northstar_integrated_commercial_baseline', positionId: POSITION,
    approvedPriceBeforeTax: '1250.00', bookedWorkBeforeTax: '0.00',
    sourceCapture: { method: 'migration_fenced_current_state_v1',
      approvedCoverageStartsAt: '2026-09-01T00:00:00.000000Z' },
    futureApprovedPriceBaseline: {
      targetKey: 'revenue.approved_price_flow', definitionVersion: 'v1',
      calculationVersion: 'm26_price_flow_carry_forward_v1',
      calendarTimeZone: 'UTC',
      preHorizonCommitVerified: true, valueWithheld: true },
    replayed: false,
  });
  expect(JSON.stringify(response.body.data)).not.toMatch(
    /sourceDigest|HighWaterOrder|CoverageStartOrder|sourceReceiptId|runId|receiptDigest|originProofDigest|sourceSnapshotDigest|profileAnchorId|profileProofDigest|methodRegistrationVersion|methodGovernance|integratedMethod/);
  expect(valid.client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '15s'",
    "SET LOCAL lock_timeout = '2s'",
    'SELECT public.canonical_forecast_capture_integrated_commercial_position($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
    'COMMIT',
  ]);
  expect(valid.client.query.mock.calls[3][1]).toEqual([
    ORG, USER, 'owner', SESSION, 'server-csrf', ORIGIN, KEY,
    'Capture the supported commercial sources.', true,
    'integrated-commercial-baseline-v1',
  ]);
});

test.each([
  ['statuses', value => { value.commercialStatuses.unknown = 1; }],
  ['source', value => { value.sourceCapture.privateNonce = 'never-return'; }],
  ['future', value => { value.futureApprovedPriceBaseline.privateAmount = '99.00'; }],
  ['negative order', value => { value.sourceCapture.approvedHighWaterOrder = -1; }],
  ['invalid as-of', value => { value.asOf = '2026-99-99T00:00:00.000000Z'; }],
  ['calendar-invalid as-of', value => {
    value.asOf = '2026-02-30T00:00:00.000000Z';
  }],
  ['invalid future instant', value => {
    value.futureApprovedPriceBaseline.horizonStartsAt = '2029-99-01T00:00:00.000000Z';
  }],
  ['non-day future horizon', value => {
    value.futureApprovedPriceBaseline.horizonEndsAt = '2029-01-03T00:00:00.000000Z';
  }],
  ['future horizon one microsecond too long', value => {
    value.futureApprovedPriceBaseline.horizonEndsAt = '2029-01-02T00:00:00.000001Z';
  }],
  ['commit at future horizon', value => {
    value.futureApprovedPriceBaseline.captureCommitObservedAt =
      value.futureApprovedPriceBaseline.horizonStartsAt;
  }],
  ['commit after as-of', value => {
    value.futureApprovedPriceBaseline.captureCommitObservedAt =
      '2026-10-06T00:00:00.000001Z';
  }],
  ['mixed-precision commit after as-of', value => {
    value.asOf = '2026-10-06T00:00:00.01Z';
    value.futureApprovedPriceBaseline.captureCommitObservedAt =
      '2026-10-06T00:00:00.010001Z';
  }],
])('integrated read rejects poisoned %s without reflecting nested data', async (_name, poison) => {
  const value = currentReadValue(); poison(value);
  const { app, client } = application(value);
  const response = await request(app).get(
    `/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/${POSITION}`);
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toMatch(/never-return|privateNonce|privateAmount/);
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('write and read require their distinct replay/currentness proof', async () => {
  const writeMissingReplay = currentValue(); delete writeMissingReplay.replayed;
  expect((await request(application(writeMissingReplay).app)
    .post('/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines')
    .set('Idempotency-Key', KEY).send({ approvedPriceOriginId: ORIGIN,
      confirmationVersion: 'integrated-commercial-baseline-v1', confirmed: true,
      reason: 'Capture the supported commercial sources.' })).status).toBe(503);

  const readWithReplay = currentValue();
  readWithReplay.currentAtRead = true;
  expect((await request(application(readWithReplay).app).get(
    `/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/${POSITION}`)).status)
    .toBe(503);

  const read = await request(application(currentReadValue()).app).get(
    `/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/${POSITION}`);
  expect(read.status).toBe(200);
  expect(read.body.data.currentAtRead).toBe(true);
  expect(read.body.data).not.toHaveProperty('replayed');
});

test('unavailable projection accepts only finite public reasons and hides cross-tenant absence', async () => {
  const absent = application({ state: 'integrated_commercial_baseline_unavailable',
    reason: 'position_not_found', sourceCurrent: false,
    sourceCohortsCompleteAtRead: false, futureApprovedPriceBaselineVerified: false,
    earnedRevenueMeasured: false, collectedCashMeasured: false, forecastIssued: false,
    privateDetail: 'wrong tenant' });
  const notFound = await request(absent.app).get(
    `/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/${POSITION}`);
  expect(notFound.status).toBe(404);
  expect(JSON.stringify(notFound.body)).not.toContain('wrong tenant');

  const poisoned = application({ state: 'integrated_commercial_baseline_unavailable',
    reason: 'private database explanation', sourceCurrent: false,
    sourceCohortsCompleteAtRead: false, futureApprovedPriceBaselineVerified: false,
    earnedRevenueMeasured: false, collectedCashMeasured: false, forecastIssued: false });
  const response = await request(poisoned.app).get(
    `/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/${POSITION}`);
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toContain('private database explanation');

  for (const contradiction of [
    { sourceCohortsCompleteAtRead: true, futureApprovedPriceBaselineVerified: false },
    { sourceCohortsCompleteAtRead: false, futureApprovedPriceBaselineVerified: true },
    { sourceCohortsCompleteAtRead: false },
  ]) {
    const value = { state: 'integrated_commercial_baseline_unavailable',
      reason: 'commercial_sources_unavailable', sourceCurrent: false,
      earnedRevenueMeasured: false, collectedCashMeasured: false,
      forecastIssued: false, ...contradiction };
    expect((await request(application(value).app).get(
      `/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/${POSITION}`))
      .status).toBe(503);
  }
});

test('member and caller-supplied authority are denied before persistence', async () => {
  const member = application(currentValue(), 'member');
  expect((await request(member.app).get(
    `/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/${POSITION}`)).status)
    .toBe(403);
  expect(member.pool.connect).not.toHaveBeenCalled();
  const owner = application(currentValue());
  expect((await request(owner.app)
    .post('/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines')
    .set('Idempotency-Key', KEY).send({ approvedPriceOriginId: ORIGIN,
      confirmationVersion: 'integrated-commercial-baseline-v1', confirmed: true,
      reason: 'Capture the supported commercial sources.', organizationId: ORG })).status)
    .toBe(400);
  expect(owner.pool.connect).not.toHaveBeenCalled();
});

test.each([
  ['wrong purpose', KEY, { approvedPriceOriginId: ORIGIN,
    confirmationVersion: 'owner-booked-work-confirm-v1', confirmed: true,
    reason: 'Capture the supported commercial sources.' }],
  ['missing idempotency', null, { approvedPriceOriginId: ORIGIN,
    confirmationVersion: 'integrated-commercial-baseline-v1', confirmed: true,
    reason: 'Capture the supported commercial sources.' }],
  ['invalid origin', KEY, { approvedPriceOriginId: 'not-a-uuid',
    confirmationVersion: 'integrated-commercial-baseline-v1', confirmed: true,
    reason: 'Capture the supported commercial sources.' }],
  ['short reason', KEY, { approvedPriceOriginId: ORIGIN,
    confirmationVersion: 'integrated-commercial-baseline-v1', confirmed: true,
    reason: 'too short' }],
])('malformed integrated capture %s fails before database access',
  async (_name, idempotencyKey, body) => {
    const guarded = application(currentValue());
    let response = request(guarded.app)
      .post('/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines');
    if (idempotencyKey) response = response.set('Idempotency-Key', idempotencyKey);
    response = await response.send(body);
    expect(response.status).toBe(400);
    expect(guarded.pool.connect).not.toHaveBeenCalled();
  });
