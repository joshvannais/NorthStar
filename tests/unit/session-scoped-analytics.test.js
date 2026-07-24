'use strict';

const mockState = {
  opportunities: [],
  estimates: [],
  customers: [],
  revenueByCustomer: {},
};

const mockPipelineStages = Object.freeze({
  lead: { displayName: 'Lead', category: 'active' },
  qualified: { displayName: 'Qualified', category: 'active' },
  negotiation: { displayName: 'Negotiation', category: 'active' },
  verbalCommitment: { displayName: 'Verbal Commitment', category: 'active' },
  won: { displayName: 'Won', category: 'closed' },
  lost: { displayName: 'Lost', category: 'closed' },
});

const mockDataLoader = {
  loadData: jest.fn(function () {
    throw new Error('loadData must not run when scopedData is supplied');
  }),
};

jest.mock('../../src/polaris/store', () => ({
  getAllRecommendations: jest.fn(() => []),
}));

jest.mock('../../src/services/dataLoader', () => mockDataLoader);

jest.mock('../../src/polaris/opportunity-engine', () => ({
  PIPELINE_STAGES: mockPipelineStages,
  listOpportunities: jest.fn(() => ({
    opportunities: mockState.opportunities.slice(),
    total: mockState.opportunities.length,
  })),
}));

jest.mock('../../src/polaris/financial-engine', () => ({
  getFinancialMetrics: jest.fn(() => ({
    totalRevenue: 0,
    totalInvoiced: 0,
    totalOutstanding: 0,
    averageInvoiceValue: 0,
    collectionRate: 0,
    pendingEstimateCount: 999,
    pendingEstimateTotal: 999999,
    sentinel: 'preserved',
  })),
  listEstimates: jest.fn(() => ({
    estimates: mockState.estimates.slice(),
    total: mockState.estimates.length,
  })),
  calculateProfitability: jest.fn(() => ({ totalRevenue: 0, collectionRateDisplay: '0%' })),
  calculateRevenueForecast: jest.fn(months => ({ forecastMonths: months, totalForecast: 500 })),
  calculateCustomerRevenue: jest.fn(customerId => ({
    totalRevenue: mockState.revenueByCustomer[customerId] || 0,
  })),
}));

jest.mock('../../src/polaris/customer-engine', () => ({
  listCustomers: jest.fn(() => ({
    // Deliberately omit metadata, matching the engine's public list shape.
    customers: mockState.customers.map(customer => ({
      id: customer.id,
      name: customer.name,
      status: customer.status,
    })),
    total: mockState.customers.length,
  })),
  getCustomer: jest.fn(id => mockState.customers.find(customer => customer.id === id) || { error: 'not found' }),
}));

jest.mock('../../src/polaris/workflow-engine', () => ({
  getWorkflowMetrics: jest.fn(() => ({
    totalTasks: 0,
    completedTasks: 0,
    overdueTasks: 0,
    completionRate: 0,
    avgCompletionTimeHours: 0,
  })),
}));

jest.mock('../../src/polaris/job-engine', () => ({
  getJobMetrics: jest.fn(() => ({
    totalJobs: 0,
    completedJobs: 0,
    inProgressJobs: 0,
    openIssues: 0,
  })),
}));

jest.mock('../../src/polaris/asset-engine', () => ({
  getAssetMetrics: jest.fn(() => ({
    totalAssets: 0,
    inMaintenance: 0,
    outOfService: 0,
    upcomingMaintenance: 0,
    totalValue: 0,
  })),
}));

jest.mock('../../src/polaris/crew-engine', () => ({
  getCrewMetrics: jest.fn(() => ({
    totalEmployees: 0,
    totalCrews: 0,
    deployedCrews: 0,
    totalLaborCost: 0,
    expiredCertifications: 0,
  })),
}));

const sessionScopedOpportunity = require('../../src/services/sessionScopedOpportunity');
const analytics = require('../../src/polaris/analytics-engine');
const businessContext = require('../../src/context/business');
const opportunityEngine = require('../../src/polaris/opportunity-engine');

function simulationMetadata(sessionId) {
  return {
    recordScope: 'simulation',
    source: 'simulation',
    simulationSessionId: sessionId,
  };
}

