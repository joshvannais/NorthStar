'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { createForecastMaterialDemandRiskRouter, sanitizeForecast } =
  require('../../src/routes/forecastMaterialDemandRisk');

const uuid = () => crypto.randomUUID();
const digest = character => character.repeat(64);

function boundary() {
  return {
    inventory: { state: 'unavailable', onHand: null,
      compatibleStockIdentityVerified: false, transactionCoverageVerified: false,
      receiptSemanticsVerified: false, m23UsageApplied: false,
      reason: 'source_owned_inventory_ledger_unavailable' },
    futureReceipts: { state: 'unavailable', quantity: null,
      receiptDatesVerified: false, reason: 'future_receipts_unavailable' },
    replenishment: { state: 'unavailable', leadTimeDays: null, cutoffAt: null,
      leadTimePolicyVerified: false, cutoffPolicyVerified: false,
      supplierAvailabilityVerified: false, purchaseAuthorityVerified: false,
      reason: 'replenishment_policy_unavailable' },
    reorder: { state: 'unavailable', reorderAt: null,
      reason: 'inventory_receipts_and_replenishment_unavailable' },
    stockoutRisk: { state: 'unavailable', risk: null, shortageQuantity: null,
      reason: 'inventory_receipts_and_replenishment_unavailable' },
    purchasingRisk: { state: 'unavailable', risk: null,
      reason: 'supplier_and_purchase_authority_unavailable' },
  };
}

function current() {
  const start = '2026-10-08T12:00:00.000Z', end = '2026-10-08T14:00:00.000Z';
  const source = { sourceIndex: 0,
    job: { appointmentId: uuid(), assignmentId: uuid(), bookingReviewId: uuid(),
      bookingConfirmationId: uuid(), issuedVersionId: uuid(),
      plannedWindow: { startsAt: start, endsAt: end } },
    estimate: { id: uuid(), revisionId: uuid(), revision: 7, digest: digest('a') },
    composition: { id: uuid(), revision: 3, digest: digest('b'),
      calculationVersion: 'estimate-cost-adoption-v3',
      componentManifest: { material: { id: uuid(), revision: 2, digest: digest('c') } },
      coverageAssessment: { componentManifest: 'reviewed', overlaps: [] } },
    materialPlan: { id: uuid(), revision: 2, digest: digest('d'),
      calculationVersion: 'estimate-material-plan-v4' } };
  return {
    version: 'm26-material-demand-risk-forecast-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-07T12:00:00.000Z',
    sourceAsOf: '2026-10-07T12:00:01.000Z',
    horizon: { kind: 'next_30_elapsed_days', timeZone: 'America/New_York',
      startsAt: '2026-10-07T12:00:00.000Z', endsAt: '2026-11-06T12:00:00.000Z',
      startsOn: '2026-10-07', endsOnExclusive: '2026-11-06' },
    scope: { label: 'Authenticated owner-confirmed scheduled backlog',
      wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
    sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
      currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
      outsideWindowCount: 0, materialRevisionCount: 1, componentLineCount: 1, reason: null },
    sources: [source],
    demand: { state: 'current', groupCount: 1, componentCount: 1,
      groups: [{ identity: { materialLabel: 'Cedar boards', materialSpecification: 'cedar',
        procurementLocation: 'Fixture yard' }, unit: 'ft',
      plannedWindow: { startsAt: start, endsAt: end }, baseQuantity: '100',
      wasteQuantity: '10', plannedQuantity: '110',
      components: [{ sourceIndex: 0, lineId: uuid(), baseQuantity: '100',
        wasteQuantity: '10', plannedQuantity: '110' }] }], reason: null },
    ...boundary(),
    learnedOutcomes: { state: 'none_current', applicableValueCount: 0, applied: false,
      reason: 'no_compatible_current_owner_adopted_material_value' },
    evidence: { sourceAuthenticatedDemand: true, currentAdoptedCompositionVerified: true,
      currentnessVerified: true, compatibleUnitsVerified: true,
      periodAttributionVerified: true, inventoryVerified: false,
      futureReceiptsVerified: false, replenishmentPolicyVerified: false,
      supplierAvailabilityVerified: false, purchaseAuthorityVerified: false,
      m25AdjustmentApplied: false },
    run: { calculationVersion: 'm26-material-demand-risk-calculation-v1',
      sourceDigest: digest('e'), digest: digest('f') },
    forecastIssued: true, demandForecastIssued: true, reorderForecastIssued: false,
    stockoutForecastIssued: false, purchasingRiskForecastIssued: false,
    calibratedRangeIssued: false, probabilityIssued: false, automaticActionAuthorized: false,
  };
}

