'use strict';

const express = require('express');
const querystring = require('node:querystring');
const request = require('supertest');
const { createForecastTransitionCohortsRouter } =
  require('../../src/routes/forecastTransitionCohorts');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const COHORT = '44444444-4444-4444-8444-444444444444';
const OPPORTUNITY = '55555555-5555-4555-8555-555555555555';
const REVIEW = '66666666-6666-4666-8666-666666666666';
const FINALIZATION = '77777777-7777-4777-8777-777777777777';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-transition-cohort-request-1';
const CUTOFF = '2026-09-01T00:00:00.000000Z';
const HORIZON = '2026-09-08T00:00:00.000000Z';

function cohort(extra = {}) {
  return { id: COHORT, version: 'm26-commercial-booking-withdrawal-cohort-v1',
    targetKey: 'commercial.owner_reviewed_booking_withdrawal',
    state: 'descriptive_only', reason: null,
    cutoffAt: CUTOFF, horizonEndsAt: HORIZON,
    capturedAt: '2026-09-09T00:00:00.000000Z', eligibleCount: 3,
    cancelledCount: 1, observedRate: '0.333333', sourceDigest: DIGEST,
    cohortDigest: DIGEST,
    sourceAuthority: 'northstar_owner_reviewed_commercial_booking_history',
    sourceAuthenticated: true, sourceCoverageComplete: false,
    offPlatformCoverageVerified: false, providerCoverageVerified: false,
    probabilityCalibrated: false, confidence: 'unavailable', forecastIssued: false,
    paidNumericServing: false, ...extra };
}

function scheduleCohort(extra = {}) {
  return cohort({ version: 'm26-schedule-booking-cancellation-cohort-v1',
    targetKey: 'demand.booking_cancellation.v1',
    sourceAuthority: 'northstar_human_approved_schedule_history', ...extra });
}

function bookingTransitionCohort(extra = {}) {
  const value = cohort({ version: 'm26-schedule-booking-transition-cohort-v1',
    targetKey: 'demand.booking_transition.v1',
    sourceAuthority: 'northstar_canonical_opportunity_and_human_approved_schedule_history',
    ...extra });
  value.bookedCount = value.cancelledCount;
  delete value.cancelledCount;
  return value;
}

function qualificationCohort(extra = {}) {
  const value = cohort({ version: 'm26-lead-qualification-cohort-v1',
    targetKey: 'demand.qualification_transition.v1',
    sourceAuthority: 'northstar_human_reviewed_lead_state', ...extra });
  value.qualifiedCount = value.cancelledCount;
  delete value.cancelledCount;
  return value;
}

function qualificationReview(extra = {}) {
  return { id: REVIEW, opportunityId: OPPORTUNITY, revision: 1,
    previousId: null, eventKey: REVIEW, supersedesId: null, action: 'observe',
    state: 'open', effectiveAt: CUTOFF, reason: 'Owner reviewed the lead state.',
    digest: DIGEST, createdAt: CUTOFF,
    sourceAuthority: 'northstar_human_reviewed_lead_state', ...extra };
}

function qualificationFinalization(extra = {}) {
  return { id: FINALIZATION, revision: 1, previousId: null,
    recordedThrough: HORIZON, sourceHighWaterOrder: 2,
    reason: 'Owner reviewed the bounded source through the ended horizon.',
    digest: DIGEST, createdAt: '2026-09-09T00:00:00.000000Z',
    boundary: 'Finalization covers only this NorthStar human-review source.', ...extra };
}

function estimateRequestCohort(extra = {}) {
  const value = cohort({ version: 'm26-estimate-request-cohort-v1',
    targetKey: 'demand.estimate_request_transition.v1',
    sourceAuthority: 'northstar_human_reviewed_estimate_request_state', ...extra });
  value.requestedCount = value.cancelledCount;
  delete value.cancelledCount;
  return value;
}

