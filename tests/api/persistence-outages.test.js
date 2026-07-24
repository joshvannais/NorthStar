'use strict';

jest.mock('../../src/db', function () {
  return {
    isAvailable: jest.fn(function () { return false; }),
    query: jest.fn(function () {
      throw new Error('Database query must not run while persistence is unavailable');
    })
  };
});

jest.mock('../../src/audit/client', function () {
  return {
    record: jest.fn(function () { return Promise.resolve(); })
  };
});

const express = require('express');
const request = require('supertest');
const dashboardRouter = require('../../src/routes/dashboard');
const publicApiRouter = require('../../src/routes/publicApi');
const { generateToken } = require('../../src/auth/middleware');
const { errorHandler, normalizeErrorResponses } = require('../../src/middleware/errorHandler');

function tenantContext(req, _res, next) {
  req.user = { id: 'outage-user', sub: 'outage-user', name: 'Outage User' };
  req.orgId = 'outage-org';
  req.userRole = 'owner';
  req.tenantContext = Object.freeze({
    userId: 'outage-user',
    organizationId: 'outage-org',
    role: 'owner'
  });
  req.correlationId = 'outage-request';
  next();
}

function appFor(router) {
  const app = express();
  app.use(express.json());
  app.use(tenantContext);
  app.use(normalizeErrorResponses);
  app.use(router);
  app.use(errorHandler);
  return app;
}

function expectOutage(response) {
  expect(response.status).toBe(503);
  expect(response.body.error.code).toBe('persistence_unavailable');
  expect(response.body.error.message).toBe('Required persistence is temporarily unavailable.');
  expect(JSON.stringify(response.body)).not.toMatch(/\[\]|total.?0|zero records/i);
}

const outageToken = generateToken({ id: 'outage-user', email: 'outage@test.local' });
function get(app, path) {
  return request(app).get(path).set('Authorization', 'Bearer ' + outageToken);
}

describe('required PostgreSQL outage responses', function () {
  const dashboardApp = appFor(dashboardRouter);
  const publicApp = appFor(publicApiRouter);

  test.each([
    '/dashboard/summary',
    '/dashboard/kpis',
    '/leads',
    '/leads/missing',
    '/calls',
    '/calendar/upcoming'
  ])('dashboard required-persistence read returns normalized 503: %s', async function (path) {
    expectOutage(await get(dashboardApp, path));
  });

  test.each([
    '/calls',
    '/dashboard/brief',
    '/dashboard/kpis',
    '/dashboard/revenue',
    '/dashboard/trends',
    '/dashboard/coach',
    '/appointments'
  ])('public API required-persistence read returns normalized 503: %s', async function (path) {
    expectOutage(await get(publicApp, path));
  });
});
