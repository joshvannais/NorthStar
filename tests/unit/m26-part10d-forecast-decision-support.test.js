'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const { createForecastDecisionSupportRouter, projectForecastDecisionSupport,
  sanitizeForecastDecisionSupport } = require('../../src/routes/forecastDecisionSupport');
const { projectForecastDrilldowns } = require('../../src/routes/forecastDrilldowns');

const TENANT = '10000000-0000-4000-8000-000000000100';
const ACTOR = '10000000-0000-4000-8000-000000000101';
const SESSION = '10000000-0000-4000-8000-000000000102';
const ORIGIN = '90000000-0000-4000-8000-000000000010';

function browserApis() {
  const context = { window: {}, Reflect, Promise, encodeURIComponent, Date, Number, JSON };
  context.window.window = context.window;
  for (const file of ['command-center-monthly-forecast-kpis.js',
    'command-center-forecast-drilldowns.js','command-center-forecast-decision-support.js']) {
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../public/js', file), 'utf8'),
      context);
  }
  return { monthly: context.window.NorthStarMonthlyForecastKpis,
    drilldowns: context.window.NorthStarForecastDrilldowns,
    decisions: context.window.NorthStarForecastDecisionSupport };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function currentBundle() { return clone(browserApis().monthly.demoBundle(TENANT)); }
function current() {
  return projectForecastDecisionSupport(projectForecastDrilldowns(currentBundle()),
    { userId: ACTOR, role: 'owner' });
}
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
  constructor() { this.textContent = ''; this.attributes = {}; this.open = false;
    this.disabled = false; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}
