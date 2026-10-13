'use strict';

// Synthetic, disposable acceptance fixture. It creates the released Mission 24
// commercial source, Mission 22 schedule, Mission 23 completed-work evidence,
// reviewed Mission 27 Part 3 final-balance handoff and reviewed billing identity.
// It deliberately stops before every Part 4 effect so a real browser must use
// the mounted product routes to capture, edit, review and preview the draft.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('./m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('./m24-commercial-input');
const { fixture: pricingFixture } = require('./m24-pricing-input');
const { issueBillableWorkReviewGrant, BUSINESS_PURPOSE, POLICY_VERSION } =
  require('../../src/customerFinancial/billableWorkReviewGrantIssuer');
const { issueEditableEstimateGrant } =
  require('../../src/customerFinancial/estimateCapabilityGrantIssuer');
const billingIdentity = require('../../src/customerFinancial/billingIdentityRepository');
const operations = require('../../src/operations/repository');
const operationContracts = require('../../src/operations/contract');

function ok(response, expected, label) {
  assert.equal(response.status, expected, `${label}: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body && response.body.data;
}

async function createPart4ePaidBrowserFixture() {
  for (const key of ['OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY',
    'STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
    delete process.env[key];
  }
  const f = await createEstimateReviewFixture({ operationalSchedule: true,
    proposalScope: { locationId: 'headquarters' } });
  const actor = f.actors.owner;
  const estimate = f.estimateGraphs[0].ids.estimate;
  const appointment = f.estimateGraphs[0].ids.appointment;
  const customer = f.estimateGraphs[0].ids.customer;
  let context; let firstReviewId; let laborInterval; let materialMovement;
  const profileRow = (await f.ownerPool.query(`SELECT id,version_number,
    rtrim(normalized_profile_hash) profile_hash,raw_profile#>>'{company,timeZone}' time_zone
    FROM canonical_business_profiles WHERE organization_id=$1 AND is_active`, [f.org])).rows[0];
  const businessProfile = { businessProfileId: profileRow.id,
    version: Number(profileRow.version_number), hash: profileRow.profile_hash,
    timeZone: profileRow.time_zone };

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
        scheduledStart, scheduledEnd, appointmentStatus: before.appointment_status,
        reason: `Part 4E browser fixture ${action} review` });
    ok(preview, 201, `schedule ${action} preview`);
    const saved = await request(f.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason: `Part 4E browser fixture ${action} review` });
    ok(saved, 200, `schedule ${action}`);
    return (await f.ownerPool.query(
      'SELECT id FROM canonical_schedule_human_approvals WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC,id DESC LIMIT 1',
      [f.org, appointment])).rows[0].id;
  }

  async function prepareWorkforceAuthority() {
    const skill = await request(f.app).post('/api/workforce/skills')
      .set(actor.session.headers).send({ key: 'fence', name: 'Fence installation',
        description: 'Synthetic accepted fence scheduling skill.', serviceId: 'fence' });
    const skillValue = ok(skill, 201, 'workforce skill');
    ok(await request(f.app).put(`/api/workforce/profiles/${f.actors.owner.actorUserId}`)
      .set(actor.session.headers).send({ operationalRole: 'owner', homeLocationId: 'headquarters',
        skillIds: [skillValue.id] }), 200, 'owner workforce profile');
    ok(await request(f.app).put(`/api/workforce/profiles/${f.actors.member.actorUserId}`)
      .set(actor.session.headers).send({ operationalRole: 'technician', homeLocationId: 'headquarters',
        skillIds: [skillValue.id] }), 200, 'member workforce profile');
    ok(await request(f.app).put(`/api/v1/canonical/availability/profiles/${f.actors.member.actorUserId}`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: '2029-06-01T00:00:00.000Z', coverageEnd: '2029-07-01T00:00:00.000Z',
        intervals: [{ kind: 'available', start: '2029-06-01T00:00:00.000Z',
          end: '2029-07-01T00:00:00.000Z' }],
        reason: 'Owner reviewed synthetic Part 4E browser availability.' }), 200, 'availability');
  }

  async function createCurrentCommercialLineage() {
    const estimateRoute = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(estimateRoute + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(estimateRoute + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);
    ok(await request(f.app).post('/api/v1/forecast/price-history/ordered-snapshots')
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({}), 201, 'price snapshot');
    ok(await request(f.app).post('/api/v1/forecast/price-history/ordered-anchor/activate')
      .set(actor.session.headers).send({}), 200, 'price anchor');
    let review = ok(await get('/review'), 200, 'estimate review');
    ok(await post('/pricing-plans', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: { ...pricingFixture(review.pricingPlans.serviceKey), lines: [{
        ...pricingFixture(review.pricingPlans.serviceKey).lines[0], amount: '15000.00',
      }] }, currency: review.currency, reason: 'Synthetic Part 4E browser pricing source',
      confirmed: true, confirmationVersion: review.pricingPlans.contract,
      evidenceDigest: review.pricingPlans.sources.digest }), 201, 'pricing plan');
    review = ok(await get('/review'), 200, 'estimate review after price');
    const terms = review.commercialTerms; const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = { serviceOperation: 'fence_installation', propertyUse: 'residential',
      workContext: 'new_construction', customerExemption: 'none',
      evidenceRef: { serviceOperation: 'Reviewed scope', propertyUse: 'Recorded property',
        workContext: 'Reviewed scope', customerExemption: 'Customer statement' } };
    inputs.transactionDate = terms.sources.asOfDate;
    inputs.taxGroups = [group(['installation'], { behavior: 'exclusive' })];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, { legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn,
      legalEndsOn: null, reviewedOn: terms.sources.asOfDate,
      reviewValidThrough: terms.sources.asOfDate });
    delete inputs.taxGroups[0].source.effectiveOn; delete inputs.taxGroups[0].source.endsOn;
    ok(await post('/commercial-terms', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs, currency: review.currency,
      reason: 'Synthetic Part 4E browser commercial terms', confirmed: true,
      confirmationVersion: terms.contract, evidenceDigest: terms.sources.digest }), 201, 'commercial terms');
    review = ok(await get('/review'), 200, 'estimate review after terms');
    ok(await post('/commercial-approvals', { termsPin: commercial.pin(review.commercialTerms.current),
      evidenceDigest: review.commercialTerms.sources.digest,
      expectedDecisionRevision: review.commercialTerms.decisionBasis.revision,
      expectedDecisionDigest: review.commercialTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
      reason: 'Synthetic Part 4E browser approved commercial scope', confirmed: true,
      confirmationVersion: review.commercialTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true } }), 201, 'commercial approval');
    const issued = ok(await post('/customer-estimate-versions', {
      reason: 'Synthetic Part 4E browser issued customer estimate', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1' }), 201, 'estimate issue');
    const link = ok(await post('/customer-estimate-links', { versionId: issued.receipt.id,
      expiresInDays: 14, confirmed: true,
      confirmationVersion: 'customer-estimate-delivery-v1' }), 201, 'estimate link');
    const token = decodeURIComponent(link.urlPath.split('/').pop());
    ok(await request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID()).send({ customerName: 'Taylor Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' }), 201, 'estimate acceptance');
    const approval = await scheduleAction('schedule', { kind: 'unassigned', id: null });
    const booking = await request(f.app).post('/api/v1/forecast/booking-reviews/first')
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        approvalId: approval, reason: 'Human reviewed the Part 4E browser accepted scheduled work.' });
    firstReviewId = ok(booking, 201, 'booking review').reviewId;
  }

  async function assignDispatchAndCorrectBooking() {
    await scheduleAction('assign', { kind: 'profile', id: f.actors.member.actorUserId });
    const approvalId = await scheduleAction('dispatch', { kind: 'profile', id: f.actors.member.actorUserId });
    ok(await request(f.app).post(`/api/v1/forecast/booking-reviews/${firstReviewId}/correct`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        approvalId, reason: 'Human reviewed the assigned and dispatched Part 4E browser work.' }),
    201, 'booking correction');
  }

  async function createAndCompleteExecution() {
    const assignment = (await f.ownerPool.query(
      'SELECT id,revision,rtrim(canonical_digest) digest FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    let execution = (await operations.initializeFieldExecution(f.runtimePool, { ...actor,
      appointmentId: appointment, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, idempotencyKey: crypto.randomUUID(),
      reason: 'Initialize synthetic Part 4E browser work', requestCorrelationId: 'm27-p4e-browser-init' })).body.data;
    execution = (await operations.transitionFieldExecution(f.runtimePool, { ...actor,
      executionId: execution.id, expectedRevision: execution.revision,
      expectedDigest: execution.digest, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, action: 'start',
      idempotencyKey: crypto.randomUUID(), reason: 'Start synthetic Part 4E browser work',
      requestCorrelationId: 'm27-p4e-browser-start' })).body.data;
    const value = { actor, assignment: { ...assignment, revision: Number(assignment.revision) }, execution };
    const member = f.actors.member;
    const base = `/api/v1/field-executions/${execution.id}`;
    const sourcePins = { expectedExecutionRevision: execution.revision,
      expectedExecutionDigest: execution.digest,
      expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest,
      performerProfileId: member.actorUserId };
    laborInterval = ok(await request(f.app).post(`${base}/labor-actions`)
      .set(member.session.headers).set('X-CSRF-Token', member.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ ...sourcePins,
        action: 'record_manual', category: 'production',
        categoryContractVersion: operationContracts.LABOR_CATEGORY_CONTRACT_VERSION,
        categoryContractDigest: operationContracts.LABOR_CATEGORY_CONTRACT_DIGEST,
        businessProfileId: businessProfile.businessProfileId,
        businessProfileVersion: businessProfile.version, businessProfileHash: businessProfile.hash,
        timeZone: businessProfile.timeZone,
        observedStart: new Date(Date.now() - 3600000).toISOString(),
        observedEnd: new Date(Date.now() - 1800000).toISOString(),
        reason: 'Synthetic Part 4E browser source labor' }), 200, 'labor record');
    laborInterval = ok(await request(f.app).post(`${base}/labor-actions`)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ ...sourcePins,
        action: 'review', categoryContractVersion: operationContracts.LABOR_CATEGORY_CONTRACT_VERSION,
        categoryContractDigest: operationContracts.LABOR_CATEGORY_CONTRACT_DIGEST,
        businessProfileId: businessProfile.businessProfileId,
        businessProfileVersion: businessProfile.version, businessProfileHash: businessProfile.hash,
        timeZone: businessProfile.timeZone, intervalId: laborInterval.id,
        expectedIntervalRevision: laborInterval.revision, expectedIntervalDigest: laborInterval.digest,
        reviewOutcome: 'accepted', reason: 'Owner accepts synthetic Part 4E browser labor' }),
    200, 'labor review');
    const material = await operations.mutateMaterialInventory(f.ownerPool, { ...actor,
      organizationId: f.org, executionId: execution.id, csrfToken: actor.csrfToken,
      idempotencyKey: crypto.randomUUID(), requestCorrelationId: `m27-p4e-browser-material-${crypto.randomUUID()}`,
      ...sourcePins, action: 'record', movementKind: 'adjustment', itemKey: 'fence-board',
      description: 'Synthetic Part 4E browser source material', quantity: '2', unitCode: 'ea',
      unitContractVersion: operationContracts.MATERIAL_UNIT_CONTRACT_VERSION,
      unitContractDigest: operationContracts.MATERIAL_UNIT_CONTRACT_DIGEST,
      locationKey: 'van-01', adjustmentDirection: 'increase',
      reason: 'Synthetic Part 4E browser source material' });
    assert.equal(material.status, 200); materialMovement = material.body.data.material;
    const materialReview = await operations.mutateMaterialInventory(f.ownerPool, { ...actor,
      organizationId: f.org, executionId: execution.id, csrfToken: actor.csrfToken,
      idempotencyKey: crypto.randomUUID(), requestCorrelationId: `m27-p4e-browser-material-review-${crypto.randomUUID()}`,
      ...sourcePins, action: 'review', performerProfileId: member.actorUserId,
      unitContractVersion: operationContracts.MATERIAL_UNIT_CONTRACT_VERSION,
      unitContractDigest: operationContracts.MATERIAL_UNIT_CONTRACT_DIGEST,
      movementId: materialMovement.id, expectedMovementRevision: materialMovement.revision,
      expectedMovementDigest: materialMovement.digest, reviewOutcome: 'accepted',
      reason: 'Owner accepts synthetic Part 4E browser material' });
    assert.equal(materialReview.status, 200); materialMovement = materialReview.body.data.material;
    const proposed = await f.completion(value);
    const proposal = proposed.body.completionRecord;
    await f.completion(value, 'approve_completion', { proposal: {
      id: proposal.id, revision: proposal.revision, digest: proposal.digest } });
    return value;
  }

  async function prepareMission27Handoff() {
    const source = await request(f.app)
      .get(`/api/v1/field-executions/${context.execution.id}/handoffs`).set(actor.session.headers);
    ok(source, 200, 'Mission 23 handoff source');
    ok(await request(f.app).post(`/api/v1/field-executions/${context.execution.id}/handoff-actions`)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({ action: 'prepare', mission: 27,
        audience: 'tenant_owner_admin_review', consentVersion: 'm23-internal-reference-consent-v1',
        consentConfirmed: true, sourceDigest: source.body.data.sourceDigest, targetId: null }),
    201, 'Mission 27 handoff');
  }

  async function prepareReviewedFinalBalance() {
    const route = `/api/v1/customer-financial/editable-estimates/${estimate}/billable-work-review`;
    const ownerGrant = await issueBillableWorkReviewGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate);
    const adminGrant = await issueBillableWorkReviewGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: f.actors.admin.actorUserId, membershipId: f.actors.admin.actorUserId,
      actorAccessRole: f.actors.admin.actorAccessRole }, estimate);
    const candidate = ok(await request(f.app).get(route).query({ sourceClass: 'final_balance' })
      .set(actor.session.headers), 200, 'final balance candidate');
    const body = (grant, reason) => ({ sourceClass: 'final_balance', confirmed: true,
      confirmationVersion: 'm27-billable-work-review-v1',
      expectedDecisionDigest: candidate.source.decisionDigest,
      capabilityGrantId: grant.grantId, capabilityGrantRevision: grant.revision,
      businessPurpose: BUSINESS_PURPOSE, policyVersion: POLICY_VERSION, reason });
    ok(await request(f.app).post(route).set(actor.session.headers)
      .set('Idempotency-Key', crypto.randomUUID())
      .send(body(ownerGrant, 'Owner reviewed this exact browser final-balance source.')),
    202, 'owner final balance review');
    const accepted = ok(await request(f.app).post(route).set(f.actors.admin.session.headers)
      .set('Idempotency-Key', crypto.randomUUID())
      .send(body(adminGrant, 'Administrator independently reviewed this browser final balance.')),
    201, 'admin final balance review');
    assert.equal(accepted.state, 'reviewed_current');
    return accepted.handoffReceipt;
  }

  async function prepareReviewedBillingIdentity() {
    const grantId = crypto.randomUUID();
    await f.ownerPool.query(
      `INSERT INTO canonical_customer_financial_billing_capability_grants_v1(
        organization_id,id,revision,actor_user_id,membership_id,customer_id,capability,
        business_purpose,policy_version,template_version,active,valid_from,expires_at,issued_at)
       VALUES($1,$2,1,$3,$3,$4,$5,$6,$7,'m27.owner.v1',TRUE,
        clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
      [f.org, grantId, actor.actorUserId, customer, billingIdentity.CAPABILITY,
        billingIdentity.BUSINESS_PURPOSE, billingIdentity.POLICY_VERSION]);
    const route = `/api/v1/customer-financial/billing-identities/${customer}`;
    let current = ok(await request(f.app).get(route).set(actor.session.headers), 200, 'billing candidate');
    ok(await request(f.app).post(`${route}/establish`).set(actor.session.headers)
      .set('Idempotency-Key', crypto.randomUUID()).send({
        expectedSourceDigest: current.identity.sourceDigest,
        expectedSourceUpdatedAt: current.identity.sourceUpdatedAt,
        reason: 'Begin exact browser billing jurisdiction review.' }), 201, 'billing establish');
    current = ok(await request(f.app).get(route).set(actor.session.headers), 200, 'billing review read');
    const review = current.review;
    ok(await request(f.app).post(`${route}/reviews`).set(actor.session.headers)
      .set('Idempotency-Key', crypto.randomUUID()).send({
        billingPartyId: review.billingPartyId, originSnapshotId: current.identity.snapshotId,
        expectedSourceDigest: review.sourceDigest, expectedSourceUpdatedAt: review.sourceUpdatedAt,
        expectedPreviousReviewId: review.reviewId, expectedPreviousReviewDigest: review.reviewDigest,
        expectedPreviousSequence: review.sequence,
        payload: { contact: { name: 'Taylor Customer', email: 'taylor@example.test', phone: null },
          serviceAddress: { line1: '10 Service Street', line2: null, city: 'Boston',
            region: 'MA', postalCode: '02108', countryCode: 'US' },
          billingAddress: { line1: '20 Billing Street', line2: null, city: 'Boston',
            region: 'MA', postalCode: '02108', countryCode: 'US' },
          purchaseOrderReference: 'PO-P4E-BROWSER', customerReference: 'CUSTOMER-P4E-BROWSER' },
        reason: 'Owner reviewed both browser invoice-date jurisdiction addresses.' }),
    201, 'billing identity review');
  }

  try {
    await prepareWorkforceAuthority();
    await createCurrentCommercialLineage();
    await assignDispatchAndCorrectBooking();
    await issueEditableEstimateGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate);
    await issueEditableEstimateGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: f.actors.admin.actorUserId, membershipId: f.actors.admin.actorUserId,
      actorAccessRole: f.actors.admin.actorAccessRole }, estimate);
    context = await createAndCompleteExecution();
    await prepareMission27Handoff();
    const receipt = await prepareReviewedFinalBalance();
    await prepareReviewedBillingIdentity();
    return { fixture: f, actor, estimate, customer, receipt };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}

module.exports = { createPart4ePaidBrowserFixture };
