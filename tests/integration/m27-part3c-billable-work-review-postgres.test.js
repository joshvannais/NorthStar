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
const { BUSINESS_PURPOSE: INVOICE_PURPOSE,
  POLICY_VERSION: INVOICE_POLICY } = require('../../src/customerFinancial/invoiceDraftGrantIssuer');
const billingIdentity = require('../../src/customerFinancial/billingIdentityRepository');
const operations = require('../../src/operations/repository');
const operationContracts = require('../../src/operations/contract');
const workContextRepository = require('../../src/customerFinancial/billableWorkContextRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const priceRoot = '/api/v1/forecast/price-history';
const taxBehavior = process.env.M27_P4D_TAX_BEHAVIOR === 'inclusive' ? 'inclusive' : 'exclusive';
const completeCampaign = taxBehavior === 'exclusive';

realPostgres(`Mission 27 Part 3C exact human billable-work review (${taxBehavior})`, () => {
  const completeOnly = completeCampaign ? test : test.skip;
  let f; let actor; let estimate; let appointment; let firstReviewId; let context;
  let approvedCompletion; let laborInterval; let materialMovement; let businessProfile; let route;
  let ownerGrant; let adminGrant;
  let quoteOptionGrant; let quoteMemberOptionGrant;
  let invoiceDraftGrant; let invoiceDraftAdminGrant; let billableHandoffReceipt;

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
    quoteMemberOptionGrant = await issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: f.actors.member.actorUserId, membershipId: f.actors.member.actorUserId,
      actorAccessRole: f.actors.member.actorAccessRole }, estimate,
    'customer_financial.estimate.edit_options');
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
    inputs.transactionDate = terms.sources.asOfDate;
    inputs.taxGroups = [group(['installation'], { behavior: taxBehavior })];
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

  async function issueBillingIdentityReviewGrant(customerId) {
    const grantId = crypto.randomUUID();
    await f.ownerPool.query(
      `INSERT INTO canonical_customer_financial_billing_capability_grants_v1(
        organization_id,id,revision,actor_user_id,membership_id,customer_id,capability,
        business_purpose,policy_version,template_version,active,valid_from,expires_at,issued_at)
       VALUES($1,$2,1,$3,$3,$4,$5,$6,$7,'m27.owner.v1',TRUE,
        clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
      [f.org, grantId, actor.actorUserId, customerId, billingIdentity.CAPABILITY,
        billingIdentity.BUSINESS_PURPOSE, billingIdentity.POLICY_VERSION]);
    return grantId;
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
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs,
      (SELECT count(*)::int FROM canonical_customer_financial_billable_handoff_receipts_v1) billable_handoffs`);
    const candidate = await readReview(actor, 'final_balance');
    expect(candidate.status).toBe(200);
    expect(candidate.body.data).toMatchObject({ state: 'review_required',
      financialActionAuthorized: false, invoiceAuthorized: false,
      source: { sourceClass: 'final_balance', estimateId: estimate,
        workId: context.execution.id, controlMode: 'dual_control', sourceCurrent: true,
        completionClaimed: true, completionInferred: false,
        amount: { currency: 'USD', minorUnitExponent: 2 } } });
    expect(candidate.body.data.source.decisionDigest).toMatch(/^[0-9a-f]{64}$/);
    const fabricated = await request(f.app).post(route).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...reviewBody('final_balance', candidate.body.data, ownerGrant,
        'Caller attempts to author the source shape.'),
      source: { amount: { minorUnits: '1' }, sourceDigest: 'f'.repeat(64) } });
    expect(fabricated.status).toBe(400);
    expect(JSON.stringify(fabricated.body)).not.toMatch(/minorUnits|sourceDigest/);
    await expect(f.ownerPool.query(
      `SELECT public.canonical_customer_financial_billable_review_v1_accept(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) result`,
      [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
        actor.csrfToken, crypto.randomUUID(), estimate, ownerGrant.grantId,
        ownerGrant.revision, BUSINESS_PURPOSE, POLICY_VERSION, 'final_balance',
        'f'.repeat(64), 'Direct caller supplies a false source digest.',
        'm27-billable-work-review-v1'])).rejects.toMatchObject({ code: '40001' });
    const afterAdversarial = await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_billable_work_reviews_v1) reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_billable_review_requests_v1) requests`);
    expect(afterAdversarial.rows[0]).toEqual({ reviews: before.rows[0].reviews,
      requests: before.rows[0].requests });
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
      invoiceAuthorized: false, handoffReceiptAuthorized: true,
      handoffReceipt: { contractVersion: 'm27-billable-handoff-receipt-v1',
        downstreamContract: 'mission27.part4.invoice_draft_source.v1',
        billableHandoffAuthorized: true, invoiceAuthorized: false,
        financialActionAuthorized: false, receiverMutationCount: 0, providerCallCount: 0 } });
    expect(second.body.data.handoffReceipt.receiptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.body.data.handoffReceipt.receiptDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.body.data.handoffReceipt.approvalSetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.body.data.handoffReceipt.requestLineageDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.body.data.handoffReceipt.requestLineageDigest)
      .not.toBe(second.body.data.handoffReceipt.approvalSetDigest);
    billableHandoffReceipt = second.body.data.handoffReceipt;
    expect(new Set(second.body.data.approvals.map(value => value.actorUserId)).size).toBe(2);
    const currentReplay = await submitReview(actor, 'final_balance', candidate.body.data,
      ownerGrant, key, 'Owner reviewed this exact completed-work balance source.');
    expect(currentReplay.status).toBe(200);
    expect(currentReplay.body).toMatchObject({ replayed: true,
      data: { state: 'reviewed_current', approvalCount: 2, requiredApprovalCount: 2,
        handoffReceipt: { receiptId: second.body.data.handoffReceipt.receiptId,
          receiptDigest: second.body.data.handoffReceipt.receiptDigest } } });
    const reread = await readReview(actor, 'final_balance');
    expect(reread.status).toBe(200);
    expect(reread.body.data).toMatchObject({ state: 'reviewed_current', sourceCurrent: true,
      decisionDigest: candidate.body.data.source.decisionDigest });
    const after = await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_billable_work_reviews_v1) reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_billable_review_requests_v1) requests,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers,
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs,
      (SELECT count(*)::int FROM canonical_customer_financial_billable_handoff_receipts_v1) billable_handoffs`);
    expect(after.rows[0].reviews - before.rows[0].reviews).toBe(2);
    expect(after.rows[0].requests - before.rows[0].requests).toBe(2);
    expect(after.rows[0].numbers).toBe(before.rows[0].numbers);
    expect(after.rows[0].handoffs).toBe(before.rows[0].handoffs);
    expect(after.rows[0].billable_handoffs - before.rows[0].billable_handoffs).toBe(1);
  }, 180000);

  test('mounted Part 4 workflow issues one current default capability without private setup', async () => {
    const capabilityRoute = `/api/v1/customer-financial/editable-estimates/${estimate}` +
      '/invoice-draft/workflow-capability';
    const body = { confirmed: true,
      confirmationVersion: 'm27-invoice-draft-workflow-capability-v1' };
    const before = Number((await f.ownerPool.query(
      'SELECT count(*) count FROM canonical_customer_financial_invoice_draft_grants_v1')).rows[0].count);
    expect(before).toBe(0);
    expect((await request(f.app).post(capabilityRoute).set('Cookie', actor.session.headers.Cookie)
      .send(body)).status).toBe(403);
    expect((await request(f.app).post(capabilityRoute).set(f.actors.member.session.headers)
      .set('X-CSRF-Token', f.actors.member.csrfToken).send(body)).status).toBe(403);
    expect((await request(f.app).post(capabilityRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).send({ confirmed: false,
        confirmationVersion: body.confirmationVersion })).status).toBe(400);
    const [ownerFirst, ownerSecond] = await Promise.all([0,1].map(() => request(f.app)
      .post(capabilityRoute).set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send(body)));
    expect([ownerFirst.status,ownerSecond.status]).toEqual([200,200]);
    expect(ownerFirst.body.data).toEqual(ownerSecond.body.data);
    expect(ownerFirst.body.data).toMatchObject({
      contractVersion: 'm27-invoice-draft-workflow-capability-v1', state: 'current',
      capability: 'customer_financial.invoice.edit_draft', revision: 1,
      businessPurpose: INVOICE_PURPOSE, policyVersion: INVOICE_POLICY,
      estimateId: estimate, sourceCurrent: true, invoiceAuthorized: false,
      providerCallCount: 0, receiverMutationCount: 0 });
    invoiceDraftGrant = { grantId: ownerFirst.body.data.grantId,
      revision: ownerFirst.body.data.revision };
    const admin = await request(f.app).post(capabilityRoute).set(f.actors.admin.session.headers)
      .set('X-CSRF-Token', f.actors.admin.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send(body);
    expect(admin.status).toBe(200);
    invoiceDraftAdminGrant = { grantId: admin.body.data.grantId, revision: admin.body.data.revision };
    expect(admin.body.data.grantId).not.toBe(invoiceDraftGrant.grantId);
    const crossTenant = await request(f.app).post(capabilityRoute)
      .set(f.actors.otherOwner.session.headers).set('X-CSRF-Token', f.actors.otherOwner.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send(body);
    expect([403,409,503]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(new RegExp(estimate, 'i'));
    const stored = await f.ownerPool.query(`SELECT actor_user_id,estimate_id,capability,
      business_purpose,policy_version,active FROM canonical_customer_financial_invoice_draft_grants_v1
      WHERE organization_id=$1 ORDER BY actor_user_id`, [f.org]);
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every(row => row.estimate_id === estimate && row.active === true &&
      row.capability === 'customer_financial.invoice.edit_draft' &&
      row.business_purpose === INVOICE_PURPOSE && row.policy_version === INVOICE_POLICY)).toBe(true);
  }, 180000);

  test('mounted Part 4A captures one exact immutable customer-safe origin with no invoice effect', async () => {
    const originRoute = `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft-origin`;
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const ready = await request(f.app).get(originRoute).query(query).set(actor.session.headers);
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ contractVersion: 'm27-invoice-draft-origin-v1',
      state: 'ready_to_capture', originId: null, originDigest: null, estimateId: estimate,
      handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest,
      sourceClass: 'final_balance', currency: 'USD', sourceCurrent: true,
      tax: { state: 'unavailable', reason: 'invoice_date_tax_review_required', value: null },
      amountDue: { state: 'unavailable', reason: 'invoice_reconciliation_not_yet_authorized', value: null },
      invoiceAuthorized: false, receivableAuthorized: false, issueAuthorized: false,
      providerCallCount: 0, receiverMutationCount: 0 });
    expect(ready.body.data.lines.length).toBeGreaterThan(0);
    const sum = ready.body.data.lines.reduce((total, line) => total + BigInt(line.lineAmount.minorUnits), 0n);
    expect(sum.toString()).toBe(ready.body.data.subtotalBeforeTax.minorUnits);
    const exactCommercial = (await f.ownerPool.query(`SELECT terms.result,issued.document
      FROM canonical_customer_estimate_versions issued
      JOIN canonical_commercial_terms terms ON terms.organization_id=issued.organization_id
       AND terms.estimate_id=issued.estimate_id AND terms.id=issued.terms_id
      WHERE issued.organization_id=$1 AND issued.estimate_id=$2
      ORDER BY issued.revision DESC LIMIT 1`, [f.org, estimate])).rows[0];
    expect(exactCommercial.result.taxGroups[0].behavior).toBe(taxBehavior);
    expect(exactCommercial.document.charges[0].amount)
      .toBe(exactCommercial.result.lines[0].adjustedAmount);
    const grossLineMinor = BigInt(exactCommercial.document.charges[0].amount.replace('.',''));
    const preTaxLineMinor = BigInt(ready.body.data.lines[0].lineAmount.minorUnits);
    if (taxBehavior === 'inclusive') expect(grossLineMinor).toBeGreaterThan(preTaxLineMinor);
    else expect(grossLineMinor).toBe(preTaxLineMinor);
    expect(ready.body.data.subtotalBeforeTax.decimal).toBe(exactCommercial.result.netBeforeTax);
    expect(exactCommercial.document.subtotal).toBe(exactCommercial.result.netBeforeTax);
    expect(ready.body.data.lines.every(line => line.quantity.value === '1' &&
      line.quantity.unit === 'customer_safe_charge')).toBe(true);
    expect(JSON.stringify(ready.body.data)).not.toMatch(
      /customerName|email|phone|address|margin|internalCost|staff|providerPayload|rawEvidence/i);
    expect((await request(f.app).get(originRoute).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    expect((await request(f.app).get(originRoute).query(query)
      .set(f.actors.viewer.session.headers)).status).toBe(403);
    const otherTenant = await request(f.app).get(originRoute).query(query)
      .set(f.actors.otherOwner.session.headers);
    expect([403,404,503]).toContain(otherTenant.status);
    expect(JSON.stringify(otherTenant.body)).not.toMatch(
      new RegExp(`${estimate}|${billableHandoffReceipt.receiptId}`, 'i'));

    const before = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origin_requests_v1) requests,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers,
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs`)).rows[0];
    await expect(f.ownerPool.query(
      `SELECT public.canonical_customer_financial_invoice_draft_v1_capture(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, actor.csrfToken,
      `m27-p4a-direct-${crypto.randomUUID()}`, estimate, billableHandoffReceipt.receiptId,
      billableHandoffReceipt.receiptDigest, invoiceDraftGrant.grantId, invoiceDraftGrant.revision,
      INVOICE_PURPOSE, INVOICE_POLICY, 'f'.repeat(64),
      'Direct caller cannot author an invoice-draft amount or source.',
      'm27-invoice-draft-origin-capture-v1'])).rejects.toMatchObject({ code: '40001' });
    const body = { ...query, capabilityGrantId: invoiceDraftGrant.grantId,
      capabilityGrantRevision: invoiceDraftGrant.revision, businessPurpose: INVOICE_PURPOSE,
      policyVersion: INVOICE_POLICY, expectedCandidateDigest: ready.body.data.candidateDigest,
      reason: 'Owner captured this exact reviewed customer-safe invoice origin.',
      confirmed: true, confirmationVersion: 'm27-invoice-draft-origin-capture-v1' };
    expect((await request(f.app).post(originRoute).set('Cookie', actor.session.headers.Cookie)
      .set('Idempotency-Key', `m27-p4a-no-csrf-${crypto.randomUUID()}`).send(body)).status).toBe(403);
    expect((await request(f.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', `m27-p4a-caller-lines-${crypto.randomUUID()}`)
      .send({ ...body, lines: ready.body.data.lines })).status).toBe(400);
    const key = `m27-p4a-origin-${crypto.randomUUID()}`;
    const concurrentKey = `m27-p4a-origin-concurrent-${crypto.randomUUID()}`;
    const concurrent = await Promise.all([key, concurrentKey].map(idempotencyKey =>
      request(f.app).post(originRoute).set(actor.session.headers)
        .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', idempotencyKey).send(body)));
    expect(concurrent.map(response => response.status).sort()).toEqual([200,201]);
    const capture = concurrent.find(response => response.status === 201);
    expect(capture.body.data).toMatchObject({ state: 'current', sourceCurrent: true,
      handoffReceiptId: billableHandoffReceipt.receiptId, invoiceAuthorized: false,
      receivableAuthorized: false, issueAuthorized: false });
    expect(capture.body.data.originId).toMatch(/^[0-9a-f-]{36}$/);
    expect(capture.body.data.originDigest).toMatch(/^[0-9a-f]{64}$/);
    const replay = await request(f.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    expect(replay.body.data.originId).toBe(capture.body.data.originId);
    const anotherKey = await request(f.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', `m27-p4a-origin-again-${crypto.randomUUID()}`).send(body);
    expect(anotherKey.status).toBe(200); expect(anotherKey.body.replayed).toBe(false);
    expect(anotherKey.body.data.originId).toBe(capture.body.data.originId);
    const conflict = await request(f.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key)
      .send({ ...body, reason: 'Changed reuse must conflict without exposing saved invoice values.' });
    expect(conflict.status).toBe(409);
    expect(JSON.stringify(conflict.body)).not.toMatch(/minorUnits|description|customerId/);
    const current = await request(f.app).get(originRoute).query(query).set(actor.session.headers);
    expect(current.status).toBe(200); expect(current.body.data.originId).toBe(capture.body.data.originId);
    const after = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origin_requests_v1) requests,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers,
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs`)).rows[0];
    expect(after.origins - before.origins).toBe(1);
    expect(after.requests - before.requests).toBe(3);
    expect(after.numbers).toBe(before.numbers); expect(after.handoffs).toBe(before.handoffs);
  }, 180000);

  test('mounted Part 4B appends exact-total wording, grouping and allocation revisions', async () => {
    const draftRoute = `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft`;
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const baseline = await request(f.app).get(draftRoute).query(query).set(actor.session.headers);
    expect(baseline.status).toBe(200);
    expect(baseline.body.data).toMatchObject({ contractVersion: 'm27-invoice-draft-revision-v1',
      state: 'current', revision: 0, currency: 'USD', sourceCurrent: true,
      invoiceAuthorized: false, receivableAuthorized: false, issueAuthorized: false,
      providerCallCount: 0, receiverMutationCount: 0 });
    expect((await request(f.app).get(draftRoute).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const edit = { contractVersion: 'm27-invoice-draft-edit-v1',
      originId: baseline.body.data.originId, originDigest: baseline.body.data.originDigest,
      lines: baseline.body.data.lines.map((line, ordinal) => ({ ordinal,
        sourceLineDigest: line.sourceLineDigest, group: ordinal ? 'Additional services' : 'Core service',
        description: `${line.description} — reviewed for customer invoice`,
        allocatedMinorUnits: line.allocatedAmount.minorUnits })) };
    if (edit.lines.length > 1 && BigInt(edit.lines[1].allocatedMinorUnits) > 0n) {
      edit.lines[0].allocatedMinorUnits = (BigInt(edit.lines[0].allocatedMinorUnits) + 1n).toString();
      edit.lines[1].allocatedMinorUnits = (BigInt(edit.lines[1].allocatedMinorUnits) - 1n).toString();
    }
    const key = `m27-p4b-save-${crypto.randomUUID()}`;
    const body = { ...query, capabilityGrantId: invoiceDraftGrant.grantId,
      capabilityGrantRevision: invoiceDraftGrant.revision, businessPurpose: INVOICE_PURPOSE,
      policyVersion: INVOICE_POLICY, expectedRevision: 0,
      expectedDraftDigest: baseline.body.data.draftDigest, draft: edit,
      reason: 'Owner clarified customer wording, grouping, and exact allocations.',
      confirmed: true, confirmationVersion: 'm27-invoice-draft-revision-save-v1' };
    expect((await request(f.app).post(draftRoute).set('Cookie', actor.session.headers.Cookie)
      .set('Idempotency-Key', key).send(body)).status).toBe(403);
    const wrongTotal = structuredClone(body);
    wrongTotal.draft.lines[0].allocatedMinorUnits =
      (BigInt(wrongTotal.draft.lines[0].allocatedMinorUnits) + 1n).toString();
    const rejected = await request(f.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', `m27-p4b-wrong-total-${crypto.randomUUID()}`).send(wrongTotal);
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).not.toMatch(/minorUnits|description|customerId/);
    const saved = await request(f.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({ revision: 1, sourceCurrent: true,
      subtotalBeforeTax: baseline.body.data.subtotalBeforeTax, invoiceAuthorized: false });
    expect(saved.body.data.draftDigest).not.toBe(baseline.body.data.draftDigest);
    expect(saved.body.data.historyChainDigest).not.toBe(baseline.body.data.historyChainDigest);
    expect(saved.body.data.lines.map(line => line.sourceLineDigest))
      .toEqual(baseline.body.data.lines.map(line => line.sourceLineDigest));
    const savedTotal = saved.body.data.lines.reduce(
      (sum, line) => sum + BigInt(line.allocatedAmount.minorUnits), 0n);
    expect(savedTotal.toString()).toBe(baseline.body.data.subtotalBeforeTax.minorUnits);
    const replay = await request(f.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    expect(replay.body.data.draftDigest).toBe(saved.body.data.draftDigest);
    const changedReuse = await request(f.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key)
      .send({ ...body, reason: 'Changed key reuse cannot select an older invoice-draft revision.' });
    expect(changedReuse.status).toBe(409);

    const revisions = ['Concurrent owner revision A.', 'Concurrent owner revision B.'].map((suffix, index) => {
      const draft = structuredClone(edit);
      draft.lines[0].description = `${edit.lines[0].description} ${suffix}`;
      return request(f.app).post(draftRoute).set(actor.session.headers)
        .set('X-CSRF-Token', actor.csrfToken)
        .set('Idempotency-Key', `m27-p4b-race-${index}-${crypto.randomUUID()}`)
        .send({ ...body, draft, expectedRevision: 1,
          expectedDraftDigest: saved.body.data.draftDigest,
          reason: `Owner submitted ${suffix.toLowerCase()} with exact total preserved.` });
    });
    const raced = await Promise.all(revisions);
    expect(raced.map(response => response.status).sort()).toEqual([201,409]);
    const current = await request(f.app).get(draftRoute).query(query).set(actor.session.headers);
    expect(current.status).toBe(200); expect(current.body.data.revision).toBe(2);
    expect(current.body.data.draftDigest).toBe(raced.find(response => response.status === 201).body.data.draftDigest);
    const supersededReplay = await request(f.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    expect(supersededReplay.status).toBe(409);
    expect(JSON.stringify(supersededReplay.body)).not.toMatch(/minorUnits|description|customerId/);
    const stored = await f.ownerPool.query(`SELECT revision,rtrim(draft_digest) draft_digest
      FROM canonical_customer_financial_invoice_draft_revisions_v1
      WHERE organization_id=$1 AND origin_id=$2 ORDER BY revision`, [f.org, baseline.body.data.originId]);
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.map(row => Number(row.revision))).toEqual([1,2]);
    await expect(f.ownerPool.query(`UPDATE canonical_customer_financial_invoice_draft_revisions_v1
      SET draft=draft WHERE organization_id=$1 AND origin_id=$2`,
    [f.org,baseline.body.data.originId])).rejects.toMatchObject({ code: '55000' });
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_invoice_draft_revisions_v1')).rejects
      .toMatchObject({ code: '42501' });
  }, 180000);

  test('mounted Part 4C binds exact Mission 24 authority and keeps native components value-free', async () => {
    const componentRoute = `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft/components`;
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const before = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers,
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs`)).rows[0];
    expect((await request(f.app).get(componentRoute).set(actor.session.headers)).status).toBe(400);
    expect((await request(f.app).get(componentRoute).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(f.app).get(componentRoute).query(query)
      .set(f.actors.otherOwner.session.headers);
    expect([403,404]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/minorUnits|commercialRevision|financialComponents/);
    const forged = await request(f.app).get(componentRoute).query({ ...query,
      handoffReceiptDigest: 'f'.repeat(64) }).set(actor.session.headers);
    expect(forged.status).toBe(200);
    expect(forged.body.data).toMatchObject({ state: 'unavailable', value: null,
      sourceCurrent: false, commercialSourceAuthorityCurrent: false,
      invoiceAuthorized: false, receivableAuthorized: false, issueAuthorized: false });
    expect(JSON.stringify(forged.body.data)).not.toMatch(
      /minorUnits|commercialRevision|financialComponents|invoiceDraft/);
    const response = await request(f.app).get(componentRoute).query(query).set(actor.session.headers);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      contractVersion: 'm27-invoice-draft-components-v1', state: 'current', sourceCurrent: true,
      commercialSourceAuthorityCurrent: true, invoiceAuthorized: false, receivableAuthorized: false,
      issueAuthorized: false, providerCallCount: 0, receiverMutationCount: 0,
      commercialRevision: { authorityClass: 'mission24.current_accepted_commercial_revision',
        amountChangingFeesDiscountsOrScopeRequireNewAcceptedMission24Revision: true,
        mission27CommercialAmountOverrideAuthorized: false,
        customerAcceptance: { state: 'accepted_current' } },
      reconciliation: { commercialSubtotalSource: 'exact_current_invoice_draft_only',
        separateComponentsAffectCommercialSubtotal: false,
        depositScheduleIsPaymentReceipt: false, duplicateComponentEffectAllowed: false,
        componentEffect: { state: 'unavailable', value: null },
        amountDue: { state: 'unavailable', value: null } },
    });
    expect(response.body.data.componentsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(response.body.data.invoiceDraft.subtotalBeforeTax)
      .toEqual(response.body.data.reconciliation.subtotalBeforeTax);
    expect(response.body.data.financialComponents.map(value => value.componentType)).toEqual([
      'deposit_application','prior_payment','credit_note','refund','tax_adjustment',
    ]);
    expect(response.body.data.financialComponents.every(value => value.state === 'unavailable' &&
      value.value === null && value.provenance === null)).toBe(true);
    expect(response.body.data.financialComponents.map(value => value.missingEvidence[0])).toEqual([
      'mission27.native_deposit_payment_receipt','mission27.native_prior_payment_receipt',
      'mission27.native_credit_note','mission27.native_refund_receipt',
      'mission27.invoice_date_tax_review',
    ]);
    expect(response.body.data.unsupportedShapes.map(value => value.reason)).toEqual([
      'retainage_unsupported','milestone_authority_unavailable','tip_unsupported',
      'surcharge_unsupported','financing_unsupported','recurring_billing_unsupported',
    ]);
    expect(response.body.data.unsupportedShapes.every(value => value.value === null)).toBe(true);
    const after = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers,
      (SELECT count(*)::int FROM canonical_handoff_receipts WHERE mission=27) handoffs`)).rows[0];
    expect(after).toEqual(before);
    await expect(f.runtimePool.query(
      "SELECT public.canonical_customer_financial_invoice_draft_components_v1_missing('x','x','x','x')",
    )).rejects.toMatchObject({ code: '42501' });
  }, 180000);

  test('mounted Part 4D records exact invoice-date preparation while professional policy stays unavailable', async () => {
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const origin = (await f.ownerPool.query(`SELECT customer_id FROM
      canonical_customer_financial_invoice_draft_origins_v1
      WHERE organization_id=$1 AND estimate_id=$2`, [f.org, estimate])).rows[0];
    await issueBillingIdentityReviewGrant(origin.customer_id);
    const billingRoute = `/api/v1/customer-financial/billing-identities/${origin.customer_id}`;
    let billing = await request(f.app).get(billingRoute).set(actor.session.headers);
    expect(billing.status).toBe(200);
    expect(billing.body.data.identity.state).toBe('candidate_unreviewed');
    const establish = await request(f.app).post(`${billingRoute}/establish`)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', `m27-p4d-establish-${crypto.randomUUID()}`).send({
        expectedSourceDigest: billing.body.data.identity.sourceDigest,
        expectedSourceUpdatedAt: billing.body.data.identity.sourceUpdatedAt,
        reason: 'Begin the exact invoice-date billing jurisdiction review.',
      });
    expect(establish.status).toBe(201);
    billing = await request(f.app).get(billingRoute).set(actor.session.headers);
    expect(billing.status).toBe(200);
    expect(billing.body.data.review.state).toBe('review_required');
    const review = billing.body.data.review;
    const reviewed = await request(f.app).post(`${billingRoute}/reviews`)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', `m27-p4d-billing-${crypto.randomUUID()}`).send({
        billingPartyId: review.billingPartyId,
        originSnapshotId: billing.body.data.identity.snapshotId,
        expectedSourceDigest: review.sourceDigest,
        expectedSourceUpdatedAt: review.sourceUpdatedAt,
        expectedPreviousReviewId: review.reviewId,
        expectedPreviousReviewDigest: review.reviewDigest,
        expectedPreviousSequence: review.sequence,
        payload: { contact: { name: 'Taylor Customer', email: 'taylor@example.test', phone: null },
          serviceAddress: { line1: '10 Service Street', line2: null, city: 'Boston',
            region: 'MA', postalCode: '02108', countryCode: 'US' },
          billingAddress: { line1: '20 Billing Street', line2: null, city: 'Boston',
            region: 'MA', postalCode: '02108', countryCode: 'US' },
          purchaseOrderReference: 'PO-P4D', customerReference: 'CUSTOMER-P4D' },
        reason: 'Owner reviewed both invoice-date jurisdiction addresses.',
      });
    expect(reviewed.status).toBe(201);

    const taxRoute = `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft/tax-review`;
    const lineBasis = await f.ownerPool.query(`SELECT
      public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
       '110.00','110.00','inclusive','10.00') inclusive,
      public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
       '110.00','110.00','exclusive','10.00') exclusive,
      public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
       '0.00','0.00','inclusive','0.00') exact_zero,
      public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
       '110.00','109.99','inclusive','10.00') tampered,
      public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
       '5.00','5.00','inclusive','5.01') impossible_tax`);
    expect(lineBasis.rows[0]).toEqual({ inclusive: '10000', exclusive: '11000',
      exact_zero: '0', tampered: null, impossible_tax: null });
    expect((await request(f.app).get(taxRoute).set(actor.session.headers)).status).toBe(400);
    expect((await request(f.app).get(taxRoute).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(f.app).get(taxRoute).query(query)
      .set(f.actors.otherOwner.session.headers);
    expect([403,404]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/minorUnits|jurisdiction|preparation/);
    const candidate = await request(f.app).get(taxRoute).query(query).set(actor.session.headers);
    expect(candidate.status).toBe(200);
    expect(candidate.body.data).toMatchObject({ contractVersion: 'm27-invoice-date-tax-review-v1',
      state: 'ready_to_record', sourceCurrent: true, taxAuthorityCurrent: false,
      taxBearingInvoiceAuthorized: false, invoiceAuthorized: false, receivableAuthorized: false,
      issueAuthorized: false, providerCallCount: 0, receiverMutationCount: 0,
      professionalPolicy: { state: 'unavailable', reason: 'tax_authority_unavailable', value: null },
      taxReviewDisposition: { state: 'unavailable', taxBearingInvoiceAuthorized: false },
      preparation: { version: 'm27-invoice-date-tax-preparation-v1',
        serviceJurisdiction: { countryCode: 'US', region: 'MA' },
        billingJurisdiction: { countryCode: 'US', region: 'MA' },
        sourceCurrent: true, providerCalculationUsed: false, browserArithmeticUsed: false,
        nexusEvidence: { state: 'unavailable', value: null },
        creditRefundAdjustmentLineage: { state: 'unavailable', value: null } } });
    const adminCandidate = await request(f.app).get(taxRoute).query(query)
      .set(f.actors.admin.session.headers);
    expect(adminCandidate.status).toBe(200);
    expect(adminCandidate.body.data.candidateDigest).toBe(candidate.body.data.candidateDigest);
    expect(invoiceDraftAdminGrant.revision).toBe(1);
    const lineTax = candidate.body.data.preparation.lines.reduce(
      (sum, line) => sum + BigInt(line.collectedTax.minorUnits), 0n);
    const preparedBasis = candidate.body.data.preparation.lines.reduce(
      (sum, line) => sum + BigInt(line.taxableBasis.minorUnits), 0n);
    expect(lineTax.toString()).toBe(
      candidate.body.data.preparation.collectedTaxLiability.amount.minorUnits);
    expect(preparedBasis.toString()).toBe(
      candidate.body.data.preparation.invoiceDraft.subtotalBeforeTax.minorUnits);
    expect(candidate.body.data.preparation.lines.every(
      line => line.inclusiveExclusive === taxBehavior)).toBe(true);
    const key = `m27-p4d-record-${crypto.randomUUID()}`;
    const body = { ...query, capabilityGrantId: invoiceDraftGrant.grantId,
      capabilityGrantRevision: invoiceDraftGrant.revision, businessPurpose: INVOICE_PURPOSE,
      policyVersion: INVOICE_POLICY, expectedCandidateDigest: candidate.body.data.candidateDigest,
      reason: 'Owner reviewed the exact invoice-date tax preparation evidence.', confirmed: true,
      confirmationVersion: 'm27-invoice-date-tax-review-record-v1' };
    expect((await request(f.app).post(taxRoute).set('Cookie', actor.session.headers.Cookie)
      .set('Idempotency-Key', key).send(body)).status).toBe(403);
    expect((await request(f.app).post(taxRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...body, businessPurpose: 'customer_financial.billing_identity' })).status).toBe(400);
    const beforeRecords = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_review_requests_v1) requests`)).rows[0];
    const simultaneous = await Promise.all([0,1].map(() => request(f.app).post(taxRoute)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', key).send(body)));
    expect(simultaneous.map(value => value.status).sort()).toEqual([200,201]);
    const saved = simultaneous.find(value => value.status === 201);
    expect(saved.body.data).toMatchObject({ state: 'recorded_policy_unavailable',
      preparationDigest: candidate.body.data.preparationDigest, taxAuthorityCurrent: false,
      taxBearingInvoiceAuthorized: false, invoiceAuthorized: false });
    const replay = await request(f.app).post(taxRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    const changedReuse = await request(f.app).post(taxRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key)
      .send({ ...body, reason: 'Changed reuse must conflict without exposing tax preparation values.' });
    expect(changedReuse.status).toBe(409);
    expect(JSON.stringify(changedReuse.body)).not.toMatch(/minorUnits|serviceJurisdiction|preparation/);
    const afterRecords = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_review_requests_v1) requests`)).rows[0];
    expect(afterRecords.reviews - beforeRecords.reviews).toBe(1);
    expect(afterRecords.requests - beforeRecords.requests).toBe(1);
    const readback = await request(f.app).get(taxRoute).query(query).set(actor.session.headers);
    expect(readback.status).toBe(200); expect(readback.body.data.reviewId).toBe(saved.body.data.reviewId);
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_invoice_tax_reviews_v1')).rejects
      .toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(
      `SELECT public.canonical_customer_financial_invoice_tax_review_v1_source(
        $1,$2,$3,$4,$5,$6,$7)`, [f.org,actor.actorUserId,actor.actorAccessRole,
        actor.authSessionId,estimate,query.handoffReceiptId,query.handoffReceiptDigest])).rejects
      .toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(
      `SELECT public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
        '110.00','110.00','inclusive','10.00')`)).rejects.toMatchObject({ code: '42501' });
    const privateTables = ['canonical_customer_financial_invoice_tax_reviews_v1',
      'canonical_customer_financial_invoice_tax_review_requests_v1'];
    for (const table of privateTables) {
      expect((await f.ownerPool.query(
        'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
        [`public.${table}`])).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    }
    expect(f.roles.runtime).toMatch(/^[a-z0-9_]+$/);
    const tableList = privateTables.map(table => `public.${table}`).join(',');
    await f.ownerPool.query(`GRANT SELECT ON TABLE ${tableList} TO ${f.roles.runtime}`);
    try {
      for (const claimedOrganization of [f.org, f.otherOrg, crypto.randomUUID()]) {
        await f.runtimePool.query("SELECT set_config('northstar.invoice_tax_organization_id',$1,FALSE)",
          [claimedOrganization]);
        for (const table of privateTables) {
          expect((await f.runtimePool.query(`SELECT count(*)::int count FROM public.${table}`))
            .rows[0].count).toBe(0);
        }
      }
    } finally {
      await f.ownerPool.query(`REVOKE SELECT ON TABLE ${tableList} FROM ${f.roles.runtime}`);
    }
  }, 180000);

  test('mounted Part 4E reconciles exact draft totals while amount due and every effect remain unavailable', async () => {
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const route = `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft/preview`;
    expect((await request(f.app).get(route).set(actor.session.headers)).status).toBe(400);
    expect((await request(f.app).get(route).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(f.app).get(route).query(query)
      .set(f.actors.otherOwner.session.headers);
    expect([403,404]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/minorUnits|description|documentPreview/);
    const before = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers`)).rows[0];
    const response = await request(f.app).get(route).query(query).set(actor.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.vary).toMatch(/Cookie/);
    const value = response.body.data;
    expect(value).toMatchObject({ contractVersion:'m27-invoice-draft-preview-v1', state:'current',
      mode:'paid', fictional:false, sourceCurrent:true, commercialSourceAuthorityCurrent:true,
      taxAuthorityCurrent:false, amountDueCurrent:false, invoiceAuthorized:false,
      receivableAuthorized:false, issueAuthorized:false, providerCallCount:0,receiverMutationCount:0,
      documentPreview:{ state:'review_required', fictional:false, issuedDocument:false,
        customerFacingDocumentAuthorized:false, pdf:{state:'unavailable',value:null}},
      reconciliation:{ preparedDocumentTotal:{state:'preparation_only'},
        amountDue:{state:'unavailable',reason:'invoice_reconciliation_evidence_unavailable',value:null},
        zeroRequiresExplicitSupportedArithmetic:true,missingEvidenceTreatedAsZero:false,
        browserArithmeticUsed:false } });
    expect(value.previewDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(value.draftIdentity).toMatchObject({ estimateId:estimate,
      originDigest:expect.stringMatching(/^[0-9a-f]{64}$/),
      draftDigest:expect.stringMatching(/^[0-9a-f]{64}$/),
      historyChainDigest:expect.stringMatching(/^[0-9a-f]{64}$/),
      componentsDigest:expect.stringMatching(/^[0-9a-f]{64}$/),
      preparationDigest:expect.stringMatching(/^[0-9a-f]{64}$/) });
    const lines = value.documentPreview.lines;
    expect(lines.length).toBeGreaterThan(0);expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines.reduce((sum,line)=>sum+BigInt(line.amount.minorUnits),0n).toString())
      .toBe(value.reconciliation.subtotalBeforeTax.minorUnits);
    expect(BigInt(value.reconciliation.subtotalBeforeTax.minorUnits)+
      BigInt(value.reconciliation.preparedTax.minorUnits))
      .toBe(BigInt(value.reconciliation.preparedDocumentTotal.value.minorUnits));
    expect(value.reconciliation.amountDue.missingEvidence).toHaveLength(6);
    expect(value.reconciliation.amountDue.missingEvidence.every(gap=>gap.state==='unavailable')).toBe(true);
    const repeated = await request(f.app).get(route).query(query).set(actor.session.headers);
    expect(repeated.status).toBe(200);expect(repeated.body.data.previewDigest).toBe(value.previewDigest);
    const after = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers`)).rows[0];
    expect(after).toEqual(before);
    await expect(f.runtimePool.query(
      "SELECT public.canonical_customer_financial_invoice_draft_preview_v1_unavailable('x')"))
      .rejects.toMatchObject({code:'42501'});
  }, 180000);

  test('mounted Part 5A validates the current paid source but returns the MFA gate value-free', async () => {
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const finalReviewRoute =
      `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-final-review`;
    expect((await request(f.app).get(finalReviewRoute).set(actor.session.headers)).status).toBe(400);
    expect((await request(f.app).get(finalReviewRoute).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(f.app).get(finalReviewRoute).query(query)
      .set(f.actors.otherOwner.session.headers);
    expect([403,404]).toContain(crossTenant.status);
    const before = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers`)).rows[0];
    const response = await request(f.app).get(finalReviewRoute).query(query)
      .set(actor.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.vary).toMatch(/Cookie/);
    expect(response.body.data).toMatchObject({
      contractVersion:'m27-invoice-final-review-v1', state:'unavailable',
      reason:'recent_auth_mfa_unavailable', value:null,
      requiredCapability:'customer_financial.invoice.approve',
      requiredAssurance:'recent_auth_mfa', sourceCurrent:false,
      approvalAuthorized:false,invoiceAuthorized:false,issueAuthorized:false,
      receivableAuthorized:false,providerCallCount:0,receiverMutationCount:0,
    });
    expect(response.body.data.missingEvidence.map(item=>item.reason)).toEqual([
      'recent_auth_fact_unavailable','mfa_authority_unavailable',
      'invoice_due_terms_policy_unavailable','invoice_delivery_choice_policy_unavailable',
      'invoice_reconciliation_evidence_unavailable',
    ]);
    expect(JSON.stringify(response.body.data)).not.toMatch(
      /customerId|workId|minorUnits|draftDigest|receiptId|deliveryChoice/);
    expect(await request(f.app).post(finalReviewRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).send({confirmed:true})).toMatchObject({status:404});
    const after = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers`)).rows[0];
    expect(after).toEqual(before);
  }, 180000);

  test('mounted Part 5B refuses issue readiness before reserving a number', async () => {
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const readinessRoute =
      `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-issue-readiness`;
    expect((await request(f.app).get(readinessRoute).set(actor.session.headers)).status).toBe(400);
    expect((await request(f.app).get(readinessRoute).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(f.app).get(readinessRoute).query(query)
      .set(f.actors.otherOwner.session.headers);
    expect([403,404]).toContain(crossTenant.status);
    const before = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) reservations,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_events_v1) events`)).rows[0];
    const first = await request(f.app).get(readinessRoute).query(query).set(actor.session.headers);
    const repeated = await request(f.app).get(readinessRoute).query(query).set(actor.session.headers);
    expect(first.status).toBe(200); expect(repeated.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers.vary).toMatch(/Cookie/);
    expect(first.body).toEqual(repeated.body);
    expect(first.body.data).toMatchObject({
      contractVersion:'m27-invoice-issue-readiness-v1', state:'unavailable',
      reason:'final_invoice_approval_unavailable', value:null,
      requiredCapability:'customer_financial.invoice.issue',
      requiredAssurance:'recent_auth_mfa', approvalCurrent:false,
      numberReservationAuthorized:false,numberAssigned:false,
      issueReceiptCreated:false,uncertainRetryAvailable:false,
      invoiceAuthorized:false,receivableAuthorized:false,
      providerCallCount:0,receiverMutationCount:0,
    });
    expect(first.body.data.missingEvidence.map(item=>item.reason)).toEqual([
      'final_invoice_approval_unavailable','approved_invoice_digest_unavailable',
      'recent_auth_fact_unavailable','mfa_authority_unavailable',
      'invoice_issue_capability_unavailable',
    ]);
    expect(JSON.stringify(first.body.data)).not.toMatch(
      /customerId|workId|minorUnits|draftDigest|receiptId|documentNumber|sequence/);
    const issueRoute = `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-issue`;
    expect(await request(f.app).post(issueRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).set('Idempotency-Key',crypto.randomUUID())
      .send({ confirmed:true })).toMatchObject({status:404});
    await expect(f.runtimePool.query(
      'SELECT public.canonical_customer_financial_numbering_v1_reserve($1,$2,$3,$4)',
      [f.org,'invoice',crypto.createHash('sha256').update('blocked-issue-key').digest('hex'),
        crypto.createHash('sha256').update('blocked-issue-request').digest('hex')]))
      .rejects.toMatchObject({code:'42501'});
    const after = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) reservations,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_events_v1) events`)).rows[0];
    expect(after).toEqual(before);
  }, 180000);

  test('mounted Part 5C retains every value-free lifecycle axis and performs no effect', async () => {
    const query = { handoffReceiptId: billableHandoffReceipt.receiptId,
      handoffReceiptDigest: billableHandoffReceipt.receiptDigest };
    const lifecycleRoute =
      `/api/v1/customer-financial/editable-estimates/${estimate}/invoice-lifecycle`;
    expect((await request(f.app).get(lifecycleRoute).set(actor.session.headers)).status).toBe(400);
    expect((await request(f.app).get(lifecycleRoute).query(query)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const crossTenant = await request(f.app).get(lifecycleRoute).query(query)
      .set(f.actors.otherOwner.session.headers);
    expect([403,404]).toContain(crossTenant.status);
    const before = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) reservations,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_events_v1) events`)).rows[0];
    const first = await request(f.app).get(lifecycleRoute).query(query).set(actor.session.headers);
    const repeated = await request(f.app).get(lifecycleRoute).query(query).set(actor.session.headers);
    expect(first.status).toBe(200); expect(repeated.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers.vary).toMatch(/Cookie/);
    expect(first.body).toEqual(repeated.body);
    expect(first.body.data).toMatchObject({
      contractVersion:'m27-invoice-lifecycle-projection-v1',state:'unavailable',
      reason:'issued_invoice_unavailable',value:null,issuedInvoiceCurrent:false,
      trustedClockEvaluated:false,reminderAuthorized:false,feeAuthorized:false,
      collectionAuthorized:false,automaticChargeAuthorized:false,
      providerCallCount:0,receiverMutationCount:0,
      display:{ policyVersion:'m27-invoice-lifecycle-display-precedence-v1',
        primaryAxis:'documentRevision',primaryState:'unavailable',
        primaryReason:'issued_invoice_unavailable',everyAxisRetained:true },
    });
    expect(first.body.data.axes.map(axis=>axis.axis)).toEqual([
      'documentRevision','delivery','paymentBalance','dueAging','disputeRefund',
      'settlement','accountingHandoff',
    ]);
    expect(first.body.data.display.precedence).toEqual(first.body.data.axes.map(axis=>axis.axis));
    expect(first.body.data.axes.every(axis=>axis.state==='unavailable' && axis.value===null))
      .toBe(true);
    expect(JSON.stringify(first.body.data)).not.toMatch(
      /customerId|workId|minorUnits|amount|currency|documentNumber|dueDate|invoiceDigest|receiptId/);
    expect(await request(f.app).post(lifecycleRoute).set(actor.session.headers)
      .set('X-CSRF-Token',actor.csrfToken).send({confirmed:true})).toMatchObject({status:404});
    const after = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) revisions,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) reservations,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_events_v1) events`)).rows[0];
    expect(after).toEqual(before);
  }, 180000);

  completeOnly('missing accepted deposit terms remain value-free and a real M23 source change clears reviewed final values', async () => {
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
    const originStale = await request(f.app)
      .get(`/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft-origin`)
      .query({ handoffReceiptId: billableHandoffReceipt.receiptId,
        handoffReceiptDigest: billableHandoffReceipt.receiptDigest }).set(actor.session.headers);
    expect(originStale.status).toBe(200);
    expect(originStale.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'reviewed_handoff_stale', sourceCurrent: false, invoiceAuthorized: false });
    expect(JSON.stringify(originStale.body.data)).not.toMatch(/minorUnits|description|customerId|sourceIdentity/);
    const draftStale = await request(f.app)
      .get(`/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft`)
      .query({ handoffReceiptId: billableHandoffReceipt.receiptId,
        handoffReceiptDigest: billableHandoffReceipt.receiptDigest }).set(actor.session.headers);
    expect(draftStale.status).toBe(200);
    expect(draftStale.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'reviewed_handoff_stale', sourceCurrent: false, invoiceAuthorized: false });
    expect(JSON.stringify(draftStale.body.data)).not.toMatch(/minorUnits|description|customerId|lines/);
    const componentsStale = await request(f.app)
      .get(`/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft/components`)
      .query({ handoffReceiptId: billableHandoffReceipt.receiptId,
        handoffReceiptDigest: billableHandoffReceipt.receiptDigest }).set(actor.session.headers);
    expect(componentsStale.status).toBe(200);
    expect(componentsStale.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'reviewed_handoff_stale', sourceCurrent: false,
      commercialSourceAuthorityCurrent: false, invoiceAuthorized: false,
      receivableAuthorized: false, issueAuthorized: false });
    expect(JSON.stringify(componentsStale.body.data)).not.toMatch(
      /minorUnits|commercialRevision|financialComponents|invoiceDraft/);
    const taxStale = await request(f.app)
      .get(`/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft/tax-review`)
      .query({ handoffReceiptId: billableHandoffReceipt.receiptId,
        handoffReceiptDigest: billableHandoffReceipt.receiptDigest }).set(actor.session.headers);
    expect(taxStale.status).toBe(200);
    expect(taxStale.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'reviewed_handoff_stale', sourceCurrent: false, taxAuthorityCurrent: false,
      taxBearingInvoiceAuthorized: false, invoiceAuthorized: false });
    expect(JSON.stringify(taxStale.body.data)).not.toMatch(/minorUnits|jurisdiction|preparation|reviewId/);
    const previewStale = await request(f.app)
      .get(`/api/v1/customer-financial/editable-estimates/${estimate}/invoice-draft/preview`)
      .query({ handoffReceiptId: billableHandoffReceipt.receiptId,
        handoffReceiptDigest: billableHandoffReceipt.receiptDigest }).set(actor.session.headers);
    expect(previewStale.status).toBe(200);
    expect(previewStale.body.data).toMatchObject({state:'unavailable',value:null,
      sourceCurrent:false,amountDueCurrent:false,invoiceAuthorized:false,receivableAuthorized:false,
      issueAuthorized:false,providerCallCount:0,receiverMutationCount:0});
    expect(JSON.stringify(previewStale.body.data)).not.toMatch(/minorUnits|description|documentPreview/);
    const lifecycleStale = await request(f.app)
      .get(`/api/v1/customer-financial/editable-estimates/${estimate}/invoice-lifecycle`)
      .query({ handoffReceiptId: billableHandoffReceipt.receiptId,
        handoffReceiptDigest: billableHandoffReceipt.receiptDigest }).set(actor.session.headers);
    expect(lifecycleStale.status).toBe(200);
    expect(lifecycleStale.body.data).toMatchObject({state:'unavailable',value:null,
      reason:'issued_invoice_unavailable',issuedInvoiceCurrent:false,
      trustedClockEvaluated:false,reminderAuthorized:false,feeAuthorized:false,
      collectionAuthorized:false,automaticChargeAuthorized:false,
      providerCallCount:0,receiverMutationCount:0});
    expect(lifecycleStale.body.data.axes).toHaveLength(7);
    expect(lifecycleStale.body.data.axes.every(axis=>axis.value===null)).toBe(true);
    expect(JSON.stringify(lifecycleStale.body.data)).not.toMatch(
      /customerId|workId|minorUnits|amount|currency|documentNumber|dueDate|invoiceDigest|receiptId/);
    const stale = await readReview(actor, 'final_balance');
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'unavailable', value: null,
      reason: 'source_currentness_unavailable', financialActionAuthorized: false,
      invoiceAuthorized: false });
    expect(JSON.stringify(stale.body.data)).not.toMatch(
      /amount|sourceDigest|commercialBasisDigest|approvals|reviewId|workId/);
  }, 180000);

  completeOnly('mounted access, CSRF, tenant privacy, immutable tables and direct runtime access fail closed', async () => {
    expect((await request(f.app).get(route).set(actor.session.headers)).status).toBe(400);
    expect((await readReview(f.actors.viewer, 'final_balance')).status).toBe(403);
    const crossTenant = await readReview(f.actors.otherOwner, 'final_balance');
    expect([200,403,404,503]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toContain(estimate);
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_billable_work_reviews_v1',
    )).rejects.toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_billable_handoff_receipts_v1',
    )).rejects.toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_invoice_draft_origins_v1',
    )).rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      `UPDATE canonical_customer_financial_billable_work_reviews_v1
       SET review_reason='Mutation forbidden' WHERE organization_id=$1`, [f.org],
    )).rejects.toMatchObject({ code: '55000' });
    await expect(f.ownerPool.query(
      `UPDATE canonical_customer_financial_billable_handoff_receipts_v1
       SET created_at=created_at WHERE organization_id=$1`, [f.org],
    )).rejects.toMatchObject({ code: '55000' });
    const migration = (await f.ownerPool.query(
      "SELECT filename FROM _migrations ORDER BY id DESC LIMIT 1",
    )).rows[0];
    expect(migration.filename).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
  }, 180000);

  completeOnly('mounted mobile quote journey consumes the exact current Mission 24 proposal and permits bounded member editing', async () => {
    const quoteRoute = `/api/v1/customer-financial/editable-estimates/${estimate}/quote-journey`;
    await expect(issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate,
    'customer_financial.estimate.edit_options')).rejects.toMatchObject({ code: '23505' });
    const currentMission24 = (await f.ownerPool.query(`SELECT id,revision,
      rtrim(document_digest) document_digest,rtrim(digest) revision_digest,document
      FROM canonical_customer_estimate_versions WHERE organization_id=$1 AND estimate_id=$2
      ORDER BY revision DESC LIMIT 1`, [f.org, estimate])).rows[0];
    const initial = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({ state: 'ready_to_edit', revision: 0,
      machineDraftApprovedPrice: false, signature: { state: 'unavailable',
        reason: 'legal_review_unavailable' }, workHandoff: { state: 'unavailable',
        reason: 'work_handoff_receiver_unavailable' }, providerCallCount: 0,
      receiverMutationCount: 0 });
    expect(initial.body.data.capabilities['customer_financial.estimate.edit_options']).toMatchObject({
      grantId: quoteOptionGrant.grantId, revision: quoteOptionGrant.revision });
    expect(initial.body.data.sourceProposal).toMatchObject({
      version: 'mission24.customer_estimate_version.v1', id: currentMission24.id,
      revision: Number(currentMission24.revision), estimateId: estimate,
      customerId: initial.body.data.customerId, sourceCurrent: true, automaticDelivery: false,
      sourceProposalDigest: currentMission24.document_digest,
      sourceProposalRevisionDigest: currentMission24.revision_digest,
      reviewedRecipient: { state: 'reviewed_current',
        name: currentMission24.document.customer.name,
        address: currentMission24.document.customer.address },
    });
    expect(initial.body.data.sourceProposal.sourceProposalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(initial.body.data.sourceProposal.sourceProposalRevisionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(initial.body.data.sourceProposal.acceptedEvidence.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(initial.body.data.sourceProposal.acceptedEvidence.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(initial.body.data.sourceProposal.reviewedRecipient.digest).toMatch(/^[0-9a-f]{64}$/);
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
    const memberRead = await request(f.app).get(quoteRoute).set(f.actors.member.session.headers);
    expect(memberRead.status).toBe(200);
    expect(memberRead.body.data).toMatchObject({ state: 'current', draft: { revision: 1 },
      sourceProposal: { sourceProposalDigest: initial.body.data.sourceProposal.sourceProposalDigest },
      capabilities: { 'customer_financial.estimate.edit_options': {
        grantId: quoteMemberOptionGrant.grantId, revision: quoteMemberOptionGrant.revision } } });
    expect(memberRead.body.data.capabilities['customer_financial.estimate.request_signature'])
      .toBeUndefined();
    expect(memberRead.body.data.revisionHistory).toMatchObject({
      contractVersion: 'm27-polaris-revision-history-v1', state: 'current',
      currentRevision: 1, sourceOriginal: { revision: 0,
        sourceProposalDigest: initial.body.data.sourceProposal.sourceProposalDigest },
      humanRevisions: [{ revision: 1, actorUserId: actor.actorUserId,
        reason: 'Owner reviewed every option and line field.' }],
      mission25Observation: { adapter: 'mission25.tenant_edit_observation.v1',
        state: 'unavailable', reason: 'learning_permission_unavailable',
        published: false, automaticApplication: false },
      mission32Adapter: { name: 'polaris.estimate_studio.adapter.v1',
        compatibleSchemaVersion: 1, state: 'compatible_contract',
        estimateId: estimate, revision: 1, mayCreateParallelEstimate: false,
        mayDuplicateAcceptedMath: false, receiverExecutionAvailable: false,
        receiverMutationCount: 0 },
      providerCallCount: 0, receiverMutationCount: 0, learningWriteCount: 0,
    });
    const revisedDraft = { options: memberRead.body.data.draft.options.map(option => ({
      id: option.id, name: option.name, scope: option.scope, validityDays: option.validityDays,
      assumptions: option.assumptions.map(assumption => assumption.text || assumption),
      lines: option.lines.map(line => ({ id: line.id, description: line.description,
        quantity: line.quantity, unit: line.unit, price: line.price })),
    })) };
    revisedDraft.options[0].scope = 'Member revised the reviewed fence scope.';
    const revise = await request(f.app).post(`${quoteRoute}/draft`)
      .set(f.actors.member.session.headers)
      .set('X-CSRF-Token', f.actors.member.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ draft: revisedDraft, expectedRevision: 1,
        capabilityGrantId: quoteMemberOptionGrant.grantId,
        capabilityGrantRevision: quoteMemberOptionGrant.revision,
        businessPurpose: PURPOSE['customer_financial.estimate.edit_options'],
        policyVersion: 'mission27.launch.v1', reason: 'Member reviewed the revised option scope.',
        confirmed: true, confirmationVersion: 'm27-polaris-quote-journey-v1' });
    expect(revise.status).toBe(201);
    expect(revise.body.data).toMatchObject({
      signatureInvalidated: true, handoffInvalidated: true, draft: { revision: 2 } });
    const cleared = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ draft: { revision: 2 },
      sourceProposal: { sourceProposalDigest: initial.body.data.sourceProposal.sourceProposalDigest },
      signature: { state: 'unavailable', reason: 'legal_review_unavailable' },
      revisionHistory: { state: 'current', currentRevision: 2,
        humanRevisions: [{ revision: 2,
          actorUserId: f.actors.member.actorUserId,
          reason: 'Member reviewed the revised option scope.' }, { revision: 1 }] } });
    expect(cleared.body.data.revisionHistory.historyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(cleared.body.data.revisionHistory.mission32Adapter.optionIdentities).toHaveLength(2);
    expect(cleared.body.data.revisionHistory.mission32Adapter.lineIdentities).toHaveLength(2);
    const immutableHistory = await f.ownerPool.query(`SELECT revision,revision_class,
      actor_user_id,reason,rtrim(snapshot_digest) snapshot_digest
      FROM canonical_customer_financial_estimate_journey_revisions_v1
      WHERE organization_id=$1 AND estimate_id=$2 ORDER BY revision`, [f.org, estimate]);
    expect(immutableHistory.rows.map(row => Number(row.revision))).toEqual([0,1,2]);
    expect(immutableHistory.rows.map(row => row.revision_class)).toEqual([
      'source_original','human_revision','human_revision']);
    await expect(f.ownerPool.query(`UPDATE canonical_customer_financial_estimate_journey_revisions_v1
      SET reason='Mutation forbidden' WHERE organization_id=$1 AND estimate_id=$2`,
    [f.org, estimate])).rejects.toMatchObject({ code: '55000' });
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_estimate_journey_revisions_v1',
    )).rejects.toMatchObject({ code: '42501' });
    const ownerRaceDraft = JSON.parse(JSON.stringify(revisedDraft));
    ownerRaceDraft.options[0].scope = 'Owner concurrency winner candidate.';
    const memberRaceDraft = JSON.parse(JSON.stringify(revisedDraft));
    memberRaceDraft.options[0].scope = 'Member concurrency winner candidate.';
    const race = await Promise.all([
      request(f.app).post(`${quoteRoute}/draft`).set(actor.session.headers)
        .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
        .send({ draft: ownerRaceDraft, expectedRevision: 2,
          capabilityGrantId: quoteOptionGrant.grantId,
          capabilityGrantRevision: quoteOptionGrant.revision,
          businessPurpose: PURPOSE['customer_financial.estimate.edit_options'],
          policyVersion: 'mission27.launch.v1', reason: 'Owner submitted one concurrent exact revision.',
          confirmed: true, confirmationVersion: 'm27-polaris-quote-journey-v1' }),
      request(f.app).post(`${quoteRoute}/draft`).set(f.actors.member.session.headers)
        .set('X-CSRF-Token', f.actors.member.csrfToken).set('Idempotency-Key', crypto.randomUUID())
        .send({ draft: memberRaceDraft, expectedRevision: 2,
          capabilityGrantId: quoteMemberOptionGrant.grantId,
          capabilityGrantRevision: quoteMemberOptionGrant.revision,
          businessPurpose: PURPOSE['customer_financial.estimate.edit_options'],
          policyVersion: 'mission27.launch.v1', reason: 'Member submitted one concurrent exact revision.',
          confirmed: true, confirmationVersion: 'm27-polaris-quote-journey-v1' }),
    ]);
    expect(race.map(value => value.status).sort()).toEqual([201,409]);
    const afterRace = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(afterRace.status).toBe(200);
    expect(afterRace.body.data.revisionHistory).toMatchObject({ state: 'current',
      currentRevision: 3, humanRevisions: [{ revision: 3 }, { revision: 2 }, { revision: 1 }] });
    const raceRows = await f.ownerPool.query(`SELECT revision,count(*)::int total
      FROM canonical_customer_financial_estimate_journey_revisions_v1
      WHERE organization_id=$1 AND estimate_id=$2 GROUP BY revision ORDER BY revision`, [f.org, estimate]);
    expect(raceRows.rows.map(row => [Number(row.revision),row.total])).toEqual([[0,1],[1,1],[2,1],[3,1]]);
    let expectedRevision = 3;
    const rollingDraft = { options: afterRace.body.data.draft.options.map(option => ({
      id: option.id, name: option.name, scope: option.scope, validityDays: option.validityDays,
      assumptions: option.assumptions.map(assumption => assumption.text || assumption),
      lines: option.lines.map(line => ({ id: line.id, description: line.description,
        quantity: line.quantity, unit: line.unit, price: line.price })),
    })) };
    while (expectedRevision < 25) {
      rollingDraft.options[0].scope = `Bounded immutable revision ${expectedRevision + 1}.`;
      const response = await request(f.app).post(`${quoteRoute}/draft`).set(actor.session.headers)
        .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
        .send({ draft: rollingDraft, expectedRevision,
          capabilityGrantId: quoteOptionGrant.grantId,
          capabilityGrantRevision: quoteOptionGrant.revision,
          businessPurpose: PURPOSE['customer_financial.estimate.edit_options'],
          policyVersion: 'mission27.launch.v1',
          reason: `Owner retained bounded history revision ${expectedRevision + 1}.`,
          confirmed: true, confirmationVersion: 'm27-polaris-quote-journey-v1' });
      expect(response.status).toBe(201); expectedRevision += 1;
    }
    const boundedLatest = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(boundedLatest.status).toBe(200);
    expect(boundedLatest.body.data.revisionHistory.pagination).toEqual({
      limit: 20, beforeRevision: null, returned: 20, returnedRecords: 20, total: 26,
      humanReturned: 20, totalHumanRevisions: 25, totalRecords: 26,
      order: 'revision_desc', nextCursor: 6, hasEarlier: true, hasLatest: false, truncated: true,
    });
    expect(boundedLatest.body.data.revisionHistory.sourceOriginal).toBeNull();
    expect(boundedLatest.body.data.revisionHistory.humanRevisions.map(item => item.revision))
      .toEqual(Array.from({ length: 20 }, (_, index) => 25 - index));
    expect(boundedLatest.body.data.revisionHistory.humanRevisions.every(item =>
      item.snapshot === undefined)).toBe(true);
    const boundedEarlier = await request(f.app).get(`${quoteRoute}?historyLimit=20&historyBefore=6`)
      .set(actor.session.headers);
    expect(boundedEarlier.status).toBe(200);
    expect(boundedEarlier.body.data.revisionHistory.humanRevisions.map(item => item.revision))
      .toEqual([5,4,3,2,1]);
    expect(boundedEarlier.body.data.revisionHistory.sourceOriginal).toMatchObject({ revision: 0 });
    expect(boundedEarlier.body.data.revisionHistory.pagination).toEqual({
      limit: 20, beforeRevision: 6, returned: 6, returnedRecords: 6, total: 26,
      humanReturned: 5, totalHumanRevisions: 25, totalRecords: 26,
      nextCursor: null, hasEarlier: false, hasLatest: true, order: 'revision_desc', truncated: true });
    const boundedIdentities = [
      ...boundedLatest.body.data.revisionHistory.humanRevisions.map(item => `human:${item.revision}`),
      ...boundedEarlier.body.data.revisionHistory.humanRevisions.map(item => `human:${item.revision}`),
      'source:0',
    ];
    expect(boundedIdentities).toHaveLength(26);
    expect(new Set(boundedIdentities).size).toBe(26);
    expect(boundedLatest.body.data.currentness).toMatchObject({ draftRevision: 25,
      draftUpdatedAt: boundedLatest.body.data.draft.updatedAt,
      historyCurrentRevision: 25,
      historyCurrentUpdatedAt: boundedLatest.body.data.revisionHistory.currentUpdatedAt,
      historyChainDigest: boundedLatest.body.data.revisionHistory.historyDigest,
      sourceProposalDigest: boundedLatest.body.data.sourceProposal.sourceProposalDigest,
      sourceProposalRevisionDigest: boundedLatest.body.data.sourceProposal.sourceProposalRevisionDigest });
    expect(boundedLatest.body.data.currentness.identityDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(boundedLatest.body.data.currentness.capabilityDigest).toMatch(/^[0-9a-f]{64}$/);
    const mountedWitness = boundedLatest.body.data.currentness;
    const sameContentDigest = boundedLatest.body.data.draft.draftDigest;
    const sameContentRevision = await request(f.app).post(`${quoteRoute}/draft`)
      .set(f.actors.member.session.headers)
      .set('X-CSRF-Token', f.actors.member.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ draft: rollingDraft, expectedRevision: 25,
        capabilityGrantId: quoteMemberOptionGrant.grantId,
        capabilityGrantRevision: quoteMemberOptionGrant.revision,
        businessPurpose: PURPOSE['customer_financial.estimate.edit_options'],
        policyVersion: 'mission27.launch.v1',
        reason: 'Member recorded the same content under a new independent review.',
        confirmed: true, confirmationVersion: 'm27-polaris-quote-journey-v1' });
    expect(sameContentRevision.status).toBe(201);
    expect(sameContentRevision.body.data.draft).toMatchObject({ revision: 26,
      draftDigest: sameContentDigest });
    const afterSameContentRevision = await request(f.app).get(`${quoteRoute}?historyLimit=20&historyBefore=6`)
      .set(actor.session.headers);
    expect(afterSameContentRevision.status).toBe(200);
    expect(afterSameContentRevision.body.data.draft).toMatchObject({ revision: 26,
      draftDigest: sameContentDigest });
    expect(afterSameContentRevision.body.data.currentness).toMatchObject({ draftRevision: 26,
      historyCurrentRevision: 26,
      historyChainDigest: afterSameContentRevision.body.data.revisionHistory.historyDigest });
    expect(afterSameContentRevision.body.data.currentness.identityDigest).not.toBe(mountedWitness.identityDigest);
    expect(afterSameContentRevision.body.data.currentness.historyChainDigest)
      .not.toBe(mountedWitness.historyChainDigest);
    expect(afterSameContentRevision.body.data.currentness.draftUpdatedAt)
      .not.toBe(mountedWitness.draftUpdatedAt);
    expect((await request(f.app).get(`${quoteRoute}?historyLimit=0`)
      .set(actor.session.headers)).status).toBe(400);
    expect((await request(f.app).get(`${quoteRoute}?historyLimit=20&unexpected=true`)
      .set(actor.session.headers)).status).toBe(400);
    const retainedRows = await f.ownerPool.query(`SELECT revision,rtrim(history_chain_digest) history_chain_digest
      FROM canonical_customer_financial_estimate_journey_revisions_v1
      WHERE organization_id=$1 AND estimate_id=$2 ORDER BY revision`, [f.org, estimate]);
    expect(retainedRows.rows).toHaveLength(27);
    expect(new Set(retainedRows.rows.map(row => row.history_chain_digest)).size).toBe(27);
    const staleSaveReplay = await request(f.app).post(`${quoteRoute}/draft`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', saveKey).send(saveBody);
    expect(staleSaveReplay.status).toBe(409);
    expect(JSON.stringify(staleSaveReplay.body)).not.toContain('28148');
    expect((await request(f.app).post(`${quoteRoute}/proposal`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({})).status).toBe(404);
    await expect(issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: f.actors.member.actorUserId, membershipId: f.actors.member.actorUserId,
      actorAccessRole: f.actors.member.actorAccessRole }, estimate,
    'customer_financial.estimate.request_signature')).rejects.toThrow(/restricted/i);
    expect((await request(f.app).get(quoteRoute).set(f.actors.viewer.session.headers)).status).toBe(403);
    const otherTenant = await request(f.app).get(quoteRoute).set(f.actors.otherOwner.session.headers);
    expect([200,403,404,503]).toContain(otherTenant.status);
    expect(JSON.stringify(otherTenant.body)).not.toContain(estimate);
    const proposalTables = (await f.ownerPool.query(`SELECT
      to_regclass('public.canonical_customer_estimate_multi_option_proposals_v1') multi,
      to_regclass('public.canonical_customer_estimate_proposal_reviews_v1') reviews`)).rows[0];
    expect(proposalTables).toEqual({ multi: null, reviews: null });
    const mutationCounts = (await f.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_schedule_human_approvals) schedule,
      (SELECT count(*)::int FROM canonical_field_executions) executions,
      (SELECT count(*)::int FROM canonical_customer_financial_numbering_reservations_v1) numbers`)).rows[0];
    expect(mutationCounts.executions).toBe(1);
    expect(mutationCounts.numbers).toBe(0);

    const acceptedLink = (await f.ownerPool.query(`SELECT event.link_id
      FROM canonical_customer_estimate_delivery_events event
      WHERE event.organization_id=$1 AND event.estimate_id=$2 AND event.kind='accepted'
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1`, [f.org, estimate])).rows[0].link_id;
    const reopenedMission24 = await request(f.app)
      .post(`/api/v1/canonical/estimates/${estimate}/customer-estimate-links/${acceptedLink}/revoke`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({});
    expect(reopenedMission24.status).toBe(201);
    const staleQuote = await request(f.app).get(quoteRoute).set(actor.session.headers);
    expect(staleQuote.status).toBe(200);
    expect(staleQuote.body.data).toMatchObject({ state: 'unavailable',
      reason: 'source_currentness_unavailable', value: null });
    expect(JSON.stringify(staleQuote.body.data)).not.toMatch(
      /900000|Owner concurrency winner|Member concurrency winner|historyDigest|grantId|reviewedRecipient/);
    const preserved = await f.ownerPool.query(`SELECT count(*)::int total
      FROM canonical_customer_financial_estimate_journey_revisions_v1
      WHERE organization_id=$1 AND estimate_id=$2`, [f.org, estimate]);
    expect(preserved.rows[0].total).toBe(27);
  }, 240000);

});
