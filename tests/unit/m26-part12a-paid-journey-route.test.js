'use strict';

jest.mock('../../src/forecasting/forecastPaidJourneyRepository', () => ({
  current: jest.fn(), issue: jest.fn(), rerun: jest.fn(), review: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const repository = require('../../src/forecasting/forecastPaidJourneyRepository');
const { createForecastPaidJourneyRouter } = require('../../src/routes/forecastPaidJourney');

const organizationId = '55555555-5555-4555-8555-555555555555';
const actorUserId = '66666666-6666-4666-8666-666666666666';
const authSessionId = '77777777-7777-4777-8777-777777777777';
const runId = '11111111-1111-4111-8111-111111111111';

function pass(req, _res, next) {
  req.tenantContext = { organizationId, userId: actorUserId };
  req.userRole = 'owner'; req.authSession = { id: authSessionId }; next();
}
function app() {
  const value = express(); value.use(express.json());
  value.use('/api/v1/forecast/paid-journey', createForecastPaidJourneyRouter({
    poolProvider: () => ({ marker: 'pool' }), auth: pass,
    readPermission: pass, updatePermission: pass,
    throttle: (_req, _res, next) => next(),
  }));
  return value;
}

beforeEach(() => jest.clearAllMocks());

test('private paid read resolves tenant and actor only from the authenticated session', async () => {
  repository.current.mockResolvedValue({ state: 'unavailable',
    reason: 'approved_price_settings_not_current', run: null, review: null });
  const response = await request(app()).get('/api/v1/forecast/paid-journey');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(repository.current).toHaveBeenCalledWith({ marker: 'pool' }, {
    organizationId, actorUserId, actorAccessRole: 'owner', authSessionId });
  const claimed = await request(app()).get(
    '/api/v1/forecast/paid-journey?organizationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(claimed.status).toBe(400);
  expect(repository.current).toHaveBeenCalledTimes(1);
});

test('issue and review preserve deterministic replay status and server-side actor identity', async () => {
  repository.issue.mockResolvedValue({ state: 'current', replayed: false });
  const body = { expectedSettingsRevision: 1, expectedSettingsDigest: '1'.repeat(64),
    approvedPriceOriginId: '22222222-2222-4222-8222-222222222222',
    reason: 'Synthetic mounted paid journey.' };
  const issued = await request(app()).post('/api/v1/forecast/paid-journey/issue')
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', 'part12a-route-key-0001').send(body);
  expect(issued.status).toBe(201);
  expect(repository.issue).toHaveBeenCalledWith({ marker: 'pool' }, {
    organizationId, actorUserId, actorAccessRole: 'owner', authSessionId,
    csrfToken: 'csrf', idempotencyKey: 'part12a-route-key-0001' }, body);
  repository.issue.mockResolvedValue({ state: 'current', replayed: true });
  const replay = await request(app()).post('/api/v1/forecast/paid-journey/issue')
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', 'part12a-route-key-0001').send(body);
  expect(replay.status).toBe(200);
  expect(replay.headers['idempotency-replayed']).toBe('true');

  repository.review.mockResolvedValue({ state: 'requested', journey: { state: 'current' } });
  const review = await request(app()).post('/api/v1/forecast/paid-journey/review')
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', 'part12a-review-key-0001')
    .send({ marker: 'exact-body' });
  expect(review.status).toBe(201);
  repository.review.mockResolvedValue({ state: 'replay', journey: { state: 'current' } });
  const reviewReplay = await request(app()).post('/api/v1/forecast/paid-journey/review')
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', 'part12a-review-key-0001')
    .send({ marker: 'exact-body' });
  expect(reviewReplay.status).toBe(200);
  expect(reviewReplay.headers['idempotency-replayed']).toBe('true');
});

test('rerun forbids caller payloads and busy/currentness conflicts have truthful mappings', async () => {
  expect((await request(app()).post(`/api/v1/forecast/paid-journey/${runId}/rerun`)
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', 'part12a-rerun-key-0001')
    .send({ currentness: 'caller-claim' })).status).toBe(400);
  expect(repository.rerun).not.toHaveBeenCalled();
  repository.rerun.mockRejectedValue({ code: '55P03' });
  const busy = await request(app()).post(`/api/v1/forecast/paid-journey/${runId}/rerun`)
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', 'part12a-rerun-key-0001')
    .send({});
  expect(busy.status).toBe(503);
  expect(busy.headers['retry-after']).toBe('2');
  expect(busy.body.error.category).toBe('FORECAST_PAID_JOURNEY_BUSY');
  repository.rerun.mockRejectedValue({ code: '40001' });
  const changed = await request(app()).post(`/api/v1/forecast/paid-journey/${runId}/rerun`)
    .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', 'part12a-rerun-key-0001')
    .send({});
  expect(changed.status).toBe(409);
  expect(changed.body.error.category).toBe('FORECAST_PAID_JOURNEY_CHANGED');
});
