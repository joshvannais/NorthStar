'use strict';

const fs = require('node:fs');
const express = require('express');
const request = require('supertest');
const { createForecastNamedPipelineScenariosRouter,
  sanitizeNamedPipelineScenario, sanitizeReview } =
  require('../../src/routes/forecastNamedPipelineScenarios');

const id = '123e4567-e89b-42d3-a456-426614174000';

function unavailable(reason = 'no_current_scenario_review') {
  const scenario = { state: 'unavailable', reason,
    preliminaryEstimate: null, approvedUnbooked: null, total: null };
  return {
    version: 'm26-named-pipeline-scenario-v1', state: 'unavailable', reason,
    checkedAt: '2026-10-08T12:00:00.000000Z', asOf: null, horizon: null,
    currency: null,
    target: { key: 'pipeline.open_value_scenario', version: 'v1' },
    sourceSnapshot: null, scenarioReview: null,
    scenarios: { adverse: { ...scenario }, base: { ...scenario }, favorable: { ...scenario } },
    assumptions: [], digests: { source: null, assumptions: null, output: null,
      review: null, currentness: null },
    currentness: { reviewCurrent: false, sourceCurrent: false, policyCurrent: false,
      profileCurrent: false, refreshRequired: true,
      correctionOrRevocationApplied: false },
    sourceAuthenticated: false, assumptionSourcesAuthenticated: false,
    weightsAreScenarioAssumptions: true, probabilityCalibrated: false,
    percentilesIssued: false, earnedRevenueMeasured: false, cashMeasured: false,
    researchOnly: true, realForecastEligible: false, forecastIssued: false,
    paidNumericServing: false, automaticActionAuthorized: false,
  };
}

function saved() {
  return { state: 'named_scenario_review_saved', reason: null, reviewId: id,
    revision: 1, action: 'approve', digest: 'a'.repeat(64), replayed: false,
    valuesWithheld: true, forecastIssued: false, automaticActionAuthorized: false };
}

function appFor(result) {
  const queries = [];
  const client = { query: jest.fn(async (sql, params) => {
    queries.push({ sql, params });
    if (/canonical_forecast_named_scenario_v1_/.test(sql)) return { rows: [{ value: result }] };
    return { rows: [] };
  }), release: jest.fn() };
  const app = express(); app.use(express.json());
  app.use('/api/v1/forecast/named-pipeline-scenarios',
    createForecastNamedPipelineScenariosRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: id,
        userId: id }; req.authSession = { id }; req.userRole = 'owner'; next(); },
      permission: () => (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(),
    }));
  return { app, queries, client };
}

