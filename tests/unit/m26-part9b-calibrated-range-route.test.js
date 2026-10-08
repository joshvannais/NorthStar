'use strict';

const fs = require('node:fs');
const express = require('express');
const request = require('supertest');
const { createForecastCalibratedRangesRouter, sanitizeCalibratedRangeAssessment } =
  require('../../src/routes/forecastCalibratedRanges');

const id = '123e4567-e89b-42d3-a456-426614174000';
const hash = character => character.repeat(64);

function requirements() {
  return {
    completeEligibleOriginInventory: {
      state: 'unavailable', reason: 'complete_saved_prediction_inventory_not_available',
      inventoryDigest: null, totalCount: null, issuedCount: null, unavailableCount: null,
      unpairedCount: null, correctedCount: null, revokedCount: null,
      normalizationFailedCount: null,
      denominatorCategories: ['issued','unavailable','unpaired','corrected','revoked',
        'normalization_failed'],
    },
    preOutcomeChronology: {
      state: 'unavailable', reason: 'pre_outcome_prediction_chronology_not_available',
      verified: false, latestPredictionIssuedAt: null, earliestOutcomeFinalizedAt: null,
    },
    comparableFinalizedOutcomes: {
      state: 'unavailable', reason: 'comparable_finalized_outcomes_not_available',
      outcomeFinalityPolicyVersion: null, outcomeFinalityPolicyDigest: null,
      pairedCount: null, unpairedCount: null, correctedCount: null, revokedCount: null,
    },
    reviewedCalibrationPolicy: {
      state: 'unavailable', reason: 'contractor_calibration_policy_not_available',
      policyVersion: null, policyDigest: null, sufficiencyRule: null,
      independenceRule: null, concentrationRule: null, acceptableErrorRule: null,
    },
    versionedQuantilePolicy: {
      state: 'unavailable', reason: 'versioned_quantile_policy_not_available',
      policyVersion: null, policyDigest: null, nominalCoverage: null,
      quantileDefinition: null, p10Definition: null, p50Definition: null, p90Definition: null,
    },
    heldOutEvaluation: {
      state: 'unavailable', reason: 'held_out_calibration_evaluation_not_available',
      evaluationPolicyVersion: null, evaluationPolicyDigest: null, evaluationDigest: null,
      evaluationCurrentnessDigest: null, evaluatedAt: null, trainingOriginPeriods: null,
      heldOutOriginPeriods: null, pairedCount: null,
      exclusions: { unavailable: null, unpaired: null, corrected: null, revoked: null,
        normalizationFailed: null },
      nominalCoverage: null, empiricalCoverage: null, quantileScores: null,
      recency: null, drift: null, materialDownside: null,
    },
    existingDescriptiveEvidence: {
      state: 'inapplicable', targetKey: 'pipeline.approved_estimates',
      requestedTargetKey: 'demand.inbound_leads', usableForCalibration: false,
      reason: 'different_target_and_point_only_descriptive_evidence',
    },
  };
}

function currentAssessment() {
  return {
    version: 'm26-calibrated-range-assessment-v1', state: 'unavailable',
    reason: 'calibration_evidence_not_established', originId: id,
    assessedAt: '2026-09-15T12:00:00.000000Z',
    baselineIdentity: {
      target: { key: 'demand.inbound_leads', definitionVersion: 'v1',
        sourceScope: 'retell_only_tenant_all' },
      unit: { key: 'count', currency: null },
      horizon: { localStart: '2026-10-01', startsAt: '2026-10-01T04:00:00.000000Z',
        endsAt: '2026-11-01T04:00:00.000000Z', grain: 'business_local_month',
        timeZone: 'America/New_York' },
      scope: { sourceScope: 'retell_only_tenant_all', serviceKey: null, areaKey: null,
        dimensionKeys: [] },
      profile: { businessProfileId: id, businessProfileVersion: 3,
        businessProfileHash: hash('a'), timeZone: 'America/New_York' },
      sourceAsOf: '2026-09-01T12:00:00.000000Z', sourceSnapshotDigest: hash('b'),
      sourceReceiptDigest: hash('c'), baselineDigest: hash('d'),
      configurationDigest: hash('e'),
      algorithm: { key: 'retell_three_complete_month_mean',
        version: 'm26-retell-three-month-mean-v2', definitionDigest: hash('f'),
        implementationDigest: hash('1'), buildIdentity: {
          kind: 'postgresql_function_definition_sha256',
          procedure: 'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)',
        } },
    },
    range: { state: 'unavailable', reason: 'calibration_evidence_not_established',
      p10: null, p50: null, p90: null, nominalCentralCoverage: null,
      empiricalCalibrationClaimed: false },
    distribution: { state: 'unavailable', reason: 'calibration_evidence_not_established',
      family: null, parameters: null, distributionDigest: null },
    requirements: requirements(),
    currentness: { baselineCurrent: true, evidenceCurrent: false, refreshRequired: true,
      correctionOrRevocationApplied: false },
    digests: { assessment: hash('2'), completeOriginInventory: null,
      calibrationPolicy: null, quantilePolicy: null, heldOutEvaluation: null,
      backtest: null },
    sourceAuthenticated: true, researchOnly: true, realForecastEligible: false,
    probabilityDistributionIssued: false, calibratedRangeIssued: false,
    paidNumericServing: false, automaticActionAuthorized: false,
  };
}

