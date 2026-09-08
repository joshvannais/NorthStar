'use strict';

jest.mock('../../src/middleware/rateLimit', () => ({ rateLimit: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { rateLimit } = require('../../src/middleware/rateLimit');
const { createOperationalOverviewRouter } = require('../../src/routes/operationalOverview');
const { overview } = require('../helpers/m23-part9b-overview-fixture');

const ORG = 'a1900000-0000-4000-8000-000000000001';
const USER = 'b1900000-0000-4000-8000-000000000001';
const SESSION = 'c1900000-0000-4000-8000-000000000001';
const expectedKey = (organizationId = ORG, userId = USER) => `operational-overview:${organizationId}:${userId}`;

function selectedKey() {
  createOperationalOverviewRouter();
  expect(rateLimit).toHaveBeenCalledTimes(1);
  expect(rateLimit.mock.calls[0][0]).toBe('internal-api');
  const key = rateLimit.mock.calls[0][1];
  expect(typeof key).toBe('function');
  return key;
}

function mounted(role = 'owner', options = {}) {
  const events = [];
  const keys = [];
  const pool = { connect: jest.fn() };
  const read = jest.fn(async () => {
    events.push('read');
    return overview(role === 'member' ? 'dispatcher_coordination' : 'owner_admin');
  });
  const budget = jest.fn((req, res, next) => {
    events.push('budget');
    const key = rateLimit.mock.calls[0][1];
    keys.push(typeof key === 'function' ? key(req) : null);
    if (options.rejectBudget) {
      return res.set('Retry-After', '7').status(429).json({ error: { code: 'rate_limited' } });
    }
    return next();
  });
  rateLimit.mockReturnValue(budget);
  const tenantAuth = (req, _res, next) => {
    events.push('auth');
    req.user = Object.freeze({ id: USER });
    req.userRole = role;
    req.orgId = ORG;
    req.tenantContext = Object.freeze({ organizationId: ORG, userId: USER, role });
    req.authSession = Object.freeze({ id: SESSION });
    next();
  };
  const app = express();
  app.use('/api/v1/operational-overview', createOperationalOverviewRouter({
    poolProvider: () => pool,
    readOverview: read,
    ...(!options.defaultAuth ? { tenantAuth } : {}),
    ...(options.throttle ? { throttle: options.throttle } : {}),
  }));
  app.use(require('../../src/middleware/errorHandler').errorHandler);
  return { app, budget, read, pool, events, keys };
}

describe('Part 9B trusted overview budget key contract', () => {
  let httpsRequest, httpsGet, providerFetch;

  beforeAll(() => {
    httpsRequest = jest.spyOn(require('https'), 'request').mockImplementation(() => { throw new Error('External transport forbidden'); });
    httpsGet = jest.spyOn(require('https'), 'get').mockImplementation(() => { throw new Error('External transport forbidden'); });
    providerFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Provider fetch forbidden'); });
  });
  afterAll(() => {
    try {
      expect(httpsRequest).not.toHaveBeenCalled();
      expect(httpsGet).not.toHaveBeenCalled();
      expect(providerFetch).not.toHaveBeenCalled();
    } finally { httpsRequest.mockRestore(); httpsGet.mockRestore(); providerFetch.mockRestore(); }
  });
  beforeEach(() => {
    rateLimit.mockReset();
    rateLimit.mockReturnValue((_req, _res, next) => next());
  });

  test('default construction supplies the existing group and a route-prefixed identity callback', () => {
    expect(selectedKey()({ tenantContext: { organizationId: ORG, userId: USER } })).toBe(expectedKey());
  });

  test('the callback reads no unrelated request field or identity alias', () => {
    const key = selectedKey();
    const req = new Proxy({ tenantContext: Object.freeze({ organizationId: ORG, userId: USER }) }, {
      get(target, name) {
        if (name !== 'tenantContext') throw new Error('Unrelated request field read');
        return target[name];
      },
    });
    expect(key(req)).toBe(expectedKey());
  });

  test('distinct trusted tenant/user pairs remain separate at callback invocation time', () => {
    const key = selectedKey();
    const organizations = [ORG, 'a1900000-0000-4000-8000-000000000002'];
    const users = [USER, 'b1900000-0000-4000-8000-000000000002'];
    const keys = [];
    for (const organizationId of organizations) for (const userId of users) {
      const req = { tenantContext: Object.freeze({ organizationId, userId }) };
      expect(key(req)).toBe(expectedKey(organizationId, userId));
      keys.push(key(req));
    }
    expect(new Set(keys).size).toBe(4);
  });

  test('the same trusted identity retains its budget across session, role and page state', () => {
    const key = selectedKey();
    for (const role of ['owner', 'admin', 'member']) {
      expect(key({ tenantContext: Object.freeze({ organizationId: ORG, userId: USER, role }),
        authSession: { id: `local-session-${role}` }, userRole: role,
        query: { state: role === 'owner' ? 'all' : 'active' }, requestId: `local-request-${role}`,
      })).toBe(expectedKey());
    }
  });

  test.each(['get', 'head'])('default authentication rejects anonymous %s before budget or read', async method => {
    const { app, budget, read, keys } = mounted('owner', { defaultAuth: true });
    const response = await request(app)[method]('/api/v1/operational-overview');
    expect(response.status).toBe(401);
    expect(budget).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(keys).toEqual([]);
  });

  test.each(['owner', 'admin', 'member'])('ordinary %s reads preserve auth-budget-read order and projection', async role => {
    const { app, budget, read, pool, events, keys } = mounted(role);
    const response = await request(app).get('/api/v1/operational-overview');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.data.scope).toBe(role === 'member' ? 'dispatcher_coordination' : 'owner_admin');
    expect(events).toEqual(['auth', 'budget', 'read']);
    expect(budget).toHaveBeenCalledTimes(1);
    expect(keys).toEqual([expectedKey()]);
    expect(read).toHaveBeenCalledWith(pool, { organizationId: ORG, actorUserId: USER,
      actorAccessRole: role, authSessionId: SESSION, state: 'active', limit: 25, cursor: null });
  });

  test('current viewer restrictions still prevent the overview read', async () => {
    const { app, read, events } = mounted('viewer');
    expect((await request(app).get('/api/v1/operational-overview')).status).toBe(403);
    expect(events).toEqual(['auth', 'budget']);
    expect(read).not.toHaveBeenCalled();
  });

  test('the existing construction-time throttle override remains usable', async () => {
    const throttle = jest.fn((_req, _res, next) => next());
    const { app, read, budget } = mounted('owner', { throttle });
    expect((await request(app).get('/api/v1/operational-overview')).status).toBe(200);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(throttle).toHaveBeenCalledTimes(1);
    expect(budget).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('a mocked budget refusal preserves its response and never reaches the read', async () => {
    const { app, read, events } = mounted('owner', { rejectBudget: true });
    const response = await request(app).get('/api/v1/operational-overview');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('7');
    expect(response.body).toEqual({ error: { code: 'rate_limited' } });
    expect(events).toEqual(['auth', 'budget']);
    expect(read).not.toHaveBeenCalled();
  });
});
