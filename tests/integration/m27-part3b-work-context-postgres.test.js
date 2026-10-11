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
const workContextRepository = require('../../src/customerFinancial/billableWorkContextRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const priceRoot = '/api/v1/forecast/price-history';

realPostgres('Mission 27 Part 3B current completed-work context', () => {
  let f; let actor; let estimate; let appointment; let firstReviewId; let context;
  let approvedCompletion; let route;

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

  test('released logical-work fence serializes both read-first and mutation-first winner orders', async () => {
    const identity = `${f.org}:${context.execution.id}`;
    let signalRead; let releaseRead;
    const readStarted = new Promise(resolve => { signalRead = resolve; });
    const readRelease = new Promise(resolve => { releaseRead = resolve; });
    const heldRead = workContextRepository.withinWorkFence(f.ownerPool, identity, async () => {
      signalRead(); await readRelease; return 'read-first';
    });
    await readStarted;
    const writer = await f.ownerPool.connect();
    let writerLocked = false;
    try {
      const blockedWriter = await writer.query(
        'SELECT pg_try_advisory_lock(230007,hashtext($1)) acquired', [identity]);
      expect(blockedWriter.rows[0].acquired).toBe(false);
      releaseRead(); expect(await heldRead).toBe('read-first');
      expect((await writer.query(
        'SELECT pg_try_advisory_lock(230007,hashtext($1)) acquired', [identity]))
        .rows[0].acquired).toBe(true);
      writerLocked = true;

      let signalEntered;
      const entered = new Promise(resolve => { signalEntered = resolve; });
      const waitingRead = workContextRepository.withinWorkFence(f.ownerPool, identity, async () => {
        signalEntered(); return 'writer-first';
      });
      expect(await Promise.race([entered.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 75))])).toBe(false);
      await writer.query('SELECT pg_advisory_unlock(230007,hashtext($1))', [identity]);
      writerLocked = false;
      expect(await waitingRead).toBe('writer-first');
    } finally {
      if (writerLocked) await writer.query(
        'SELECT pg_advisory_unlock(230007,hashtext($1))', [identity]).catch(() => {});
      writer.release();
    }
  }, 30000);

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
