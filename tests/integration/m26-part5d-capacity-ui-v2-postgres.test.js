'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastCapacityAdvisoryRouter } = require('../../src/routes/forecastCapacityAdvisory');
const { CapacityAdvisoryContinuationWorker } = require('../../src/services/capacityAdvisoryContinuationWorker');
const capacity = require('../../public/js/command-center-capacity-research');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();

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

function controllerFixture() {
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
  values.commandCenterCapacityHiringPeriods.value = '2';
  const lanes = Object.fromEntries(['workload', 'constrained', 'advisory']
    .map(name => [name, new Element({ capacityLane: name })]));
  const decisions = Object.fromEntries(['approve', 'reject', 'withdraw']
    .map(name => [name, new Element({ capacityDecision: name })]));
  const selectors = { '[data-capacity-lane]': Object.values(lanes),
    '[data-capacity-decision]': Object.values(decisions), '[data-capacity-demo-action]': [] };
  return { values, lanes, decisions, document: {
    getElementById: id => values[id] || null,
    createElement: () => new Element(), querySelectorAll: selector => selectors[selector] || [],
  } };
}

realPostgres('Mission 26 Part 5D correction v2 mounted complete journey', () => {
  let fixture; let app; let logicalNow; let ui; let controller; let controllerReady = false;
  const mountedCalls = [];
  const endpoint = '/api/v1/forecast/capacity-advice';
  const actor = name => fixture.actors[name];
  const get = (path, name = 'owner') => request(app).get(endpoint + path).set('X-Test-Actor', name);
  const post = (path, body, key = `m26-p5d-v2-${uuid()}`, name = 'owner', csrf = null) => request(app)
    .post(endpoint + path).set('X-Test-Actor', name)
    .set('X-CSRF-Token', csrf === null ? actor(name).csrfToken : csrf)
    .set('Idempotency-Key', key).send(body);
  const setClock = async value => {
    logicalNow = new Date(value);
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [logicalNow]);
  };

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    app = express(); app.use(express.json());
    const bypass = (_req, _res, next) => next();
    const auth = (req, _res, next) => {
      const selected = actor(req.get('X-Test-Actor') || 'owner');
      req.user = { id: selected.actorUserId }; req.orgId = selected.organizationId;
      req.tenantContext = { organizationId: selected.organizationId, userId: selected.actorUserId };
      req.userRole = selected.actorAccessRole; req.authSession = { id: selected.authSessionId };
      next();
    };
    app.use(endpoint, createForecastCapacityAdvisoryRouter({ auth, throttle: bypass,
      writeThrottle: bypass, poolProvider: () => fixture.runtimePool }));
    await setClock('2030-01-01T00:00:00.000Z');
    for (const name of ['dispatcher', 'member']) {
      const member = actor(name); const reviewer = actor('owner');
      let current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
      expect(current.status).toBe(200);
      let response = await request(fixture.app).post('/api/work-profiles/me')
        .set(member.session.headers).set('Idempotency-Key', uuid()).send({
          action: 'submit', expectedRevision: current.body.data.profile.revision,
          profile: { title: 'Service technician', summary: 'Mounted source-backed capacity research authority.',
            skills: ['Fixture repair'], certifications: [{ id: 'safety', name: 'Safety training',
              issuer: 'Example Training', expiresOn: '2099-09-09', documentReference: 'P5D-SAFETY' }] },
        });
      expect(response.status).toBe(200);
      current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
      response = await request(fixture.app).post(`/api/work-profiles/reviews/${member.actorUserId}`)
        .set(reviewer.session.headers).set('Idempotency-Key', uuid()).send({
          action: 'approve', expectedRevision: current.body.data.profile.revision,
          reason: 'Owner explicitly reviewed the mounted source profile.', verifiedCertificationIds: ['safety'],
        });
      expect(response.status).toBe(200);
    }
    ui = controllerFixture();
    controller = capacity.create({ mode: 'paid', document: ui.document,
      idempotency: () => `m26-p5d-controller-${uuid()}`,
      fetcher: async (url, options) => {
        const method = options.method || 'GET'; let operation = method === 'GET' ? request(app).get(url) : request(app).post(url);
        operation = operation.set('X-Test-Actor', 'owner');
        if (method === 'POST') {
          operation = operation.set('X-CSRF-Token', actor('owner').csrfToken)
            .set('Idempotency-Key', options.headers['Idempotency-Key']).send(JSON.parse(options.body));
        }
        const result = await operation;
        mountedCalls.push({ method, url, body: options.body || null,
          idempotencyKey: options.headers && options.headers['Idempotency-Key'] || null,
          status: result.status, data: result.body && result.body.data || null });
        return { ok: result.status >= 200 && result.status < 300, status: result.status,
          json: async () => result.body };
      } });
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function journey() {
    if (!controllerReady) {
      controllerReady = true;
      await controller.workspaceReady('paid:mounted-tenant:revision:digest:session:generation:expiry');
    } else await controller.refresh();
    const value = controller.inspect().journey;
    if (!value) {
      const raw = (await fixture.ownerPool.query(
        'SELECT public.canonical_forecast_capacity_ui_v2_current($1,$2,$3,$4) value',
        [actor('owner').organizationId, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId])).rows[0].value;
      throw new Error(`Mounted controller journey failed: ${JSON.stringify({
        state: ui.values.commandCenterCapacityState.textContent, calls: mountedCalls.slice(-3).map(call => ({
          method: call.method, url: call.url, status: call.status, body: call.body,
        })),
        raw: { setup: raw.setup, workload: raw.workload.currentAction,
          constrained: raw.constrained.currentAction, advisory: raw.advisory.currentAction,
          locallyValid: capacity.validateJourney(raw) === raw } })}`);
    }
    expect(capacity.validateJourney(value)).toBe(value);
    expect(JSON.stringify(value)).not.toMatch(
      /privateResults|inputManifest|workerId|jobId|assetId|memberId|personMinutes|demandMinutes|capacityMinutes|gapMinutes|"digest"/i);
    return value;
  }

  async function setupNext(periods = 3, expectedAction = null) {
    const current = await journey();
    expect(current.setup.state).toBe('ready');
    if (expectedAction) expect(current.setup.action).toBe(expectedAction);
    ui.values.commandCenterCapacityHiringPeriods.value = String(periods);
    ui.values.commandCenterCapacityHiringPeriods.listeners.change();
    ui.values.commandCenterCapacityReviewReason.value = 'Approve this exact source-backed research prerequisite.';
    ui.values.commandCenterCapacityReviewReason.listeners.input();
    expect(ui.values.commandCenterCapacitySetupAction.disabled).toBe(false);
    await ui.values.commandCenterCapacitySetupAction.click();
    const call = mountedCalls.at(-2);
    if (!call || call.method !== 'POST' || call.status !== 201) throw new Error(
      `Mounted setup ${current.setup.action} failed: ${JSON.stringify({ call, state: ui.values.commandCenterCapacityState.textContent })}`);
    await setClock(new Date(logicalNow.getTime() + 1000));
    return controller.inspect().journey;
  }

  async function runSetupUntil(states) {
    const actions = [];
    for (let index = 0; index < 30; index += 1) {
      const current = await journey();
      if (states.includes(current.setup.state)) return { current, actions };
      if (current.setup.action === 'advisory_demand' && actions.includes('advisory_demand')) {
        const rows = (await fixture.ownerPool.query(`SELECT id,revision,action,definition,source_identity,
          (canonical_forecast_capacity_advisory_v1_review_current_internal(
            $1,review_kind,alternative_key,scope_key,role_name,subject_id)).id latest_id,
          canonical_forecast_capacity_advisory_v1_demand_valid(definition,review_kind) valid,
          canonical_forecast_capacity_advisory_v1_review_period_historical_current($1,value) historical,
          source_digest=canonical_completion_digest(source_identity) digest_current,
          canonical_forecast_capacity_advisory_v1_demand_source($1,review_kind,alternative_key,subject_id,
            definition,(source_identity->>'effectiveStart')::timestamptz) recomputed,
          source_identity-ARRAY['periodAuthorityId','effectiveStart','effectiveEnd','correctionOfReviewId',
            'correctionGeneration','observedAt','continuationId','predecessorDecisionId','predecessorDecisionDigest',
            'predecessorOutcomeId','predecessorOutcomeDigest','predecessorEvaluationId',
            'predecessorEvaluationDigest']::text[] base_source,
          canonical_forecast_capacity_advisory_v1_review_is_current($1,value) current
          FROM canonical_forecast_capacity_advisory_reviews_v1 value
          WHERE organization_id=$1 AND review_kind='demand' ORDER BY revision`, [fixture.org])).rows;
        throw new Error(`Demand review remained stale: ${JSON.stringify(rows)}`);
      }
      actions.push(current.setup.action); await setupNext();
    }
    throw new Error(`Setup did not reach a terminal state: ${actions.join(',')}`);
  }

  async function laneAction(lane) {
    const currentJourney = await journey(); const current = currentJourney[lane].currentAction;
    const maps = {
      workload: { capture_origin: 'workload_capture_origin', recover_origin: 'workload_capture_origin',
        capture_evaluation: 'workload_capture_evaluation' },
      constrained: { capture_origin: 'constrained_capture_origin', recover_origin: 'constrained_capture_origin',
        capture_outcome: 'constrained_capture_outcome', capture_evaluation: 'constrained_capture_evaluation' },
      advisory: { capture_origin: 'advisory_capture_origin', recover_origin: 'advisory_capture_origin',
        reserve_continuation: 'advisory_reserve_continuation', prepare_outcome: 'advisory_prepare_outcome',
        capture_outcome: 'advisory_capture_outcome', capture_evaluation: 'advisory_capture_evaluation' },
    };
    const action = maps[lane][current.name];
    if (!action) throw new Error(`No ${lane} mutation for ${current.name}`);
    ui.values.commandCenterCapacityLaneReason.value =
      'Save this exact current research receipt after explicit review.';
    ui.values.commandCenterCapacityLaneReason.listeners.input();
    expect(ui.lanes[lane].disabled).toBe(false);
    await ui.lanes[lane].click();
    const call = mountedCalls.slice().reverse().find(item => item.method === 'POST');
    if (!call || call.method !== 'POST' || ![200, 201].includes(call.status)) {
      throw new Error(`${action} failed through mounted controller: ${JSON.stringify({ call, current,
        state: ui.values.commandCenterCapacityState.textContent,
        recent: mountedCalls.slice(-3).map(item => ({ method: item.method, url: item.url,
          status: item.status, body: item.body })) })}`);
    }
    expect(call.data.action).toBe(action);
    return call.data;
  }

  async function decision(action = 'approve') {
    const current = (await journey()).advisory.currentAction;
    ui.values.commandCenterCapacityReviewReason.value =
      'Record this explicit human qualitative research review decision.';
    ui.values.commandCenterCapacityReviewReason.listeners.input();
    expect(ui.decisions[action].disabled).toBe(false);
    await ui.decisions[action].click();
    const call = mountedCalls.at(-2);
    if (!call || call.method !== 'POST' || call.status !== 201) throw new Error(
      `Decision failed through mounted controller: ${JSON.stringify({ call,
        state: ui.values.commandCenterCapacityState.textContent })}`);
    expect(call.data).toMatchObject({ originId: current.originId, action,
      previousDecisionId: current.expectedDecisionId,
      previousDecisionRevision: current.expectedDecisionRevision,
      revision: current.expectedDecisionRevision + 1 });
    return call.data;
  }

  test('walks accepted setup, all three lifecycles, policy staleness, recovery and continuation through guarded HTTP', async () => {
    const empty = await journey();
    expect(empty.setup).toMatchObject({ state: 'ready', action: 'workload_epoch' });
    expect(empty.workload.selectedOrigin).toBeNull();

    const initialSetup = await runSetupUntil(['waiting', 'unavailable', 'complete']);
    expect(initialSetup.current.setup.state).toBe('waiting');
    expect(initialSetup.actions).toEqual(['workload_epoch', 'workload_methods', 'workload_roles',
      'workload_role_scope', 'constrained_epoch', 'constrained_method']);
    const firstSetupCall = mountedCalls.find(call => call.method === 'POST' &&
      call.url.endsWith('/journey/setup'));
    const firstSetupBody = JSON.parse(firstSetupCall.body);
    let replay = await post('/journey/setup', firstSetupBody, firstSetupCall.idempotencyKey);
    expect(replay.status).toBe(200); expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ action: firstSetupBody.action, token: firstSetupBody.token,
      replayed: true });
    let conflict = await post('/journey/setup', { ...firstSetupBody,
      reason: `${firstSetupBody.reason} Changed.` }, firstSetupCall.idempotencyKey);
    expect(conflict.status).toBe(409);
    conflict = await post('/journey/setup', firstSetupBody, `m26-p5d-v2-changed-key-${uuid()}`);
    expect([400, 409]).toContain(conflict.status);
    await setClock(new Date(logicalNow.getTime() + 61 * 86400000));
    const completedSetup = await runSetupUntil(['waiting', 'unavailable', 'complete']);
    if (completedSetup.current.setup.state !== 'complete') throw new Error(
      `Setup unavailable after ${completedSetup.actions.join(',')}: ${JSON.stringify(completedSetup.current.setup)}`);
    expect(completedSetup.current.setup.state).toBe('complete');
    expect(completedSetup.actions).toEqual(['constrained_scope',
      'advisory_method', 'advisory_policy', 'advisory_demand', 'advisory_epoch']);

    const workloadOrigin = await laneAction('workload');
    const workloadOriginCall = mountedCalls.find(call => call.method === 'POST' && call.body &&
      JSON.parse(call.body).action === 'workload_capture_origin');
    conflict = await post('/journey/actions', JSON.parse(workloadOriginCall.body),
      `m26-p5d-v2-changed-key-${uuid()}`);
    expect(conflict.status).toBe(409);
    const constrainedOrigin = await laneAction('constrained');
    const advisoryOrigin = await laneAction('advisory');
    expect(workloadOrigin.originId).toBe(workloadOrigin.receiptId);
    expect(constrainedOrigin.originId).toBe(constrainedOrigin.receiptId);
    expect(advisoryOrigin.originId).toBe(advisoryOrigin.receiptId);
    const firstDecision = await decision('approve');
    const firstDecisionCall = mountedCalls.find(call => call.method === 'POST' &&
      call.url.endsWith('/safe-decisions'));
    const firstDecisionBody = JSON.parse(firstDecisionCall.body);
    replay = await post(firstDecisionCall.url.slice(endpoint.length), firstDecisionBody,
      firstDecisionCall.idempotencyKey);
    expect(replay.status).toBe(200); expect(replay.headers['idempotency-replayed']).toBe('true');
    conflict = await post(firstDecisionCall.url.slice(endpoint.length), { ...firstDecisionBody,
      reason: `${firstDecisionBody.reason} Changed.` }, firstDecisionCall.idempotencyKey);
    expect(conflict.status).toBe(409);
    const firstContinuation = await laneAction('advisory');
    expect(firstContinuation.continuationId).toBe(firstContinuation.receiptId);

    let current = await journey();
    expect(current.correctionReview).toMatchObject({ state: 'ready', action: 'advisory_correction_demand',
      reasonLimit: 1000 });
    ui.values.commandCenterCapacityReviewReason.value =
      'Explicitly review this source-backed same-period correction lineage.';
    ui.values.commandCenterCapacityReviewReason.listeners.input();
    expect(ui.values.commandCenterCapacityCorrectionAction.disabled).toBe(false);
    await ui.values.commandCenterCapacityCorrectionAction.click();
    expect(mountedCalls.at(-2)).toMatchObject({ method: 'POST', status: 201,
      data: { action: 'advisory_correction_demand' } });
    current = await journey();
    expect(current.setup.state).toBe('complete');
    expect(current.advisory.currentAction).toMatchObject({ name: 'recover_origin',
      correctionOriginId: advisoryOrigin.originId });
    const correctedOrigin = await laneAction('advisory');
    expect(correctedOrigin.correctionOriginId).toBe(advisoryOrigin.originId);
    const correctedDecision = await decision('approve');
    const correctedContinuation = await laneAction('advisory');

    current = await journey();
    const policyBody = { action: 'advisory_policy_revision', token: current.hiringPolicy.token,
      hiringConsecutivePeriods: 4, reason: 'Change the explicit human-selected hiring attention run length.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2' };
    ui.values.commandCenterCapacityHiringPeriods.value = '4';
    ui.values.commandCenterCapacityHiringPeriods.listeners.change();
    ui.values.commandCenterCapacityReviewReason.value = policyBody.reason;
    ui.values.commandCenterCapacityReviewReason.listeners.input();
    expect(ui.values.commandCenterCapacityPolicyAction.disabled).toBe(false);
    await ui.values.commandCenterCapacityPolicyAction.click();
    expect(mountedCalls.at(-2)).toMatchObject({ method: 'POST', status: 201,
      data: { action: 'advisory_policy_revision' } });
    current = await journey();
    expect(current.advisory.selectedOrigin).toBeNull();
    expect(current.advisory.history.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: advisoryOrigin.originId, state: 'stale' }),
    ]));
    await setupNext(4, 'advisory_epoch');
    const recoveredOrigin = await laneAction('advisory');
    expect(recoveredOrigin.correctionOriginId).toBeNull();
    expect(recoveredOrigin.originId).not.toBe(correctedOrigin.originId);
    const recoveredDecision = await decision('approve');
    const recoveredContinuation = await laneAction('advisory');
    expect(recoveredContinuation.continuationId).not.toBe(correctedContinuation.continuationId);

    current = await journey();
    await setClock(current.advisory.selectedOrigin.horizonEndsAt);
    await setupNext(4, 'workload_outcome_window');
    const workloadEvaluation = await laneAction('workload');
    expect(workloadEvaluation.revision).toBe(1);
    const workloadEvaluationCall = mountedCalls.find(call => call.method === 'POST' &&
      call.body && JSON.parse(call.body).action === 'workload_capture_evaluation');
    const workloadEvaluationBody = JSON.parse(workloadEvaluationCall.body);
    replay = await post('/journey/actions', workloadEvaluationBody,
      workloadEvaluationCall.idempotencyKey);
    expect(replay.status).toBe(200); expect(replay.headers['idempotency-replayed']).toBe('true');
    conflict = await post('/journey/actions', { ...workloadEvaluationBody,
      expectedRevision: workloadEvaluationBody.expectedRevision + 1 },
    workloadEvaluationCall.idempotencyKey);
    expect(conflict.status).toBe(409);
    conflict = await post('/journey/actions', workloadEvaluationBody,
      `m26-p5d-v2-changed-key-${uuid()}`);
    expect(conflict.status).toBe(409);
    const constrainedOutcome = await laneAction('constrained');
    expect(constrainedOutcome.revision).toBe(1);
    const constrainedEvaluation = await laneAction('constrained');
    expect(constrainedEvaluation.outcomeId).toBe(constrainedOutcome.outcomeId);
    await setupNext(4, 'advisory_outcome_demand');
    const advisoryOutcome = await laneAction('advisory');
    const advisoryEvaluation = await laneAction('advisory');
    expect(advisoryEvaluation.outcomeId).toBe(advisoryOutcome.outcomeId);
    await setupNext(4, 'advisory_continuation_demand');

    const worker = new CapacityAdvisoryContinuationWorker({ getPool: () => fixture.runtimePool });
    expect(await worker.drainOnce()).toEqual({ due: 1, attempted: 1 });
    worker.stop();
    current = await journey();
    expect(current.advisory.history.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstContinuation.continuationId,
        state: 'capacity_advisory_continuation_stale' }),
      expect.objectContaining({ id: correctedContinuation.continuationId,
        state: 'capacity_advisory_continuation_stale' }),
      expect.objectContaining({ id: recoveredContinuation.continuationId,
        state: 'capacity_advisory_continuation_activated' }),
      expect.objectContaining({ id: firstDecision.id, state: 'stale' }),
      expect.objectContaining({ id: correctedDecision.id, state: 'stale' }),
      expect.objectContaining({ id: recoveredDecision.id, state: 'current' }),
    ]));
    expect(current.workload.history.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: workloadEvaluation.receiptId, kind: 'evaluation' }),
    ]));
    expect(current.constrained.history.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: constrainedEvaluation.receiptId, kind: 'evaluation' }),
    ]));
    expect(current.setup.state).toBe('complete');
    const mountedActions = mountedCalls.filter(call => call.method === 'POST')
      .map(call => JSON.parse(call.body).action);
    const expectedMountedActions = [
      'workload_epoch', 'workload_methods', 'workload_roles', 'workload_role_scope',
      'constrained_epoch', 'constrained_method', 'constrained_scope', 'advisory_method',
      'advisory_policy', 'advisory_demand', 'advisory_epoch', 'workload_capture_origin',
      'constrained_capture_origin', 'advisory_capture_origin', 'approve',
      'advisory_reserve_continuation', 'advisory_correction_demand',
      'advisory_policy_revision', 'workload_outcome_window', 'workload_capture_evaluation',
      'constrained_capture_outcome', 'constrained_capture_evaluation', 'advisory_outcome_demand',
      'advisory_capture_outcome', 'advisory_capture_evaluation',
      'advisory_continuation_demand',
    ];
    expect(expectedMountedActions.filter(action => !mountedActions.includes(action))).toEqual([]);
    expect(mountedCalls.filter(call => call.method === 'POST').every(call =>
      call.url.startsWith('/api/v1/forecast/capacity-advice/') && call.idempotencyKey)).toBe(true);
    expect(controller.inspect()).toMatchObject({ identity:
      'paid:mounted-tenant:revision:digest:session:generation:expiry', uncertainAttempt: null, busy: false });
  }, 120000);
});
