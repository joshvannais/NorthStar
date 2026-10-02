'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createForecastFeaturesRouter } = require('../../src/routes/forecastFeatures');

const instant = '2026-10-02T05:00:00.000000Z';
const epoch = '2026-10-02T04:00:00.000000Z';

function application(databaseValue) {
  const organizationId = crypto.randomUUID();
  const actorUserId = crypto.randomUUID();
  const authSessionId = crypto.randomUUID();
  const queries = [];
  const client = { query: jest.fn(async (sql) => {
    queries.push(sql);
    if (sql.startsWith('SELECT public.canonical_forecast_approved_estimate_v2_')) {
      return { rows: [{ value: typeof databaseValue === 'function' ?
        databaseValue({ organizationId }) : databaseValue }] };
    }
    return { rows: [] };
  }), release: jest.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/forecast/features', createForecastFeaturesRouter({
    poolProvider: () => ({ connect: async () => client }),
    auth: (req, _res, next) => {
      req.user = { id: actorUserId };
      req.orgId = organizationId;
      req.userRole = 'owner';
      req.tenantContext = { organizationId, userId: actorUserId };
      req.authSession = { id: authSessionId };
      next();
    },
    throttle: (_req, _res, next) => next(),
    captureThrottle: (_req, _res, next) => next(),
  }));
  return { app, organizationId, queries, client };
}

function snapshot(organizationId) {
  return { id: crypto.randomUUID(), version: 'm26-approved-estimate-asof-v2',
    organizationId, asOf: instant, capturedAt: instant,
    purposeKey: 'forecast_pipeline', targetKey: 'pipeline.approved_estimates',
    sources: [], sourceCount: 0, sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', scope: 'northstar_m24_decision_ledger',
      startsAt: epoch, providerCoverageVerified: false,
      wholeBusinessCoverageVerified: false },
    historicalBoundary: 'Exact immutable NorthStar M24 state at capture; no arbitrary earlier cutoff or off-platform coverage.' };
}

describe('Mission 26 Part 2A approved-estimate v2 HTTP boundary', () => {
  test('captures a distinct complete-zero v2 receipt and commits it', async () => {
    const context = application(({ organizationId }) => ({ state: 'complete',
      snapshot: snapshot(organizationId), replayed: false }));
    const response = await request(context.app)
      .post('/api/v1/forecast/features/approved-estimate-stock/v2/snapshots')
      .set('Idempotency-Key', crypto.randomUUID()).send({});
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ state: 'current', sourceCount: 0,
      targetComplete: true, providerCoverageVerified: false,
      wholeBusinessCoverageVerified: false, forecastIssued: false });
    expect(context.queries).toContain('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(context.queries).toContain('COMMIT');
  });

  test('returns truthful unavailable coverage without a successful receipt', async () => {
    const context = application({ state: 'unavailable', reason: 'legacy_order_gap',
      snapshot: null, replayed: false });
    const response = await request(context.app)
      .post('/api/v1/forecast/features/approved-estimate-stock/v2/snapshots')
      .set('Idempotency-Key', crypto.randomUUID()).send({});
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false,
      error: { category: 'FORECAST_SOURCE_UNAVAILABLE' },
      data: { state: 'unavailable', reason: 'legacy_order_gap', snapshotId: null } });
    expect(context.queries).toContain('COMMIT');
  });

  test('reads stale currentness while withholding any forecast', async () => {
    const receiptId = crypto.randomUUID();
    const context = application(({ organizationId }) => {
      const value = snapshot(organizationId); value.id = receiptId;
      return { snapshot: value, state: 'stale', sourceCurrent: false,
        eligibleForForecast: false, forecastIssued: false };
    });
    const response = await request(context.app)
      .get(`/api/v1/forecast/features/approved-estimate-stock/v2/${receiptId}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ state: 'stale',
      reason: 'source_changed', sourceCurrent: false, eligibleForForecast: false,
      forecastIssued: false });
  });

  test('rejects a forged cross-tenant projection and rolls back', async () => {
    const context = application(() => ({ state: 'complete',
      snapshot: snapshot(crypto.randomUUID()), replayed: false }));
    const response = await request(context.app)
      .post('/api/v1/forecast/features/approved-estimate-stock/v2/snapshots')
      .set('Idempotency-Key', crypto.randomUUID()).send({});
    expect(response.status).toBe(503);
    expect(context.queries).toContain('ROLLBACK');
    expect(context.client.release).toHaveBeenCalledTimes(1);
  });
});
