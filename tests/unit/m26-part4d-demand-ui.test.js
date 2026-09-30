'use strict';

const fs = require('node:fs');
const express = require('express');
const request = require('supertest');
const demand = require('../../public/js/command-center-demand-position');
const { createForecastCurrentBacklogRouter, safeSnapshot } =
  require('../../src/routes/forecastCurrentBacklog');

const ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const DIGEST = 'a'.repeat(64);

function snapshot(extra = {}) {
  return {
    id: ID, version: 'm26-current-backlog-position-v1',
    targetKey: 'demand.current_backlog_position.v1', state: 'descriptive_subset',
    reason: null, capturedAt: '2026-09-30T12:00:00.000000Z',
    approvedUnscheduledCount: 1, approvedScheduledCount: 2,
    workInProgressCount: 1, completedCount: 0, unresolvedLinkageCount: 0,
    knownBacklogCount: 4, plannedPersonMinutes: '780.000000',
    backlogHoursState: 'available', backlogHoursReason: null,
    sourceDigest: DIGEST, snapshotDigest: DIGEST,
    sourceAuthority: 'northstar_authenticated_booking_schedule_and_execution_current_position',
    sourceAuthenticated: true, knownSubsetOnly: true,
    sourceCoverageComplete: false, offPlatformCoverageVerified: false,
    providerCoverageVerified: false, probabilityCalibrated: false,
    forecastIssued: false, paidNumericServing: false, ...extra,
  };
}

class Element {
  constructor() {
    this.textContent = ''; this.value = ''; this.hidden = false; this.children = [];
    this.listeners = {};
  }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  replaceChildren() { this.children = []; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); return item; }
}

function documentFixture() {
  const ids = ['commandCenterBacklogState', 'commandCenterBacklogTitle',
    'commandCenterBacklogExplanation', 'commandCenterBacklogMetrics',
    'commandCenterBacklogNotice', 'commandCenterBacklogRetry',
    'commandCenterBacklogActions', 'commandCenterBacklogCapture',
    'commandCenterBacklogRead', 'commandCenterBacklogReceipt'];
  const values = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { values, document: { getElementById: id => values[id],
    createElement: () => new Element() } };
}

function response(status, data, error) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => data ? { success: true, data } : { success: false, error } };
}

