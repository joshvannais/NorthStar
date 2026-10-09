'use strict';

jest.mock('../../src/forecasting/forecastRunRepository', () => ({
  currentness: jest.fn(), list: jest.fn(), compare: jest.fn(),
  capture: jest.fn(), controlledRerun: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const repository = require('../../src/forecasting/forecastRunRepository');
const { createForecastRunsRouter } = require('../../src/routes/forecastRuns');

const organizationId = '55555555-5555-4555-8555-555555555555';
const actorUserId = '66666666-6666-4666-8666-666666666666';
const authSessionId = '77777777-7777-4777-8777-777777777777';

function pass(req, _res, next) {
  req.tenantContext = { organizationId, userId: actorUserId };
  req.userRole = 'owner'; req.authSession = { id: authSessionId }; next();
}
function app() {
  const value = express(); value.use(express.json());
  value.use('/api/v1/forecast/runs', createForecastRunsRouter({
    poolProvider: () => ({ marker: 'pool' }), auth: pass,
    readPermission: pass, updatePermission: pass,
    throttle: (_req, _res, next) => next(),
  }));
  return value;
}

beforeEach(() => jest.clearAllMocks());

test('GET currentness resolves actor and tenant server-side and stays private no-store', async () => {
  repository.currentness.mockResolvedValue({
    version: 'm26-forecast-run-currentness-v1', state: 'unavailable',
    reason: 'unsupported_source_currentness', reasons: ['source_unknown'],
    runId: null, runDigest: null, adviceDisplayAuthorized: false,
    digest: '8'.repeat(64),
  });
  const response = await request(app()).get('/api/v1/forecast/runs/currentness');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body.data).toMatchObject({ state: 'unavailable',
    reason: 'unsupported_source_currentness', runId: null, runDigest: null });
  expect(repository.currentness).toHaveBeenCalledWith({ marker: 'pool' }, {
    organizationId, actorUserId, actorAccessRole: 'owner', authSessionId,
  });
});

test('GET currentness rejects caller query claims before repository access', async () => {
  const response = await request(app()).get(
    '/api/v1/forecast/runs/currentness?sourceStatus=current');
  expect(response.status).toBe(400);
  expect(repository.currentness).not.toHaveBeenCalled();
});
