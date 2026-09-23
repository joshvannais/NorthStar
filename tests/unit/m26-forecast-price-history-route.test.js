'use strict';

const express = require('express');
const crypto = require('node:crypto');
const request = require('supertest');
const { createForecastPriceHistoryRouter } =
  require('../../src/routes/forecastPriceHistory');
const { hasPermission } = require('../../src/auth/permissions');
const { getLimitConfig, rateLimit } = require('../../src/middleware/rateLimit');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT = '44444444-4444-4444-8444-444444444444';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-price-history-request-1';

function application({ role = 'owner', source, readPosition,
  orderedSource, orderedRead } = {}) {
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
    if (sql.includes('ordered_capture')) {
      if (orderedSource instanceof Error) throw orderedSource;
      return { rows: [{ value: orderedSource || { snapshot: {
        id: SNAPSHOT, version: 'm26-price-ordered-source-v1', organizationId: ORG,
        capturedAt: '2026-09-22T22:00:00.000000Z',
        scope: 'northstar_m24_approved_price_decisions',
        sourceSnapshotDigest: DIGEST, eventCount: 0, events: [],
        wholeBusinessCoverageVerified: false, forecastIssued: false,
      }, replayed: false } }] };
    }
    if (sql.includes('ordered_read')) return { rows: [{ value: orderedRead || {
      snapshot: { id: SNAPSHOT, version: 'm26-price-ordered-source-v1',
        organizationId: ORG, capturedAt: '2026-09-22T22:00:00.000000Z',
        scope: 'northstar_m24_approved_price_decisions',
        sourceSnapshotDigest: DIGEST, eventCount: 0, events: [] },
      state: 'current', sourceOrderCurrent: true,
      coverageStartsAt: '2026-09-22T22:00:00.000000Z',
      firstReceiptId: SNAPSHOT, calendarPeriodVerified: false,
      eligibleForForecast: false, wholeBusinessCoverageVerified: false,
      forecastIssued: false, currentHighWaterOrder: 997,
    } }] };
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

test('capture rate limit reports its actual one-hour window', async () => {
  // Use one stable key for this request group while isolating it from other tests.
  const fixed = crypto.randomUUID();
  const limited = express();
  limited.get('/capture', rateLimit('forecast-source-capture', () => fixed),
    (_req, res) => res.sendStatus(204));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    expect((await request(limited).get('/capture')).status).toBe(204);
  }
  const fifth = await request(limited).get('/capture');
  expect(fifth.status).toBe(429);
  expect(fifth.body.error.details).toMatchObject({ limit: 4, window: '1h' });
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

test('ordered receipt route emits only safe metadata and uses fresh read-committed transactions',
  async () => {
    const { app, client } = application({ orderedSource: { snapshot: {
      id: SNAPSHOT, version: 'm26-price-ordered-source-v1', organizationId: ORG,
      capturedAt: '2026-09-22T22:00:00.000000Z',
      scope: 'northstar_m24_approved_price_decisions',
      sourceSnapshotDigest: DIGEST, eventCount: 1,
      events: [{ decisionId: USER, sourceOrder: 997 }],
      highWaterOrder: 997, digestNonce: SESSION,
      wholeBusinessCoverageVerified: false, forecastIssued: false,
    }, replayed: false } });
    const captured = await request(app).post('/history/ordered-snapshots')
      .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'server-validated-token')
      .send({});
    expect(captured.status).toBe(201);
    expect(captured.body.data).toMatchObject({ state: 'source_order_receipt_only',
      eventCount: 1, calendarPeriodVerified: false, forecastIssued: false });
    expect(JSON.stringify(captured.body)).not.toMatch(/sourceOrder|highWaterOrder|digestNonce/);
    expect(client.query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
      'COMMIT',
    ]);
    const readback = await request(app).get(`/history/ordered-snapshots/${SNAPSHOT}`);
    expect(readback.status).toBe(200);
    expect(readback.body.data).toMatchObject({ state: 'current',
      sourceOrderCurrent: true, eligibleForForecast: false, forecastIssued: false });
    expect(JSON.stringify(readback.body)).not.toMatch(/highWaterOrder|digestNonce/);
  });