function estimateRequestReview(extra = {}) {
  return { ...qualificationReview({
    reason: 'Owner reviewed the accepted estimate request state.',
    sourceAuthority: 'northstar_human_reviewed_estimate_request_state',
  }), ...extra };
}

function application({ role = 'owner', captured, read, reviewMutated, reviewRead,
  finalizationMutated, finalizationRead, databaseError } = {}) {
  const app = express();
  app.set('query parser', querystring.parse);
  app.use(express.json());
  const auth = (req, _res, next) => {
    req.user = { id: USER };
    req.tenantContext = { organizationId: ORG, userId: USER };
    req.orgId = ORG;
    req.userRole = role;
    req.authSession = { id: SESSION };
    next();
  };
  const client = { query: jest.fn(async sql => {
    if (databaseError && sql.startsWith('SELECT public.')) throw databaseError;
    if (sql.includes('canonical_estimate_request_state_review_mutate')) return { rows: [{ value:
      reviewMutated || { review: estimateRequestReview(), replayed: false } }] };
    if (sql.includes('canonical_estimate_request_state_review_read')) return { rows: [{ value:
      reviewRead || { current: estimateRequestReview(), history: [estimateRequestReview()],
        total: 1, truncated: false, boundary: 'Tenant-private reviewed request history.' } }] };
    if (sql.includes('canonical_estimate_request_state_finalization_mutate')) return { rows: [{ value:
      finalizationMutated || { finalization: qualificationFinalization(), replayed: false } }] };
    if (sql.includes('canonical_estimate_request_state_finalization_read')) return { rows: [{ value:
      finalizationRead === undefined ? qualificationFinalization() : finalizationRead }] };
    if (sql.includes('canonical_forecast_estimate_request_cohort_capture')) return { rows: [{ value:
      captured || { cohort: estimateRequestCohort(), replayed: false } }] };
    if (sql.includes('canonical_forecast_estimate_request_cohort_read')) return { rows: [{ value:
      read || estimateRequestCohort() }] };
    if (sql.includes('canonical_forecast_schedule_booking_transition_cohort_capture')) return {
      rows: [{ value: captured || { cohort: bookingTransitionCohort(), replayed: false } }] };
    if (sql.includes('canonical_forecast_schedule_booking_transition_cohort_read')) return {
      rows: [{ value: read || bookingTransitionCohort() }] };
    if (sql.includes('canonical_lead_state_review_mutate')) return { rows: [{ value:
      reviewMutated || { review: qualificationReview(), replayed: false } }] };
    if (sql.includes('canonical_lead_state_review_read')) return { rows: [{ value:
      reviewRead || { current: qualificationReview(), history: [qualificationReview()],
        total: 1, truncated: false, boundary: 'Tenant-private reviewed history.' } }] };
    if (sql.includes('canonical_lead_state_finalization_mutate')) return { rows: [{ value:
      finalizationMutated || { finalization: qualificationFinalization(), replayed: false } }] };
    if (sql.includes('canonical_lead_state_finalization_read')) return { rows: [{ value:
      finalizationRead === undefined ? qualificationFinalization() : finalizationRead }] };
    if (sql.includes('_capture')) return { rows: [{ value: captured || {
      cohort: cohort(), replayed: false } }] };
    if (sql.includes('_read')) return { rows: [{ value: read || cohort() }] };
    return { rows: [] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  const bypass = (_req, _res, next) => next();
  app.use('/cohorts', createForecastTransitionCohortsRouter({ auth,
    throttle: bypass, captureThrottle: bypass, reviewThrottle: bypass,
    poolProvider: () => pool }));
  return { app, pool, client };
}

test('captures a guarded descriptive cohort without presenting a probability', async () => {
  const { app, client } = application();
  const response = await request(app).post('/cohorts/commercial-booking-withdrawals')
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
  expect(response.status).toBe(201);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body.data).toMatchObject({ state: 'descriptive_only',
    cohortId: COHORT, eligibleCount: 3, cancelledCount: 1,
    observedRate: '0.333333', sourceAuthenticated: true,
    sourceCoverageComplete: false, probabilityCalibrated: false,
    forecastIssued: false, paidNumericServing: false, replayed: false });
  expect(client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN ISOLATION LEVEL READ COMMITTED',
    "SET LOCAL statement_timeout = '10000ms'",
    "SET LOCAL lock_timeout = '2000ms'",
    'SELECT public.canonical_forecast_booking_cancellation_cohort_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
    'COMMIT',
  ]);
  expect(client.query.mock.calls[3][1]).toEqual([
    ORG, USER, 'owner', SESSION, 'validated-csrf', KEY, CUTOFF, HORIZON,
  ]);
});

test('reads only the bounded projection and accepts PostgreSQL timestamp precision', async () => {
  const value = cohort({ capturedAt: '2026-09-09T00:00:00Z' });
  const { app, client } = application({ read: value });
  const response = await request(app).get(`/cohorts/commercial-booking-withdrawals/${COHORT}`);
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ state: 'descriptive_only', reason: null,
    cohortId: COHORT, version: value.version, targetKey: value.targetKey,
    cutoffAt: CUTOFF, horizonEndsAt: HORIZON, capturedAt: value.capturedAt,
    eligibleCount: 3, cancelledCount: 1, observedRate: '0.333333',
    sourceDigest: DIGEST, cohortDigest: DIGEST,
    sourceAuthority: value.sourceAuthority, sourceAuthenticated: true,
    sourceCoverageComplete: false, offPlatformCoverageVerified: false,
    providerCoverageVerified: false, probabilityCalibrated: false,
    confidence: 'unavailable', forecastIssued: false, paidNumericServing: false });
  expect(client.query.mock.calls[3][1]).toEqual([ORG, USER, 'owner', SESSION, COHORT]);
});

