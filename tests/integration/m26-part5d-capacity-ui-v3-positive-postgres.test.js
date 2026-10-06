'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { createForecastCapacityAdvisoryRouter } = require('../../src/routes/forecastCapacityAdvisory');
const { CapacityAdvisoryContinuationWorker } = require('../../src/services/capacityAdvisoryContinuationWorker');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const capacity = require('../../public/js/command-center-capacity-research');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();

class Element {
  constructor(dataset = {}) {
    this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false;
    this.children = []; this.listeners = {}; this.dataset = dataset; this.className = ''; this.open = false;
    this.attributes = {};
  }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  replaceChildren(...items) { this.children = items; }
  append(...items) { this.children.push(...items); }
  click() { return this.listeners.click && this.listeners.click({ preventDefault() {} }); }
  focus() { this.focused = true; }
}

function controllerFixture() {
  const created = [];
  const ids = ['commandCenterCapacityState', 'commandCenterCapacityAsOf', 'commandCenterCapacityNotice',
    'commandCenterCapacityAssessmentTitle', 'commandCenterCapacityContext',
    'commandCenterCapacityNextTitle', 'commandCenterCapacityNextExplanation',
    'commandCenterCapacityPrimaryAction', 'commandCenterCapacityDetails', 'commandCenterCapacityReviewDetails',
    'commandCenterCapacityChecksDetails', 'commandCenterCapacitySignalsDetails',
    'commandCenterCapacityRecordControls', 'commandCenterCapacityReviewReasonGroup',
    'commandCenterCapacitySetupReasonSlot', 'commandCenterCapacitySignalReasonSlot',
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
  return { values, lanes, decisions, created, document: {
    getElementById: id => values[id] || null,
    createElement: tag => { const element = new Element(); element.tagName = tag; created.push(element); return element; },
    querySelectorAll: selector => selectors[selector] || [],
  } };
}

test('v3 mounted controller fixture satisfies the current capacity UI contract', () => {
  const ui = controllerFixture();
  const controller = capacity.create({ mode: 'paid', document: ui.document,
    idempotency: () => 'm26-part5d-v3-fixture-contract',
    fetcher: async () => { throw new Error('Fixture contract check must not request data'); } });
  expect(controller.inspect().journey).toBeNull();
  expect(ui.values.commandCenterCapacityPrimaryAction.getAttribute('aria-controls')).toBeNull();
});

realPostgres('Mission 26 Part 5D correction v7 mounted complete operator-combination positive-work journey', () => {
  let fixture; let app; let logicalNow; let ui; let controller; let controllerReady = false;
  let positiveWork; let secondPositiveWork; let mountedCrew; let mountedSkill;
  let mountedVehicle; let mountedEquipment;
  let stressOperators = [];
  let offeredScopeReview; let submittedScopeChoice;
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
      facts: [{ variable: 'serviceLocation', normalizedValue: 'site-one',
        evidenceText: 'this bounded synthetic installed-source service visit', speaker: 'customer',
        evidenceTurnId: 'scope', confidence: 1 }],
      service: { key: 'plumbing', scope: { locationId: 'site-one',
        address: '1 Mounted Evidence Way, Boston, MA 02108',
        sourcePurpose: 'm26-part5d-v4-mounted-positive-evidence' } },
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
          target: { kind: 'crew', id: mountedCrew.id },
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

  async function saveConstraintBases(work, { contradictoryTravel = false } = {}) {
    const estimate = (await fixture.ownerPool.query(
      'SELECT id FROM canonical_estimates WHERE organization_id=$1 AND opportunity_id=$2',
      [fixture.org, work.opportunity])).rows[0];
    expect(estimate).toBeTruthy();
    const route = `/api/v1/canonical/estimates/${estimate.id}`;
    const read = async () => {
      const response = await request(fixture.app).get(`${route}/review`).set(actor('owner').session.headers);
      expect(response.status).toBe(200); return response.body.data;
    };
    const send = (path, body) => request(fixture.app).post(route + path)
      .set(actor('owner').session.headers).set('Idempotency-Key', uuid()).send(body);
    let review = await read();
    const equipment = require('../helpers/m24-equipment-input');
    const identityFields = require('../../src/estimating/equipmentPlanContract').IDENTITY;
    const sourceAsset = asset => {
      const source = review.equipmentPlans.sources.assets.find(value => value.id === asset.id);
      expect(source).toBeTruthy();
      return source;
    };
    const exactIdentity = source => Object.fromEntries(identityFields.map(key => [key,
      source.privateConfiguration ? (source.privateConfiguration[key] ?? null) :
        key === 'manufacturer' ? source.manufacturer : key === 'model' ? source.model :
          key === 'modelYear' && source.modelYear !== null ? String(source.modelYear) : null]));
    const vehicleSource = sourceAsset(mountedVehicle);
    const equipmentSource = sourceAsset(mountedEquipment);
    const equipmentInputs = equipment.inputs([
      equipment.line({ task: 'Transport the accepted service visit', assetId: mountedVehicle.id,
        identity: exactIdentity(vehicleSource), accessBasis: 'owned',
        ownerReview: 'Owner reviewed the exact active service vehicle source.' }),
      equipment.line({ task: 'Complete the accepted repair scope', assetId: mountedEquipment.id,
        identity: exactIdentity(equipmentSource), accessBasis: 'owned',
        ownerReview: 'Owner reviewed the exact active service equipment source.' }),
    ]);
    equipmentInputs.serviceKey = review.equipmentPlans.sources.serviceKey;
    const equipmentBody = { action: 'save', expectedRevision: review.equipmentPlans.current?.revision || 0,
      expectedDigest: review.equipmentPlans.current?.digest || 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: equipmentInputs,
      currency: review.currency, reason: 'Review the exact active vehicle and equipment for capacity research.',
      confirmed: true, confirmationVersion: 'estimate-equipment-plan-v1' };
    let response = await send('/equipment-plan-preview', equipmentBody);
    if (response.status !== 200) throw new Error(
      `Mounted equipment preview failed: ${JSON.stringify({ status: response.status, body: response.body,
        sourceAssets: review.equipmentPlans.sources.assets })}`);
    equipmentBody.inputs.assessment = { ...response.body.data.assessment, acknowledged: true };
    response = await send('/equipment-plans', equipmentBody);
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });

    review = await read();
    const readinessBody = require('../helpers/m24-readiness-input').body(review);
    response = await send('/equipment-readiness-preview', readinessBody);
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 200 });
    readinessBody.inputs.assessment = { ...response.body.data.assessment, acknowledged: true };
    response = await send('/equipment-readiness-plans', readinessBody);
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });

    review = await read();
    const travel = require('../helpers/m24-travel-input');
    const travelInputs = travel.fixture();
    travelInputs.serviceKey = review.travelPlans.serviceKey;
    const origin = review.travelPlans.sources.locations.find(value =>
      value.kind === 'business_location' && value.sourceId === 'headquarters');
    const destination = review.travelPlans.sources.locations.find(value =>
      value.kind === 'recorded_job' && value.sourceId === estimate.id);
    if (!origin || !destination) throw new Error(
      `Mounted travel locations unavailable: ${JSON.stringify(review.travelPlans.sources.locations)}`);
    travelInputs.trips[0].origin = contradictoryTravel ?
      travel.location('A declared route that contradicts the accepted formation home') : structuredClone(origin);
    travelInputs.trips[0].destination = structuredClone(destination);
    travelInputs.trips[0].vehicles = 1; travelInputs.trips[0].people = 2;
    const travelBody = { action: 'save', expectedRevision: review.travelPlans.current?.revision || 0,
      expectedDigest: review.travelPlans.current?.digest || 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: travelInputs,
      currency: review.currency, reason: contradictoryTravel ?
        'Record the guarded but contradictory declared route for fail-closed proof.' :
        'Review the exact business-location to recorded-job route for capacity research.',
      confirmed: true, confirmationVersion: 'estimate-travel-plan-v1' };
    response = await send('/travel-plan-preview', travelBody);
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 200 });
    travelBody.inputs.assessment = { ...response.body.data.assessment, acknowledged: true,
      explanation: 'Owner reviewed the bounded internal route basis; provider routing is unavailable.' };
    response = await send('/travel-plans', travelBody);
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
    return read();
  }

  async function createStressOperator(operationalRole, index) {
    const userId = uuid(); const name = `stressOperator${index}`;
    await fixture.ownerPool.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,$3,$4,'unused','member','active')",
      [userId, fixture.org, `Bounded ${operationalRole} operator`, `${userId}@example.test`]);
    const session = await provisionDurableSession(fixture.ownerPool, {
      organizationId: fixture.org, userId, membershipId: userId, role: 'member',
    });
    fixture.actors[name] = { organizationId: fixture.org, actorUserId: userId,
      actorAccessRole: 'member', authSessionId: session.sessionId, csrfToken: session.csrfToken, session };
    let response = await request(fixture.app).get('/api/work-profiles/me').set(session.headers);
    expect(response.status).toBe(200);
    response = await request(fixture.app).post('/api/work-profiles/me')
      .set(session.headers).set('Idempotency-Key', uuid()).send({
        action: 'submit', expectedRevision: response.body.data.profile.revision,
        profile: { title: 'Bounded asset operator', summary: 'Mounted bounded population source authority.',
          skills: ['Fixture repair'], certifications: [{ id: 'safety', name: 'Safety training',
            issuer: 'Example Training', expiresOn: '2099-09-09', documentReference: 'P5D-BOUND' }] },
      });
    expect(response.status).toBe(200);
    response = await request(fixture.app).get('/api/work-profiles/me').set(session.headers);
    expect(response.status).toBe(200);
    response = await request(fixture.app).post(`/api/work-profiles/reviews/${userId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', uuid()).send({
        action: 'approve', expectedRevision: response.body.data.profile.revision,
        reason: 'Owner explicitly reviewed this bounded operator source.', verifiedCertificationIds: ['safety'],
      });
    expect(response.status).toBe(200);
    response = await request(fixture.app).put(`/api/workforce/profiles/${userId}`)
      .set(actor('owner').session.headers).send({ operationalRole,
        homeLocationId: 'headquarters', skillIds: [mountedSkill.id] });
    expect(response.status).toBe(200);
    const availabilityStart = new Date('2029-12-31T00:00:00.000Z');
    const intervals = Array.from({ length: 12 }, (_, offset) => ({ kind: 'available',
      start: new Date(availabilityStart.getTime() + offset * 30 * 86400000).toISOString(),
      end: new Date(availabilityStart.getTime() + (offset + 1) * 30 * 86400000).toISOString() }));
    response = await request(fixture.app).put(`/api/v1/canonical/availability/profiles/${userId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5d-v7-bound-${uuid()}`)
      .send({ expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: availabilityStart.toISOString(),
        coverageEnd: new Date(availabilityStart.getTime() + 365 * 86400000).toISOString(), intervals,
        reason: 'Owner declared current bounded availability for the response-limit proof.' });
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 200 });
    return { userId, operationalRole };
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const secondTechnicianId = uuid();
    await fixture.ownerPool.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,$3,$4,'unused','member','active')",
      [secondTechnicianId, fixture.org, 'Synthetic second technician', `${secondTechnicianId}@example.test`]);
    const secondTechnicianSession = await provisionDurableSession(fixture.ownerPool, {
      organizationId: fixture.org, userId: secondTechnicianId,
      membershipId: secondTechnicianId, role: 'member',
    });
    fixture.actors.secondTechnician = {
      organizationId: fixture.org, actorUserId: secondTechnicianId, actorAccessRole: 'member',
      authSessionId: secondTechnicianSession.sessionId, csrfToken: secondTechnicianSession.csrfToken,
      session: secondTechnicianSession,
    };
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
    for (const name of ['dispatcher', 'member', 'secondTechnician']) {
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
    let response = await request(fixture.app).post('/api/workforce/skills')
      .set(actor('owner').session.headers).send({ key: 'm26-v4-fixture-repair', name: 'Fixture repair',
        description: 'Mounted source-backed skill declaration.', serviceId: 'plumbing' });
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
    mountedSkill = response.body.data;
    response = await request(fixture.app).put(`/api/workforce/profiles/${actor('member').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'technician',
        homeLocationId: 'headquarters', skillIds: [mountedSkill.id] });
    expect(response.status).toBe(200);
    response = await request(fixture.app).put(`/api/workforce/profiles/${actor('secondTechnician').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'technician',
        homeLocationId: 'headquarters', skillIds: [mountedSkill.id] });
    expect(response.status).toBe(200);
    response = await request(fixture.app).put(`/api/workforce/profiles/${actor('dispatcher').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'dispatcher',
        homeLocationId: 'headquarters', skillIds: [mountedSkill.id] });
    expect(response.status).toBe(200);
    response = await request(fixture.app).post('/api/workforce/crews')
      .set(actor('owner').session.headers).send({ key: 'm26-v4-mixed-crew',
        name: 'Mounted mixed-role crew', homeLocationId: 'headquarters', members: [
          { profileId: actor('member').actorUserId, role: 'lead' },
          { profileId: actor('secondTechnician').actorUserId, role: 'member' },
          { profileId: actor('dispatcher').actorUserId, role: 'member' },
        ] });
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
    mountedCrew = response.body.data;
    const assetBody = (category, name, reference) => ({ category, name, internalReference: reference,
      manufacturer: 'Example', model: `${category}-one`, modelYear: 2026,
      configuration: 'Mounted source-owned configuration', serialNumber: `${reference}-SERIAL`, vin: null,
      homeLocationId: 'headquarters', serviceIds: ['plumbing'] });
    response = await request(fixture.app).post('/api/assets').set(actor('owner').session.headers)
      .send(assetBody('vehicle', 'Mounted fixture van', 'P5D-V4-VAN'));
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
    mountedVehicle = response.body.data;
    response = await request(fixture.app).post('/api/assets').set(actor('owner').session.headers)
      .send(assetBody('equipment', 'Mounted fixture machine', 'P5D-V4-MACHINE'));
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
    mountedEquipment = response.body.data;
    for (const asset of [mountedVehicle, mountedEquipment]) {
      if (asset.catalogueState !== 'active') {
        const activated = await request(fixture.app).patch(`/api/assets/${asset.id}/catalogue-state`)
          .set(actor('owner').session.headers).send({ version: asset.version, catalogueState: 'active' });
        expect({ status: activated.status, body: activated.body }).toMatchObject({ status: 200 });
      }
    }
    const availabilityStart = new Date('2029-12-31T00:00:00.000Z');
    const availabilityIntervals = Array.from({ length: 12 }, (_, index) => ({
      kind: 'available',
      start: new Date(availabilityStart.getTime() + index * 30 * 86400000).toISOString(),
      end: new Date(availabilityStart.getTime() + (index + 1) * 30 * 86400000).toISOString(),
    }));
    for (const name of ['member', 'secondTechnician', 'dispatcher']) {
      const actorIntervals = name === 'dispatcher' ? availabilityIntervals : availabilityIntervals.map(
        (interval, index) => index === 1 ? { ...interval, start: '2030-02-15T00:00:00.000Z' } : interval);
      response = await request(fixture.app)
        .put(`/api/v1/canonical/availability/profiles/${actor(name).actorUserId}`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5d-v4-availability-${uuid()}`)
        .send({ expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
          coverageStart: availabilityStart.toISOString(),
          coverageEnd: new Date(availabilityStart.getTime() + 365 * 86400000).toISOString(),
          intervals: actorIntervals,
          reason: 'Owner declared bounded future availability for the mounted positive-work proof.' });
      expect({ status: response.status, body: response.body }).toMatchObject({ status: 200 });
    }
    for (const [index, role] of ['owner', 'administrator', 'estimator', 'crew_lead'].entries()) {
      stressOperators.push(await createStressOperator(role, index));
    }
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
  }, 240000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function journey() {
    if (!controllerReady) {
      controllerReady = true;
      await controller.workspaceReady('paid:mounted-tenant:revision:digest:session:generation:expiry');
    } else await controller.refresh();
    const value = controller.inspect().journey;
    if (!value) {
      const raw = (await fixture.ownerPool.query(
        'SELECT public.canonical_forecast_capacity_ui_v7_current($1,$2,$3,$4) value',
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
    if (current.setup.action === 'constrained_work_scopes') {
      expect(current.setup.scopeReviews).toHaveLength(1);
      offeredScopeReview = structuredClone(current.setup.scopeReviews[0]);
      ui.values.commandCenterCapacityReviewReason.value = 'Review the exact target role before approval.';
      ui.values.commandCenterCapacityReviewReason.listeners.input();
      expect(ui.values.commandCenterCapacitySetupAction.disabled).toBe(true);
      const target = ui.created.filter(element =>
        element.tagName === 'select' && element.id === 'commandCenterCapacityTargetRole0').at(-1);
      expect(target).toBeTruthy(); target.value = 'dispatcher'; target.listeners.change();
      const combinationRadios = ui.created.filter(element => element.type === 'radio' &&
        element.name === 'commandCenterCapacityOperatorCombination0');
      expect(combinationRadios).toHaveLength(2);
      combinationRadios[1].checked = true; combinationRadios[1].listeners.change();
    }
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
    if (current.setup.action === 'constrained_work_scopes') {
      submittedScopeChoice = structuredClone(JSON.parse(call.body).scopeReviews[0]);
    }
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
      let directError = null;
      let advisoryDebug = null;
      if (call && call.body) {
        const failedBody = JSON.parse(call.body);
        const client = await fixture.runtimePool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          await client.query(
            'SELECT public.canonical_forecast_capacity_ui_v7_action_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
            [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
              actor('owner').authSessionId, actor('owner').csrfToken, call.idempotencyKey,
              failedBody.action, failedBody.originId, failedBody.outcomeId, failedBody.correctionOriginId,
              failedBody.expectedRevision, failedBody.reason, failedBody.confirmationVersion]);
        } catch (error) { directError = { code: error.code, message: error.message, where: error.where }; }
        finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      }
      if (action === 'advisory_capture_origin') {
        advisoryDebug = (await fixture.ownerPool.query(
          `WITH inputs AS (SELECT public.canonical_forecast_constrained_capacity_v1_complete_input($1,$2) c,
             public.canonical_forecast_workload_capacity_v1_backlog_evidence($1,$2) b)
           SELECT alternative,
            public.canonical_forecast_capacity_ui_v3_demand_definition($1,alternative,c,'demand',NULL,b->'rows') definition,
            public.canonical_forecast_capacity_advisory_v1_demand_valid(
             public.canonical_forecast_capacity_ui_v3_demand_definition($1,alternative,c,'demand',NULL,b->'rows'),'demand') valid
           FROM inputs,jsonb_array_elements_text(c->'alternatives') alternative`,
          [fixture.org, logicalNow])).rows;
      }
      const constrainedDebug = action === 'constrained_capture_origin' ? (await fixture.ownerPool.query(
        `SELECT scope_key,definition,
          public.canonical_forecast_workload_capacity_v1_capacity_calculation(
            organization_id,$1::timestamptz,$1::timestamptz+interval '30 days',
            $1::timestamptz,definition->>'role') calculation
         FROM public.canonical_forecast_constrained_capacity_reviews_v1
         WHERE organization_id=$2 AND review_kind='scope' AND action='approve'
         ORDER BY decided_at DESC`, [logicalNow, fixture.org])).rows : null;
      throw new Error(`${action} failed through mounted controller: ${JSON.stringify({ call, current, directError, advisoryDebug,
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

    const beforeMethod = await runSetupUntilAction('constrained_method');
    expect(beforeMethod.actions).toEqual(['workload_epoch', 'workload_methods', 'workload_roles',
      'workload_role_scope', 'workload_remaining_census', 'constrained_epoch']);
    await setupNext(3, 'constrained_method');
    let unavailable = await journey();
    expect(unavailable.setup.state).toBe('unavailable');
    expect(unavailable.setup.scopeReviews).toEqual([]);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('scope','job')`, [fixture.org])).rows[0].count)).toBe(0);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('demand','outcome_demand')`, [fixture.org])).rows[0].count)).toBe(0);

    await saveConstraintBases(secondPositiveWork);
    await saveConstraintBases(positiveWork, { contradictoryTravel: true });
    unavailable = await journey();
    expect(unavailable.setup.state).toBe('unavailable');
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('scope','job')`, [fixture.org])).rows[0].count)).toBe(0);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('demand','outcome_demand')`, [fixture.org])).rows[0].count)).toBe(0);
    await saveConstraintBases(positiveWork);

    const beforeScopes = await runSetupUntilAction('constrained_work_scopes');
    expect(beforeScopes.actions).toEqual([]);
    expect(beforeScopes.current.setup.scopeReviews).toHaveLength(1);
    expect(beforeScopes.current.setup.scopeReviews[0]).toMatchObject({
      formation: 'crew', dimensions: { crew: 'applies', skill: 'applies', workingHours: 'applies',
        location: 'applies', travel: 'applies', vehicle: 'applies', equipment: 'applies' },
      targetRole: 'technician', supportRoles: ['dispatcher'], operatorRoles: [],
      targetRoleOptions: ['dispatcher', 'technician'],
      selectableTargetRoles: ['dispatcher'],
      operatorRoleCombinations: [
        { targetRole: 'dispatcher', operatorRoles: ['technician'] },
        { targetRole: 'dispatcher', operatorRoles: ['dispatcher', 'technician'] },
      ],
      sourceState: 'source_backed',
      reviewState: 'needs_review' });
    expect(beforeScopes.current.setup.scopeReviews[0].operatorRoleCombinations).not.toContainEqual(
      { targetRole: 'dispatcher', operatorRoles: ['dispatcher'] });
    expect(JSON.stringify(beforeScopes.current.setup.scopeReviews)).not.toMatch(
      /profileId|crewId|assetId|appointmentId|assignmentId|memberId|jobId|digest|Minutes/i);
    const invalidScopeBody = { action: 'constrained_work_scopes', token: beforeScopes.current.setup.token,
      hiringConsecutivePeriods: 3, scopeReviews: [{ scopeKey: beforeScopes.current.setup.scopeReviews[0].scopeKey,
        targetRole: 'owner', operatorRoles: ['technician'] }],
      reason: 'Refuse a caller role classification outside the exact server-derived choices.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2' };
    const invalidScope = await post('/journey/setup', invalidScopeBody, `m26-p5d-v4-invalid-scope-${uuid()}`);
    expect([400, 409]).toContain(invalidScope.status);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('scope','job')`, [fixture.org])).rows[0].count)).toBe(0);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('demand','outcome_demand')`, [fixture.org])).rows[0].count)).toBe(0);
    const beforeInfeasible = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_forecast_workload_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('role_qualification','availability_basis')) workload_children,
      (SELECT count(*)::int FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('scope','job')) constraint_children,
      (SELECT count(*)::int FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('demand','outcome_demand')) advisory_children`,
    [fixture.org])).rows[0];
    const infeasibleScopeBody = { action: 'constrained_work_scopes', token: beforeScopes.current.setup.token,
      hiringConsecutivePeriods: 3, scopeReviews: [{ scopeKey: beforeScopes.current.setup.scopeReviews[0].scopeKey,
        targetRole: 'dispatcher', operatorRoles: ['dispatcher'] }],
      reason: 'Refuse an operator role combination that cannot assign distinct people to every required asset.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2' };
    const infeasibleScope = await post('/journey/setup', infeasibleScopeBody,
      `m26-p5d-v6-infeasible-operator-${uuid()}`);
    expect([400, 409]).toContain(infeasibleScope.status);
    const afterInfeasible = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_forecast_workload_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('role_qualification','availability_basis')) workload_children,
      (SELECT count(*)::int FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('scope','job')) constraint_children,
      (SELECT count(*)::int FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1 AND review_kind IN('demand','outcome_demand')) advisory_children`,
    [fixture.org])).rows[0];
    expect(afterInfeasible).toEqual(beforeInfeasible);
    expect(afterInfeasible).toMatchObject({ constraint_children: 0, advisory_children: 0 });
    const privateCombination = async operatorRoles => (await fixture.ownerPool.query(
      `SELECT public.canonical_forecast_capacity_ui_v7_scope_plan($1,$2,$3::jsonb) value`,
      [fixture.org, logicalNow, JSON.stringify([{ scopeKey: beforeScopes.current.setup.scopeReviews[0].scopeKey,
        targetRole: 'dispatcher', operatorRoles }])])).rows[0].value;
    const technicianPlan = await privateCombination(['technician']);
    const mixedOperatorPlan = await privateCombination(['dispatcher', 'technician']);
    expect(technicianPlan.state).toBe('ready'); expect(mixedOperatorPlan.state).toBe('ready');
    expect(technicianPlan.entries).toHaveLength(1); expect(mixedOperatorPlan.entries).toHaveLength(1);
    const technicianDefinition = technicianPlan.entries[0].definition;
    const mixedOperatorDefinition = mixedOperatorPlan.entries[0].definition;
    expect(technicianDefinition.operatorProfileIds.slice().sort()).toEqual(
      [actor('member').actorUserId, actor('secondTechnician').actorUserId].sort());
    expect(technicianDefinition.assetAssignments).toHaveLength(4);
    expect(mixedOperatorDefinition.operatorProfileIds.slice().sort()).toEqual(
      [actor('dispatcher').actorUserId, actor('member').actorUserId,
        actor('secondTechnician').actorUserId].sort());
    expect(mixedOperatorDefinition.assetAssignments).toHaveLength(6);
    expect(technicianDefinition.assetCalendars.every(calendar =>
      calendar.availableIntervals.length === 2)).toBe(true);
    expect(mixedOperatorDefinition.assetCalendars.every(calendar =>
      calendar.availableIntervals.length === 1)).toBe(true);
    expect(technicianDefinition.assetCalendars).not.toEqual(mixedOperatorDefinition.assetCalendars);
    for (const definition of [technicianDefinition, mixedOperatorDefinition]) {
      const exact = (await fixture.ownerPool.query(
        `SELECT public.canonical_forecast_constrained_capacity_v1_exact_match(
          $1::jsonb,$2::jsonb,$3::jsonb,NULL) value`,
        [JSON.stringify(definition), JSON.stringify(definition.crewAssignments),
          JSON.stringify(definition.assetAssignments)])).rows[0].value;
      expect(Number(exact.targetSlots)).toBeGreaterThan(0);
      expect(Number(exact.candidateCount)).toBeGreaterThan(0);
    }
    await setupNext(3, 'constrained_work_scopes');
    expect(offeredScopeReview).toEqual(beforeScopes.current.setup.scopeReviews[0]);
    expect(submittedScopeChoice).toMatchObject({ scopeKey: offeredScopeReview.scopeKey,
      targetRole: 'dispatcher', operatorRoles: ['dispatcher', 'technician'] });
    const scopeSetupCall = mountedCalls.find(call => call.method === 'POST' && call.body &&
      JSON.parse(call.body).action === 'constrained_work_scopes');
    const scopeSetupBody = JSON.parse(scopeSetupCall.body);
    let scopeReplay = await post('/journey/setup', scopeSetupBody, scopeSetupCall.idempotencyKey);
    expect(scopeReplay.status).toBe(200); expect(scopeReplay.headers['idempotency-replayed']).toBe('true');
    expect(scopeReplay.body.data).toMatchObject({ action: 'constrained_work_scopes', replayed: true });
    let scopeConflict = await post('/journey/setup', { ...scopeSetupBody,
      scopeReviews: [{ ...scopeSetupBody.scopeReviews[0], operatorRoles: ['dispatcher'] }] },
    scopeSetupCall.idempotencyKey);
    expect(scopeConflict.status).toBe(409);
    scopeConflict = await post('/journey/setup', scopeSetupBody, `m26-p5d-v4-changed-scope-key-${uuid()}`);
    expect(scopeConflict.status).toBe(409);
    const privateScope = (await fixture.ownerPool.query(
      `SELECT definition FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind='scope' AND action='approve'
        ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0].definition;
    expect(privateScope.applicability).toEqual({ crew: true, skill: true, workingHours: true,
      location: true, travel: true, vehicle: true, equipment: true });
    expect(privateScope.role).toBe('dispatcher');
    expect(privateScope.locationKey).toBe('headquarters');
    expect(privateScope.crewIds).toEqual([mountedCrew.id]);
    expect(privateScope.skillIds).toEqual([mountedSkill.id]);
    expect(privateScope.travelPairs).toHaveLength(2);
    expect(privateScope.travelPairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromLocationKey: 'headquarters', toLocationKey: 'site-one', basis: 'estimated' }),
      expect.objectContaining({ fromLocationKey: 'site-one', toLocationKey: 'headquarters', basis: 'estimated' }),
    ]));
    expect(privateScope.vehicleAssetIds).toEqual([mountedVehicle.id]);
    expect(privateScope.equipmentAssetIds).toEqual([mountedEquipment.id]);
    expect(privateScope.crewRoleRequirements).toEqual(expect.arrayContaining([
      { role: 'dispatcher', count: 1 }, { role: 'technician', count: 2 },
    ]));
    expect(privateScope.crewAssignments).toEqual(expect.arrayContaining([
      { profileId: actor('member').actorUserId, crewId: mountedCrew.id, role: 'technician' },
      { profileId: actor('secondTechnician').actorUserId, crewId: mountedCrew.id, role: 'technician' },
      { profileId: actor('dispatcher').actorUserId, crewId: mountedCrew.id, role: 'dispatcher' },
    ]));
    expect(privateScope.operatorProfileIds.slice().sort()).toEqual(
      [actor('dispatcher').actorUserId, actor('member').actorUserId,
        actor('secondTechnician').actorUserId].sort());
    expect(privateScope.assetAssignments).toHaveLength(6);
    for (const [assetId, kind] of [[mountedVehicle.id, 'vehicle'], [mountedEquipment.id, 'equipment']]) {
      const eligibility = privateScope.assetAssignments.filter(value => value.assetId === assetId);
      expect(eligibility.map(value => value.kind)).toEqual([kind, kind, kind]);
      expect(eligibility.map(value => value.operatorProfileId).sort()).toEqual(
        [actor('dispatcher').actorUserId, actor('member').actorUserId,
          actor('secondTechnician').actorUserId].sort());
    }
    expect(privateScope.assetCalendars.map(value => value.assetId).sort()).toEqual(
      [mountedVehicle.id, mountedEquipment.id].sort());
    const exactMatching = (await fixture.ownerPool.query(
      `SELECT public.canonical_forecast_constrained_capacity_v1_exact_match($1::jsonb,$2::jsonb,$3::jsonb,NULL) positive,
        public.canonical_forecast_constrained_capacity_v1_exact_match($1::jsonb,$2::jsonb,$4::jsonb,NULL) unavailable`,
      [privateScope, JSON.stringify(privateScope.crewAssignments), JSON.stringify(privateScope.assetAssignments),
        JSON.stringify(privateScope.assetAssignments.filter(value =>
          value.operatorProfileId === actor('member').actorUserId))])).rows[0];
    expect(Number(exactMatching.positive.targetSlots)).toBeGreaterThan(0);
    expect(Number(exactMatching.positive.candidateCount)).toBeGreaterThan(0);
    expect(exactMatching.unavailable).toMatchObject({ targetSlots: 0, candidateCount: 0 });
    const unavailableStart = new Date('2030-02-01T00:00:00.000Z');
    const unavailableEnd = new Date(unavailableStart.getTime() + 3600000);
    const availableStart = new Date('2030-01-03T00:00:00.000Z');
    const availableEnd = new Date(availableStart.getTime() + 3600000);
    const sourceAvailabilityMatching = (await fixture.ownerPool.query(
      `SELECT public.canonical_forecast_constrained_capacity_v1_scope_segment(
          $1,value,$2,$3,'[]'::jsonb,NULL) unavailable,
        public.canonical_forecast_constrained_capacity_v1_scope_segment(
          $1,value,$4,$5,'[]'::jsonb,NULL) current
       FROM canonical_forecast_constrained_capacity_reviews_v1 value
       WHERE organization_id=$1 AND review_kind='scope' AND action='approve'
       ORDER BY revision DESC LIMIT 1`,
      [fixture.org, unavailableStart, unavailableEnd, availableStart, availableEnd])).rows[0];
    expect(sourceAvailabilityMatching.unavailable).toMatchObject({
      personMinutes: 0, crewSlots: 0, targetSlots: 0,
    });
    expect(Number(sourceAvailabilityMatching.current.targetSlots)).toBeGreaterThan(0);
    expect(Number(sourceAvailabilityMatching.current.crewSlots)).toBeGreaterThan(0);

    const beforeJobs = await runSetupUntilAction('constrained_job_census');
    expect(beforeJobs.actions).toEqual([]);
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
      'SELECT canonical_forecast_capacity_ui_v7_job_plan($1,$2) value',
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
      hiringConsecutivePeriods: 3, scopeReviews: [], reason: 'Prove this complete job census is atomic under a known failure.',
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
    const privateJobs = (await fixture.ownerPool.query(
      `SELECT definition FROM canonical_forecast_constrained_capacity_reviews_v1 value
        WHERE organization_id=$1 AND review_kind='job' AND action='approve'
         AND id=(SELECT latest.id FROM canonical_forecast_constrained_capacity_reviews_v1 latest
          WHERE latest.organization_id=value.organization_id AND latest.review_kind='job'
           AND latest.scope_key=value.scope_key AND latest.subject_id=value.subject_id
          ORDER BY latest.revision DESC LIMIT 1)
        ORDER BY subject_id`, [fixture.org])).rows.map(row => row.definition);
    expect(privateJobs).toHaveLength(2);
    for (const definition of privateJobs) {
      expect(definition).toMatchObject({ alternativeKey: 'accepted_team',
        crewApplicable: true, skillApplicable: true, workingHoursApplicable: true,
        locationApplicable: true, travelApplicable: true, vehicleApplicable: true,
        equipmentApplicable: true, locationKey: 'site-one', previousLocationKey: 'headquarters',
        nextLocationKey: 'headquarters', vehicleAssetIds: [mountedVehicle.id],
        equipmentAssetIds: [mountedEquipment.id],
        equipmentBasis: { kind: 'm24_adopted' }, readinessBasis: { kind: 'm24_adopted' },
        travelBasis: { kind: 'm24_adopted' } });
    }
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

    const expandedMembers = [
      { profileId: actor('member').actorUserId, role: 'lead' },
      { profileId: actor('secondTechnician').actorUserId, role: 'member' },
      { profileId: actor('dispatcher').actorUserId, role: 'member' },
      ...stressOperators.map(value => ({ profileId: value.userId, role: 'member' })),
    ];
    const expanded = await request(fixture.app).put(`/api/workforce/crews/${mountedCrew.id}`)
      .set(actor('owner').session.headers).send({ name: 'Mounted bounded-population crew',
        homeLocationId: 'headquarters', members: expandedMembers });
    expect({ status: expanded.status, body: expanded.body }).toMatchObject({ status: 200 });
    await setClock(new Date(logicalNow.getTime() + 1000));
    let boundedJourney = null;
    for (let index = 0; index < 30; index += 1) {
      boundedJourney = await journey();
      if (boundedJourney.setup.state === 'unavailable') break;
      if (boundedJourney.setup.state === 'waiting') {
        await setClock(new Date(logicalNow.getTime() + 61 * 86400000));
        continue;
      }
      if (boundedJourney.setup.state === 'complete') {
        await setClock(new Date(logicalNow.getTime() + 1000));
        continue;
      }
      expect(boundedJourney.setup.state).toBe('ready');
      expect(boundedJourney.setup.action).not.toBe('constrained_work_scopes');
      await setupNext(4, boundedJourney.setup.action);
      await setClock(new Date(logicalNow.getTime() + 1000));
    }
    expect(boundedJourney.setup).toMatchObject({ state: 'unavailable', action: null,
      label: 'Complete operator role review exceeds safe bound', scopeReviews: [] });
    expect(boundedJourney.setup.explanation).toMatch(/No choices were truncated or advertised/);
    const boundedPlan = (await fixture.ownerPool.query(
      'SELECT public.canonical_forecast_capacity_ui_v7_scope_plan($1,$2,NULL) value',
      [fixture.org, logicalNow])).rows[0].value;
    expect(boundedPlan).toMatchObject({ state: 'unavailable', entries: [], reviews: [],
      marker: { state: 'exact_operator_population_exceeds_bound' } });
    const boundedSource = (await fixture.ownerPool.query(
      `SELECT count(*)::int profile_count,count(DISTINCT profile.operational_role)::int role_count
         FROM workforce_crew_members member
         JOIN workforce_profiles profile ON profile.organization_id=member.organization_id
          AND profile.id=member.profile_id
        WHERE member.organization_id=$1 AND member.crew_id=$2`, [fixture.org, mountedCrew.id])).rows[0];
    expect(boundedSource).toEqual({ profile_count: 7, role_count: 6 });
    const beforeBoundedRefusal = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_forecast_workload_capacity_reviews_v1
        WHERE organization_id=$1) workload_children,
      (SELECT count(*)::int FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1) constraint_children,
      (SELECT count(*)::int FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1) advisory_children,
      (SELECT count(*)::int FROM canonical_forecast_capacity_ui_setup_requests_v2
        WHERE organization_id=$1) setup_receipts`, [fixture.org])).rows[0];
    const boundedRefusal = await post('/journey/setup', {
      action: 'constrained_work_scopes', token: scopeSetupBody.token, hiringConsecutivePeriods: 4,
      scopeReviews: [{ scopeKey: scopeSetupBody.scopeReviews[0].scopeKey,
        targetRole: 'dispatcher', operatorRoles: ['dispatcher', 'technician'] }],
      reason: 'Refuse an over-bound complete population without truncation or partial children.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-setup-v2',
    }, `m26-p5d-v7-over-bound-${uuid()}`);
    expect([400, 409]).toContain(boundedRefusal.status);
    const afterBoundedRefusal = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_forecast_workload_capacity_reviews_v1
        WHERE organization_id=$1) workload_children,
      (SELECT count(*)::int FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1) constraint_children,
      (SELECT count(*)::int FROM canonical_forecast_capacity_advisory_reviews_v1
        WHERE organization_id=$1) advisory_children,
      (SELECT count(*)::int FROM canonical_forecast_capacity_ui_setup_requests_v2
        WHERE organization_id=$1) setup_receipts`, [fixture.org])).rows[0];
    expect(afterBoundedRefusal).toEqual(beforeBoundedRefusal);
    expect(controller.inspect()).toMatchObject({ identity:
      'paid:mounted-tenant:revision:digest:session:generation:expiry', uncertainAttempt: null, busy: false });
  }, 600000);
});
