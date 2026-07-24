'use strict';

const express = require('express');
const request = require('supertest');

const mockSqlCalls = [];

jest.mock('../../src/db', function () {
  function result(rows) { return Promise.resolve({ rows: rows }); }
  return {
    isAvailable: jest.fn(function () { return true; }),
    query: jest.fn(function (sql, params) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      const values = params || [];
      mockSqlCalls.push({ sql: text, params: values.slice() });

      if (/FROM users WHERE id = \$1/.test(text)) {
        const userId = values[0];
        return result([{
          id: userId,
          organization_id: userId === 'owner-b' ? 'org-b' : 'org-a',
          role: 'owner',
          status: 'active',
        }]);
      }
      if (text === 'SELECT 1') return result([{}]);

      if (/\b(?:FROM|UPDATE|INTO)\s+(?:call_records|leads|crm_contacts)\b/i.test(text)) {
        if (!/organization_id/i.test(text)) {
          return Promise.reject(new Error('Test guard rejected tenant SQL without organization_id'));
        }
        if (!values.includes('org-a') && !values.includes('org-b')) {
          return Promise.reject(new Error('Test guard rejected tenant SQL without the validated organization parameter'));
        }
      }

      if (/UPDATE leads SET status/.test(text)) {
        return result(values[1] === 'owned-lead' ? [{ id: 'owned-lead' }] : []);
      }
      if (/UPDATE call_records SET is_known_contact/.test(text)) {
        return result(values[0] === 'owned-call'
          ? [{ caller_name: 'Owned Caller', caller_phone: '(555) 100-2000' }]
          : []);
      }
      if (/INSERT INTO leads/.test(text)) return result([{ id: 'created-lead' }]);
      if (/INSERT INTO call_records/.test(text)) return result([{ id: 'created-call' }]);
      if (/INSERT INTO crm_contacts/.test(text)) return result([]);
      if (/SELECT id, caller_name as customer_name/.test(text) ||
          /SELECT id, caller_name, caller_phone/.test(text) ||
          /SELECT l\.id, l\.caller_name/.test(text) ||
          /SELECT l\.\*, cr\.transcript/.test(text) ||
          /SELECT created_at FROM call_records/.test(text) ||
          /GROUP BY DATE\(created_at\)/.test(text) ||
          /SELECT DISTINCT service_type/.test(text) ||
          /SELECT id, caller_name, phone, service_type/.test(text)) {
        return result([]);
      }
      return result([{
        c: '0',
        count: '0',
        total: '0',
        won: '0',
        avg: '0',
        r: '0',
        revenue: '0',
        answered: '0',
      }]);
    }),
    getPool: jest.fn(function () { return null; }),
  };
});

jest.mock('../../src/cache/client', function () {
  return {
    buildKey: jest.fn(function () { return Array.prototype.slice.call(arguments).join(':'); }),
    get: jest.fn(function () { return Promise.resolve(null); }),
    set: jest.fn(function () { return Promise.resolve(true); }),
    incr: jest.fn(function () { return Promise.resolve(1); }),
    isAvailable: jest.fn(function () { return false; }),
  };
});

jest.mock('../../src/middleware/rateLimit', function () {
  return { rateLimit: jest.fn(function () { return function (_req, _res, next) { next(); }; }) };
});

jest.mock('../../src/leads/store', function () {
  return {
    getAllLeads: jest.fn(function () { return []; }),
    getLead: jest.fn(function () { return null; }),
    addLead: jest.fn(function (lead) { return Object.assign({ id: 'file-lead' }, lead); }),
    updateLead: jest.fn(function () { return null; }),
    removeLead: jest.fn(function () { return null; }),
  };
});

jest.mock('../../src/routes/voice', function () {
  return jest.requireActual('express').Router();
});

const publicApi = require('../../src/routes/publicApi');
const dashboard = require('../../src/routes/dashboard');
const rawApi = require('../../src/routes/api');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { generateToken } = require('../../src/auth/middleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', publicApi);
  app.use('/api/v1', dashboard);
  app.use('/api', rawApi);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const tokenA = generateToken({ id: 'owner-a', role: 'viewer' });
const tokenB = generateToken({ id: 'owner-b', role: 'viewer' });

function auth(testRequest, token) {
  return testRequest.set('Authorization', 'Bearer ' + (token || tokenA));
}

function tenantQueriesSince(index) {
  return mockSqlCalls.slice(index).filter(function (call) {
    return !/FROM users WHERE id = \$1/.test(call.sql) && call.sql !== 'SELECT 1' &&
      /\b(?:FROM|UPDATE|INTO)\s+(?:call_records|leads|crm_contacts)\b/i.test(call.sql);
  });
}

