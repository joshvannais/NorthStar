'use strict';

const express = require('express');
const request = require('supertest');
const { createForecastPriceHistoryRouter } =
  require('../../src/routes/forecastPriceHistory');
const { hasPermission } = require('../../src/auth/permissions');
const { getLimitConfig } = require('../../src/middleware/rateLimit');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT = '44444444-4444-4444-8444-444444444444';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-price-history-request-1';

function application({ role = 'owner', source, readPosition } = {}) {
  const app = express();
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
    if (sql.includes('snapshot_capture')) return { rows: [{ value: source || {
      snapshot: { id: SNAPSHOT, organizationId: ORG,
        asOf: '2026-09-22T22:00:00.000000Z', sourceSnapshotDigest: DIGEST,
        eventCount: 1, events: [{ privateCustomerName: 'must not leak' }] },
      replayed: false,
    } }] };
    return { rows: [] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  app.use('/history', createForecastPriceHistoryRouter({ auth,
    throttle: (_req, _res, next) => next(),
    captureThrottle: (_req, _res, next) => next(), poolProvider: () => pool,
    readPosition: readPosition || jest.fn(async () => ({ state: 'unavailable',
      reason: 'source_changed', forecastIssued: false })) }));
  return { app, pool, client };
}

test('forecast permission is owner/admin only and independent of learning', () => {
  expect(hasPermission('owner', 'forecast', 'read')).toBe(true);
  expect(hasPermission('admin', 'forecast', 'update')).toBe(true);
  expect(hasPermission('member', 'forecast', 'read')).toBe(false);
  expect(hasPermission('viewer', 'forecast', 'read')).toBe(false);
  expect(getLimitConfig('forecast-source-capture', 'enterprise'))
    .toEqual({ limit: 4, window: 60 * 60 * 1000 });
});

test('capture uses server tenant/session, emits minimized historical receipt, and commits', async () => {
  const { app, client } = application();
  const response = await request(app).post('/history/snapshots')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'server-validated-token')
    .send({});
  expect(response.status).toBe(201);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body.data).toMatchObject({ state: 'historical_source_only',
    snapshotId: SNAPSHOT, forecastIssued: false, bookedWorkMeasured: false,
    earnedRevenueMeasured: false, collectedCashMeasured: false });
  expect(JSON.stringify(response.body)).not.toContain('privateCustomerName');
  expect(client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN ISOLATION LEVEL SERIALIZABLE',
    'SELECT public.canonical_forecast_price_event_snapshot_capture($1,$2,$3,$4,$5,$6) value',
    'COMMIT',
  ]);
  expect(client.query.mock.calls[1][1]).toEqual([
    ORG, USER, 'owner', SESSION, 'server-validated-token', KEY,
  ]);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('member denial and caller-supplied authority never reach persistence', async () => {
  const member = application({ role: 'member' });
  expect((await request(member.app).post('/history/snapshots')
    .set('Idempotency-Key', KEY).send({})).status).toBe(403);
  expect(member.pool.connect).not.toHaveBeenCalled();
  const owner = application();
  expect((await request(owner.app).post('/history/snapshots')
    .set('Idempotency-Key', KEY).send({ organizationId: ORG })).status).toBe(400);
  expect(owner.pool.connect).not.toHaveBeenCalled();
});

test('invalid guarded receipt rolls back and never returns source events', async () => {
  const { app, client } = application({ source: {
    snapshot: { id: SNAPSHOT, organizationId: USER, events: ['secret'] },
    replayed: false,
  } });
  const response = await request(app).post('/history/snapshots')
    .set('Idempotency-Key', KEY).send({});
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toContain('secret');
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('historical read passes only server identity and returns unavailable without booking claim', async () => {
  const readPosition = jest.fn(async () => ({ state: 'unavailable',
    reason: 'source_changed', forecastIssued: false }));
  const { app, pool } = application({ readPosition });
  const response = await request(app)
    .get(`/history/snapshots/${SNAPSHOT}/approved-flow`)
    .query({ startsAt: '2026-09-01T00:00:00.000000Z',
      endsAt: '2026-09-22T22:00:00.000000Z', currency: 'USD' });
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ state: 'unavailable',
    reason: 'source_changed', forecastIssued: false });
  expect(readPosition).toHaveBeenCalledWith({ pool, actor: {
    organizationId: ORG, actorUserId: USER, authSessionId: SESSION,
    actorAccessRole: 'owner' }, snapshotId: SNAPSHOT,
  window: { startsAt: '2026-09-01T00:00:00.000000Z',
    endsAt: '2026-09-22T22:00:00.000000Z' }, currency: 'USD' });
  expect((await request(app).get(`/history/snapshots/${SNAPSHOT}/approved-flow`)
    .query({ startsAt: '2026-09-01T00:00:00.000000Z',
      endsAt: '2026-09-22T22:00:00.000000Z', currency: 'USD',
      organizationId: USER })).status).toBe(400);
  expect(readPosition).toHaveBeenCalledTimes(1);
});
