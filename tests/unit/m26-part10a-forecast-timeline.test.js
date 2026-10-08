'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const { createForecastTimelinesRouter, sanitizeForecastTimeline } =
  require('../../src/routes/forecastTimelines');

const TENANT = '10000000-0000-4000-8000-000000000100';
const ACTOR = '10000000-0000-4000-8000-000000000101';
const SESSION = '10000000-0000-4000-8000-000000000102';

function browserApi() {
  const context = { window: {}, Reflect, Promise, encodeURIComponent };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
    '../../public/js/command-center-forecast-timeline.js'), 'utf8'), context);
  return context.window.NorthStarForecastTimeline;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function current() { return clone(browserApi().demoTimeline(TENANT)); }

class Element {
  constructor() { this.textContent = ''; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}
function documentFixture() {
  const ids = ['commandCenterForecastTimeline','commandCenterForecastTimelineState',
    'commandCenterForecastTimelineExplanation','commandCenterForecastTimelineAuthority',
    'commandCenterForecastTimelineBoundary','commandCenterForecastTimelineStatus'];
  for (const grain of ['Week','Month','Quarter']) {
    ids.push(`commandCenterForecastTimeline${grain}State`);
    for (const kind of ['Current','Prior','Actual']) {
      ids.push(`commandCenterForecastTimeline${grain}${kind}`);
    }
  }
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { elements, document: { getElementById: id => elements[id] } };
}

describe('Mission 26 original Part 10A forecast timeline boundary', () => {
  test('accepts the exact value-free three-grain boundary and rejects numeric or hostile data', () => {
    const value = current();
    expect(sanitizeForecastTimeline(value)).toBe(value);
    expect(browserApi().validateTimeline(value)).not.toBeNull();
    for (const period of value.periods) {
      expect(period).toMatchObject({ state: 'unavailable', current: null,
        prior: null, actual: null, partialPeriod: null });
    }
    for (const mutate of [
      candidate => { candidate.periods[0].current = { value: '9' }; },
      candidate => { candidate.periods[1].actual = '0'; },
      candidate => { candidate.periods.reverse(); },
      candidate => { candidate.runInventoryComplete = true; },
      candidate => { candidate.subject.target.key = 'revenue.earned_value'; },
      candidate => { candidate.crossTenant = true; },
    ]) {
      const poisoned = current(); mutate(poisoned);
      expect(sanitizeForecastTimeline(poisoned)).toBeNull();
      expect(browserApi().validateTimeline(poisoned)).toBeNull();
    }
  });

  test('clears the authenticated subject when a correction makes the baseline stale', () => {
    const value = current();
    value.reason = 'deterministic_baseline_not_current';
    value.subject = null; value.digests.timeline = null; value.sourceAuthenticated = false;
    value.currentness.baselineCurrent = false;
    value.currentness.correctionOrRevocationApplied = true;
    value.requirements.businessCalendarBuckets.timeZone = null;
    value.periods.forEach(period => { period.reason = value.reason; });
    expect(sanitizeForecastTimeline(value)).toBe(value);
    expect(browserApi().validateTimeline(value)).not.toBeNull();
  });

  test('mounts one read-only guarded route with no caller-supplied evidence', async () => {
    const queries = [];
    const client = { query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      return /canonical_forecast_timeline_v1_read/.test(sql) ?
        { rows: [{ value: current() }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/timelines', createForecastTimelinesRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'owner'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app)
      .get('/api/v1/forecast/timelines/90000000-0000-4000-8000-000000000010');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      reason: 'complete_saved_run_inventory_not_available', timelineIssued: false });
    expect(queries.map(item => item.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '2s'", expect.stringMatching(/forecast_timeline_v1_read/),
      'COMMIT',
    ]);
    expect(queries[3].params).toEqual([TENANT, ACTOR, 'owner', SESSION,
      '90000000-0000-4000-8000-000000000010']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('fails closed for malformed identifiers, extra query input, missing rows and malformed output',
    async () => {
      let result = null;
      const client = { query: jest.fn(async sql => /forecast_timeline_v1_read/.test(sql) ?
        { rows: [{ value: result }] } : { rows: [] }), release: jest.fn() };
      const app = express();
      app.use('/api/v1/forecast/timelines', createForecastTimelinesRouter({
        poolProvider: () => ({ connect: async () => client }),
        auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
          userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'admin'; next(); },
        permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
      }));
      expect((await request(app).get('/api/v1/forecast/timelines/nope')).status).toBe(400);
      expect((await request(app).get(
        '/api/v1/forecast/timelines/90000000-0000-4000-8000-000000000010?grain=week'))
        .status).toBe(400);
      expect((await request(app).get(
        '/api/v1/forecast/timelines/90000000-0000-4000-8000-000000000010')).status)
        .toBe(404);
      result = { bad: true };
      expect((await request(app).get(
        '/api/v1/forecast/timelines/90000000-0000-4000-8000-000000000010')).status)
        .toBe(503);
    });

  test('paid and demo controllers share value-free behavior without paid fallback', async () => {
    const api = browserApi();
    const demoFixture = documentFixture(); const demoCalls = [];
    const demo = api.create({ document: demoFixture.document, mode: 'demo',
      originProvider: () => '90000000-0000-4000-8000-000000000010',
      fetcher: async url => { demoCalls.push(url); throw new Error('must not call'); } });
    expect(await demo.workspaceReady({ tenantId: TENANT, role: 'viewer',
      mode: 'demo', fictional: true })).toBe(true);
    expect(demoCalls).toEqual([]);
    expect(demoFixture.elements.commandCenterForecastTimelineState.textContent)
      .toBe('Fictional guard');
    expect(demoFixture.elements.commandCenterForecastTimelineWeekCurrent.textContent)
      .toBe('Not available');

    const paidFixture = documentFixture(); const paidCalls = [];
    const paid = api.create({ document: paidFixture.document, mode: 'paid',
      originProvider: () => '90000000-0000-4000-8000-000000000010',
      fetcher: async url => { paidCalls.push(url); return { ok: true,
        json: async () => ({ success: true, data: current() }) }; } });
    expect(await paid.workspaceReady({ tenantId: TENANT, role: 'owner',
      mode: 'paid', fictional: false })).toBe(true);
    expect(paidCalls).toEqual([
      '/api/v1/forecast/timelines/90000000-0000-4000-8000-000000000010']);
    expect(paidFixture.elements.commandCenterForecastTimelineState.textContent)
      .toBe('Timeline unavailable');
    paid.workspaceUnavailable();
    expect(paidFixture.elements.commandCenterForecastTimelineAuthority.textContent)
      .toBe('No authenticated timeline identity is retained.');
  });

  test('migration is additive, value-free and does not preempt Parts 10B-D or 11', () => {
    const sql = fs.readFileSync('migrations/252_canonical_forecast_timeline_v1.sql', 'utf8');
    expect(sql).toMatch(/canonical_forecast_timeline_v1_read/);
    expect(sql).toMatch(/complete_saved_run_inventory_not_available/);
    expect(sql).toMatch(/authorized_finalized_actuals_not_available/);
    expect(sql).toMatch(/jsonb_build_array\('week','month','quarter'\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    expect(sql).not.toMatch(/CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM|PERCENTILE_CONT|random\(/i);
    expect(sql).not.toMatch(/recommendation|automatic_action|export|kpi_bundle|saved_run_ledger/i);
  });
});