test('ordered receipt route fails closed on a poisoned source and reports a busy fence',
  async () => {
    const poisoned = application({ orderedSource: { snapshot: {
      id: SNAPSHOT, organizationId: USER, sourceSnapshotDigest: DIGEST,
      events: [{ privatePrice: 'do-not-leak' }], eventCount: 1,
    }, replayed: false } });
    const response = await request(poisoned.app).post('/history/ordered-snapshots')
      .set('Idempotency-Key', KEY).send({});
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('do-not-leak');
    expect(poisoned.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');

    const busyError = new Error('internal lock detail');
    busyError.code = '55P03';
    const busy = application({ orderedSource: busyError });
    const retry = await request(busy.app).post('/history/ordered-snapshots')
      .set('Idempotency-Key', KEY).send({});
    expect(retry.status).toBe(409);
    expect(retry.body.error).toMatchObject({ category: 'FORECAST_SOURCE_BUSY',
      message: 'Forecast history is busy. Try again shortly.' });
    expect(JSON.stringify(retry.body)).not.toContain('internal lock detail');
  });

test('ordered month route reads server-guarded evidence but exposes only unverified diagnostic',
  async () => {
    const orderedRead = {
      snapshot: { id: SNAPSHOT, version: 'm26-price-ordered-source-v1',
        organizationId: ORG, capturedAt: '2026-12-02T00:00:00.000000Z',
        scope: 'northstar_m24_approved_price_decisions',
        sourceSnapshotDigest: DIGEST, eventCount: 0, events: [],
        wholeBusinessCoverageVerified: false, forecastIssued: false,
        digestNonce: SESSION, highWaterOrder: 997 },
      state: 'current', sourceOrderCurrent: true,
      coverageStartsAt: '2026-10-01T00:00:00.000000Z',
      firstReceiptId: SNAPSHOT, calendarPeriodVerified: false,
      eligibleForForecast: false, wholeBusinessCoverageVerified: false,
      forecastIssued: false,
    };
    // The readback-shaped fixture omits private fields that the SQL projection
    // itself never returns; a poisoned shape must fail closed.
    const poisoned = application({ orderedRead });
    const path = `/history/ordered-snapshots/${SNAPSHOT}/month-candidate`;
    const month = { startsAt: '2026-11-01T00:00:00.000000Z',
      endsAt: '2026-12-01T00:00:00.000000Z' };
    const rejected = await request(poisoned.app).get(path).query(month);
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({ state: 'unavailable',
      reason: 'invalid_guarded_source', sourceMonthVerified: false,
      sourceCapturedAt: null, sourceSnapshotDigest: null,
      sourceOrderUtcWindowObservedAsOfCapture: false,
      sourceAuthenticated: false,
      eligibleForForecast: false, forecastIssued: false });
    expect(JSON.stringify(rejected.body)).not.toMatch(/digestNonce|highWaterOrder/);

    delete orderedRead.snapshot.digestNonce;
    delete orderedRead.snapshot.highWaterOrder;
    const { app, client, pool } = application({ orderedRead });
    const response = await request(app).get(path).query(month);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ state: 'candidate_window_checks_passed',
      inputOrderTimestampDecisionCount: 0, candidateWindowChecksPassed: true,
      sourceCapturedAt: '2026-12-02T00:00:00.000000Z',
      sourceSnapshotDigest: DIGEST,
      sourceOrderUtcWindowObservedAsOfCapture: true,
      sourceMonthVerified: false, sourceAuthenticated: true,
      calendarPeriodVerified: false, eligibleForForecast: false,
      wholeBusinessCoverageVerified: false, forecastIssued: false });
    const priced = await request(app).get(path).query({ ...month, currency: 'USD' });
    expect(priced.body.data).toMatchObject({ state: 'candidate_window_checks_passed',
      inputCurrency: 'USD', inputFirstApprovalCount: 0,
      inputFirstApprovalAmount: null, sourceMonthVerified: false,
      eligibleForForecast: false });
    expect((await request(app).get(path).query({ ...month, currency: 'usd' })).status)
      .toBe(400);
    expect((await request(app).get(path).query(month).query('currency[]=USD')).status)
      .toBe(400);
    expect(JSON.stringify(response.body)).not.toMatch(/"events":|"digestNonce":|"sourceOrder":|"highWaterOrder":/);
    expect(client.query.mock.calls.slice(0, 3).map(call => call[0])).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      'SELECT public.canonical_forecast_price_ordered_read($1,$2,$3,$4,$5) value',
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1][1]).toEqual([ORG, USER, 'owner', SESSION, SNAPSHOT]);
    expect((await request(app).get(path).query({ ...month, organizationId: ORG })).status)
      .toBe(400);
    expect((await request(app).get(path).query({ startsAt: '2026-11-02T00:00:00.000000Z',
      endsAt: month.endsAt })).status).toBe(400);
    expect(pool.connect).toHaveBeenCalledTimes(2);
    const member = application({ role: 'member', orderedRead });
    expect((await request(member.app).get(path).query(month)).status).toBe(403);
    expect(member.pool.connect).not.toHaveBeenCalled();
    const stale = application({ orderedRead: { ...orderedRead,
      state: 'stale', sourceOrderCurrent: false } });
    const changed = await request(stale.app).get(path).query(month);
    expect(changed.body.data).toMatchObject({ state: 'unavailable',
      reason: 'source_changed', inputOrderTimestampDecisionCount: null,
      sourceCapturedAt: null, sourceSnapshotDigest: null,
      sourceOrderUtcWindowObservedAsOfCapture: false,
      sourceAuthenticated: false,
      candidateWindowChecksPassed: false, eligibleForForecast: false });
  });
