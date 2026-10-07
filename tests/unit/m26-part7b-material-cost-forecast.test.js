'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const vm = require('node:vm');
const { createForecastMaterialCostRouter, sanitizeForecast } =
  require('../../src/routes/forecastMaterialCost');

function forecast(overrides = {}) {
  return Object.assign({
    version: 'm26-material-cost-forecast-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-07T12:00:00.000Z', currency: 'USD',
    horizon: { startsAt: '2026-10-07T12:00:00.000Z',
      endsAt: '2026-11-06T12:00:00.000Z', days: 30 },
    scope: { label: 'Next 30 days of authenticated NorthStar scheduled backlog',
      wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
    work: { state: 'current', scheduledCount: 2, unscheduledCount: 1,
      outsideWindowCount: 1 },
    plannedMaterials: { state: 'current', coveredCount: 2, lineCount: 4,
      baseCost: '1900.00', wasteCost: '200.00', lineCost: '2100.00', reason: null },
    purchasing: { state: 'plan_cost_only', basis: 'owner_adopted_m24_material_plan',
      purchaseOrdersVerified: false, deliveryFeesIncluded: false,
      taxTreatmentVerified: false, transportIncluded: false,
      reason: 'purchase_terms_unavailable' },
    availability: { state: 'owner_recorded_reported_sufficient',
      reportedSufficientLineCount: 4, inventoryVerified: false,
      reservationVerified: false, supplierAuthenticated: false,
      reason: 'reported_availability_is_not_reserved_inventory' },
    inventoryValuation: { state: 'unavailable', amount: null,
      reason: 'inventory_records_unavailable' },
    learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false,
      reason: 'no_current_applicable_owner_adopted_multiplier' },
    forecastIssued: true, completePurchasingForecastIssued: false,
    inventoryForecastIssued: false, calibratedRangeIssued: false,
    probabilityIssued: false, automaticActionAuthorized: false,
  }, overrides);
}
function unavailable(reason) {
  return forecast({ state: 'unavailable', reason, currency: null,
    work: { state: 'unavailable', scheduledCount: null, unscheduledCount: null,
      outsideWindowCount: null },
    plannedMaterials: { state: 'unavailable', coveredCount: null, lineCount: null,
      baseCost: null, wasteCost: null, lineCost: null, reason },
    purchasing: { state: 'unavailable', basis: 'owner_adopted_m24_material_plan',
      purchaseOrdersVerified: false, deliveryFeesIncluded: false,
      taxTreatmentVerified: false, transportIncluded: false, reason },
    availability: { state: 'unavailable', reportedSufficientLineCount: null,
      inventoryVerified: false, reservationVerified: false,
      supplierAuthenticated: false, reason },
    learnedOutcomes: { state: 'unavailable', applicableServiceCount: null,
      applied: false, reason }, forecastIssued: false });
}

