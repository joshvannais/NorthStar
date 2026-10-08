'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const { createForecastMonthlyKpisRouter, sanitizeForecastMonthlyKpis } =
  require('../../src/routes/forecastMonthlyKpis');

const TENANT = '10000000-0000-4000-8000-000000000100';
const ACTOR = '10000000-0000-4000-8000-000000000101';
const SESSION = '10000000-0000-4000-8000-000000000102';
const ORIGIN = '90000000-0000-4000-8000-000000000010';

function browserApi() {
  const context = { window: {}, Reflect, Promise, encodeURIComponent, Date, Number, JSON };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
    '../../public/js/command-center-monthly-forecast-kpis.js'), 'utf8'), context);
  return context.window.NorthStarMonthlyForecastKpis;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function current() { return clone(browserApi().demoBundle(TENANT)); }
function stale() {
  const value = current();
  value.reason = 'deterministic_baseline_not_current';
  value.anchor = null; value.month = null; value.graph.month = null;
  value.digests.bundle = null; value.anchorSourceAuthenticated = false;
  value.currentness.anchorCurrent = false;
  value.currentness.correctionOrRevocationApplied = true;
  value.slots.forEach(slot => { slot.reason = value.reason; });
  value.graph.reason = value.reason;
  return value;
}

class Element {
  constructor() { this.textContent = ''; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}
function documentFixture() {
  const ids = ['commandCenterMonthlyForecastKpis','commandCenterMonthlyForecastKpisState',
    'commandCenterMonthlyForecastKpisExplanation','commandCenterMonthlyForecastKpisAuthority',
    'commandCenterMonthlyForecastKpisBoundary','commandCenterMonthlyForecastKpisStatus',
    'commandCenterMonthlyForecastKpiGraphMonth','commandCenterMonthlyForecastKpiGraphPlot'];
  for (const suffix of ['Revenue','OperatingCost','Profit','Margin','Demand','Capacity']) {
    ids.push(`commandCenterMonthlyForecastKpi${suffix}Value`);
    ids.push(`commandCenterMonthlyForecastKpi${suffix}State`);
  }
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { elements, document: { getElementById: id => elements[id] } };
}

describe('Mission 26 original Part 10B monthly KPI boundary', () => {
  test('accepts only the exact ordered six-slot value-free same-run contract', () => {
    const value = current();
    expect(sanitizeForecastMonthlyKpis(value)).toBe(value);
    expect(browserApi().validateBundle(value)).not.toBeNull();
    expect(value.slots.map(slot => slot.key)).toEqual([
      'revenue','operating_cost','profit','margin','demand','capacity']);
    expect(value.slots.every(slot => slot.value === null &&
      slot.manifestEntryState === 'unknown_manifest_unavailable')).toBe(true);
    expect(value.graph.series.every(point => point.value === null)).toBe(true);
    expect(value.run).toMatchObject({ runId: null, revision: null,
      manifestDigest: null, complete: false, current: false });
  });

  test.each([
    ['numeric revenue', candidate => { candidate.slots[0].value = '0'; }],
    ['fabricated graph zero', candidate => { candidate.graph.series[4].value = '0'; }],
    ['mixed run identity', candidate => { candidate.run.runId = ORIGIN; }],
    ['wrong margin unit', candidate => { candidate.slots[3].unit.key = 'percent'; }],
    ['incompatible revenue currency', candidate => { candidate.slots[0].unit.currency = 'USD'; }],
    ['missing role dimension', candidate => { candidate.slots[5].scope.dimensionKind = 'none'; }],
    ['changed target version', candidate => { candidate.slots[4].target.definitionVersion = 'v2'; }],
    ['duplicate operating cost category', candidate => {
      candidate.slots[1].target.componentTargets[3] = 'cost.accepted_labor.v1';
    }],
    ['mixed monthly window', candidate => { candidate.month.endsAt = '2026-12-02T05:00:00.000000Z'; }],
    ['reordered slots', candidate => { candidate.slots.reverse(); }],
    ['declared partial manifest', candidate => {
      candidate.requirements.sameRunManifest.presentTargetCount = 1;
    }],
    ['extra field', candidate => { candidate.crossTenant = true; }],
  ])('rejects %s', (_name, mutate) => {
    const poisoned = current(); mutate(poisoned);
    expect(sanitizeForecastMonthlyKpis(poisoned)).toBeNull();
    expect(browserApi().validateBundle(poisoned)).toBeNull();
  });

  test('accepts stale correction state only after clearing anchor, month and bundle identity', () => {
    const value = stale();
    expect(sanitizeForecastMonthlyKpis(value)).toBe(value);
    expect(browserApi().validateBundle(value)).not.toBeNull();
    const retained = stale(); retained.month = current().month;
    expect(sanitizeForecastMonthlyKpis(retained)).toBeNull();
    expect(browserApi().validateBundle(retained)).toBeNull();
  });

  test('mounts one read-only owner/admin route with no caller-supplied evidence', async () => {
    const queries = [];
    const client = { query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      return /canonical_forecast_monthly_kpis_v1_read/.test(sql) ?
        { rows: [{ value: current() }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/monthly-kpis', createForecastMonthlyKpisRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'owner'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app).get(`/api/v1/forecast/monthly-kpis/${ORIGIN}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      reason: 'same_run_manifest_not_available', sameRunManifestComplete: false,
      bundleIssued: false, paidNumericServing: false });
    expect(queries.map(item => item.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '2s'", expect.stringMatching(/monthly_kpis_v1_read/), 'COMMIT',
    ]);
    expect(queries[3].params).toEqual([TENANT, ACTOR, 'owner', SESSION, ORIGIN]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('fails closed for request and output drift', async () => {
    let result = null;
    const client = { query: jest.fn(async sql => /monthly_kpis_v1_read/.test(sql) ?
      { rows: [{ value: result }] } : { rows: [] }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/monthly-kpis', createForecastMonthlyKpisRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'admin'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    expect((await request(app).get('/api/v1/forecast/monthly-kpis/nope')).status).toBe(400);
    expect((await request(app).get(`/api/v1/forecast/monthly-kpis/${ORIGIN}?month=2026-11-01`))
      .status).toBe(400);
    expect((await request(app).get(`/api/v1/forecast/monthly-kpis/${ORIGIN}`)).status).toBe(404);
    result = { bad: true };
    expect((await request(app).get(`/api/v1/forecast/monthly-kpis/${ORIGIN}`)).status).toBe(503);
  });

  test('paid and fictional demo share clearing behavior without fallback', async () => {
    const api = browserApi();
    const demoFixture = documentFixture(); const demoCalls = [];
    const demo = api.create({ document: demoFixture.document, mode: 'demo',
      originProvider: () => ORIGIN,
      fetcher: async url => { demoCalls.push(url); throw new Error('must not call'); } });
    expect(await demo.workspaceReady({ tenantId: TENANT, role: 'viewer',
      mode: 'demo', fictional: true })).toBe(true);
    expect(demoCalls).toEqual([]);
    expect(demoFixture.elements.commandCenterMonthlyForecastKpisState.textContent)
      .toBe('Fictional guard');
    expect(demoFixture.elements.commandCenterMonthlyForecastKpiRevenueValue.textContent)
      .toBe('Not available');
    expect(demoFixture.elements.commandCenterMonthlyForecastKpiRevenueState.textContent)
      .toBe('Target presence unknown; run manifest unavailable');

    const paidFixture = documentFixture(); const paidCalls = [];
    paidFixture.elements.commandCenterMonthlyForecastKpiProfitValue.textContent = 'stale private value';
    const paid = api.create({ document: paidFixture.document, mode: 'paid',
      originProvider: () => ORIGIN, fetcher: async url => { paidCalls.push(url); return {
        ok: true, json: async () => ({ success: true, data: current() }) }; } });
    expect(await paid.workspaceReady({ tenantId: TENANT, role: 'owner',
      mode: 'paid', fictional: false })).toBe(true);
    expect(paidCalls).toEqual([`/api/v1/forecast/monthly-kpis/${ORIGIN}`]);
    expect(paidFixture.elements.commandCenterMonthlyForecastKpiProfitValue.textContent)
      .toBe('Not available');
    expect(paidFixture.elements.commandCenterMonthlyForecastKpisState.textContent)
      .toBe('KPIs unavailable');
    for (const suffix of ['Revenue','OperatingCost','Profit','Margin','Demand','Capacity']) {
      expect(paidFixture.elements[`commandCenterMonthlyForecastKpi${suffix}State`].textContent)
        .toBe('Target presence unknown; run manifest unavailable');
    }
    paid.workspaceUnavailable();
    expect(paidFixture.elements.commandCenterMonthlyForecastKpisAuthority.textContent)
      .toBe('No authenticated run identity is retained.');
    for (const suffix of ['Revenue','OperatingCost','Profit','Margin','Demand','Capacity']) {
      expect(paidFixture.elements[`commandCenterMonthlyForecastKpi${suffix}State`].textContent)
        .toBe('Unavailable');
    }
  });

  test('migration is additive, value-free and does not create the Part 11 platform', () => {
    const sql = fs.readFileSync('migrations/253_canonical_forecast_monthly_kpis_v1.sql', 'utf8');
    expect(sql).toMatch(/canonical_forecast_monthly_kpis_v1_read/);
    expect(sql).toMatch(/same_run_manifest_not_available/);
    expect(sql).toMatch(/authorized_earned_revenue_not_available/);
    expect(sql).toMatch(/complete_non_overlapping_operating_cost_categories/);
    expect(sql).toMatch(/qualified_available_role_hours/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    expect(sql).not.toMatch(/CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM|PERCENTILE_CONT|random\(/i);
    expect(sql).not.toMatch(/recommendation|automatic_action|export|saved_run_ledger/i);
  });
});
