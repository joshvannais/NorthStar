'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const capacity = require('../../public/js/command-center-capacity-research');
const { createForecastCapacityAdvisoryRouter, safeJourney, safeActionResult, safeSetupResult,
  safeDecisionResult, safeScopeReviewChoices } =
  require('../../src/routes/forecastCapacityAdvisory');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = 'm26-part5d-exact-key-0001';
const SCOPE_CHOICE = { scopeKey: 'accepted_crew_1234567890abcdef', targetRole: 'technician',
  operatorRoles: ['technician'] };

function response(status, data) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => status >= 200 && status < 300 ? { success: true, data } :
      { success: false, error: status === 403 ? 'Forbidden' : status === 409 ? 'Conflict' : 'Unavailable' } };
}

function captureJourney() {
  const value = JSON.parse(JSON.stringify(capacity.demoJourney(0)));
  value.setup = { state: 'complete', action: null, token: null, lane: null,
    label: 'Prerequisites current', explanation: 'Accepted source prerequisites are current.',
    reasonLimit: null, hiringConsecutivePeriods: 3, scopeReviews: [] };
  for (const lane of ['workload', 'constrained', 'advisory']) value[lane].currentAction.name = 'capture_origin';
  return value;
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
    'commandCenterCapacityPaidControls', 'commandCenterCapacityDemoControls', 'commandCenterCapacityLaneReason',
    'commandCenterCapacityReviewReason', 'commandCenterCapacityHiringPeriods', 'commandCenterCapacitySetupAction',
    'commandCenterCapacityPolicyAction', 'commandCenterCapacityCorrectionAction',
    'commandCenterCapacitySetupTitle', 'commandCenterCapacitySetupExplanation',
    'commandCenterCapacityHiringState', 'commandCenterCapacityCorrectionState', 'commandCenterCapacityScopeReviews',
    'commandCenterCapacityRefresh', 'commandCenterCapacityRetry', 'commandCenterCapacityWorkloadState',
    'commandCenterCapacityConstraintState', 'commandCenterCapacityAdvisoryState', 'commandCenterCapacityTargets',
    'commandCenterCapacityDimensions', 'commandCenterCapacityAlternatives', 'commandCenterCapacityCategories',
    'commandCenterCapacityContinuation', 'commandCenterCapacityHistory'];
  const values = Object.fromEntries(ids.map(id => [id, new Element()]));
  values.commandCenterCapacityHiringPeriods.value = '3';
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

  test('server and shared client bind every action response to exact predecessors, relationships and revisions', () => {
    const RECEIPT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const CORRECTION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const OTHER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const SETUP_ACTIONS = ['workload_epoch', 'workload_methods', 'workload_roles', 'workload_role_scope',
      'workload_availability', 'workload_remaining_census', 'workload_outcome_window',
      'constrained_epoch', 'constrained_method', 'constrained_scope', 'constrained_work_scopes',
      'constrained_job_census', 'advisory_method', 'advisory_policy', 'advisory_demand', 'advisory_epoch',
      'advisory_outcome_demand', 'advisory_continuation_demand', 'advisory_correction_demand',
      'advisory_policy_revision'];
    for (const action of SETUP_ACTIONS) {
      const body = { action, token: 'a'.repeat(64), hiringConsecutivePeriods: 7,
        scopeReviews: action === 'constrained_work_scopes' ? [SCOPE_CHOICE] : [],
        reason: 'Explicitly review the exact source-backed prerequisite.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-setup-v2' };
      const value = { state: 'capacity_research_setup_recorded', action, token: body.token,
        receiptId: RECEIPT, revision: 2, hiringConsecutivePeriods: 7,
        researchOnly: true, automaticActionTaken: false, replayed: false };
      expect(safeSetupResult(value, body)).toEqual(value);
      expect(capacity.validateSetupResponse(value, body)).toBe(true);
      const reject = candidate => {
        expect(safeSetupResult(candidate, body)).toBeNull();
        expect(capacity.validateSetupResponse(candidate, body)).toBe(false);
      };
      for (const key of Object.keys(value)) { const missing = { ...value }; delete missing[key]; reject(missing); }
      reject({ ...value, extraId: OTHER });
      reject({ ...value, action: action === 'workload_epoch' ? 'workload_methods' : 'workload_epoch' });
      reject({ ...value, token: 'b'.repeat(64) }); reject({ ...value, receiptId: null });
      reject({ ...value, revision: null }); reject({ ...value, hiringConsecutivePeriods: 8 });
      expect(safeSetupResult(value, { ...body, token: 'b'.repeat(64) })).toBeNull();
      expect(capacity.validateSetupResponse(value, { ...body, hiringConsecutivePeriods: 8 })).toBe(false);
    }
    const baseBody = { originId: null, outcomeId: null, correctionOriginId: null,
      expectedRevision: null, reason: null, confirmed: true,
      confirmationVersion: 'm26-capacity-ui-action-v1' };
    const baseResult = action => ({ state: 'capacity_research_action_recorded', action,
      receiptId: RECEIPT, originId: null, outcomeId: null, continuationId: null,
      correctionOriginId: null, revision: null, researchOnly: true,
      automaticActionTaken: false, replayed: false });
    const cases = [
      { action: 'workload_capture_origin', body: {}, result: { originId: RECEIPT } },
      { action: 'workload_capture_evaluation', body: { originId: ORG, expectedRevision: 2 },
        result: { originId: ORG, revision: 2 } },
      { action: 'constrained_capture_origin', body: {}, result: { originId: RECEIPT } },
      { action: 'constrained_capture_outcome', body: { originId: ORG, expectedRevision: 3 },
        result: { originId: ORG, outcomeId: RECEIPT, revision: 3 } },
      { action: 'constrained_capture_evaluation', body: { originId: ORG, outcomeId: USER, expectedRevision: 4 },
        result: { originId: ORG, outcomeId: USER, revision: 4 } },
      { action: 'advisory_capture_origin', body: { correctionOriginId: CORRECTION },
        result: { originId: RECEIPT, correctionOriginId: CORRECTION } },
      { action: 'advisory_reserve_continuation', body: { originId: ORG },
        result: { originId: ORG, continuationId: RECEIPT } },
      { action: 'advisory_prepare_outcome', body: { originId: ORG },
        result: { receiptId: null, originId: ORG } },
      { action: 'advisory_capture_outcome', body: { originId: ORG, expectedRevision: 5 },
        result: { originId: ORG, outcomeId: RECEIPT, revision: 5 } },
      { action: 'advisory_capture_evaluation', body: { originId: ORG, outcomeId: USER, expectedRevision: 6 },
        result: { originId: ORG, outcomeId: USER, revision: 6 } },
    ].map(item => ({ action: item.action, body: { ...baseBody, action: item.action, ...item.body },
      result: { ...baseResult(item.action), ...item.result } }));
    const accepts = (value, body) => {
      expect(safeActionResult(value, body)).toEqual(value);
      expect(capacity.validateActionResponse(value, body)).toBe(true);
    };
    const rejects = (value, body) => {
      expect(safeActionResult(value, body)).toBeNull();
      expect(capacity.validateActionResponse(value, body)).toBe(false);
    };
    for (const item of cases) {
      accepts(item.result, item.body);
      for (const key of Object.keys(item.result)) {
        const missing = { ...item.result }; delete missing[key]; rejects(missing, item.body);
      }
      rejects({ ...item.result, unexpectedId: OTHER }, item.body);
      rejects({ ...item.result, action: item.action === 'workload_capture_origin'
        ? 'constrained_capture_origin' : 'workload_capture_origin' }, item.body);
      rejects({ ...item.result, receiptId: item.result.receiptId === null ? OTHER : null }, item.body);
      for (const key of ['originId', 'outcomeId', 'continuationId', 'correctionOriginId']) {
        const expected = item.result[key];
        rejects({ ...item.result, [key]: expected === null ? OTHER : null }, item.body);
        if (expected !== null) rejects({ ...item.result, [key]: OTHER }, item.body);
      }
      rejects({ ...item.result, revision: item.result.revision === null ? 1 : item.result.revision + 1 }, item.body);
      if (item.body.originId) rejects(item.result, { ...item.body, originId: OTHER });
      if (item.body.outcomeId) rejects(item.result, { ...item.body, outcomeId: OTHER });
      if (item.body.correctionOriginId) rejects(item.result, { ...item.body, correctionOriginId: OTHER });
      if (item.body.expectedRevision !== null)
        rejects(item.result, { ...item.body, expectedRevision: item.body.expectedRevision + 1 });
      if (item.body.originId && item.result.receiptId !== null)
        rejects({ ...item.result, receiptId: item.body.originId }, item.body);
      if (item.body.outcomeId && item.result.receiptId !== null)
        rejects({ ...item.result, receiptId: item.body.outcomeId }, item.body);
      if (item.body.correctionOriginId)
        rejects({ ...item.result, receiptId: item.body.correctionOriginId,
          originId: item.body.correctionOriginId }, item.body);
    }

    for (const action of ['approve', 'reject', 'withdraw']) {
      const body = { action, expectedDecisionId: action === 'approve' ? null : SESSION,
        expectedDecisionRevision: action === 'approve' ? 0 : 1,
        reason: 'Record this exact explicit human review decision.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-decision-v1' };
      const value = { state: 'capacity_advisory_decision_recorded', id: RECEIPT, originId: ORG,
        action, revision: body.expectedDecisionRevision + 1, researchOnly: true,
        automaticActionTaken: false, replayed: false, previousDecisionId: body.expectedDecisionId,
        previousDecisionRevision: body.expectedDecisionRevision };
      const accept = candidate => {
        expect(safeDecisionResult(candidate, body, ORG)).toEqual(candidate);
        expect(capacity.validateDecisionResponse(candidate, body, ORG)).toBe(true);
      };
      const reject = candidate => {
        expect(safeDecisionResult(candidate, body, ORG)).toBeNull();
        expect(capacity.validateDecisionResponse(candidate, body, ORG)).toBe(false);
      };
      accept(value);
      for (const key of Object.keys(value)) { const missing = { ...value }; delete missing[key]; reject(missing); }
      reject({ ...value, extraId: OTHER }); reject({ ...value, originId: OTHER });
      reject({ ...value, id: ORG });
      reject({ ...value, action: action === 'approve' ? 'reject' : 'approve' });
      reject({ ...value, revision: value.revision + 1 });
      reject({ ...value, previousDecisionId: body.expectedDecisionId === null ? OTHER : null });
      reject({ ...value, previousDecisionRevision: body.expectedDecisionRevision + 1 });
      if (body.expectedDecisionId) reject({ ...value, id: body.expectedDecisionId });
      expect(safeDecisionResult(value, { ...body, expectedDecisionId: OTHER }, ORG)).toBeNull();
      expect(capacity.validateDecisionResponse(value, { ...body, expectedDecisionId: OTHER }, ORG)).toBe(false);
    }
  });

  test('seven-dimension setup projection and submitted role choices use exact safe-only schemas', async () => {
    const review = { scopeKey: SCOPE_CHOICE.scopeKey, formation: 'crew',
      dimensions: { crew: 'applies', skill: 'applies', workingHours: 'applies', location: 'applies',
        travel: 'applies', vehicle: 'applies', equipment: 'applies' },
      targetRole: 'technician', supportRoles: ['dispatcher'], operatorRoles: ['technician'],
      targetRoleOptions: ['dispatcher', 'technician'], selectableTargetRoles: ['dispatcher'],
      operatorRoleOptions: ['dispatcher', 'technician'],
      sourceState: 'source_backed', reviewState: 'needs_review' };
    const journey = capacity.demoJourney(0);
    journey.setup = { state: 'ready', action: 'constrained_work_scopes', token: 'a'.repeat(64), lane: 'all',
      label: 'Review source-backed work formations', explanation: 'Review all seven dimensions and role classifications.',
      reasonLimit: 1000, hiringConsecutivePeriods: 3, scopeReviews: [review] };
    expect(safeJourney(journey)).toEqual(journey); expect(capacity.validateJourney(journey)).toEqual(journey);
    const rejectProjection = changed => {
      const candidate = structuredClone(journey); candidate.setup.scopeReviews[0] = changed;
      expect(safeJourney(candidate)).toBeNull(); expect(capacity.validateJourney(candidate)).toBeNull();
    };
    for (const key of Object.keys(review)) { const changed = { ...review }; delete changed[key]; rejectProjection(changed); }
    for (const changed of [
      { ...review, assetId: USER }, { ...review, dimensions: { ...review.dimensions, location: 'unavailable' } },
      { ...review, targetRole: 'dispatcher' }, { ...review, supportRoles: [] },
      { ...review, selectableTargetRoles: [] }, { ...review, selectableTargetRoles: ['owner'] },
      { ...review, selectableTargetRoles: ['dispatcher', 'dispatcher'] },
      { ...review, operatorRoles: [] }, { ...review, operatorRoles: ['technician', 'technician'] },
      { ...review, operatorRoleOptions: [] }, { ...review, sourceState: 'caller_claimed' },
    ]) rejectProjection(changed);
    expect(safeScopeReviewChoices([SCOPE_CHOICE])).toBe(true);
    for (const choices of [[], [{ ...SCOPE_CHOICE, assetId: USER }],
      [{ ...SCOPE_CHOICE, operatorRoles: ['technician', 'technician'] }],
      [SCOPE_CHOICE, SCOPE_CHOICE]]) expect(safeScopeReviewChoices(choices)).toBe(choices.length === 0);

    const result = { state: 'capacity_research_setup_recorded', action: 'constrained_work_scopes',
      token: 'a'.repeat(64), receiptId: USER, revision: 1, hiringConsecutivePeriods: 3,
      researchOnly: true, automaticActionTaken: false, replayed: false };
    const body = { action: 'constrained_work_scopes', token: 'a'.repeat(64), hiringConsecutivePeriods: 3,
      scopeReviews: [SCOPE_CHOICE], reason: 'Review the exact safe formation classifications.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2' };
    expect((await request(application({ value: result }).app).post('/api/v1/forecast/capacity-advice/journey/setup')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(body)).status).toBe(201);
    for (const poison of [
      { ...body, scopeReviews: [] }, { ...body, scopeReviews: [{ ...SCOPE_CHOICE, profileId: USER }] },
      { ...body, scopeReviews: [{ ...SCOPE_CHOICE, operatorRoles: ['technician', 'technician'] }] },
      { ...body, workerId: USER },
    ]) {
      const target = application({ value: result });
      expect((await request(target.app).post('/api/v1/forecast/capacity-advice/journey/setup')
        .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(poison)).status).toBe(400);
      expect(target.pool.connect).not.toHaveBeenCalled();
    }
  });

  test('the v4 planner selects the sole accepted crew lead without a lexical role fallback', () => {
    const migration = fs.readFileSync(path.resolve(__dirname,
      '../../migrations/230_canonical_forecast_capacity_ui_v4.sql'), 'utf8');
    expect(migration).toContain("count(*) FILTER(WHERE member.crew_role='lead')");
    expect(migration).toContain('array_agg(profile.operational_role ORDER BY profile.id)');
    expect(migration).not.toMatch(/min\(profile\.operational_role\)[\s\S]*crew_role='lead'/);
  });

  test('the v5 planner preserves every same-role operator for exact non-reuse matching', () => {
    const migration = fs.readFileSync(path.resolve(__dirname,
      '../../migrations/231_canonical_forecast_capacity_ui_v5.sql'), 'utf8');
    const route = fs.readFileSync(path.resolve(__dirname,
      '../../src/routes/forecastCapacityAdvisory.js'), 'utf8');
    expect(migration).toContain('eligible_operator_count');
    expect(migration).toContain('Complete asset operator eligibility exceeds bound');
    expect(migration).toContain('selectable_target_roles');
    expect(migration).toContain("'selectableTargetRoles',selectable_target_roles");
    expect(migration).toContain("WHERE operator_roles ? (assigned->>'role') ORDER BY assigned->>'profileId' LOOP");
    expect(migration).toContain("'operatorProfileId',assigned_value->>'profileId'");
    expect(migration).not.toContain('operator_index%operator_role_count');
    expect(migration).not.toMatch(/WHERE assigned->>'role'=\(operator_roles[\s\S]{0,240}LIMIT 1/);
    expect(route).toContain("SET LOCAL statement_timeout='60000ms'");
  });

  test('lane reasons stop at 900 while explicit review decisions accept 900, 901 and 1000', async () => {
    const actionValue = { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
      receiptId: USER, originId: USER, outcomeId: null, continuationId: null, correctionOriginId: null,
      revision: null, researchOnly: true, automaticActionTaken: false, replayed: false };
    const actionApp = application({ value: actionValue });
    const laneBody = length => ({ action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, expectedRevision: null, reason: 'x'.repeat(length), confirmed: true,
      confirmationVersion: 'm26-capacity-ui-action-v1' });
    expect((await request(actionApp.app).post('/api/v1/forecast/capacity-advice/journey/actions')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', `${KEY}-900`).send(laneBody(900))).status).toBe(201);
    for (const length of [901, 1000]) expect((await request(actionApp.app)
      .post('/api/v1/forecast/capacity-advice/journey/actions').set('X-CSRF-Token', 'csrf')
      .set('Idempotency-Key', `${KEY}-${length}`).send(laneBody(length))).status).toBe(400);

    const decisionValue = { state: 'capacity_advisory_decision_recorded', id: USER, originId: ORG,
      action: 'approve', revision: 1, researchOnly: true, automaticActionTaken: false, replayed: false,
      previousDecisionId: null, previousDecisionRevision: 0 };
    const decisionApp = application({ value: decisionValue });
    const decisionBody = length => ({ action: 'approve', expectedDecisionId: null, expectedDecisionRevision: 0,
      reason: 'x'.repeat(length), confirmed: true, confirmationVersion: 'm26-capacity-ui-decision-v1' });
    for (const length of [900, 901, 1000]) expect((await request(decisionApp.app)
      .post(`/api/v1/forecast/capacity-advice/origins/${ORG}/safe-decisions`)
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', `${KEY}-${length}`).send(decisionBody(length))).status).toBe(201);

    const laneUi = fixture(); const laneController = capacity.create({ mode: 'paid', document: laneUi.document,
      idempotency: () => KEY, fetcher: async () => response(200, captureJourney()) });
    await laneController.workspaceReady('reason-lane');
    for (const [length, disabled] of [[900, false], [901, true], [1000, true]]) {
      laneUi.values.commandCenterCapacityLaneReason.value = 'x'.repeat(length);
      laneUi.values.commandCenterCapacityLaneReason.listeners.input();
      expect(laneUi.lanes[0].disabled).toBe(disabled);
    }
    const reviewUi = fixture(); const reviewController = capacity.create({ mode: 'paid', document: reviewUi.document,
      idempotency: () => KEY, fetcher: async () => response(200, capacity.demoJourney(1)) });
    await reviewController.workspaceReady('reason-review');
    for (const [length, disabled] of [[900, false], [901, false], [1000, false], [1001, true]]) {
      reviewUi.values.commandCenterCapacityReviewReason.value = 'x'.repeat(length);
      reviewUi.values.commandCenterCapacityReviewReason.listeners.input();
      expect(reviewUi.decisions[0].disabled).toBe(disabled);
    }
    const markup = fs.readFileSync(path.resolve(__dirname, '../../public/demo-dashboard.html'), 'utf8');
    expect(markup).toContain('<small>10–900 characters</small>');
    expect(markup).toContain('<small>10–1000 characters</small>');
    expect(markup).toContain('maxlength="900"');
    expect(markup).toContain('maxlength="1000"');
  });

  test('a wrong-row response poisons both boundaries and never triggers a misleading refresh', async () => {
    const body = { action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, expectedRevision: null,
      reason: 'Save this exact accepted workload research position.', confirmed: true,
      confirmationVersion: 'm26-capacity-ui-action-v1' };
    const wrong = { state: 'capacity_research_action_recorded', action: body.action,
      receiptId: USER, originId: ORG, outcomeId: null, continuationId: null, correctionOriginId: null,
      revision: null, researchOnly: true, automaticActionTaken: false, replayed: false };
    const server = application({ value: wrong });
    const rejected = await request(server.app).post('/api/v1/forecast/capacity-advice/journey/actions')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(body);
    expect(rejected.status).toBe(503);
    expect(rejected.body).toEqual({ success: false, error: 'Capacity advice research unavailable' });

    const ui = fixture(); const calls = []; const controller = capacity.create({ mode: 'paid', document: ui.document,
      idempotency: () => KEY, fetcher: async (_url, options) => {
        calls.push(options.method);
        return options.method === 'GET' ? response(200, captureJourney()) : response(201, wrong);
      } });
    await controller.workspaceReady('wrong-row-response');
    ui.values.commandCenterCapacityLaneReason.value = body.reason;
    ui.values.commandCenterCapacityLaneReason.listeners.input();
    await ui.lanes[0].click();
    expect(calls).toEqual(['GET', 'POST']);
    expect(controller.inspect().journey).toBeNull();
    expect(ui.values.commandCenterCapacityState.dataset.state).toBe('failed');
  });

  test('serves one no-store owner/admin projection and keeps failures generic', async () => {
    for (const role of ['owner', 'admin']) {
      const { app, client } = application({ role });
      const result = await request(app).get('/api/v1/forecast/capacity-advice/journey/current');
      expect(result.status).toBe(200); expect(result.body.data.state).toBe('capacity_research_journey_current');
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.headers['referrer-policy']).toBe('no-referrer');
      expect(client.query.mock.calls.find(([sql]) => sql.includes('capacity_ui_v5_current'))[1])
        .toEqual([ORG, USER, role, SESSION]);
    }
    expect((await request(application({ databaseError: { code: '42501', detail: 'tenant secret' } }).app)
      .get('/api/v1/forecast/capacity-advice/journey/current')).body).toEqual({ success: false, error: 'Forbidden' });
    const unavailable = await request(application({ databaseError: { code: 'XX000', detail: 'private 9876' } }).app)
      .get('/api/v1/forecast/capacity-advice/journey/current');
    expect(unavailable.status).toBe(503); expect(JSON.stringify(unavailable.body)).not.toContain('9876');
  });

  test('binds exact safe action and digest-hidden decision schemas', async () => {
    const setupValue = { state: 'capacity_research_setup_recorded', action: 'workload_epoch',
      token: 'a'.repeat(64), receiptId: USER, revision: 1, hiringConsecutivePeriods: 3,
      researchOnly: true, automaticActionTaken: false, replayed: false };
    const setupApp = application({ value: setupValue });
    const setupBody = { action: 'workload_epoch', token: 'a'.repeat(64), hiringConsecutivePeriods: 3,
      scopeReviews: [],
      reason: 'Explicitly approve this exact source-backed workload coverage epoch.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2' };
    const setup = await request(setupApp.app).post('/api/v1/forecast/capacity-advice/journey/setup')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(setupBody);
    expect(setup.status).toBe(201);
    expect(setupApp.client.query.mock.calls.find(([sql]) => sql.includes('capacity_ui_v5_setup_mutate'))[1])
      .toEqual([ORG, USER, 'owner', SESSION, 'csrf', KEY, setupBody.action, setupBody.token,
        setupBody.hiringConsecutivePeriods, '[]', setupBody.reason, setupBody.confirmationVersion]);

    const actionValue = { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
      receiptId: USER, originId: USER, outcomeId: null, continuationId: null, revision: null,
      correctionOriginId: null, researchOnly: true, automaticActionTaken: false, replayed: false };
    const actionApp = application({ value: actionValue });
    const body = { action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, reason: 'Save the exact accepted workload research position.',
      expectedRevision: null,
      confirmed: true, confirmationVersion: 'm26-capacity-ui-action-v1' };
    const saved = await request(actionApp.app).post('/api/v1/forecast/capacity-advice/journey/actions')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(body);
    expect(saved.status).toBe(201); expect(JSON.stringify(saved.body)).not.toContain('digest');
    expect(actionApp.client.query.mock.calls.find(([sql]) => sql.includes('capacity_ui_v5_action_mutate'))[1])
      .toEqual([ORG, USER, 'owner', SESSION, 'csrf', KEY, body.action, null, null, null,
        null, body.reason, body.confirmationVersion]);

    const decisionValue = { state: 'capacity_advisory_decision_recorded', id: USER, originId: ORG,
      action: 'approve', revision: 2, researchOnly: true, automaticActionTaken: false, replayed: true,
      previousDecisionId: SESSION, previousDecisionRevision: 1 };
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
        expectedRevision: null,
        reason: 'Save the exact workload research position.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-action-v1', createSchedule: true },
      { action: 'workload_capture_origin', originId: null, outcomeId: null, correctionOriginId: null,
        expectedRevision: null,
        reason: 'Save the exact workload research position.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-action-v1', privateManifest: {} },
      { action: 'workload_capture_origin', originId: null, outcomeId: null, correctionOriginId: null,
        expectedRevision: null,
        reason: 'Save the exact workload research position.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-action-v1', demandMinutes: 0 },
      { action: 'advisory_capture_evaluation', originId: ORG, outcomeId: null, correctionOriginId: null,
        expectedRevision: 1, reason: null, confirmed: true, confirmationVersion: 'm26-capacity-ui-action-v1' },
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
    for (const poison of [{ privateManifest: {} }, { workerId: USER }, { createSchedule: true },
      { expectedDigest: 'none' }]) {
      const setupApp = application();
      const body = { action: 'workload_epoch', token: 'a'.repeat(64), hiringConsecutivePeriods: 3,
        scopeReviews: [],
        reason: 'Explicitly approve this exact source-backed workload coverage epoch.',
        confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2', ...poison };
      expect((await request(setupApp.app).post('/api/v1/forecast/capacity-advice/journey/setup')
        .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(body)).status).toBe(400);
      expect(setupApp.pool.connect).not.toHaveBeenCalled();
    }
  });

  test('paid load is GET-only, writes exact safe bodies, and refreshes after success', async () => {
    const ui = fixture(); const calls = []; let reads = 0;
    const controller = capacity.create({ mode: 'paid', document: ui.document,
      idempotency: () => KEY, fetcher: async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'GET') { reads += 1; return response(200, reads > 1 ? capacity.demoJourney(1) : captureJourney()); }
        return response(201, { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
          receiptId: USER, originId: USER, outcomeId: null, continuationId: null, revision: null,
          correctionOriginId: null, researchOnly: true, automaticActionTaken: false, replayed: false });
      } });
    expect(calls).toEqual([]);
    await controller.workspaceReady('paid:tenant:revision:digest:session:generation:expiry');
    expect(calls.map(item => item.options.method)).toEqual(['GET']);
    ui.values.commandCenterCapacityLaneReason.value = 'Save this exact workload research origin.';
    ui.values.commandCenterCapacityLaneReason.listeners.input();
    await ui.lanes[0].click();
    expect(calls.map(item => item.options.method)).toEqual(['GET', 'POST', 'GET']);
    const sent = JSON.parse(calls[1].options.body);
    expect(sent).toEqual({ action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, reason: 'Save this exact workload research origin.', confirmed: true,
      expectedRevision: null,
      confirmationVersion: 'm26-capacity-ui-action-v1' });
    expect(calls[1].options.headers['Idempotency-Key']).toBe(KEY);
    expect(JSON.stringify(sent)).not.toMatch(/digest|minutes|count/i);
  });

  test('uncertain retry reuses exact endpoint, body and key; identity change discards late completion', async () => {
    const ui = fixture(); const calls = []; let postCount = 0;
    const controller = capacity.create({ mode: 'paid', document: ui.document,
      idempotency: () => KEY, fetcher: async (url, options) => {
        calls.push({ url, method: options.method, body: options.body, key: options.headers['Idempotency-Key'] });
        if (options.method === 'GET') return response(200, postCount ? capacity.demoJourney(1) : captureJourney());
        postCount += 1;
        if (postCount === 1) return response(503);
        return response(200, { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
          receiptId: USER, originId: USER, outcomeId: null, continuationId: null, revision: null,
          correctionOriginId: null, researchOnly: true, automaticActionTaken: false, replayed: true });
      } });
    await controller.workspaceReady('identity-one');
    ui.values.commandCenterCapacityLaneReason.value = 'Save this exact workload research origin.';
    ui.values.commandCenterCapacityLaneReason.listeners.input(); await ui.lanes[0].click();
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