describe('Mission 26 original Part 9C named pipeline scenario boundary', () => {
  test('accepts only value-free named unavailable output', () => {
    const value = unavailable();
    expect(sanitizeNamedPipelineScenario(value)).toBe(value);
    for (const mutate of [
      item => { item.scenarios.base.total = '0.000000'; },
      item => { item.sourceAuthenticated = true; },
      item => { item.forecastIssued = true; },
      item => { item.currentness.refreshRequired = false; },
      item => { item.p10 = '1.000000'; },
    ]) {
      const candidate = JSON.parse(JSON.stringify(value)); mutate(candidate);
      expect(sanitizeNamedPipelineScenario(candidate)).toBeNull();
    }
  });

  test('mounts tenant-scoped current read and clears unavailable values', async () => {
    const fixture = appFor(unavailable());
    const response = await request(fixture.app)
      .get('/api/v1/forecast/named-pipeline-scenarios/current');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      forecastIssued: false, scenarios: { adverse: { total: null },
        base: { total: null }, favorable: { total: null } } });
    expect(fixture.queries.map(item => item.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '5s'", expect.stringMatching(/named_scenario_v1_current/),
      'COMMIT',
    ]);
    expect(fixture.queries[3].params).toEqual([id, id, 'owner', id]);
    expect((await request(fixture.app)
      .get('/api/v1/forecast/named-pipeline-scenarios/current?origin=x')).status).toBe(400);
  });

  test('normalizes no scenario values through the append-only review receipt', async () => {
    const receipt = saved();
    expect(sanitizeReview(receipt)).toBe(receipt);
    const fixture = appFor(receipt);
    const assumptions = [{ estimateId: id, estimateSnapshotDigest: 'b'.repeat(64),
      category: 'preliminary_estimate', variations: {
        adverse: { weightPpm: 200000, reason: 'Weather may defer this exact estimate.' },
        base: { weightPpm: 333333, reason: 'Use the approved current policy for this estimate.' },
        favorable: { weightPpm: 500000,
          reason: 'Confirmed access may advance this exact estimate.' },
      } }];
    const response = await request(fixture.app)
      .post('/api/v1/forecast/named-pipeline-scenarios/reviews')
      .set('Idempotency-Key', 'part9c-unit-request-0001')
      .send({ action: 'approve', expectedRevision: 0, expectedDigest: 'none', assumptions,
        reason: 'Approve explicit estimate-specific scenario assumptions.', confirmed: true,
        confirmationVersion: 'named-pipeline-scenario-review-v1' });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(receipt);
    expect(fixture.queries[3].params.slice(0, 4)).toEqual([id, id, 'owner', id]);
    expect(fixture.queries[3].params.slice(6, 10)).toEqual(['approve', 0, 'none',
      JSON.stringify(assumptions)]);
  });

  test('preserves SQL null for a revoke instead of creating JSON null', async () => {
    const receipt = { ...saved(), revision: 2, action: 'revoke' };
    const fixture = appFor(receipt);
    const response = await request(fixture.app)
      .post('/api/v1/forecast/named-pipeline-scenarios/reviews')
      .set('Idempotency-Key', 'part9c-unit-revoke-0001')
      .send({ action: 'revoke', expectedRevision: 1, expectedDigest: 'a'.repeat(64),
        assumptions: null, reason: 'Withdraw the reviewed scenario assumptions.',
        confirmed: true, confirmationVersion: 'named-pipeline-scenario-review-v1' });
    expect(response.status).toBe(201);
    expect(fixture.queries[3].params[9]).toBeNull();
  });

  test.each([
    ['blanket percentage', assumptions => { assumptions[0].variations.base.reason = '10%'; }],
    ['crossed ordering', assumptions => { assumptions[0].variations.adverse.weightPpm = 900000; }],
    ['missing estimate identity', assumptions => { delete assumptions[0].estimateId; }],
    ['probability field', assumptions => { assumptions[0].variations.base.probability = 0.5; }],
  ])('rejects %s before database access', async (_label, mutate) => {
    const fixture = appFor(saved());
    const assumptions = [{ estimateId: id, estimateSnapshotDigest: 'b'.repeat(64),
      category: 'preliminary_estimate', variations: {
        adverse: { weightPpm: 200000, reason: 'Estimate-specific downside access delay.' },
        base: { weightPpm: 333333, reason: 'Exact current policy for this estimate.' },
        favorable: { weightPpm: 500000, reason: 'Estimate-specific permit evidence arrived.' },
      } }];
    mutate(assumptions);
    const response = await request(fixture.app)
      .post('/api/v1/forecast/named-pipeline-scenarios/reviews')
      .set('Idempotency-Key', 'part9c-unit-request-0002')
      .send({ action: 'approve', expectedRevision: 0, expectedDigest: 'none', assumptions,
        reason: 'Approve explicit estimate-specific scenario assumptions.', confirmed: true,
        confirmationVersion: 'named-pipeline-scenario-review-v1' });
    expect(response.status).toBe(400);
    expect(fixture.client.query).not.toHaveBeenCalled();
  });

  test('migration is scoped, append-only, source-authenticated and action-free', () => {
    const sql = fs.readFileSync(
      'migrations/250_canonical_forecast_named_pipeline_scenarios_v1.sql', 'utf8');
    expect(sql).toMatch(/canonical_forecast_named_scenario_reviews_v1/);
    expect(sql).toMatch(/canonical_forecast_pipeline_scenario_sources/);
    expect(sql).toMatch(/owner_approved_scenario_assumption/);
    expect(sql).toMatch(/scenario_source_changed/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    expect(sql).not.toMatch(/P10|P50|P90|probabilityCalibrated',TRUE|paidNumericServing',TRUE/i);
    expect(sql).not.toMatch(/automaticActionAuthorized',TRUE|UPDATE public\.canonical_forecast_named/i);
  });
});
