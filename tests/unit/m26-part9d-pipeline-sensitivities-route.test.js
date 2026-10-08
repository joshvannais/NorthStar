'use strict';

const fs = require('node:fs');
const express = require('express');
const request = require('supertest');
const { createForecastPipelineSensitivitiesRouter,
  sanitizePipelineSensitivity, validRequest } =
  require('../../src/routes/forecastPipelineSensitivities');

const id = '123e4567-e89b-42d3-a456-426614174000';
const member = '223e4567-e89b-42d3-a456-426614174000';
const digest = 'a'.repeat(64);

function requestBody() {
  return {
    version: 'm26-pipeline-sensitivity-request-v1',
    scenario: { reviewId: id, reviewRevision: 1, reviewDigest: digest,
      sourceSnapshotDigest: 'b'.repeat(64), assumptionDigest: 'c'.repeat(64),
      currentnessDigest: 'd'.repeat(64), asOf: '2026-10-08T12:00:00.000000Z',
      horizon: { startsAt: '2026-11-01T04:00:00.000000Z',
        endsAt: '2026-12-01T05:00:00.000000Z', upperBoundary: 'exclusive',
        timeZone: 'America/New_York' } },
    estimate: { id: member, snapshotDigest: 'e'.repeat(64),
      category: 'preliminary_estimate', decisionId: null, decisionRevision: null,
      decisionDigest: null, issuedVersionId: null, issuedVersionRevision: null,
      issuedDocumentDigest: null },
    forward: { proposedWeightPpm: 400000 },
    reverse: { target: { kind: 'minimum_category_total',
      category: 'preliminary_estimate', minimumAmount: '40.000000' },
    constraint: { kind: 'selected_estimate_conversion_weight' } },
    purpose: 'bounded_open_pipeline_what_if',
  };
}

function unavailable(reason = 'scenario_source_changed') {
  return { version: 'm26-pipeline-sensitivity-v1', state: 'unavailable', reason,
    checkedAt: '2026-10-08T12:00:01.000000Z', asOf: null, horizon: null,
    currency: null, scenario: null, selectedEstimate: null, target: null,
    constraint: null, forward: null, reverse: null,
    digests: { input: null, output: null, source: null, assumptions: null,
      review: null, currentness: null },
    currentness: { scenarioCurrent: false, sourceCurrent: false,
      assumptionsCurrent: false, policyCurrent: false, profileCurrent: false,
      refreshRequired: true, correctionOrRevocationApplied: true },
    sourceAuthenticated: false, assumptionSourcesAuthenticated: false,
    weightsAreScenarioAssumptions: true, probabilityCalibrated: false,
    percentilesIssued: false, targetIsWhatIfThreshold: true,
    earnedRevenueMeasured: false, cashMeasured: false,
    recommendationIssued: false, researchOnly: true,
    realForecastEligible: false, analysisIssued: false,
    paidNumericServing: false, automaticActionAuthorized: false };
}

function current(impossible = false) {
  const body = requestBody();
  const baseAssumption = { weightPpm: 250000,
    changedAssumption: { field: 'conversion_weight_ppm', fromWeightPpm: 250000,
      toWeightPpm: 250000 },
    reason: 'Use the approved exact central policy for this estimate.',
    author: { userId: id, membershipId: id },
    source: { kind: 'owner_approved_scenario_assumption', digest: 'f'.repeat(64) },
    recordedAt: '2026-10-08T12:00:00.000000Z',
    applicability: { estimateId: member, estimateSnapshotDigest: 'e'.repeat(64),
      category: 'preliminary_estimate' }, revision: 1 };
  return { version: 'm26-pipeline-sensitivity-v1', state: 'assumption_only',
    reason: null, checkedAt: '2026-10-08T12:00:01.000000Z',
    asOf: body.scenario.asOf, horizon: body.scenario.horizon, currency: 'USD',
    scenario: { reviewId: id, reviewRevision: 1, reviewDigest: digest,
      sourceSnapshotDigest: 'b'.repeat(64), assumptionDigest: 'c'.repeat(64),
      currentnessDigest: 'd'.repeat(64) },
    selectedEstimate: { id: member, snapshotDigest: 'e'.repeat(64),
      category: 'preliminary_estimate', decision: { id: null, revision: null, digest: null },
      issuedVersion: { id: null, revision: null, digest: null },
      priceBeforeTax: '100.00', currency: 'USD', baseAssumption },
    target: { kind: 'minimum_category_total', category: 'preliminary_estimate',
      minimumAmount: '40.000000', definition: {
        key: 'pipeline.minimum_category_total', version: 'v1', digest },
      provenance: { kind: 'authorized_user_input', actorUserId: id, digest },
      interpretation: 'user_selected_what_if_threshold' },
    constraint: { kind: 'selected_estimate_conversion_weight',
      bounds: { lowerPpm: 100000, basePpm: 250000, upperPpm: 500000 },
      definition: { key: 'pipeline.selected_estimate_conversion_weight',
        version: 'v1', digest },
      provenance: { kind: 'owner_approved_pipeline_policy', id, revision: 1, digest } },
    forward: { state: 'assumption_only', reason: null,
      changedAssumption: { field: 'conversion_weight_ppm', fromWeightPpm: 250000,
        toWeightPpm: 400000 },
      selectedEstimate: { baselineAmount: '25.000000', proposedAmount: '40.000000',
        changeAmount: '15.000000' },
      categoryTotal: { baselineAmount: '25.000000', proposedAmount: '40.000000',
        changeAmount: '15.000000' }, bindingConstraint: null },
    reverse: impossible ? { state: 'impossible',
      reason: 'target_exceeds_selected_weight_bound', requiredWeightPpm: null,
      selectedEstimateAmount: null, categoryTotal: null,
      bindingConstraint: { kind: 'selected_weight_upper_bound', weightPpm: 500000 } } :
      { state: 'assumption_only', reason: null, requiredWeightPpm: 400000,
        selectedEstimateAmount: '40.000000',
        categoryTotal: { minimumAmount: '40.000000', attainedAmount: '40.000000',
          changeFromBaselineAmount: '15.000000' }, bindingConstraint: null },
    digests: { input: digest, output: digest, source: 'b'.repeat(64),
      assumptions: 'c'.repeat(64), review: digest, currentness: 'd'.repeat(64) },
    currentness: { scenarioCurrent: true, sourceCurrent: true,
      assumptionsCurrent: true, policyCurrent: true, profileCurrent: true,
      refreshRequired: false, correctionOrRevocationApplied: false },
    sourceAuthenticated: true, assumptionSourcesAuthenticated: true,
    weightsAreScenarioAssumptions: true, probabilityCalibrated: false,
    percentilesIssued: false, targetIsWhatIfThreshold: true,
    earnedRevenueMeasured: false, cashMeasured: false,
    recommendationIssued: false, researchOnly: true,
    realForecastEligible: false, analysisIssued: true,
    paidNumericServing: false, automaticActionAuthorized: false };
}

