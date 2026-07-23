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
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b' },
    },
    {
      id: 'comm-hidden-2', customerId: 'cust-b', type: 'call',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b' },
    },
    { id: 'comm-tenant', customerId: 'cust-tenant', type: 'call' },
    {
      id: 'comm-a-1', customerId: 'cust-a', type: 'call',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a' },
    },
    {
      id: 'comm-a-2', customerId: 'cust-a', type: 'call',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a' },
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
        polarisIntelligence: mockCanonicalCustomer,
      },
    },
    {
      id: 'opp-a-won', customerId: 'cust-a', title: 'Session A Won',
      stage: 'won', status: 'won', estimatedValue: 3000, expectedRevenue: 3000,
      lastActivity: '2099-01-01T00:00:00.000Z',
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-a' },
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
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b' },
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
        polarisIntelligence: mockCanonicalCustomer,
      },
    },
    {
      id: 'est-b', customerId: 'cust-b', total: 9000,
      metadata: { recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b' },
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
    },
    {
      id: 'lead-b', caller: 'Session B Lead', service: 'Roofing',
      recordScope: 'simulation', source: 'simulation', simulationSessionId: 'session-b',
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

const token = generateToken({
  id: 'test-owner',
  email: 'owner@test.local',
  name: 'Test Owner',
});

function authorized(testRequest) {
  return testRequest.set('Authorization', 'Bearer ' + token);
}

describe('stabilization public API contracts', function () {
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
});