test('keeps empty, corrected and stale history explicitly unavailable', async () => {
  const empty = cohort({ state: 'unavailable', reason: 'insufficient_history',
    eligibleCount: 0, cancelledCount: 0, observedRate: null });
  expect((await request(application({ captured: { cohort: empty, replayed: false } }).app)
    .post('/cohorts/commercial-booking-withdrawals').set('X-CSRF-Token', 'csrf')
    .set('Idempotency-Key', KEY).send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON }))
    .body.data).toMatchObject({ state: 'unavailable', reason: 'insufficient_history' });

  const corrected = { state: 'source_changed_inside_horizon', replayed: false,
    sourceAuthenticated: false, sourceCoverageComplete: false,
    offPlatformCoverageVerified: false, providerCoverageVerified: false,
    probabilityCalibrated: false, confidence: 'unavailable', forecastIssued: false,
    paidNumericServing: false };
  expect((await request(application({ captured: corrected }).app)
    .post('/cohorts/commercial-booking-withdrawals').set('X-CSRF-Token', 'csrf')
    .set('Idempotency-Key', KEY).send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON }))
    .body.data).toEqual({ state: 'source_changed_inside_horizon',
      reason: 'source_correction_inside_horizon', sourceAuthenticated: false,
      sourceCoverageComplete: false, probabilityCalibrated: false,
      offPlatformCoverageVerified: false, providerCoverageVerified: false,
      confidence: 'unavailable', forecastIssued: false, paidNumericServing: false });

  const stale = cohort({ state: 'source_stale', reason: 'source_changed_inside_horizon',
    eligibleCount: 0, cancelledCount: 0, observedRate: null, sourceDigest: null,
    cohortDigest: null, sourceAuthenticated: false });
  expect((await request(application({ read: stale }).app)
    .get(`/cohorts/commercial-booking-withdrawals/${COHORT}`)).body.data)
    .toMatchObject({ state: 'source_stale', sourceAuthenticated: false,
      observedRate: null, probabilityCalibrated: false });
});

