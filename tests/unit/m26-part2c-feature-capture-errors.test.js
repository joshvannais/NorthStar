'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createForecastFeaturesRouter } = require('../../src/routes/forecastFeatures');

describe('Mission 26 Part 2C capture errors', () => {
  for (const [code, category, message] of [
    ['54000', 'FORECAST_SOURCE_CAPACITY', 'There is too much history to capture safely.'],
    ['55P03', 'FORECAST_SOURCE_BUSY', 'Forecast source is busy. Try again shortly.'],
    ['57014', 'FORECAST_SOURCE_BUSY', 'Forecast source is busy. Try again shortly.'],
  ]) {
    test(`${code} remains distinguishable and rolls back`, async () => {
      const organizationId = crypto.randomUUID();
      const actorUserId = crypto.randomUUID();
      const authSessionId = crypto.randomUUID();
      const queries = [];
      const client = { query: async sql => {
        queries.push(sql);
        if (sql.startsWith('SELECT public.canonical_forecast_estimate_decision_snapshot_capture')) {
          const error = new Error('Synthetic database failure');
          error.code = code;
          throw error;
        }
        return { rows: [] };
      }, release: jest.fn() };
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
        captureThrottle: (_req, _res, next) => next(),
      }));
      const response = await request(app)
        .post('/api/v1/forecast/features/approved-estimate-stock/snapshots')
        .set('Idempotency-Key', crypto.randomUUID()).send({});
      expect(response.status).toBe(code === '57014' ? 503 : 409);
      expect(response.body.error).toMatchObject({ category, message });
      expect(queries).toEqual(expect.arrayContaining([
        "SET LOCAL statement_timeout = '10000ms'",
        "SET LOCAL lock_timeout = '2000ms'", 'ROLLBACK',
      ]));
      expect(client.release).toHaveBeenCalledTimes(1);
    });
  }
});
