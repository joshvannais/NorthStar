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

function application({ role = 'owner', captured, read, databaseError } = {}) {
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
    if (sql.includes('_capture')) return { rows: [{ value: captured || {
      cohort: cohort(), replayed: false } }] };
    if (sql.includes('_read')) return { rows: [{ value: read || cohort() }] };
    return { rows: [] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  const bypass = (_req, _res, next) => next();
  app.use('/cohorts', createForecastTransitionCohortsRouter({ auth,
    throttle: bypass, captureThrottle: bypass, poolProvider: () => pool }));
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