test('rejects poison, weak identities, invalid instants and malformed guarded results', async () => {
  const { app, pool } = application();
  for (const body of [
    { cutoffAt: CUTOFF, horizonEndsAt: HORIZON, organizationId: ORG },
    { cutoffAt: '2026-02-30T00:00:00.000000Z', horizonEndsAt: HORIZON },
    { cutoffAt: HORIZON, horizonEndsAt: CUTOFF },
  ]) expect((await request(app).post('/cohorts/commercial-booking-withdrawals')
    .set('Idempotency-Key', KEY).send(body)).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
  expect((await request(app).get('/cohorts/commercial-booking-withdrawals/not-a-uuid')).status).toBe(400);

  const poisoned = application({ read: cohort({ sourceCoverageComplete: true,
    privateMembers: [{ customerName: 'must not leak' }] }) });
  const response = await request(poisoned.app)
    .get(`/cohorts/commercial-booking-withdrawals/${COHORT}`);
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toContain('must not leak');
});

test('maps guarded access, contention, replay and database failure without leaking details', async () => {
  const member = application({ role: 'member', databaseError: { code: '42501' } });
  expect((await request(member.app).get(`/cohorts/commercial-booking-withdrawals/${COHORT}`)).status)
    .toBe(403);
  const busy = application({ databaseError: { code: '55P03', detail: 'private lock' } });
  const busyResponse = await request(busy.app)
    .get(`/cohorts/commercial-booking-withdrawals/${COHORT}`);
  expect(busyResponse.status).toBe(409);
  expect(JSON.stringify(busyResponse.body)).not.toContain('private lock');
  const replay = application({ captured: { cohort: cohort(), replayed: true } });
  const replayResponse = await request(replay.app).post('/cohorts/commercial-booking-withdrawals')
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY)
    .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
  expect(replayResponse.status).toBe(200);
  expect(replayResponse.headers['idempotency-replayed']).toBe('true');
});

test('captures the scheduling-owned cancellation cohort through its distinct authority', async () => {
  const { app, client } = application({ captured: {
    cohort: scheduleCohort(), replayed: false } });
  const response = await request(app).post('/cohorts/schedule-booking-cancellations')
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({
    targetKey: 'demand.booking_cancellation.v1',
    sourceAuthority: 'northstar_human_approved_schedule_history',
    state: 'descriptive_only', sourceAuthenticated: true,
    sourceCoverageComplete: false, offPlatformCoverageVerified: false,
    providerCoverageVerified: false, probabilityCalibrated: false,
    forecastIssued: false, paidNumericServing: false });
  expect(client.query.mock.calls[3][0]).toContain(
    'canonical_forecast_schedule_booking_cancellation_cohort_capture');
});

test('reads schedule receipts without accepting commercial or private result poison', async () => {
  const { app } = application({ read: scheduleCohort() });
  expect((await request(app)
    .get(`/cohorts/schedule-booking-cancellations/${COHORT}`)).status).toBe(200);
  const wrongAuthority = application({ read: cohort() });
  expect((await request(wrongAuthority.app)
    .get(`/cohorts/schedule-booking-cancellations/${COHORT}`)).status).toBe(503);
  const privatePoison = application({ read: scheduleCohort({
    memberReceipts: [{ appointmentId: COHORT }] }) });
  expect((await request(privatePoison.app)
    .get(`/cohorts/schedule-booking-cancellations/${COHORT}`)).status).toBe(503);
});

test('captures first accepted bookings through the scheduling-owned authority', async () => {
  const { app, client } = application({ captured: {
    cohort: bookingTransitionCohort(), replayed: false } });
  const response = await request(app).post('/cohorts/schedule-bookings')
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({
    targetKey: 'demand.booking_transition.v1', eligibleCount: 3,
    bookedCount: 1, observedRate: '0.333333',
    sourceAuthority: 'northstar_canonical_opportunity_and_human_approved_schedule_history',
    sourceAuthenticated: true, sourceCoverageComplete: false,
    offPlatformCoverageVerified: false, providerCoverageVerified: false,
    probabilityCalibrated: false, forecastIssued: false,
    paidNumericServing: false, replayed: false });
  expect(client.query.mock.calls[3][0]).toContain(
    'canonical_forecast_schedule_booking_transition_cohort_capture');
});