function appFor(result) {
  const queries = [];
  const client = { query: jest.fn(async (sql, params) => {
    queries.push({ sql, params });
    if (/pipeline_sensitivity_v1_read/.test(sql)) return { rows: [{ value: result }] };
    return { rows: [] };
  }), release: jest.fn() };
  const app = express(); app.use(express.json());
  app.use('/api/v1/forecast/pipeline-sensitivities',
    createForecastPipelineSensitivitiesRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: id,
        userId: id }; req.authSession = { id }; req.userRole = 'owner'; next(); },
      permission: (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(),
    }));
  return { app, queries, client };
}

describe('Mission 26 original Part 9D pipeline sensitivity boundary', () => {
  test('accepts exact authenticated forward/reverse and impossible projections', () => {
    expect(sanitizePipelineSensitivity(current())).toBeTruthy();
    expect(sanitizePipelineSensitivity(current(true))).toBeTruthy();
    for (const mutate of [
      item => { item.forward.categoryTotal.changeAmount = 'unknown'; },
      item => { item.sourceAuthenticated = false; },
      item => { item.p10 = '1.000000'; },
      item => { item.reverse.requiredWeightPpm = 600000; },
    ]) {
      const candidate = current(); mutate(candidate);
      expect(sanitizePipelineSensitivity(candidate)).toBeNull();
    }
  });

  test('clears every prior value for unavailable currentness', () => {
    const value = unavailable();
    expect(sanitizePipelineSensitivity(value)).toBe(value);
    const stale = unavailable(); stale.forward = current().forward;
    expect(sanitizePipelineSensitivity(stale)).toBeNull();
  });

  test('mounts one tenant-scoped read calculation with exact request identity', async () => {
    const fixture = appFor(current());
    const body = requestBody();
    const response = await request(fixture.app)
      .post('/api/v1/forecast/pipeline-sensitivities/analyze').send(body);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({ state: 'assumption_only',
      forward: { categoryTotal: { changeAmount: '15.000000' } },
      reverse: { requiredWeightPpm: 400000 }, probabilityCalibrated: false,
      recommendationIssued: false, automaticActionAuthorized: false });
    expect(fixture.queries.map(item => item.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '5s'", expect.stringMatching(/pipeline_sensitivity_v1_read/),
      'COMMIT',
    ]);
    expect(fixture.queries[3].params).toEqual([id, id, 'owner', id,
      JSON.stringify(body)]);
  });

  test('allows safe unsupported definitions to fail closed in PostgreSQL', async () => {
    const body = requestBody(); body.reverse.target.kind = 'staffing_total';
    expect(validRequest(body)).toBe(true);
    const fixture = appFor(unavailable('unsupported_target_kind'));
    const response = await request(fixture.app)
      .post('/api/v1/forecast/pipeline-sensitivities/analyze').send(body);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      reason: 'unsupported_target_kind', forward: null, reverse: null,
      analysisIssued: false });
    expect(fixture.queries[3].params[4]).toBe(JSON.stringify(body));
  });

  test('rejects malformed or absent targets before database access while allowing zero', async () => {
    const body = requestBody(); body.reverse.target.minimumAmount = '0.000000';
    expect(validRequest(body)).toBe(true);
    const finalRevision = requestBody(); finalRevision.scenario.reviewRevision = 10000;
    expect(validRequest(finalRevision)).toBe(true);
    const missing = requestBody(); delete missing.reverse.target.minimumAmount;
    const fixture = appFor(current());
    const response = await request(fixture.app)
      .post('/api/v1/forecast/pipeline-sensitivities/analyze').send(missing);
    expect(response.status).toBe(400);
    expect(fixture.client.query).not.toHaveBeenCalled();
  });

  test('migration remains a bounded private reader over Part 9C arithmetic', () => {
    const sql = fs.readFileSync(
      'migrations/251_canonical_forecast_pipeline_sensitivity_v1.sql', 'utf8');
    expect(sql).toMatch(/canonical_forecast_named_scenario_v1_current/);
    expect(sql).toMatch(/canonical_forecast_named_scenario_v1_value/);
    expect(sql).toMatch(/target_exceeds_selected_weight_bound/);
    expect(sql).toMatch(/owner_approved_pipeline_policy/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    expect(sql).not.toMatch(/P10|P50|P90|probabilityCalibrated',TRUE|recommendationIssued',TRUE/i);
    expect(sql).not.toMatch(/UPDATE public\.|INSERT INTO public\.|DELETE FROM public\./i);
  });
});
