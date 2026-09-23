'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 6A shared customer acceptance and booking order', () => {
  let f;
  let issuedVersionId;
  let estimateRoute;
  let matchingApprovalId;
  let firstReviewId;
  beforeAll(async () => { f = await createEstimateReviewFixture(); }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  test('orders new accepted estimate, human schedule approval, and link revocation without booking-price promotion', async () => {
    const actor = f.actors.owner;
    const estimate = f.estimateGraphs[0].ids.estimate;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);

    let review = (await get('/review')).body.data;
    const pricing = review.pricingPlans;
    expect((await post('/pricing-plans', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(pricing.serviceKey), currency: review.currency,
      reason: 'Synthetic accepted-estimate source-order pricing', confirmed: true,
      confirmationVersion: pricing.contract, evidenceDigest: pricing.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const terms = review.commercialTerms;
    const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = {
      serviceOperation: 'fence_installation', propertyUse: 'residential',
      workContext: 'new_construction', customerExemption: 'none',
      evidenceRef: { serviceOperation: 'Reviewed scope', propertyUse: 'Recorded property',
        workContext: 'Reviewed scope', customerExemption: 'Customer statement' },
    };
    inputs.transactionDate = terms.sources.asOfDate;
    inputs.taxGroups = [group(['installation'])];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, {
      legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn,
      legalEndsOn: null, reviewedOn: terms.sources.asOfDate,
      reviewValidThrough: terms.sources.asOfDate,
    });
    delete inputs.taxGroups[0].source.effectiveOn;
    delete inputs.taxGroups[0].source.endsOn;
    expect((await post('/commercial-terms', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs,
      currency: review.currency, reason: 'Synthetic terms for ordered acceptance',
      confirmed: true, confirmationVersion: terms.contract,
      evidenceDigest: terms.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentTerms = review.commercialTerms;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(currentTerms.current),
      evidenceDigest: currentTerms.sources.digest,
      expectedDecisionRevision: currentTerms.decisionBasis.revision,
      expectedDecisionDigest: currentTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
      reason: 'Synthetic approved commercial scope', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Synthetic issued customer estimate', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1',
    });
    expect(issued.status).toBe(201);
    issuedVersionId = issued.body.data.receipt.id;
    estimateRoute = route;
    const link = await post('/customer-estimate-links', {
      versionId: issued.body.data.receipt.id, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    const countBefore = (await f.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].count;
    expect(countBefore).toBe(0);

    const acceptKey = crypto.randomUUID();
    const acceptBody = { customerName: 'Taylor Customer', confirmed: true,
      confirmationVersion: 'customer-estimate-accept-v1' };
    const accept = () => request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', acceptKey).send(acceptBody);
    expect((await accept()).status).toBe(201);
    expect((await accept()).status).toBe(200);

    const appointment = f.estimateGraphs[0].ids.appointment;
    const before = (await f.ownerPool.query(
      'SELECT revision,rtrim(canonical_digest) AS digest,appointment_status FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    const scheduledStart = '2029-06-12T13:00:00.000Z';
    const scheduledEnd = '2029-06-12T14:00:00.000Z';
    const preview = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'schedule',
        target: { kind: 'unassigned', id: null },
        scheduledStart, scheduledEnd, appointmentStatus: before.appointment_status,
        reason: 'Match synthetic accepted estimate to this appointment' });
    if (preview.status !== 201) throw new Error('Matching preview failed: ' +
      JSON.stringify({ body: preview.body, before }));
    const approval = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason: 'Match synthetic accepted estimate to this appointment' });
    if (approval.status !== 200) throw new Error('Matching approval failed: ' + JSON.stringify(approval.body));
    matchingApprovalId = (await f.ownerPool.query(
      'SELECT id FROM canonical_schedule_human_approvals WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC LIMIT 1',
      [f.org, appointment])).rows[0].id;

    const reviewParams = [f.org, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, matchingApprovalId,
      'Human reviewed the synthetic accepted work and scheduled appointment.',
      'm26-first-booking-review-key-001', actor.csrfToken];
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
      [...reviewParams.slice(0, 7), 'invalid-csrf-token']))
      .rejects.toMatchObject({ code: '42501' });
    // Exercise both M22 terminal statuses without changing the shared
    // fixture: an owner-only synthetic transaction rolls the state back.
    for (const terminalStatus of ['cancelled', 'completed']) {
      const synthetic = await f.ownerPool.connect();
      try {
        await synthetic.query('BEGIN');
        await synthetic.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
        await synthetic.query(
          'UPDATE canonical_schedule_assignments SET appointment_status=$3 WHERE organization_id=$1 AND appointment_id=$2',
          [f.org, appointment, terminalStatus]);
        const guarded = (await synthetic.query(
          'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
          reviewParams)).rows[0].value;
        expect(guarded).toMatchObject({ state: 'current_booking_evidence_unavailable',
          bookedWorkVerified: false, forecastIssued: false });
      } finally {
        await synthetic.query('ROLLBACK');
        synthetic.release();
      }
    }
    const bookingRoute = '/api/v1/forecast/booking-reviews';
    const firstWrite = await request(f.app).post(`${bookingRoute}/first`)
      .set(actor.session.headers).set('Idempotency-Key', reviewParams[6])
      .send({ approvalId: matchingApprovalId, reason: reviewParams[5] });
    expect(firstWrite.status).toBe(201);
    const firstReview = firstWrite.body.data;
    expect(firstReview).toMatchObject({ state: 'first_booking_reviewed',
      replayed: false,
      bookedWorkVerified: false, forecastIssued: false });
    firstReviewId = firstReview.reviewId;
    const firstReplay = await request(f.app).post(`${bookingRoute}/first`)
      .set(actor.session.headers).set('Idempotency-Key', reviewParams[6])
      .send({ approvalId: matchingApprovalId, reason: reviewParams[5] });
    expect(firstReplay.status).toBe(200);
    expect(firstReplay.body.data).toMatchObject({ state: 'first_booking_reviewed',
      reviewId: firstReviewId, replayed: true, bookedWorkVerified: false });
    const deniedWrite = await request(f.app).post(`${bookingRoute}/first`)
      .set(actor.session.headers).set('X-CSRF-Token', 'invalid-csrf-token')
      .set('Idempotency-Key', reviewParams[6])
      .send({ approvalId: matchingApprovalId, reason: reviewParams[5] });
    expect(deniedWrite.status).toBe(403);
    const httpCurrent = await request(f.app)
      .get(`${bookingRoute}/${firstReviewId}/currentness`)
      .set(actor.session.headers);
    expect(httpCurrent.status).toBe(200);
    expect(httpCurrent.body.data).toMatchObject({
      state: 'review_evidence_current_at_read', reviewCurrentAtRead: true,
      bookedWorkVerified: false, forecastIssued: false });
    const storedPrice = (await f.ownerPool.query(
      `SELECT reviewed_price_before_tax,currency
         FROM canonical_forecast_commercial_booking_reviews
        WHERE organization_id=$1 AND id=$2`, [f.org, firstReviewId])).rows[0];
    const firstPosition = await request(f.app)
      .get(`${bookingRoute}/${firstReviewId}/position`)
      .set(actor.session.headers);
    expect(firstPosition.status).toBe(200);
    expect(firstPosition.body.data).toMatchObject({
      state: 'owner_reviewed_booking_candidate',
      commercialStatus: 'owner_reviewed_booking',
      reviewedPriceBeforeTax: storedPrice.reviewed_price_before_tax,
      currency: storedPrice.currency, ownerAttestationCurrentAtRead: true,
      reviewCurrentAtRead: true,
      historicalCoverageVerified: false, bookedWorkVerified: false,
      earnedRevenueMeasured: false, collectedCashMeasured: false,
      forecastIssued: false });
    const confirmBody = {
      reason: 'Owner confirms the synthetic accepted and scheduled job is booked.',
      confirmed: true, confirmationVersion: 'owner-booked-work-confirm-v1',
    };
    const confirmRoute = `${bookingRoute}/${firstReviewId}/confirm-booked`;
    const confirmKey = 'm26-confirm-booked-work-key-001';
    const wrongCsrfConfirmation = await request(f.app).post(confirmRoute)
      .set(actor.session.headers).set('X-CSRF-Token', 'invalid-csrf-token')
      .set('Idempotency-Key', confirmKey).send(confirmBody);
    expect(wrongCsrfConfirmation.status).toBe(403);
    const memberConfirmation = await request(f.app).post(confirmRoute)
      .set(f.actors.member.session.headers).set('Idempotency-Key', confirmKey)
      .send(confirmBody);
    expect(memberConfirmation.status).toBe(403);
    const confirmed = await request(f.app).post(confirmRoute)
      .set(actor.session.headers).set('Idempotency-Key', confirmKey)
      .send(confirmBody);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data).toMatchObject({
      state: 'booking_confirmation_recorded', reviewId: firstReviewId,
      replayed: false, currentnessUnknown: true,
      bookedWorkVerified: false, forecastIssued: false });
    expect(confirmed.body.data).not.toHaveProperty('priceBeforeTax');
    const confirmationId = confirmed.body.data.confirmationId;
    const confirmationReadRoute = `${bookingRoute}/confirmations/${confirmationId}/currentness`;
    const currentConfirmation = await request(f.app).get(confirmationReadRoute)
      .set(actor.session.headers);
    expect(currentConfirmation.status).toBe(200);
    expect(currentConfirmation.body.data).toMatchObject({
      state: 'owner_confirmed_booked_work_current',
      commercialStatus: 'owner_confirmed_booked',
      authority: 'paid_owner_or_admin_confirmation',
      priceBeforeTax: storedPrice.reviewed_price_before_tax,
      currency: storedPrice.currency, bookedWorkVerified: true,
      historicalCoverageVerified: false, wholeBusinessCoverageVerified: false,
      earnedRevenueMeasured: false, collectedCashMeasured: false,
      forecastIssued: false });
    const otherTenantConfirmation = await request(f.app).get(confirmationReadRoute)
      .set(f.actors.otherOwner.session.headers);
    expect(otherTenantConfirmation.status).toBe(200);
    expect(otherTenantConfirmation.body.data).toMatchObject({
      state: 'booking_confirmation_unavailable', bookedWorkVerified: false });
    expect(otherTenantConfirmation.body.data).not.toHaveProperty('priceBeforeTax');
    expect((await request(f.app).get(confirmationReadRoute)
      .set(f.actors.member.session.headers)).status).toBe(403);
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_forecast_booked_work_confirmations'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      'DELETE FROM canonical_forecast_booked_work_confirmations WHERE organization_id=$1',
      [f.org])).rejects.toMatchObject({ code: '23514' });
    expect((await request(f.app).post(confirmRoute)
      .set(actor.session.headers).set('Idempotency-Key', confirmKey)
      .send(confirmBody)).body.data).toMatchObject({
      confirmationId, replayed: true, currentnessUnknown: true });
    expect((await request(f.app).post(confirmRoute)
      .set(actor.session.headers).set('Idempotency-Key', confirmKey)
      .send({ ...confirmBody, reason: 'A different booking reason cannot reuse this key.' }))
      .status).toBe(409);
    const currentnessParams = [f.org, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, firstReviewId];
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      currentnessParams)).rows[0].value).toMatchObject({
      state: 'review_evidence_current_at_read', reviewId: firstReviewId,
      reviewCurrentAtRead: true, firstActualBookingKnown: false,
      bookedWorkVerified: false, historicalCoverageVerified: false,
      forecastIssued: false });
    const initialReviewId = firstReviewId;
    const correctionReason = 'Owner corrected the synthetic booking review after checking the scope.';
    const corrected = await request(f.app)
      .post(`${bookingRoute}/${initialReviewId}/correct`)
      .set(actor.session.headers)
      .set('Idempotency-Key', 'm26-correct-booking-review-key-001')
      .send({ approvalId: matchingApprovalId, reason: correctionReason });
    expect(corrected.status).toBe(201);
    expect(corrected.body.data).toMatchObject({ state: 'booking_corrected',
      previousReviewId: initialReviewId, replayed: false,
      bookedWorkVerified: false, forecastIssued: false });
    firstReviewId = corrected.body.data.reviewId;
    currentnessParams[4] = firstReviewId;
    const correctedPosition = await request(f.app)
      .get(`${bookingRoute}/${firstReviewId}/position`)
      .set(actor.session.headers);
    expect(correctedPosition.status).toBe(200);
    expect(correctedPosition.body.data).toMatchObject({
      state: 'owner_reviewed_booking_candidate',
      reviewedPriceBeforeTax: storedPrice.reviewed_price_before_tax,
      currency: storedPrice.currency, reviewCurrentAtRead: true,
      bookedWorkVerified: false });
    const supersededPosition = await request(f.app)
      .get(`${bookingRoute}/${initialReviewId}/position`)
      .set(actor.session.headers);
    expect(supersededPosition.body.data).toMatchObject({
      state: 'owner_reviewed_position_unavailable',
      reviewCurrentAtRead: false, bookedWorkVerified: false });
    expect(supersededPosition.body.data).not.toHaveProperty('reviewedPriceBeforeTax');
    const supersededConfirmation = await request(f.app).get(confirmationReadRoute)
      .set(actor.session.headers);
    expect(supersededConfirmation.body.data).toMatchObject({
      state: 'booking_confirmation_stale_or_unavailable', bookedWorkVerified: false });
    expect(supersededConfirmation.body.data).not.toHaveProperty('priceBeforeTax');
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      [...currentnessParams.slice(0, 4), initialReviewId])).rows[0].value)
      .toMatchObject({ state: 'later_review_exists', reviewCurrentAtRead: false });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      currentnessParams)).rows[0].value)
      .toMatchObject({ state: 'review_evidence_current_at_read',
        reviewCurrentAtRead: true, bookedWorkVerified: false });
    const correctionReplay = await request(f.app)
      .post(`${bookingRoute}/${initialReviewId}/correct`)
      .set(actor.session.headers)
      .set('Idempotency-Key', 'm26-correct-booking-review-key-001')
      .send({ approvalId: matchingApprovalId, reason: correctionReason });
    expect(correctionReplay.status).toBe(200);
    expect(correctionReplay.body.data).toMatchObject({ reviewId: firstReviewId,
      replayed: true, bookedWorkVerified: false });
    const changedCorrection = await request(f.app)
      .post(`${bookingRoute}/${initialReviewId}/correct`)
      .set(actor.session.headers)
      .set('Idempotency-Key', 'm26-correct-booking-review-key-001')
      .send({ approvalId: matchingApprovalId,
        reason: 'Different reason cannot reuse the same correction request.' });
    expect(changedCorrection.status).toBe(409);
    expect(changedCorrection.body.error.category).toBe('FORECAST_REVIEW_REQUEST_REUSED');
    const staleCorrection = await request(f.app)
      .post(`${bookingRoute}/${initialReviewId}/correct`)
      .set(actor.session.headers)
      .set('Idempotency-Key', 'm26-correct-booking-review-key-002')
      .send({ approvalId: matchingApprovalId, reason: correctionReason });
    expect(staleCorrection.status).toBe(200);
    expect(staleCorrection.body.data).toMatchObject({
      state: 'prior_review_stale_or_cancelled', bookedWorkVerified: false });
    const badCorrectionCsrf = await request(f.app)
      .post(`${bookingRoute}/${firstReviewId}/correct`)
      .set(actor.session.headers).set('X-CSRF-Token', 'invalid-csrf-token')
      .set('Idempotency-Key', 'm26-correct-booking-review-key-003')
      .send({ approvalId: matchingApprovalId, reason: correctionReason });
    expect(badCorrectionCsrf.status).toBe(403);
    const changedAssignment = await f.ownerPool.connect();
    try {
      await changedAssignment.query('BEGIN');
      await changedAssignment.query(
        'ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
      await changedAssignment.query(
        'UPDATE canonical_schedule_assignments SET last_human_approval_id=NULL WHERE organization_id=$1 AND appointment_id=$2',
        [f.org, appointment]);
      expect((await changedAssignment.query(
        'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
        currentnessParams)).rows[0].value).toMatchObject({
        state: 'review_schedule_stale_or_unavailable',
        reviewCurrentAtRead: false, bookedWorkVerified: false });
    } finally {
      await changedAssignment.query('ROLLBACK');
      changedAssignment.release();
    }
    const other = f.actors.otherOwner;
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      [other.organizationId, other.actorUserId, other.actorAccessRole,
        other.authSessionId, firstReviewId])).rows[0].value)
      .toMatchObject({ state: 'review_unavailable', reviewCurrentAtRead: false });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
      reviewParams)).rows[0].value).toMatchObject({ id: initialReviewId,
      replayed: true, bookedWorkVerified: false });
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
      [...reviewParams.slice(0, 5), 'A changed review reason cannot reuse the same key.',
        reviewParams[6], actor.csrfToken])).rejects.toMatchObject({ code: '23505' });
    await expect(f.runtimePool.query('SELECT * FROM canonical_forecast_commercial_booking_reviews'))
      .rejects.toMatchObject({ code: '42501' });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
      [...reviewParams.slice(0, 6), 'm26-first-booking-review-key-002', actor.csrfToken])).rows[0].value)
      .toMatchObject({ state: 'prior_commercial_review_exists',
        bookedWorkVerified: false, forecastIssued: false });
    const member = f.actors.member;
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      [f.org, member.actorUserId, member.actorAccessRole,
        member.authSessionId, firstReviewId]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
      [f.org, member.actorUserId, member.actorAccessRole, member.authSessionId,
        matchingApprovalId, reviewParams[5], 'm26-member-booking-review-key-001',
        member.csrfToken]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      'DELETE FROM canonical_forecast_commercial_booking_reviews WHERE organization_id=$1',
      [f.org])).rejects.toMatchObject({ code: '23514' });
    const laterLink = await post('/customer-estimate-links', {
      versionId: issuedVersionId, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(laterLink.status).toBe(201);
    const laterAcceptance = await f.ownerPool.connect();
    try {
      await laterAcceptance.query('BEGIN');
      await laterAcceptance.query(
        `INSERT INTO canonical_customer_estimate_delivery_events(
           organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,
           request_key_hash,request_digest,digest)
         SELECT organization_id,estimate_id,version_id,id,'accepted',
                $2::jsonb,NULL,$3,$4,$5
           FROM canonical_customer_estimate_delivery_links WHERE id=$1`,
        [laterLink.body.data.link.id,
          JSON.stringify({ customerName: 'Later synthetic customer', confirmed: true,
            confirmationVersion: 'customer-estimate-accept-v1' }),
          crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
          crypto.randomBytes(32).toString('hex')]);
      const guarded = (await laterAcceptance.query(
        'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
        [...reviewParams.slice(0, 6), 'm26-newer-scope-review-key-001', actor.csrfToken]))
        .rows[0].value;
      expect(guarded).toMatchObject({ state: 'later_accepted_response_unreviewed',
        bookedWorkVerified: false, forecastIssued: false });
      const stale = (await laterAcceptance.query(
        'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
        currentnessParams)).rows[0].value;
      expect(stale).toMatchObject({ state: 'later_accepted_response_unreviewed',
        reviewCurrentAtRead: false, bookedWorkVerified: false });
    } finally {
      await laterAcceptance.query('ROLLBACK');
      laterAcceptance.release();
    }

    await f.createExecution({ approvedScheduling: true, stopAfterScheduling: true });
    const links = await get('/customer-estimate-links');
    expect(links.status).toBe(200);
    const revoked = await post(`/customer-estimate-links/${link.body.data.link.id}/revoke`, {});
    expect(revoked.status).toBe(201);
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      currentnessParams)).rows[0].value).toMatchObject({
      state: 'review_lineage_stale_or_unavailable',
      reviewCurrentAtRead: false, bookedWorkVerified: false });
    const cancelParams = [f.org, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, firstReviewId,
      'The synthetic customer cancelled the reviewed work before service.',
      'm26-cancel-booking-review-key-001', actor.csrfToken];
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_cancel_booking_review($1,$2,$3,$4,$5,$6,$7,$8) value',
      [...cancelParams.slice(0, 7), 'invalid-csrf-token']))
      .rejects.toMatchObject({ code: '42501' });
    const cancelWrite = await request(f.app)
      .post(`${bookingRoute}/${firstReviewId}/cancel`)
      .set(actor.session.headers).set('Idempotency-Key', cancelParams[6])
      .send({ reason: cancelParams[5] });
    expect(cancelWrite.status).toBe(201);
    const cancellation = cancelWrite.body.data;
    expect(cancellation).toMatchObject({ state: 'booking_cancelled',
      previousReviewId: firstReviewId, replayed: false,
      schedulingNeedsReview: true, bookedWorkVerified: false,
      forecastIssued: false });
    const cancelReplay = await request(f.app)
      .post(`${bookingRoute}/${firstReviewId}/cancel`)
      .set(actor.session.headers).set('Idempotency-Key', cancelParams[6])
      .send({ reason: cancelParams[5] });
    expect(cancelReplay.status).toBe(200);
    expect(cancelReplay.body.data).toMatchObject({ state: 'booking_cancelled',
      reviewId: cancellation.reviewId, replayed: true,
      schedulingNeedsReview: true, bookedWorkVerified: false });
    const memberCancel = await request(f.app)
      .post(`${bookingRoute}/${firstReviewId}/cancel`)
      .set(f.actors.member.session.headers)
      .set('Idempotency-Key', 'm26-member-http-cancel-key-001')
      .send({ reason: cancelParams[5] });
    expect(memberCancel.status).toBe(403);
    const cancelledRead = await request(f.app)
      .get(`${bookingRoute}/${cancellation.reviewId}/currentness`)
      .set(actor.session.headers);
    expect(cancelledRead.status).toBe(200);
    expect(cancelledRead.body.data).toMatchObject({ state: 'booking_cancelled',
      reviewCurrentAtRead: false, bookedWorkVerified: false });
    const cancelledPosition = await request(f.app)
      .get(`${bookingRoute}/${cancellation.reviewId}/position`)
      .set(actor.session.headers);
    expect(cancelledPosition.status).toBe(200);
    expect(cancelledPosition.body.data).toMatchObject({
      state: 'owner_reviewed_position_unavailable',
      reviewCurrentAtRead: false, bookedWorkVerified: false });
    expect(cancelledPosition.body.data).not.toHaveProperty('reviewedPriceBeforeTax');
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_cancel_booking_review($1,$2,$3,$4,$5,$6,$7,$8) value',
      [f.org, member.actorUserId, member.actorAccessRole,
        member.authSessionId, firstReviewId, cancelParams[5],
        'm26-member-booking-cancel-key-001', member.csrfToken]))
      .rejects.toMatchObject({ code: '42501' });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_cancel_booking_review($1,$2,$3,$4,$5,$6,$7,$8) value',
      [other.organizationId, other.actorUserId, other.actorAccessRole,
        other.authSessionId, firstReviewId, cancelParams[5],
        'm26-other-tenant-cancel-key-001', other.csrfToken])).rows[0].value)
      .toMatchObject({ state: 'prior_review_unavailable',
        bookedWorkVerified: false });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_cancel_booking_review($1,$2,$3,$4,$5,$6,$7,$8) value',
      cancelParams)).rows[0].value).toMatchObject({
      id: cancellation.reviewId, replayed: true, bookedWorkVerified: false });
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_cancel_booking_review($1,$2,$3,$4,$5,$6,$7,$8) value',
      [...cancelParams.slice(0, 5), 'Changed cancellation reason cannot reuse key.',
        cancelParams[6], actor.csrfToken])).rejects.toMatchObject({ code: '23505' });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_cancel_booking_review($1,$2,$3,$4,$5,$6,$7,$8) value',
      [...cancelParams.slice(0, 6), 'm26-cancel-booking-review-key-002', actor.csrfToken]))
      .rows[0].value).toMatchObject({ state: 'prior_review_stale_or_cancelled',
        bookedWorkVerified: false });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      currentnessParams)).rows[0].value).toMatchObject({
      state: 'later_review_exists', reviewCurrentAtRead: false });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      [...currentnessParams.slice(0, 4), cancellation.reviewId])).rows[0].value)
      .toMatchObject({ state: 'booking_cancelled',
        previousReviewId: firstReviewId, reviewCurrentAtRead: false,
        bookedWorkVerified: false });
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_review_first_booking($1,$2,$3,$4,$5,$6,$7,$8) value',
      [...reviewParams.slice(0, 6), 'm26-revoked-booking-review-key-001', actor.csrfToken])).rows[0].value)
      .toMatchObject({ state: 'lineage_unavailable',
        bookedWorkVerified: false, forecastIssued: false });

    const ordered = (await f.ownerPool.query(
      `SELECT source_kind,approval_id,delivery_event_id,source_order
         FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order`, [f.org])).rows;
    expect(ordered.map(row => row.source_kind)).toEqual([
      'customer_estimate_acceptance', 'schedule_approval', 'schedule_approval', 'schedule_approval',
      'customer_estimate_link_revocation',
    ]);
    expect(new Set(ordered.map(row => row.source_order))).toHaveProperty('size', 5);
    expect(ordered[0].delivery_event_id).toBeTruthy();
    expect(ordered[1].approval_id).toBeTruthy();
    expect(ordered[4].delivery_event_id).toBeTruthy();
    await expect(f.runtimePool.query('SELECT * FROM canonical_forecast_commercial_booking_orders'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      'DELETE FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1', [f.org]))
      .rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('startup rejects inherited access to tenant-private commercial reviews', async () => {
    await f.ownerPool.query(
      'GRANT SELECT ON TABLE public.canonical_forecast_commercial_booking_reviews TO PUBLIC');
    try {
      await expect(f.db.runMigrations({ pool: f.ownerPool, runtimePool: f.runtimePool }))
        .rejects.toThrow(/commercial_booking_reviews_private/);
    } finally {
      await f.ownerPool.query(
        'REVOKE SELECT ON TABLE public.canonical_forecast_commercial_booking_reviews FROM PUBLIC');
    }
    await expect(f.db.runMigrations({ pool: f.ownerPool, runtimePool: f.runtimePool }))
      .resolves.toBe(true);
  }, 120000);

  test('guarded reader links one earlier accepted issued version to the same immutable opportunity without claiming booked work', async () => {
    const actor = f.actors.owner;
    const params = [f.org, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, matchingApprovalId];
    const paired = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      params)).rows[0].value;
    expect(paired).toMatchObject({ state: 'ordered_same_opportunity_candidate',
      issuedVersionId, approvalId: matchingApprovalId, candidateOnly: true,
      bookedWorkVerified: false, forecastIssued: false,
      acceptancePrecedesApproval: true, decisionCurrentnessVerified: false,
      linkRevokedBeforeApproval: false, linkRevokedAfterApproval: true });
    expect(paired).not.toHaveProperty('acceptanceSourceOrder');
    expect(paired).not.toHaveProperty('approvalSourceOrder');
    expect(paired).not.toHaveProperty('decisionStillLatest');
    const pinnedDecision = (await f.ownerPool.query(
      `SELECT d.price_before_tax,d.currency FROM canonical_customer_estimate_versions v
        JOIN canonical_estimate_decisions d ON d.organization_id=v.organization_id
         AND d.estimate_id=v.estimate_id AND d.id=v.decision_id
       WHERE v.organization_id=$1 AND v.id=$2`, [f.org, issuedVersionId])).rows[0];
    const price = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_booked_price_candidate($1,$2,$3,$4,$5) value',
      params)).rows[0].value;
    expect(price).toMatchObject({ state: 'reviewed_price_candidate',
      approvedDecisionId: paired.approvedDecisionId,
      priceBeforeTax: pinnedDecision.price_before_tax, currency: pinnedDecision.currency,
      decisionMatchesLatestAtRead: true, linkRevokedAfterApproval: true,
      candidateOnly: true, bookedWorkVerified: false,
      savedRunCurrentnessVerified: false, forecastIssued: false });
    const status = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_booking_status_position($1,$2,$3,$4,$5) value',
      params)).rows[0].value;
    expect(status).toMatchObject({ state: 'observed_schedule_position',
      pairedApprovalId: matchingApprovalId, firstObservedApprovalId: matchingApprovalId,
      latestObservedApprovalId: matchingApprovalId, firstObservedAction: 'schedule',
      latestObservedAction: 'schedule', observedApprovalCount: 1,
      laterApprovalCount: 0, firstActualBookingKnown: false,
      bookingStatusVerified: false, sourceComplete: false, forecastIssued: false });
    expect(status).not.toHaveProperty('sourceOrder');
    // Synthetic source mutation for currentness regression: the real Mission 24
    // decision table/insert trigger assigns its normal source order.
    await f.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(
         organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,scope_summary,
         price_before_tax,currency,reason,confirmation_version,request_key_hash,
         request_digest,digest)
       SELECT organization_id,estimate_id,revision+1,id,'withdraw',actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,NULL,NULL,currency,
         'Synthetic reviewed price withdrawal','estimate-quote-preparation-v1',
         $2,$3,$4 FROM canonical_estimate_decisions
       WHERE organization_id=$1 AND id=$5`,
      [f.org, crypto.randomBytes(32).toString('hex'),
        crypto.randomBytes(32).toString('hex'),
        crypto.randomBytes(32).toString('hex'), paired.approvedDecisionId]);
    const changedPrice = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_booked_price_candidate($1,$2,$3,$4,$5) value',
      params)).rows[0].value;
    expect(changedPrice).toMatchObject({ state: 'approved_price_changed_or_unavailable',
      candidateOnly: true, bookedWorkVerified: false,
      savedRunCurrentnessVerified: false, forecastIssued: false });
    expect(changedPrice).not.toHaveProperty('priceBeforeTax');
    const unrelatedApproval = (await f.ownerPool.query(
      `SELECT source.approval_id FROM canonical_forecast_commercial_booking_orders source
        WHERE source.organization_id=$1 AND source.source_kind='schedule_approval'
          AND source.approval_id<>$2 ORDER BY source.source_order LIMIT 1`,
      [f.org, matchingApprovalId])).rows[0].approval_id;
    const unrelated = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [...params.slice(0, 4), unrelatedApproval])).rows[0].value;
    expect(unrelated).toMatchObject({ state: 'no_ordered_acceptance',
      candidateOnly: true, bookedWorkVerified: false, forecastIssued: false });
    const unrelatedPrice = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_booked_price_candidate($1,$2,$3,$4,$5) value',
      [...params.slice(0, 4), unrelatedApproval])).rows[0].value;
    expect(unrelatedPrice).toMatchObject({ state: 'lineage_unavailable',
      lineageState: 'no_ordered_acceptance', candidateOnly: true,
      bookedWorkVerified: false, forecastIssued: false });
    expect(unrelatedPrice).not.toHaveProperty('priceBeforeTax');
    const member = f.actors.member;
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [f.org, member.actorUserId, member.actorAccessRole,
        member.authSessionId, matchingApprovalId]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_booked_price_candidate($1,$2,$3,$4,$5) value',
      [f.org, member.actorUserId, member.actorAccessRole,
        member.authSessionId, matchingApprovalId]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_booking_status_position($1,$2,$3,$4,$5) value',
      [f.org, member.actorUserId, member.actorAccessRole,
        member.authSessionId, matchingApprovalId]))
      .rejects.toMatchObject({ code: '42501' });
    const other = f.actors.otherOwner;
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [other.organizationId, other.actorUserId, other.actorAccessRole,
        other.authSessionId, matchingApprovalId]))
      .resolves.toMatchObject({ rows: [{ value: {
        state: 'source_order_unavailable', candidateOnly: true,
        bookedWorkVerified: false } }] });
  }, 120000);

  test('a later approval does not silently choose among two accepted links', async () => {
    const actor = f.actors.owner;
    const link = await request(f.app).post(estimateRoute + '/customer-estimate-links')
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ versionId: issuedVersionId, expiresInDays: 14,
        confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1' });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    const accepted = await request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customerName: 'Second Synthetic Customer', confirmed: true,
        confirmationVersion: 'customer-estimate-accept-v1' });
    expect(accepted.status).toBe(201);
    const appointment = f.estimateGraphs[0].ids.appointment;
    const before = (await f.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) AS digest,appointment_status,
         scheduled_start,scheduled_end FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [f.org, appointment])).rows[0];
    const reason = 'Review multiple synthetic accepted estimate links';
    const preview = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'assign',
        target: { kind: 'profile', id: f.actors.member.actorUserId },
        scheduledStart: before.scheduled_start.toISOString(),
        scheduledEnd: before.scheduled_end.toISOString(),
        appointmentStatus: before.appointment_status, reason });
    expect(preview.status).toBe(201);
    const approval = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason });
    expect(approval.status).toBe(200);
    const latestApproval = (await f.ownerPool.query(
      `SELECT id FROM canonical_schedule_human_approvals
        WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC LIMIT 1`,
      [f.org, appointment])).rows[0].id;
    const ambiguous = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, latestApproval])).rows[0].value;
    expect(ambiguous).toMatchObject({ state: 'ambiguous_accepted_responses',
      candidateOnly: true, bookedWorkVerified: false, forecastIssued: false });
    const firstActorParams = [f.org, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, matchingApprovalId];
    const statusAfterCorrection = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_booking_status_position($1,$2,$3,$4,$5) value',
      firstActorParams)).rows[0].value;
    expect(statusAfterCorrection).toMatchObject({ state: 'observed_schedule_position',
      pairedApprovalId: matchingApprovalId, firstObservedAction: 'schedule',
      latestObservedApprovalId: latestApproval, latestObservedAction: 'assign',
      observedApprovalCount: 2, laterApprovalCount: 1,
      firstActualBookingKnown: false, bookingStatusVerified: false,
      sourceComplete: false, forecastIssued: false });
  }, 120000);

  test('customer acceptance waits on the tenant fence and rollback leaves no phantom event', async () => {
    const actor = f.actors.owner;
    const createLink = async () => {
      const response = await request(f.app).post(estimateRoute + '/customer-estimate-links')
        .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
        .send({ versionId: issuedVersionId, expiresInDays: 14,
          confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1' });
      expect(response.status).toBe(201);
      return { id: response.body.data.link.id,
        token: decodeURIComponent(response.body.data.urlPath.split('/').pop()) };
    };
    const accept = token => request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customerName: 'Concurrent Synthetic Customer', confirmed: true,
        confirmationVersion: 'customer-estimate-accept-v1' });

    const concurrentLink = await createLink();
    const held = await f.ownerPool.connect();
    let acceptance;
    try {
      await held.query('BEGIN');
      await held.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('m26:commercial-booking-order:'||$1::text,0))",
        [f.org]);
      acceptance = accept(concurrentLink.token).then(response => response);
      const deadline = Date.now() + 4000;
      let waiters = 0;
      while (Date.now() < deadline) {
        waiters = (await f.ownerPool.query(
          `SELECT count(*)::int AS count FROM pg_locks
            WHERE locktype='advisory' AND NOT granted
              AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)).rows[0].count;
        if (waiters >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(waiters).toBeGreaterThanOrEqual(1);
      const beforeRelease = (await f.ownerPool.query(
        'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
        [f.org])).rows[0].count;
      expect(beforeRelease).toBe(7);
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
    const accepted = await acceptance;
    expect(accepted.status).toBe(201);
    const afterRelease = (await f.ownerPool.query(
      `SELECT source_kind FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order`, [f.org])).rows;
    expect(afterRelease).toHaveLength(8);
    expect(afterRelease.slice(7).filter(row => row.source_kind === 'customer_estimate_acceptance')).toHaveLength(1);

    const rollbackLink = await createLink();
    const transaction = await f.ownerPool.connect();
    const lastOrder = (await f.ownerPool.query(
      'SELECT max(source_order)::bigint AS value FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].value;
    try {
      await transaction.query('BEGIN');
      await transaction.query(
        `INSERT INTO canonical_customer_estimate_delivery_events(
           organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,
           request_key_hash,request_digest,digest)
         SELECT organization_id,estimate_id,version_id,id,'accepted',
                $2::jsonb,NULL,$3,$4,$5
           FROM canonical_customer_estimate_delivery_links WHERE id=$1`,
        [rollbackLink.id, JSON.stringify({ customerName: 'Rolled back synthetic customer',
          confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' }),
        crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
        crypto.randomBytes(32).toString('hex')]);
      expect((await transaction.query(
        'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
        [f.org])).rows[0].count).toBe(9);
    } finally {
      await transaction.query('ROLLBACK');
      transaction.release();
    }
    expect((await f.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].count).toBe(8);
    expect((await accept(rollbackLink.token)).status).toBe(201);
    const finalOrder = (await f.ownerPool.query(
      `SELECT source_order FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order DESC LIMIT 1`, [f.org])).rows[0].source_order;
    expect(BigInt(finalOrder)).toBeGreaterThan(BigInt(lastOrder) + 1n);
  }, 120000);
});

realPostgres('Mission 26 Part 6A revoke-before-acceptance ordering', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture(); }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  test('fails closed when genuine concurrent writers permanently order revocation before acceptance', async () => {
    const actor = f.actors.owner;
    const estimate = f.estimateGraphs[0].ids.estimate;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);

    let review = (await get('/review')).body.data;
    const pricing = review.pricingPlans;
    expect((await post('/pricing-plans', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(pricing.serviceKey), currency: review.currency,
      reason: 'Synthetic revoke-before-acceptance pricing', confirmed: true,
      confirmationVersion: pricing.contract, evidenceDigest: pricing.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const terms = review.commercialTerms;
    const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = {
      serviceOperation: 'fence_installation', propertyUse: 'residential',
      workContext: 'new_construction', customerExemption: 'none',
      evidenceRef: { serviceOperation: 'Reviewed scope', propertyUse: 'Recorded property',
        workContext: 'Reviewed scope', customerExemption: 'Customer statement' },
    };
    inputs.transactionDate = terms.sources.asOfDate;
    inputs.taxGroups = [group(['installation'])];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, {
      legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn,
      legalEndsOn: null, reviewedOn: terms.sources.asOfDate,
      reviewValidThrough: terms.sources.asOfDate,
    });
    delete inputs.taxGroups[0].source.effectiveOn;
    delete inputs.taxGroups[0].source.endsOn;
    expect((await post('/commercial-terms', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs,
      currency: review.currency, reason: 'Synthetic terms for concurrent ordering',
      confirmed: true, confirmationVersion: terms.contract,
      evidenceDigest: terms.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentTerms = review.commercialTerms;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(currentTerms.current),
      evidenceDigest: currentTerms.sources.digest,
      expectedDecisionRevision: currentTerms.decisionBasis.revision,
      expectedDecisionDigest: currentTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
      reason: 'Synthetic approved scope for concurrent ordering', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Synthetic issued estimate for concurrent ordering', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1',
    });
    expect(issued.status).toBe(201);
    const issuedVersionId = issued.body.data.receipt.id;
    const link = await post('/customer-estimate-links', {
      versionId: issuedVersionId, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(link.status).toBe(201);
    const linkId = link.body.data.link.id;
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());

    const waitForAdvisoryWaiters = async expected => {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const waiters = (await f.ownerPool.query(
          `SELECT count(*)::int AS count FROM pg_locks
            WHERE locktype='advisory' AND NOT granted
              AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)).rows[0].count;
        if (waiters >= expected) return waiters;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      return 0;
    };
    const held = await f.ownerPool.connect();
    let revocation;
    let acceptance;
    try {
      await held.query('BEGIN');
      await held.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('m26:commercial-booking-order:'||$1::text,0))",
        [f.org]);
      revocation = post(`/customer-estimate-links/${linkId}/revoke`, {})
        .then(response => response);
      expect(await waitForAdvisoryWaiters(1)).toBeGreaterThanOrEqual(1);
      acceptance = request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
        .set({ Host: 'localhost', Origin: 'http://localhost' })
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ customerName: 'Concurrent Revoked Customer', confirmed: true,
          confirmationVersion: 'customer-estimate-accept-v1' })
        .then(response => response);
      expect(await waitForAdvisoryWaiters(2)).toBeGreaterThanOrEqual(2);
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
    const revokedResponse = await revocation;
    const acceptedResponse = await acceptance;
    expect(revokedResponse.status).toBe(201);
    expect(acceptedResponse.status).toBe(409);
    const rejectedLinkOrder = (await f.ownerPool.query(
      `SELECT source.source_kind
         FROM canonical_forecast_commercial_booking_orders source
         JOIN canonical_customer_estimate_delivery_events event
           ON event.organization_id=source.organization_id
          AND event.id=source.delivery_event_id
        WHERE source.organization_id=$1 AND event.link_id=$2
        ORDER BY source.source_order`, [f.org, linkId])).rows;
    expect(rejectedLinkOrder.map(row => row.source_kind)).toEqual([
      'customer_estimate_link_revocation',
    ]);

    // The production SERIALIZABLE writers reject the concurrent acceptance.
    // Record a separate real acceptance and revocation, then use an explicit
    // owner-only disposable-fixture order rewrite to prove the defensive
    // reader still fails closed if legacy or imported evidence has the
    // otherwise-unreachable revoke-before-acceptance order.
    const orderedLink = await post('/customer-estimate-links', {
      versionId: issuedVersionId, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(orderedLink.status).toBe(201);
    const orderedLinkId = orderedLink.body.data.link.id;
    const orderedToken = decodeURIComponent(orderedLink.body.data.urlPath.split('/').pop());
    const orderedAcceptance = await request(f.app)
      .post(`/api/public/customer-estimates/${orderedToken}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customerName: 'Synthetic Ordered Customer', confirmed: true,
        confirmationVersion: 'customer-estimate-accept-v1' });
    expect(orderedAcceptance.status).toBe(201);
    expect((await post(`/customer-estimate-links/${orderedLinkId}/revoke`, {})).status).toBe(201);
    const sourceRows = (await f.ownerPool.query(
      `SELECT source.source_order,source.source_kind
         FROM canonical_forecast_commercial_booking_orders source
         JOIN canonical_customer_estimate_delivery_events event
           ON event.organization_id=source.organization_id
          AND event.id=source.delivery_event_id
        WHERE source.organization_id=$1 AND event.link_id=$2
        ORDER BY source.source_order`, [f.org, orderedLinkId])).rows;
    expect(sourceRows.map(row => row.source_kind)).toEqual([
      'customer_estimate_acceptance', 'customer_estimate_link_revocation',
    ]);

    const appointment = f.estimateGraphs[0].ids.appointment;
    const before = (await f.ownerPool.query(
      'SELECT revision,rtrim(canonical_digest) AS digest,appointment_status FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    const reason = 'Review revoked-before-acceptance synthetic ordering';
    const preview = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'schedule',
        target: { kind: 'unassigned', id: null },
        scheduledStart: '2029-07-17T13:00:00.000Z',
        scheduledEnd: '2029-07-17T14:00:00.000Z',
        appointmentStatus: before.appointment_status, reason });
    expect(preview.status).toBe(201);
    const approval = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason });
    expect(approval.status).toBe(200);
    const approvalId = (await f.ownerPool.query(
      'SELECT id FROM canonical_schedule_human_approvals WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC LIMIT 1',
      [f.org, appointment])).rows[0].id;
    const pairedBeforeRewrite = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, approvalId])).rows[0].value;
    expect(pairedBeforeRewrite).toMatchObject({ state: 'accepted_link_revoked_before_approval',
      issuedVersionId, approvalId, acceptancePrecedesApproval: true,
      linkRevokedBeforeAcceptance: false, linkRevokedBeforeApproval: true,
      candidateOnly: true, bookedWorkVerified: false, forecastIssued: false });
    const priceBeforeRewrite = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_booked_price_candidate($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, approvalId])).rows[0].value;
    expect(priceBeforeRewrite).toMatchObject({ state: 'response_revoked_before_approval',
      lineageState: 'accepted_link_revoked_before_approval', candidateOnly: true,
      bookedWorkVerified: false, savedRunCurrentnessVerified: false,
      forecastIssued: false });
    expect(priceBeforeRewrite).not.toHaveProperty('priceBeforeTax');

    const rewrite = await f.ownerPool.connect();
    try {
      await rewrite.query('BEGIN');
      await rewrite.query(
        'ALTER TABLE canonical_forecast_commercial_booking_orders DISABLE TRIGGER canonical_forecast_commercial_booking_orders_immutable');
      const temporaryOrder = BigInt(sourceRows[1].source_order) + 1000n;
      await rewrite.query(
        `UPDATE canonical_forecast_commercial_booking_orders source
            SET source_order=$3
           FROM canonical_customer_estimate_delivery_events event
          WHERE event.organization_id=source.organization_id
            AND event.id=source.delivery_event_id
            AND source.organization_id=$1 AND event.link_id=$2
            AND source.source_kind='customer_estimate_acceptance'`,
        [f.org, orderedLinkId, temporaryOrder.toString()]);
      await rewrite.query(
        `UPDATE canonical_forecast_commercial_booking_orders source
            SET source_order=$3
           FROM canonical_customer_estimate_delivery_events event
          WHERE event.organization_id=source.organization_id
            AND event.id=source.delivery_event_id
            AND source.organization_id=$1 AND event.link_id=$2
            AND source.source_kind='customer_estimate_link_revocation'`,
        [f.org, orderedLinkId, sourceRows[0].source_order]);
      await rewrite.query(
        `UPDATE canonical_forecast_commercial_booking_orders source
            SET source_order=$3
           FROM canonical_customer_estimate_delivery_events event
          WHERE event.organization_id=source.organization_id
            AND event.id=source.delivery_event_id
            AND source.organization_id=$1 AND event.link_id=$2
            AND source.source_kind='customer_estimate_acceptance'`,
        [f.org, orderedLinkId, sourceRows[1].source_order]);
      await rewrite.query(
        'ALTER TABLE canonical_forecast_commercial_booking_orders ENABLE TRIGGER canonical_forecast_commercial_booking_orders_immutable');
      await rewrite.query('COMMIT');
    } catch (error) {
      await rewrite.query('ROLLBACK');
      throw error;
    } finally {
      rewrite.release();
    }
    const paired = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, approvalId])).rows[0].value;
    expect(paired).toMatchObject({ state: 'accepted_link_revoked_before_approval',
      issuedVersionId, approvalId, acceptancePrecedesApproval: true,
      linkRevokedBeforeAcceptance: true, linkRevokedBeforeApproval: true,
      candidateOnly: true, bookedWorkVerified: false, forecastIssued: false });
    const revokedPrice = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_booked_price_candidate($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, approvalId])).rows[0].value;
    expect(revokedPrice).toMatchObject({ state: 'response_revoked_before_approval',
      lineageState: 'accepted_link_revoked_before_approval', candidateOnly: true,
      bookedWorkVerified: false, savedRunCurrentnessVerified: false,
      forecastIssued: false });
    expect(revokedPrice).not.toHaveProperty('priceBeforeTax');
    expect(paired).not.toHaveProperty('acceptanceSourceOrder');
    expect(paired).not.toHaveProperty('approvalSourceOrder');
  }, 120000);
});

