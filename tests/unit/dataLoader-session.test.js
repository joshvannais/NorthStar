'use strict';

jest.mock('fs', function () {
  const actualFs = jest.requireActual('fs');
  const dataFiles = {
    'leads.json': [
      {
        id: 'tenant-linked',
        caller: 'Tenant Customer',
        canonicalOpportunityId: 'tenant-opportunity',
      },
      {
        id: 'active-sim-linked',
        caller: 'Active Simulation',
        canonicalOpportunityId: 'active-sim-opportunity',
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-a',
      },
      {
        id: 'other-sim-linked',
        caller: 'Other Simulation',
        canonicalOpportunityId: 'other-sim-opportunity',
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-b',
      },
      {
        id: 'active-sim-unlinked',
        caller: 'Active Unlinked Simulation',
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-a',
      },
    ],
    'customers.json': [],
    'events.json': [],
    'polaris-estimates.json': [],
    'polaris-jobs.json': [],
    'polaris-metrics.json': {},
    'polaris-recommendations.json': [],
    'polaris-crews.json': [],
  };

  return Object.assign({}, actualFs, {
    readFileSync: jest.fn(function (filePath, encoding) {
      const normalized = String(filePath).replace(/\\/g, '/');
      const fileName = normalized.split('/').pop();
      if (normalized.indexOf('/data/') !== -1 && Object.prototype.hasOwnProperty.call(dataFiles, fileName)) {
        return JSON.stringify(dataFiles[fileName]);
      }
      return actualFs.readFileSync(filePath, encoding);
    }),
  });
});

jest.mock('../../src/polaris/store', function () {
  return { getAllRecommendations: jest.fn(function () { return []; }) };
});

jest.mock('../../src/polaris/customer-engine', function () {
  const records = {
    'tenant-customer': {
      id: 'tenant-customer',
      name: 'Durable Tenant Customer',
      status: 'active',
    },
    'session-customer': {
      id: 'session-customer',
      name: 'Current Session Customer',
      status: 'active',
      metadata: {
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-a',
      },
    },
    'other-session-customer': {
      id: 'other-session-customer',
      name: 'Other Session Customer',
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
  };
});

jest.mock('../../src/polaris/opportunity-engine', function () {
  return {
    listOpportunities: jest.fn(function () {
      return { opportunities: [], total: 0 };
    }),
  };
});

jest.mock('../../src/polaris/communications-engine', function () {
  return {
    getAllCommunications: jest.fn(function () {
      return { communications: [], total: 0 };
    }),
  };
});

jest.mock('../../src/polaris/financial-engine', function () {
  return {
    listEstimates: jest.fn(function () {
      return {
        estimates: [
          {
            id: 'tenant-estimate',
            customerId: 'tenant-customer',
            total: 1200,
          },
          {
            id: 'session-estimate',
            customerId: 'session-customer',
            total: 900,
            metadata: {
              recordScope: 'simulation',
              source: 'simulation',
              simulationSessionId: 'session-a',
            },
          },
          {
            id: 'other-session-estimate',
            customerId: 'other-session-customer',
            total: 1800,
            metadata: {
              recordScope: 'simulation',
              source: 'simulation',
              simulationSessionId: 'session-b',
            },
          },
        ],
        total: 3,
      };
    }),
  };
});

const dataLoader = require('../../src/services/dataLoader');

describe('dataLoader session-scoped canonical merge', function () {
  test('retains durable linked tenant data while de-duplicating simulated linked leads', function () {
    const scoped = dataLoader.loadCanonicalData('session-a');

    expect(scoped.leads.map(function (lead) { return lead.id; })).toEqual([
      'tenant-linked',
      'active-sim-unlinked',
    ]);
    expect(scoped.leads.find(function (lead) { return lead.id === 'tenant-linked'; }))
      .toMatchObject({ canonicalOpportunityId: 'tenant-opportunity' });
    expect(scoped.leads.some(function (lead) { return lead.id === 'active-sim-linked'; })).toBe(false);
    expect(scoped.leads.some(function (lead) { return lead.id === 'other-sim-linked'; })).toBe(false);

    expect(scoped.customers.map(function (customer) { return customer.id; })).toEqual([
      'tenant-customer',
      'session-customer',
    ]);
    expect(scoped.estimates.map(function (estimate) { return estimate.id; })).toEqual([
      'tenant-estimate',
      'session-estimate',
    ]);
  });
});