describe('tenant SQL route authorization matrix', function () {
  beforeEach(function () { mockSqlCalls.length = 0; });

  test.each([
    ['brief', '/api/v1/dashboard/brief'],
    ['KPIs', '/api/v1/dashboard/kpis'],
    ['revenue', '/api/v1/dashboard/revenue'],
    ['trends', '/api/v1/dashboard/trends'],
    ['coach', '/api/v1/dashboard/coach'],
    ['appointments', '/api/v1/appointments'],
    ['status', '/api/v1/dashboard/status'],
    ['calls', '/api/v1/calls'],
    ['summary fallback', '/api/v1/dashboard/summary'],
    ['Calendar upcoming fallback', '/api/v1/calendar/upcoming'],
    ['raw stats', '/api/stats'],
  ])('%s SQL reads use the persisted organization context', async function (_name, path) {
    const start = mockSqlCalls.length;
    const unauthenticated = await request(app).get(path);
    expect(unauthenticated.status).toBe(401);

    const responseA = await auth(request(app).get(path));
    expect(responseA.status).toBe(200);
    const queriesA = tenantQueriesSince(start);
    expect(queriesA.length).toBeGreaterThan(0);
    queriesA.forEach(function (call) {
      expect(call.sql).toMatch(/organization_id/i);
      expect(call.params).toContain('org-a');
    });

    const beforeB = mockSqlCalls.length;
    const responseB = await auth(request(app).get(path), tokenB);
    expect(responseB.status).toBe(200);
    const queriesB = tenantQueriesSince(beforeB);
    expect(queriesB.length).toBeGreaterThan(0);
    queriesB.forEach(function (call) {
      expect(call.sql).toMatch(/organization_id/i);
      expect(call.params).toContain('org-b');
      expect(call.params).not.toContain('org-a');
    });
  });

  test('lead-status mutation scopes its UPDATE and gives identical 404s', async function () {
    const owned = await auth(request(app).patch('/api/v1/leads/owned-lead/status').send({ status: 'contacted' }));
    expect(owned.status).toBe(200);
    for (const id of ['other-tenant-lead', 'unowned-lead', 'missing-lead']) {
      const response = await auth(request(app).patch('/api/v1/leads/' + id + '/status')
        .send({ status: 'contacted' }));
      expect({ status: response.status, body: response.body })
        .toEqual({ status: 404, body: { error: 'Lead not found' } });
    }
    const updates = mockSqlCalls.filter(function (call) { return /UPDATE leads SET status/.test(call.sql); });
    expect(updates).toHaveLength(4);
    updates.forEach(function (call) {
      expect(call.sql).toMatch(/WHERE id = \$2 AND organization_id = \$3 RETURNING id/);
      expect(call.params[2]).toBe('org-a');
    });
  });

  test('mark-known scopes both mutation writes and gives identical 404s', async function () {
    const owned = await auth(request(app).post('/api/v1/calls/owned-call/mark-known'));
    expect(owned.status).toBe(200);
    for (const id of ['other-tenant-call', 'unowned-call', 'missing-call']) {
      const response = await auth(request(app).post('/api/v1/calls/' + id + '/mark-known'));
      expect({ status: response.status, body: response.body })
        .toEqual({ status: 404, body: { error: 'Call not found' } });
    }
    const updates = mockSqlCalls.filter(function (call) {
      return /UPDATE call_records SET is_known_contact/.test(call.sql);
    });
    expect(updates).toHaveLength(4);
    updates.forEach(function (call) {
      expect(call.sql).toMatch(/WHERE id = \$1 AND organization_id = \$2/);
      expect(call.params[1]).toBe('org-a');
    });
    const contactInsert = mockSqlCalls.find(function (call) { return /INSERT INTO crm_contacts/.test(call.sql); });
    expect(contactInsert.params[0]).toBe('org-a');
  });

  test('simulated lead and raw call creation persist validated organization ownership', async function () {
    const simulated = await auth(request(app).post('/api/v1/leads/simulate').send({
      callerName: 'Scoped Lead',
      service: 'Concrete',
    }));
    const recorded = await auth(request(app).post('/api/calls/record').send({
      callerName: 'Scoped Call',
      serviceType: 'Concrete',
    }));
    expect(simulated.status).toBe(200);
    expect(recorded.status).toBe(200);

    const leadInsert = mockSqlCalls.find(function (call) { return /INSERT INTO leads/.test(call.sql); });
    const callInsert = mockSqlCalls.find(function (call) { return /INSERT INTO call_records/.test(call.sql); });
    expect(leadInsert.params[0]).toBe('org-a');
    expect(callInsert.params[0]).toBe('org-a');
  });
});
