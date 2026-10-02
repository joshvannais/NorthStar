'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createForecastPriceHistoryRouter } =
  require('../../src/routes/forecastPriceHistory');

function application({ role = 'owner', captureValue, readValue,
  measurementValue } = {}) {
  const organizationId = crypto.randomUUID();
  const actorUserId = crypto.randomUUID();
  const authSessionId = crypto.randomUUID();
  const queries = [];
  const client = { query: jest.fn(async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('evaluation_v2_capture')) return { rows: [{ value:
      captureValue || { state: 'complete_window_evaluation_saved',
        evaluationId: crypto.randomUUID(), revision: 1, previousId: null,
        replayed: false } }] };
    if (sql.includes('measurement_v2')) return { rows: [{ value:
      measurementValue || { state: 'complete_window_measurement_available',
        measurement: { version: 'm26-complete-window-measurement-v2',
          evaluationId: values[4], denominator: { storedOriginCount: 60,
            pairedCount: 60, unsavedOriginCoverageVerified: false },
          descriptiveError: { state: 'descriptive_only', totalAbsolute: '12.00',
            meanAbsolute: '0.200000', meanSigned: '0.000000' },
          intervalCoverage: { state: 'not_applicable',
            reason: 'point_only_target' },
          sampleSufficiency: { state: 'supported_source_descriptive_only' },
          calibration: { state: 'unavailable' },
          drift: { state: 'descriptive_only',
            empiricalDriftVerdictAvailable: false },
          realAccuracyAvailable: false, calibrationAvailable: false,
          realForecastEligible: false } } }] };
    if (sql.includes('evaluation_v2_read')) return { rows: [{ value:
      readValue || { state: 'complete_window_evaluation_available',
        evaluationId: values[4], revision: 1, storedOriginCount: 60,
        pairedCount: 59, missingCount: 1, revokedCount: 0,
        excludedCount: 0, empiricalAccuracyAvailable: false,
        calibrationAvailable: false, realForecastEligible: false } }] };
    return { rows: [] };
  }), release: jest.fn() };
  const app = express();
  app.use(express.json());
  app.use('/history', createForecastPriceHistoryRouter({
    poolProvider: () => ({ connect: async () => client }),
    auth: (req, _res, next) => {
      req.user = { id: actorUserId };
      req.orgId = organizationId;
      req.userRole = role;
      req.tenantContext = { organizationId, userId: actorUserId };
      req.authSession = { id: authSessionId };
      next();
    },
    throttle: (_req, _res, next) => next(),
    evaluationThrottle: (_req, _res, next) => next(),
    completeWindowEvaluationThrottle: (_req, _res, next) => next(),
  }));
  return { app, client, queries, organizationId, actorUserId, authSessionId };
}

