'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { createForecastRouteLoadRiskRouter, sanitizeForecast } =
  require('../../src/routes/forecastRouteLoadRisk');

const uuid = () => crypto.randomUUID();
const digest = character => character.repeat(64);
const unavailablePosition = reason => ({ state: 'unavailable', value: null, unit: null, reason });

function current() {
  const route = {
    sourceIndex: 0, tripId: uuid(),
    route: { originDigest: digest('1'), destinationDigest: digest('2'),
      direction: 'origin_to_destination', returnIncluded: true },
    movement: { state: 'unavailable', class: null, roadTransportationVerified: false,
      onsiteEquipmentMovementVerified: false, reason: 'movement_class_unavailable' },
    resource: { state: 'unavailable', assetId: null, kind: null, accessType: null,
      providerSemanticsVerified: false, reason: 'resource_identity_unavailable' },
    declaredDistance: { state: 'current_claimed_plan_only', oneWayQuantity: '10', unit: 'mi',
      basis: 'reported', tripCount: 2, vehicleCount: 1, tripLegs: 4, vehicleLegs: 4,
      totalVehicleLegDistance: '40', sourceAuthenticated: true, reason: null },
    verifiedRoadMileage: unavailablePosition('verified_road_route_unavailable'),
    routeTiming: unavailablePosition('verified_route_timing_unavailable'),
    fuelEnergy: unavailablePosition('independent_consumption_evidence_unavailable'),
    capacity: unavailablePosition('resource_capacity_and_load_evidence_unavailable'),
  };
  return {
    version: 'm26-route-load-risk-forecast-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-07T12:00:00.000Z',
    sourceAsOf: '2026-10-07T12:00:01.000Z',
    horizon: { kind: 'next_30_elapsed_days', timeZone: 'America/New_York',
      startsAt: '2026-10-07T12:00:00.000Z', endsAt: '2026-11-06T12:00:00.000Z',
      startsOn: '2026-10-07', endsOnExclusive: '2026-11-06' },
    scope: { label: 'Authenticated owner-confirmed scheduled backlog',
      wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
    sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
      currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
      outsideWindowCount: 0, travelRevisionCount: 1, routeLineCount: 1, reason: null },
    sources: [{ sourceIndex: 0,
      job: { appointmentId: uuid(), assignmentId: uuid(), bookingReviewId: uuid(),
        bookingConfirmationId: uuid(), issuedVersionId: uuid(), plannedWindow: {
          startsAt: '2026-10-08T12:00:00.000Z', endsAt: '2026-10-08T16:00:00.000Z',
          timeZone: 'America/New_York', assignmentRevision: 3,
          assignmentDigest: digest('3'), approvalId: uuid(), timeZoneAuthority: {
            profileHash: digest('4'), profileId: uuid(), profileVersion: 2,
            timeZone: 'America/New_York', evaluatedAt: '2026-10-07T11:59:00.000Z' },
          timeEvidenceDigest: digest('5') } },
      estimate: { id: uuid(), revisionId: uuid(), revision: 7, digest: digest('6') },
      composition: { id: uuid(), revision: 3, digest: digest('7'),
        calculationVersion: 'estimate-cost-adoption-v3', manifestDigest: digest('8'),
        coverageDigest: digest('9') },
      travelPlan: { id: uuid(), revision: 2, digest: digest('a'),
        calculationVersion: 'estimate-travel-plan-v1', sourceDigest: digest('b'),
        assessmentDigest: digest('e'), assessedThrough: '2026-11-06' } }],
    routes: [route], declaredRouteLoad: { state: 'current_claimed_plan_only',
      routeLineCount: 1, tripLegs: 4, vehicleLegs: 4, declaredVehicleMiles: '40',
      declaredVehicleKilometres: '0', reason: null },
    verifiedRoadMileage: unavailablePosition('verified_road_route_unavailable'),
    routeTiming: unavailablePosition('verified_route_timing_unavailable'),
    fuelEnergy: unavailablePosition('independent_consumption_evidence_unavailable'),
    logisticsCapacityRisk: unavailablePosition('resource_capacity_and_load_evidence_unavailable'),
    learnedOutcomes: { state: 'none_current', applicableValueCount: 0, applied: false,
      reason: 'no_compatible_current_owner_adopted_route_value' },
    evidence: { sourceAuthenticatedDeclaredDistance: true, currentAdoptedTravelVerified: true,
      currentnessVerified: true, compatibleUnitsVerified: true,
      periodAttributionVerified: true, movementClassVerified: false,
      verifiedRoadRouting: false, resourceIdentityVerified: false,
      independentConsumptionEvidenceVerified: false, capacityLoadEvidenceVerified: false,
      rentalLeaseProviderEvidenceVerified: false, m25AdjustmentApplied: false },
    run: { calculationVersion: 'm26-route-load-risk-calculation-v1',
      sourceDigest: digest('c'), digest: digest('d') },
    forecastIssued: true, declaredRouteLoadForecastIssued: true,
    roadMileageForecastIssued: false, routeTimingForecastIssued: false,
    fuelEnergyForecastIssued: false, logisticsCapacityRiskForecastIssued: false,
    calibratedRangeIssued: false, probabilityIssued: false, automaticActionAuthorized: false,
  };
}

