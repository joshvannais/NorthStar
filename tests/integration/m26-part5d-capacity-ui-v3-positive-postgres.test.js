'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastCapacityAdvisoryRouter } = require('../../src/routes/forecastCapacityAdvisory');
const { CapacityAdvisoryContinuationWorker } = require('../../src/services/capacityAdvisoryContinuationWorker');
const { ingestLead } = require('../../src/services/canonicalGraphService');
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
    'commandCenterCapacityHiringState', 'commandCenterCapacityCorrectionState',
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

realPostgres('Mission 26 Part 5D correction v3 mounted positive-work journey', () => {
  let fixture; let app; let logicalNow; let ui; let controller; let controllerReady = false;
  let positiveWork; let secondPositiveWork;
  let workSequence = 0;
  const mountedCalls = [];
  const endpoint = '/api/v1/forecast/capacity-advice';
  const actor = name => fixture.actors[name];
  const get = (path, name = 'owner') => request(app).get(endpoint + path).set('X-Test-Actor', name);
  const post = (path, body, key = `m26-p5d-v3-${uuid()}`, name = 'owner', csrf = null) => request(app)
    .post(endpoint + path).set('X-Test-Actor', name)
    .set('X-CSRF-Token', csrf === null ? actor(name).csrfToken : csrf)
    .set('Idempotency-Key', key).send(body);
  const setClock = async value => {
    logicalNow = new Date(value);
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [logicalNow]);
  };

  async function createAcceptedWork() {
    const sequence = workSequence++;
    const graphKey = `m26-p5d-v3-graph-${uuid()}`;
    const activeProfile = (await fixture.ownerPool.query(
      `SELECT id,version_label,rtrim(normalized_profile_hash) profile_hash
         FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org])).rows[0];
    const scheduledStart = new Date(Date.parse('2030-05-10T13:00:00.000Z') + sequence * 86400000);
    const scheduledEnd = new Date(scheduledStart.getTime() + 3600000);
    const ingested = await ingestLead(fixture.runtimePool, {
      tenantContext: { organizationId: fixture.org, trusted: true }, idempotencyKey: graphKey,
      sourceVersion: 'm26-capacity-ui-v3-positive-work-v1',
      businessProfileAuthorityId: activeProfile.id,
      businessProfileAuthorityVersion: activeProfile.version_label,
      businessProfileAuthorityHash: activeProfile.profile_hash,
      external: { customerId: graphKey, callId: graphKey, transcriptId: graphKey,
        communicationId: graphKey, appointmentId: graphKey },
      customer: { name: 'Mounted positive-work customer', phone: '+15550106789',
        email: `${graphKey}@example.test`,
        address: { line1: '1 Mounted Evidence Way', city: 'Boston', state: 'MA', postalCode: '02108' } },
      transcript: [{ turnId: 'scope', speaker: 'customer',
        text: 'Please schedule this bounded synthetic installed-source service visit.' }],
      facts: [{ variable: 'serviceLocation', normalizedValue: 'headquarters',
        evidenceText: 'this bounded synthetic installed-source service visit', speaker: 'customer',
        evidenceTurnId: 'scope', confidence: 1 }],
      service: { key: 'plumbing', scope: { locationId: 'headquarters',
        sourcePurpose: 'm26-part5d-v3-mounted-positive-evidence' } },
      scheduledAppointment: { start: scheduledStart.toISOString(), end: scheduledEnd.toISOString(),
        status: 'scheduled' },
    });
    expect(ingested.status).toBe(201);
    const appointment = ingested.body.ids.appointment; const opportunity = ingested.body.ids.opportunity;
    for (const action of ['assign', 'dispatch']) {
      const before = (await fixture.ownerPool.query(
        `SELECT revision,rtrim(canonical_digest) digest,appointment_status,scheduled_start,scheduled_end
           FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
        [fixture.org, appointment])).rows[0];
      const preview = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
        .set(actor('owner').session.headers).send({ expectedRevision: Number(before.revision),
          expectedDigest: before.digest, expectedTimeZone: 'UTC', action,
          target: { kind: 'profile', id: actor('member').actorUserId },
          scheduledStart: new Date(before.scheduled_start).toISOString(),
          scheduledEnd: new Date(before.scheduled_end).toISOString(),
          appointmentStatus: before.appointment_status,
          reason: 'Explicit guarded scheduling action for the mounted positive-work proof.' });
      expect(preview.status).toBe(201);
      const approval = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5d-v3-schedule-${uuid()}`)
        .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
          reason: 'Explicit guarded scheduling action for the mounted positive-work proof.' });
      expect(approval.status).toBe(200);
    }
    const assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, appointment])).rows[0];
    return { appointment, opportunity, assignment };
  }

  async function approvePersonPlan(work, workerHours = '8') {
    const estimate = (await fixture.ownerPool.query(
      'SELECT id FROM canonical_estimates WHERE organization_id=$1 AND opportunity_id=$2',
      [fixture.org, work.opportunity])).rows[0];
    expect(estimate).toBeTruthy();
    const route = `/api/v1/canonical/estimates/${estimate.id}`;
    const read = async () => {
      const response = await request(fixture.app).get(`${route}/review`).set(actor('owner').session.headers);
      expect(response.status).toBe(200); return response.body.data;
    };
    let review = await read();
    if (Number(review.decisions.writeBasis.revision) === 0) {
      const decision = await request(fixture.app).post(`${route}/decisions`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5d-v3-estimate-${uuid()}`).send({
          action: 'approve', expectedRevision: review.decisions.writeBasis.revision,
          expectedDigest: review.decisions.writeBasis.digest, sourcePins: review.pins,
          scopeSummary: 'Owner-reviewed exact mounted positive-work source.', priceBeforeTax: '500.00',
          currency: review.currency, reason: 'Owner approves this exact synthetic estimate before capacity research.',
          confirmed: true, confirmationVersion: 'estimate-quote-preparation-v1' });
      expect(decision.status).toBe(201); review = await read();
    }
    const labor = require('../helpers/m24-labor-input');
    const laborInputs = labor.inputs([labor.line({ task: 'Exact mounted workload basis',
      basis: 'worker_hours', workerHours, people: null, elapsedHours: null })]);
    laborInputs.serviceKey = review.materialSourceContext.serviceKey;
    const body = { action: 'save', expectedRevision: review.laborPlans.current?.revision || 0,
      expectedDigest: review.laborPlans.current?.digest || 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: laborInputs,
      currency: review.currency, reason: 'Review the exact internal worker-hour plan for capacity research.',
      confirmed: true, confirmationVersion: 'estimate-labor-plan-v1' };
    let response = await request(fixture.app).post(`${route}/labor-plan-preview`)
      .set(actor('owner').session.headers).send(body);
    expect(response.status).toBe(200);
    body.inputs.assessment = { ...response.body.data.result.assessment, acknowledged: true,
      explanation: 'Owner reviewed this bounded internal synthetic workload basis.' };
    response = await request(fixture.app).post(`${route}/labor-plans`)
      .set(actor('owner').session.headers).set('Idempotency-Key', uuid()).send(body);
    expect(response.status).toBe(201); review = await read();
    const assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, work.appointment])).rows[0];
    const currentPersonPlan = (await fixture.ownerPool.query(
      `SELECT id,rtrim(digest) digest
         FROM canonical_forecast_current_backlog_person_plan_reviews
        WHERE organization_id=$1 AND appointment_id=$2 ORDER BY revision DESC LIMIT 1`,
      [fixture.org, work.appointment])).rows[0] || null;
    response = await request(fixture.app)
      .post(`/api/v1/forecast/current-backlog/person-plan-sources/${work.appointment}/reviews`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5d-v3-person-plan-${uuid()}`).send({
        action: 'approve', expectedCurrentReviewId: currentPersonPlan?.id || null,
        expectedCurrentReviewDigest: currentPersonPlan?.digest || 'none',
        assignmentId: assignment.id, expectedAssignmentRevision: Number(assignment.revision),
        expectedAssignmentDigest: assignment.digest, estimateId: estimate.id,
        laborPlanId: review.laborPlans.current.id,
        expectedLaborPlanRevision: Number(review.laborPlans.current.revision),
        expectedLaborPlanDigest: review.laborPlans.current.digest,
        reason: 'Owner reviewed this exact work identity and worker-hour plan for the mounted proof.',
        confirmed: true, confirmationVersion: 'm26-current-backlog-person-plan-v1' });
    expect(response.status).toBe(201);
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
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
    let response = await request(fixture.app).put(`/api/workforce/profiles/${actor('member').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'technician',
        homeLocationId: 'headquarters', skillIds: [] });
    expect(response.status).toBe(200);
    const availabilityStart = new Date('2029-12-31T00:00:00.000Z');
    const availabilityIntervals = Array.from({ length: 12 }, (_, index) => ({
      kind: 'available',
      start: new Date(availabilityStart.getTime() + index * 30 * 86400000).toISOString(),
      end: new Date(availabilityStart.getTime() + (index + 1) * 30 * 86400000).toISOString(),
    }));
    response = await request(fixture.app)
      .put(`/api/v1/canonical/availability/profiles/${actor('member').actorUserId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5d-v3-availability-${uuid()}`)
      .send({ expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: availabilityStart.toISOString(),
        coverageEnd: new Date(availabilityStart.getTime() + 365 * 86400000).toISOString(),
        intervals: availabilityIntervals,
        reason: 'Owner declared bounded future availability for the mounted positive-work proof.' });
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 200 });
    positiveWork = await createAcceptedWork();
    await approvePersonPlan(positiveWork);
    secondPositiveWork = await createAcceptedWork();
    await approvePersonPlan(secondPositiveWork);
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
          status: result.status, response: result.body || null,
          data: result.body && result.body.data || null });
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
        'SELECT public.canonical_forecast_capacity_ui_v3_current($1,$2,$3,$4) value',
        [actor('owner').organizationId, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId])).rows[0].value;
      throw new Error(`Mounted controller journey failed: ${JSON.stringify({
        state: ui.values.commandCenterCapacityState.textContent, calls: mountedCalls.slice(-3).map(call => ({
          method: call.method, url: call.url, status: call.status, body: call.body,
        })),
        raw: { setup: raw.setup, workload: raw.workload.currentAction,
          constrained: raw.constrained.currentAction, advisory: raw.advisory.currentAction,
          advisoryOrigin: raw.advisory.selectedOrigin,
          advisoryHistory: raw.advisory.history,
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
    const callStart = mountedCalls.length;
    await ui.values.commandCenterCapacitySetupAction.click();
    const actionCalls = mountedCalls.slice(callStart);
    const call = actionCalls.find(entry => entry.method === 'POST');
    if (!call || call.method !== 'POST' || call.status !== 201) throw new Error(
      `Mounted setup ${current.setup.action} failed: ${JSON.stringify({ actionCalls, state: ui.values.commandCenterCapacityState.textContent })}`);
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

  async function runSetupUntilAction(action) {
    const actions = [];
    for (let index = 0; index < 30; index += 1) {
      const current = await journey();
      if (current.setup.state === 'ready' && current.setup.action === action) return { current, actions };
      if (current.setup.state !== 'ready') throw new Error(
        `Setup reached ${current.setup.state} before ${action}: ${actions.join(',')}`);
      actions.push(current.setup.action); await setupNext();
    }
    throw new Error(`Setup did not reach ${action}: ${actions.join(',')}`);
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
    if (!action) throw new Error(`No ${lane} mutation for ${current.name}: ${JSON.stringify({
      setup: currentJourney.setup, workload: currentJourney.workload.currentAction,
      constrained: currentJourney.constrained.currentAction,
      advisory: currentJourney.advisory.currentAction })}`);
    ui.values.commandCenterCapacityLaneReason.value =
      'Save this exact current research receipt after explicit review.';
    ui.values.commandCenterCapacityLaneReason.listeners.input();
    expect(ui.lanes[lane].disabled).toBe(false);
    await ui.lanes[lane].click();
    const call = mountedCalls.slice().reverse().find(item => item.method === 'POST');
    if (!call || call.method !== 'POST' || ![200, 201].includes(call.status)) {
      const constrainedDebug = action === 'constrained_capture_origin' ? (await fixture.ownerPool.query(
        `SELECT scope_key,definition,
          public.canonical_forecast_workload_capacity_v1_capacity_calculation(
            organization_id,$1::timestamptz,$1::timestamptz+interval '30 days',
            $1::timestamptz,definition->>'role') calculation
         FROM public.canonical_forecast_constrained_capacity_reviews_v1
         WHERE organization_id=$2 AND review_kind='scope' AND action='approve'
         ORDER BY decided_at DESC`, [logicalNow, fixture.org])).rows : null;
      throw new Error(`${action} failed through mounted controller: ${JSON.stringify({ call, current,
        state: ui.values.commandCenterCapacityState.textContent,
        constrainedDebug,
        recent: mountedCalls.slice(-3).map(item => ({ method: item.method, url: item.url,
          status: item.status, body: item.body })) })}`);
    }
    expect(call.data.action).toBe(action);
    return call.data;
  }

  async function decision(action = 'approve') {
    const value = await journey();
    const current = value.advisory.currentAction;
    ui.values.commandCenterCapacityReviewReason.value =
      'Record this explicit human qualitative research review decision.';
    ui.values.commandCenterCapacityReviewReason.listeners.input();
    if (ui.decisions[action].disabled) throw new Error(`Decision ${action} disabled: ${JSON.stringify({
      setup: value.setup, currentAction: value.advisory.currentAction,
      origin: value.advisory.selectedOrigin })}`);
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

  test('walks positive accepted work through safe setup, all three lifecycles, recovery and continuation', async () => {
    const empty = await journey();
    expect(empty.setup).toMatchObject({ state: 'ready', action: 'workload_epoch' });
    expect(empty.workload.selectedOrigin).toBeNull();
    expect((await fixture.ownerPool.query(
      `SELECT (canonical_forecast_constrained_capacity_v1_work_census($1,$2)->>'count')::int count`,
      [fixture.org, logicalNow])).rows[0].count).toBe(2);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind='job'`, [fixture.org])).rows[0].count)).toBe(0);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('demand','outcome_demand')`, [fixture.org])).rows[0].count)).toBe(0);

    const beforeJobs = await runSetupUntilAction('constrained_job_census');
    expect(beforeJobs.actions).toEqual(['workload_epoch', 'workload_methods', 'workload_roles',
      'workload_role_scope', 'workload_remaining_census', 'constrained_epoch',
      'constrained_method', 'constrained_work_scopes']);
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
    conflict = await post('/journey/setup', firstSetupBody, `m26-p5d-v3-changed-key-${uuid()}`);
    expect([400, 409]).toContain(conflict.status);
    const privateJobPlan = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_capacity_ui_v3_job_plan($1,$2) value',
      [fixture.org, logicalNow])).rows[0].value;
    expect(privateJobPlan.state).toBe('ready'); expect(privateJobPlan.entries).toHaveLength(2);
    const rejectedSubject = privateJobPlan.entries.map(value => value.subjectId).sort().at(-1);
    await fixture.ownerPool.query(`CREATE FUNCTION public.m26_part5d_v3_test_reject_second_job()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
       IF NEW.review_kind='job' AND NEW.subject_id='${rejectedSubject}'::uuid THEN
        RAISE EXCEPTION 'Disposable atomic rollback injection';END IF;RETURN NEW;END$$;
      CREATE TRIGGER m26_part5d_v3_test_reject_second_job BEFORE INSERT
       ON public.canonical_forecast_constrained_capacity_reviews_v1 FOR EACH ROW
       EXECUTE FUNCTION public.m26_part5d_v3_test_reject_second_job()`);
    const atomicBody = { action: beforeJobs.current.setup.action, token: beforeJobs.current.setup.token,
      hiringConsecutivePeriods: 3, reason: 'Prove this complete job census is atomic under a known failure.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2' };
    try {
      const atomicFailure = await post('/journey/setup', atomicBody, `m26-p5d-v3-atomic-${uuid()}`);
      expect(atomicFailure.status).toBe(503);
      expect(Number((await fixture.ownerPool.query(
        `SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1
          WHERE organization_id=$1 AND review_kind='job'`, [fixture.org])).rows[0].count)).toBe(0);
    } finally {
      await fixture.ownerPool.query(`DROP TRIGGER IF EXISTS m26_part5d_v3_test_reject_second_job
        ON public.canonical_forecast_constrained_capacity_reviews_v1;
        DROP FUNCTION IF EXISTS public.m26_part5d_v3_test_reject_second_job()`);
    }
    expect(JSON.stringify(atomicBody)).not.toMatch(
      /appointmentId|assignmentId|subjectId|personMinutes|workerId|jobId|assetId|memberId/i);
    await setupNext(3, 'constrained_job_census');
    const waiting = await runSetupUntil(['waiting', 'unavailable', 'complete']);
    expect(waiting.current.setup.state).toBe('waiting');
    expect(waiting.actions).toEqual([]);
    await setClock(new Date(logicalNow.getTime() + 61 * 86400000));
    const completedSetup = await runSetupUntil(['waiting', 'unavailable', 'complete']);
    if (completedSetup.current.setup.state !== 'complete') throw new Error(
      `Setup unavailable after ${completedSetup.actions.join(',')}: ${JSON.stringify(completedSetup.current.setup)}`);
    expect(completedSetup.current.setup.state).toBe('complete');
    expect(completedSetup.actions).toEqual([
      'advisory_method', 'advisory_policy', 'advisory_demand', 'advisory_epoch']);
    expect((await fixture.ownerPool.query(
      `SELECT jsonb_array_length(definition->'allocations') allocation_count
         FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind='demand'
        ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0].allocation_count).toBe(2);
    const fullCensus = await fixture.ownerPool.query(
      `SELECT (canonical_forecast_constrained_capacity_v1_work_census($1,$2)->>'count')::int work_count,
        (SELECT count(*)::int FROM canonical_forecast_constrained_capacity_reviews_v1 value
          WHERE value.organization_id=$1 AND value.review_kind='job' AND value.action='approve'
           AND value.id=(SELECT latest.id FROM canonical_forecast_constrained_capacity_reviews_v1 latest
             WHERE latest.organization_id=$1 AND latest.review_kind='job'
              AND latest.scope_key=value.scope_key AND latest.subject_id=value.subject_id
             ORDER BY latest.revision DESC LIMIT 1)) job_count`, [fixture.org, logicalNow]);
    expect(fullCensus.rows[0]).toMatchObject({ work_count: 2, job_count: 2 });

    const workloadOrigin = await laneAction('workload');
    const workloadOriginCall = mountedCalls.find(call => call.method === 'POST' && call.body &&
      JSON.parse(call.body).action === 'workload_capture_origin');
    conflict = await post('/journey/actions', JSON.parse(workloadOriginCall.body),
      `m26-p5d-v3-changed-key-${uuid()}`);
    expect(conflict.status).toBe(409);
    const constrainedOrigin = await laneAction('constrained');
    const advisoryOrigin = await laneAction('advisory');
    expect(workloadOrigin.originId).toBe(workloadOrigin.receiptId);
    expect(constrainedOrigin.originId).toBe(constrainedOrigin.receiptId);
    expect(advisoryOrigin.originId).toBe(advisoryOrigin.receiptId);
    let current = await journey();
    expect(current.setup.state).toBe('complete');
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

    await setClock(new Date(logicalNow.getTime() + 1000));
    await approvePersonPlan(positiveWork, '10');
    await setClock(new Date(logicalNow.getTime() + 1000));
    current = await journey();
    expect(current.setup).toMatchObject({ state: 'ready', action: 'workload_remaining_census' });
    await setupNext(3, 'workload_remaining_census');
    await setupNext(3, 'advisory_demand');
    current = await journey();
    expect(current.setup).toMatchObject({ state: 'waiting', action: null, lane: 'workload',
      label: 'Building corrected workload history' });
    expect(ui.lanes.workload.disabled).toBe(true);
    await setClock(new Date(logicalNow.getTime() + 61 * 86400000));
    current = await journey();
    expect(current.setup.state).toBe('complete');
    expect(current.workload.currentAction.name).toBe('recover_origin');
    expect(current.workload.history.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: workloadOrigin.originId, state: 'stale' }),
    ]));
    expect(current.advisory.history.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: advisoryOrigin.originId, state: 'stale' }),
      expect.objectContaining({ id: firstDecision.id, state: 'stale' }),
      expect.objectContaining({ id: firstContinuation.continuationId,
        state: 'capacity_advisory_continuation_stale' }),
    ]));
    const sourceCorrectedWorkloadOrigin = await laneAction('workload');
    expect(sourceCorrectedWorkloadOrigin.originId).not.toBe(workloadOrigin.originId);
    const sourceCorrectedAdvisoryOrigin = await laneAction('advisory');
    expect(sourceCorrectedAdvisoryOrigin.originId).not.toBe(advisoryOrigin.originId);
    const sourceCorrectedDecision = await decision('approve');
    const sourceCorrectedContinuation = await laneAction('advisory');

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
      expect.objectContaining({ id: sourceCorrectedAdvisoryOrigin.originId, state: 'stale' }),
    ]));
    await setupNext(4, 'advisory_epoch');
    const recoveredOrigin = await laneAction('advisory');
    expect(recoveredOrigin.correctionOriginId).toBeNull();
    expect(recoveredOrigin.originId).not.toBe(sourceCorrectedAdvisoryOrigin.originId);
    const recoveredDecision = await decision('approve');
    const recoveredContinuation = await laneAction('advisory');
    expect(recoveredContinuation.continuationId).not.toBe(sourceCorrectedContinuation.continuationId);

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
      `m26-p5d-v3-changed-key-${uuid()}`);
    expect(conflict.status).toBe(409);
    await setupNext(4, 'advisory_outcome_demand');
    expect((await fixture.ownerPool.query(
      `SELECT jsonb_array_length(definition->'allocations') allocation_count
         FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind='outcome_demand'
        ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0].allocation_count).toBe(2);
    const constrainedOutcome = await laneAction('constrained');
    expect(constrainedOutcome.revision).toBe(1);
    const constrainedEvaluation = await laneAction('constrained');
    expect(constrainedEvaluation.outcomeId).toBe(constrainedOutcome.outcomeId);
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
      expect.objectContaining({ id: sourceCorrectedContinuation.continuationId,
        state: 'capacity_advisory_continuation_stale' }),
      expect.objectContaining({ id: recoveredContinuation.continuationId,
        state: 'capacity_advisory_continuation_activated' }),
      expect.objectContaining({ id: firstDecision.id, state: 'stale' }),
      expect.objectContaining({ id: sourceCorrectedDecision.id, state: 'stale' }),
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
      'workload_remaining_census', 'constrained_epoch', 'constrained_method',
      'constrained_work_scopes', 'constrained_job_census', 'advisory_method',
      'advisory_policy', 'advisory_demand', 'advisory_epoch', 'workload_capture_origin',
      'constrained_capture_origin', 'advisory_capture_origin', 'approve',
      'advisory_reserve_continuation',
      'advisory_policy_revision', 'workload_outcome_window', 'workload_capture_evaluation',
      'constrained_capture_outcome', 'constrained_capture_evaluation', 'advisory_outcome_demand',
      'advisory_capture_outcome', 'advisory_capture_evaluation',
      'advisory_continuation_demand',
    ];
    expect(expectedMountedActions.filter(action => !mountedActions.includes(action))).toEqual([]);
    expect(mountedCalls.filter(call => call.method === 'POST').every(call =>
      call.url.startsWith('/api/v1/forecast/capacity-advice/') && call.idempotencyKey)).toBe(true);
    const setupBodies = mountedCalls.filter(call => call.method === 'POST' &&
      call.url.endsWith('/journey/setup')).map(call => call.body);
    expect(JSON.stringify(setupBodies)).not.toMatch(
      /appointmentId|assignmentId|subjectId|workerId|jobId|assetId|memberId|personMinutes|demandMinutes/i);
    expect(controller.inspect()).toMatchObject({ identity:
      'paid:mounted-tenant:revision:digest:session:generation:expiry', uncertainAttempt: null, busy: false });
  }, 120000);
});
