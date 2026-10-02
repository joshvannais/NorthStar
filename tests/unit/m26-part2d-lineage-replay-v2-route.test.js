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
  const client = { query: jest.fn(async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('canonical_forecast_approved_estimate_v2_lineage_replay')) {
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
  return { app, queries };
}

function databasePage(organizationId, snapshotId) {
  return { version: 'm26-approved-estimate-lineage-replay-v2',
    items: [{ snapshot: { id: snapshotId,
      version: 'm26-approved-estimate-asof-v2', organizationId,
      asOf: instant, capturedAt: instant, purposeKey: 'forecast_pipeline',
      targetKey: 'pipeline.approved_estimates', sources: [], sourceCount: 0,
      sourceSnapshotDigest: 'a'.repeat(64), coverage: { state: 'complete',
        scope: 'northstar_m24_decision_ledger', startsAt: epoch,
        providerCoverageVerified: false, wholeBusinessCoverageVerified: false },
      historicalBoundary: 'Exact immutable NorthStar M24 state at capture; no arbitrary earlier cutoff or off-platform coverage.' },
    state: 'current', sourceCurrent: true, eligibleForForecast: false,
    forecastIssued: false }], nextCursor: null, sourceAuthenticated: true,
    targetComplete: true, forecastIssued: false };
}

describe('Mission 26 Part 2D bounded lineage replay HTTP boundary', () => {
  test('reads authenticated bounded pages and discloses no forecast eligibility', async () => {
    const snapshotId = crypto.randomUUID();
    const context = application(({ organizationId }) => databasePage(organizationId, snapshotId));
    const response = await request(context.app)
      .post('/api/v1/forecast/features/approved-estimate-stock/v2/lineage/replay')
      .send({ snapshotIds: [snapshotId], cursor: null, limit: 1 });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ sourceAuthenticated: true,
      targetComplete: true, eligibleForForecast: false, forecastIssued: false,
      results: [{ feature: { state: 'known', amount: '0' } }] });
    expect(context.queries.some(query =>
      query.sql.includes('canonical_forecast_approved_estimate_v2_lineage_replay'))).toBe(true);
    expect(context.queries.some(query => query.sql === 'COMMIT')).toBe(true);
  });

  test('rejects duplicate, oversized and malformed requests before database access', async () => {
    const id = crypto.randomUUID();
    for (const body of [
      { snapshotIds: [id, id], cursor: null, limit: 1 },
      { snapshotIds: new Array(101).fill(null).map(() => crypto.randomUUID()),
        cursor: null, limit: 25 },
      { snapshotIds: [id], cursor: { version: 'wrong', offset: 1,
        requestDigest: 'a'.repeat(64), currentGenerationDigest: 'b'.repeat(64) }, limit: 1 },
      { snapshotIds: [id], cursor: null, limit: 26 },
    ]) {
      const context = application(null);
      const response = await request(context.app)
        .post('/api/v1/forecast/features/approved-estimate-stock/v2/lineage/replay')
        .send(body);
      expect(response.status).toBe(400);
      expect(context.queries).toHaveLength(0);
    }
  });

  test('keeps missing or cross-tenant receipts non-disclosing', async () => {
    const context = application(null);
    const response = await request(context.app)
      .post('/api/v1/forecast/features/approved-estimate-stock/v2/lineage/replay')
      .send({ snapshotIds: [crypto.randomUUID()], cursor: null, limit: 1 });
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toMatch(/amount|digest|sourceCurrent/i);
  });
});