function documentFixture() {
  const ids = ['commandCenterForecastDecisionSupport','commandCenterForecastDecisionDetails',
    'commandCenterForecastDecisionState','commandCenterForecastDecisionExplanation',
    'commandCenterForecastAlertState','commandCenterForecastAlertBody',
    'commandCenterForecastAdviceState','commandCenterForecastAdviceBody',
    'commandCenterForecastExportState','commandCenterForecastExportBody',
    'commandCenterForecastExportButton','commandCenterForecastDecisionAuthority',
    'commandCenterForecastDecisionBoundary','commandCenterForecastDecisionStatus'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { elements, document: { getElementById: id => elements[id] } };
}

describe('Mission 26 original Part 10D guarded forecast decision support', () => {
  test('binds a value-free owner boundary to the current Part 10 anchor', () => {
    const value = current();
    expect(sanitizeForecastDecisionSupport(value)).toBe(value);
    expect(browserApis().decisions.validateDecisionSupport(value, { fictional: false }))
      .toBe(value);
    expect(value).toMatchObject({ state: 'unavailable',
      reason: 'same_run_manifest_not_available',
      audience: { scope: 'owner_admin', viewerUserId: ACTOR, viewerRole: 'owner' },
      alert: { state: 'unavailable', items: [], labelKind: null,
        direction: null, threshold: null, materiality: null,
        policy: { id: null, version: null, digest: null, current: false },
        dedupe: { key: null, runId: null, policyDigest: null, eventDigest: null } },
      advice: { state: 'unavailable', items: [], supportingEvidence: [],
        advisoryOnly: true, navigationIsApproval: false,
        receiverRecheckRequired: true, automaticActionAuthorized: false },
      export: { state: 'unavailable', packet: null, downloadUrl: null,
        shareUrl: null, pointInTime: true, fictional: false, includedFields: [] },
      alertIssued: false, recommendationIssued: false, exportIssued: false,
      probabilityOrConfidenceIssued: false, automaticActionAuthorized: false,
      outboundCommunicationAuthorized: false, reviewedHandoffAuthorized: false });
    expect(value.anchor.runId).toBeNull();
    expect(value.anchor.period).toEqual(projectForecastDrilldowns(currentBundle()).period);
    expect(value.digests.timeline).toBe(value.anchor.timelineDigest);
    expect(value.digests.bundle).toBe(value.anchor.bundleDigest);
  });

  test.each([
    ['positive alert', value => { value.alert.items.push({ direction: 'positive' }); }],
    ['negative alert', value => { value.alert.direction = 'negative'; }],
    ['invented policy', value => { value.alert.policy.version = 'v1'; }],
    ['invented dedupe', value => { value.alert.dedupe.key = 'reload-proof'; }],
    ['generic confidence', value => { value.probabilityOrConfidenceIssued = true; }],
    ['recommendation', value => { value.advice.items.push({ action: 'staff' }); }],
    ['handoff workflow', value => { value.advice.receivingWorkflow = '/schedule'; }],
    ['export packet', value => { value.export.packet = { run: 'fake' }; }],
    ['download target', value => { value.export.downloadUrl = '/download'; }],
    ['paid evidence in demo', value => { value.export.includedFields.push('paid_evidence'); }],
    ['secret omitted from exclusions', value => { value.export.excludedFields.splice(3, 1); }],
    ['current response without period', value => { value.anchor.period = null; }],
    ['tampered timeline', value => { value.digests.timeline = '0'.repeat(64); }],
    ['automatic action', value => { value.automaticActionAuthorized = true; }],
    ['outbound communication', value => { value.outboundCommunicationAuthorized = true; }],
    ['extra property', value => { value.alert.confidence = '80%'; }],
  ])('rejects %s', (_name, mutate) => {
    const value = current(); mutate(value);
    expect(sanitizeForecastDecisionSupport(value)).toBeNull();
    expect(browserApis().decisions.validateDecisionSupport(value, { fictional: false }))
      .toBeNull();
  });

  test('correction or revocation clears every retained source and decision identity', () => {
    const value = projectForecastDecisionSupport(projectForecastDrilldowns(staleBundle()),
      { userId: ACTOR, role: 'admin' });
    expect(sanitizeForecastDecisionSupport(value)).toBe(value);
    expect(value).toMatchObject({ reason: 'deterministic_baseline_not_current',
      anchor: { period: null, sourceSnapshotDigest: null, sourceReceiptDigest: null,
        timelineDigest: null, bundleDigest: null, runId: null },
      alert: { reason: 'source_currentness_not_available', items: [] },
      export: { packet: null, stale: true },
      currentness: { anchorCurrent: false, correctionOrRevocationApplied: true },
      digests: { decisionSupport: null, alertEvent: null, exportPacket: null,
        timeline: null, bundle: null } });
    const poisoned = clone(value); poisoned.anchor.period = current().anchor.period;
    expect(sanitizeForecastDecisionSupport(poisoned)).toBeNull();
  });

  test('mounts one private owner/admin route over the existing Part 10B reader', async () => {
    const queries = [];
    const client = { query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      return /canonical_forecast_monthly_kpis_v1_read/.test(sql) ?
        { rows: [{ value: currentBundle() }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/decision-support', createForecastDecisionSupportRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'owner'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app).get(`/api/v1/forecast/decision-support/${ORIGIN}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.body.data).toMatchObject({ organizationId: TENANT,
      alertIssued: false, recommendationIssued: false, exportIssued: false });
    expect(queries.map(item => item.sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '2s'", expect.stringMatching(/monthly_kpis_v1_read/), 'COMMIT',
    ]);
    expect(queries[3].params).toEqual([TENANT, ACTOR, 'owner', SESSION, ORIGIN]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('denies other roles before database access and fails closed on invalid evidence', async () => {
    const connect = jest.fn();
    const denied = express();
    denied.use('/api/v1/forecast/decision-support', createForecastDecisionSupportRouter({
      poolProvider: () => ({ connect }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'member'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    expect((await request(denied).get(`/api/v1/forecast/decision-support/${ORIGIN}`)).status)
      .toBe(403);
    expect(connect).not.toHaveBeenCalled();

    let result = null;
    const client = { query: jest.fn(async sql => /monthly_kpis_v1_read/.test(sql) ?
      { rows: [{ value: result }] } : { rows: [] }), release: jest.fn() };
    const app = express();
    app.use('/api/v1/forecast/decision-support', createForecastDecisionSupportRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => { req.tenantContext = { organizationId: TENANT,
        userId: ACTOR }; req.authSession = { id: SESSION }; req.userRole = 'admin'; next(); },
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    expect((await request(app).get('/api/v1/forecast/decision-support/nope')).status).toBe(400);
    expect((await request(app).get(`/api/v1/forecast/decision-support/${ORIGIN}?x=1`)).status)
      .toBe(400);
    expect((await request(app).get(`/api/v1/forecast/decision-support/${ORIGIN}`)).status)
      .toBe(404);
    result = { fabricated: true };
    expect((await request(app).get(`/api/v1/forecast/decision-support/${ORIGIN}`)).status)
      .toBe(503);
  });

  test('paid and fictional demo clear prior alerts, actions, exports and links', async () => {
    const api = browserApis().decisions;
    const demoFixture = documentFixture(); const demoCalls = [];
    const demo = api.create({ document: demoFixture.document, mode: 'demo',
      originProvider: () => ORIGIN,
      fetcher: async url => { demoCalls.push(url); throw new Error('must not call'); } });
    expect(await demo.workspaceReady({ tenantId: TENANT, role: 'viewer',
      mode: 'demo', fictional: true })).toBe(true);
    expect(demoCalls).toEqual([]);
    expect(demoFixture.elements.commandCenterForecastDecisionState.textContent)
      .toBe('Fictional guard');
    expect(demoFixture.elements.commandCenterForecastExportButton.disabled).toBe(true);
    expect(demoFixture.elements.commandCenterForecastExportBody.textContent)
      .toMatch(/no fictional packet.*no paid evidence/i);

    const paidFixture = documentFixture(); const paidCalls = [];
    paidFixture.elements.commandCenterForecastAlertBody.textContent = 'stale positive alert';
    paidFixture.elements.commandCenterForecastAdviceBody.textContent = 'stale change schedule';
    paidFixture.elements.commandCenterForecastExportBody.textContent = 'stale download link';
    paidFixture.elements.commandCenterForecastDecisionDetails.open = true;
    const paid = api.create({ document: paidFixture.document, mode: 'paid',
      originProvider: () => ORIGIN, fetcher: async url => { paidCalls.push(url); return {
        ok: true, json: async () => ({ success: true, data: current() }) }; } });
    expect(await paid.workspaceReady({ tenantId: TENANT, role: 'owner',
      mode: 'paid', fictional: false })).toBe(true);
    expect(paidCalls).toEqual([`/api/v1/forecast/decision-support/${ORIGIN}`]);
    expect(paidFixture.elements.commandCenterForecastAlertBody.textContent)
      .not.toMatch(/stale positive/);
    expect(paidFixture.elements.commandCenterForecastAdviceBody.textContent)
      .not.toMatch(/stale change/);
    expect(paidFixture.elements.commandCenterForecastExportBody.textContent)
      .not.toMatch(/stale download/);
    expect(paidFixture.elements.commandCenterForecastExportButton.disabled).toBe(true);
    paid.workspaceUnavailable();
    expect(paidFixture.elements.commandCenterForecastDecisionDetails.open).toBe(false);
    expect(paidFixture.elements.commandCenterForecastDecisionAuthority.textContent)
      .toMatch(/No accepted run, alert policy, event, advisory, export packet or digest/);
  });

  test('preserves migration 253 and contains no storage, communication or mutation path', () => {
    expect(fs.existsSync('migrations/254_canonical_forecast_decision_support.sql')).toBe(false);
    const source = fs.readFileSync('src/routes/forecastDecisionSupport.js', 'utf8');
    const page = fs.readFileSync('public/js/command-center-page.js', 'utf8');
    const html = fs.readFileSync('public/demo-dashboard.html', 'utf8');
    expect(source).toMatch(/canonical_forecast_monthly_kpis_v1_read/);
    expect(source).not.toMatch(/CREATE TABLE|INSERT INTO|UPDATE\s|DELETE FROM|downloadUrl:\s*['"]|shareUrl:\s*['"]/i);
    expect(source).toMatch(/outboundCommunicationAuthorized:\s*false/);
    expect(page).toMatch(/renderForecastDecisionSupport\(\)/);
    expect(page).toMatch(/forecastDecisionSupport\.workspaceLoading\(\)/);
    expect(page).toMatch(/forecastDecisionSupport\.workspaceUnavailable\(\)/);
    expect(html.indexOf('command-center-forecast-decision-support.js'))
      .toBeLessThan(html.indexOf('command-center-page.js'));
  });
});