describe('Mission 26 Part 3B complete-window v2 HTTP authority', () => {
  test('captures only a server-selected receipt and returns no private amounts', async () => {
    const context = application();
    const response = await request(context.app)
      .post('/history/complete-price-flow-evaluations-v2')
      .set('Idempotency-Key', 'm26-complete-window-0001')
      .set('X-CSRF-Token', 'verified-csrf').send({});
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      state: 'complete_window_evaluation_saved', revision: 1,
      replayed: false, numericalResultsAvailable: false,
      empiricalAccuracyAvailable: false, calibrationAvailable: false,
      realForecastEligible: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/forecastValue|outcomeAmount/);
    const capture = context.queries.find(item =>
      item.sql.includes('evaluation_v2_capture'));
    expect(capture.values).toEqual([context.organizationId,
      context.actorUserId, 'owner', context.authSessionId,
      'verified-csrf', 'm26-complete-window-0001']);
    expect(context.queries.some(item => item.sql === 'COMMIT')).toBe(true);
  });

  test('rejects caller selection or truncation before opening a connection', async () => {
    for (const body of [{ runIds: [crypto.randomUUID()] },
      { windowStart: '2026-01-01T00:00:00.000Z' }, { limit: 1 }]) {
      const context = application();
      const response = await request(context.app)
        .post('/history/complete-price-flow-evaluations-v2')
        .set('Idempotency-Key', 'm26-complete-window-0002').send(body);
      expect(response.status).toBe(400);
      expect(context.queries).toHaveLength(0);
    }
  });

  test('reads only bounded status counts and keeps missing receipts generic', async () => {
    const evaluationId = crypto.randomUUID();
    const available = application();
    const response = await request(available.app)
      .get(`/history/complete-price-flow-evaluations-v2/${evaluationId}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      state: 'complete_window_evaluation_available', storedOriginCount: 60,
      pairedCount: 59, missingCount: 1, realForecastEligible: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/amount|sourceDigest/i);

    const missing = application({ readValue: {
      state: 'complete_window_evaluation_unavailable',
      reason: 'evaluation_not_found',
    } });
    const absent = await request(missing.app)
      .get(`/history/complete-price-flow-evaluations-v2/${evaluationId}`);
    expect(absent.status).toBe(200);
    expect(absent.body.data).toEqual({
      state: 'complete_window_evaluation_unavailable',
      reason: 'evaluation_not_found',
    });
  });

  test('member access is denied before database work', async () => {
    const context = application({ role: 'member' });
    expect((await request(context.app)
      .post('/history/complete-price-flow-evaluations-v2')
      .set('Idempotency-Key', 'm26-complete-window-0003').send({})).status)
      .toBe(403);
    expect((await request(context.app)
      .get(`/history/complete-price-flow-evaluations-v2/${crypto.randomUUID()}`)).status)
      .toBe(403);
    expect((await request(context.app)
      .get(`/history/complete-price-flow-evaluations-v2/${crypto.randomUUID()}/measurement`)).status)
      .toBe(403);
    expect(context.queries).toHaveLength(0);
  });

  test('reads only server-measured aggregate evidence for the exact receipt', async () => {
    const context = application();
    const evaluationId = crypto.randomUUID();
    const response = await request(context.app)
      .get(`/history/complete-price-flow-evaluations-v2/${evaluationId}/measurement`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      state: 'complete_window_measurement_available',
      measurement: {
        evaluationId, denominator: { storedOriginCount: 60, pairedCount: 60,
          unsavedOriginCoverageVerified: false },
        descriptiveError: { state: 'descriptive_only', meanAbsolute: '0.200000' },
        intervalCoverage: { state: 'not_applicable' },
        sampleSufficiency: { state: 'supported_source_descriptive_only' },
        calibration: { state: 'unavailable' },
        realAccuracyAvailable: false, realForecastEligible: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/forecastValue|outcomeAmount/);
    const query = context.queries.find(item => item.sql.includes('measurement_v2'));
    expect(query.values).toEqual([context.organizationId, context.actorUserId,
      'owner', context.authSessionId, evaluationId]);
  });

  test('rejects measurement query inputs and keeps cross-tenant absence generic', async () => {
    const evaluationId = crypto.randomUUID();
    const invalid = application();
    expect((await request(invalid.app)
      .get(`/history/complete-price-flow-evaluations-v2/${evaluationId}/measurement?limit=1`))
      .status).toBe(400);
    expect(invalid.queries).toHaveLength(0);
    const missing = application({ measurementValue: {
      state: 'complete_window_measurement_unavailable',
      reason: 'evaluation_not_found', realAccuracyAvailable: false,
      calibrationAvailable: false, realForecastEligible: false,
    } });
    const response = await request(missing.app)
      .get(`/history/complete-price-flow-evaluations-v2/${evaluationId}/measurement`);
    expect(response.body.data).toEqual({
      state: 'complete_window_measurement_unavailable',
      reason: 'evaluation_not_found', realAccuracyAvailable: false,
      calibrationAvailable: false, realForecastEligible: false,
    });
  });
});
