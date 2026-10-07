'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const vm = require('node:vm');
const { createForecastLaborCostRouter, sanitizeForecast } =
  require('../../src/routes/forecastLaborCost');

function forecast(overrides = {}) {
  return Object.assign({
    version: 'm26-labor-cost-forecast-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-06T12:00:00.000Z', currency: 'USD',
    horizon: { startsAt: '2026-10-06T12:00:00.000Z',
      endsAt: '2026-11-05T12:00:00.000Z', days: 30 },
    scope: { label: 'Next 30 days of authenticated NorthStar scheduled backlog',
      wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
    work: { state: 'current', scheduledCount: 2, unscheduledCount: 1,
      outsideWindowCount: 1 },
    plannedLabor: { state: 'current', coveredCount: 2, personHours: '40.000000',
      cost: '2100.00', reason: null },
    rateAuthority: { state: 'current', basis: 'owner_saved_m24_labor_plan_rates',
      payrollVerified: false, reason: null },
    capacity: { state: 'declared_role_capacity_verified', declaredRole: 'technician',
      realizedAttendanceVerified: false, jobSpecificConstraintCompositionAvailable: false,
      reason: null },
    learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false,
      reason: 'no_current_applicable_owner_adopted_multiplier' },
    forecastIssued: true, calibratedRangeIssued: false, probabilityIssued: false,
    automaticActionAuthorized: false,
  }, overrides);
}

function unavailable(reason) {
  return forecast({
    state: 'unavailable', reason, currency: null,
    work: { state: 'unavailable', scheduledCount: null, unscheduledCount: null,
      outsideWindowCount: null },
    plannedLabor: { state: 'unavailable', coveredCount: null, personHours: null,
      cost: null, reason },
    rateAuthority: { state: 'unavailable', basis: 'owner_saved_m24_labor_plan_rates',
      payrollVerified: false, reason },
    capacity: { state: 'unavailable', declaredRole: null,
      realizedAttendanceVerified: false, jobSpecificConstraintCompositionAvailable: false, reason },
    learnedOutcomes: { state: 'unavailable', applicableServiceCount: null,
      applied: false, reason },
    forecastIssued: false,
  });
}

describe('Mission 26 original Part 7A labor-cost forecast contract', () => {
  test('accepts only bounded source-authenticated deterministic facts', () => {
    expect(sanitizeForecast(forecast())).toEqual(forecast());
    expect(sanitizeForecast(unavailable('declared_capacity_evidence_unavailable')))
      .toEqual(unavailable('declared_capacity_evidence_unavailable'));
    expect(sanitizeForecast({ ...forecast(), sourcePins: ['private'] })).toBeNull();
    expect(sanitizeForecast(forecast({ forecastIssued: false }))).toBeNull();
    expect(sanitizeForecast(forecast({ probabilityIssued: true }))).toBeNull();
    expect(sanitizeForecast(forecast({ rateAuthority: { state: 'current',
      basis: 'owner_saved_m24_labor_plan_rates', payrollVerified: true, reason: null },
    }))).toBeNull();
    expect(sanitizeForecast(forecast({ plannedLabor: { state: 'current', coveredCount: 1,
      personHours: '40.000000', cost: '2100.00', reason: null },
    }))).toBeNull();
    expect(sanitizeForecast(unavailable('made_up_reason'))).toBeNull();
  });

  test('serves one private tenant-scoped GET and fails closed on corrupt output', async () => {
    const calls = [];
    let projection = forecast();
    const client = {
      query: jest.fn(async (sql, parameters) => {
        calls.push({ sql, parameters });
        if (/canonical_forecast_labor_cost_v1_current/.test(sql)) {
          return { rows: [{ value: projection }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const app = express();
    app.use('/labor', createForecastLaborCostRouter({
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
    const current = await request(app).get('/labor/current');
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
      'SELECT public.canonical_forecast_labor_cost_v1_current($1,$2,$3,$4) value',
      'COMMIT',
    ]);
    projection = { ...forecast(), privateRate: '50.00' };
    calls.length = 0;
    expect((await request(app).get('/labor/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/labor/current?organizationId=private')).status).toBe(400);
  });

  test('keeps the fictional demo isolated inside the existing collapsed insight', () => {
    const context = { window: {}, console, Intl, Date, Number, BigInt, Promise };
    context.window.window = context.window;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
      '../../public/js/command-center-labor-cost-forecast.js'), 'utf8'), context);
    const api = context.window.NorthStarLaborCostForecast;
    const demo = api.demoForecast();
    expect(demo.fictional).toBe(true);
    expect(api.validate(demo)).not.toBeNull();
    expect(demo.forecastIssued).toBe(true);
    expect(demo.probabilityIssued).toBe(false);
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/demo-dashboard.html'), 'utf8');
    expect(html).toContain('id="commandCenterLaborForecast"');
    expect(html.indexOf('id="commandCenterLaborForecast"'))
      .toBeGreaterThan(html.indexOf('id="commandCenterCostRiskDetails"'));
    expect(html.indexOf('id="commandCenterLaborForecast"'))
      .toBeLessThan(html.indexOf('</details>', html.indexOf('id="commandCenterCostRiskDetails"')));
  });
});
