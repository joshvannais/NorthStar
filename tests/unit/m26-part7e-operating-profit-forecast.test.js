'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const vm = require('node:vm');
const { createForecastOperatingProfitRouter, sanitizeForecast } =
  require('../../src/routes/forecastOperatingProfit');
const { createOperatingProfitPolicyRouter, sanitizePolicy, sanitizeReceipt } =
  require('../../src/routes/operatingProfitPolicy');

const ORG = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000002';
const SESSION = '10000000-0000-4000-8000-000000000003';

function browserApi() {
  const context = { window: {}, console, Intl, Date, Number, Promise, Set };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
    '../../public/js/command-center-operating-profit-forecast.js'), 'utf8'), context);
  return context.window.NorthStarOperatingProfitForecast;
}

function forecast(overrides = {}) {
  return Object.assign({}, browserApi().demoForecast(), { fictional: false }, overrides);
}

function unavailable(reason = 'economic_expense_policy_unavailable') {
  const base = forecast();
  return { ...base, state: 'unavailable', reason, currency: null,
    kpis: { operatingCost: null, profitLow: null, profitHigh: null,
      marginLow: null, marginHigh: null }, months: [],
    revenue: { ...base.revenue, amount: null },
    costs: { ...base.costs, directJobCost: null, incrementalJobOverhead: null,
      fixedPeriodExpense: null, variablePeriodExpense: null, operatingCost: null,
      datedCashObligations: null },
    range: { ...base.range, scenarios: [] },
    evidence: Object.fromEntries(Object.keys(base.evidence).map(key => [key, false])),
    run: { ...base.run, digest: null }, forecastIssued: false };
}

function storedPolicy() {
  return { action: 'replace', currency: 'USD', effectiveOn: '2026-10-07',
    coverage: { startsOn: '2026-10-07', endsOn: '2026-11-05',
      recordedThrough: '2026-10-07T12:00:00.000Z', complete: true },
    expenses: [{ expenseKey: 'office-rent', label: 'Office rent',
      classification: 'fixed_period', amount: '3200.00',
      recognitionStartsOn: '2026-10-07', recognitionEndsOn: '2026-11-05',
      source: { kind: 'owner_attested', reference: 'Current lease schedule',
        documentDigest: null, attestedAt: '2026-10-07T12:00:00.000Z' } }],
    scenarios: [{ key: 'recorded_plan', label: 'Recorded plan',
      operatingCostBasisPoints: 10000, reason: 'Uses recorded economic costs.' },
    { key: 'cost_pressure', label: 'Cost pressure', operatingCostBasisPoints: 11500,
      reason: 'Applies a named 15% cost assumption.' }],
    schedulePin: { revision: 1, digest: 'b'.repeat(64) },
    overlapReview: { status: 'reconciled',
      reason: 'Dated cash and economic costs were reviewed separately.' } };
}

function auth(req, _res, next) {
  req.tenantContext = { organizationId: ORG, userId: USER };
  req.userRole = 'owner'; req.authSession = { id: SESSION }; next();
}

