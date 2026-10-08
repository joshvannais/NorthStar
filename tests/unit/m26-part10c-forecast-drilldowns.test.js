'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const { VERSION, createForecastDrilldownsRouter, projectForecastDrilldowns,
  sanitizeForecastDrilldowns } = require('../../src/routes/forecastDrilldowns');

const TENANT = '10000000-0000-4000-8000-000000000100';
const ACTOR = '10000000-0000-4000-8000-000000000101';
const SESSION = '10000000-0000-4000-8000-000000000102';
const ORIGIN = '90000000-0000-4000-8000-000000000010';
const KEYS = ['revenue','operating_cost','profit','margin','demand','capacity'];
const SUFFIXES = ['Revenue','OperatingCost','Profit','Margin','Demand','Capacity'];

function browserApis() {
  const context = { window: {}, Reflect, Promise, encodeURIComponent, Date, Number, JSON };
  context.window.window = context.window;
  for (const file of ['command-center-monthly-forecast-kpis.js',
    'command-center-forecast-drilldowns.js']) {
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../public/js', file), 'utf8'),
      context);
  }
  return { monthly: context.window.NorthStarMonthlyForecastKpis,
    drilldowns: context.window.NorthStarForecastDrilldowns };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function currentBundle() { return clone(browserApis().monthly.demoBundle(TENANT)); }
function current() { return projectForecastDrilldowns(currentBundle()); }
function staleBundle() {
  const value = currentBundle();
  value.reason = 'deterministic_baseline_not_current'; value.anchor = null;
  value.month = null; value.graph.month = null; value.digests.bundle = null;
  value.anchorSourceAuthenticated = false; value.currentness.anchorCurrent = false;
  value.currentness.correctionOrRevocationApplied = true;
  value.slots.forEach(slot => { slot.reason = value.reason; });
  value.graph.reason = value.reason;
  return value;
}

