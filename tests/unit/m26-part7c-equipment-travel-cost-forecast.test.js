'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const vm = require('node:vm');
const { createForecastEquipmentTravelCostRouter, sanitizeForecast } =
  require('../../src/routes/forecastEquipmentTravelCost');

function forecast(overrides = {}) {
  return Object.assign({
    version: 'm26-equipment-travel-cost-forecast-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-07T12:00:00.000Z', currency: 'USD',
    horizon: { startsAt: '2026-10-07T12:00:00.000Z',
      endsAt: '2026-11-06T12:00:00.000Z', days: 30 },
    scope: { label: 'Next 30 days of authenticated NorthStar scheduled backlog',
      wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
    work: { state: 'current', scheduledCount: 2, unscheduledCount: 1,
      outsideWindowCount: 1 },
    plannedEquipmentTravel: { state: 'current', coveredCount: 2,
      equipmentLineCount: 3, tripCount: 4, logisticsLineCount: 2,
      equipmentCost: '1700.00', grossTravelCost: '780.00', overlapDeduction: '80.00',
      netTravelCost: '700.00', combinedCost: '2400.00', reason: null },
    allocation: { state: 'reviewed_v3_allocation',
      basis: 'owner_adopted_m24_cost_allocation_v3', v3AllocationReviewed: true,
      crossForecastLaborOverlapReviewed: true, reason: 'reviewed_allocation_applied' },
    operations: { state: 'plan_cost_only', fuelOrEnergyLineCount: 2,
      maintenanceLineCount: 1, futureUtilizationVerified: false,
      assetReadinessVerified: false, maintenanceScheduleVerified: false,
      downtimeCostVerified: false, ownershipOrFinancingBasisVerified: false,
      providerAuthenticated: false,
      reason: 'future_operations_evidence_unavailable' },
    learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false,
      reason: 'no_current_applicable_owner_adopted_multiplier' },
    forecastIssued: true, completeOperatingCostForecastIssued: false,
    downtimeForecastIssued: false, calibratedRangeIssued: false,
    probabilityIssued: false, automaticActionAuthorized: false,
  }, overrides);
}
function unavailable(reason) {
  return forecast({ state: 'unavailable', reason, currency: null,
    work: { state: 'unavailable', scheduledCount: null, unscheduledCount: null,
      outsideWindowCount: null },
    plannedEquipmentTravel: { state: 'unavailable', coveredCount: null,
      equipmentLineCount: null, tripCount: null, logisticsLineCount: null,
      equipmentCost: null, grossTravelCost: null, overlapDeduction: null,
      netTravelCost: null, combinedCost: null, reason },
    allocation: { state: 'unavailable', basis: 'owner_adopted_m24_cost_allocation_v3',
      v3AllocationReviewed: false, crossForecastLaborOverlapReviewed: false, reason },
    operations: { state: 'unavailable', fuelOrEnergyLineCount: null,
      maintenanceLineCount: null, futureUtilizationVerified: false,
      assetReadinessVerified: false, maintenanceScheduleVerified: false,
      downtimeCostVerified: false, ownershipOrFinancingBasisVerified: false,
      providerAuthenticated: false, reason },
    learnedOutcomes: { state: 'unavailable', applicableServiceCount: null,
      applied: false, reason }, forecastIssued: false });
}

