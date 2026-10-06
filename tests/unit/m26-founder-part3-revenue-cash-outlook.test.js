'use strict';

const express = require('express');
const request = require('supertest');
const {
  createForecastRevenueCashOutlookRouter,
  sanitizeOutlook,
} = require('../../src/routes/forecastRevenueCashOutlook');

function outlook(overrides = {}) {
  const value = {
    version: 'm26-revenue-cash-outlook-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-06T12:00:00.000Z', currency: 'USD',
    scope: { label: 'Current supported NorthStar commercial records',
      wholeBusinessCoverageVerified: false },
    authorizedEstimate: { state: 'current', amountBeforeTax: '0.00' },
    approvedPrice: { state: 'current', amountBeforeTax: '1250.00' },
    bookedWork: { state: 'current', amountBeforeTax: '0.00', classification: 'committed' },
    planning: {
      state: 'current', reason: null, snapshotMode: 'current_at_read',
      capturedAt: '2026-10-06T12:00:00.000Z',
      horizonStartsAt: '2026-11-01T00:00:00.000Z',
      horizonEndsAt: '2026-12-01T00:00:00.000Z',
      approvedNotBooked: { state: 'current', count: 1,
        amountBeforeTax: '1250.00', committed: false },
      preliminaryEstimate: { state: 'current', count: 0,
        amountBeforeTax: '0.00', committed: false },
      weightsWithheld: true, weightsAreScenarioAssumptions: true,
      probability: { state: 'unavailable',
        reason: 'calibrated_probability_authority_unavailable' },
      forecastIssued: false,
    },
    earnedRevenue: { state: 'unavailable', amount: null,
      reason: 'recognition_authority_unavailable' },
    cashTiming: { state: 'unavailable', amount: null,
      reason: 'financial_period_coverage_unavailable' },
    forecastIssued: false, automaticActionAuthorized: false,
  };
  return Object.assign(value, overrides);
}

function unavailable() {
  return outlook({
    state: 'unavailable', reason: 'commercial_baseline_unavailable', currency: null,
    authorizedEstimate: { state: 'unavailable', amountBeforeTax: null },
    approvedPrice: { state: 'unavailable', amountBeforeTax: null },
    bookedWork: { state: 'unavailable', amountBeforeTax: null, classification: 'committed' },
    planning: {
      state: 'unavailable', reason: 'current_pipeline_snapshot_unavailable',
      snapshotMode: null, capturedAt: null, horizonStartsAt: null, horizonEndsAt: null,
      approvedNotBooked: { state: 'unavailable', count: null,
        amountBeforeTax: null, committed: false },
      preliminaryEstimate: { state: 'unavailable', count: null,
        amountBeforeTax: null, committed: false },
      weightsWithheld: true, weightsAreScenarioAssumptions: true,
      probability: { state: 'unavailable',
        reason: 'calibrated_probability_authority_unavailable' },
      forecastIssued: false,
    },
  });
}

describe('Mission 26 founder Part 3 revenue and cash outlook contract', () => {
  test('keeps complete zero distinct from unavailable and strips no hidden fields through', () => {
    expect(sanitizeOutlook(outlook())).toEqual(outlook());
    expect(sanitizeOutlook(unavailable())).toEqual(unavailable());
    for (const poison of [
      { sourceId: 'private' }, { digest: 'a'.repeat(64) }, { weights: [1] },
      { members: [] }, { privateOutput: {} },
    ]) expect(sanitizeOutlook({ ...outlook(), ...poison })).toBeNull();
    expect(sanitizeOutlook({ ...outlook(), cashTiming: {
      state: 'current', amount: '0.00', reason: null,
    } })).toBeNull();
    expect(sanitizeOutlook({ ...outlook(), checkedAt: '2026-02-31T12:00:00.000Z' })).toBeNull();
    const impossibleSequence = structuredClone(outlook());
    impossibleSequence.planning.capturedAt = impossibleSequence.planning.horizonStartsAt;
    expect(sanitizeOutlook(impossibleSequence)).toBeNull();
    const inconsistentZero = structuredClone(outlook());
    inconsistentZero.planning.preliminaryEstimate.amountBeforeTax = '1.00';
    expect(sanitizeOutlook(inconsistentZero)).toBeNull();
  });

  test('serves one private no-store tenant-scoped GET and fails closed on corrupt output', async () => {
    const calls = [];
    let projection = outlook();
    const client = {
      query: jest.fn(async (sql, parameters) => {
        calls.push({ sql, parameters });
        if (/SELECT public\.canonical_forecast_revenue_cash_outlook_current/.test(sql)) {
          return { rows: [{ value: projection }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const app = express();
    app.use('/outlook', createForecastRevenueCashOutlookRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => {
        req.tenantContext = { organizationId: '10000000-0000-4000-8000-000000000001',
          userId: '10000000-0000-4000-8000-000000000002' };
        req.userRole = 'owner';
        req.authSession = { id: '10000000-0000-4000-8000-000000000003' };
        next();
      },
      permission: (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(),
    }));
    const current = await request(app).get('/outlook/current');
    expect(current.status).toBe(200);
    expect(current.headers['cache-control']).toBe('private, no-store');
    expect(current.headers.vary).toMatch(/Cookie/);
    expect(current.body.data.bookedWork).toEqual({ state: 'current',
      amountBeforeTax: '0.00', classification: 'committed' });
    const read = calls.find(call => call.parameters);
    expect(read.parameters).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002', 'owner',
      '10000000-0000-4000-8000-000000000003',
    ]);
    expect(calls.map(call => call.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      "SET LOCAL statement_timeout = '15s'",
      "SET LOCAL lock_timeout = '2s'",
      'SELECT public.canonical_forecast_revenue_cash_outlook_current($1,$2,$3,$4) value',
      'COMMIT',
    ]);

    projection = { ...outlook(), positionId: 'private' };
    calls.length = 0;
    const corrupt = await request(app).get('/outlook/current');
    expect(corrupt.status).toBe(503);
    expect(corrupt.body.error.category).toBe('FORECAST_OUTLOOK_UNAVAILABLE');
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/outlook/current?positionId=private')).status).toBe(400);
  });
});