describe('Mission 26 Part 4D bounded demand UI', () => {
  test('starts paid mode without a read or capture and performs explicit replay-safe capture', async () => {
    const fixture = documentFixture(), calls = [];
    const controller = demand.create({ mode: 'paid', document: fixture.document,
      idempotency: () => 'part4d-capture-key-0001',
      fetcher: async (url, options) => { calls.push({ url, options });
        return response(201, { ...snapshot(), replayed: false }); } });
    expect(calls).toEqual([]);
    expect(controller.state().kind).toBe('initial');
    await controller.capture();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/v1/forecast/current-backlog/snapshots');
    expect(calls[0].options.headers['Idempotency-Key']).toBe('part4d-capture-key-0001');
    expect(controller.state()).toMatchObject({ kind: 'available', receiptId: ID });
    expect(fixture.values.commandCenterBacklogMetrics.children).toHaveLength(5);
    expect(fixture.values.commandCenterBacklogMetrics.children[4].children[1].textContent)
      .toBe('13 person-hours');
  });

  test('reads only an exact requested receipt and withholds stale numerics', async () => {
    const fixture = documentFixture(), calls = [];
    const stale = snapshot({ state: 'source_stale', reason: 'source_changed_after_capture',
      approvedUnscheduledCount: 0, approvedScheduledCount: 0, workInProgressCount: 0,
      completedCount: 0, unresolvedLinkageCount: 0, knownBacklogCount: 0,
      plannedPersonMinutes: null, backlogHoursState: 'unavailable',
      backlogHoursReason: 'source_changed_after_capture', sourceDigest: null,
      snapshotDigest: null, sourceAuthenticated: false });
    const controller = demand.create({ mode: 'paid', document: fixture.document,
      idempotency: () => 'unused-part4d-key', fetcher: async (url, options) => {
        calls.push({ url, options }); return response(200, stale); } });
    fixture.values.commandCenterBacklogReceipt.value = 'bad';
    await controller.read();
    expect(calls).toEqual([]);
    expect(controller.state().kind).toBe('invalid');
    fixture.values.commandCenterBacklogReceipt.value = ID;
    await controller.read();
    expect(calls[0].url).toBe(`/api/v1/forecast/current-backlog/snapshots/${ID}`);
    expect(controller.state().kind).toBe('stale');
    expect(fixture.values.commandCenterBacklogMetrics.children).toEqual([]);
    expect(JSON.stringify(controller.state())).not.toMatch(/780|sourceDigest|snapshotDigest/);
  });

  test('keeps bounded counts separate when reviewed planned time is missing or noncurrent', () => {
    for (const reason of ['reviewed_person_hour_plan_missing',
      'reviewed_person_hour_plan_not_current']) {
      const model = demand.project(snapshot({ plannedPersonMinutes: null,
        backlogHoursState: 'unavailable', backlogHoursReason: reason }), false);
      expect(model).toMatchObject({ kind: 'plan-unavailable',
        badge: 'Planned time unavailable', receiptId: ID });
      expect(model.metrics).toContainEqual(['Known active backlog', 4]);
      expect(model.metrics).toContainEqual(['Reviewed planned time', 'Unavailable']);
    }
  });

  test('isolated demo renders fiction without touching the paid endpoint', () => {
    const fixture = documentFixture(), fetcher = jest.fn();
    const controller = demand.create({ mode: 'demo', document: fixture.document,
      idempotency: () => 'unused', fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({ kind: 'available', fictional: true });
    expect(fixture.values.commandCenterBacklogActions.hidden).toBe(true);
    expect(fixture.values.commandCenterBacklogNotice.textContent).toMatch(/Fictional isolated demo/);
    const value = demand.demoSnapshot();
    for (const flag of ['sourceCoverageComplete', 'offPlatformCoverageVerified',
      'providerCoverageVerified', 'probabilityCalibrated', 'forecastIssued',
      'paidNumericServing']) expect(value[flag]).toBe(false);
  });

  test('isolated demo restores its frozen fiction after workspace refresh without a paid request', async () => {
    const fixture = documentFixture(), fetcher = jest.fn();
    const retryWorkspace = jest.fn(async () => null);
    const controller = demand.create({ mode: 'demo', document: fixture.document,
      idempotency: () => 'unused', fetcher, onWorkspaceRetry: retryWorkspace });
    controller.workspaceUnavailable();
    expect(controller.state()).toMatchObject({ kind: 'workspace', metrics: [] });
    await controller.retry();
    expect(retryWorkspace).toHaveBeenCalledTimes(1);
    controller.workspaceReady();
    expect(controller.state()).toMatchObject({ kind: 'available', fictional: true });
    expect(fixture.values.commandCenterBacklogActions.hidden).toBe(true);
    expect(fixture.values.commandCenterBacklogNotice.textContent)
      .toMatch(/Fictional isolated demo/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('shows unauthorized, oversized, workspace failure and explicit recovery states', async () => {
    const fixture = documentFixture(), outcomes = [
      response(403, null, { category: 'FORECAST_CURRENT_BACKLOG_RESTRICTED' }),
      response(503, null, { category: 'FORECAST_CURRENT_BACKLOG_OVERSIZED' }),
    ];
    const retryWorkspace = jest.fn(async () => null);
    const controller = demand.create({ mode: 'paid', document: fixture.document,
      idempotency: () => 'part4d-capture-key-0002', onWorkspaceRetry: retryWorkspace,
      fetcher: async () => outcomes.shift() });
    await controller.capture();
    expect(controller.state().kind).toBe('restricted');
    await controller.capture();
    expect(controller.state().kind).toBe('oversized');
    expect(controller.state().explanation).toMatch(/review or response-size limit/);
    expect(controller.state().explanation).not.toMatch(/500/);
    controller.workspaceUnavailable();
    expect(controller.state().kind).toBe('workspace');
    expect(fixture.values.commandCenterBacklogCapture.disabled).toBe(true);
    await controller.retry();
    expect(retryWorkspace).toHaveBeenCalledTimes(1);
    controller.workspaceReady();
    expect(controller.state()).toMatchObject({ kind: 'failure',
      badge: 'Receipt result unconfirmed' });
    expect(fixture.values.commandCenterBacklogCapture.disabled).toBe(false);
  });

  test('retries an unconfirmed capture with the same request identity and masks unavailable detail', async () => {
    const fixture = documentFixture(), calls = [];
    const controller = demand.create({ mode: 'paid', document: fixture.document,
      idempotency: () => 'part4d-stable-retry-key', fetcher: async (_url, options) => {
        calls.push(options.headers['Idempotency-Key']);
        if (calls.length === 1) throw new Error('local connection failed');
        return response(503, null, { category: 'FORECAST_CURRENT_BACKLOG_UNAVAILABLE',
          message: 'Private tenant source detail' });
      } });
    await controller.capture();
    expect(controller.state().kind).toBe('failure');
    await controller.retry();
    expect(calls).toEqual(['part4d-stable-retry-key', 'part4d-stable-retry-key']);
    expect(JSON.stringify(controller.state())).not.toContain('tenant');
    expect(controller.state().metrics).toEqual([]);
  });

  test('an exact receipt read abandons an uncertain capture key before the next capture', async () => {
    const fixture = documentFixture(), calls = [], keys = ['part4d-abandoned-key', 'part4d-new-key'];
    const controller = demand.create({ mode: 'paid', document: fixture.document,
      idempotency: () => keys.shift(), fetcher: async (url, options) => {
        calls.push({ url, key: options.headers['Idempotency-Key'] || null });
        if (calls.length === 1) throw new Error('capture response lost');
        return response(options.method === 'POST' ? 201 : 200,
          options.method === 'POST' ? { ...snapshot(), replayed: false } : snapshot());
      } });
    await controller.capture();
    fixture.values.commandCenterBacklogReceipt.value = ID;
    await controller.read();
    await controller.capture();
    expect(calls).toEqual([
      { url: '/api/v1/forecast/current-backlog/snapshots', key: 'part4d-abandoned-key' },
      { url: `/api/v1/forecast/current-backlog/snapshots/${ID}`, key: null },
      { url: '/api/v1/forecast/current-backlog/snapshots', key: 'part4d-new-key' },
    ]);
  });

  test('a late superseded capture completion cannot restore an abandoned capture key', async () => {
    const fixture = documentFixture(), calls = [], keys = ['part4d-late-key', 'part4d-after-read-key'];
    let resolveCapture;
    const lateCapture = new Promise(resolve => { resolveCapture = resolve; });
    const controller = demand.create({ mode: 'paid', document: fixture.document,
      idempotency: () => keys.shift(), fetcher: async (url, options) => {
        calls.push({ url, key: options.headers['Idempotency-Key'] || null });
        if (calls.length === 1) return lateCapture;
        return response(options.method === 'POST' ? 201 : 200,
          options.method === 'POST' ? { ...snapshot(), replayed: false } : snapshot());
      } });
    const pending = controller.capture();
    fixture.values.commandCenterBacklogReceipt.value = ID;
    await controller.read();
    resolveCapture(response(201, { ...snapshot(), replayed: false }));
    await pending;
    await controller.capture();
    expect(calls.map(call => call.key)).toEqual([
      'part4d-late-key', null, 'part4d-after-read-key',
    ]);
    expect(controller.state().kind).toBe('available');
  });

  test.each(['capture', 'read'])(
    'withholds an in-flight %s completion after workspace failure and retries only after recovery',
    async kind => {
      const fixture = documentFixture(), calls = [];
      let resolveFirst;
      const first = new Promise(resolve => { resolveFirst = resolve; });
      const controller = demand.create({ mode: 'paid', document: fixture.document,
        idempotency: () => 'part4d-inflight-stable-key',
        fetcher: async (url, options) => {
          calls.push({ url, key: options.headers['Idempotency-Key'] || null });
          if (calls.length === 1) return first;
          return response(kind === 'capture' ? 201 : 200,
            kind === 'capture' ? { ...snapshot(), replayed: true } : snapshot());
        } });
      fixture.values.commandCenterBacklogReceipt.value = ID;
      const pending = kind === 'capture' ? controller.capture() : controller.read();
      controller.workspaceUnavailable();
      expect(controller.state().kind).toBe('workspace');
      expect(controller.state().metrics).toEqual([]);
      resolveFirst(response(kind === 'capture' ? 201 : 200,
        kind === 'capture' ? { ...snapshot(), replayed: false } : snapshot()));
      await pending;
      expect(controller.state().kind).toBe('workspace');
      expect(fixture.values.commandCenterBacklogMetrics.children).toEqual([]);
      controller.workspaceReady();
      expect(controller.state()).toMatchObject({ kind: 'failure',
        badge: 'Receipt result unconfirmed' });
      await controller.retry();
      expect(controller.state().kind).toBe('available');
      expect(calls).toHaveLength(2);
      if (kind === 'capture') expect(calls.map(call => call.key))
        .toEqual(['part4d-inflight-stable-key', 'part4d-inflight-stable-key']);
      else expect(calls.map(call => call.url)).toEqual([
        `/api/v1/forecast/current-backlog/snapshots/${ID}`,
        `/api/v1/forecast/current-backlog/snapshots/${ID}`,
      ]);
    }
  );

  test('fails closed on poisoned forecast or coverage authority', () => {
    for (const poison of [
      { sourceCoverageComplete: true }, { providerCoverageVerified: true },
      { probabilityCalibrated: true }, { forecastIssued: true },
      { paidNumericServing: true }, { knownBacklogCount: 5 },
      { sourceAuthority: 'lead_pipeline' },
      { state: 'partial', reason: 'unresolved_linkage_present',
        unresolvedLinkageCount: 1 },
      { state: 'partial', reason: 'unresolved_linkage_present',
        unresolvedLinkageCount: 1, plannedPersonMinutes: null,
        backlogHoursState: 'unavailable',
        backlogHoursReason: 'reviewed_person_hour_plan_missing' },
      { unresolvedLinkageCount: 1 },
      { approvedUnscheduledCount: 0, approvedScheduledCount: 0,
        workInProgressCount: 0, completedCount: 0, knownBacklogCount: 0,
        plannedPersonMinutes: null, backlogHoursState: 'unavailable',
        backlogHoursReason: 'no_active_backlog' },
      { plannedPersonMinutes: null, backlogHoursState: 'unavailable',
        backlogHoursReason: 'source_changed_after_capture' },
    ]) expect(demand.project(snapshot(poison), false)).toBeNull();
    const html = fs.readFileSync('public/demo-dashboard.html', 'utf8');
    expect(html).toContain('Capture current backlog');
    expect(html).toContain('Demand forecast');
    expect(html).toContain('command-center-demand-position.js');
  });

  test('withholds all numeric UI output for conflicting partial or descriptive receipt shapes', async () => {
    const poisons = [
      { state: 'partial', reason: 'unresolved_linkage_present',
        unresolvedLinkageCount: 1 },
      { state: 'partial', reason: 'unresolved_linkage_present',
        unresolvedLinkageCount: 1, plannedPersonMinutes: null,
        backlogHoursState: 'unavailable',
        backlogHoursReason: 'reviewed_person_hour_plan_missing' },
      { unresolvedLinkageCount: 1 },
      { approvedUnscheduledCount: 0, approvedScheduledCount: 0,
        workInProgressCount: 0, completedCount: 0, knownBacklogCount: 0,
        plannedPersonMinutes: null, backlogHoursState: 'unavailable',
        backlogHoursReason: 'no_active_backlog' },
      { plannedPersonMinutes: null, backlogHoursState: 'unavailable',
        backlogHoursReason: 'source_changed_after_capture' },
    ];
    for (const poison of poisons) {
      const fixture = documentFixture();
      const controller = demand.create({ mode: 'paid', document: fixture.document,
        idempotency: () => 'part4d-partial-poison-key',
        fetcher: async () => response(201, snapshot(poison)) });
      await controller.capture();
      expect(controller.state()).toMatchObject({ kind: 'failure', metrics: [] });
      expect(fixture.values.commandCenterBacklogMetrics.children).toEqual([]);
      expect(JSON.stringify(controller.state())).not.toMatch(/780|13 person-hours/);
    }
  });

  test('enforces the same bounded snapshot-state and planned-time reason matrix in route and UI', () => {
    const zero = { approvedUnscheduledCount: 0, approvedScheduledCount: 0,
      workInProgressCount: 0, completedCount: 0, unresolvedLinkageCount: 0,
      knownBacklogCount: 0, plannedPersonMinutes: null,
      backlogHoursState: 'unavailable' };
    const cases = [
      ['descriptive available', snapshot(), true],
      ['descriptive reviewed plan missing', snapshot({ plannedPersonMinutes: null,
        backlogHoursState: 'unavailable',
        backlogHoursReason: 'reviewed_person_hour_plan_missing' }), true],
      ['descriptive completed-only', snapshot({ approvedUnscheduledCount: 0,
        approvedScheduledCount: 0, workInProgressCount: 0, completedCount: 1,
        knownBacklogCount: 0, plannedPersonMinutes: null,
        backlogHoursState: 'unavailable', backlogHoursReason: 'no_active_backlog' }), true],
      ['descriptive source-changed reason', snapshot({ plannedPersonMinutes: null,
        backlogHoursState: 'unavailable',
        backlogHoursReason: 'source_changed_after_capture' }), false],
      ['descriptive unresolved reason', snapshot({ plannedPersonMinutes: null,
        backlogHoursState: 'unavailable',
        backlogHoursReason: 'unresolved_linkage_present' }), false],
      ['partial unresolved', snapshot({ state: 'partial',
        reason: 'unresolved_linkage_present', unresolvedLinkageCount: 1,
        plannedPersonMinutes: null, backlogHoursState: 'unavailable',
        backlogHoursReason: 'unresolved_linkage_present' }), true],
      ['unavailable current', snapshot({ ...zero, state: 'unavailable',
        reason: 'no_authenticated_approved_booking_history',
        backlogHoursReason: 'no_active_backlog' }), true],
      ['unavailable legacy', snapshot({ ...zero, state: 'unavailable',
        reason: 'no_authenticated_approved_booking_history',
        backlogHoursReason: 'approved_person_hour_plan_missing' }), true],
      ['unavailable wrong reason', snapshot({ ...zero, state: 'unavailable',
        reason: 'no_authenticated_approved_booking_history',
        backlogHoursReason: 'reviewed_person_hour_plan_missing' }), false],
      ['source stale', snapshot({ ...zero, state: 'source_stale',
        reason: 'source_changed_after_capture',
        backlogHoursReason: 'source_changed_after_capture', sourceAuthenticated: false,
        sourceDigest: null, snapshotDigest: null }), true],
      ['source stale with numeric plan', snapshot({ ...zero, state: 'source_stale',
        reason: 'source_changed_after_capture', plannedPersonMinutes: '780.000000',
        backlogHoursState: 'available', backlogHoursReason: null,
        sourceAuthenticated: false, sourceDigest: null, snapshotDigest: null }), false],
    ];
    for (const [_label, value, accepted] of cases) {
      expect(Boolean(safeSnapshot(value, ID))).toBe(accepted);
      expect(demand.validSnapshot(value)).toBe(accepted);
      if (!accepted) expect(demand.project(value, false)).toBeNull();
    }
  });

  test('starts paid receipt controls unavailable and issues no request without workspace dependencies', async () => {
    const fixture = documentFixture(), fetcher = jest.fn();
    const controller = demand.create({ mode: 'paid', document: fixture.document,
      workspaceAvailable: false, idempotency: () => 'unused', fetcher });
    expect(controller.state()).toMatchObject({ kind: 'workspace', metrics: [] });
    expect(fixture.values.commandCenterBacklogCapture.disabled).toBe(true);
    expect(fixture.values.commandCenterBacklogRead.disabled).toBe(true);
    fixture.values.commandCenterBacklogReceipt.value = ID;
    await controller.capture();
    await controller.read();
    expect(fetcher).not.toHaveBeenCalled();
    const page = fs.readFileSync('public/js/command-center-page.js', 'utf8');
    expect(page).toContain('workspaceAvailable: workspaceDependenciesReady');
    expect(page).toContain('if (!workspaceDependenciesReady ||');
    expect(page).toContain("typeof contract.destinationPath === 'function'");
    expect(page).toContain("typeof global.NorthStarAccountSession.fetch === 'function'");
  });
});

describe('Mission 26 Part 4D route refusal projection', () => {
  function appFor(code, role = 'owner') {
    const client = { query: jest.fn(async sql => {
      if (String(sql).startsWith('SELECT public.canonical_forecast_current_backlog')) {
        const error = new Error('private database detail'); error.code = code; throw error;
      }
      return { rows: [] };
    }), release: jest.fn() };
    const pool = { connect: jest.fn(async () => client) };
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: ACTOR }; req.orgId = ID;
      req.userRole = role; req.authSession = { id: SESSION };
      req.tenantContext = { organizationId: ID, userId: ACTOR }; next(); });
    app.use('/backlog', createForecastCurrentBacklogRouter({ poolProvider: () => pool,
      auth: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
      captureThrottle: (_req, _res, next) => next() }));
    return { app, pool };
  }

  test('maps bounded overflow without leaking database detail and denies member capture', async () => {
    const overflow = appFor('54000');
    const result = await request(overflow.app).post('/backlog/snapshots')
      .set('Idempotency-Key', 'part4d-route-key-0001').set('X-CSRF-Token', 'token').send({});
    expect(result.status).toBe(503);
    expect(result.body.error).toEqual({ category: 'FORECAST_CURRENT_BACKLOG_OVERSIZED',
      message: 'Current backlog exceeds a supported review or response-size limit.' });
    expect(JSON.stringify(result.body)).not.toContain('private database detail');

    const member = appFor('unused', 'member');
    const denied = await request(member.app).post('/backlog/snapshots')
      .set('Idempotency-Key', 'part4d-route-key-0002').set('X-CSRF-Token', 'token').send({});
    expect(denied.status).toBe(403);
    expect(member.pool.connect).not.toHaveBeenCalled();
  });
});