class Element {
  constructor() { this.textContent = ''; this.attributes = {}; this.open = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}
function documentFixture() {
  const ids = ['commandCenterForecastDrilldowns','commandCenterForecastDrilldownsState',
    'commandCenterForecastDrilldownsExplanation','commandCenterForecastDrilldownsAuthority',
    'commandCenterForecastDrilldownsBoundary','commandCenterForecastDrilldownsStatus'];
  for (const suffix of SUFFIXES) for (const field of [
    'Coverage','Assumptions','Confidence','Uncertainty','Stale','Change','Error','Cause']) {
    ids.push(`commandCenterForecastDrilldown${suffix}${field}`);
  }
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { elements, document: { getElementById: id => elements[id] } };
}

describe('Mission 26 original Part 10C guarded forecast drilldowns', () => {
  test('binds six value-free drilldowns to the exact Part 10B bundle and period', () => {
    const value = current();
    expect(value.version).toBe(VERSION);
    expect(sanitizeForecastDrilldowns(value)).toBe(value);
    expect(browserApis().drilldowns.validateDrilldowns(value)).not.toBeNull();
    expect(value.slots.map(slot => slot.key)).toEqual(KEYS);
    expect(value.period).toEqual(value.bundle.month);
    expect(value.slots.every(slot => slot.identity.runId === null &&
      slot.sourceCoverage.numerator === null && slot.sourceCoverage.denominator === null &&
      slot.assumptions.items.length === 0 && slot.confidence.percentage === null &&
      slot.uncertainty.drivers.length === 0 && slot.change.amount === null &&
      slot.error.amount === null && slot.cause.state === 'unknown')).toBe(true);
    expect(value).toMatchObject({ sourceCoverageAuthenticated: false,
      assumptionsAuthenticated: false, evaluationReviewed: false,
      staleInputAuthorityAvailable: false, numericalDetailIssued: false,
      paidNumericServing: false, automaticActionAuthorized: false });
  });

  test.each([
    ['fabricated coverage zero', candidate => { candidate.slots[0].sourceCoverage.numerator = 0; }],
    ['fabricated denominator', candidate => { candidate.slots[0].sourceCoverage.denominator = 1; }],
    ['invented assumption', candidate => { candidate.slots[1].assumptions.items.push({ value: 1 }); }],
    ['generic confidence', candidate => { candidate.slots[2].confidence.percentage = '80'; }],
    ['invented uncertainty', candidate => { candidate.slots[3].uncertainty.drivers.push('guess'); }],
    ['fabricated point change', candidate => { candidate.slots[4].change.amount = '0'; }],
    ['fabricated forecast error', candidate => { candidate.slots[4].error.amount = '-1'; }],
    ['invented cause', candidate => { candidate.slots[5].cause.drivers.push('price'); }],
    ['mixed target identity', candidate => { candidate.slots[0].identity.target.key = 'cash.receipts'; }],
    ['range substituted as point', candidate => {
      candidate.slots[0].change.amount = candidate.bundle.slots[0].value = '10';
    }],
    ['tampered bundle digest', candidate => { candidate.digests.bundle = '0'.repeat(64); }],
    ['reordered details', candidate => { candidate.slots.reverse(); }],
    ['extra field', candidate => { candidate.probability = 0.8; }],
  ])('rejects %s', (_name, mutate) => {
    const value = current(); mutate(value);
    expect(sanitizeForecastDrilldowns(value)).toBeNull();
    expect(browserApis().drilldowns.validateDrilldowns(value)).toBeNull();
  });

  test('correction currentness clears period and all retained identities', () => {
    const value = projectForecastDrilldowns(staleBundle());
    expect(sanitizeForecastDrilldowns(value)).toBe(value);
    expect(value).toMatchObject({ reason: 'deterministic_baseline_not_current',
      period: null, currentness: { anchorCurrent: false,
        correctionOrRevocationApplied: true },
      digests: { drilldown: null, bundle: null, timeline: null, run: null, manifest: null } });
    const poisoned = clone(value); poisoned.period = current().period;
    expect(sanitizeForecastDrilldowns(poisoned)).toBeNull();
  });

  test('mounts one guarded owner/admin route over the exact Part 10B read', async () => {
    const queries = [];
    const client = { query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      return /canonical_forecast_monthly_kpis_v1_read/.test(sql) ?
        { rows: [{ value: currentBundle() }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/drilldowns', createForecastDrilldownsRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'owner'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app).get(`/api/v1/forecast/drilldowns/${ORIGIN}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      reason: 'same_run_manifest_not_available', numericalDetailIssued: false,
      paidNumericServing: false, automaticActionAuthorized: false });
    expect(queries.map(item => item.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '2s'", expect.stringMatching(/monthly_kpis_v1_read/), 'COMMIT',
    ]);
    expect(queries[3].params).toEqual([TENANT, ACTOR, 'owner', SESSION, ORIGIN]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('fails closed for request, source loss and output drift', async () => {
    let result = null;
    const client = { query: jest.fn(async sql => /monthly_kpis_v1_read/.test(sql) ?
      { rows: [{ value: result }] } : { rows: [] }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/drilldowns', createForecastDrilldownsRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'admin'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    expect((await request(app).get('/api/v1/forecast/drilldowns/nope')).status).toBe(400);
    expect((await request(app).get(`/api/v1/forecast/drilldowns/${ORIGIN}?target=demand`))
      .status).toBe(400);
    expect((await request(app).get(`/api/v1/forecast/drilldowns/${ORIGIN}`)).status).toBe(404);
    result = { bad: true };
    expect((await request(app).get(`/api/v1/forecast/drilldowns/${ORIGIN}`)).status).toBe(503);
  });

  test('paid and fictional demo share stale-clearing behavior without fallback', async () => {
    const api = browserApis().drilldowns;
    const demoFixture = documentFixture(); const demoCalls = [];
    const demo = api.create({ document: demoFixture.document, mode: 'demo',
      originProvider: () => ORIGIN,
      fetcher: async url => { demoCalls.push(url); throw new Error('must not call'); } });
    expect(await demo.workspaceReady({ tenantId: TENANT, role: 'viewer',
      mode: 'demo', fictional: true })).toBe(true);
    expect(demoCalls).toEqual([]);
    expect(demoFixture.elements.commandCenterForecastDrilldownsState.textContent)
      .toBe('Fictional guard');
    expect(demoFixture.elements.commandCenterForecastDrilldownRevenueConfidence.textContent)
      .toMatch(/no reviewed evaluation.*confidence percentage/i);

    const paidFixture = documentFixture(); const paidCalls = [];
    paidFixture.elements.commandCenterForecastDrilldownProfitCause.textContent =
      'stale private cause';
    const paid = api.create({ document: paidFixture.document, mode: 'paid',
      originProvider: () => ORIGIN, fetcher: async url => { paidCalls.push(url); return {
        ok: true, json: async () => ({ success: true, data: current() }) }; } });
    expect(await paid.workspaceReady({ tenantId: TENANT, role: 'owner',
      mode: 'paid', fictional: false })).toBe(true);
    expect(paidCalls).toEqual([`/api/v1/forecast/drilldowns/${ORIGIN}`]);
    expect(paidFixture.elements.commandCenterForecastDrilldownProfitCause.textContent)
      .toMatch(/^Unknown/);
    expect(paidFixture.elements.commandCenterForecastDrilldownsState.textContent)
      .toBe('Details unavailable');
    paid.workspaceUnavailable();
    expect(paidFixture.elements.commandCenterForecastDrilldownsAuthority.textContent)
      .toBe('No authenticated run, period or drilldown identity is retained.');
    expect(paidFixture.elements.commandCenterForecastDrilldowns.open).toBe(false);
  });

  test('reuses migration 253 and does not create Part 10D or Part 11 behavior', () => {
    expect(fs.existsSync('migrations/254_canonical_forecast_drilldowns_v1.sql')).toBe(false);
    const source = fs.readFileSync('src/routes/forecastDrilldowns.js', 'utf8');
    expect(source).toMatch(/canonical_forecast_monthly_kpis_v1_read/);
    expect(source).toMatch(/authenticated_lineage_difference_not_available/);
    expect(source).not.toMatch(/CREATE TABLE|recommendation|automatic action|export packet/i);
  });
});