function unavailable(reason = 'current_adopted_travel_composition_unavailable') {
  const value = current(); value.state = 'unavailable'; value.reason = reason;
  value.sources = null; value.routes = null;
  value.sourceCoverage = { state: 'unavailable', completeAsOf: false, hasMore: null,
    currentBookedPositionCount: null, scheduledJobCount: null, unscheduledJobCount: null,
    outsideWindowCount: null, travelRevisionCount: null, routeLineCount: null, reason };
  value.declaredRouteLoad = { state: 'unavailable', routeLineCount: null, tripLegs: null,
    vehicleLegs: null, declaredVehicleMiles: null, declaredVehicleKilometres: null, reason };
  value.verifiedRoadMileage = unavailablePosition(reason);
  value.routeTiming = unavailablePosition(reason); value.fuelEnergy = unavailablePosition(reason);
  value.logisticsCapacityRisk = unavailablePosition(reason);
  value.learnedOutcomes = { state: 'unavailable', applicableValueCount: null,
    applied: false, reason };
  for (const key of Object.keys(value.evidence)) value.evidence[key] = false;
  value.run.sourceDigest = null; value.run.digest = null;
  value.forecastIssued = false; value.declaredRouteLoadForecastIssued = false;
  return value;
}

describe('Mission 26 original Part 8C route-load risk contract', () => {
  test('fences exact sources before sourceAsOf and preserves unavailable boundaries', () => {
    const sql = fs.readFileSync(path.resolve(__dirname,
      '../../migrations/247_canonical_forecast_route_load_risk_v1.sql'), 'utf8');
    const fence = sql.indexOf('PERFORM public.canonical_forecast_route_load_risk_v1_lock_sources(org);');
    const captured = sql.indexOf('source_as_of_value:=clock_timestamp();');
    expect(fence).toBeGreaterThan(-1); expect(captured).toBeGreaterThan(fence);
    expect(sql).toContain('public.canonical_forecast_asset_utilization_risk_v1_lock_sources(org)');
    expect(sql).toContain('LOCK TABLE public.canonical_travel_plans IN SHARE MODE');
    expect(sql).toContain("planning_area='travel_planning'");
    expect(sql).toContain("'movement_class_unavailable'");
    expect(sql).toContain("'resource_identity_unavailable'");
    expect(sql).toContain("'verified_road_route_unavailable'");
    expect(sql).toContain("'independent_consumption_evidence_unavailable'");
    expect(sql).toContain("'capacityLoadEvidenceVerified',FALSE");
    expect(sql).toContain("'automaticActionAuthorized',FALSE");
    expect(sql).toContain('canonical_travel_load_bindings');
    expect(sql).toContain('public.canonical_travel_plan_assess');
    expect(sql).toContain("candidate.time_evidence_digest<>public.canonical_schedule_time_evidence_digest");
  });

  test('accepts only separate declared distance while operational forecasts remain unavailable', () => {
    const value = current(); expect(sanitizeForecast(value)).toEqual(value);
    const withheld = unavailable(); expect(sanitizeForecast(withheld)).toEqual(withheld);
    const noCalendar = unavailable('business_calendar_unavailable');
    noCalendar.horizon.timeZone = null;
    expect(sanitizeForecast(noCalendar)).toEqual(noCalendar);
  });

  test('rejects invented routing, consumption, capacity, probability and automatic action', () => {
    for (const change of [
      value => { value.routes[0].movement.class = 'road_transportation'; },
      value => { value.routes[0].resource.assetId = uuid(); },
      value => { value.routes[0].verifiedRoadMileage.value = '40'; },
      value => { value.routes[0].fuelEnergy.value = '4'; },
      value => { value.routes[0].capacity.value = '1000'; },
      value => { value.evidence.m25AdjustmentApplied = true; },
      value => { value.probabilityIssued = true; },
      value => { value.automaticActionAuthorized = true; },
    ]) { const value = current(); change(value); expect(sanitizeForecast(value)).toBeNull(); }
  });

  test('rejects unit conversion, return drift and inconsistent totals', () => {
    for (const change of [
      value => { value.routes[0].declaredDistance.unit = 'km'; },
      value => { value.routes[0].route.returnIncluded = false; },
      value => { value.routes[0].declaredDistance.vehicleLegs = 2; },
      value => { value.declaredRouteLoad.declaredVehicleMiles = '0'; },
      value => { value.declaredRouteLoad.declaredVehicleKilometres = '64.37376'; },
    ]) { const value = current(); change(value); expect(sanitizeForecast(value)).toBeNull(); }
  });

  test('does not execute accessor-backed source lineage', () => {
    const value = current(); let called = false;
    Object.defineProperty(value.sources[0].travelPlan, 'digest', {
      enumerable: true, get() { called = true; return digest('a'); },
    });
    expect(sanitizeForecast(value)).toBeNull(); expect(called).toBe(false);
  });

  test('serves only the private tenant identity and rejects corrupt or scoped requests', async () => {
    const calls = []; let projection = current();
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_forecast_route_load_risk_v1_current/.test(sql) ?
        { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/risk', createForecastRouteLoadRiskRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = {
        organizationId: '10000000-0000-4000-8000-000000000001',
        userId: '10000000-0000-4000-8000-000000000002' };
      req.userRole = 'owner'; req.authSession = {
        id: '10000000-0000-4000-8000-000000000003' }; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app).get('/risk/current');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(calls.find(call => call.parameters).parameters).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002', 'owner',
      '10000000-0000-4000-8000-000000000003',
    ]);
    projection = { ...current(), dispatchAuthorized: true }; calls.length = 0;
    expect((await request(app).get('/risk/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/risk/current?organizationId=other')).status).toBe(400);
  });
});