function opportunity(id, value, expectedRevenue, extra) {
  return Object.assign({
    id,
    customerId: 'customer-' + id,
    title: 'Test opportunity',
    status: 'open',
    stage: 'lead',
    estimatedValue: value,
    expectedRevenue,
    lastActivity: new Date().toISOString(),
  }, extra || {});
}

function estimate(id, total, extra) {
  return Object.assign({ id, total, status: 'draft' }, extra || {});
}

function customer(id, extra) {
  return Object.assign({ id, name: id, status: 'active' }, extra || {});
}

function expectExactKeys(value, keys) {
  expect(Object.keys(value).sort()).toEqual(keys.slice().sort());
}

function setMixedSessionData() {
  mockState.opportunities = [
    opportunity('real', 1000, 100),
    opportunity('session-a', 2000, 1000, {
      stage: 'negotiation',
      metadata: simulationMetadata('session-a'),
    }),
    opportunity('session-b', 9000, 4500, {
      stage: 'verbalCommitment',
      metadata: simulationMetadata('session-b'),
    }),
  ];
  mockState.estimates = [
    estimate('estimate-real', 1000),
    estimate('estimate-a', 2000, { metadata: simulationMetadata('session-a') }),
    estimate('estimate-b', 9000, { metadata: simulationMetadata('session-b') }),
  ];
  mockState.customers = [
    customer('customer-real'),
    customer('customer-a', { metadata: simulationMetadata('session-a') }),
    customer('customer-b', { metadata: simulationMetadata('session-b') }),
  ];
  mockState.revenueByCustomer = {
    'customer-real': 100,
    'customer-a': 200,
    'customer-b': 900,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setMixedSessionData();
});

describe('session-scoped opportunity snapshot', () => {
  test('preserves the legacy shape and excludes records from another session', () => {
    const snapshot = sessionScopedOpportunity.buildSnapshot(opportunityEngine, 'session-a');

    expectExactKeys(snapshot, ['pipeline', 'metrics', 'stages', 'forecast']);
    expectExactKeys(snapshot.pipeline, [
      'totalDeals', 'totalValue', 'weightedValue', 'stageCounts', 'stageValues', 'byStage',
    ]);
    expectExactKeys(snapshot.metrics, [
      'totalDeals', 'activeDeals', 'wonDeals', 'lostDeals', 'totalPipelineValue',
      'weightedPipelineValue', 'wonValue', 'averageDealValue', 'averageOpportunityValue',
      'winRate', 'lossRate', 'staleDeals', 'winRateDisplay', 'lossRateDisplay',
    ]);
    expectExactKeys(snapshot.stages, ['stages', 'conversionRates']);
    expectExactKeys(snapshot.forecast, [
      'totalActiveDeals', 'totalActiveValue', 'weightedPipelineValue', 'lateStageValue',
      'forecast', 'calculatedAt',
    ]);

    expect(snapshot.pipeline.totalDeals).toBe(2);
    expect(snapshot.pipeline.totalValue).toBe(3000);
    const visibleIds = Object.values(snapshot.pipeline.byStage).flat().map(item => item.id);
    expect(visibleIds).toEqual(expect.arrayContaining(['real', 'session-a']));
    expect(visibleIds).not.toContain('session-b');
  });
});

describe('session-scoped KPIs', () => {
  test('no-session returns durable records only; active session adds only its simulation', () => {
    const durable = analytics.generateKPIs().kpis;
    const active = analytics.generateKPIs('session-a').kpis;

    expect(durable).toMatchObject({
      totalDeals: 1,
      activeDeals: 1,
      pipelineValue: 1000,
      weightedPipelineValue: 100,
      pendingEstimates: 1,
      estimatedPipelineValue: 1000,
      totalCustomers: 1,
    });
    expect(active).toMatchObject({
      totalDeals: 2,
      activeDeals: 2,
      pipelineValue: 3000,
      weightedPipelineValue: 1100,
      pendingEstimates: 2,
      estimatedPipelineValue: 3000,
      totalCustomers: 2,
    });
  });

  test('counts every non-rejected, non-archived estimate as pending', () => {
    mockState.estimates = [
      estimate('draft', 100, { status: 'draft' }),
      estimate('sent', 200, { status: 'sent' }),
      estimate('approved', 300, { status: 'approved' }),
      estimate('rejected', 400, { status: 'rejected' }),
      estimate('archived', 500, { status: 'archived' }),
    ];

    const kpis = analytics.generateKPIs().kpis;

    expect(kpis.pendingEstimates).toBe(3);
    expect(kpis.estimatedPipelineValue).toBe(600);
  });
});

