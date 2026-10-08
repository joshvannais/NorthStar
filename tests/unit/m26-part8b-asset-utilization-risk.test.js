'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { createForecastAssetUtilizationRiskRouter, sanitizeForecast } =
  require('../../src/routes/forecastAssetUtilizationRisk');

const uuid = () => crypto.randomUUID();
const digest = character => character.repeat(64);

function current() {
  const start = '2026-10-08T12:00:00.000Z';
  const end = '2026-10-08T16:00:00.000Z';
  const source = {
    sourceIndex: 0,
    job: { appointmentId: uuid(), assignmentId: uuid(), bookingReviewId: uuid(),
      bookingConfirmationId: uuid(), issuedVersionId: uuid(),
      plannedWindow: { startsAt: start, endsAt: end } },
    estimate: { id: uuid(), revisionId: uuid(), revision: 7, digest: digest('a') },
    composition: { id: uuid(), revision: 3, digest: digest('b'),
      calculationVersion: 'estimate-cost-adoption-v3',
      componentManifest: { equipment: { id: uuid(), revision: 2, digest: digest('c') } },
      coverageAssessment: { componentManifest: 'reviewed', overlaps: [] } },
    equipmentCostPlan: { id: uuid(), revision: 2, digest: digest('d'),
      calculationVersion: 'estimate-equipment-cost-plan-v1' },
    equipmentPlan: { id: uuid(), revision: 2, digest: digest('e'),
      calculationVersion: 'estimate-equipment-plan-v1' },
    readinessPlan: { id: uuid(), revision: 1, digest: digest('f'),
      calculationVersion: 'estimate-equipment-readiness-v1', evidenceDigest: digest('1') },
  };
  const lineId = uuid();
  const asset = {
    asset: { id: uuid(), version: 1, digest: digest('2'), category: 'equipment',
      accessType: 'owned', planAccessBasis: 'owned' },
    plannedUtilization: { state: 'current_claimed_plan_only', claimedOperatingHours: '2',
      useCount: 1, uses: [{ sourceIndex: 0, lineId,
        plannedWindow: { startsAt: start, endsAt: end }, claimedOperatingHours: '2' }],
      operatingTimeVerified: false, checkoutDurationUsed: false, reason: null },
    meter: { state: 'current_as_of_source', meterKey: 'engine-hours', unit: 'hours',
      reading: '100', observedAt: '2026-10-07T11:00:00.000Z', eventId: uuid(),
      eventRevision: 2, eventDigest: digest('3'), ledgerRevision: 2,
      ledgerDigest: digest('4'), resetApplied: true, correctionApplied: false,
      historyComplete: true, reason: null },
    serviceInterval: { state: 'current_claimed_plan_position', meterKey: 'engine-hours',
      unit: 'hours', threshold: '101', thresholdReference: 'Owner reviewed 101-hour interval',
      currentReading: '100', projectedReading: '102', hoursRemainingAtStart: '1',
      thresholdReachedNow: false, thresholdReachedByClaimedPlan: true,
      verifiedServiceDate: null, reason: null },
    maintenanceDue: { state: 'current_claimed_plan_position',
      dueAt: '2026-10-09T12:00:00.000Z', dueWithinHorizon: true,
      dueByRecordedMeter: false, dueByClaimedPlanEnd: true,
      maintenanceScheduleVerified: false, maintenanceWorkAuthorized: false, reason: null },
    serviceTiming: { state: 'unavailable', serviceAt: null,
      reason: 'operating_hour_timing_unavailable' },
    currentReadiness: { state: 'current_as_of_source', recordedDowntime: false,
      recordedFault: false, sourceCondition: 'reported_no_problem', reason: null },
    rentalLease: { state: 'owned_current', assetAccessType: 'owned',
      planAccessBasis: 'owned', providerAvailabilityVerified: false,
      providerMaintenanceVerified: false, reason: null },
    downtimeRisk: { state: 'unavailable', risk: null, probability: null,
      reason: 'evaluated_downtime_risk_evidence_unavailable' },
  };
  return {
    version: 'm26-asset-utilization-risk-forecast-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-07T12:00:00.000Z',
    sourceAsOf: '2026-10-07T12:00:01.000Z',
    horizon: { kind: 'next_30_elapsed_days', timeZone: 'America/New_York',
      startsAt: '2026-10-07T12:00:00.000Z', endsAt: '2026-11-06T12:00:00.000Z',
      startsOn: '2026-10-07', endsOnExclusive: '2026-11-06' },
    scope: { label: 'Authenticated owner-confirmed scheduled backlog',
      wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
    sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
      currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
      outsideWindowCount: 0, equipmentRevisionCount: 1, readinessRevisionCount: 1,
      plannedUseCount: 1, assetCount: 1, reason: null },
    sources: [source], assets: [asset],
    utilization: { state: 'current_claimed_plan_only', assetCount: 1, useCount: 1,
      claimedOperatingHours: '2', operatingTimeVerified: false,
      checkoutDurationUsed: false, reason: null },
    learnedOutcomes: { state: 'none_current', applicableValueCount: 0, applied: false,
      reason: 'no_compatible_current_owner_adopted_operating_hour_value' },
    evidence: { sourceAuthenticatedUtilization: true, currentAdoptedEquipmentVerified: true,
      currentReadinessVerified: true, currentnessVerified: true,
      compatibleUnitsVerified: true, periodAttributionVerified: true,
      meterHistoryVerified: true, serviceThresholdPolicyVerified: true,
      maintenanceScheduleVerified: false, rentalLeaseProviderEvidenceVerified: false,
      m25AdjustmentApplied: false, evaluatedDowntimeRiskVerified: false },
    run: { calculationVersion: 'm26-asset-utilization-risk-calculation-v1',
      sourceDigest: digest('5'), digest: digest('6') },
    forecastIssued: true, utilizationForecastIssued: true,
    serviceIntervalForecastIssued: true, maintenanceDueForecastIssued: true,
    serviceTimingForecastIssued: false, downtimeRiskForecastIssued: false,
    calibratedRangeIssued: false, probabilityIssued: false,
    automaticActionAuthorized: false,
  };
}

