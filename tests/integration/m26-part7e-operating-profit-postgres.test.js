'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const proposalSource = require('../helpers/m24-proposal-source');
const costComposition = require('../helpers/m24-cost-composition-input');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const CAPACITY_TARGET = 'capacity.available_role_hours.v1';

realPostgres('Mission 26 original Part 7E mounted operating-profit forecast', () => {
  let fixture;
  let cutoff;
  let estimate;
  let appointment;
  let assignment;
  let scheduleSource;
  let liveAsset;
  const actor = name => fixture.actors[name];
  const day = offset => new Date(cutoff.getTime() + offset * 86400000).toISOString().slice(0, 10);

  async function serializable(sql, parameters) {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(sql, parameters);
      await client.query('COMMIT');
      return result.rows[0] && result.rows[0].value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function approveMemberAndAvailability() {
    const member = actor('member'); const owner = actor('owner');
    let current = await request(fixture.app).get('/api/work-profiles/me')
      .set(member.session.headers);
    const submitted = await request(fixture.app).post('/api/work-profiles/me')
      .set(member.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'submit', expectedRevision: current.body.data.profile.revision,
        profile: { title: 'Service technician', summary: 'Part 7E bounded fixture profile.',
          skills: ['Fence installation'], certifications: [{ id: 'safety',
            name: 'Safety training', issuer: 'Fixture issuer', expiresOn: '2099-12-31',
            documentReference: 'CERT-7E' }] },
      });
    expect(submitted.status).toBe(200);
    current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
    const approved = await request(fixture.app)
      .post(`/api/work-profiles/reviews/${member.actorUserId}`)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'approve', expectedRevision: current.body.data.profile.revision,
        reason: 'Owner verified the exact Part 7E fixture technician.',
        verifiedCertificationIds: ['safety'],
      });
    expect(approved.status).toBe(200);
    const availability = await request(fixture.app)
      .put(`/api/v1/canonical/availability/profiles/${member.actorUserId}`)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
        expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: cutoff.toISOString(),
        coverageEnd: new Date(cutoff.getTime() + 31 * 86400000).toISOString(),
        intervals: [{ kind: 'available', start: cutoff.toISOString(),
          end: new Date(cutoff.getTime() + 31 * 86400000).toISOString() }],
        reason: 'Owner records complete declared availability for the Part 7E window.',
      });
    expect(availability.status).toBe(200);
  }

  async function adoptPublishedProposal(reason, selection = {
    materials: 'replace', labor: 'replace', equipment: 'replace',
    travel: 'replace', pricing: 'replace',
  }) {
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const headers = actor('owner').session.headers;
    let draft = { version: 'estimate-proposal-preview-v1', selectedRevision: null,
      expectedBasisDigest: null, overrides: [], candidateIds: [] };
    let response = await request(fixture.app).post(route + '/proposal-preview')
      .set(headers).send(draft);
    expect(response.status).toBe(200);
    draft = { ...draft, expectedBasisDigest: response.body.data.basisDigest };
    const historyResponse = await request(fixture.app).get(route + '/proposal-adoptions')
      .set(headers);
    expect(historyResponse.status).toBe(200);
    const currentReceipt = historyResponse.body.data.history[0] || null;
    let body = { version: 'estimate-proposal-adoption-v1', draft,
      selection, previousReceipt: currentReceipt ? {
        id: currentReceipt.id, revision: currentReceipt.revision, digest: currentReceipt.digest,
      } : null,
      coverage: { costs: { overlaps: [], equipmentOutside: [], travelOutside: [],
        confirmed: true,
        reason: 'Reviewed each distinct component and quantity once for Part 7E.' },
      overhead: { status: 'disjoint',
        explanation: 'Job overhead is distinct from company period expenses and dated cash.',
        included: [] } }, pricingPolicy: null, expectedReviewDigest: null,
      confirmed: false, reason };
    response = await request(fixture.app).post(route + '/proposal-adoption-preview')
      .set(headers).send(body);
    if (response.status !== 200) throw new Error(JSON.stringify(response.body));
    body = { ...body, expectedReviewDigest: response.body.data.reviewDigest, confirmed: true };
    response = await request(fixture.app).post(route + '/proposal-adoptions')
      .set(headers).set('Idempotency-Key', uuid()).send(body);
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
    const adoption = (await fixture.ownerPool.query(
      `SELECT child_id,pricing_plan_id,component_manifest,reviewed_result
       FROM canonical_estimate_proposal_adoptions WHERE organization_id=$1 AND estimate_id=$2
       ORDER BY revision DESC,id DESC LIMIT 1`,
      [fixture.org, estimate])).rows[0];
    expect(adoption.child_id).not.toBeNull();
    expect(adoption.pricing_plan_id).not.toBeNull();
    expect(Object.keys(adoption.component_manifest).sort())
      .toEqual(['equipment', 'labor', 'material', 'travel']);
  }

  async function adoptCompleteV3Composition() {
    const sourceRecordedAt = new Date();
    const effectiveOn = sourceRecordedAt.toISOString().slice(0, 10);
    const validThrough = new Date(cutoff.getTime() + 40 * 86400000)
      .toISOString().slice(0, 10);
    await proposalSource.seed(fixture, recipe => {
      recipe.reviewBy = validThrough;
      const extendRecordedSources = value => {
        if (!value || typeof value !== 'object') return;
        if (Object.hasOwn(value, 'endsOn')) value.endsOn = validThrough;
        for (const nested of Object.values(value)) extendRecordedSources(nested);
      };
      extendRecordedSources(recipe);
      const material = recipe.components.find(component => component.kind === 'materials');
      material.version = 'estimate-material-plan-v4';
      material.inputs = {
        lines: material.inputs.lines.map((line, index) => ({
          ...line,
          priceDate: effectiveOn,
          evidence: {
            kind: 'supplier_quote', issuer: 'Fixture Supply', reference: `Q-7E-${index + 1}`,
            effectiveOn, validThrough, countryCode: 'US', region: 'MA', locality: null,
            serviceKey: 'fence', materialSpecification: line.material,
            statedUnit: line.unit, statedCurrency: 'USD', statedUnitPrice: line.unitPrice,
            appliesToReviewedJob: true, exceptionReason: null,
          },
          availability: {
            kind: 'supplier_statement', issuer: 'Fixture Supply',
            reference: `A-7E-${index + 1}`, observedOn: effectiveOn, validThrough,
            location: 'Fixture yard', availableQuantity: '1000', statedUnit: line.unit,
            leadTimeDays: 1, appliesToReviewedJob: true, exceptionReason: null,
          },
          replacement: null,
        })),
        sourceAssessment: null,
        availabilityAssessment: null,
      };
      material.inputs.lines[0].quantity = '100';
      material.inputs.sourceAssessment = require('../../src/estimating/materialSourceContract')
        .assess(material.inputs, 'USD', { now: sourceRecordedAt, serviceKey: 'fence' });
      const materialResult = require('../../src/estimating/materialPlanContract')
        .calculate(material.inputs, 'USD', material.version);
      material.inputs.availabilityAssessment =
        require('../../src/estimating/materialAvailabilityContract')
          .assess(material.inputs, materialResult, { now: sourceRecordedAt });
      const equipment = recipe.components.find(component => component.kind === 'equipment');
      equipment.inputs.lines[0].assetId = liveAsset.asset.id;
      equipment.inputs.lines[0].identity = liveAsset.identity;
    }, sourceRecordedAt.toISOString(), validThrough + 'T23:59:59.999Z');
    await adoptPublishedProposal(
      'Adopt one source-authenticated complete v3 composition for Part 7E.');
  }

  async function approvePriceScheduleAndBook(start, end) {
    const owner = actor('owner'); const route = `/api/v1/canonical/estimates/${estimate}`;
    const getReview = () => request(fixture.app).get(route + '/review').set(owner.session.headers);
    const post = (suffix, body) => request(fixture.app).post(route + suffix)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send(body);
    let review = (await getReview()).body.data;
    expect((await post('/decisions', costComposition.decisionBody(review))).status).toBe(201);
    review = (await getReview()).body.data;
    const refreshedTravel = { action: 'save',
      expectedRevision: review.travelPlans.current.revision,
      expectedDigest: review.travelPlans.current.digest, sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: structuredClone(review.travelPlans.current.inputs), currency: review.currency,
      reason: 'Refresh the exact adopted travel source after the complete composition was written.',
      confirmed: true, confirmationVersion: review.travelPlans.contract };
    refreshedTravel.inputs.assessment = null;
    let refreshed = await post('/travel-plan-preview', refreshedTravel);
    if (refreshed.status !== 200) throw new Error(JSON.stringify(refreshed.body));
    refreshedTravel.inputs.assessment = { ...refreshed.body.data.assessment,
      acknowledged: true, explanation: '' };
    refreshed = await post('/travel-plans', refreshedTravel);
    if (refreshed.status !== 201) throw new Error(JSON.stringify(refreshed.body));
    review = (await getReview()).body.data;
    const readiness = require('../helpers/m24-readiness-input').body(review);
    for (const line of readiness.inputs.lines) {
      Object.assign(line, { start: start.toISOString(), end: end.toISOString(),
        location: 'Recorded Part 7E job site' });
      Object.assign(line.source, {
        kind: 'my_observation', label: 'Owner-observed Part 7E equipment readiness',
        reference: 'READY-7E', observedAt: new Date().toISOString(),
        validUntil: new Date(cutoff.getTime() + 40 * 86400000).toISOString(),
        quantity: 1, start: start.toISOString(), end: end.toISOString(),
        condition: 'reported_no_problem', restrictions: '',
        location: 'Recorded Part 7E job site', leadTime: 0, leadTimeUnit: 'hours',
      });
    }
    let readinessResponse = await post('/equipment-readiness-preview', readiness);
    if (readinessResponse.status !== 200) throw new Error(JSON.stringify(readinessResponse.body));
    readiness.inputs.assessment = { ...readinessResponse.body.data.assessment,
      acknowledged: true };
    readinessResponse = await post('/equipment-readiness-plans', readiness);
    if (readinessResponse.status !== 201) throw new Error(JSON.stringify(readinessResponse.body));
    await adoptPublishedProposal(
      'Re-adopt the source-authenticated proposal after refreshing its travel choice inventory.',
      { materials: 'retain', labor: 'retain', equipment: 'retain',
        travel: 'replace', pricing: 'replace' });
    review = (await getReview()).body.data;
    expect((await post('/decisions', costComposition.decisionBody(review))).status).toBe(201);
    review = (await getReview()).body.data;
    const terms = review.commercialTerms; const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = { serviceOperation: 'fence_installation',
      propertyUse: 'residential', workContext: 'new_construction',
      customerExemption: 'none', evidenceRef: { serviceOperation: 'Reviewed scope',
        propertyUse: 'Recorded property', workContext: 'Reviewed scope',
        customerExemption: 'Customer statement' } };
    inputs.transactionDate = terms.sources.asOfDate;
    inputs.taxGroups = [group(review.pricingPlans.current.inputs.lines.map(line => line.lineId))];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, {
      legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn, legalEndsOn: null,
      reviewedOn: terms.sources.asOfDate, reviewValidThrough: terms.sources.asOfDate,
    });
    delete inputs.taxGroups[0].source.effectiveOn; delete inputs.taxGroups[0].source.endsOn;
    const savedTerms = await post('/commercial-terms', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs, currency: review.currency,
      reason: 'Part 7E current commercial terms proof.', confirmed: true,
      confirmationVersion: terms.contract, evidenceDigest: terms.sources.digest });
    if (savedTerms.status !== 201) throw new Error(JSON.stringify(savedTerms.body));
    expect(savedTerms.status).toBe(201);
    review = (await getReview()).body.data;
    const currentTerms = review.commercialTerms;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(currentTerms.current), evidenceDigest: currentTerms.sources.digest,
      expectedDecisionRevision: currentTerms.decisionBasis.revision,
      expectedDecisionDigest: currentTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded fence with the adopted complete v3 composition.',
      reason: 'Approve the exact Part 7E job and price.', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);
    const mutateSchedule = async (action, target, scheduledStart, scheduledEnd, reason) => {
      const current = (await fixture.ownerPool.query(
        `SELECT revision,rtrim(canonical_digest) digest,appointment_status
         FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
        [fixture.org, appointment])).rows[0];
      const preview = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
        .set(owner.session.headers).send({ expectedRevision: Number(current.revision),
          expectedDigest: current.digest, expectedTimeZone: 'UTC', action, target,
          scheduledStart, scheduledEnd, appointmentStatus: current.appointment_status, reason });
      if (preview.status !== 201) throw new Error(JSON.stringify(preview.body));
      const approval = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
        .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
          previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason });
      if (approval.status !== 200) throw new Error(JSON.stringify(approval.body));
    };
    const target = { kind: 'profile', id: actor('member').actorUserId };
    await mutateSchedule('schedule', { kind: 'unassigned', id: null },
      start.toISOString(), end.toISOString(),
      'Schedule the Part 7E job across the exact local month boundary.');
    const issued = await post('/customer-estimate-versions', {
      reason: 'Issue the exact Part 7E estimate.', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1' });
    expect(issued.status).toBe(201);
    const link = await post('/customer-estimate-links', { versionId: issued.body.data.receipt.id,
      expiresInDays: 14, confirmed: true,
      confirmationVersion: 'customer-estimate-delivery-v1' });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    expect((await request(fixture.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', uuid()).send({ customerName: 'Part 7E Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);
    await mutateSchedule('assign', target, start.toISOString(), end.toISOString(),
      'Assign the exact reviewed Part 7E job to its technician.');
    assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest
       FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, appointment])).rows[0];
    const humanApproval = (await fixture.ownerPool.query(
      `SELECT id,action_code FROM canonical_schedule_human_approvals
       WHERE organization_id=$1 AND appointment_id=$2 AND applied_revision=$3`,
      [fixture.org, appointment, Number(assignment.revision)])).rows[0].id;
    const pair = (await fixture.ownerPool.query(
      `SELECT canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole,
        owner.authSessionId, humanApproval])).rows[0].value;
    if (pair.state !== 'ordered_same_opportunity_candidate') throw new Error(JSON.stringify(pair));
    const booking = await request(fixture.app).post('/api/v1/forecast/booking-reviews/first')
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
        approvalId: humanApproval, reason: 'Review the accepted Part 7E scheduled job.' });
    if (booking.status !== 201) throw new Error(JSON.stringify(booking.body));
    expect(booking.status).toBe(201);
    const confirmed = await request(fixture.app)
      .post(`/api/v1/forecast/booking-reviews/${booking.body.data.reviewId}/confirm-booked`)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send({
        reason: 'Confirm the exact approved Part 7E job is booked.', confirmed: true,
        confirmationVersion: 'owner-booked-work-confirm-v1' });
    if (confirmed.status !== 201) throw new Error(JSON.stringify(confirmed.body));
    expect(confirmed.status).toBe(201);
  }

  async function bindLaborAndCapacity() {
    const owner = actor('owner');
    const route = `/api/v1/canonical/estimates/${estimate}`;
    let polarReview = (await request(fixture.app).get(route + '/review')
      .set(owner.session.headers)).body.data;
    const currentLabor = polarReview.laborPlans.current;
    const laborBody = { action: 'save', expectedRevision: currentLabor.revision,
      expectedDigest: currentLabor.digest, sourcePins: polarReview.pins,
      expectedDecisionRevision: polarReview.decisions.writeBasis.revision,
      expectedDecisionDigest: polarReview.decisions.writeBasis.digest,
      inputs: currentLabor.inputs, currency: polarReview.currency,
      reason: 'Renew the identical adopted labor inputs against the final approved Part 7E decision.',
      confirmed: true, confirmationVersion: polarReview.laborPlans.contract };
    const laborPreview = await request(fixture.app).post(route + '/labor-plan-preview')
      .set(owner.session.headers).send(laborBody);
    if (laborPreview.status !== 200) throw new Error(JSON.stringify(laborPreview.body));
    costComposition.acceptPlanPreview(laborBody, laborPreview.body.data);
    const renewedLabor = await request(fixture.app).post(route + '/labor-plans')
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send(laborBody);
    if (renewedLabor.status !== 201) throw new Error(JSON.stringify(renewedLabor.body));
    const labor = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(digest) digest FROM canonical_labor_plans
       WHERE organization_id=$1 AND estimate_id=$2 ORDER BY revision DESC,id DESC LIMIT 1`,
      [fixture.org, estimate])).rows[0];
    const body = {
      action: 'approve', expectedCurrentReviewId: null, expectedCurrentReviewDigest: 'none',
      assignmentId: assignment.id, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, estimateId: estimate, laborPlanId: labor.id,
      expectedLaborPlanRevision: Number(labor.revision), expectedLaborPlanDigest: labor.digest,
      reason: 'Bind the exact adopted labor plan to this booked job.', confirmed: true,
      confirmationVersion: 'm26-current-backlog-person-plan-v1' };
    const review = await request(fixture.app)
      .post(`/api/v1/forecast/current-backlog/person-plan-sources/${appointment}/reviews`)
      .set(owner.session.headers).set('Idempotency-Key', uuid()).send(body);
    if (review.status !== 201) throw new Error(JSON.stringify(review.body));
    expect(review.status).toBe(201);
    await serializable(
      `SELECT canonical_forecast_workload_capacity_v1_epoch_capture(
       $1,$2,$3,$4,$5,$6,$7,$8) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, `m26-p7e-epoch-${uuid()}`,
        'Begin exact Part 7E capacity coverage.', 'm26-workload-capacity-epoch-v1']);
    for (const [kind, subject, role] of [
      ['role_qualification', owner.actorUserId, 'owner'],
      ['role_qualification', actor('member').actorUserId, 'technician'],
      ['availability_basis', actor('member').actorUserId, null],
      ['capacity_role_scope', null, 'technician'],
    ]) {
      await serializable(
        `SELECT canonical_forecast_workload_capacity_v1_review_mutate(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approve',0,'none',NULL,$11,$12) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, `m26-p7e-review-${uuid()}`, kind, CAPACITY_TARGET, subject, role,
          'Owner approves the exact Part 7E capacity authority.',
          'm26-workload-capacity-review-v1']);
    }
  }

  async function recordScheduleAndPolicy() {
    const owner = actor('owner');
    scheduleSource = (await request(fixture.app)
      .get('/api/v1/business-profile/operating-cost-schedules/references')
      .set(owner.session.headers)).body.data;
    const decisions = scheduleSource.references.map(reference => ({
      referenceKey: reference.referenceKey,
      treatment: reference.kind === 'equipment_pool' && reference.method === 'economic_recovery' ?
        'economic_recovery_not_cash' : reference.kind === 'overhead_allocation' ?
          'job_overhead_allocation_not_cash' : 'not_same_obligation',
      scheduleKey: null,
      reason: 'This exact adopted job-cost reference is not the company rent cash schedule.',
    }));
    const financedAsset = liveAsset.asset;
    const sourceBody = { expectedRevision: 0, expectedDigest: 'none', action: 'replace',
      currency: 'USD', effectiveOn: day(0), coverage: { startsOn: day(0), endsOn: day(29),
        recordedThrough: cutoff.toISOString(), complete: true },
      schedules: [{ scheduleKey: 'office-rent-part7e', kind: 'overhead_expense',
        assetId: null, amount: '1200.00', currency: 'USD',
        dueDates: [{ dueOn: day(5), paymentStatus: 'scheduled' }], recurrenceEnd: day(29),
        includedCategories: ['rent'], sourceAttestation: { kind: 'source_document',
          reference: 'Authenticated Part 7E lease schedule', documentDigest: 'a'.repeat(64),
          attestedAt: cutoff.toISOString() } },
      { scheduleKey: 'equipment-financing-part7e', kind: 'financed_asset_obligation',
        assetId: financedAsset.id, amount: '450.00', currency: 'USD',
        dueDates: [{ dueOn: day(7), paymentStatus: 'scheduled' }], recurrenceEnd: day(29),
        includedCategories: ['principal', 'interest', 'debt_service'],
        sourceAttestation: { kind: 'source_document',
          reference: 'Authenticated Part 7E financing statement',
          documentDigest: 'c'.repeat(64), attestedAt: cutoff.toISOString() } }],
      allocationPolicy: { expectedMission24Digest: scheduleSource.digest, decisions,
        reason: 'Reconcile every exact adopted job-cost reference without treating cash as accrual cost.' },
      reason: 'Record complete dated cash schedules for Part 7E.', confirmed: true,
      confirmationVersion: 'operating-cost-schedule-snapshot-v1' };
    const savedSource = await request(fixture.app)
      .put('/api/v1/business-profile/operating-cost-schedules/current')
      .set(owner.session.headers).set('Idempotency-Key', uuid())
      .set('X-CSRF-Token', owner.csrfToken).send(sourceBody);
    expect(savedSource.status).toBe(201);
    const source = (await request(fixture.app)
      .get('/api/v1/business-profile/operating-cost-schedules/current')
      .set(owner.session.headers)).body.data;
    const policyBody = { expectedRevision: 0, expectedDigest: 'none', action: 'replace',
      currency: 'USD', effectiveOn: day(0), coverage: { startsOn: day(0), endsOn: day(29),
        recordedThrough: cutoff.toISOString(), complete: true },
      expenses: [{ expenseKey: 'office-rent-accrual', label: 'Office rent',
        classification: 'fixed_period', amount: '1200.00', recognitionStartsOn: day(0),
        recognitionEndsOn: day(29), source: { kind: 'source_document',
          reference: 'Authenticated Part 7E lease accrual source', documentDigest: 'b'.repeat(64),
          attestedAt: cutoff.toISOString() } },
      { expenseKey: 'company-utilities-accrual', label: 'Company utilities',
        classification: 'variable_period', amount: '300.00', recognitionStartsOn: day(0),
        recognitionEndsOn: day(29), source: { kind: 'owner_attested',
          reference: 'Owner-confirmed current utilities budget', documentDigest: null,
          attestedAt: cutoff.toISOString() } }],
      scenarios: [{ key: 'recorded_plan', label: 'Recorded plan',
        operatingCostBasisPoints: 10000, reason: 'Uses the exact recorded economic costs.' },
      { key: 'cost_pressure', label: 'Cost pressure', operatingCostBasisPoints: 11500,
        reason: 'Applies an explicit named 15 percent cost assumption.' }],
      schedulePin: { revision: source.revision, digest: source.digest },
      overlapReview: { status: 'reconciled',
        reason: 'Direct cost, job overhead, period expense, and dated cash were reviewed separately.' },
      reason: 'Record complete economic expense coverage and named deterministic scenarios.',
      confirmed: true, confirmationVersion: 'operating-profit-policy-v1' };
    const policyKey = uuid();
    const postPolicy = () => request(fixture.app)
      .post('/api/v1/business-profile/operating-profit-policy')
      .set(owner.session.headers).set('Idempotency-Key', policyKey)
      .set('X-CSRF-Token', owner.csrfToken).send(policyBody);
    const writes = await Promise.all([postPolicy(), postPolicy()]);
    expect(writes.map(value => value.status).sort()).toEqual([200, 201]);
    const replay = writes.find(value => value.status === 200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  }

  beforeAll(async () => {
    const now = new Date();
    const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    const start = new Date(boundary.getTime() - 12 * 3600000);
    const end = new Date(boundary.getTime() + 12 * 3600000);
    cutoff = new Date(start.getTime() - 24 * 3600000);
    fixture = await createEstimateReviewFixture({ operationalSchedule: true, recordedLaborHours: 8,
      scheduledAppointment: { status: 'scheduled' },
      proposalScope: { measuredFenceLength: { value: '100', unit: 'ft' },
        proposalGeography: 'simulated-workspace' } });
    estimate = fixture.estimateGraphs[0].ids.estimate;
    appointment = fixture.estimateGraphs[0].ids.appointment;
    liveAsset = await require('../helpers/m24-readiness-asset').createReadinessAsset(fixture);
    await liveAsset.record('condition');
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [cutoff]);
    await approveMemberAndAvailability();
    await adoptCompleteV3Composition();
    await approvePriceScheduleAndBook(start, end);
    await fixture.ownerPool.query(
      `UPDATE organization_memberships SET status='suspended'
       WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
      [fixture.org, [actor('admin').actorUserId, actor('dispatcher').actorUserId,
        actor('viewer').actorUserId]]);
    await bindLaborAndCapacity();
    await fixture.ownerPool.query(
      `SELECT canonical_forecast_workload_capacity_v1_capacity_evidence($1,$2,$3,$2)`,
      [fixture.org, cutoff, new Date(cutoff.getTime() + 30 * 86400000)]);
    await recordScheduleAndPolicy();
  }, 240000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues one exact source-authenticated multi-month operating outlook without double counting', async () => {
    const response = await request(fixture.app).get('/api/v1/forecast/operating-profit/current')
      .set(actor('owner').session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    if (response.body.data.state !== 'current') {
      const gates = (await fixture.ownerPool.query(
        `SELECT canonical_forecast_labor_cost_v1_current($1,$2,$3,$4) labor,
          canonical_forecast_material_cost_v1_current($1,$2,$3,$4) material,
          canonical_forecast_equipment_travel_cost_v1_current($1,$2,$3,$4) equipment,
          canonical_forecast_overhead_cash_v1_current($1,$2,$3,$4) cash`,
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId])).rows[0];
      throw new Error(JSON.stringify({ operating: response.body.data, gates }));
    }
    expect(response.body.data).toMatchObject({ state: 'current', fictional: false,
      currency: 'USD', horizon: { kind: 'next_30_elapsed_days_with_local_expense_dates',
        timeZone: 'UTC' }, scope: { wholeBusinessCoverageVerified: false,
        offPlatformCoverageVerified: false }, revenue: {
        target: 'approved_booked_price_before_tax', recognizedRevenueMeasured: false,
        earnedRevenueMeasured: false, invoicedRevenueMeasured: false,
        collectedCashMeasured: false }, costs: { actualPaymentMeasured: false },
      range: { kind: 'deterministic_named_scenarios', calibrated: false,
        probability: false }, evidence: { sourceAuthenticatedComposition: true,
        componentQuantitiesAndCostsVerified: true, duplicatePreventionVerified: true,
        approvedScheduleTiming: true, overlapReviewed: true, expenseCoverageVerified: true,
        currentnessVerified: true, m25AdjustmentApplied: false,
        externalEventClassified: false, scopeChangeClassified: false },
      forecastIssued: true, calibratedRangeIssued: false, probabilityIssued: false,
      automaticActionAuthorized: false });
    expect(response.body.data.months).toHaveLength(2);
    expect(response.body.data.months.map(value => value.month))
      .toEqual([startMonth(cutoff, 0), startMonth(cutoff, 1)]);
    expect(response.body.data.range.scenarios.map(value => value.key))
      .toEqual(['recorded_plan', 'cost_pressure']);
    expect(Number(response.body.data.costs.operatingCost)).toBe(
      Number(response.body.data.costs.directJobCost) +
      Number(response.body.data.costs.incrementalJobOverhead) + 1500);
    expect(response.body.data.costs.datedCashObligations).toBe('1650.00');
    expect(Number(response.body.data.revenue.amount)).toBeGreaterThan(0);
    expect(Number(response.body.data.kpis.marginHigh))
      .toBeGreaterThan(Number(response.body.data.kpis.marginLow));
  });

  test('is stable across session time zones and preserves the exact DST-safe elapsed horizon', async () => {
    const results = [];
    const client = await fixture.runtimePool.connect();
    try {
      for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SELECT set_config('TimeZone',$1,TRUE)", [zone]);
        results.push((await client.query(
          'SELECT canonical_forecast_operating_profit_v1_current($1,$2,$3,$4) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId])).rows[0].value);
        await client.query('COMMIT');
      }
    } finally { client.release(); }
    expect(results).toEqual([results[0], results[0], results[0]]);
    expect(new Date(results[0].horizon.endsAt).getTime() -
      new Date(results[0].horizon.startsAt).getTime()).toBe(30 * 86400000);
  });

  test('fails closed for a tenant without sources and enforces access roles', async () => {
    const member = await request(fixture.app).get('/api/v1/forecast/operating-profit/current')
      .set(actor('member').session.headers);
    expect(member.status).toBe(403);
    const other = await request(fixture.app).get('/api/v1/forecast/operating-profit/current')
      .set(actor('otherOwner').session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'unavailable', forecastIssued: false });
  });

  test('keeps policy history immutable and only exposes guarded entry points', async () => {
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_operating_profit_policy_revisions')).rejects.toMatchObject({
      code: '42501' });
    await expect(fixture.ownerPool.query(
      `UPDATE canonical_operating_profit_policy_revisions SET reason='changed'
       WHERE organization_id=$1`, [fixture.org])).rejects.toMatchObject({ code: '23514' });
    const privileges = (await fixture.ownerPool.query(
      `SELECT has_function_privilege($1,
        'public.canonical_forecast_operating_profit_v1_current(uuid,uuid,text,uuid)','EXECUTE') entry,
       has_function_privilege($1,
        'public.canonical_operating_profit_policy_valid(jsonb)','EXECUTE') helper`,
      [fixture.roles.runtime])).rows[0];
    expect(privileges).toEqual({ entry: true, helper: false });
  });

  function startMonth(value, offset) {
    const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
    return date.toISOString().slice(0, 7);
  }
});
