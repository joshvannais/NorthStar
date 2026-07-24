'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));

const mockCanonicalCustomer = {
  service: 'Concrete',
  serviceClassification: {
    serviceKey: 'concrete',
    confidence: 'high',
    alternatives: [],
  },
  supportingEvidence: {
    jobType: 'Transcript supports installation work.',
    squareFeet: 'Transcript supports 400 square feet.',
  },
  scope: {
    jobType: 'install',
    squareFeet: 400,
    finish: 'broom finish',
    existingRemoval: false,
    access: 'truck access',
  },
  missingInformation: [],
  assumptions: ['Test fixture assumption.'],
  qualification: 'Qualified for preliminary review',
  urgency: 'not established',
  customerIntent: 'Requesting concrete service',
  bookingIntent: 'Schedule on-site estimate',
  customerSentiment: 'Not reliably determined',
  pricingStrategy: 'perSquareFoot',
  pricingRecommendation: 'Preliminary only; verify scope before quoting.',
  preliminaryRange: { low: 1100, high: 1300 },
  pricingBreakdown: [
    { label: 'Concrete installation', amount: 1000, category: 'internalCost' },
    { label: 'Business Profile markup (20%)', amount: 200, category: 'markup' },
  ],
  internalCost: 1000,
  customerFacingPrice: 1200,
  confidenceScore: 91,
  confidenceLevel: 'high',
  confidenceExplanation: 'Required test scope is supported.',
  recommendedAction: {
    action: 'Schedule on-site estimate',
    description: 'Confirm the fixture scope.',
    priority: 'high',
  },
  operationalReasoning: 'Review the captured scope before acting.',
  pipelineVersion: 'canonical-polaris-v1',
};