describe('Mission 26 original Part 7E operating cost, profit, and margin', () => {
  test('accepts only a strict fail-closed aggregate and preserves planning boundaries', () => {
    expect(sanitizeForecast(forecast())).toEqual(forecast());
    expect(sanitizeForecast(unavailable())).toEqual(unavailable());
    expect(sanitizeForecast(unavailable('nonzero_revenue_denominator_unavailable'))).not.toBeNull();
    expect(sanitizeForecast({ ...forecast(), sourceJobIds: ['private'] })).toBeNull();
    expect(sanitizeForecast(forecast({ fictional: true }))).toBeNull();
    expect(sanitizeForecast(forecast({ revenue: { ...forecast().revenue,
      earnedRevenueMeasured: true } }))).toBeNull();
    expect(sanitizeForecast(forecast({ costs: { ...forecast().costs,
      actualPaymentMeasured: true } }))).toBeNull();
    expect(sanitizeForecast(forecast({ range: { ...forecast().range,
      calibrated: true } }))).toBeNull();
    expect(sanitizeForecast(forecast({ evidence: { ...forecast().evidence,
      m25AdjustmentApplied: true } }))).toBeNull();
    const threeMonths = forecast().months.concat({ ...forecast().months[1], month: '2026-12' });
    expect(sanitizeForecast(forecast({ months: threeMonths }))).not.toBeNull();
    expect(sanitizeForecast(forecast({ months: [...forecast().months].reverse() }))).toBeNull();
    expect(sanitizeForecast(forecast({ months: [forecast().months[0],
      { ...forecast().months[1], month: forecast().months[0].month }] }))).toBeNull();
    expect(sanitizeForecast(forecast({ months: threeMonths.concat({
      ...forecast().months[1], month: '2027-01' }) }))).toBeNull();
  });

  test('serves the aggregate through one read-committed owner-scoped route', async () => {
    const calls = []; let projection = forecast();
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_forecast_operating_profit_v1_current/.test(sql) ?
        { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/forecast', createForecastOperatingProfitRouter({
      poolProvider: () => ({ connect: async () => client }), auth,
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app).get('/forecast/current');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(calls[0].sql).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(calls.find(call => call.parameters).parameters).toEqual([ORG, USER, 'owner', SESSION]);
    projection = { ...forecast(), estimateId: 'private-source' }; calls.length = 0;
    expect((await request(app).get('/forecast/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/forecast/current?tenant=other')).status).toBe(400);
  });

  test('uses strict serializable idempotent policy mutation and strict policy reads', async () => {
    const projection = { state: 'current', revision: 1, digest: 'c'.repeat(64),
      action: 'replace', createdAt: '2026-10-07T12:00:00.000Z', policy: storedPolicy() };
    const receipt = { revision: 1, digest: 'c'.repeat(64), action: 'replace', replayed: false };
    expect(sanitizePolicy(projection)).toEqual(projection);
    expect(sanitizePolicy({ ...projection, policy: { ...projection.policy, authority: 'private' } })).toBeNull();
    expect(sanitizePolicy({ ...projection, policy: { ...projection.policy,
      scenarios: projection.policy.scenarios.map(item => ({ ...item, key: 'cost_pressure' })) } })).toBeNull();
    expect(sanitizePolicy({ ...projection, policy: { ...projection.policy,
      expenses: [projection.policy.expenses[0], { ...projection.policy.expenses[0] }] } })).toBeNull();
    expect(sanitizeReceipt(receipt)).toEqual(receipt);
    const calls = [];
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_operating_profit_policy_mutate/.test(sql) ?
        { rows: [{ value: receipt }] } : /canonical_operating_profit_policy_read/.test(sql) ?
          { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express(); app.use(express.json());
    app.use('/policy', createOperatingProfitPolicyRouter({
      poolProvider: () => ({ connect: async () => client }), auth,
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const mutationBody = { expectedRevision: 0, expectedDigest: 'none', ...storedPolicy(),
      reason: 'Record current economic expenses and named planning assumptions.', confirmed: true,
      confirmationVersion: 'operating-profit-policy-v1' };
    const write = await request(app).post('/policy').set('Idempotency-Key', 'part7e-policy-key-0001')
      .set('X-CSRF-Token', 'csrf-token').send(mutationBody);
    expect(write.status).toBe(201);
    expect(calls.find(call => call.sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toBeDefined();
    expect(calls.findIndex(call => /pg_advisory_lock/.test(call.sql)))
      .toBeLessThan(calls.findIndex(call => call.sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE'));
    expect(calls.some(call => /pg_advisory_unlock/.test(call.sql))).toBe(true);
    const mutation = calls.find(call => call.parameters && call.parameters.length === 7);
    expect(mutation.parameters.slice(0, 6)).toEqual([
      ORG, USER, 'owner', SESSION, 'csrf-token', 'part7e-policy-key-0001']);
    expect(mutation.parameters[6]).toEqual(mutationBody);
    expect((await request(app).get('/policy')).status).toBe(200);
  });

  test('shares one compact renderer across paid and fictional demo and clears stale facts', async () => {
    const api = browserApi();
    expect(api.validate(api.demoForecast())).not.toBeNull();
    expect(api.validate({ ...api.demoForecast(), privateJob: 'hidden' })).toBeNull();
    const ids = ['commandCenterOperatingProfit', 'commandCenterOperatingProfitState',
      'commandCenterOperatingCostKpi', 'commandCenterOperatingProfitKpi',
      'commandCenterOperatingMarginKpi', 'commandCenterOperatingProfitRevenue',
      'commandCenterOperatingProfitDirect', 'commandCenterOperatingProfitJobOverhead',
      'commandCenterOperatingProfitPeriodExpense', 'commandCenterOperatingProfitCash',
      'commandCenterOperatingProfitGraphPlot', 'commandCenterOperatingProfitGraphDescription',
      'commandCenterOperatingProfitExplanation', 'commandCenterOperatingProfitStatus'];
    class Element {
      constructor() { this.textContent = ''; this.dataset = {}; this.children = []; this.attributes = {}; }
      setAttribute(key, value) { this.attributes[key] = String(value); }
      appendChild(child) { this.children.push(child); return child; }
    }
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements.commandCenterOperatingCostKpi.textContent = '$99,999 private stale';
    let resolveFetch;
    const client = api.create({ mode: 'paid', document: {
      getElementById: id => elements[id], createElementNS: () => new Element(),
    }, fetcher: () => new Promise(resolve => { resolveFetch = resolve; }) });
    const pending = client.workspaceReady();
    expect(elements.commandCenterOperatingCostKpi.textContent).toBe('Not available');
    expect(elements.commandCenterOperatingProfitGraphPlot.textContent).toBe('');
    resolveFetch({ ok: true, json: async () => ({ success: true, data: forecast() }) });
    await pending;
    expect(elements.commandCenterOperatingCostKpi.textContent).toBe('$18,000.00');
    expect(elements.commandCenterOperatingProfitKpi.textContent).toBe('$4,800.00–$7,500.00');
    expect(elements.commandCenterOperatingProfitGraphPlot.children.length).toBeGreaterThan(4);
    expect(elements.commandCenterOperatingProfitExplanation.textContent)
      .toMatch(/Dated overhead and financing cash stay outside profit/);
    expect(elements.commandCenterOperatingProfitStatus.textContent).toContain('Margin range 18.82%–29.41%');
    const demoElements = Object.fromEntries(ids.map(id => [id, new Element()]));
    const demo = api.create({ mode: 'demo', document: {
      getElementById: id => demoElements[id], createElementNS: () => new Element(),
    }, fetcher: () => { throw new Error('Demo must not call the paid route'); } });
    await demo.workspaceReady();
    expect(demoElements.commandCenterOperatingProfitState.textContent).toBe('Fictional example');
    expect(demoElements.commandCenterOperatingCostKpi.textContent).toBe('$18,000.00');
    demo.workspaceUnavailable();
    expect(demoElements.commandCenterOperatingProfitState.textContent).toBe('Unavailable');
    expect(demoElements.commandCenterOperatingProfitGraphPlot.textContent).toBe('');
    expect(demoElements.commandCenterOperatingProfitCash.textContent).toBe('Not available');
    await demo.workspaceReady();
    expect(demoElements.commandCenterOperatingProfitState.textContent).toBe('Fictional example');
    expect(demoElements.commandCenterOperatingCostKpi.textContent).toBe('$18,000.00');
  });

  test('keeps the outlook inside the existing compact Command Center surface', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/demo-dashboard.html'), 'utf8');
    const parent = html.indexOf('id="commandCenterCostRiskOutlook"');
    const child = html.indexOf('id="commandCenterOperatingProfit"');
    const details = html.indexOf('id="commandCenterOperatingProfitDetails"');
    expect(child).toBeGreaterThan(parent);
    expect(details).toBeGreaterThan(child);
    expect(html).toMatch(/id="commandCenterOperatingProfitStatus"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/);
    expect(html).toContain('aria-labelledby="commandCenterOperatingProfitGraphTitle commandCenterOperatingProfitGraphDescription"');
  });
});