describe('Mission 26 original Part 7C equipment-and-travel forecast contract', () => {
  test('accepts only exact reviewed v3 plan-cost evidence and explicit unavailable boundaries', () => {
    expect(sanitizeForecast(forecast())).toEqual(forecast());
    expect(sanitizeForecast(unavailable('current_adopted_equipment_travel_plan_unavailable')))
      .toEqual(unavailable('current_adopted_equipment_travel_plan_unavailable'));
    expect(sanitizeForecast({ ...forecast(), privateAsset: 'Truck 7' })).toBeNull();
    expect(sanitizeForecast(forecast({ forecastIssued: false }))).toBeNull();
    expect(sanitizeForecast(forecast({ downtimeForecastIssued: true }))).toBeNull();
    expect(sanitizeForecast(forecast({ operations: { ...forecast().operations,
      assetReadinessVerified: true } }))).toBeNull();
    expect(sanitizeForecast(forecast({ operations: { ...forecast().operations,
      ownershipOrFinancingBasisVerified: true } }))).toBeNull();
    expect(sanitizeForecast(forecast({ allocation: { ...forecast().allocation,
      v3AllocationReviewed: false } }))).toBeNull();
    expect(sanitizeForecast(unavailable('made_up_reason'))).toBeNull();
  });

  test('serves one private tenant-scoped GET and fails closed on corrupt output', async () => {
    const calls = [];
    let projection = forecast();
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_forecast_equipment_travel_cost_v1_current/.test(sql) ?
        { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/equipment-travel', createForecastEquipmentTravelCostRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = {
        organizationId: '10000000-0000-4000-8000-000000000001',
        userId: '10000000-0000-4000-8000-000000000002' };
      req.userRole = 'owner'; req.authSession = {
        id: '10000000-0000-4000-8000-000000000003' }; next(); },
      permission: (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(),
    }));
    const current = await request(app).get('/equipment-travel/current');
    expect(current.status).toBe(200);
    expect(current.headers['cache-control']).toBe('private, no-store');
    expect(calls.find(call => call.parameters).parameters).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002', 'owner',
      '10000000-0000-4000-8000-000000000003',
    ]);
    projection = { ...forecast(), privateAsset: 'Fixture truck' };
    calls.length = 0;
    expect((await request(app).get('/equipment-travel/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/equipment-travel/current?org=private')).status).toBe(400);
  });

  test('keeps the fictional demo inside the existing collapsed insight', () => {
    const context = { window: {}, console, Intl, Date, Number, BigInt, Promise };
    context.window.window = context.window;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
      '../../public/js/command-center-equipment-travel-cost-forecast.js'), 'utf8'), context);
    const api = context.window.NorthStarEquipmentTravelCostForecast;
    expect(api.validate(api.demoForecast())).not.toBeNull();
    expect(api.demoForecast()).toMatchObject({ fictional: true, forecastIssued: true,
      completeOperatingCostForecastIssued: false, downtimeForecastIssued: false,
      probabilityIssued: false });
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/demo-dashboard.html'), 'utf8');
    const details = html.indexOf('id="commandCenterCostRiskDetails"');
    const detailsEnd = html.indexOf('</details>', details);
    const value = html.indexOf('id="commandCenterEquipmentTravelForecast"');
    const status = html.indexOf('id="commandCenterEquipmentTravelForecastStatus"');
    const sectionEnd = html.indexOf('</section>', details);
    expect(value).toBeGreaterThan(details);
    expect(value).toBeLessThan(detailsEnd);
    expect(status).toBeGreaterThan(detailsEnd);
    expect(status).toBeLessThan(sectionEnd);
    expect(html).toMatch(/id="commandCenterEquipmentTravelForecastStatus"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/);
  });

  test('formats exact supported decimals and announces one atomic result', async () => {
    const context = { window: {}, console, Intl, Date, Number, BigInt, Promise };
    context.window.window = context.window;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
      '../../public/js/command-center-equipment-travel-cost-forecast.js'), 'utf8'), context);
    const elements = Object.fromEntries(['commandCenterEquipmentTravelForecast',
      'commandCenterEquipmentTravelForecastContext', 'commandCenterEquipmentTravelForecastStatus']
      .map(id => [id, { textContent: '' }]));
    const data = forecast({ work: { state: 'current', scheduledCount: 1,
      unscheduledCount: 0, outsideWindowCount: 0 },
    plannedEquipmentTravel: { state: 'current', coveredCount: 1,
      equipmentLineCount: 1, tripCount: 1, logisticsLineCount: 0,
      equipmentCost: '999999999999998.99', grossTravelCost: '0.50',
      overlapDeduction: '0.00', netTravelCost: '0.50',
      combinedCost: '999999999999999.49', reason: null } });
    const client = context.window.NorthStarEquipmentTravelCostForecast.create({
      mode: 'paid', document: { getElementById: id => elements[id] },
      fetcher: async () => ({ ok: true, json: async () => ({ success: true, data }) }),
    });
    await client.workspaceReady();
    expect(elements.commandCenterEquipmentTravelForecast.textContent)
      .toBe('$999,999,999,999,999 across 1 scheduled job');
    expect(elements.commandCenterEquipmentTravelForecastStatus.textContent)
      .toBe(`Next 30-day planned equipment and travel cost: ${elements.commandCenterEquipmentTravelForecast.textContent}. ${elements.commandCenterEquipmentTravelForecastContext.textContent}`);
  });
});
