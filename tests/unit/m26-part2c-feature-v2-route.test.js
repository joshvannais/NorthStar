'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createForecastFeaturesRouter } = require('../../src/routes/forecastFeatures');

const instant = '2026-10-02T10:00:00.000000Z';
const epoch = '2026-10-01T00:00:00.000000Z';

function application(databaseValue) {
  const organizationId = crypto.randomUUID();
  const actorUserId = crypto.randomUUID();
  const authSessionId = crypto.randomUUID();
  const queries = [];
  const client = { query: jest.fn(async sql => {
    queries.push(sql);
    if (sql.startsWith('SELECT public.canonical_forecast_approved_estimate_v2_')) {
      return { rows: [{ value: typeof databaseValue === 'function' ?
        databaseValue({ organizationId }) : databaseValue,
      evaluated_at: instant }] };
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
  return { app, queries };
}

function snapshot(organizationId, sources = []) {
  return { id: crypto.randomUUID(), version: 'm26-approved-estimate-asof-v2',
    organizationId, asOf: instant, capturedAt: instant,
    purposeKey: 'forecast_pipeline', targetKey: 'pipeline.approved_estimates',
    sources, sourceCount: sources.length, sourceSnapshotDigest: 'a'.repeat(64),
    coverage: { state: 'complete', scope: 'northstar_m24_decision_ledger',
      startsAt: epoch, providerCoverageVerified: false,
      wholeBusinessCoverageVerified: false },
    historicalBoundary: 'Exact immutable NorthStar M24 state at capture; no arbitrary earlier cutoff or off-platform coverage.' };
}

describe('Mission 26 Part 2C target-complete feature HTTP boundary', () => {
  test('captures a complete-zero registered v2 feature without issuing a forecast', async () => {
    const context = application(({ organizationId }) => ({ state: 'complete',
      snapshot: snapshot(organizationId), replayed: false, sourceCurrent: true }));
    const response = await request(context.app)
      .post('/api/v1/forecast/features/approved-estimate-stock/v2/features')
      .set('Idempotency-Key', crypto.randomUUID()).send({});
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      version: 'm26-approved-estimate-stock-feature-v2',
      sourceAuthenticated: true, targetComplete: true, sourceCurrent: true,
      eligibleForForecast: false, forecastIssued: false,
      feature: { contractVersion: 'm26-feature-value-v2', state: 'known',
        amount: '0', latestSourceRecordedAt: null,
        unit: { key: 'count', currency: null, scale: 0 } } });
    expect(context.queries).toContain('COMMIT');
  });

  test('returns an exact missing feature when complete selected-source coverage is absent',
    async () => {
      const context = application({ state: 'unavailable', reason: 'legacy_order_gap',
        snapshot: null, replayed: false });
      const response = await request(context.app)
        .post('/api/v1/forecast/features/approved-estimate-stock/v2/features')
        .set('Idempotency-Key', crypto.randomUUID()).send({});
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ success: false,
        error: { category: 'FORECAST_SOURCE_UNAVAILABLE' },
        data: { sourceAuthenticated: false, targetComplete: false,
          feature: { state: 'missing', amount: null, reason: 'legacy_order_gap',
            sourceSnapshotDigest: null } } });
      expect(context.queries).toContain('COMMIT');
    });

  test('reads a stale complete-zero receipt with no invented source time', async () => {
    const receiptId = crypto.randomUUID();
    const context = application(({ organizationId }) => {
      const value = snapshot(organizationId); value.id = receiptId;
      return { snapshot: value, state: 'stale', sourceCurrent: false,
        eligibleForForecast: false, forecastIssued: false };
    });
    const response = await request(context.app)
      .get(`/api/v1/forecast/features/approved-estimate-stock/v2/features/${receiptId}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ sourceCurrent: false,
      feature: { state: 'stale', amount: null, reason: 'source_changed',
        latestSourceRecordedAt: null }, eligibleForForecast: false,
      forecastIssued: false });
  });

  test('rejects malformed identifiers before touching the database', async () => {
    const context = application(null);
    const response = await request(context.app)
      .get('/api/v1/forecast/features/approved-estimate-stock/v2/features/not-a-uuid');
    expect(response.status).toBe(400);
    expect(context.queries).toHaveLength(0);
  });
});
