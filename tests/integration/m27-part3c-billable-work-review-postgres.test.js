'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');
const { issueEditableEstimateGrant } =
  require('../../src/customerFinancial/estimateCapabilityGrantIssuer');
const { issueBillableWorkReviewGrant, BUSINESS_PURPOSE, POLICY_VERSION } =
  require('../../src/customerFinancial/billableWorkReviewGrantIssuer');
const { issueEstimateJourneyGrant, PURPOSE } =
  require('../../src/customerFinancial/estimateJourneyGrantIssuer');
const operations = require('../../src/operations/repository');
const operationContracts = require('../../src/operations/contract');
const workContextRepository = require('../../src/customerFinancial/billableWorkContextRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const priceRoot = '/api/v1/forecast/price-history';

realPostgres('Mission 27 Part 3C exact human billable-work review', () => {
  let f; let actor; let estimate; let appointment; let firstReviewId; let context;
  let approvedCompletion; let laborInterval; let materialMovement; let businessProfile; let route;
  let ownerGrant; let adminGrant;
  let quoteOptionGrant; let quoteOwnerProposalGrant; let quoteAdminProposalGrant;

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
    route = `/api/v1/customer-financial/editable-estimates/${estimate}/billable-work-review`;
    await prepareWorkforceAuthority();
    firstReviewId = await createCurrentCommercialLineage();
    await assignDispatchAndCorrectBooking();
    await issueEditableEstimateGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate);
    await issueEditableEstimateGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: f.actors.admin.actorUserId,
      membershipId: f.actors.admin.actorUserId,
      actorAccessRole: f.actors.admin.actorAccessRole }, estimate);
    context = await createAndCompleteExecution();
    await prepareMission27Handoff();
    ownerGrant = await issueBillableWorkReviewGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate);
    adminGrant = await issueBillableWorkReviewGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: f.actors.admin.actorUserId, membershipId: f.actors.admin.actorUserId,
      actorAccessRole: f.actors.admin.actorAccessRole }, estimate);
    quoteOptionGrant = await issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate,
    'customer_financial.estimate.edit_options');
    quoteOwnerProposalGrant = await issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate,
    'customer_financial.estimate.request_signature');
    quoteAdminProposalGrant = await issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: f.actors.admin.actorUserId, membershipId: f.actors.admin.actorUserId,
      actorAccessRole: f.actors.admin.actorAccessRole }, estimate,
    'customer_financial.estimate.request_signature');
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
      inputs: { ...pricingFixture(review.pricingPlans.serviceKey), lines: [{
        ...pricingFixture(review.pricingPlans.serviceKey).lines[0], amount: '15000.00',
      }] }, currency: review.currency,
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
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const waiting = (await f.ownerPool.query(`SELECT lock.mode,lock.pid,lock.waitstart
        FROM pg_catalog.pg_locks lock
        WHERE lock.locktype='advisory' AND NOT lock.granted
          AND lock.database=(SELECT oid FROM pg_catalog.pg_database
            WHERE datname=current_database())
        ORDER BY lock.waitstart,lock.pid`)).rows;
      if (waiting.length >= minimum) return waiting;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Expected ${minimum} queued billable-work advisory locks`);
  }

  async function readReview(requestActor, sourceClass) {
    return request(f.app).get(route).query({ sourceClass })
      .set(requestActor.session.headers);
  }

  function reviewBody(sourceClass, candidate, grant, reason) {
    return { sourceClass, confirmed: true,
      confirmationVersion: 'm27-billable-work-review-v1',
      expectedDecisionDigest: candidate.source.decisionDigest,
      capabilityGrantId: grant.grantId,
      capabilityGrantRevision: grant.revision,
      businessPurpose: BUSINESS_PURPOSE, policyVersion: POLICY_VERSION, reason };
  }

  async function submitReview(requestActor, sourceClass, candidate, grant, key, reason) {
    return request(f.app).post(route).set(requestActor.session.headers)
      .set('X-CSRF-Token', requestActor.csrfToken)
      .set('Idempotency-Key', key)
      .send(reviewBody(sourceClass, candidate, grant, reason));
  }

  test('mounted final-balance review binds the exact current M24/M23 source and enforces dual control', async () => {
    const before = await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_billable_work_reviews_v1) reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_billable_review_requests_v1) requests,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers,
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs`);
    const candidate = await readReview(actor, 'final_balance');
    expect(candidate.status).toBe(200);
    expect(candidate.body.data).toMatchObject({ state: 'review_required',
      financialActionAuthorized: false, invoiceAuthorized: false,
      source: { sourceClass: 'final_balance', estimateId: estimate,
        workId: context.execution.id, controlMode: 'dual_control', sourceCurrent: true,
        completionClaimed: true, completionInferred: false,
        amount: { currency: 'USD', minorUnitExponent: 2 } } });
    expect(candidate.body.data.source.decisionDigest).toMatch(/^[0-9a-f]{64}$/);
    const noCsrf = await request(f.app).post(route).set({ Cookie: actor.session.headers.Cookie })
      .set('Idempotency-Key', `m27-p3c-no-csrf-${crypto.randomUUID()}`)
      .send(reviewBody('final_balance', candidate.body.data, ownerGrant,
        'Owner attempts a review without current CSRF evidence.'));
    expect(noCsrf.status).toBe(403);
    const key = `m27-p3c-final-owner-${crypto.randomUUID()}`;
    const first = await submitReview(actor, 'final_balance', candidate.body.data,
      ownerGrant, key, 'Owner reviewed this exact completed-work balance source.');
    expect(first.status).toBe(202);
    expect(first.body.data).toMatchObject({ state: 'independent_review_required',
      approvalCount: 1, requiredApprovalCount: 2, financialActionAuthorized: false,
      invoiceAuthorized: false, receiverMutationCount: 0, providerCallCount: 0 });
    const replay = await submitReview(actor, 'final_balance', candidate.body.data,
      ownerGrant, key, 'Owner reviewed this exact completed-work balance source.');
    expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    const second = await submitReview(f.actors.admin, 'final_balance', candidate.body.data,
      adminGrant, `m27-p3c-final-admin-${crypto.randomUUID()}`,
      'Administrator independently reviewed this exact completed-work balance.');
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ state: 'reviewed_current', approvalCount: 2,
      requiredApprovalCount: 2, financialActionAuthorized: false,
      invoiceAuthorized: false, handoffReceiptAuthorized: false });
    expect(new Set(second.body.data.approvals.map(value => value.actorUserId)).size).toBe(2);
    const currentReplay = await submitReview(actor, 'final_balance', candidate.body.data,
      ownerGrant, key, 'Owner reviewed this exact completed-work balance source.');
    expect(currentReplay.status).toBe(200);
    expect(currentReplay.body).toMatchObject({ replayed: true,
      data: { state: 'reviewed_current', approvalCount: 2, requiredApprovalCount: 2 } });
    const reread = await readReview(actor, 'final_balance');
    expect(reread.status).toBe(200);
    expect(reread.body.data).toMatchObject({ state: 'reviewed_current', sourceCurrent: true,
      decisionDigest: candidate.body.data.source.decisionDigest });
    const after = await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_billable_work_reviews_v1) reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_billable_review_requests_v1) requests,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers,
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs`);
    expect(after.rows[0].reviews - before.rows[0].reviews).toBe(2);
    expect(after.rows[0].requests - before.rows[0].requests).toBe(2);
    expect(after.rows[0].numbers).toBe(before.rows[0].numbers);
    expect(after.rows[0].handoffs).toBe(before.rows[0].handoffs);
  }, 180000);

  test('missing accepted deposit terms remain value-free and a real M23 source change clears reviewed final values', async () => {
    const deposit = await readReview(actor, 'pre_work_deposit');
    expect(deposit.status).toBe(200);
    expect(deposit.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'deposit_terms_unavailable', financialActionAuthorized: false,
      invoiceAuthorized: false });
    expect(deposit.body.data.missingEvidence).toEqual([
      'mission24.exact_accepted_deposit_schedule',
    ]);
    expect(JSON.stringify(deposit.body.data)).not.toMatch(/amount|sourceDigest|reviewId/);

    await mountedWriter('fieldEvidence');
    const stale = await readReview(actor, 'final_balance');
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'source_currentness_unavailable', financialActionAuthorized: false,
      invoiceAuthorized: false });
    expect(JSON.stringify(stale.body.data)).not.toMatch(
      /amount|sourceDigest|commercialBasisDigest|approvals|reviewId|workId/);
  }, 180000);

  test('mounted access, CSRF, tenant privacy, immutable tables and direct runtime access fail closed', async () => {
    expect((await request(f.app).get(route).set(actor.session.headers)).status).toBe(400);
    expect((await readReview(f.actors.viewer, 'final_balance')).status).toBe(403);
    const crossTenant = await readReview(f.actors.otherOwner, 'final_balance');
    expect([200,403,404,503]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toContain(estimate);
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_billable_work_reviews_v1',
    )).rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      `UPDATE canonical_customer_financial_billable_work_reviews_v1
       SET review_reason='Mutation forbidden' WHERE organization_id=$1`, [f.org],
    )).rejects.toMatchObject({ code: '55000' });
    const migration = (await f.ownerPool.query(
      "SELECT filename FROM _migrations ORDER BY id DESC LIMIT 1",
    )).rows[0];
    expect(migration.filename).toBe('266_customer_financial_billable_work_review_v1.sql');
  }, 180000);

  test('mounted mobile quote journey edits every field and creates only an exact reviewed multi-option proposal', async () => {
    const quoteRoute = `/api/v1/customer-financial/editable-estimates/${estimate}/quote-journey`;
    await expect(issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate,
    'customer_financial.estimate.edit_options')).rejects.toMatchObject({ code: '23505' });
    const initial = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({ state: 'ready_to_edit', revision: 0,
      machineDraftApprovedPrice: false, signature: { state: 'unavailable',
        reason: 'legal_review_unavailable' }, workHandoff: { state: 'unavailable',
        reason: 'work_handoff_receiver_unavailable' }, providerCallCount: 0,
      receiverMutationCount: 0 });
    expect(initial.body.data.capabilities['customer_financial.estimate.edit_options']).toMatchObject({
      grantId: quoteOptionGrant.grantId, revision: quoteOptionGrant.revision });
    const sourceOption = initial.body.data.options[0];
    const sourceLine = sourceOption.lines[0];
    const draft = { options: [
      { id: sourceOption.id, name: 'Good', scope: 'Repair the reviewed fence scope.',
        validityDays: 14, assumptions: ['Existing posts remain serviceable.'],
        lines: [{ id: sourceLine.id, description: sourceLine.description,
          quantity: '1', unit: 'job', price: sourceLine.price }] },
      { id: 'better_option', name: 'Better', scope: 'Replace the reviewed fence scope.',
        validityDays: 21, assumptions: ['Existing grade remains serviceable.'],
        lines: [{ id: 'better_line', description: 'Full reviewed fence replacement',
          quantity: '1', unit: 'job', price: {
            version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
            minorUnits: '900000', decimal: '9000.00', exactZero: false } }] },
    ] };
    const saveKey = crypto.randomUUID();
    const saveBody = { draft, expectedRevision: 0, capabilityGrantId: quoteOptionGrant.grantId,
      capabilityGrantRevision: quoteOptionGrant.revision,
      businessPurpose: PURPOSE['customer_financial.estimate.edit_options'],
      policyVersion: 'mission27.launch.v1', reason: 'Owner reviewed every option and line field.',
      confirmed: true, confirmationVersion: 'm27-polaris-quote-journey-v1' };
    const save = await request(f.app).post(`${quoteRoute}/draft`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', saveKey).send(saveBody);
    expect(save.status).toBe(201);
    expect(save.body.data.draft).toMatchObject({ revision: 1,
      options: [{ name: 'Good', lines: [{ quantity: '1', unit: 'job' }] },
        { name: 'Better', total: { minorUnits: '900000' } }] });
    const proposalId = crypto.randomUUID(); const proposalBody = grant => ({
      expectedDraftRevision: 1, expectedDraftDigest: save.body.data.draft.draftDigest,
      proposalId, proposalRevision: 1, capabilityGrantId: grant.grantId,
      capabilityGrantRevision: grant.revision,
      businessPurpose: PURPOSE['customer_financial.estimate.request_signature'],
      policyVersion: 'mission27.launch.v1', reason: 'Human reviewed this exact proposal version.',
      confirmed: true, confirmationVersion: 'm27-polaris-proposal-review-v1' });
    const firstProposalKey = crypto.randomUUID();
    const first = await request(f.app).post(`${quoteRoute}/proposal`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', firstProposalKey)
      .send(proposalBody(quoteOwnerProposalGrant));
    expect(first.status).toBe(202);
    expect(first.body.data).toMatchObject({ state: 'independent_review_required',
      approvalCount: 1, requiredApprovalCount: 2, automaticDelivery: false,
      signature: { state: 'unavailable', reason: 'legal_review_unavailable' },
      workHandoff: { state: 'unavailable', reason: 'work_handoff_receiver_unavailable' },
      providerCallCount: 0, receiverMutationCount: 0 });
    const pending = await request(f.app).get(quoteRoute).set(f.actors.admin.session.headers);
    expect(pending.status).toBe(200);
    expect(pending.body.data).toMatchObject({ proposalState: 'independent_review_required',
      proposal: { id: proposalId, revision: 1,
        proposalDigest: first.body.data.proposal.proposalDigest } });
    const competing = await request(f.app).post(`${quoteRoute}/proposal`)
      .set(f.actors.admin.session.headers).set('X-CSRF-Token', f.actors.admin.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ ...proposalBody(quoteAdminProposalGrant),
        proposalId: crypto.randomUUID() });
    expect(competing.status).toBe(409);
    expect(JSON.stringify(competing.body)).not.toContain('900000');
    const second = await request(f.app).post(`${quoteRoute}/proposal`)
      .set(f.actors.admin.session.headers).set('X-CSRF-Token', f.actors.admin.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send(proposalBody(quoteAdminProposalGrant));
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ state: 'proposal_current', approvalCount: 2,
      requiredApprovalCount: 2 });
    expect(second.body.data.proposal.proposalDigest).toBe(first.body.data.proposal.proposalDigest);
    const proposalReplay = await request(f.app).post(`${quoteRoute}/proposal`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', firstProposalKey)
      .send(proposalBody(quoteOwnerProposalGrant));
    expect(proposalReplay.status).toBe(200);
    expect(proposalReplay.body).toMatchObject({ data: { state: 'proposal_current', approvalCount: 2,
      requiredApprovalCount: 2, proposal: { proposalDigest: first.body.data.proposal.proposalDigest } } });
    const reread = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(reread.status).toBe(200);
    expect(reread.body.data).toMatchObject({ state: 'current', draft: { revision: 1 },
      proposal: { id: proposalId, revision: 1, automaticDelivery: false },
      signature: { state: 'unavailable', reason: 'legal_review_unavailable' },
      workHandoff: { state: 'unavailable', reason: 'work_handoff_receiver_unavailable' } });
    const revisedDraft = structuredClone(draft);
    revisedDraft.options[0].scope = 'Repair the revised reviewed fence scope.';
    const revise = await request(f.app).post(`${quoteRoute}/draft`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ draft: revisedDraft, expectedRevision: 1,
        capabilityGrantId: quoteOptionGrant.grantId,
        capabilityGrantRevision: quoteOptionGrant.revision,
        businessPurpose: PURPOSE['customer_financial.estimate.edit_options'],
        policyVersion: 'mission27.launch.v1', reason: 'Owner reviewed the revised option scope.',
        confirmed: true, confirmationVersion: 'm27-polaris-quote-journey-v1' });
    expect(revise.status).toBe(201);
    expect(revise.body.data).toMatchObject({ proposalInvalidated: true,
      signatureInvalidated: true, handoffInvalidated: true, draft: { revision: 2 } });
    const cleared = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ draft: { revision: 2 }, proposal: null,
      proposalState: null });
    const staleSaveReplay = await request(f.app).post(`${quoteRoute}/draft`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', saveKey).send(saveBody);
    expect(staleSaveReplay.status).toBe(409);
    expect(JSON.stringify(staleSaveReplay.body)).not.toContain('28148');
    const staleProposalReplay = await request(f.app).post(`${quoteRoute}/proposal`)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', firstProposalKey).send(proposalBody(quoteOwnerProposalGrant));
    expect(staleProposalReplay.status).toBe(409);
    expect(JSON.stringify(staleProposalReplay.body)).not.toContain('900000');
    const concurrentProposal = (grant, proposalIdentity, session, csrf) => request(f.app)
      .post(`${quoteRoute}/proposal`).set(session.headers).set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', crypto.randomUUID()).send({ expectedDraftRevision: 2,
        expectedDraftDigest: revise.body.data.draft.draftDigest, proposalId: proposalIdentity,
        proposalRevision: 1, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: grant.revision,
        businessPurpose: PURPOSE['customer_financial.estimate.request_signature'],
        policyVersion: 'mission27.launch.v1', reason: 'Human reviewed this concurrent proposal.',
        confirmed: true, confirmationVersion: 'm27-polaris-proposal-review-v1' });
    const competingRace = await Promise.all([
      concurrentProposal(quoteOwnerProposalGrant, crypto.randomUUID(), actor.session, actor.csrfToken),
      concurrentProposal(quoteAdminProposalGrant, crypto.randomUUID(), f.actors.admin.session,
        f.actors.admin.csrfToken),
    ]);
    const statuses = competingRace.map(value => value.status).sort();
    expect(statuses[0]).toBe(202);
    expect([409,503]).toContain(statuses[1]);
    let denied = competingRace.find(value => value.status !== 202);
    if (denied.status === 503) {
      denied = await concurrentProposal(quoteAdminProposalGrant, crypto.randomUUID(),
        f.actors.admin.session, f.actors.admin.csrfToken);
    }
    expect(denied.status).toBe(409);
    expect(denied.body.error.category).toBe('CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_CONFLICT');
    const currentProposalDigests = (await f.ownerPool.query(`SELECT count(DISTINCT proposal_digest)::int count
      FROM canonical_customer_estimate_proposal_reviews_v1
      WHERE organization_id=$1 AND estimate_id=$2 AND draft_revision=2`, [f.org,estimate])).rows[0].count;
    expect(currentProposalDigests).toBe(1);
    const mutationCounts = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_schedule_human_approvals) schedule,
      (SELECT count(*)::int FROM canonical_field_executions) executions,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers`)).rows[0];
    expect(mutationCounts.executions).toBe(1);
    expect(mutationCounts.numbers).toBe(0);
  }, 180000);

});
