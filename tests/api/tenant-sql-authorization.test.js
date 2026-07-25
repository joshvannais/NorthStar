'use strict';

const express = require('express');
const request = require('supertest');
const { AsyncLocalStorage } = require('async_hooks');

const mockSqlContext = new AsyncLocalStorage();

function mockTrack(owner, promise) {
  owner.pending.add(promise);
  promise.then(
    function () { owner.pending.delete(promise); },
    function () { owner.pending.delete(promise); }
  );
  return promise;
}

jest.mock('../../src/db', function () {
  function result(rows) { return { rows: rows }; }
  return {
    isAvailable: jest.fn(function () { return true; }),
    query: jest.fn(function (sql, params) {
      const context = mockSqlContext.getStore();
      if (!context || !context.owner) {
        return Promise.reject(new Error('SQL executed without a test-owned request context'));
      }
      const owner = context.owner;
      const text = String(sql).replace(/\s+/g, ' ').trim();
      const values = params || [];
      const call = {
        sql: text,
        params: values.slice(),
        requestOwner: context.requestOwner,
        testOwner: owner.id,
      };
      if (owner.closed) {
        owner.lateCalls.push(call);
        return Promise.reject(new Error('SQL executed after test cleanup'));
      }
      owner.calls.push(call);

      const operation = (async function () {
        if (owner.delay && owner.delay.matches(text, values, context.requestOwner)) {
          owner.delay.started();
          await owner.delay.gate;
        }
        if (owner.rejectDuringCleanup && owner.closing) {
          throw new Error('request rejected during deterministic cleanup');
        }

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
            throw new Error('Test guard rejected tenant SQL without organization_id');
          }
          if (!values.includes('org-a') && !values.includes('org-b')) {
            throw new Error('Test guard rejected tenant SQL without the validated organization parameter');
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
      })();
      return mockTrack(owner, operation);
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

function buildApp(owner) {
  const app = express();
  app.use(function (req, _res, next) {
    const requestOwner = String(req.headers['x-test-request-owner'] || 'unlabeled-request');
    mockSqlContext.run({ owner: owner, requestOwner: requestOwner }, next);
  });
  app.use(express.json());
  app.use('/api/v1', publicApi);
  app.use('/api/v1', dashboard);
  app.use('/api', rawApi);
  app.use(errorHandler);
  return app;
}

const tokenA = generateToken({ id: 'owner-a', role: 'viewer' });
const tokenB = generateToken({ id: 'owner-b', role: 'viewer' });

function auth(testRequest, token, requestOwner) {
  return testRequest
    .set('Authorization', 'Bearer ' + (token || tokenA))
    .set('X-Test-Request-Owner', requestOwner || ((token || tokenA) === tokenB ? 'org-b' : 'org-a'));
}

function tenantQueriesSince(owner, index) {
  return owner.calls.slice(index).filter(function (call) {
    return !/FROM users WHERE id = \$1/.test(call.sql) && call.sql !== 'SELECT 1' &&
      /\b(?:FROM|UPDATE|INTO)\s+(?:call_records|leads|crm_contacts)\b/i.test(call.sql);
  });
}

describe('tenant SQL route authorization matrix', function () {
  let owner;
  let server;

  beforeEach(async function () {
    owner = {
      id: expect.getState().currentTestName,
      calls: [],
      pending: new Set(),
      lateCalls: [],
      closing: false,
      closed: false,
      delay: null,
      rejectDuringCleanup: false,
    };
    const app = buildApp(owner);
    server = await new Promise(function (resolve, reject) {
      const listener = app.listen(0, '127.0.0.1', function () { resolve(listener); });
      listener.once('error', reject);
    });
  });

  afterEach(async function () {
    owner.closing = true;
    if (owner.delay && owner.delay.release) owner.delay.release();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(function (resolve, reject) {
      server.close(function (error) { if (error) reject(error); else resolve(); });
    });
    await Promise.allSettled(Array.from(owner.pending));
    owner.closed = true;
    await new Promise(function (resolve) { setImmediate(resolve); });
    await new Promise(function (resolve) { setImmediate(resolve); });
    expect(owner.pending.size).toBe(0);
    expect(owner.lateCalls).toEqual([]);
  });

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
    const start = owner.calls.length;
    const unauthenticated = await request(server).get(path);
    expect(unauthenticated.status).toBe(401);

    const responseA = await auth(request(server).get(path));
    expect(responseA.status).toBe(200);
    const queriesA = tenantQueriesSince(owner, start);
    expect(queriesA.length).toBeGreaterThan(0);
    queriesA.forEach(function (call) {
      expect(call.sql).toMatch(/organization_id/i);
      expect(call.params).toContain('org-a');
    });

    const beforeB = owner.calls.length;
    const responseB = await auth(request(server).get(path), tokenB);
    expect(responseB.status).toBe(200);
    const queriesB = tenantQueriesSince(owner, beforeB);
    expect(queriesB.length).toBeGreaterThan(0);
    queriesB.forEach(function (call) {
      expect(call.sql).toMatch(/organization_id/i);
      expect(call.params).toContain('org-b');
      expect(call.params).not.toContain('org-a');
    });
  });

  test('lead-status mutation scopes its UPDATE and gives identical 404s', async function () {
    const owned = await auth(request(server).patch('/api/v1/leads/owned-lead/status').send({ status: 'contacted' }));
    expect(owned.status).toBe(200);
    for (const id of ['other-tenant-lead', 'unowned-lead', 'missing-lead']) {
      const response = await auth(request(server).patch('/api/v1/leads/' + id + '/status')
        .send({ status: 'contacted' }));
      expect({ status: response.status, body: response.body })
        .toEqual({ status: 404, body: { error: 'Lead not found' } });
    }
    const updates = owner.calls.filter(function (call) { return /UPDATE leads SET status/.test(call.sql); });
    expect(updates).toHaveLength(4);
    updates.forEach(function (call) {
      expect(call.sql).toMatch(/WHERE id = \$2 AND organization_id = \$3 RETURNING id/);
      expect(call.params[2]).toBe('org-a');
    });
  });

  test('mark-known scopes both mutation writes and gives identical 404s', async function () {
    const owned = await auth(request(server).post('/api/v1/calls/owned-call/mark-known'));
    expect(owned.status).toBe(200);
    for (const id of ['other-tenant-call', 'unowned-call', 'missing-call']) {
      const response = await auth(request(server).post('/api/v1/calls/' + id + '/mark-known'));
      expect({ status: response.status, body: response.body })
        .toEqual({ status: 404, body: { error: 'Call not found' } });
    }
    const updates = owner.calls.filter(function (call) {
      return /UPDATE call_records SET is_known_contact/.test(call.sql);
    });
    expect(updates).toHaveLength(4);
    updates.forEach(function (call) {
      expect(call.sql).toMatch(/WHERE id = \$1 AND organization_id = \$2/);
      expect(call.params[1]).toBe('org-a');
    });
    const contactInsert = owner.calls.find(function (call) { return /INSERT INTO crm_contacts/.test(call.sql); });
    expect(contactInsert.params[0]).toBe('org-a');
  });

  test('simulated lead and raw call creation persist validated organization ownership', async function () {
    const simulated = await auth(request(server).post('/api/v1/leads/simulate').send({
      callerName: 'Scoped Lead',
      service: 'Concrete',
    }));
    const recorded = await auth(request(server).post('/api/calls/record').send({
      callerName: 'Scoped Call',
      serviceType: 'Concrete',
    }));
    expect(simulated.status).toBe(200);
    expect(recorded.status).toBe(200);

    const leadInsert = owner.calls.find(function (call) { return /INSERT INTO leads/.test(call.sql); });
    const callInsert = owner.calls.find(function (call) { return /INSERT INTO call_records/.test(call.sql); });
    expect(leadInsert.params[0]).toBe('org-a');
    expect(callInsert.params[0]).toBe('org-a');
  });

  test('a delayed Organization B request cannot append to Organization A request records', async function () {
    let markStarted;
    let releaseDelay;
    const started = new Promise(function (resolve) { markStarted = resolve; });
    const gate = new Promise(function (resolve) { releaseDelay = resolve; });
    owner.delay = {
      matches: function (sql, params) {
        return /FROM users WHERE id = \$1/.test(sql) && params[0] === 'owner-b';
      },
      started: markStarted,
      gate: gate,
      release: releaseDelay,
    };

    const delayedB = auth(
      request(server).get('/api/v1/dashboard/kpis'),
      tokenB,
      'delayed-org-b'
    ).then(function (response) { return response; });
    await started;

    const responseA = await auth(
      request(server).get('/api/v1/dashboard/kpis'),
      tokenA,
      'completed-org-a'
    );
    expect(responseA.status).toBe(200);
    const callsA = owner.calls.filter(function (call) {
      return call.requestOwner === 'completed-org-a' &&
        !/FROM users WHERE id = \$1/.test(call.sql) &&
        /organization_id/i.test(call.sql);
    });
    releaseDelay();
    const responseB = await delayedB;
    expect(callsA.length).toBeGreaterThan(0);
    callsA.forEach(function (call) {
      expect(call.params).toContain('org-a');
      expect(call.params).not.toContain('org-b');
    });

    expect(responseB.status).toBe(200);
    const callsB = owner.calls.filter(function (call) {
      return call.requestOwner === 'delayed-org-b' &&
        !/FROM users WHERE id = \$1/.test(call.sql) &&
        /organization_id/i.test(call.sql);
    });
    expect(callsB.length).toBeGreaterThan(0);
    callsB.forEach(function (call) {
      expect(call.params).toContain('org-b');
      expect(call.params).not.toContain('org-a');
    });
  });

  test('concurrent organizations retain request-owned SQL call records', async function () {
    const responses = await Promise.all([
      auth(request(server).get('/api/v1/dashboard/revenue'), tokenA, 'concurrent-org-a'),
      auth(request(server).get('/api/v1/dashboard/revenue'), tokenB, 'concurrent-org-b'),
    ]);
    expect(responses.map(function (response) { return response.status; })).toEqual([200, 200]);

    for (const requestOwner of ['concurrent-org-a', 'concurrent-org-b']) {
      const expectedOrg = requestOwner.endsWith('a') ? 'org-a' : 'org-b';
      const unexpectedOrg = expectedOrg === 'org-a' ? 'org-b' : 'org-a';
      const calls = owner.calls.filter(function (call) {
        return call.requestOwner === requestOwner &&
          !/FROM users WHERE id = \$1/.test(call.sql) &&
          /organization_id/i.test(call.sql);
      });
      expect(calls.length).toBeGreaterThan(0);
      calls.forEach(function (call) {
        expect(call.params).toContain(expectedOrg);
        expect(call.params).not.toContain(unexpectedOrg);
        expect(call.testOwner).toBe(owner.id);
      });
    }
  });

  test('an in-flight request can be aborted and fully drained before cleanup', async function () {
    const http = require('http');
    let markStarted;
    let releaseDelay;
    const started = new Promise(function (resolve) { markStarted = resolve; });
    const gate = new Promise(function (resolve) { releaseDelay = resolve; });
    owner.delay = {
      matches: function (sql, params) {
        return /FROM users WHERE id = \$1/.test(sql) && params[0] === 'owner-b';
      },
      started: markStarted,
      gate: gate,
      release: releaseDelay,
    };
    const address = server.address();
    let clientRequest;
    const completion = new Promise(function (resolve) {
      clientRequest = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: '/api/v1/dashboard/kpis',
        headers: {
          Authorization: 'Bearer ' + tokenB,
          'X-Test-Request-Owner': 'aborted-org-b',
        },
      }, function (response) {
        response.resume();
        response.on('end', resolve);
      });
      clientRequest.on('error', resolve);
      clientRequest.end();
    });
    await started;
    clientRequest.destroy();
    releaseDelay();
    await completion;
    await Promise.allSettled(Array.from(owner.pending));
    expect(owner.pending.size).toBe(0);
  });

  test('a request rejected during cleanup settles without post-cleanup SQL', async function () {
    let markStarted;
    let releaseDelay;
    const started = new Promise(function (resolve) { markStarted = resolve; });
    const gate = new Promise(function (resolve) { releaseDelay = resolve; });
    owner.delay = {
      matches: function (sql, params) {
        return /FROM users WHERE id = \$1/.test(sql) && params[0] === 'owner-b';
      },
      started: markStarted,
      gate: gate,
      release: releaseDelay,
    };
    owner.rejectDuringCleanup = true;
    const pendingResponse = auth(
      request(server).get('/api/v1/dashboard/kpis'),
      tokenB,
      'cleanup-rejection'
    ).then(function (response) { return response; });
    await started;
    owner.closing = true;
    releaseDelay();
    const response = await pendingResponse;
    expect(response.status).toBeGreaterThanOrEqual(400);
    await Promise.allSettled(Array.from(owner.pending));
    expect(owner.pending.size).toBe(0);
    owner.closing = false;
  });
});
