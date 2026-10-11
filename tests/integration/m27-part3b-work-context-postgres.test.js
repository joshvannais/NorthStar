'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');
const { issueEditableEstimateGrant } =
  require('../../src/customerFinancial/estimateCapabilityGrantIssuer');
const operations = require('../../src/operations/repository');
const operationContracts = require('../../src/operations/contract');
const workContextRepository = require('../../src/customerFinancial/billableWorkContextRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const priceRoot = '/api/v1/forecast/price-history';

realPostgres('Mission 27 Part 3B current completed-work context', () => {
  let f; let actor; let estimate; let appointment; let firstReviewId; let context;
  let approvedCompletion; let laborInterval; let materialMovement; let businessProfile; let route;

  beforeAll(async () => {
    for (const key of ['OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY',
      'STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('Provider transport forbidden');
    });
    f = await createEstimateReviewFixture({ additionalCompleteEstimates: 1,
      operationalSchedule: true, proposalScope: { locationId: 'headquarters' } });
    actor = f.actors.owner; estimate = f.estimateGraphs[0].ids.estimate;
    appointment = f.estimateGraphs[0].ids.appointment;
    const profileRow = (await f.ownerPool.query(`SELECT id,version_number,
      rtrim(normalized_profile_hash) profile_hash,raw_profile#>>'{company,timeZone}' time_zone
      FROM canonical_business_profiles WHERE organization_id=$1 AND is_active`, [f.org])).rows[0];
    businessProfile = { businessProfileId: profileRow.id,
      version: Number(profileRow.version_number), hash: profileRow.profile_hash,
      timeZone: profileRow.time_zone };
    route = `/api/v1/customer-financial/editable-estimates/${estimate}/work-context`;
    await prepareWorkforceAuthority();
    firstReviewId = await createCurrentCommercialLineage();
    await assignDispatchAndCorrectBooking();
    await issueEditableEstimateGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate);
    context = await createAndCompleteExecution();
    await prepareMission27Handoff();
  }, 180000);
  afterAll(async () => {
    try { if (f) await f.cleanup(); } finally { jest.restoreAllMocks(); }
  }, 180000);

  async function createCurrentCommercialLineage() {
    const estimateRoute = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(estimateRoute + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(estimateRoute + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);
    expect((await request(f.app).post(`${priceRoot}/ordered-snapshots`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({})).status).toBe(201);
    expect((await request(f.app).post(`${priceRoot}/ordered-anchor/activate`)
      .set(actor.session.headers).send({})).status).toBe(200);
    let review = (await get('/review')).body.data;
    expect((await post('/pricing-plans', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(review.pricingPlans.serviceKey), currency: review.currency,
      reason: 'Synthetic Part 3B pricing source', confirmed: true,
      confirmationVersion: review.pricingPlans.contract,
      evidenceDigest: review.pricingPlans.sources.digest })).status).toBe(201);
    review = (await get('/review')).body.data;
    const terms = review.commercialTerms; const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = { serviceOperation: 'fence_installation', propertyUse: 'residential',
      workContext: 'new_construction', customerExemption: 'none',
      evidenceRef: { serviceOperation: 'Reviewed scope', propertyUse: 'Recorded property',
        workContext: 'Reviewed scope', customerExemption: 'Customer statement' } };
    inputs.transactionDate = terms.sources.asOfDate; inputs.taxGroups = [group(['installation'])];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, { legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn,
      legalEndsOn: null, reviewedOn: terms.sources.asOfDate,
      reviewValidThrough: terms.sources.asOfDate });
    delete inputs.taxGroups[0].source.effectiveOn; delete inputs.taxGroups[0].source.endsOn;
    expect((await post('/commercial-terms', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs, currency: review.currency,
      reason: 'Synthetic Part 3B current commercial terms', confirmed: true,
      confirmationVersion: terms.contract, evidenceDigest: terms.sources.digest })).status).toBe(201);
    review = (await get('/review')).body.data;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(review.commercialTerms.current),
      evidenceDigest: review.commercialTerms.sources.digest,
      expectedDecisionRevision: review.commercialTerms.decisionBasis.revision,
      expectedDecisionDigest: review.commercialTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
      reason: 'Synthetic Part 3B approved commercial scope', confirmed: true,
      confirmationVersion: review.commercialTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true } })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Synthetic Part 3B issued customer estimate', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1' });
    expect(issued.status).toBe(201);
    const link = await post('/customer-estimate-links', { versionId: issued.body.data.receipt.id,
      expiresInDays: 14, confirmed: true,
      confirmationVersion: 'customer-estimate-delivery-v1' });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    expect((await request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID()).send({ customerName: 'Taylor Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);
    const approval = await scheduleAction('schedule', { kind: 'unassigned', id: null });
    const booking = await request(f.app).post('/api/v1/forecast/booking-reviews/first')
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        approvalId: approval, reason: 'Human reviewed the Part 3B accepted scheduled work.' });
    expect(booking.status).toBe(201); return booking.body.data.reviewId;
  }

  async function prepareWorkforceAuthority() {
    const skill = await request(f.app).post('/api/workforce/skills')
      .set(actor.session.headers).send({ key: 'fence', name: 'Fence installation',
        description: 'Synthetic accepted fence scheduling skill.', serviceId: 'fence' });
    expect(skill.status).toBe(201);
    const ownerProfile = await request(f.app)
      .put(`/api/workforce/profiles/${f.actors.owner.actorUserId}`)
      .set(actor.session.headers).send({ operationalRole: 'owner',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] });
    expect(ownerProfile.status).toBe(200);
    const profile = await request(f.app)
      .put(`/api/workforce/profiles/${f.actors.member.actorUserId}`)
      .set(actor.session.headers).send({ operationalRole: 'technician',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] });
    expect(profile.status).toBe(200);
    const availability = await request(f.app)
      .put(`/api/v1/canonical/availability/profiles/${f.actors.member.actorUserId}`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: '2029-06-01T00:00:00.000Z', coverageEnd: '2029-07-01T00:00:00.000Z',
        intervals: [{ kind: 'available', start: '2029-06-01T00:00:00.000Z',
          end: '2029-07-01T00:00:00.000Z' }],
        reason: 'Owner reviewed synthetic Part 3B worker availability.' });
    expect(availability.status).toBe(200);
  }

  async function scheduleAction(action, target) {
    const before = (await f.ownerPool.query(
      'SELECT revision,rtrim(canonical_digest) digest,appointment_status,scheduled_start,scheduled_end FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    const scheduledStart = before.scheduled_start ? new Date(before.scheduled_start).toISOString() :
      '2029-06-12T13:00:00.000Z';
    const scheduledEnd = before.scheduled_end ? new Date(before.scheduled_end).toISOString() :
      '2029-06-12T14:00:00.000Z';
    const preview = await request(f.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action, target,
        scheduledStart, scheduledEnd,
        appointmentStatus: before.appointment_status,
        reason: `Part 3B synthetic ${action} review` });
    expect(preview.status).toBe(201);
    const saved = await request(f.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason: `Part 3B synthetic ${action} review` });
    expect(saved.status).toBe(200);
    return (await f.ownerPool.query(
      'SELECT id FROM canonical_schedule_human_approvals WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC,id DESC LIMIT 1',
      [f.org, appointment])).rows[0].id;
  }

  async function assignDispatchAndCorrectBooking() {
    await scheduleAction('assign', { kind: 'profile', id: f.actors.member.actorUserId });
    const approvalId = await scheduleAction('dispatch', {
      kind: 'profile', id: f.actors.member.actorUserId });
    const correction = await request(f.app)
      .post(`/api/v1/forecast/booking-reviews/${firstReviewId}/correct`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        approvalId, reason: 'Human reviewed the assigned and dispatched Part 3B work.' });
    expect(correction.status).toBe(201);
  }

  async function createAndCompleteExecution() {
    const assignment = (await f.ownerPool.query(
      'SELECT id,revision,rtrim(canonical_digest) digest FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    let execution = (await operations.initializeFieldExecution(f.runtimePool, { ...actor,
      appointmentId: appointment, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, idempotencyKey: crypto.randomUUID(),
      reason: 'Initialize synthetic Part 3B work', requestCorrelationId: 'm27-p3b-init' })).body.data;
    execution = (await operations.transitionFieldExecution(f.runtimePool, { ...actor,
      executionId: execution.id, expectedRevision: execution.revision,
      expectedDigest: execution.digest, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, action: 'start',
      idempotencyKey: crypto.randomUUID(), reason: 'Start synthetic Part 3B work',
      requestCorrelationId: 'm27-p3b-start' })).body.data;
    const value = { actor, assignment: { ...assignment, revision: Number(assignment.revision) },
      execution };
    const member = f.actors.member; const profile = businessProfile;
    const base = `/api/v1/field-executions/${execution.id}`;
    const sourcePins = { expectedExecutionRevision: execution.revision,
      expectedExecutionDigest: execution.digest,
      expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest,
      performerProfileId: member.actorUserId };
    const labor = await request(f.app).post(`${base}/labor-actions`)
      .set(member.session.headers).set('X-CSRF-Token', member.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ ...sourcePins,
        action: 'record_manual', category: 'production',
        categoryContractVersion: operationContracts.LABOR_CATEGORY_CONTRACT_VERSION,
        categoryContractDigest: operationContracts.LABOR_CATEGORY_CONTRACT_DIGEST,
        businessProfileId: profile.businessProfileId,
        businessProfileVersion: profile.version, businessProfileHash: profile.hash,
        timeZone: profile.timeZone,
        observedStart: new Date(Date.now() - 3600000).toISOString(),
        observedEnd: new Date(Date.now() - 1800000).toISOString(),
        reason: 'Synthetic Part 3B source labor' });
    expect(labor.status).toBe(200); laborInterval = labor.body.data;
    const laborReview = await request(f.app).post(`${base}/labor-actions`)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ ...sourcePins,
        action: 'review', categoryContractVersion: operationContracts.LABOR_CATEGORY_CONTRACT_VERSION,
        categoryContractDigest: operationContracts.LABOR_CATEGORY_CONTRACT_DIGEST,
        businessProfileId: profile.businessProfileId,
        businessProfileVersion: profile.version, businessProfileHash: profile.hash,
        timeZone: profile.timeZone, intervalId: laborInterval.id,
        expectedIntervalRevision: laborInterval.revision,
        expectedIntervalDigest: laborInterval.digest, reviewOutcome: 'accepted',
        reason: 'Owner accepts synthetic Part 3B source labor' });
    expect(laborReview.status).toBe(200); laborInterval = laborReview.body.data;
    const material = await operations.mutateMaterialInventory(f.ownerPool, {
      ...actor, organizationId: f.org, executionId: execution.id, csrfToken: actor.csrfToken,
      idempotencyKey: crypto.randomUUID(), requestCorrelationId: `m27-p3b-material-${crypto.randomUUID()}`,
      ...sourcePins,
        action: 'record', movementKind: 'adjustment', itemKey: 'fence-board',
        description: 'Synthetic Part 3B source material', quantity: '2', unitCode: 'ea',
        unitContractVersion: operationContracts.MATERIAL_UNIT_CONTRACT_VERSION,
        unitContractDigest: operationContracts.MATERIAL_UNIT_CONTRACT_DIGEST,
        locationKey: 'van-01',
        adjustmentDirection: 'increase', reason: 'Synthetic Part 3B source material' });
    expect(material.status).toBe(200); materialMovement = material.body.data.material;
    const materialReview = await operations.mutateMaterialInventory(f.ownerPool, {
      ...actor, organizationId: f.org, executionId: execution.id, csrfToken: actor.csrfToken,
      idempotencyKey: crypto.randomUUID(),
      requestCorrelationId: `m27-p3b-material-review-${crypto.randomUUID()}`, ...sourcePins,
      action: 'review', performerProfileId: member.actorUserId,
      unitContractVersion: operationContracts.MATERIAL_UNIT_CONTRACT_VERSION,
      unitContractDigest: operationContracts.MATERIAL_UNIT_CONTRACT_DIGEST,
      movementId: materialMovement.id, expectedMovementRevision: materialMovement.revision,
      expectedMovementDigest: materialMovement.digest, reviewOutcome: 'accepted',
      reason: 'Owner accepts synthetic Part 3B source material' });
    expect(materialReview.status).toBe(200);
    materialMovement = materialReview.body.data.material;
    const proposed = await f.completion(value);
    const proposal = proposed.body.completionRecord;
    const approved = await f.completion(value, 'approve_completion', { proposal: {
      id: proposal.id, revision: proposal.revision, digest: proposal.digest } });
    approvedCompletion = approved.body.completionRecord;
    return value;
  }

  async function prepareMission27Handoff() {
    const source = await request(f.app)
      .get(`/api/v1/field-executions/${context.execution.id}/handoffs`)
      .set(actor.session.headers);
    expect(source.status).toBe(200);
    const prepared = await request(f.app)
      .post(`/api/v1/field-executions/${context.execution.id}/handoff-actions`)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ action: 'prepare', mission: 27,
        audience: 'tenant_owner_admin_review',
        consentVersion: 'm23-internal-reference-consent-v1', consentConfirmed: true,
        sourceDigest: source.body.data.sourceDigest, targetId: null });
    expect(prepared.status).toBe(201);
  }

  function sourcePins() {
    return { expectedExecutionRevision: context.execution.revision,
      expectedExecutionDigest: context.execution.digest,
      expectedAssignmentRevision: Number(context.assignment.revision),
      expectedAssignmentDigest: context.assignment.digest,
      performerProfileId: f.actors.member.actorUserId };
  }

  function mountedWriter(kind) {
    const member = f.actors.member; const base = `/api/v1/field-executions/${context.execution.id}`;
    let path; let body;
    if (kind === 'fieldEvidence') {
      path = `${base}/field-evidence-actions`; body = { ...sourcePins(), action: 'record_note',
        note: `Concurrent source note ${crypto.randomUUID()}.`, caption: null,
        reason: 'Actual authorized Part 3B field writer' };
    } else if (kind === 'labor') {
      const profile = businessProfile; path = `${base}/labor-actions`;
      body = { ...sourcePins(), action: 'correct', category: 'production',
        categoryContractVersion: operationContracts.LABOR_CATEGORY_CONTRACT_VERSION,
        categoryContractDigest: operationContracts.LABOR_CATEGORY_CONTRACT_DIGEST,
        businessProfileId: profile.businessProfileId,
        businessProfileVersion: profile.version, businessProfileHash: profile.hash,
        timeZone: profile.timeZone,
        observedStart: new Date(Date.now() - 3900000).toISOString(),
        observedEnd: new Date(Date.now() - 1800000).toISOString(),
        intervalId: laborInterval.id, expectedIntervalRevision: laborInterval.revision,
        expectedIntervalDigest: laborInterval.digest,
        reason: 'Actual authorized Part 3B labor correction' };
    } else {
      path = `${base}/material-actions`; body = { ...sourcePins(), action: 'correct',
        movementKind: 'adjustment', itemKey: 'fence-board',
        description: 'Corrected synthetic Part 3B source material', quantity: '3', unitCode: 'ea',
        unitContractVersion: operationContracts.MATERIAL_UNIT_CONTRACT_VERSION,
        unitContractDigest: operationContracts.MATERIAL_UNIT_CONTRACT_DIGEST,
        locationKey: 'van-01',
        adjustmentDirection: 'increase', movementId: materialMovement.id,
        expectedMovementRevision: materialMovement.revision,
        expectedMovementDigest: materialMovement.digest,
        reason: 'Actual authorized Part 3B material correction' };
    }
    if (kind === 'materials') {
      return operations.mutateMaterialInventory(f.ownerPool, { ...actor,
        organizationId: f.org, executionId: context.execution.id, csrfToken: actor.csrfToken,
        idempotencyKey: crypto.randomUUID(),
        requestCorrelationId: `m27-p3b-material-${crypto.randomUUID()}`, ...body }).then(response => {
        expect(response.status).toBe(200); materialMovement = response.body.data.material;
        return response;
      });
    }
    const requestActor = member;
    return request(f.app).post(path).set(requestActor.session.headers)
      .set('X-CSRF-Token', requestActor.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send(body).then(response => {
        expect(response.status).toBe(kind === 'fieldEvidence' ? 201 : 200);
        if (kind === 'labor') laborInterval = response.body.data;
        if (kind === 'materials') materialMovement = response.body.data.material;
        return response;
      });
  }

  async function expectValueFreeCurrentness() {
    const stale = await request(f.app).get(route).set(actor.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'unavailable', value: null,
      financialActionAuthorized: false });
    expect(['source_currentness_unavailable', 'source_authority_unavailable'])
      .toContain(stale.body.data.reason);
    expect(JSON.stringify(stale.body.data)).not.toMatch(
      /commercialBasis|operationalRiskGuidance|amount|customerId|executionId|sourceDigest/);
  }

  async function recoverCurrentHandoff() {
    await prepareMission27Handoff();
    const recovered = await request(f.app).get(route).set(actor.session.headers);
    expect(recovered.status).toBe(200); expect(recovered.body.data.state).toBe('available');
  }

  async function waitForAdvisoryWaiters(minimum) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = (await f.ownerPool.query(`SELECT count(*)::int AS count
        FROM pg_catalog.pg_locks lock
        WHERE lock.locktype='advisory' AND NOT lock.granted
          AND lock.database=(SELECT oid FROM pg_catalog.pg_database
            WHERE datname=current_database())`)).rows[0].count;
      if (waiting >= minimum) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Expected ${minimum} queued billable-work advisory locks`);
  }

  test('mounted read joins exact current commercial, completion and inert handoff evidence without mutation', async () => {
    const tableCounts = async () => (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_schedule_assignment_revisions) schedule,
      (SELECT count(*)::int FROM canonical_field_execution_events) execution,
      (SELECT count(*)::int FROM canonical_completion_records) completion,
      (SELECT count(*)::int FROM canonical_handoff_receipts) handoff`)).rows[0];
    const before = await tableCounts(); const response = await request(f.app).get(route)
      .set(actor.session.headers); const after = await tableCounts();
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.data.state).toBe('available');
    expect(response.body.data).toMatchObject({ contractVersion: 'm27-billable-work-context-v1',
      state: 'available', commercialBasis: { estimate: { id: estimate },
        currentness: { current: true } }, association: {
        appointmentId: appointment, assignment: { id: context.assignment.id },
        execution: { id: context.execution.id, lifecycleState: 'completed' } },
      operationalRiskGuidance: { state: 'available', advisory: true,
        humanReviewRequired: true }, capacityGuidance: { available: false,
        value: null, code: 'capacity_source_unavailable', mayBookOrMutate: false },
      handoffEvidence: { financialActionAuthorized: false,
        receipt: { mission: 27, status: 'prepared', consumptionAuthorized: false } },
      billableWork: { finalBalanceSourceCurrent: true, reviewAuthority: 'mission27.part3c',
        financialActionAuthorized: false, invoiceAuthorized: false },
      providerCallCount: 0, receiverMutationCount: 0,
      schedulingMutationCount: 0, workMutationCount: 0 });
    expect(after).toEqual(before); expect(require('https').request).not.toHaveBeenCalled();
    const reread = await request(f.app).get(route).set(actor.session.headers);
    expect(reread.body.data).toMatchObject({ state: 'available',
      commercialBasis: { digest: response.body.data.commercialBasis.digest },
      association: response.body.data.association,
      handoffEvidence: response.body.data.handoffEvidence,
      capacityGuidance: response.body.data.capacityGuidance });
    expect(reread.body.data.operationalRiskGuidance.evidence)
      .toEqual(response.body.data.operationalRiskGuidance.evidence);
    expect(Date.parse(reread.body.data.operationalRiskGuidance.generatedAt))
      .toBeGreaterThanOrEqual(Date.parse(response.body.data.operationalRiskGuidance.generatedAt));
    expect(await f.db.initDatabase()).toBe(true);
    const restarted = (await request(f.app).get(route).set(actor.session.headers)).body.data;
    expect(restarted).toMatchObject({ state: 'available', association: response.body.data.association,
      handoffEvidence: response.body.data.handoffEvidence,
      capacityGuidance: response.body.data.capacityGuidance });
    expect(restarted.operationalRiskGuidance.evidence)
      .toEqual(response.body.data.operationalRiskGuidance.evidence);
  }, 120000);

  test('route preserves identity, role and query privacy gates', async () => {
    expect((await request(f.app).get(route)).status).toBe(401);
    expect((await request(f.app).get(route).set(f.actors.member.session.headers)).status).toBe(403);
    expect([403,404]).toContain((await request(f.app).get(route)
      .set(f.actors.otherOwner.session.headers)).status);
    expect((await request(f.app).get(route + '?include=history')
      .set(actor.session.headers)).status).toBe(400);
  });

  test('runtime currentness witness uses the fenced transaction without direct table authority', async () => {
    const value = await workContextRepository.withinWorkFence(
      f.runtimePool, f.org, context.execution.id,
      client => workContextRepository.readHandoffWithinFence(client, {
        ...actor, organizationId: f.org, executionId: context.execution.id,
      }));
    expect(value).toMatchObject({ version: 'm23-downstream-handoffs-v1',
      executionId: context.execution.id, sourceAvailable: true });
    await expect(f.runtimePool.query('SELECT * FROM canonical_field_evidence_records LIMIT 1'))
      .rejects.toMatchObject({ code: '42501' });
  });

  test.each(['fieldEvidence','labor','materials'])(
    'database fence serializes the actual authorized %s writer and recovers after refresh',
    async kind => {
      let signalSnapshot; let releaseSnapshot;
      const snapshotRead = new Promise(resolve => { signalSnapshot = resolve; });
      const snapshotRelease = new Promise(resolve => { releaseSnapshot = resolve; });
      const heldRead = workContextRepository.read(f.runtimePool, actor, estimate, {
        readHandoff: async (...args) => {
          const result = await workContextRepository.readHandoffWithinFence(...args);
          signalSnapshot(); await snapshotRelease;
          return result;
        },
      });
      await Promise.race([snapshotRead, heldRead.then(result => {
        throw new Error(`Fenced read completed before its currentness witness: ${JSON.stringify(result)}`);
      })]);
      let settled = false;
      const writer = mountedWriter(kind).finally(() => { settled = true; });
      if (kind === 'fieldEvidence') await waitForAdvisoryWaiters(1);
      else await new Promise(resolve => setTimeout(resolve, 150));
      expect(settled).toBe(false);
      releaseSnapshot();
      expect((await heldRead).state).toBe('available');
      await writer;
      await expectValueFreeCurrentness();
      await recoverCurrentHandoff();
    }, 120000,
  );

  test.each(['fieldEvidence','labor','materials'])(
    'actual authorized %s writer queued first makes a concurrent read value-free',
    async kind => {
      const blocker = await f.ownerPool.connect(); let transaction = false;
      try {
        await blocker.query('BEGIN'); transaction = true;
        await blocker.query('SELECT pg_advisory_xact_lock(230007,hashtext($1))',
          [`${f.org}:${context.execution.id}`]);
        let writerSettled = false; let readSettled = false;
        const writer = mountedWriter(kind).finally(() => { writerSettled = true; });
        await waitForAdvisoryWaiters(1);
        const concurrentRead = request(f.app).get(route).set(actor.session.headers)
          .then(response => { readSettled = true; return response; });
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(writerSettled).toBe(false); expect(readSettled).toBe(false);
        await blocker.query('COMMIT'); transaction = false;
        await writer;
        const response = await concurrentRead;
        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ state: 'unavailable', value: null,
          financialActionAuthorized: false });
        await recoverCurrentHandoff();
      } finally {
        if (transaction) await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
    }, 120000,
  );

  test('reader rollback releases the database fence without residue and restart stays current', async () => {
    const before = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_field_evidence_records WHERE execution_id=$1) evidence,
      (SELECT count(*)::int FROM canonical_labor_intervals WHERE execution_id=$1) labor,
      (SELECT count(*)::int FROM canonical_material_movements WHERE execution_id=$1) materials`,
    [context.execution.id])).rows[0];
    await expect(workContextRepository.withinWorkFence(
      f.runtimePool, f.org, context.execution.id, async () => {
        throw new Error('Synthetic Part 3B read rollback');
      })).rejects.toThrow('Synthetic Part 3B read rollback');
    const after = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_field_evidence_records WHERE execution_id=$1) evidence,
      (SELECT count(*)::int FROM canonical_labor_intervals WHERE execution_id=$1) labor,
      (SELECT count(*)::int FROM canonical_material_movements WHERE execution_id=$1) materials`,
    [context.execution.id])).rows[0];
    expect(after).toEqual(before);
    await mountedWriter('fieldEvidence');
    await expectValueFreeCurrentness();
    await recoverCurrentHandoff();
    expect(await f.db.initDatabase()).toBe(true);
    const restarted = await request(f.app).get(route).set(actor.session.headers);
    expect(restarted.status).toBe(200); expect(restarted.body.data.state).toBe('available');
    const waits = (await f.ownerPool.query(`SELECT count(*)::int AS count
      FROM pg_catalog.pg_locks lock WHERE lock.locktype='advisory' AND NOT lock.granted
        AND lock.database=(SELECT oid FROM pg_catalog.pg_database
          WHERE datname=current_database())`)).rows[0].count;
    expect(waits).toBe(0);
  }, 120000);

  test('reopening invalidates final-balance context and returns no prior value', async () => {
    const reopened = await f.completion(context, 'reopen_execution', { completion: {
      id: approvedCompletion.id, revision: approvedCompletion.revision,
      digest: approvedCompletion.digest }, nextAction: 'Recheck the recorded completed work.' });
    expect(reopened.body.data.lifecycleState).toBe('reopened');
    const response = await request(f.app).get(route).set(actor.session.headers);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'source_currentness_unavailable', refreshRequired: true,
      financialActionAuthorized: false, providerCallCount: 0,
      receiverMutationCount: 0, schedulingMutationCount: 0, workMutationCount: 0 });
    expect(JSON.stringify(response.body.data)).not.toMatch(
      /commercialBasis|operationalRiskGuidance|amount|customerId|executionId|sourceDigest/);
  });
});