realPostgres('Mission 26 Part 6A commercial booking order migration boundary', () => {
  let database;
  let pool;
  let migrationDirectory;

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p6a-commercial-migration');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-commercial-pre156-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) < 156)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await require('../../src/db').runMigrations({ pool, migrationsDirectory: migrationDirectory });
    fs.copyFileSync(
      path.join(source, '156_canonical_forecast_commercial_booking_order.sql'),
      path.join(migrationDirectory, '156_canonical_forecast_commercial_booking_order.sql')
    );
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-commercial-pre156-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('waits for pre-migration approval writers before installing the replacement trigger body', async () => {
    const blocker = await pool.connect();
    let applying;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'LOCK TABLE public.canonical_schedule_human_approvals IN ROW EXCLUSIVE MODE'
      );
      applying = require('../../src/db').runMigrations({ pool, migrationsDirectory: migrationDirectory });
      const deadline = Date.now() + 4000;
      let waiters = 0;
      while (Date.now() < deadline) {
        waiters = (await pool.query(
          `SELECT count(*)::int AS count
             FROM pg_locks
            WHERE locktype='relation' AND NOT granted
              AND relation='public.canonical_schedule_human_approvals'::regclass`
        )).rows[0].count;
        if (waiters >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(waiters).toBeGreaterThanOrEqual(1);
      expect((await pool.query(
        "SELECT to_regclass('public.canonical_forecast_commercial_booking_orders') AS relation"
      )).rows).toEqual([{ relation: null }]);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect(await applying).toBe(true);
    expect((await pool.query(
      "SELECT to_regclass('public.canonical_forecast_commercial_booking_orders')::text AS relation"
    )).rows).toEqual([{ relation: 'canonical_forecast_commercial_booking_orders' }]);
  }, 120000);
});