test('rejects booking-transition request and private result poison', async () => {
  const { app, pool } = application();
  expect((await request(app).post('/cohorts/schedule-bookings')
    .set('Idempotency-Key', KEY).send({ cutoffAt: CUTOFF,
      horizonEndsAt: HORIZON, organizationId: ORG })).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
  const poisoned = application({ read: bookingTransitionCohort({
    memberReceipts: [{ opportunityId: OPPORTUNITY }] }) });
  expect((await request(poisoned.app)
    .get(`/cohorts/schedule-bookings/${COHORT}`)).status).toBe(503);
});

test('records and reads tenant-private human-reviewed lead state', async () => {
  const { app, client } = application();
  const created = await request(app)
    .post(`/cohorts/lead-qualification-sources/${OPPORTUNITY}/reviews`)
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ action: 'observe', state: 'open', effectiveAt: CUTOFF,
      reason: 'Owner reviewed the lead state.' });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ replayed: false,
    review: { opportunityId: OPPORTUNITY, state: 'open',
      sourceAuthority: 'northstar_human_reviewed_lead_state' } });
  expect(client.query.mock.calls[3][0]).toContain('canonical_lead_state_review_mutate');
  expect(client.query.mock.calls[3][1]).toEqual([ORG, USER, 'owner', SESSION,
    'validated-csrf', KEY, OPPORTUNITY, 'observe', 'open', CUTOFF,
    'Owner reviewed the lead state.']);
  const readResponse = await request(application().app)
    .get(`/cohorts/lead-qualification-sources/${OPPORTUNITY}/reviews`);
  expect(readResponse.status).toBe(200);
  expect(readResponse.body.data).toMatchObject({ total: 1, truncated: false,
    current: { opportunityId: OPPORTUNITY, state: 'open' } });
});

test('finalizes only the narrow reviewed source and rejects result poison', async () => {
  const { app } = application();
  const created = await request(app).post('/cohorts/lead-qualification-sources/finalizations')
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ recordedThrough: HORIZON,
      reason: 'Owner reviewed the bounded source through the ended horizon.' });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ replayed: false,
    finalization: { id: FINALIZATION, recordedThrough: HORIZON,
      sourceHighWaterOrder: 2 } });
  const poisoned = application({ finalizationRead: qualificationFinalization({
    privateLeadIds: [OPPORTUNITY] }) });
  expect((await request(poisoned.app)
    .get('/cohorts/lead-qualification-sources/finalizations/current')).status).toBe(503);
});

test('captures qualification transitions without presenting a calibrated probability', async () => {
  const value = qualificationCohort();
  const { app, client } = application({ captured: { cohort: value, replayed: false } });
  const response = await request(app).post('/cohorts/lead-qualifications')
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({
    targetKey: 'demand.qualification_transition.v1', eligibleCount: 3,
    qualifiedCount: 1, observedRate: '0.333333',
    sourceAuthority: 'northstar_human_reviewed_lead_state',
    sourceAuthenticated: true, sourceCoverageComplete: false,
    offPlatformCoverageVerified: false, providerCoverageVerified: false,
    probabilityCalibrated: false, forecastIssued: false,
    paidNumericServing: false, replayed: false });
  expect(client.query.mock.calls[3][0]).toContain(
    'canonical_forecast_lead_qualification_cohort_capture');
  const poisoned = application({ read: qualificationCohort({
    sourceCoverageComplete: true }) });
  expect((await request(poisoned.app)
    .get(`/cohorts/lead-qualifications/${COHORT}`)).status).toBe(503);
});