function unavailable(reason = 'current_adopted_equipment_composition_unavailable') {
  const value = current();
  value.state = 'unavailable'; value.reason = reason; value.sources = null; value.assets = null;
  value.sourceCoverage = { state: 'unavailable', completeAsOf: false, hasMore: null,
    currentBookedPositionCount: null, scheduledJobCount: null, unscheduledJobCount: null,
    outsideWindowCount: null, equipmentRevisionCount: null, readinessRevisionCount: null,
    plannedUseCount: null, assetCount: null, reason };
  value.utilization = { state: 'unavailable', assetCount: null, useCount: null,
    claimedOperatingHours: null, operatingTimeVerified: false,
    checkoutDurationUsed: false, reason };
  value.learnedOutcomes = { state: 'unavailable', applicableValueCount: null,
    applied: false, reason };
  for (const key of Object.keys(value.evidence)) value.evidence[key] = false;
  value.run.sourceDigest = null; value.run.digest = null;
  value.forecastIssued = false; value.utilizationForecastIssued = false;
  value.serviceIntervalForecastIssued = false; value.maintenanceDueForecastIssued = false;
  return value;
}

describe('Mission 26 original Part 8B asset utilization and risk contract', () => {
  test('fences exact released sources before capturing sourceAsOf', () => {
    const sql = fs.readFileSync(path.resolve(__dirname,
      '../../migrations/246_canonical_forecast_asset_utilization_risk_v1.sql'), 'utf8');
    const fence = sql.indexOf(
      'PERFORM public.canonical_forecast_asset_utilization_risk_v1_lock_sources(org);');
    const captured = sql.indexOf('source_as_of_value:=clock_timestamp();');
    expect(fence).toBeGreaterThan(-1);
    expect(captured).toBeGreaterThan(fence);
    for (const source of ['public.tenant_assets', 'public.canonical_equipment_asset_versions',
      'public.canonical_equipment_ledgers', 'public.canonical_equipment_events',
      'public.canonical_equipment_plans', 'public.canonical_equipment_cost_plans',
      'public.canonical_equipment_readiness_plans']) expect(sql).toContain(source);
    expect(sql).toContain('public.canonical_forecast_material_demand_risk_v1_lock_sources(org)');
    expect(sql).toContain("planning_area='equipment_planning'");
    expect(sql).toContain("'operatingTimeVerified',FALSE");
    expect(sql).toContain("'checkoutDurationUsed',FALSE");
    expect(sql).toContain("'verifiedServiceDate',NULL");
    expect(sql).toContain("'automaticActionAuthorized',FALSE");
    expect(sql).toContain("(readiness_line#>>'{source,validUntil}')::timestamptz<candidate.scheduled_end");
    expect(sql).toContain("left_use->>'lineId'<right_use->>'lineId'");
  });

  test('accepts claimed plan and meter positions while unsupported timing and risk stay unavailable', () => {
    const issued = current();
    const withheld = unavailable();
    expect(sanitizeForecast(issued)).toEqual(issued);
    expect(sanitizeForecast(withheld)).toEqual(withheld);
    const missingCalendar = unavailable('business_calendar_unavailable');
    missingCalendar.horizon.timeZone = null;
    expect(sanitizeForecast(missingCalendar)).toEqual(missingCalendar);
  });

  test('rejects checkout inference, meter arithmetic drift and invented maintenance or risk', () => {
    const cases = [
      value => { value.assets[0].plannedUtilization.checkoutDurationUsed = true; },
      value => { value.assets[0].serviceInterval.projectedReading = '103'; },
      value => { value.assets[0].serviceInterval.thresholdReachedByClaimedPlan = false; },
      value => { value.assets[0].serviceTiming.serviceAt = value.sources[0].job.plannedWindow.endsAt; },
      value => { value.assets[0].maintenanceDue.maintenanceWorkAuthorized = true; },
      value => { value.assets[0].downtimeRisk.risk = 'high'; },
      value => { value.assets[0].downtimeRisk.probability = '0.9'; },
      value => { value.evidence.m25AdjustmentApplied = true; },
    ];
    for (const change of cases) {
      const value = current(); change(value);
      expect(sanitizeForecast(value)).toBeNull();
    }
  });

  test('does not execute accessor-backed lineage', () => {
    const value = current(); let called = false;
    Object.defineProperty(value.sources[0].readinessPlan, 'digest', {
      enumerable: true, get() { called = true; return digest('f'); },
    });
    expect(sanitizeForecast(value)).toBeNull();
    expect(called).toBe(false);
  });

  test('serves only the authenticated private tenant identity and rolls back corrupt output', async () => {
    const calls = []; let projection = current();
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_forecast_asset_utilization_risk_v1_current/.test(sql) ?
        { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/risk', createForecastAssetUtilizationRiskRouter({
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
    projection = { ...current(), reserveAsset: true };
    calls.length = 0;
    expect((await request(app).get('/risk/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/risk/current?organizationId=other')).status).toBe(400);
  });
});
