'use strict';

const express = require('express');
const request = require('supertest');
const {
  createForecastCostRiskOutlookRouter,
  sanitizeOutlook,
} = require('../../src/routes/forecastCostRiskOutlook');

function outlook(overrides = {}) {
  return Object.assign({
    version: 'm26-cost-risk-outlook-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-06T12:00:00.000Z', currency: 'USD',
    scope: { label: 'Current owner-confirmed booked work', wholeBusinessCoverageVerified: false },
    bookedWork: { state: 'current', count: 2, amountBeforeTax: '10000.00' },
    costBasis: { state: 'current', coveredCount: 2, amount: '7000.00', reason: null },
    contribution: { state: 'current', amount: '3000.00', reason: null },
    margin: { state: 'current', percent: '30.0', reason: null },
    concentration: { state: 'current', largestBookedSharePercent: '60.0',
      largestBookedAmount: '6000.00', reason: null },
    underutilization: { state: 'available_elsewhere', location: 'team_capacity' },
    delays: { state: 'unavailable', reason: 'verified_delay_authority_unavailable' },
    equipmentDowntime: { state: 'unavailable', reason: 'verified_downtime_authority_unavailable' },
    companyProfit: { state: 'unavailable', reason: 'complete_overhead_authority_unavailable' },
    forecastIssued: false, automaticActionAuthorized: false,
  }, overrides);
}

describe('Mission 26 founder Part 5 cost and operational-risk contract', () => {
  test('keeps supported cost exposure separate from company profit and predictions', () => {
    expect(sanitizeOutlook(outlook())).toEqual(outlook());
    const incomplete = outlook({
      costBasis: { state: 'unavailable', coveredCount: 1, amount: null,
        reason: 'incomplete_current_cost_basis' },
      contribution: { state: 'unavailable', amount: null,
        reason: 'incomplete_current_cost_basis' },
      margin: { state: 'unavailable', percent: null,
        reason: 'incomplete_current_cost_basis' },
    });
    expect(sanitizeOutlook(incomplete)).toEqual(incomplete);
    expect(sanitizeOutlook({ ...outlook(), sourceIds: ['private'] })).toBeNull();
    expect(sanitizeOutlook({ ...outlook(), companyProfit: {
      state: 'current', reason: null, amount: '1.00',
    } })).toBeNull();
    expect(sanitizeOutlook({ ...outlook(), equipmentDowntime: {
      state: 'current', reason: null,
    } })).toBeNull();
    expect(sanitizeOutlook(outlook({
      costBasis: { state: 'current', coveredCount: 2, amount: '12000.00', reason: null },
      contribution: { state: 'current', amount: '-2000.00', reason: null },
      margin: { state: 'current', percent: '-20.0', reason: null },
    }))).not.toBeNull();
    expect(sanitizeOutlook(outlook({
      contribution: { state: 'current', amount: '3000.01', reason: null },
    }))).toBeNull();
    expect(sanitizeOutlook(outlook({
      bookedWork: { state: 'current', count: 1, amountBeforeTax: '0.00' },
      costBasis: { state: 'current', coveredCount: 1, amount: '0.00', reason: null },
      contribution: { state: 'current', amount: '0.00', reason: null },
      margin: { state: 'unavailable', percent: null, reason: 'no_booked_value' },
      concentration: { state: 'none', largestBookedSharePercent: '0.0',
        largestBookedAmount: '0.00', reason: null },
    }))).not.toBeNull();
    expect(sanitizeOutlook(outlook({ checkedAt: '2026-02-31T12:00:00.000Z' }))).toBeNull();
    expect(sanitizeOutlook(outlook({ concentration: { state: 'current',
      largestBookedSharePercent: '101.0', largestBookedAmount: '6000.00', reason: null },
    }))).toBeNull();
    expect(sanitizeOutlook(outlook({
      margin: { state: 'current', percent: '99.9', reason: null },
    }))).toBeNull();
    expect(sanitizeOutlook(outlook({ concentration: { state: 'current',
      largestBookedSharePercent: '20.0', largestBookedAmount: '6000.00', reason: null },
    }))).toBeNull();
  });

  test('serves one private tenant-scoped GET and fails closed on corrupt output', async () => {
    const calls = [];
    let projection = outlook();
    const client = {
      query: jest.fn(async (sql, parameters) => {
        calls.push({ sql, parameters });
        if (/canonical_forecast_cost_risk_outlook_current/.test(sql)) {
          return { rows: [{ value: projection }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const app = express();
    app.use('/outlook', createForecastCostRiskOutlookRouter({
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
    expect(calls.find(call => call.parameters).parameters).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002', 'owner',
      '10000000-0000-4000-8000-000000000003',
    ]);
    expect(calls.map(call => call.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      "SET LOCAL statement_timeout = '15s'",
      "SET LOCAL lock_timeout = '2s'",
      'SELECT public.canonical_forecast_cost_risk_outlook_current($1,$2,$3,$4) value',
      'COMMIT',
    ]);
    projection = { ...outlook(), pricingIds: ['private'] };
    calls.length = 0;
    expect((await request(app).get('/outlook/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/outlook/current?estimate=private')).status).toBe(400);
  });
});