test('rejects lead-source poison before touching PostgreSQL', async () => {
  const { app, pool } = application();
  expect((await request(app)
    .post(`/cohorts/lead-qualification-sources/${OPPORTUNITY}/reviews`)
    .set('Idempotency-Key', KEY).send({ action: 'observe', state: 'qualified',
      effectiveAt: '2026-02-30T00:00:00.000000Z', reason: 'bad' })).status).toBe(400);
  expect((await request(app).post('/cohorts/lead-qualification-sources/finalizations')
    .set('Idempotency-Key', KEY).send({ recordedThrough: HORIZON,
      reason: 'ok', organizationId: ORG })).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});

test('records, finalizes and reads tenant-private accepted estimate-request history', async () => {
  const { app, client } = application();
  const created = await request(app)
    .post(`/cohorts/estimate-request-sources/${OPPORTUNITY}/reviews`)
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ action: 'observe', state: 'open', effectiveAt: CUTOFF,
      reason: 'Owner reviewed the accepted estimate request state.' });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ replayed: false,
    review: { opportunityId: OPPORTUNITY, state: 'open',
      sourceAuthority: 'northstar_human_reviewed_estimate_request_state' } });
  expect(client.query.mock.calls[3][0]).toContain(
    'canonical_estimate_request_state_review_mutate');

  const history = await request(application().app)
    .get(`/cohorts/estimate-request-sources/${OPPORTUNITY}/reviews`);
  expect(history.status).toBe(200);
  expect(history.body.data).toMatchObject({ total: 1, truncated: false,
    current: { opportunityId: OPPORTUNITY, state: 'open' } });

  const finalized = await request(application().app)
    .post('/cohorts/estimate-request-sources/finalizations')
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ recordedThrough: HORIZON,
      reason: 'Owner finalized the bounded estimate-request source.' });
  expect(finalized.status).toBe(201);
  expect(finalized.body.data.finalization).toMatchObject({ id: FINALIZATION,
    sourceHighWaterOrder: 2 });
});

test('captures accepted estimate-request transitions as descriptive-only evidence', async () => {
  const value = estimateRequestCohort();
  const { app, client } = application({ captured: { cohort: value, replayed: false } });
  const response = await request(app).post('/cohorts/estimate-requests')
    .set('X-CSRF-Token', 'validated-csrf').set('Idempotency-Key', KEY)
    .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({
    targetKey: 'demand.estimate_request_transition.v1', eligibleCount: 3,
    requestedCount: 1, observedRate: '0.333333',
    sourceAuthority: 'northstar_human_reviewed_estimate_request_state',
    sourceAuthenticated: true, sourceCoverageComplete: false,
    offPlatformCoverageVerified: false, providerCoverageVerified: false,
    probabilityCalibrated: false, forecastIssued: false,
    paidNumericServing: false, replayed: false });
  expect(client.query.mock.calls[3][0]).toContain(
    'canonical_forecast_estimate_request_cohort_capture');
  const poisoned = application({ read: estimateRequestCohort({
    sourceCoverageComplete: true }) });
  expect((await request(poisoned.app)
    .get(`/cohorts/estimate-requests/${COHORT}`)).status).toBe(503);
});

test('rejects estimate-request source poison before touching PostgreSQL', async () => {
  const { app, pool } = application();
  expect((await request(app)
    .post(`/cohorts/estimate-request-sources/${OPPORTUNITY}/reviews`)
    .set('Idempotency-Key', KEY).send({ action: 'observe', state: 'requested',
      effectiveAt: '2026-02-30T00:00:00.000000Z', reason: 'bad' })).status).toBe(400);
  expect((await request(app).post('/cohorts/estimate-request-sources/finalizations')
    .set('Idempotency-Key', KEY).send({ recordedThrough: HORIZON,
      reason: 'ok', organizationId: ORG })).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});
