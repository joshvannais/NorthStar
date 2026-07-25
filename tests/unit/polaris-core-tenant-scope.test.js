'use strict';

const records = {
  jobs: [],
  estimates: [],
  metrics: [],
  crews: [],
  recommendations: []
};

jest.mock('../../src/polaris/store', function () {
  function add(collection, value) {
    const saved = Object.assign({ id: collection + '-' + (records[collection].length + 1) }, value);
    records[collection].push(saved);
    return saved;
  }
  return {
    init: jest.fn(),
    addJob: jest.fn(function (value) { return add('jobs', value); }),
    getAllJobs: jest.fn(function () { return records.jobs; }),
    addEstimate: jest.fn(function (value) { return add('estimates', value); }),
    getAllEstimates: jest.fn(function () { return records.estimates; }),
    addMetric: jest.fn(function (value) { return add('metrics', value); }),
    getAllMetrics: jest.fn(function () { return records.metrics; }),
    getAllCrews: jest.fn(function () { return records.crews; }),
    addRecommendation: jest.fn(function (value) { return add('recommendations', value); }),
    getAllRecommendations: jest.fn(function () { return records.recommendations; }),
    getUnresolvedRecommendations: jest.fn(function () {
      return records.recommendations.filter(function (record) { return !record.resolved; });
    }),
    resolveRecommendation: jest.fn(function (id) {
      const record = records.recommendations.find(function (item) { return item.id === id; });
      if (record) record.resolved = true;
      return record || null;
    })
  };
});

const demoScope = require('../../src/services/demoRecordScope');
const estimation = require('../../src/polaris/estimation');
const learning = require('../../src/polaris/learning');
const recommendations = require('../../src/polaris/recommendations');
const engine = require('../../src/polaris/engine');

function access(orgId, userId) {
  return {
    orgId,
    user: { id: userId },
    query: {},
    body: {}
  };
}

function metadata(orgId, userId) {
  return { organizationId: orgId, ownerUserId: userId };
}

describe('Polaris core tenant containment', function () {
  beforeEach(function () {
    Object.keys(records).forEach(function (key) { records[key].length = 0; });
    estimation.resetConfig();
  });

  test('runtime estimation configuration is partitioned by persisted organization', function () {
    demoScope.runWithAccess(access('org-a', 'admin-a'), function () {
      estimation.loadConfig({ laborRates: { General: 123 } });
      expect(estimation.getConfig().laborRates.General).toBe(123);
    });
    demoScope.runWithAccess(access('org-b', 'admin-b'), function () {
      expect(estimation.getConfig().laborRates.General).toBe(80);
    });
    demoScope.runWithAccess(access('org-a', 'admin-a'), function () {
      expect(estimation.getConfig().laborRates.General).toBe(123);
    });
  });

  test('estimates and generated recommendations retain tenant ownership', function () {
    demoScope.runWithAccess(access('org-a', 'member-a'), function () {
      estimation.generateEstimate({
        serviceType: 'General',
        metadata: metadata('org-a', 'member-a')
      });
      recommendations.generateRecommendations({
        leads: [{ id: 'owned-lead', status: 'new', metadata: metadata('org-a', 'member-a') }],
        metadata: metadata('org-a', 'member-a')
      });
    });

    expect(records.estimates[0].metadata).toEqual(metadata('org-a', 'member-a'));
    expect(records.recommendations.length).toBeGreaterThan(0);
    records.recommendations.forEach(function (record) {
      expect(record.metadata).toEqual(metadata('org-a', 'member-a'));
    });
  });

  test('learning jobs and metrics are stamped and default-denied to another organization', function () {
    demoScope.runWithAccess(access('org-a', 'member-a'), function () {
      learning.recordCompletion({
        serviceType: 'General',
        estimatedDuration: 2,
        actualDuration: 3,
        estimatedRevenue: 100,
        actualRevenue: 120,
        metadata: metadata('org-a', 'member-a')
      });
      expect(learning.getLearningSummary().totalCompletedJobs).toBe(1);
      expect(engine.getCompletedJobs()).toHaveLength(1);
      expect(engine.getLearningMetrics().length).toBeGreaterThan(0);
    });

    records.jobs.forEach(function (record) {
      expect(record.metadata).toEqual(metadata('org-a', 'member-a'));
    });
    records.metrics.forEach(function (record) {
      expect(record.metadata).toEqual(metadata('org-a', 'member-a'));
    });
    demoScope.runWithAccess(access('org-b', 'member-b'), function () {
      expect(learning.getLearningSummary().totalCompletedJobs).toBe(0);
      expect(engine.getCompletedJobs()).toEqual([]);
      expect(engine.getLearningMetrics()).toEqual([]);
    });
  });
});
