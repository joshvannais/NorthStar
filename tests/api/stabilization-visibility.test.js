'use strict';

const express = require('express');
const request = require('supertest');

const mockCustomerEngine = {
  getCustomer: jest.fn(),
  listCustomers: jest.fn(),
  createCustomer: jest.fn(),
  updateCustomer: jest.fn(),
  archiveCustomer: jest.fn(),
  restoreCustomer: jest.fn(),
  calculateCustomerHealth: jest.fn(),
};

const mockOpportunityEngine = {
  getOpportunity: jest.fn(),
  listOpportunities: jest.fn(),
  createOpportunity: jest.fn(),
  updateOpportunity: jest.fn(),
  updateOpportunityStage: jest.fn(),
  archiveOpportunity: jest.fn(),
};

const mockPolarisEngine = {
  getRecommendations: jest.fn(),
  resolveRecommendation: jest.fn(),
};

jest.mock('../../src/auth/middleware', function () {
  return {
    requireAuth: function (req, res, next) {
      req.user = { sub: req.headers['x-test-user'] || 'owner-a', role: 'contractor' };
      next();
    },
  };
});
jest.mock('../../src/db', function () {
  return {
    isAvailable: jest.fn(function () { return true; }),
    query: jest.fn(function (sql, params) {
      if (/FROM users WHERE id/.test(String(sql))) {
        const userId = params[0];
        return Promise.resolve({ rows: [{
          id: userId,
          organization_id: userId === 'owner-b' ? 'org-b' : 'org-a',
          role: 'owner',
          status: 'active',
        }] });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
});
jest.mock('../../src/polaris/store', function () {
  return { getAllRecommendations: jest.fn(function () { return []; }) };
});
jest.mock('../../src/polaris/customer-engine', function () { return mockCustomerEngine; });
jest.mock('../../src/polaris/opportunity-engine', function () { return mockOpportunityEngine; });
jest.mock('../../src/polaris/communications-engine', function () { return {}; });
jest.mock('../../src/polaris/workflow-engine', function () { return {}; });
jest.mock('../../src/polaris/financial-engine', function () { return {}; });
jest.mock('../../src/polaris/asset-engine', function () { return {}; });
jest.mock('../../src/polaris/crew-engine', function () { return {}; });
jest.mock('../../src/polaris/job-engine', function () { return {}; });
jest.mock('../../src/polaris/analytics-engine', function () { return {}; });
jest.mock('../../src/polaris/engine', function () { return mockPolarisEngine; });

const engineRoutes = require('../../src/routes/polaris-engines');
const polarisRoutes = require('../../src/routes/polaris');

function simulationMetadata(sessionId, ownerUserId) {
  const owner = ownerUserId || 'owner-a';
  return {
    recordScope: 'simulation',
    source: 'simulation',
    simulationSessionId: sessionId,
    ownerUserId: owner,
    organizationId: owner === 'owner-b' ? 'org-b' : 'org-a',
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', engineRoutes);
  app.use('/api/v1/polaris', polarisRoutes);
  return app;
}

describe('stabilization session visibility guards', function () {
  const app = buildApp();
  const customers = {
    real: { id: 'customer-real', name: 'Durable Tenant Customer', metadata: { organizationId: 'org-a' } },
    sessionA: { id: 'customer-a', name: 'Session A Customer', metadata: simulationMetadata('session-a') },
    sessionB: { id: 'customer-b', name: 'Session B Customer', metadata: simulationMetadata('session-b', 'owner-b') },
  };
  const opportunities = {
    real: { id: 'opportunity-real', customerId: customers.real.id, title: 'Durable Opportunity', metadata: { organizationId: 'org-a' } },
    sessionA: { id: 'opportunity-a', customerId: customers.sessionA.id, title: 'Session A Opportunity', metadata: simulationMetadata('session-a') },
    sessionB: { id: 'opportunity-b', customerId: customers.sessionB.id, title: 'Session B Opportunity', metadata: simulationMetadata('session-b', 'owner-b') },
  };
  const recommendations = [
    { id: 'recommendation-real', type: 'recommendation', data: { id: 'real-data', message: 'Durable recommendation', organizationId: 'org-a' } },
    { id: 'recommendation-a', type: 'opportunity', data: opportunities.sessionA },
    { id: 'recommendation-b', type: 'opportunity', data: opportunities.sessionB },
  ];

  beforeEach(function () {
    jest.clearAllMocks();

    mockCustomerEngine.getCustomer.mockImplementation(function (id) {
      return Object.values(customers).find(function (customer) { return customer.id === id; }) || { error: 'Customer not found: ' + id };
    });
    mockCustomerEngine.listCustomers.mockImplementation(function () {
      return {
        customers: Object.values(customers).map(function (customer) {
          return { id: customer.id, name: customer.name };
        }),
        total: Object.keys(customers).length,
      };
    });
    mockCustomerEngine.createCustomer.mockReturnValue({ id: 'customer-created', name: 'Created', status: 'active' });
    mockCustomerEngine.updateCustomer.mockImplementation(function (id) { return { id: id, updated: ['name'] }; });
    mockCustomerEngine.archiveCustomer.mockImplementation(function (id) { return { id: id, status: 'archived' }; });
    mockCustomerEngine.restoreCustomer.mockImplementation(function (id) { return { id: id, status: 'active' }; });
    mockCustomerEngine.calculateCustomerHealth.mockImplementation(function (id) { return { customerId: id, healthScore: 50 }; });

    mockOpportunityEngine.getOpportunity.mockImplementation(function (id) {
      return Object.values(opportunities).find(function (opportunity) { return opportunity.id === id; }) || { error: 'Opportunity not found: ' + id };
    });
    mockOpportunityEngine.listOpportunities.mockImplementation(function () {
      return {
        opportunities: Object.values(opportunities).map(function (opportunity) {
          return Object.assign({}, opportunity);
        }),
        total: Object.keys(opportunities).length,
      };
    });
    mockOpportunityEngine.createOpportunity.mockReturnValue({ id: 'opportunity-created', title: 'Created' });
    mockOpportunityEngine.updateOpportunity.mockImplementation(function (id) { return { id: id, title: 'Updated' }; });
    mockOpportunityEngine.updateOpportunityStage.mockImplementation(function (id, stage) { return { id: id, stage: stage }; });
    mockOpportunityEngine.archiveOpportunity.mockImplementation(function (id) { return { id: id, archived: true }; });

    mockPolarisEngine.getRecommendations.mockReturnValue(recommendations);
    mockPolarisEngine.resolveRecommendation.mockImplementation(function (id) {
      return recommendations.find(function (recommendation) { return recommendation.id === id; }) || null;
    });
  });

  describe('customer mutations', function () {
    test('a missing or wrong session receives 404 without calling the mutator', async function () {
      const noSession = await request(app).put('/api/v1/customers/customer-a').send({ name: 'Blocked' });
      const wrongSession = await request(app).put('/api/v1/customers/customer-a?sessionId=session-b').send({ name: 'Blocked' });
      const wrongOwner = await request(app).put('/api/v1/customers/customer-a?sessionId=session-a')
        .set('X-Test-User', 'owner-b').send({ name: 'Blocked' });

      expect(noSession.status).toBe(404);
      expect(wrongSession.status).toBe(404);
      expect(wrongOwner.status).toBe(404);
      expect(noSession.body).toEqual({ error: 'Record not found' });
      expect(mockCustomerEngine.updateCustomer).not.toHaveBeenCalled();
    });

    test('the owning session succeeds and preserves the existing response contract', async function () {
      const response = await request(app)
        .put('/api/v1/customers/customer-a?sessionId=session-a')
        .send({ name: 'Updated Demo Customer' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: 'customer-a' });
      expect(mockCustomerEngine.updateCustomer).toHaveBeenCalledTimes(1);
    });

    test('a real record succeeds without a demo session', async function () {
      const response = await request(app)
        .put('/api/v1/customers/customer-real')
        .send({ name: 'Updated Durable Customer' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: 'customer-real' });
      expect(mockCustomerEngine.updateCustomer).toHaveBeenCalledTimes(1);
    });
  });

  describe('opportunity mutations', function () {
    test('a missing or wrong session receives 404 without calling the mutator', async function () {
      const noSession = await request(app).put('/api/v1/opportunities/opportunity-a').send({ title: 'Blocked' });
      const wrongSession = await request(app).put('/api/v1/opportunities/opportunity-a?sessionId=session-b').send({ title: 'Blocked' });

      expect(noSession.status).toBe(404);
      expect(wrongSession.status).toBe(404);
      expect(wrongSession.body).toEqual({ error: 'Record not found' });
      expect(mockOpportunityEngine.updateOpportunity).not.toHaveBeenCalled();
    });

    test('the owning session succeeds', async function () {
      const response = await request(app)
        .put('/api/v1/opportunities/opportunity-a?sessionId=session-a')
        .send({ title: 'Updated Demo Opportunity' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: 'opportunity-a' });
      expect(mockOpportunityEngine.updateOpportunity).toHaveBeenCalledTimes(1);
    });

    test('a real record succeeds without a demo session', async function () {
      const response = await request(app)
        .put('/api/v1/opportunities/opportunity-real')
        .send({ title: 'Updated Durable Opportunity' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: 'opportunity-real' });
      expect(mockOpportunityEngine.updateOpportunity).toHaveBeenCalledTimes(1);
    });
  });

  test('public create and real-record update inputs cannot forge simulation ownership', async function () {
    const forged = {
      name: 'Attempted Forgery',
      recordScope: 'simulation',
      source: 'simulation',
      simulationSessionId: 'forged-session',
      demoSessionId: 'forged-demo-session',
      metadata: simulationMetadata('forged-session'),
    };

    expect((await request(app).post('/api/v1/customers').send(forged)).status).toBe(201);
    expect((await request(app).put('/api/v1/customers/customer-real').send(forged)).status).toBe(200);

    [mockCustomerEngine.createCustomer.mock.calls[0][0], mockCustomerEngine.updateCustomer.mock.calls[0][1]]
      .forEach(function (body) {
        expect(body.recordScope).toBeUndefined();
        expect(body.source).toBeUndefined();
        expect(body.simulationSessionId).toBeUndefined();
        expect(body.demoSessionId).toBeUndefined();
        expect(body.metadata.recordScope).toBeUndefined();
        expect(body.metadata.source).toBeUndefined();
        expect(body.metadata.simulationSessionId).toBeUndefined();
        expect(body.metadata.organizationId).toBe('org-a');
        expect(body.metadata.ownerUserId).toBe('owner-a');
      });
  });

  test('real records remain visible while foreign simulations are filtered', async function () {
    const freshCustomers = await request(app).get('/api/v1/customers');
    const sessionCustomers = await request(app).get('/api/v1/customers?sessionId=session-a');
    const freshOpportunities = await request(app).get('/api/v1/opportunities');
    const sessionOpportunities = await request(app).get('/api/v1/opportunities?sessionId=session-a');

    expect(freshCustomers.body.customers.map(function (record) { return record.id; })).toEqual(['customer-real']);
    expect(sessionCustomers.body.customers.map(function (record) { return record.id; })).toEqual(['customer-real', 'customer-a']);
    expect(freshOpportunities.body.opportunities.map(function (record) { return record.id; })).toEqual(['opportunity-real']);
    expect(sessionOpportunities.body.opportunities.map(function (record) { return record.id; })).toEqual(['opportunity-real', 'opportunity-a']);
  });

  describe('raw Polaris recommendations', function () {
    test('foreign demo wrappers are hidden while real and owning-session wrappers remain visible', async function () {
      const fresh = await request(app).get('/api/v1/polaris/recommendations');
      const sessionA = await request(app).get('/api/v1/polaris/recommendations?sessionId=session-a');

      expect(fresh.status).toBe(200);
      expect(fresh.body.recommendations.map(function (record) { return record.id; })).toEqual(['recommendation-real']);
      expect(fresh.body.count).toBe(1);
      expect(sessionA.body.recommendations.map(function (record) { return record.id; }))
        .toEqual(['recommendation-real', 'recommendation-a']);
      expect(sessionA.body.count).toBe(2);
    });

    test('a foreign wrapper cannot be resolved, while owning-session and real wrappers can', async function () {
      const foreign = await request(app)
        .put('/api/v1/polaris/recommendations/recommendation-b/resolve?sessionId=session-a');

      expect(foreign.status).toBe(404);
      expect(foreign.body.error).toMatchObject({ code: 'NOT_FOUND' });
      expect(mockPolarisEngine.resolveRecommendation).not.toHaveBeenCalled();

      const owned = await request(app)
        .put('/api/v1/polaris/recommendations/recommendation-a/resolve?sessionId=session-a');
      const real = await request(app)
        .put('/api/v1/polaris/recommendations/recommendation-real/resolve');

      expect(owned.status).toBe(200);
      expect(real.status).toBe(200);
      expect(mockPolarisEngine.resolveRecommendation.mock.calls.map(function (call) { return call[0]; }))
        .toEqual(['recommendation-a', 'recommendation-real']);
    });
  });
});