describe('Mission 26 original Part 7B material-cost forecast contract', () => {
  test('accepts only the bounded plan-cost projection and explicit unavailable boundaries', () => {
    expect(sanitizeForecast(forecast())).toEqual(forecast());
    expect(sanitizeForecast(unavailable('current_adopted_material_plan_unavailable')))
      .toEqual(unavailable('current_adopted_material_plan_unavailable'));
    expect(sanitizeForecast({ ...forecast(), sourcePins: ['private'] })).toBeNull();
    expect(sanitizeForecast(forecast({ forecastIssued: false }))).toBeNull();
    expect(sanitizeForecast(forecast({ inventoryForecastIssued: true }))).toBeNull();
    expect(sanitizeForecast(forecast({ availability: { ...forecast().availability,
      inventoryVerified: true } }))).toBeNull();
    expect(sanitizeForecast(forecast({ plannedMaterials: { ...forecast().plannedMaterials,
      coveredCount: 1 } }))).toBeNull();
    expect(sanitizeForecast(unavailable('made_up_reason'))).toBeNull();
  });

  test('serves one private tenant-scoped GET and fails closed on corrupt output', async () => {
    const calls = [];
    let projection = forecast();
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_forecast_material_cost_v1_current/.test(sql) ?
        { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/material', createForecastMaterialCostRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = {
        organizationId: '10000000-0000-4000-8000-000000000001',
        userId: '10000000-0000-4000-8000-000000000002' };
      req.userRole = 'owner'; req.authSession = {
        id: '10000000-0000-4000-8000-000000000003' }; next(); },
      permission: (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(),
    }));
    const current = await request(app).get('/material/current');
    expect(current.status).toBe(200);
    expect(current.headers['cache-control']).toBe('private, no-store');
    expect(calls.find(call => call.parameters).parameters).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002', 'owner',
      '10000000-0000-4000-8000-000000000003',
    ]);
    projection = { ...forecast(), privateSupplier: 'Fixture Supply' };
    calls.length = 0;
    expect((await request(app).get('/material/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/material/current?organizationId=private')).status).toBe(400);
  });

  test('keeps the fictional demo inside the existing collapsed insight', () => {
    const context = { window: {}, console, Intl, Date, Number, BigInt, Promise };
    context.window.window = context.window;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
      '../../public/js/command-center-material-cost-forecast.js'), 'utf8'), context);
    const api = context.window.NorthStarMaterialCostForecast;
    expect(api.validate(api.demoForecast())).not.toBeNull();
    expect(api.demoForecast()).toMatchObject({ fictional: true, forecastIssued: true,
      completePurchasingForecastIssued: false, inventoryForecastIssued: false,
      probabilityIssued: false });
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/demo-dashboard.html'), 'utf8');
    const details = html.indexOf('id="commandCenterCostRiskDetails"');
    const detailsEnd = html.indexOf('</details>', details);
    const value = html.indexOf('id="commandCenterMaterialForecast"');
    const status = html.indexOf('id="commandCenterMaterialForecastStatus"');
    const sectionEnd = html.indexOf('</section>', details);
    expect(value).toBeGreaterThan(details);
    expect(value).toBeLessThan(detailsEnd);
    expect(status).toBeGreaterThan(detailsEnd);
    expect(status).toBeLessThan(sectionEnd);
    expect(html).toMatch(/id="commandCenterMaterialForecastStatus"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/);
  });

  test('formats exact supported decimals and announces one atomic result', async () => {
    const context = { window: {}, console, Intl, Date, Number, BigInt, Promise };
    context.window.window = context.window;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
      '../../public/js/command-center-material-cost-forecast.js'), 'utf8'), context);
    const elements = Object.fromEntries(['commandCenterMaterialForecast',
      'commandCenterMaterialForecastContext', 'commandCenterMaterialForecastStatus']
      .map(id => [id, { textContent: '' }]));
    const data = forecast({ work: { state: 'current', scheduledCount: 1,
      unscheduledCount: 0, outsideWindowCount: 0 },
    plannedMaterials: { state: 'current', coveredCount: 1, lineCount: 1,
      baseCost: '999999999999998.99', wasteCost: '0.50',
      lineCost: '999999999999999.49', reason: null },
    availability: { ...forecast().availability, reportedSufficientLineCount: 1 } });
    const client = context.window.NorthStarMaterialCostForecast.create({
      mode: 'paid', document: { getElementById: id => elements[id] },
      fetcher: async () => ({ ok: true, json: async () => ({ success: true, data }) }),
    });
    await client.workspaceReady();
    expect(elements.commandCenterMaterialForecast.textContent)
      .toBe('$999,999,999,999,999 across 1 planned line');
    expect(elements.commandCenterMaterialForecastStatus.textContent)
      .toBe(`Next 30-day planned material cost: ${elements.commandCenterMaterialForecast.textContent}. ${elements.commandCenterMaterialForecastContext.textContent}`);
  });
});