describe('generic analytics session propagation', () => {
  test('sales preserves response keys and excludes the other session', () => {
    const result = analytics.getAnalytics('sales', 'session-a');

    expectExactKeys(result, ['title', 'pipeline', 'metrics', 'stageTotals', 'generatedAt']);
    expect(result.pipeline.totalDeals).toBe(2);
    expect(result.pipeline.totalValue).toBe(3000);
    expectExactKeys(result.stageTotals, ['stages', 'conversionRates']);
  });

  test('customer preserves response keys and scopes counts and revenue', () => {
    const result = analytics.getAnalytics('customer', 'session-a');

    expectExactKeys(result, [
      'title', 'totalCustomers', 'activeCustomers', 'totalRevenue',
      'avgRevenuePerCustomer', 'generatedAt',
    ]);
    expect(result).toMatchObject({
      totalCustomers: 2,
      activeCustomers: 2,
      totalRevenue: 300,
      avgRevenuePerCustomer: 150,
    });
  });

  test('financial preserves response keys and replaces only scoped estimate metrics', () => {
    const result = analytics.getAnalytics('financial', 'session-a');

    expectExactKeys(result, ['title', 'metrics', 'profitability', 'forecast', 'generatedAt']);
    expect(result.metrics).toMatchObject({
      pendingEstimateCount: 2,
      pendingEstimateTotal: 3000,
      sentinel: 'preserved',
    });
  });

  test('forecast preserves response keys and scopes the pipeline forecast', () => {
    const result = analytics.getAnalytics('forecast', 'session-a');

    expectExactKeys(result, [
      'title', 'revenueForecast', 'pipelineForecast', 'totalForecastRevenue', 'generatedAt',
    ]);
    expect(result.pipelineForecast.totalActiveDeals).toBe(2);
    expect(result.pipelineForecast.totalActiveValue).toBe(3000);
    expect(result.pipelineForecast.forecast.mostLikely).toBe(1100);
    expect(result.totalForecastRevenue).toBe(1600);
  });

  test('alerts preserves response keys and changes from baseline only for the active session', () => {
    mockState.opportunities = [
      opportunity('session-a-only', 2000, 1000, {
        metadata: simulationMetadata('session-a'),
      }),
      opportunity('session-b-only', 9000, 4500, {
        metadata: simulationMetadata('session-b'),
      }),
    ];
    mockState.estimates = [];
    mockState.customers = [
      customer('customer-a', { metadata: simulationMetadata('session-a') }),
      customer('customer-b', { metadata: simulationMetadata('session-b') }),
    ];

    const durable = analytics.getAnalytics('alerts');
    const active = analytics.getAnalytics('alerts', 'session-a');

    expectExactKeys(active, [
      'alerts', 'totalAlerts', 'criticalCount', 'warningCount', 'infoCount', 'generatedAt',
    ]);
    expect(durable.alerts.map(alert => alert.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Building baseline metrics'),
      expect.stringContaining('Building pipeline baseline'),
    ]));
    expect(active.alerts.map(alert => alert.message)).not.toEqual(expect.arrayContaining([
      expect.stringContaining('Building baseline metrics'),
      expect.stringContaining('Building pipeline baseline'),
    ]));
  });
});

describe('business context scoped-data injection', () => {
  test('both formatters use scopedData without calling loadData', () => {
    const scopedData = {
      leads: [],
      customers: [customer('scoped-customer')],
      events: [],
      estimates: [],
      jobs: [],
      metrics: {},
      recommendations: [],
      crews: [],
    };

    const text = businessContext.buildBusinessContext({ page: 'dashboard' }, null, scopedData);
    const compact = businessContext.buildCompactContext({ page: 'dashboard' }, null, scopedData);

    expect(text).toContain('Total customers: 1');
    expect(compact.overview).toMatchObject({ totalLeads: 0, totalCustomers: 1 });
    expect(mockDataLoader.loadData).not.toHaveBeenCalled();
  });
});