jest.mock('../../src/db', function () {
  return {
    initDatabase: jest.fn(function () { return Promise.resolve(true); }),
    isAvailable: jest.fn(function () { return true; }),
    query: jest.fn(function (sql) {
      if (/SELECT organization_id FROM users/.test(String(sql))) {
        return Promise.resolve({ rows: [{ organization_id: 'org-test-owner' }] });
      }
      if (/SELECT id FROM call_records/.test(String(sql))) {
        return Promise.resolve({ rows: [] });
      }
      if (/INSERT INTO call_records/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 'db-call-created' }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    getPool: jest.fn(function () { return null; }),
  };
});

jest.mock('../../src/audit/client', function () {
  return {
    record: jest.fn(function () { return Promise.resolve(); }),
    query: jest.fn(function () { return Promise.resolve({ items: [], pagination: {} }); }),
    ensureTable: jest.fn(function () { return Promise.resolve(); }),
  };
});

jest.mock('../../src/cache/client', function () {
  return {
    buildKey: jest.fn(function () {
      return Array.prototype.slice.call(arguments).join(':');
    }),
    get: jest.fn(function () { return Promise.resolve(null); }),
    set: jest.fn(function () { return Promise.resolve(true); }),
    isAvailable: jest.fn(function () { return false; }),
    incr: jest.fn(function () { return Promise.resolve(1); }),
  };
});

// The legacy API router imports and initializes voice services at module load.
// Voice behavior is outside these contracts, so mount an inert router to keep
// this suite isolated from unrelated startup side effects.
jest.mock('../../src/routes/voice', function () {
  return jest.requireActual('express').Router();
});

jest.mock('../../src/leads/store', function () {
  return {
    addLead: jest.fn(function (lead) {
      return Object.assign({ id: 'lead-created' }, lead);
    }),
    getAllLeads: jest.fn(function () { return []; }),
    getLead: jest.fn(function () { return null; }),
    updateLead: jest.fn(function () { return null; }),
    removeLead: jest.fn(function () { return null; }),
  };
});

jest.mock('../../src/polaris/store', function () {
  const emptyArray = jest.fn(function () { return []; });
  return {
    init: jest.fn(),
    generateId: jest.fn(function () { return 'mock-store-id'; }),
    getAllJobs: emptyArray,
    getJob: jest.fn(function () { return null; }),
    addJob: jest.fn(),
    updateJob: jest.fn(),
    getAllEstimates: emptyArray,
    addEstimate: jest.fn(),
    updateEstimate: jest.fn(),
    getAllMetrics: emptyArray,
    addMetric: jest.fn(),
    getMetricsByType: emptyArray,
    getAllCrews: emptyArray,
    addCrew: jest.fn(),
    getAllRecommendations: emptyArray,
    addRecommendation: jest.fn(),
    getUnresolvedRecommendations: emptyArray,
    resolveRecommendation: jest.fn(),
  };
});

jest.mock('../../src/polaris/customer-engine', function () {
  const records = {
    'cust-tenant': {
      id: 'cust-tenant',
      name: 'Tenant Customer',
      status: 'active',
    },
    'cust-a': {
      id: 'cust-a',
      name: 'Session A Customer',
      status: 'active',
      phone: '(555) 000-0101',
      metadata: {
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-a',
        ownerUserId: 'test-owner',
        polarisIntelligence: mockCanonicalCustomer,
      },
    },
    'cust-b': {
      id: 'cust-b',
      name: 'Session B Customer',
      status: 'active',
      metadata: {
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-b',
        ownerUserId: 'other-owner',
      },
    },
  };

  return {
    listCustomers: jest.fn(function () {
      return {
        customers: Object.keys(records).map(function (id) {
          return { id: id, name: records[id].name, status: records[id].status };
        }),
        total: Object.keys(records).length,
      };
    }),
    getCustomer: jest.fn(function (id) {
      return records[id] ? Object.assign({}, records[id]) : { error: 'Customer not found' };
    }),
    createCustomer: jest.fn(function (input) {
      return {
        id: 'cust-created',
        name: input.name,
        status: input.status,
        createdAt: '2026-07-22T12:00:00.000Z',
      };
    }),
    updateCustomerMetrics: jest.fn(),
  };
});

jest.mock('../../src/polaris/communications-engine', function () {
  const communications = [
    {
      id: 'comm-hidden-1', customerId: 'cust-b', type: 'call',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b', ownerUserId: 'other-owner' },
    },
    {
      id: 'comm-hidden-2', customerId: 'cust-b', type: 'call',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b', ownerUserId: 'other-owner' },
    },
    { id: 'comm-tenant', customerId: 'cust-tenant', type: 'call' },
    {
      id: 'comm-a-1', customerId: 'cust-a', type: 'call',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a', ownerUserId: 'test-owner' },
    },
    {
      id: 'comm-a-2', customerId: 'cust-a', type: 'call',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a', ownerUserId: 'test-owner' },
    },
  ];

  return {
    getAllCommunications: jest.fn(function () {
      return { communications: communications.slice(), total: communications.length };
    }),
    getCommunications: jest.fn(function (customerId) {
      const matches = communications.filter(function (item) { return item.customerId === customerId; });
      return { communications: matches, total: matches.length };
    }),
    recordCommunication: jest.fn(function (input) {
      return {
        id: 'comm-created',
        customerId: input.customerId,
        type: input.type,
        direction: input.direction,
        status: input.status,
        createdAt: '2026-07-22T12:00:01.000Z',
      };
    }),
  };
});

jest.mock('../../src/polaris/opportunity-engine', function () {
  const opportunities = [
    {
      id: 'opp-tenant-open', customerId: 'cust-tenant', title: 'Tenant Lead',
      stage: 'lead', status: 'open', estimatedValue: 1000, expectedRevenue: 50,
      lastActivity: '2099-01-01T00:00:00.000Z',
    },
    {
      id: 'opp-a-open', customerId: 'cust-a', title: 'Session A Negotiation',
      stage: 'negotiation', status: 'open', estimatedValue: 2000, expectedRevenue: 1400,
      lastActivity: '2099-01-01T00:00:00.000Z',
      metadata: {
        recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a',
        ownerUserId: 'test-owner',
        polarisIntelligence: mockCanonicalCustomer,
      },
    },
    {
      id: 'opp-a-won', customerId: 'cust-a', title: 'Session A Won',
      stage: 'won', status: 'won', estimatedValue: 3000, expectedRevenue: 3000,
      lastActivity: '2099-01-01T00:00:00.000Z',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a', ownerUserId: 'test-owner' },
    },
    {
      id: 'opp-tenant-lost', customerId: 'cust-tenant', title: 'Tenant Lost',
      stage: 'lost', status: 'lost', estimatedValue: 500, expectedRevenue: 0,
      lastActivity: '2099-01-01T00:00:00.000Z',
    },
    {
      id: 'opp-hidden', customerId: 'cust-b', title: 'Hidden Session B',
      stage: 'qualified', status: 'open', estimatedValue: 9000, expectedRevenue: 1350,
      lastActivity: '2099-01-01T00:00:00.000Z',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b', ownerUserId: 'other-owner' },
    },
  ];

  return {
    PIPELINE_STAGES: {
      lead: { id: 'lead', displayName: 'Lead', category: 'active' },
      qualified: { id: 'qualified', displayName: 'Qualified', category: 'active' },
      negotiation: { id: 'negotiation', displayName: 'Negotiation', category: 'active' },
      won: { id: 'won', displayName: 'Won', category: 'closed' },
      lost: { id: 'lost', displayName: 'Lost', category: 'closed' },
    },
    listOpportunities: jest.fn(function (filters) {
      let result = opportunities.slice();
      if (filters && filters.customerId) {
        result = result.filter(function (item) { return item.customerId === filters.customerId; });
      }
      return { opportunities: result, total: result.length };
    }),
    createOpportunity: jest.fn(function (input) {
      return {
        id: 'opp-created',
        customerId: input.customerId,
        title: input.title,
        stage: input.stage,
        priority: input.priority,
        estimatedValue: input.estimatedValue,
        createdAt: '2026-07-22T12:00:02.000Z',
      };
    }),
  };
});

jest.mock('../../src/polaris/financial-engine', function () {
  const estimates = [
    { id: 'est-tenant', customerId: 'cust-tenant', total: 1000 },
    {
      id: 'est-a', customerId: 'cust-a', opportunityId: 'opp-a-open', total: 1200,
      metadata: {
        recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a',
        ownerUserId: 'test-owner',
        polarisIntelligence: mockCanonicalCustomer,
      },
    },
    {
      id: 'est-b', customerId: 'cust-b', total: 9000,
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b', ownerUserId: 'other-owner' },
    },
  ];

  return {
    listEstimates: jest.fn(function (filters) {
      let result = estimates.slice();
      if (filters && filters.customerId) {
        result = result.filter(function (item) { return item.customerId === filters.customerId; });
      }
      return { estimates: result, total: result.length };
    }),
    createEstimate: jest.fn(function (input) {
      return {
        id: 'est-created',
        title: input.title,
        customerId: input.customerId,
        opportunityId: input.opportunityId,
        total: input.items.reduce(function (sum, item) {
          return sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
        }, 0),
        status: input.status,
        createdAt: '2026-07-22T12:00:03.000Z',
      };
    }),
  };
});

jest.mock('../../src/services/dataLoader', function () {
  const leads = [
    { id: 'lead-tenant', caller: 'Tenant Lead', service: 'Tenant Service' },
    {
      id: 'lead-a', caller: 'Session A Lead', service: 'Concrete',
      recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a',
        ownerUserId: 'test-owner',
    },
    {
      id: 'lead-b', caller: 'Session B Lead', service: 'Roofing',
      recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b',
        ownerUserId: 'other-owner',
    },
  ];

  return {
    loadData: jest.fn(function () { return { leads: leads.slice() }; }),
    loadCanonicalData: jest.fn(function () { return { leads: leads.slice() }; }),
    filterSessionRecords: jest.fn(function (records) { return records; }),
    CACHE_TTL_MS: 30000,
  };
});

jest.mock('../../src/services/customerIntelligence', function () {
  return {
    generateDashboardCustomerIntelligence: jest.fn(function (leads) {
      return { leadIds: leads.map(function (lead) { return lead.id; }) };
    }),
    generateCustomerSnapshot: jest.fn(function (lead, options) {
      return {
        customerId: lead.id,
        name: lead.caller,
        totalLeads: options.totalLeads,
      };
    }),
  };
});

jest.mock('../../src/services/businessProfile', function () {
  const profile = {
    company: { name: 'NorthStar Test Fixture' },
    financial: { markup: 1.2, emergencyMarkup: 1.5 },
  };
  return {
    getProfile: jest.fn(function () { return profile; }),
    updateProfile: jest.fn(function () { return { success: true, profile: profile }; }),
    updateSection: jest.fn(function () { return { success: true, profile: profile }; }),
    getCompany: jest.fn(function () { return profile.company; }),
    getHeadquarters: jest.fn(function () { return {}; }),
    getRoutingPreferences: jest.fn(function () { return {}; }),
    getCrewDefaults: jest.fn(function () { return {}; }),
    getServiceCatalog: jest.fn(function () { return []; }),
    getFinancialDefaults: jest.fn(function () { return profile.financial; }),
    getSchedulingDefaults: jest.fn(function () { return {}; }),
    getPolarisPreferences: jest.fn(function () { return {}; }),
    getRetellPreferences: jest.fn(function () { return {}; }),
    getNotificationPreferences: jest.fn(function () { return {}; }),
  };
});

const request = require('supertest');
const { app } = require('../../src/server');
const { generateToken } = require('../../src/auth/middleware');
const canonicalPolaris = require('../../src/services/canonicalPolaris');
const db = require('../../src/db');
const leadsStore = require('../../src/leads/store');
const customersEngine = require('../../src/polaris/customer-engine');
const communicationsEngine = require('../../src/polaris/communications-engine');
const opportunitiesEngine = require('../../src/polaris/opportunity-engine');
const financialEngine = require('../../src/polaris/financial-engine');
const simulationIdempotency = require('../../src/services/simulationIdempotency');

const token = generateToken({
  id: 'test-owner',
  email: 'owner@test.local',
  name: 'Test Owner',
});

const otherToken = generateToken({
  id: 'other-owner',
  email: 'other@test.local',
  name: 'Other Owner',
});

function authorized(testRequest) {
  return testRequest.set('Authorization', 'Bearer ' + token);
}

describe('stabilization public API contracts', function () {
  test('permissioned public v1 leads handler is not shadowed by dashboard routes', async function () {
    const unauthenticated = await request(app).get('/api/v1/leads');
    expect(unauthenticated.status).toBe(401);

    const response = await authorized(request(app).get('/api/v1/leads'));
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['data', 'pagination']);
    expect(response.body).toEqual({
      data: [],
      pagination: { cursor: null, hasMore: false },
    });
    expect(response.body).not.toHaveProperty('leads');
  });

  test('permissioned public v1 calls handler applies organization and demo-session predicates', async function () {
    expect((await request(app).get('/api/v1/calls?sessionId=session-a')).status).toBe(401);
    db.query.mockClear();

    const response = await authorized(request(app).get('/api/v1/calls?sessionId=session-a'));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      pagination: { cursor: null, hasMore: false },
    });

    const callQuery = db.query.mock.calls.find(function (call) {
      return /FROM call_records WHERE/.test(String(call[0]));
    });
    expect(callQuery).toBeDefined();
    expect(callQuery[0]).toContain('organization_id');
    expect(callQuery[0]).toContain('retell_call_id LIKE');
    expect(callQuery[0]).toContain('source IS DISTINCT FROM');
    expect(callQuery[1]).toEqual(expect.arrayContaining([
      'org-test-owner',
      'simulation',
      'northstar-sim:session-a:%',
    ]));
  });

  test('actual server mount enforces auth and filters customer summaries by full-record session ownership', async function () {
    const unauthenticated = await request(app).get('/api/v1/customers?sessionId=session-a');
    expect(unauthenticated.status).toBe(401);

    const response = await authorized(request(app).get('/api/v1/customers?sessionId=session-a'));
    expect(response.status).toBe(200);
    expect(response.headers['x-polaris-engines-version']).toBe('13.0');
    expect(response.body.customers.map(function (customer) { return customer.id; })).toEqual([
      'cust-tenant',
      'cust-a',
    ]);
    expect(response.body.total).toBe(2);
    response.body.customers.forEach(function (customer) {
      expect(customer).not.toHaveProperty('metadata');
    });
  });

  test('communications are session-filtered before limit and offset are applied', async function () {
    const firstPage = await authorized(request(app)
      .get('/api/v1/communications?sessionId=session-a&type=call&limit=2&offset=0'));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.total).toBe(3);
    expect(firstPage.body.communications.map(function (item) { return item.id; })).toEqual([
      'comm-tenant',
      'comm-a-1',
    ]);

    const secondPage = await authorized(request(app)
      .get('/api/v1/communications?sessionId=session-a&type=call&limit=2&offset=1'));
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.total).toBe(3);
    expect(secondPage.body.communications.map(function (item) { return item.id; })).toEqual([
      'comm-a-1',
      'comm-a-2',
    ]);
  });

  test('legacy intelligence routes preserve dashboard envelope and lead-ID detail semantics', async function () {
    const dashboard = await authorized(request(app)
      .get('/api/v1/leads/intelligence/dashboard?sessionId=session-a'));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toEqual({
      success: true,
      data: { leadIds: ['lead-tenant', 'lead-a'] },
    });

    const detail = await authorized(request(app)
      .get('/api/v1/leads/lead-a/intelligence?sessionId=session-a'));
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({
      success: true,
      data: { customerId: 'lead-a', name: 'Session A Lead', totalLeads: 2 },
    });

    const hiddenWithoutSession = await authorized(request(app)
      .get('/api/v1/leads/lead-a/intelligence'));
    expect(hiddenWithoutSession.status).toBe(404);
    expect(hiddenWithoutSession.body).toEqual({ success: false, error: 'Lead not found' });

    const wrongOwner = await request(app)
      .get('/api/v1/leads/lead-a/intelligence?sessionId=session-a')
      .set('Authorization', 'Bearer ' + otherToken);
    expect(wrongOwner.status).toBe(404);
    expect(wrongOwner.body).toEqual({ success: false, error: 'Lead not found' });

    const unauthenticated = await request(app)
      .get('/api/v1/leads/lead-a/intelligence?sessionId=session-a');
    expect(unauthenticated.status).toBe(401);
  });

  test('canonical customer Polaris endpoint returns exactly the public canonical fields', async function () {
    const response = await authorized(request(app)
      .get('/api/v1/customers/cust-a/polaris?sessionId=session-a'));
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.customerId).toBe('cust-a');
    expect(Object.keys(response.body.data).sort()).toEqual(canonicalPolaris.PUBLIC_FIELDS.slice().sort());
    expect(response.body.data).toEqual(canonicalPolaris.sanitize(mockCanonicalCustomer));
    expect(response.body.data).not.toHaveProperty('metadata');
    expect(JSON.stringify(response.body.data)).not.toContain('(555) 000-0101');

    const hiddenWithoutSession = await authorized(request(app)
      .get('/api/v1/customers/cust-a/polaris'));
    expect(hiddenWithoutSession.status).toBe(404);
  });

  test('legacy pipeline shape is preserved while other-session opportunities are excluded', async function () {
    const response = await authorized(request(app)
      .get('/api/v1/opportunities/pipeline?sessionId=session-a'));
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['forecast', 'metrics', 'pipeline', 'stages']);
    expect(response.body.pipeline).toMatchObject({
      totalDeals: 4,
      totalValue: 6500,
      weightedValue: 4450,
      stageCounts: { lead: 1, qualified: 0, negotiation: 1 },
      stageValues: { lead: 1000, qualified: 0, negotiation: 2000 },
    });
    expect(response.body.pipeline.byStage.lead.map(function (item) { return item.id; }))
      .toEqual(['opp-tenant-open']);
    expect(response.body.pipeline.byStage.negotiation.map(function (item) { return item.id; }))
      .toEqual(['opp-a-open']);
    expect(response.body.metrics).toMatchObject({
      totalDeals: 4,
      activeDeals: 2,
      wonDeals: 1,
      lostDeals: 1,
      totalPipelineValue: 3000,
      weightedPipelineValue: 1450,
      wonValue: 3000,
      averageDealValue: 1625,
      averageOpportunityValue: 1500,
      winRate: 50,
      lossRate: 50,
      staleDeals: 0,
      winRateDisplay: '50%',
      lossRateDisplay: '50%',
    });
    expect(response.body.stages).toEqual(expect.objectContaining({
      stages: expect.any(Object),
      conversionRates: expect.any(Object),
    }));
    expect(response.body.forecast).toMatchObject({
      totalActiveDeals: 2,
      totalActiveValue: 3000,
      weightedPipelineValue: 1450,
      lateStageValue: 1400,
      forecast: { worstCase: 725, mostLikely: 1450, bestCase: 3000 },
      calculatedAt: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toContain('opp-hidden');
    expect(JSON.stringify(response.body)).not.toContain('9000');
  });

  test('simulation persists one canonical graph, retains v1 aliases, and returns the DB call-record ID', async function () {
    customersEngine.createCustomer.mockClear();
    communicationsEngine.recordCommunication.mockClear();
    opportunitiesEngine.createOpportunity.mockClear();
    financialEngine.createEstimate.mockClear();
    leadsStore.addLead.mockClear();
    db.query.mockClear();

    const random = jest.spyOn(Math, 'random').mockReturnValue(0.25);
    const log = jest.spyOn(console, 'log').mockImplementation(function () {});
    let response;
    try {
      response = await authorized(request(app)
        .post('/api/v1/simulations/leads')
        .send({
          name: 'Contract Test Customer',
          phone: '(555) 111-2222',
          email: 'contract@test.local',
          service: 'concrete',
          sessionId: 'session-a',
          idempotencyKey: 'contract-request-1',
        }));
    } finally {
      random.mockRestore();
      log.mockRestore();
    }

    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual([
      'ids', 'polaris', 'records', 'sessionId', 'success', 'summary', 'transcript',
    ]);
    expect(response.body.success).toBe(true);
    expect(response.body.sessionId).toBe('session-a');
    expect(response.body.ids).toEqual({
      customer: 'cust-created',
      communication: 'comm-created',
      opportunity: 'opp-created',
      estimate: 'est-created',
      lead: 'lead-created',
      callRecord: 'db-call-created',
    });

    const customerInput = customersEngine.createCustomer.mock.calls[0][0];
    const communicationInput = communicationsEngine.recordCommunication.mock.calls[0][0];
    const opportunityInput = opportunitiesEngine.createOpportunity.mock.calls[0][0];
    const estimateInput = financialEngine.createEstimate.mock.calls[0][0];
    const leadInput = leadsStore.addLead.mock.calls[0][0];

    expect(communicationInput.metadata).toBe(customerInput.metadata);
    expect(opportunityInput.metadata).toBe(customerInput.metadata);
    expect(estimateInput.metadata).toBe(customerInput.metadata);
    expect(customerInput.metadata.polarisIntelligence).toBe(
      communicationInput.metadata.polarisIntelligence
    );
    expect(customerInput.metadata.polarisIntelligence).toBe(
      opportunityInput.metadata.polarisIntelligence
    );
    expect(customerInput.metadata.polarisIntelligence).toBe(
      estimateInput.metadata.polarisIntelligence
    );

    expect(communicationInput.customerId).toBe('cust-created');
    expect(opportunityInput.customerId).toBe('cust-created');
    expect(estimateInput).toMatchObject({
      customerId: 'cust-created',
      opportunityId: 'opp-created',
    });
    expect(leadInput).toMatchObject({
      recordScope: 'simulation',
      source: 'simulation',
      simulationSessionId: 'session-a',
        ownerUserId: 'test-owner',
      demoSessionId: 'session-a',
      canonicalCustomerId: 'cust-created',
      canonicalCommunicationId: 'comm-created',
      canonicalOpportunityId: 'opp-created',
      canonicalEstimateId: 'est-created',
    });

    const persistedCanonical = customerInput.metadata.polarisIntelligence;
    const responseCanonical = canonicalPolaris.PUBLIC_FIELDS.reduce(function (result, field) {
      result[field] = response.body.polaris[field];
      return result;
    }, {});
    expect(responseCanonical).toEqual(canonicalPolaris.sanitize(persistedCanonical));
    expect(response.body.polaris).not.toHaveProperty('metadata');
    expect(response.body.polaris).toMatchObject({
      detectedIntent: response.body.polaris.customerIntent,
      classifiedService: response.body.polaris.service,
      classificationConfidence: response.body.polaris.serviceClassification.confidence,
      alternatives: response.body.polaris.serviceClassification.alternatives,
      qualificationStatus: response.body.polaris.qualification,
      evidence: Object.values(response.body.polaris.supportingEvidence),
      extractedScope: Object.keys(response.body.polaris.scope).map(function (key) {
        return key + ': ' + response.body.polaris.scope[key];
      }),
      confidence: expect.objectContaining({
        score: response.body.polaris.confidenceScore,
        explanation: response.body.polaris.confidenceExplanation,
      }),
    });

    const dbInsert = db.query.mock.calls.find(function (call) {
      return /INSERT INTO call_records/.test(String(call[0]));
    });
    expect(dbInsert).toBeDefined();
    expect(dbInsert[1]).toEqual([
      'org-test-owner',
      expect.stringMatching(/^northstar-sim:session-a:/),
      'Contract Test Customer',
      '(555) 111-2222',
      response.body.summary.service,
      response.body.summary.estimatedValue,
      opportunityInput.description,
      'completed',
      'lead-captured',
      'simulation',
      false,
    ]);
  });

  test('raw lead list, detail, transcript export, update, and delete enforce owner plus active session', async function () {
    const realLead = { id: 'raw-real', customerName: 'Durable Raw Lead', transcript: 'durable transcript' };
    const ownedLead = {
      id: 'raw-owned',
      customerName: 'Owned Raw Simulation',
      transcript: 'owned transcript',
      recordScope: 'simulation',
      source: 'simulation',
      simulationSessionId: 'raw-session',
      ownerUserId: 'test-owner',
    };
    const foreignLead = {
      id: 'raw-foreign',
      customerName: 'Foreign Raw Simulation',
      transcript: 'foreign transcript secret',
      recordScope: 'simulation',
      source: 'simulation',
      simulationSessionId: 'raw-session',
      ownerUserId: 'other-owner',
    };
    const records = [realLead, ownedLead, foreignLead];
    leadsStore.getAllLeads.mockImplementation(function () { return records.slice(); });
    leadsStore.getLead.mockImplementation(function (id) {
      return records.find(function (record) { return record.id === id; }) || null;
    });
    leadsStore.updateLead.mockImplementation(function (id, updates) {
      return Object.assign({}, records.find(function (record) { return record.id === id; }), updates);
    });
    leadsStore.removeLead.mockImplementation(function (id) {
      return records.find(function (record) { return record.id === id; }) || null;
    });

    try {
      expect((await request(app).get('/api/leads?sessionId=raw-session')).status).toBe(401);

      const list = await authorized(request(app).get('/api/leads?sessionId=raw-session'));
      expect(list.body.items.map(function (lead) { return lead.id; })).toEqual(['raw-real', 'raw-owned']);

      const missingSession = await authorized(request(app).get('/api/leads'));
      expect(missingSession.body.items.map(function (lead) { return lead.id; })).toEqual(['raw-real']);

      const wrongOwnerList = await request(app).get('/api/leads?sessionId=raw-session')
        .set('Authorization', 'Bearer ' + otherToken);
      expect(wrongOwnerList.body.items.map(function (lead) { return lead.id; }))
        .toEqual(['raw-real', 'raw-foreign']);

      expect((await authorized(request(app).get('/api/leads/raw-owned?sessionId=raw-session'))).status).toBe(200);
      expect((await authorized(request(app).get('/api/leads/raw-owned'))).status).toBe(404);
      expect((await request(app).get('/api/leads/raw-owned?sessionId=raw-session')
        .set('Authorization', 'Bearer ' + otherToken)).status).toBe(404);

      const csv = await authorized(request(app).get('/api/leads/export?sessionId=raw-session'));
      expect(csv.status).toBe(200);
      expect(csv.text).toContain('owned transcript');
      expect(csv.text).not.toContain('foreign transcript secret');

      expect((await authorized(request(app).put('/api/leads/raw-owned')
        .send({ customerName: 'Blocked' }))).status).toBe(404);
      expect((await authorized(request(app).delete('/api/leads/raw-owned'))).status).toBe(404);
      expect(leadsStore.updateLead).not.toHaveBeenCalled();
      expect(leadsStore.removeLead).not.toHaveBeenCalled();

      expect((await authorized(request(app).put('/api/leads/raw-owned?sessionId=raw-session')
        .send({ customerName: 'Allowed' }))).status).toBe(200);
      expect((await authorized(request(app).delete('/api/leads/raw-owned?sessionId=raw-session'))).status).toBe(200);
      expect(leadsStore.updateLead).toHaveBeenCalledTimes(1);
      expect(leadsStore.removeLead).toHaveBeenCalledTimes(1);
    } finally {
      leadsStore.getAllLeads.mockImplementation(function () { return []; });
      leadsStore.getLead.mockImplementation(function () { return null; });
      leadsStore.updateLead.mockImplementation(function () { return null; });
      leadsStore.removeLead.mockImplementation(function () { return null; });
    }
  });

  function postSimulation(key) {
    return authorized(request(app)
      .post('/api/v1/simulations/leads')
      .send({
        name: 'Persistence Boundary Customer',
        phone: '(555) 222-3333',
        email: 'persistence@test.local',
        service: 'concrete',
        sessionId: 'session-persistence',
        idempotencyKey: key,
      }));
  }

  test.each([
    ['customer', function () {
      customersEngine.createCustomer.mockReturnValueOnce({ error: 'forced customer failure' });
    }],
    ['communication', function () {
      communicationsEngine.recordCommunication.mockReturnValueOnce({ error: 'forced communication failure' });
    }],
    ['opportunity', function () {
      opportunitiesEngine.createOpportunity.mockReturnValueOnce({ error: 'forced opportunity failure' });
    }],
    ['estimate', function () {
      financialEngine.createEstimate.mockReturnValueOnce({ error: 'forced estimate failure' });
    }],
    ['lead', function () {
      leadsStore.addLead.mockReturnValueOnce(null);
    }],
  ])('never returns 201 when the %s persistence boundary fails', async function (stage, injectFailure) {
    simulationIdempotency.resetForTests();
    injectFailure();
    const response = await postSimulation('failure-' + stage);
    expect(response.status).toBe(500);
    expect(response.body.stage).toBe(stage);
    expect(response.body.success).not.toBe(true);
  });

  test('never returns 201 when PostgreSQL persistence fails', async function () {
    simulationIdempotency.resetForTests();
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(function (sql) {
      if (/INSERT INTO call_records/.test(String(sql))) {
        return Promise.reject(new Error('forced PostgreSQL failure'));
      }
      return original(sql);
    });
    try {
      const response = await postSimulation('failure-postgres');
      expect(response.status).toBe(500);
      expect(response.body.stage).toBe('call_record');
      expect(response.body.success).not.toBe(true);
    } finally {
      db.query.mockImplementation(original);
    }
  });

  test('sequential duplicate keys replay one canonical graph', async function () {
    simulationIdempotency.resetForTests();
    customersEngine.createCustomer.mockClear();
    communicationsEngine.recordCommunication.mockClear();
    opportunitiesEngine.createOpportunity.mockClear();
    financialEngine.createEstimate.mockClear();
    leadsStore.addLead.mockClear();

    const first = await postSimulation('duplicate-sequential');
    const second = await postSimulation('duplicate-sequential');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.ids).toEqual(first.body.ids);
    expect(customersEngine.createCustomer).toHaveBeenCalledTimes(1);
    expect(communicationsEngine.recordCommunication).toHaveBeenCalledTimes(1);
    expect(opportunitiesEngine.createOpportunity).toHaveBeenCalledTimes(1);
    expect(financialEngine.createEstimate).toHaveBeenCalledTimes(1);
    expect(leadsStore.addLead).toHaveBeenCalledTimes(1);
  });

  test('concurrent duplicate keys coalesce before PostgreSQL completes', async function () {
    simulationIdempotency.resetForTests();
    customersEngine.createCustomer.mockClear();
    const original = db.query.getMockImplementation();
    let releaseSelect;
    let markSelectStarted;
    const selectStarted = new Promise(function (resolve) { markSelectStarted = resolve; });
    const selectGate = new Promise(function (resolve) { releaseSelect = resolve; });
    db.query.mockImplementation(function (sql) {
      if (/SELECT id FROM call_records/.test(String(sql))) {
        markSelectStarted();
        return selectGate;
      }
      return original(sql);
    });

    try {
      const firstPromise = postSimulation('duplicate-concurrent').then(function (response) { return response; });
      await selectStarted;
      const secondPromise = postSimulation('duplicate-concurrent').then(function (response) { return response; });
      releaseSelect({ rows: [] });
      const results = await Promise.all([firstPromise, secondPromise]);
      expect(results.map(function (response) { return response.status; })).toEqual([201, 201]);
      expect(results[1].body.ids).toEqual(results[0].body.ids);
      expect(customersEngine.createCustomer).toHaveBeenCalledTimes(1);
    } finally {
      db.query.mockImplementation(original);
    }
  });

  test('PostgreSQL retry identity reuses an existing organization-owned call record', async function () {
    simulationIdempotency.resetForTests();
    db.query.mockClear();
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(function (sql) {
      if (/SELECT id FROM call_records/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 'db-call-reused' }] });
      }
      return original(sql);
    });
    try {
      const response = await postSimulation('postgres-reuse');
      expect(response.status).toBe(201);
      expect(response.body.ids.callRecord).toBe('db-call-reused');
      const select = db.query.mock.calls.find(function (call) {
        return /SELECT id FROM call_records/.test(String(call[0]));
      });
      expect(select[1][0]).toBe('org-test-owner');
      expect(select[1][1]).toMatch(/^northstar-sim:session-persistence:/);
      const inserts = db.query.mock.calls.filter(function (call) {
        return /INSERT INTO call_records/.test(String(call[0]));
      });
      expect(inserts).toHaveLength(0);
    } finally {
      db.query.mockImplementation(original);
    }
  });
});
