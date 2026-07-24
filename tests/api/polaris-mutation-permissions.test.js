'use strict';

const fs = require('fs');
const path = require('path');

const mockMembershipRows = Object.create(null);

jest.mock('../../src/db', function () {
  return {
    isAvailable: jest.fn(function () { return true; }),
    query: jest.fn(function (_sql, params) {
      const userId = params && params[0];
      return Promise.resolve({ rows: mockMembershipRows[userId] || [] });
    })
  };
});

const mockUpdateCustomer = jest.fn(function (id, body) {
  return { id, name: body.name || 'Updated' };
});

jest.mock('../../src/polaris/customer-engine', function () {
  return {
    listCustomers: jest.fn(function () {
      return { customers: [{ id: 'owned', name: 'Owned' }], total: 1 };
    }),
    getCustomer: jest.fn(function (id) {
      if (id === 'cross-org') return { id, metadata: { organizationId: 'org-b' } };
      if (id === 'owned') return { id, metadata: { organizationId: 'org-a' } };
      return { error: 'Customer not found' };
    }),
    createCustomer: jest.fn(function (body) {
      return { id: 'created', name: body.name, status: 'active' };
    }),
    updateCustomer: mockUpdateCustomer,
    archiveCustomer: jest.fn(),
    restoreCustomer: jest.fn()
  };
});

jest.mock('../../src/polaris/engine', function () {
  return {
    init: jest.fn(),
    getLearningSummary: jest.fn(function () { return { metrics: [] }; }),
    getDurationPredictions: jest.fn(function () { return []; }),
    prepareQueryContext: jest.fn(function () { return { recommendations: [], historicalEstimates: [] }; }),
    generateEstimate: jest.fn(function () { return { id: 'estimate-authorized' }; }),
    recordCompletion: jest.fn(function () { return { recorded: true }; }),
    generateRecommendations: jest.fn(function () { return []; }),
    getRecommendations: jest.fn(function () { return []; }),
    resolveRecommendation: jest.fn(),
    getCompletedJobs: jest.fn(function () { return []; }),
    getHistoricalEstimates: jest.fn(function () { return []; }),
    getDashboardIntelligence: jest.fn(function () { return { recommendations: [] }; }),
    getPipelineOverview: jest.fn(function () { return {}; }),
    getConfig: jest.fn(function () { return {}; }),
    updateConfig: jest.fn(function () { return {}; })
  };
});

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../../src/auth/middleware');
const polarisRouter = require('../../src/routes/polaris');
const engineRouter = require('../../src/routes/polaris-engines');
const { routes } = require('../../src/auth/polarisRoutePermissions');

function tokenFor(userId) {
  return generateToken({ id: userId, email: userId + '@test.local' });
}

function authenticated(testRequest, userId) {
  return testRequest.set('Authorization', 'Bearer ' + tokenFor(userId));
}

function actualPath(route) {
  return (route.router === 'polaris' ? '/api/v1/polaris' : '/api/v1') +
    route.path.replace(/:id\b/g, 'missing-id');
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/polaris', polarisRouter);
  app.use('/api/v1', engineRouter);
  return app;
}

describe('Polaris mutation permission inventory', function () {
  const app = buildApp();

  beforeAll(function () {
    mockMembershipRows.viewer = [{ id: 'viewer', organization_id: 'org-a', role: 'viewer', status: 'active' }];
    mockMembershipRows.member = [{ id: 'member', organization_id: 'org-a', role: 'member', status: 'active' }];
    mockMembershipRows.admin = [{ id: 'admin', organization_id: 'org-a', role: 'admin', status: 'active' }];
    mockMembershipRows.owner = [{ id: 'owner', organization_id: 'org-a', role: 'owner', status: 'active' }];
    mockMembershipRows.null_org = [{ id: 'null_org', organization_id: null, role: 'member', status: 'active' }];
    mockMembershipRows.inactive = [{ id: 'inactive', organization_id: 'org-a', role: 'member', status: 'inactive' }];
    mockMembershipRows.ambiguous = [
      { id: 'ambiguous', organization_id: 'org-a', role: 'member', status: 'active' },
      { id: 'ambiguous', organization_id: 'org-b', role: 'member', status: 'active' }
    ];
  });

  test('coverage table exactly matches every mounted Polaris mutation', function () {
    const files = [
      { router: 'polaris', file: '../../src/routes/polaris.js' },
      { router: 'polaris-engines', file: '../../src/routes/polaris-engines.js' }
    ];
    const discovered = [];
    files.forEach(function (item) {
      const source = fs.readFileSync(path.resolve(__dirname, item.file), 'utf8');
      const expression = /router\.(post|put|patch|delete)\(\s*(['"])([^'"]+)\2\s*,\s*mutationPermission\(\s*(['"])([^'"]+)\4\s*,\s*(['"])([^'"]+)\6\s*\)/g;
      let match;
      while ((match = expression.exec(source))) {
        discovered.push(item.router + '|' + match[1].toUpperCase() + '|' + match[3]);
        expect(match[5]).toBe(match[1].toUpperCase());
        expect(match[7]).toBe(match[3]);
      }
    });
    const inventoried = routes.map(function (route) {
      return route.router + '|' + route.method + '|' + route.path;
    });
    expect(discovered.sort()).toEqual(inventoried.sort());
    routes.forEach(function (route) {
      expect(route.membership).toBe('persisted_active_unambiguous');
      expect(route.ownership).toEqual(expect.any(String));
      expect(route.roles).not.toContain('viewer');
      expect(route.readRoles).toContain('viewer');
    });
  });

  test.each(routes)('viewer receives exact 403 for $router $method $path', async function (route) {
    const method = route.method.toLowerCase();
    const response = await authenticated(request(app)[method](actualPath(route)), 'viewer')
      .send({ name: 'Viewer cannot mutate' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
  });

  test('persisted viewer can read without receiving mutation authority', async function () {
    const learning = await authenticated(request(app).get('/api/v1/polaris/learning'), 'viewer');
    const customers = await authenticated(request(app).get('/api/v1/customers'), 'viewer');
    expect(learning.status).toBe(200);
    expect(customers.status).toBe(200);
  });

  test.each(['member', 'admin', 'owner'])('authorized persisted %s mutation succeeds', async function (role) {
    const response = await authenticated(request(app).post('/api/v1/polaris/estimate'), role)
      .send({ serviceType: 'Electrical' });
    expect(response.status).toBe(200);
    expect(response.body.id).toBe('estimate-authorized');
  });

  test('wrong-organization identifier is hidden before mutation', async function () {
    mockUpdateCustomer.mockClear();
    const response = await authenticated(request(app).put('/api/v1/customers/cross-org'), 'member')
      .send({ name: 'Forbidden update' });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Record not found' });
    expect(mockUpdateCustomer).not.toHaveBeenCalled();
  });

  test.each(['null_org', 'inactive', 'missing', 'ambiguous'])(
    '%s membership cannot mutate',
    async function (userId) {
      const response = await authenticated(request(app).post('/api/v1/polaris/estimate'), userId)
        .send({ serviceType: 'Electrical' });
      expect(response.status).toBe(403);
    }
  );
});