function staleAssessment() {
  const value = currentAssessment();
  value.reason = 'deterministic_baseline_not_current';
  value.baselineIdentity = null;
  value.range.reason = value.reason;
  value.distribution.reason = value.reason;
  value.currentness = { baselineCurrent: false, evidenceCurrent: false,
    refreshRequired: true, correctionOrRevocationApplied: true };
  value.digests.assessment = null;
  value.sourceAuthenticated = false;
  return value;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

describe('Mission 26 original Part 9B calibrated range runtime boundary', () => {
  test('accepts a current value-free assessment and keeps every statistical claim withheld', () => {
    const value = currentAssessment();
    expect(sanitizeCalibratedRangeAssessment(value)).toBe(value);
    expect(value.range).toMatchObject({ p10: null, p50: null, p90: null,
      nominalCentralCoverage: null, empiricalCalibrationClaimed: false });
    expect(value.requirements.completeEligibleOriginInventory.denominatorCategories)
      .toEqual(['issued','unavailable','unpaired','corrected','revoked','normalization_failed']);
    expect(Object.values(value.requirements.heldOutEvaluation.exclusions))
      .toEqual([null, null, null, null, null]);
  });

  test('accepts stale-value clearing only when baseline identity and assessment digest are absent', () => {
    expect(sanitizeCalibratedRangeAssessment(staleAssessment())).not.toBeNull();
    for (const mutate of [
      value => { value.baselineIdentity = currentAssessment().baselineIdentity; },
      value => { value.digests.assessment = hash('a'); },
      value => { value.sourceAuthenticated = true; },
      value => { value.currentness.correctionOrRevocationApplied = false; },
    ]) {
      const value = staleAssessment(); mutate(value);
      expect(sanitizeCalibratedRangeAssessment(value)).toBeNull();
    }
  });

  test.each([
    ['numeric P10', value => { value.range.p10 = '0'; }],
    ['nominal coverage', value => { value.range.nominalCentralCoverage = '0.8'; }],
    ['calibration claim', value => { value.range.empiricalCalibrationClaimed = true; }],
    ['backtest digest', value => { value.digests.backtest = hash('a'); }],
    ['paired count', value => { value.requirements.heldOutEvaluation.pairedCount = 0; }],
    ['invented universal sufficiency', value => {
      value.requirements.reviewedCalibrationPolicy.sufficiencyRule = '30';
    }],
    ['wrong target', value => { value.baselineIdentity.target.key = 'pipeline.approved_estimates'; }],
    ['wrong unit', value => { value.baselineIdentity.unit.key = 'money'; }],
    ['after-horizon assessment', value => {
      value.assessedAt = '2026-10-01T04:00:00.000000Z';
    }],
    ['cross-tenant training hint', value => { value.crossTenant = true; }],
  ])('rejects %s', (_label, mutate) => {
    const value = clone(currentAssessment()); mutate(value);
    expect(sanitizeCalibratedRangeAssessment(value)).toBeNull();
  });

  test('rejects inherited and sparse evidence structures', () => {
    const inherited = clone(currentAssessment());
    inherited.requirements = Object.create({ hidden: true });
    Object.assign(inherited.requirements, requirements());
    expect(sanitizeCalibratedRangeAssessment(inherited)).toBeNull();
    const sparse = clone(currentAssessment());
    sparse.requirements.completeEligibleOriginInventory.denominatorCategories =
      new Array(6);
    expect(sanitizeCalibratedRangeAssessment(sparse)).toBeNull();
  });

  test('mounts one read-only guarded route with transaction and no caller evidence', async () => {
    const queries = [];
    const client = { query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/canonical_forecast_calibrated_range_v1_read/.test(sql)) {
        return { rows: [{ value: currentAssessment() }] };
      }
      return { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/calibrated-ranges', createForecastCalibratedRangesRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: id,
        userId: id }; req.authSession = { id }; req.userRole = 'owner'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app).get(`/api/v1/forecast/calibrated-ranges/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      reason: 'calibration_evidence_not_established', calibratedRangeIssued: false });
    expect(queries.map(item => item.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '2s'", expect.stringMatching(/calibrated_range_v1_read/),
      'COMMIT',
    ]);
    expect(queries[3].params).toEqual([id, id, 'owner', id, id]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('fails closed for malformed identifiers, extra query input, missing subjects and errors', async () => {
    let result = null;
    const client = { query: jest.fn(async sql => /calibrated_range_v1_read/.test(sql) ?
      { rows: [{ value: result }] } : { rows: [] }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/calibrated-ranges', createForecastCalibratedRangesRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: id,
        userId: id }; req.authSession = { id }; req.userRole = 'admin'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    expect((await request(app).get('/api/v1/forecast/calibrated-ranges/nope')).status).toBe(400);
    expect((await request(app).get(`/api/v1/forecast/calibrated-ranges/${id}?origin=x`)).status)
      .toBe(400);
    expect((await request(app).get(`/api/v1/forecast/calibrated-ranges/${id}`)).status).toBe(404);
    result = { bad: true };
    expect((await request(app).get(`/api/v1/forecast/calibrated-ranges/${id}`)).status).toBe(503);
  });

  test('migration is purpose-fixed, value-free and keeps scenarios, UI and storage out', () => {
    const sql = fs.readFileSync('migrations/249_canonical_forecast_calibrated_range_v1.sql',
      'utf8');
    expect(sql).toMatch(/canonical_forecast_calibrated_range_v1_read/);
    expect(sql).toMatch(/complete_saved_prediction_inventory_not_available/);
    expect(sql).toMatch(/normalization_failed/);
    expect(sql).toMatch(/held_out_calibration_evaluation_not_available/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    expect(sql).not.toMatch(/CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM|PERCENTILE_CONT|random\(/i);
    expect(sql).not.toMatch(/named.scenario|sensitivity|automatic.promotion|paid.numeric.ui/i);
  });
});
