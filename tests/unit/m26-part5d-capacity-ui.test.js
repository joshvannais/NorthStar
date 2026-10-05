'use strict';

const express = require('express');
const request = require('supertest');
const capacity = require('../../public/js/command-center-capacity-research');
const { createForecastCapacityAdvisoryRouter, safeJourney } =
  require('../../src/routes/forecastCapacityAdvisory');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = 'm26-part5d-exact-key-0001';

function response(status, data) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => status >= 200 && status < 300 ? { success: true, data } :
      { success: false, error: status === 403 ? 'Forbidden' : status === 409 ? 'Conflict' : 'Unavailable' } };
}

function application({ value = capacity.demoJourney(5), role = 'owner', databaseError } = {}) {
  const app = express(); app.use(express.json());
  const auth = (req, _res, next) => {
    req.user = { id: USER }; req.orgId = ORG;
    req.tenantContext = { organizationId: ORG, userId: USER };
    req.userRole = role; req.authSession = { id: SESSION }; next();
  };
  const client = { query: jest.fn(async sql => {
    if (databaseError && sql.startsWith('SELECT public.')) throw databaseError;
    return sql.startsWith('SELECT public.') ? { rows: [{ value }] } : { rows: [] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  const pass = (_req, _res, next) => next();
  app.use('/api/v1/forecast/capacity-advice', createForecastCapacityAdvisoryRouter({
    auth, throttle: pass, writeThrottle: pass, poolProvider: () => pool,
  }));
  return { app, client, pool };
}

class Element {
  constructor(dataset = {}) {
    this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false;
    this.children = []; this.listeners = {}; this.dataset = dataset; this.className = '';
  }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  replaceChildren(...items) { this.children = items; }
  append(...items) { this.children.push(...items); }
  click() { return this.listeners.click && this.listeners.click({ preventDefault() {} }); }
}

function fixture() {
  const ids = ['commandCenterCapacityState', 'commandCenterCapacityAsOf', 'commandCenterCapacityNotice',
    'commandCenterCapacityPaidControls', 'commandCenterCapacityDemoControls', 'commandCenterCapacityReason',
    'commandCenterCapacityRefresh', 'commandCenterCapacityRetry', 'commandCenterCapacityWorkloadState',
    'commandCenterCapacityConstraintState', 'commandCenterCapacityAdvisoryState', 'commandCenterCapacityTargets',
    'commandCenterCapacityDimensions', 'commandCenterCapacityAlternatives', 'commandCenterCapacityCategories',
    'commandCenterCapacityContinuation', 'commandCenterCapacityHistory'];
  const values = Object.fromEntries(ids.map(id => [id, new Element()]));
  const lanes = ['workload', 'constrained', 'advisory'].map(name => new Element({ capacityLane: name }));
  const decisions = ['approve', 'reject', 'withdraw'].map(name => new Element({ capacityDecision: name }));
  const demo = ['advance', 'stale', 'recover', 'reset'].map(name => new Element({ capacityDemoAction: name }));
  const selectors = { '[data-capacity-lane]': lanes, '[data-capacity-decision]': decisions,
    '[data-capacity-demo-action]': demo };
  return { values, lanes, decisions, demo, document: {
    getElementById: id => values[id] || null,
    createElement: () => new Element(),
    querySelectorAll: selector => selectors[selector] || [],
  } };
}

describe('Mission 26 Part 5D capacity research journey', () => {
  test('accepts every deterministic lifecycle state and refuses private, numeric and unknown poison', () => {
    for (let stage = 0; stage <= 5; stage += 1) {
      const value = capacity.demoJourney(stage);
      expect(capacity.validateJourney(value)).toEqual(value);
      expect(safeJourney(value)).toEqual(value);
    }
    const base = capacity.demoJourney(5);
    expect(capacity.validateJourney({ ...base, privateResults: [] })).toBeNull();
    expect(safeJourney({ ...base, demandMinutes: 1 })).toBeNull();
    expect(capacity.validateJourney({ ...base, boundaries: { ...base.boundaries,
      digest: 'a'.repeat(64) } })).toBeNull();
    expect(safeJourney({ ...base, constrained: { ...base.constrained,
      scopes: [{ ...base.constrained.scopes[0], dimensions: {
        ...base.constrained.scopes[0].dimensions, workerId: USER } }] } })).toBeNull();
    const wrongOrigin = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const brokenRelationship = { ...base, advisory: { ...base.advisory,
      selectedOutcome: { ...base.advisory.selectedOutcome, originId: wrongOrigin } } };
    expect(capacity.validateJourney(brokenRelationship)).toBeNull();
    expect(safeJourney(brokenRelationship)).toBeNull();
    const brokenAction = { ...base, workload: { ...base.workload,
      currentAction: { ...base.workload.currentAction, name: 'capture_evaluation' } } };
    expect(capacity.validateJourney(brokenAction)).toBeNull();
    expect(safeJourney(brokenAction)).toBeNull();
    const missed = capacity.demoJourney(4); const completed = capacity.demoJourney(5);
    expect(missed.advisory.selectedContinuation.state).toBe('capacity_advisory_continuation_missed');
    expect(completed.advisory.selectedContinuation.state).toBe('capacity_advisory_continuation_activated');
    expect(completed.advisory.selectedContinuation.id).not.toBe(missed.advisory.selectedContinuation.id);
    expect(completed.advisory.history.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: missed.advisory.selectedContinuation.id,
        state: 'capacity_advisory_continuation_missed' }),
    ]));
  });

  test('serves one no-store owner/admin projection and keeps failures generic', async () => {
    for (const role of ['owner', 'admin']) {
      const { app, client } = application({ role });
      const result = await request(app).get('/api/v1/forecast/capacity-advice/journey/current');
      expect(result.status).toBe(200); expect(result.body.data.state).toBe('capacity_research_journey_current');
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.headers['referrer-policy']).toBe('no-referrer');
      expect(client.query.mock.calls.find(([sql]) => sql.includes('capacity_ui_v1_current'))[1])
        .toEqual([ORG, USER, role, SESSION]);
    }
    expect((await request(application({ databaseError: { code: '42501', detail: 'tenant secret' } }).app)
      .get('/api/v1/forecast/capacity-advice/journey/current')).body).toEqual({ success: false, error: 'Forbidden' });
    const unavailable = await request(application({ databaseError: { code: 'XX000', detail: 'private 9876' } }).app)
      .get('/api/v1/forecast/capacity-advice/journey/current');
    expect(unavailable.status).toBe(503); expect(JSON.stringify(unavailable.body)).not.toContain('9876');
  });

  test('binds exact safe action and digest-hidden decision schemas', async () => {
    const actionValue = { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
      receiptId: USER, originId: USER, outcomeId: null, continuationId: null, revision: null,
      researchOnly: true, automaticActionTaken: false, replayed: false };
    const actionApp = application({ value: actionValue });
    const body = { action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, reason: 'Save the exact accepted workload research position.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-action-v1' };
    const saved = await request(actionApp.app).post('/api/v1/forecast/capacity-advice/journey/actions')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(body);
    expect(saved.status).toBe(201); expect(JSON.stringify(saved.body)).not.toContain('digest');
    expect(actionApp.client.query.mock.calls.find(([sql]) => sql.includes('capacity_ui_v1_action_mutate'))[1])
      .toEqual([ORG, USER, 'owner', SESSION, 'csrf', KEY, body.action, null, null, null,
        body.reason, body.confirmationVersion]);

    const decisionValue = { state: 'capacity_advisory_decision_recorded', id: USER, originId: ORG,
      action: 'approve', revision: 2, researchOnly: true, automaticActionTaken: false, replayed: true };
    const decisionApp = application({ value: decisionValue });
    const decisionBody = { action: 'approve', expectedDecisionId: SESSION, expectedDecisionRevision: 1,
      reason: 'Approve this exact qualitative advisory for human review.', confirmed: true,
      confirmationVersion: 'm26-capacity-ui-decision-v1' };
    const decision = await request(decisionApp.app)
      .post(`/api/v1/forecast/capacity-advice/origins/${ORG}/safe-decisions`)
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(decisionBody);
    expect(decision.status).toBe(200); expect(decision.headers['idempotency-replayed']).toBe('true');
    expect(JSON.stringify(decision.body)).not.toContain('digest');
  });

  test('rejects unknown, extra, private and downstream action inputs before database use', async () => {
    const attempts = [
      { action: 'workload_capture_origin', originId: null, outcomeId: null, correctionOriginId: null,
        reason: 'Save the exact workload research position.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-action-v1', createSchedule: true },
      { action: 'workload_capture_origin', originId: null, outcomeId: null, correctionOriginId: null,
        reason: 'Save the exact workload research position.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-action-v1', privateManifest: {} },
      { action: 'workload_capture_origin', originId: null, outcomeId: null, correctionOriginId: null,
        reason: 'Save the exact workload research position.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-action-v1', demandMinutes: 0 },
      { action: 'advisory_capture_evaluation', originId: ORG, outcomeId: null, correctionOriginId: null,
        reason: null, confirmed: true, confirmationVersion: 'm26-capacity-ui-action-v1' },
    ];
    for (const body of attempts) {
      const { app, pool } = application();
      expect((await request(app).post('/api/v1/forecast/capacity-advice/journey/actions')
        .set('Idempotency-Key', KEY).send(body)).status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    }
    const queryApp = application();
    expect((await request(queryApp.app).get('/api/v1/forecast/capacity-advice/journey/current?private=true')).status)
      .toBe(400);
    expect(queryApp.pool.connect).not.toHaveBeenCalled();
    const decisionApp = application();
    expect((await request(decisionApp.app)
      .post(`/api/v1/forecast/capacity-advice/origins/${ORG}/safe-decisions`)
      .set('Idempotency-Key', KEY).send({ action: 'approve', expectedDecisionId: null,
        expectedDecisionRevision: 0, reason: 'Approve this exact qualitative advisory for human review.',
        confirmed: true, confirmationVersion: 'm26-capacity-ui-decision-v1', expectedDigest: 'none' })).status)
      .toBe(400);
    expect(decisionApp.pool.connect).not.toHaveBeenCalled();
  });

  test('paid load is GET-only, writes exact safe bodies, and refreshes after success', async () => {
    const ui = fixture(); const calls = []; let reads = 0;
    const controller = capacity.create({ mode: 'paid', document: ui.document,
      idempotency: () => KEY, fetcher: async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'GET') { reads += 1; return response(200, capacity.demoJourney(reads > 1 ? 1 : 0)); }
        return response(201, { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
          receiptId: USER, originId: USER, outcomeId: null, continuationId: null, revision: null,
          researchOnly: true, automaticActionTaken: false, replayed: false });
      } });
    expect(calls).toEqual([]);
    await controller.workspaceReady('paid:tenant:revision:digest:session:generation:expiry');
    expect(calls.map(item => item.options.method)).toEqual(['GET']);
    ui.values.commandCenterCapacityReason.value = 'Save this exact workload research origin.';
    ui.values.commandCenterCapacityReason.listeners.input();
    await ui.lanes[0].click();
    expect(calls.map(item => item.options.method)).toEqual(['GET', 'POST', 'GET']);
    const sent = JSON.parse(calls[1].options.body);
    expect(sent).toEqual({ action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, reason: 'Save this exact workload research origin.', confirmed: true,
      confirmationVersion: 'm26-capacity-ui-action-v1' });
    expect(calls[1].options.headers['Idempotency-Key']).toBe(KEY);
    expect(JSON.stringify(sent)).not.toMatch(/digest|minutes|count/i);
  });

  test('uncertain retry reuses exact endpoint, body and key; identity change discards late completion', async () => {
    const ui = fixture(); const calls = []; let postCount = 0;
    const controller = capacity.create({ mode: 'paid', document: ui.document,
      idempotency: () => KEY, fetcher: async (url, options) => {
        calls.push({ url, method: options.method, body: options.body, key: options.headers['Idempotency-Key'] });
        if (options.method === 'GET') return response(200, capacity.demoJourney(postCount ? 1 : 0));
        postCount += 1;
        if (postCount === 1) return response(503);
        return response(200, { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
          receiptId: USER, originId: USER, outcomeId: null, continuationId: null, revision: null,
          researchOnly: true, automaticActionTaken: false, replayed: true });
      } });
    await controller.workspaceReady('identity-one');
    ui.values.commandCenterCapacityReason.value = 'Save this exact workload research origin.';
    ui.values.commandCenterCapacityReason.listeners.input(); await ui.lanes[0].click();
    expect(ui.values.commandCenterCapacityState.dataset.state).toBe('uncertain');
    await ui.values.commandCenterCapacityRetry.click();
    const posts = calls.filter(item => item.method === 'POST');
    expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);

    const lateUi = fixture(); let resolveOld; const old = new Promise(resolve => { resolveOld = resolve; });
    const late = capacity.create({ mode: 'paid', document: lateUi.document, idempotency: () => KEY,
      fetcher: async (_url, _options) => old });
    const first = late.workspaceReady('old-identity');
    late.workspaceUnavailable();
    resolveOld(response(200, capacity.demoJourney(5))); await first;
    expect(late.inspect().journey).toBeNull(); expect(late.inspect().identity).toBeNull();
  });

  test('demo lifecycle is deterministic, isolated, resettable and performs zero paid API calls', async () => {
    const ui = fixture(); const calls = [];
    const controller = capacity.create({ mode: 'demo', document: ui.document,
      idempotency: () => KEY, fetcher: async (...args) => { calls.push(args); throw new Error('paid API called'); } });
    await controller.workspaceReady('demo:tenant-one:session-one:generation-one:expiry-one');
    expect(calls).toEqual([]); expect(controller.inspect().demoStage).toBe(0);
    await ui.demo[0].click(); await ui.demo[0].click(); expect(controller.inspect().demoStage).toBe(2);
    await ui.demo[1].click(); expect(controller.inspect().journey.advisory.selectedOrigin.state).toContain('_stale');
    await ui.demo[2].click(); expect(ui.values.commandCenterCapacityState.textContent).toBe('Recovered · current');
    await ui.demo[3].click(); expect(controller.inspect().demoStage).toBe(0);
    await controller.workspaceReady('demo:tenant-two:session-two:generation-two:expiry-two');
    expect(controller.inspect().demoStage).toBe(0); expect(calls).toEqual([]);
  });
});