function unavailable(reason = 'current_adopted_material_composition_unavailable') {
  const value = current();
  value.state = 'unavailable'; value.reason = reason; value.sources = null;
  value.sourceCoverage = { state: 'unavailable', completeAsOf: false, hasMore: null,
    currentBookedPositionCount: null, scheduledJobCount: null, unscheduledJobCount: null,
    outsideWindowCount: null, materialRevisionCount: null, componentLineCount: null, reason };
  value.demand = { state: 'unavailable', groupCount: null, componentCount: null,
    groups: null, reason };
  value.learnedOutcomes = { state: 'unavailable', applicableValueCount: null,
    applied: false, reason };
  Object.assign(value.evidence, { sourceAuthenticatedDemand: false,
    currentAdoptedCompositionVerified: false, currentnessVerified: false,
    compatibleUnitsVerified: false, periodAttributionVerified: false });
  value.run.sourceDigest = null; value.run.digest = null;
  value.forecastIssued = false; value.demandForecastIssued = false;
  return value;
}

describe('Mission 26 original Part 8A material demand and risk contract', () => {
  test('captures sourceAsOf only after the complete commercial, M24 and M25 fence', () => {
    const sql = fs.readFileSync(path.resolve(__dirname,
      '../../migrations/245_canonical_forecast_material_demand_risk_v1.sql'), 'utf8');
    const fence = sql.indexOf(
      'PERFORM public.canonical_forecast_material_demand_risk_v1_lock_sources(org);');
    const captured = sql.indexOf('source_as_of_value:=clock_timestamp();');
    expect(fence).toBeGreaterThan(-1);
    expect(captured).toBeGreaterThan(fence);
    expect(sql).toContain('public.canonical_forecast_commercial_booking_orders');
    expect(sql).toContain('public.canonical_customer_estimate_delivery_events');
    expect(sql).toContain('public.canonical_customer_estimate_versions');
    expect(sql).toContain('public.canonical_forecast_booking_approval_orders');
    expect(sql).toContain('public.canonical_forecast_commercial_booking_reviews');
    expect(sql).toContain('public.canonical_forecast_booked_work_confirmations');
    expect(sql).toContain('public.canonical_estimate_proposal_adoptions');
    expect(sql).toContain('public.canonical_material_plans');
    expect(sql).toContain('public.canonical_polaris_snapshots');
    expect(sql).toContain('public.canonical_job_outcome_planning_value_versions IN SHARE MODE');
    expect(sql).not.toContain("org::text||':job-outcome-proposal-consent'");
  });

  test('accepts authenticated demand while every unsupported resource risk remains unavailable', () => {
    const issued = current(), withheld = unavailable();
    expect(sanitizeForecast(issued)).toEqual(issued);
    expect(sanitizeForecast(withheld)).toEqual(withheld);
    const missingCalendar = unavailable('business_calendar_unavailable');
    missingCalendar.horizon.timeZone = null;
    expect(sanitizeForecast(missingCalendar)).toEqual(missingCalendar);
  });

  test('rejects quantity drift, incompatible units, duplicate components and invented risk', () => {
    const cases = [
      value => { value.demand.groups[0].plannedQuantity = '109'; },
      value => { value.demand.groups[0].unit = 'board'; },
      value => { value.demand.groups[0].components.push({ ...value.demand.groups[0].components[0] });
        value.demand.componentCount = 2; value.sourceCoverage.componentLineCount = 2; },
      value => { value.reorder.state = 'current'; value.reorder.reorderAt = value.checkedAt; },
      value => { value.purchasingRisk.risk = 'high'; },
      value => { value.inventory.onHand = '0'; },
      value => { value.evidence.m25AdjustmentApplied = true; },
    ];
    for (const change of cases) { const value = current(); change(value);
      expect(sanitizeForecast(value)).toBeNull(); }
  });

  test('does not execute accessor-backed lineage', () => {
    const value = current(); let called = false;
    Object.defineProperty(value.sources[0].estimate, 'digest', {
      enumerable: true, get() { called = true; return digest('a'); },
    });
    expect(sanitizeForecast(value)).toBeNull();
    expect(called).toBe(false);
  });

  test('serves only the private tenant identity and rolls back corrupt output', async () => {
    const calls = []; let projection = current();
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_forecast_material_demand_risk_v1_current/.test(sql) ?
        { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/risk', createForecastMaterialDemandRiskRouter({
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
    projection = { ...current(), supplierPromise: true };
    calls.length = 0;
    expect((await request(app).get('/risk/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/risk/current?organizationId=other')).status).toBe(400);
  });
});
