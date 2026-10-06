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
const priceRoot = '/api/v1/forecast/price-history';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const utc = day => `${day.toISOString().slice(0, 10)}T00:00:00.000000Z`;

realPostgres('Mission 26 Part 6A shared customer acceptance and booking order', () => {
  let f;
  let issuedVersionId;
  let estimateRoute;
  let matchingApprovalId;
  let firstReviewId;
  beforeAll(async () => { f = await createEstimateReviewFixture(); }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  async function primeFuturePriceCoverage(actor) {
    const snapshot = await request(f.app).post(`${priceRoot}/ordered-snapshots`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({});
    expect(snapshot.status).toBe(201);
    const activation = await request(f.app).post(`${priceRoot}/ordered-anchor/activate`)
      .set(actor.session.headers).send({});
    expect(activation.status).toBe(200);
  }

  async function createWitnessedFuturePriceOrigin(actor, decisionId) {
    const observed = await request(f.app)
      .post(`${priceRoot}/decision-commit-observations`)
      .set(actor.session.headers).send({ decisionId });
    expect(observed.status).toBe(200);
    const tomorrow = new Date();
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const priorStart = new Date(tomorrow);
    priorStart.setUTCDate(priorStart.getUTCDate() - 3);
    const date = new Date(priorStart.getTime() + 12 * 60 * 60 * 1000);
    const before = new Date(priorStart.getTime() - 24 * 60 * 60 * 1000);
    const guardedTables = [
      ['canonical_estimate_decisions', 'canonical_estimate_decision_immutable'],
      ['canonical_forecast_price_decision_orders',
        'canonical_forecast_price_decision_order_immutable'],
      ['canonical_forecast_price_ordered_anchors',
        'canonical_forecast_price_ordered_anchors_immutable'],
      ['canonical_forecast_price_anchor_activations',
        'canonical_forecast_price_anchor_activations_immutable'],
    ];
    try {
      for (const [table, trigger] of guardedTables) {
        await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      await f.ownerPool.query(
        'UPDATE canonical_estimate_decisions SET created_at=$2 WHERE id=$1',
        [decisionId, date]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_decision_orders SET ordered_at=$2 WHERE decision_id=$1',
        [decisionId, date]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_ordered_anchors SET coverage_starts_at=$2 WHERE organization_id=$1',
        [f.org, before]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_anchor_activations SET observed_at=$2 WHERE organization_id=$1',
        [f.org, before]);
    } finally {
      for (const [table, trigger] of guardedTables.reverse()) {
        await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
    }
    const snapshot = await request(f.app).post(`${priceRoot}/ordered-snapshots`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({});
    expect(snapshot.status).toBe(201);
    const profile = await request(f.app).post(profileRoot)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Prospective UTC profile for integrated commercial proof.',
        confirmed: true });
    expect(profile.status).toBe(201);
    expect((await request(f.app).post(
      `${profileRoot}/${profile.body.data.anchorId}/activate`)
      .set(actor.session.headers).send({})).status).toBe(200);
    const horizonEnd = new Date(tomorrow);
    horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 1);
    const origin = await request(f.app).post(`${priceRoot}/saved-price-flow-origins`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ sourceReceiptId: snapshot.body.data.snapshotId, currency: 'USD',
        horizonStartsAt: utc(tomorrow), horizonEndsAt: utc(horizonEnd) });
    expect(origin.status).toBe(201);
    const runId = origin.body.data.runId;
    expect((await request(f.app)
      .post(`${priceRoot}/saved-price-flow-origins/${runId}/activate`)
      .set(actor.session.headers).send({})).status).toBe(200);
    const witness = await request(f.app)
      .post(`${priceRoot}/saved-price-flow-origins/${runId}/profile-witness`)
      .set(actor.session.headers).send({ profileAnchorId: profile.body.data.anchorId });
    expect(witness.status).toBe(200);
    expect(witness.body.data.state).toBe('profile_witness_recorded');
    return runId;
  }

  test('orders new accepted estimate, human schedule approval, and link revocation without booking-price promotion', async () => {
    const actor = f.actors.owner;
    const estimate = f.estimateGraphs[0].ids.estimate;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);

    await primeFuturePriceCoverage(actor);
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
    // The actual issue-version writer reaches migration 234's BEFORE INSERT
    // source fence without owning the price-decision lock. An integrated
    // capture holding the commercial fence therefore makes issuance wait,
    // rather than forming a price-to-commercial deadlock cycle.
    const captureFence = await f.ownerPool.connect();
    let issued;
    try {
      await captureFence.query('BEGIN');
      await captureFence.query(`SELECT pg_advisory_xact_lock(
        hashtextextended('m26:commercial-booking-order:'||$1::text,0))`, [f.org]);
      let issueSettled = false;
      const issuing = post('/customer-estimate-versions', {
        reason: 'Synthetic issued customer estimate', confirmed: true,
        confirmationVersion: 'customer-estimate-issue-v1',
      }).then(result => { issueSettled = true; return result; });
      const waitDeadline = Date.now() + 4000;
      let advisoryWaiters = 0;
      while (Date.now() < waitDeadline && advisoryWaiters === 0) {
        advisoryWaiters = (await f.ownerPool.query(
          `SELECT count(*)::int count FROM pg_locks
            WHERE locktype='advisory' AND NOT granted AND
             database=(SELECT oid FROM pg_database WHERE datname=current_database())`))
          .rows[0].count;
        if (advisoryWaiters === 0) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(advisoryWaiters).toBeGreaterThanOrEqual(1);
      expect(issueSettled).toBe(false);
      await captureFence.query('COMMIT');
      issued = await issuing;
    } finally {
      await captureFence.query('ROLLBACK').catch(() => {});
      captureFence.release();
    }
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
    // A real delivery-event writer that began before the schedule approval
    // keeps the shared commercial fence until commit. The production M22
    // approval must wait, then proceed only after the rolled-back acceptance
    // disappears; it cannot observe a false commercial source order.
    const approvalBody = { previewId: preview.body.data.id,
      previewDigest: preview.body.data.previewDigest,
      acknowledgedWarningDigests: preview.body.data.warningDigests,
      acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
      reason: 'Match synthetic accepted estimate to this appointment' };
    const approvalKey = crypto.randomUUID();
    const raceLink = await post('/customer-estimate-links', {
      versionId: issuedVersionId, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(raceLink.status).toBe(201);
    const acceptanceWriter = await f.ownerPool.connect();
    let approval;
    try {
      await acceptanceWriter.query('BEGIN');
      await acceptanceWriter.query(
        `INSERT INTO canonical_customer_estimate_delivery_events(
           organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,
           request_key_hash,request_digest,digest)
         SELECT organization_id,estimate_id,version_id,id,'accepted',
                $2::jsonb,NULL,$3,$4,$5
           FROM canonical_customer_estimate_delivery_links WHERE id=$1`,
        [raceLink.body.data.link.id,
          JSON.stringify({ customerName: 'Concurrent synthetic customer', confirmed: true,
            confirmationVersion: 'customer-estimate-accept-v1' }),
          crypto.randomBytes(32).toString('hex'),
          crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex')]);
      let approvalSettled = false;
      const approving = request(f.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
        .set(actor.session.headers).set('Idempotency-Key', approvalKey)
        .send(approvalBody).then(result => { approvalSettled = true; return result; });
      const waitDeadline = Date.now() + 4000;
      let advisoryWaiters = 0;
      while (Date.now() < waitDeadline && advisoryWaiters === 0) {
        advisoryWaiters = (await f.ownerPool.query(
          `SELECT count(*)::int count FROM pg_locks
            WHERE locktype='advisory' AND NOT granted AND
             database=(SELECT oid FROM pg_database WHERE datname=current_database())`))
          .rows[0].count;
        if (advisoryWaiters === 0) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(advisoryWaiters).toBeGreaterThanOrEqual(1);
      expect(approvalSettled).toBe(false);
      await acceptanceWriter.query('ROLLBACK');
      approval = await approving;
    } finally {
      await acceptanceWriter.query('ROLLBACK').catch(() => {});
      acceptanceWriter.release();
    }
    if (approval.status !== 200) throw new Error('Matching approval failed: ' + JSON.stringify(approval.body));
    expect((await f.ownerPool.query(
      `SELECT count(*)::int count FROM canonical_customer_estimate_delivery_events
        WHERE organization_id=$1 AND link_id=$2 AND kind='accepted'`,
      [f.org, raceLink.body.data.link.id])).rows[0].count).toBe(0);
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
    const beforeReviewCandidates = await request(f.app)
      .get(`${bookingRoute}/candidates`).set(actor.session.headers);
    expect(beforeReviewCandidates.status).toBe(200);
    expect(beforeReviewCandidates.body.data).toMatchObject({
      state: 'booking_review_candidates_observed', candidateCount: 1,
      recentWindowOnly: true, recentApprovalWindowLimit: 100,
      writeRechecksCurrentness: true, bookedWorkVerified: false,
      completePeriodVerified: false, forecastIssued: false });
    expect(beforeReviewCandidates.body.data.candidates[0]).toMatchObject({
      approvalId: matchingApprovalId, appointmentId: appointment });
    const lineageIndexes = (await f.ownerPool.query(
      `SELECT indexname,indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname=ANY($1::text[])
        ORDER BY indexname`, [[
        'canonical_forecast_delivery_events_tenant_estimate_kind_idx',
        'canonical_forecast_estimates_tenant_opportunity_idx',
      ]])).rows;
    expect(lineageIndexes.map(row => row.indexname)).toEqual([
      'canonical_forecast_delivery_events_tenant_estimate_kind_idx',
      'canonical_forecast_estimates_tenant_opportunity_idx',
    ]);
    expect(lineageIndexes[0].indexdef).toContain(
      '(organization_id, estimate_id, kind, id)');
    expect(lineageIndexes[1].indexdef).toContain(
      '(organization_id, opportunity_id, id)');
    const oversizedApprovalHistory = await f.ownerPool.connect();
    try {
      await oversizedApprovalHistory.query('BEGIN');
      await oversizedApprovalHistory.query(
        `CREATE TEMP TABLE synthetic_booking_approval_ids ON COMMIT DROP AS
         SELECT gen_random_uuid() id,gen_random_uuid() preview_id,value
           FROM generate_series(1,1001) value`);
      await oversizedApprovalHistory.query(
        `INSERT INTO canonical_schedule_mutation_previews
         SELECT (jsonb_populate_record(
           NULL::canonical_schedule_mutation_previews,
           to_jsonb(base) || jsonb_build_object(
             'id', synthetic.preview_id
           ))).*
           FROM canonical_schedule_mutation_previews base
           JOIN canonical_schedule_human_approvals approval
             ON approval.organization_id=base.organization_id
              AND approval.preview_id=base.id
           CROSS JOIN synthetic_booking_approval_ids synthetic
          WHERE approval.organization_id=$1 AND approval.id=$2`,
        [f.org, matchingApprovalId]);
      await oversizedApprovalHistory.query(
        'ALTER TABLE canonical_schedule_human_approvals DISABLE TRIGGER USER');
      await oversizedApprovalHistory.query(
        `INSERT INTO canonical_schedule_human_approvals
         SELECT (jsonb_populate_record(
           NULL::canonical_schedule_human_approvals,
           to_jsonb(base) || jsonb_build_object(
             'id', synthetic.id,
             'preview_id', synthetic.preview_id,
             'idempotency_key_hash', md5(
               'm26-booking-history-key-' || synthetic.value::text) ||
               md5('m26-booking-history-key-b-' || synthetic.value::text),
             'approved_at', to_jsonb(base.approved_at -
               make_interval(secs => synthetic.value + 10))
           ))).*
           FROM canonical_schedule_human_approvals base
           CROSS JOIN synthetic_booking_approval_ids synthetic
          WHERE base.organization_id=$1 AND base.id=$2`,
        [f.org, matchingApprovalId]);
      await oversizedApprovalHistory.query(
        'ALTER TABLE canonical_forecast_booking_approval_orders DISABLE TRIGGER USER');
      await oversizedApprovalHistory.query(
        `INSERT INTO canonical_forecast_booking_approval_orders(
           organization_id,appointment_id,approval_id,source_order,observed_at)
         SELECT $1,$2,synthetic.id,
                nextval('canonical_forecast_booking_approval_order_sequence'),clock_timestamp()
           FROM synthetic_booking_approval_ids synthetic`,
        [f.org, appointment]);
      await oversizedApprovalHistory.query(
        `UPDATE canonical_forecast_booking_approval_orders
            SET source_order=nextval('canonical_forecast_booking_approval_order_sequence')
          WHERE organization_id=$1 AND approval_id=$2`,
        [f.org, matchingApprovalId]);
      const oversized = (await oversizedApprovalHistory.query(
        'SELECT public.canonical_forecast_booking_review_candidates($1,$2,$3,$4) value',
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]))
        .rows[0].value;
      expect(oversized).toMatchObject({
        state: 'booking_review_candidates_observed', candidateCount: 0,
        writeRechecksCurrentness: true, bookedWorkVerified: false });
    } finally {
      await oversizedApprovalHistory.query('ROLLBACK');
      oversizedApprovalHistory.release();
    }
    const candidateLaterLink = await post('/customer-estimate-links', {
      versionId: issuedVersionId, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(candidateLaterLink.status).toBe(201);
    const laterCandidateAcceptance = await f.ownerPool.connect();
    try {
      await laterCandidateAcceptance.query('BEGIN');
      await laterCandidateAcceptance.query(
        `INSERT INTO canonical_customer_estimate_delivery_events(
           organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,
           request_key_hash,request_digest,digest)
         SELECT organization_id,estimate_id,version_id,id,'accepted',
                $2::jsonb,NULL,$3,$4,$5
           FROM canonical_customer_estimate_delivery_links WHERE id=$1`,
        [candidateLaterLink.body.data.link.id,
          JSON.stringify({ customerName: 'Later candidate customer', confirmed: true,
            confirmationVersion: 'customer-estimate-accept-v1' }),
          crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
          crypto.randomBytes(32).toString('hex')]);
      const superseded = (await laterCandidateAcceptance.query(
        'SELECT public.canonical_forecast_booking_review_candidates($1,$2,$3,$4) value',
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]))
        .rows[0].value;
      expect(superseded).toMatchObject({
        state: 'booking_review_candidates_observed', candidateCount: 0,
        writeRechecksCurrentness: true, bookedWorkVerified: false });
    } finally {
      await laterCandidateAcceptance.query('ROLLBACK');
      laterCandidateAcceptance.release();
    }
    expect((await request(f.app).get(`${bookingRoute}/candidates`)
      .set(f.actors.otherOwner.session.headers)).body.data).toMatchObject({
      state: 'booking_review_candidates_observed', candidateCount: 0,
      recentWindowOnly: true, recentApprovalWindowLimit: 100 });
    expect((await request(f.app).get(`${bookingRoute}/candidates`)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const firstWrite = await request(f.app).post(`${bookingRoute}/first`)
      .set(actor.session.headers).set('Idempotency-Key', reviewParams[6])
      .send({ approvalId: matchingApprovalId, reason: reviewParams[5] });
    expect(firstWrite.status).toBe(201);
    expect((await request(f.app).get(`${bookingRoute}/candidates`)
      .set(actor.session.headers)).body.data).toMatchObject({
      state: 'booking_review_candidates_observed', candidateCount: 0 });
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
    const issuedDecisionId = (await f.ownerPool.query(
      `SELECT decision_id FROM canonical_customer_estimate_versions
        WHERE organization_id=$1 AND id=$2`, [f.org, issuedVersionId])).rows[0].decision_id;
    const futureOriginId = await createWitnessedFuturePriceOrigin(actor, issuedDecisionId);
    const integratedRoute =
      '/api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines';
    const positiveIntegrated = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ approvedPriceOriginId: futureOriginId,
        reason: 'Capture the positive owner-confirmed commercial position.',
        confirmed: true,
        confirmationVersion: 'integrated-commercial-baseline-v1' });
    if (positiveIntegrated.status !== 201) {
      const methodDebug = (await f.ownerPool.query(`SELECT
        public.canonical_forecast_price_flow_method_closure_current() legacy_current,
        m.dependency_closure_digest registered_v2,
        public.canonical_forecast_price_flow_method_closure_digest() current_digest,
        m.dependency_closure_digest=
          public.canonical_forecast_price_flow_method_closure_digest() v2_current
        FROM canonical_forecast_complete_window_governance_methods_v2 m
        WHERE m.version='m26_complete_window_deterministic_closure_v2'`)).rows[0];
      throw new Error('Positive integrated capture failed: ' +
        JSON.stringify({ body: positiveIntegrated.body, methodDebug }));
    }
    expect(positiveIntegrated.body.data).toMatchObject({
      state: 'northstar_integrated_commercial_baseline',
      authorizedEstimateBeforeTax: storedPrice.reviewed_price_before_tax,
      approvedPriceBeforeTax: storedPrice.reviewed_price_before_tax,
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
      commercialStatuses: { currentIssuedEstimateCount: 1,
        activeApprovedPriceCount: 1, ownerConfirmedBookedCount: 1 },
      sourceCurrent: true, futureApprovedPriceBaselineVerified: true,
      earnedRevenueMeasured: false, collectedCashMeasured: false,
      forecastIssued: false,
    });
    const positiveIntegratedRead = await request(f.app).get(
      `${integratedRoute}/${positiveIntegrated.body.data.positionId}`)
      .set(actor.session.headers);
    expect(positiveIntegratedRead.status).toBe(200);
    expect(positiveIntegratedRead.body.data).toMatchObject({
      positionId: positiveIntegrated.body.data.positionId,
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
      currentAtRead: true, sourceCurrent: true });
    const integratedBody = {
      approvedPriceOriginId: futureOriginId,
      reason: 'Capture an authorization-bound integrated commercial position.',
      confirmed: true,
      confirmationVersion: 'integrated-commercial-baseline-v1',
    };
    const integratedPositionCount = async () => Number((await f.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_integrated_commercial_positions
        WHERE organization_id=$1`, [f.org])).rows[0].count);
    const adminIntegrated = await request(f.app).post(integratedRoute)
      .set(f.actors.admin.session.headers)
      .set('Idempotency-Key', crypto.randomUUID()).send({ ...integratedBody,
        reason: 'Admin captures the same authorization-bound commercial position.' });
    expect(adminIntegrated.status).toBe(201);
    expect(adminIntegrated.body.data).toMatchObject({
      state: 'northstar_integrated_commercial_baseline', sourceCurrent: true,
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
      replayed: false,
    });
    const adminIntegratedRead = await request(f.app).get(
      `${integratedRoute}/${adminIntegrated.body.data.positionId}`)
      .set(f.actors.admin.session.headers);
    expect(adminIntegratedRead.status).toBe(200);
    expect(adminIntegratedRead.body.data).toMatchObject({
      positionId: adminIntegrated.body.data.positionId,
      state: 'northstar_integrated_commercial_baseline', sourceCurrent: true,
      currentAtRead: true,
    });

    // A genuine M24 decision insert owns the price-decision source fence. The
    // integrated writer may take its earlier locks, but it must return busy and
    // persist nothing until that price writer commits or rolls back.
    const decisionWriter = await f.ownerPool.connect();
    const decisionRaceKey = crypto.randomUUID();
    const countBeforeDecisionRace = await integratedPositionCount();
    try {
      await decisionWriter.query('BEGIN');
      await decisionWriter.query(
        `INSERT INTO canonical_estimate_decisions(
           organization_id,estimate_id,revision,previous_id,action,actor_user_id,
           membership_id,auth_session_id,actor_name,source_pins,scope_summary,
           price_before_tax,currency,reason,confirmation_version,request_key_hash,
           request_digest,digest)
         SELECT organization_id,estimate_id,revision+1,id,'approve',actor_user_id,
           membership_id,auth_session_id,actor_name,source_pins,scope_summary,
           price_before_tax,currency,'Concurrent synthetic price review',
           confirmation_version,$2,$3,$4
         FROM canonical_estimate_decisions
         WHERE organization_id=$1 AND id=$5`,
        [f.org, crypto.randomBytes(32).toString('hex'),
          crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
          issuedDecisionId]);
      const busy = await request(f.app).post(integratedRoute)
        .set(actor.session.headers).set('Idempotency-Key', decisionRaceKey)
        .send({ ...integratedBody,
          reason: 'Capture while a genuine approved-price writer is in flight.' });
      expect(busy.status).toBe(409);
      expect(busy.body.error.category).toBe('FORECAST_REVIEW_BUSY');
      expect(await integratedPositionCount()).toBe(countBeforeDecisionRace);
    } finally {
      await decisionWriter.query('ROLLBACK').catch(() => {});
      decisionWriter.release();
    }
    const afterDecisionRace = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', decisionRaceKey)
      .send({ ...integratedBody,
        reason: 'Capture while a genuine approved-price writer is in flight.' });
    expect(afterDecisionRace.status).toBe(201);
    expect(afterDecisionRace.body.data).toMatchObject({
      state: 'northstar_integrated_commercial_baseline', sourceCurrent: true,
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
    });

    // The production correction writer owns the shared commercial fence. A
    // simultaneous integrated capture must fail without a false-current row;
    // rollback restores the exact source and the same request can then commit.
    const reviewWriter = await f.runtimePool.connect();
    const reviewRaceKey = crypto.randomUUID();
    const countBeforeReviewRace = await integratedPositionCount();
    try {
      await reviewWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const pendingCorrection = (await reviewWriter.query(
        `SELECT public.canonical_forecast_correct_booking_review(
          $1,$2,$3,$4,$5,$6,$7,$8,$9) value`,
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          firstReviewId, matchingApprovalId,
          'Transactional correction writer ordering proof.', crypto.randomUUID(),
          actor.csrfToken])).rows[0].value;
      expect(pendingCorrection).toMatchObject({
        state: 'booking_corrected', previousReviewId: firstReviewId, replayed: false,
      });
      const busy = await request(f.app).post(integratedRoute)
        .set(actor.session.headers).set('Idempotency-Key', reviewRaceKey)
        .send({ ...integratedBody,
          reason: 'Capture while a production commercial review writer is in flight.' });
      expect(busy.status).toBe(409);
      expect(busy.body.error.category).toBe('FORECAST_REVIEW_BUSY');
      expect(await integratedPositionCount()).toBe(countBeforeReviewRace);
    } finally {
      await reviewWriter.query('ROLLBACK').catch(() => {});
      reviewWriter.release();
    }
    const afterReviewRace = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', reviewRaceKey)
      .send({ ...integratedBody,
        reason: 'Capture while a production commercial review writer is in flight.' });
    expect(afterReviewRace.status).toBe(201);
    expect(afterReviewRace.body.data).toMatchObject({
      state: 'northstar_integrated_commercial_baseline', sourceCurrent: true,
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
    });

    // Keep one real integrated capture transaction open after it has acquired
    // the commercial, profile, and price locks. An unrelated tenant still
    // completes its own integrated call, proving the combined lock is tenant
    // scoped rather than a global serialization point. Roll back the probe.
    const combinedCapture = await f.runtimePool.connect();
    const countBeforeCombinedProbe = await integratedPositionCount();
    try {
      await combinedCapture.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const heldCapture = (await combinedCapture.query(
        `SELECT public.canonical_forecast_capture_integrated_commercial_position(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value`,
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          actor.csrfToken, futureOriginId, crypto.randomUUID(),
          'Hold a real integrated capture while another tenant progresses.',
          true, 'integrated-commercial-baseline-v1'])).rows[0].value;
      expect(heldCapture).toMatchObject({
        state: 'northstar_integrated_commercial_baseline', sourceCurrent: true,
        replayed: false,
      });
      const unrelatedRequest = request(f.app).post(integratedRoute)
        .set(f.actors.otherOwner.session.headers)
        .set('Idempotency-Key', crypto.randomUUID()).send({ ...integratedBody,
          reason: 'Unrelated tenant progresses during another tenant capture.' });
      const unrelated = await Promise.race([
        unrelatedRequest,
        new Promise((_, reject) => setTimeout(() => reject(
          new Error('Unrelated tenant integrated capture did not progress')), 3000)),
      ]);
      expect(unrelated.status).toBe(200);
      expect(unrelated.body.data).toMatchObject({
        state: 'integrated_commercial_baseline_unavailable',
        reason: 'origin_or_activation_missing', sourceCurrent: false,
      });
      expect(await integratedPositionCount()).toBe(countBeforeCombinedProbe);
    } finally {
      await combinedCapture.query('ROLLBACK').catch(() => {});
      combinedCapture.release();
    }
    expect(await integratedPositionCount()).toBe(countBeforeCombinedProbe);

    const positionCountBeforeDenials = Number((await f.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_integrated_commercial_positions
        WHERE organization_id=$1`, [f.org])).rows[0].count);
    for (const deniedActor of [f.actors.dispatcher, f.actors.member, f.actors.viewer]) {
      expect((await request(f.app).post(integratedRoute)
        .set(deniedActor.session.headers)
        .set('Idempotency-Key', crypto.randomUUID()).send(integratedBody)).status)
        .toBe(403);
      expect((await request(f.app).get(
        `${integratedRoute}/${positiveIntegrated.body.data.positionId}`)
        .set(deniedActor.session.headers)).status).toBe(403);
    }
    expect((await request(f.app).post(integratedRoute)
      .set('Idempotency-Key', crypto.randomUUID()).send(integratedBody)).status)
      .toBe(401);
    expect((await request(f.app).get(
      `${integratedRoute}/${positiveIntegrated.body.data.positionId}`)).status)
      .toBe(401);
    expect((await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('X-CSRF-Token', 'invalid-csrf-token')
      .set('Idempotency-Key', crypto.randomUUID()).send(integratedBody)).status)
      .toBe(403);
    const otherTenantPosition = await request(f.app).get(
      `${integratedRoute}/${positiveIntegrated.body.data.positionId}`)
      .set(f.actors.otherOwner.session.headers);
    expect(otherTenantPosition.status).toBe(404);
    expect(JSON.stringify(otherTenantPosition.body)).not.toMatch(
      /authorizedEstimate|approvedPrice|bookedWork|digest|sourceCapture/i);
    await f.ownerPool.query(`UPDATE auth_sessions SET status='revoked',
      revoked_at=clock_timestamp(),revoke_reason='m26_part6a_integrated_test'
      WHERE id=$1`, [actor.authSessionId]);
    try {
      expect((await request(f.app).post(integratedRoute)
        .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
        .send(integratedBody)).status).toBe(401);
      expect((await request(f.app).get(
        `${integratedRoute}/${positiveIntegrated.body.data.positionId}`)
        .set(actor.session.headers)).status).toBe(401);
    } finally {
      await f.ownerPool.query(`UPDATE auth_sessions SET status='active',
        revoked_at=NULL,revoke_reason=NULL WHERE id=$1`, [actor.authSessionId]);
    }
    await f.ownerPool.query(`UPDATE organization_memberships SET status='suspended'
      WHERE organization_id=$1 AND user_id=$2`, [f.org, actor.actorUserId]);
    try {
      expect((await request(f.app).post(integratedRoute)
        .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
        .send(integratedBody)).status).toBe(403);
      expect((await request(f.app).get(
        `${integratedRoute}/${positiveIntegrated.body.data.positionId}`)
        .set(actor.session.headers)).status).toBe(403);
    } finally {
      await f.ownerPool.query(`UPDATE organization_memberships SET status='active'
        WHERE organization_id=$1 AND user_id=$2`, [f.org, actor.actorUserId]);
    }
    await f.ownerPool.query(`UPDATE subscriptions SET status='past_due'
      WHERE organization_id=$1`, [f.org]);
    try {
      expect((await request(f.app).post(integratedRoute)
        .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
        .send(integratedBody)).status).toBe(403);
      expect((await request(f.app).get(
        `${integratedRoute}/${positiveIntegrated.body.data.positionId}`)
        .set(actor.session.headers)).status).toBe(403);
    } finally {
      await f.ownerPool.query(`UPDATE subscriptions SET status='active'
        WHERE organization_id=$1`, [f.org]);
    }
    expect(Number((await f.ownerPool.query(
      `SELECT count(*) count FROM canonical_forecast_integrated_commercial_positions
        WHERE organization_id=$1`, [f.org])).rows[0].count))
      .toBe(positionCountBeforeDenials);
    const integratedBooked = (await f.ownerPool.query(
      `SELECT public.canonical_forecast_integrated_commercial_sources(
        $1,$2,$3,$4,$5) value`, [f.org, actor.actorUserId,
        actor.actorAccessRole, actor.authSessionId, storedPrice.currency]))
      .rows[0].value;
    expect(integratedBooked).toMatchObject({
      state: 'current_integrated_commercial_sources',
      authorizedEstimateBeforeTax: storedPrice.reviewed_price_before_tax,
      approvedPriceBeforeTax: storedPrice.reviewed_price_before_tax,
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
      commercialStatuses: { currentIssuedEstimateCount: 1,
        activeApprovedPriceCount: 1, ownerConfirmedBookedCount: 1,
        bookingConfirmationSourceCount: 1 },
      sourceCohortsCompleteAtRead: true, forecastIssued: false,
    });
    const sourceArgs = [f.org, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, storedPrice.currency];
    const readIntegratedSources = async client => (await client.query(
      `SELECT public.canonical_forecast_integrated_commercial_sources(
        $1,$2,$3,$4,$5) value`, sourceArgs)).rows[0].value;
    const dropForeignKeys = table => `DO $$
      DECLARE constraint_value RECORD;
      BEGIN
       FOR constraint_value IN
        SELECT conname FROM pg_catalog.pg_constraint
         WHERE conrelid='public.${table}'::regclass AND contype='f'
       LOOP
        EXECUTE format('ALTER TABLE public.${table} DROP CONSTRAINT %I',
          constraint_value.conname);
       END LOOP;
      END $$`;

    // A currency disagreement is incomplete evidence, never an amount that
    // can be coerced into the requested future-origin currency.
    expect((await f.ownerPool.query(
      `SELECT public.canonical_forecast_integrated_commercial_sources(
        $1,$2,$3,$4,$5) value`, [...sourceArgs.slice(0, 4), 'CAD']))
      .rows[0].value).toMatchObject({
      state: 'integrated_commercial_sources_unavailable',
      reason: 'mixed_currency', forecastIssued: false,
    });

    // A missing issued-version row inside a reviewed commercial lineage is
    // different from an authenticated zero. The lineage must fail closed.
    const missingIssuedProbe = await f.ownerPool.connect();
    try {
      await missingIssuedProbe.query('BEGIN');
      await missingIssuedProbe.query(
        dropForeignKeys('canonical_forecast_commercial_booking_reviews'));
      await missingIssuedProbe.query(`ALTER TABLE
        canonical_forecast_commercial_booking_reviews DISABLE TRIGGER
        canonical_forecast_commercial_booking_review_immutable`);
      await missingIssuedProbe.query(`UPDATE canonical_forecast_commercial_booking_reviews
        SET issued_version_id=gen_random_uuid()
        WHERE organization_id=$1 AND id=$2`, [f.org, firstReviewId]);
      expect(await readIntegratedSources(missingIssuedProbe)).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'booked_work_lineage_unavailable', forecastIssued: false,
      });
    } finally {
      await missingIssuedProbe.query('ROLLBACK').catch(() => {});
      missingIssuedProbe.release();
    }

    // With complete ledgers but no confirmation row, the source remains
    // authenticated and reports a reviewed-unconfirmed status plus 0.00
    // booked work. That is not normalized into missing coverage.
    const noConfirmationProbe = await f.ownerPool.connect();
    try {
      await noConfirmationProbe.query('BEGIN');
      await noConfirmationProbe.query(`ALTER TABLE
        canonical_forecast_booked_work_confirmations DISABLE TRIGGER
        canonical_forecast_booked_work_confirmation_immutable`);
      await noConfirmationProbe.query(`DELETE FROM
        canonical_forecast_booked_work_confirmations
        WHERE organization_id=$1 AND id=$2`, [f.org, confirmationId]);
      expect(await readIntegratedSources(noConfirmationProbe)).toMatchObject({
        state: 'current_integrated_commercial_sources',
        bookedWorkBeforeTax: '0.00',
        commercialStatuses: { ownerReviewedUnconfirmedCount: 1,
          ownerConfirmedBookedCount: 0, bookingConfirmationSourceCount: 0 },
        sourceCohortsCompleteAtRead: true, forecastIssued: false,
      });
    } finally {
      await noConfirmationProbe.query('ROLLBACK').catch(() => {});
      noConfirmationProbe.release();
    }

    // A latest issued estimate without a matching current approved decision
    // remains visible as stale status evidence but contributes no amount.
    const staleIssuedProbe = await f.ownerPool.connect();
    try {
      await staleIssuedProbe.query('BEGIN');
      await staleIssuedProbe.query(
        dropForeignKeys('canonical_customer_estimate_versions'));
      await staleIssuedProbe.query(`WITH synthetic AS (
          SELECT gen_random_uuid() version_id,gen_random_uuid() estimate_id,
            gen_random_uuid() approval_id,gen_random_uuid() terms_id,
            gen_random_uuid() decision_id,
            md5('m26-6a-stale-issued-a')||md5('m26-6a-stale-issued-b') hash_value
        )
        INSERT INTO canonical_customer_estimate_versions
        SELECT (jsonb_populate_record(NULL::canonical_customer_estimate_versions,
          to_jsonb(base)||jsonb_build_object(
            'id',synthetic.version_id,'estimate_id',synthetic.estimate_id,
            'revision',1,'previous_id',NULL,
            'commercial_approval_id',synthetic.approval_id,
            'terms_id',synthetic.terms_id,'decision_id',synthetic.decision_id,
            'approval_pin',jsonb_set(base.approval_pin,'{id}',
              to_jsonb(synthetic.approval_id::text)),
            'document',jsonb_set(base.document,'{subtotal}',
              to_jsonb('999999999999.99'::text)),
            'document_digest',synthetic.hash_value,
            'request_key_hash',synthetic.hash_value,
            'request_digest',synthetic.hash_value,
            'digest',synthetic.hash_value))).*
        FROM (SELECT * FROM canonical_customer_estimate_versions
          WHERE organization_id=$1 ORDER BY created_at,id LIMIT 1) base
        CROSS JOIN synthetic`, [f.org]);
      const staleIssued = await readIntegratedSources(staleIssuedProbe);
      expect(staleIssued).toMatchObject({
        state: 'current_integrated_commercial_sources',
        authorizedEstimateBeforeTax: storedPrice.reviewed_price_before_tax,
        approvedPriceBeforeTax: storedPrice.reviewed_price_before_tax,
        bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
        commercialStatuses: { currentIssuedEstimateCount: 1,
          staleIssuedEstimateCount: 1, issuedVersionSourceCount: 2,
          activeApprovedPriceCount: 1, ownerConfirmedBookedCount: 1 },
        sourceCohortsCompleteAtRead: true, forecastIssued: false,
      });
      expect(staleIssued.authorizedEstimateBeforeTax)
        .not.toBe('999999999999.99');
    } finally {
      await staleIssuedProbe.query('ROLLBACK').catch(() => {});
      staleIssuedProbe.release();
    }

    // Exercise every new 1,000-row source bound through the complete
    // production source helper. Each synthetic ledger expansion is rolled
    // back, so it proves exact-bound acceptance (or the later byte bound) and
    // +1 fail-close precedence without manufacturing durable evidence.
    const approvedBound = await f.ownerPool.connect();
    try {
      await approvedBound.query('BEGIN');
      await approvedBound.query(dropForeignKeys('canonical_estimate_decisions'));
      await approvedBound.query(`ALTER TABLE canonical_estimate_decisions
        DISABLE TRIGGER canonical_forecast_estimate_decision_source_fence`);
      await approvedBound.query(`CREATE TEMP TABLE m26_integrated_approved_bound
        ON COMMIT DROP AS SELECT value,
         gen_random_uuid() estimate_id,gen_random_uuid() decision_id,
         md5('m26-6a-approved-a-'||value::text)||
          md5('m26-6a-approved-b-'||value::text) hash_value
        FROM generate_series(1,1000) value`);
      const insertApproved = `INSERT INTO canonical_estimate_decisions
        SELECT (jsonb_populate_record(NULL::canonical_estimate_decisions,
          to_jsonb(base)||jsonb_build_object(
           'id',synthetic.decision_id,'estimate_id',synthetic.estimate_id,
           'revision',1,'previous_id',NULL,
           'request_key_hash',synthetic.hash_value,
           'request_digest',synthetic.hash_value,
           'digest',synthetic.hash_value))).*
        FROM (SELECT * FROM canonical_estimate_decisions
               WHERE organization_id=$1 AND action='approve'
               ORDER BY revision DESC,id DESC LIMIT 1) base
        CROSS JOIN m26_integrated_approved_bound synthetic
        WHERE synthetic.value BETWEEN $2 AND $3`;
      await approvedBound.query(insertApproved, [f.org, 1, 999]);
      expect(await readIntegratedSources(approvedBound)).toMatchObject({
        state: 'current_integrated_commercial_sources',
        commercialStatuses: { activeApprovedPriceCount: 1000 },
        sourceCohortsCompleteAtRead: true,
      });
      await approvedBound.query(insertApproved, [f.org, 1000, 1000]);
      expect(await readIntegratedSources(approvedBound)).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'approved_price_source_limit', forecastIssued: false,
      });
    } finally {
      await approvedBound.query('ROLLBACK').catch(() => {});
      approvedBound.release();
    }

    // The aggregate amount ceiling deliberately takes precedence over the
    // 1,001-row source ceiling. Exercise that ordering through the production
    // helper, then prove the refused source evaluation stores no integrated
    // position. All synthetic decisions remain rollback-only.
    const approvedAmountBound = await f.ownerPool.connect();
    try {
      await approvedAmountBound.query('BEGIN');
      await approvedAmountBound.query(
        dropForeignKeys('canonical_estimate_decisions'));
      await approvedAmountBound.query(`ALTER TABLE canonical_estimate_decisions
        DISABLE TRIGGER canonical_forecast_estimate_decision_source_fence`);
      // With 1,001 max-valued synthetic approvals plus the fixture approval,
      // the helper's LIMIT 1001 necessarily sees either 1,001 maxima or 1,000
      // maxima plus the fixture amount. The fixture amount exceeds the $9.99
      // gap between 1,000 maxima and the aggregate ceiling.
      expect(Number(storedPrice.reviewed_price_before_tax)).toBeGreaterThan(9.99);
      await approvedAmountBound.query(`CREATE TEMP TABLE
        m26_integrated_approved_amount_bound ON COMMIT DROP AS SELECT value,
         gen_random_uuid() estimate_id,gen_random_uuid() decision_id,
          md5('m26-6a-approved-amount-a-'||value::text)||
          md5('m26-6a-approved-amount-b-'||value::text) hash_value
        FROM generate_series(1,1001) value`);
      await approvedAmountBound.query(`INSERT INTO canonical_estimate_decisions
        SELECT (jsonb_populate_record(NULL::canonical_estimate_decisions,
          to_jsonb(base)||jsonb_build_object(
           'id',synthetic.decision_id,'estimate_id',synthetic.estimate_id,
           'revision',1,'previous_id',NULL,
           'price_before_tax','999999999999.99',
           'request_key_hash',synthetic.hash_value,
           'request_digest',synthetic.hash_value,
           'digest',synthetic.hash_value))).*
        FROM (SELECT * FROM canonical_estimate_decisions
               WHERE organization_id=$1 AND action='approve'
               ORDER BY revision DESC,id DESC LIMIT 1) base
        CROSS JOIN m26_integrated_approved_amount_bound synthetic`, [f.org]);
      const amountPositionCount = Number((await approvedAmountBound.query(
        `SELECT count(*) count FROM canonical_forecast_integrated_commercial_positions
          WHERE organization_id=$1`, [f.org])).rows[0].count);
      expect(await readIntegratedSources(approvedAmountBound)).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'amount_exceeds_limit', forecastIssued: false,
      });
      // Source evaluation is side-effect free: the refused production-helper
      // result cannot create an integrated receipt even inside this owner
      // transaction.
      expect(Number((await approvedAmountBound.query(
        `SELECT count(*) count FROM canonical_forecast_integrated_commercial_positions
          WHERE organization_id=$1`, [f.org])).rows[0].count))
        .toBe(amountPositionCount);
    } finally {
      await approvedAmountBound.query('ROLLBACK').catch(() => {});
      approvedAmountBound.release();
    }

    const issuedCurrentBound = await f.ownerPool.connect();
    try {
      await issuedCurrentBound.query('BEGIN');
      await issuedCurrentBound.query(
        dropForeignKeys('canonical_customer_estimate_versions'));
      await issuedCurrentBound.query(
        dropForeignKeys('canonical_forecast_approved_estimate_v2_current_sources'));
      await issuedCurrentBound.query(`CREATE TEMP TABLE m26_integrated_issued_current
        ON COMMIT DROP AS SELECT value,
         gen_random_uuid() estimate_id,gen_random_uuid() version_id,
         gen_random_uuid() decision_id,
         md5('m26-6a-issued-current-a-'||value::text)||
          md5('m26-6a-issued-current-b-'||value::text) hash_value
        FROM generate_series(1,1000) value`);
      const insertIssuedCurrent = `INSERT INTO canonical_customer_estimate_versions
        SELECT (jsonb_populate_record(NULL::canonical_customer_estimate_versions,
          to_jsonb(base)||jsonb_build_object(
           'id',synthetic.version_id,'estimate_id',synthetic.estimate_id,
           'revision',1,'previous_id',NULL,
           'decision_id',synthetic.decision_id,
           'document_digest',synthetic.hash_value,
           'request_key_hash',synthetic.hash_value,
           'request_digest',synthetic.hash_value,
           'digest',synthetic.hash_value))).*
        FROM (SELECT * FROM canonical_customer_estimate_versions
               WHERE organization_id=$1 ORDER BY created_at,id LIMIT 1) base
        CROSS JOIN m26_integrated_issued_current synthetic
        WHERE synthetic.value BETWEEN $2 AND $3`;
      const insertIssuedCurrentSources = `INSERT INTO
          canonical_forecast_approved_estimate_v2_current_sources(
           organization_id,estimate_id,decision_id,revision,action,digest,
           recorded_at,source_order)
        SELECT $1,synthetic.estimate_id,synthetic.decision_id,1,'approve',
          synthetic.hash_value,clock_timestamp(),0
        FROM m26_integrated_issued_current synthetic
        WHERE synthetic.value BETWEEN $2 AND $3`;
      await issuedCurrentBound.query(insertIssuedCurrent, [f.org, 1, 999]);
      await issuedCurrentBound.query(insertIssuedCurrentSources, [f.org, 1, 999]);
      const issuedCurrentExact = await readIntegratedSources(issuedCurrentBound);
      expect(issuedCurrentExact).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'issued_estimate_manifest_size', forecastIssued: false,
      });
      expect(issuedCurrentExact.reason).not.toBe('issued_estimate_source_limit');
      await issuedCurrentBound.query(insertIssuedCurrent, [f.org, 1000, 1000]);
      await issuedCurrentBound.query(insertIssuedCurrentSources,
        [f.org, 1000, 1000]);
      expect(await readIntegratedSources(issuedCurrentBound)).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'issued_estimate_source_limit', forecastIssued: false,
      });
    } finally {
      await issuedCurrentBound.query('ROLLBACK').catch(() => {});
      issuedCurrentBound.release();
    }

    const issuedHistoryBound = await f.ownerPool.connect();
    try {
      await issuedHistoryBound.query('BEGIN');
      await issuedHistoryBound.query(
        dropForeignKeys('canonical_customer_estimate_versions'));
      await issuedHistoryBound.query(`CREATE TEMP TABLE m26_integrated_issued_history
        ON COMMIT DROP AS SELECT value,
         gen_random_uuid() version_id,gen_random_uuid() approval_id,
         md5('m26-6a-issued-history-a-'||value::text)||
          md5('m26-6a-issued-history-b-'||value::text) hash_value
        FROM generate_series(2,1001) value`);
      const insertIssuedHistory = `INSERT INTO canonical_customer_estimate_versions
        SELECT (jsonb_populate_record(NULL::canonical_customer_estimate_versions,
          to_jsonb(base)||jsonb_build_object(
           'id',synthetic.version_id,'revision',synthetic.value,
           'previous_id',base.id,
           'commercial_approval_id',synthetic.approval_id,
           'approval_pin',jsonb_set(base.approval_pin,'{id}',
             to_jsonb(synthetic.approval_id::text)),
           'document_digest',synthetic.hash_value,
           'request_key_hash',synthetic.hash_value,
           'request_digest',synthetic.hash_value,
           'digest',synthetic.hash_value))).*
        FROM (SELECT * FROM canonical_customer_estimate_versions
               WHERE organization_id=$1 ORDER BY created_at,id LIMIT 1) base
        CROSS JOIN m26_integrated_issued_history synthetic
        WHERE synthetic.value BETWEEN $2 AND $3`;
      await issuedHistoryBound.query(insertIssuedHistory, [f.org, 2, 1000]);
      const issuedHistoryExact = await readIntegratedSources(issuedHistoryBound);
      expect(issuedHistoryExact).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'issued_estimate_manifest_size', forecastIssued: false,
      });
      expect(issuedHistoryExact.reason)
        .not.toBe('issued_estimate_history_source_limit');
      await issuedHistoryBound.query(insertIssuedHistory, [f.org, 1001, 1001]);
      expect(await readIntegratedSources(issuedHistoryBound)).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'issued_estimate_history_source_limit', forecastIssued: false,
      });
    } finally {
      await issuedHistoryBound.query('ROLLBACK').catch(() => {});
      issuedHistoryBound.release();
    }

    const reviewBound = await f.ownerPool.connect();
    try {
      await reviewBound.query('BEGIN');
      await reviewBound.query(
        dropForeignKeys('canonical_forecast_commercial_booking_reviews'));
      await reviewBound.query(`CREATE TEMP TABLE m26_integrated_review_bound
        ON COMMIT DROP AS SELECT value,
         gen_random_uuid() review_id,gen_random_uuid() appointment_id,
         gen_random_uuid() opportunity_id,
         md5('m26-6a-review-a-'||value::text)||
          md5('m26-6a-review-b-'||value::text) hash_value
        FROM generate_series(1,1000) value`);
      const insertReviews = `INSERT INTO canonical_forecast_commercial_booking_reviews
        SELECT (jsonb_populate_record(
          NULL::canonical_forecast_commercial_booking_reviews,
          to_jsonb(base)||jsonb_build_object(
           'id',synthetic.review_id,
           'appointment_id',synthetic.appointment_id,
           'opportunity_id',synthetic.opportunity_id,
           'action','booking_cancelled','previous_review_id',base.id,
           'review_order',base.review_order+synthetic.value,
           'request_key_hash',synthetic.hash_value,
           'request_digest',synthetic.hash_value))).*
        FROM canonical_forecast_commercial_booking_reviews base
        CROSS JOIN m26_integrated_review_bound synthetic
        WHERE base.organization_id=$1 AND base.id=$2
         AND synthetic.value BETWEEN $3 AND $4`;
      await reviewBound.query(insertReviews, [f.org, firstReviewId, 1, 999]);
      const reviewExact = await readIntegratedSources(reviewBound);
      expect(reviewExact).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'booked_work_manifest_size', forecastIssued: false,
      });
      expect(reviewExact.reason).not.toBe('commercial_review_source_limit');
      await reviewBound.query(insertReviews, [f.org, firstReviewId, 1000, 1000]);
      expect(await readIntegratedSources(reviewBound)).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'commercial_review_source_limit', forecastIssued: false,
      });
    } finally {
      await reviewBound.query('ROLLBACK').catch(() => {});
      reviewBound.release();
    }

    const confirmationBound = await f.ownerPool.connect();
    try {
      await confirmationBound.query('BEGIN');
      await confirmationBound.query(`CREATE TEMP TABLE m26_integrated_confirmation_bound
        ON COMMIT DROP AS SELECT value,
         gen_random_uuid() review_id,gen_random_uuid() confirmation_id,
         md5('m26-6a-confirm-a-'||value::text)||
          md5('m26-6a-confirm-b-'||value::text) hash_value
        FROM generate_series(1,1000) value`);
      const insertConfirmationReviews = `
        INSERT INTO canonical_forecast_commercial_booking_reviews
        SELECT (jsonb_populate_record(
          NULL::canonical_forecast_commercial_booking_reviews,
          to_jsonb(base)||jsonb_build_object(
           'id',synthetic.review_id,'action','booking_corrected',
           'previous_review_id',base.id,
           'review_order',base.review_order+synthetic.value,
           'request_key_hash',synthetic.hash_value,
           'request_digest',synthetic.hash_value))).*
        FROM canonical_forecast_commercial_booking_reviews base
        CROSS JOIN m26_integrated_confirmation_bound synthetic
        WHERE base.organization_id=$1 AND base.id=$2
         AND synthetic.value BETWEEN $3 AND $4`;
      const insertConfirmations = `
        INSERT INTO canonical_forecast_booked_work_confirmations
        SELECT (jsonb_populate_record(
          NULL::canonical_forecast_booked_work_confirmations,
          to_jsonb(base)||jsonb_build_object(
           'id',synthetic.confirmation_id,'review_id',synthetic.review_id,
           'request_key_hash',synthetic.hash_value,
           'request_digest',synthetic.hash_value))).*
        FROM canonical_forecast_booked_work_confirmations base
        CROSS JOIN m26_integrated_confirmation_bound synthetic
        WHERE base.organization_id=$1 AND base.id=$2
         AND synthetic.value BETWEEN $3 AND $4`;
      await confirmationBound.query(insertConfirmationReviews,
        [f.org, firstReviewId, 1, 999]);
      await confirmationBound.query(insertConfirmations,
        [f.org, confirmationId, 1, 999]);
      await confirmationBound.query(`
        INSERT INTO canonical_forecast_commercial_booking_reviews
        SELECT (jsonb_populate_record(
          NULL::canonical_forecast_commercial_booking_reviews,
          to_jsonb(base)||jsonb_build_object(
           'id',gen_random_uuid(),'action','booking_cancelled',
           'previous_review_id',base.id,'review_order',base.review_order+2001,
           'request_key_hash',md5('m26-6a-confirm-cancel-a')||
             md5('m26-6a-confirm-cancel-b'),
           'request_digest',md5('m26-6a-confirm-cancel-c')||
             md5('m26-6a-confirm-cancel-d')))).*
        FROM canonical_forecast_commercial_booking_reviews base
        WHERE base.organization_id=$1 AND base.id=$2`, [f.org, firstReviewId]);
      const confirmationExact = await readIntegratedSources(confirmationBound);
      expect(confirmationExact).toMatchObject({
        state: 'current_integrated_commercial_sources',
        commercialStatuses: { bookingConfirmationSourceCount: 1000 },
        sourceCohortsCompleteAtRead: true,
      });
      await confirmationBound.query(insertConfirmationReviews,
        [f.org, firstReviewId, 1000, 1000]);
      await confirmationBound.query(insertConfirmations,
        [f.org, confirmationId, 1000, 1000]);
      expect(await readIntegratedSources(confirmationBound)).toMatchObject({
        state: 'integrated_commercial_sources_unavailable',
        reason: 'booked_work_confirmation_source_limit', forecastIssued: false,
      });
    } finally {
      await confirmationBound.query('ROLLBACK').catch(() => {});
      confirmationBound.release();
    }
    const confirmationMonth = (await f.ownerPool.query(
      `SELECT to_char(confirmed_at AT TIME ZONE 'UTC','YYYY-MM') AS month
         FROM canonical_forecast_booked_work_confirmations
        WHERE organization_id=$1 AND id=$2`, [f.org, confirmationId])).rows[0].month;
    const observedMonthRoute = `${bookingRoute}/booked-work/months/${confirmationMonth}/observed`;
    const observedMonth = await request(f.app).get(observedMonthRoute)
      .set(actor.session.headers);
    expect(observedMonth.status).toBe(200);
    expect(observedMonth.body.data).toMatchObject({
      state: 'observed_owner_confirmed_jobs', month: confirmationMonth,
      timeZone: 'UTC', confirmedJobCount: 1,
      observedBeforeTax: storedPrice.reviewed_price_before_tax,
      currency: storedPrice.currency, includedJobConfirmationsVerified: true,
      completePeriodVerified: false, wholeBusinessCoverageVerified: false,
      earnedRevenueMeasured: false, collectedCashMeasured: false,
      forecastIssued: false });
    const noHistoryMonth = await request(f.app)
      .get(`${bookingRoute}/booked-work/months/1999-01/observed`)
      .set(actor.session.headers);
    expect(noHistoryMonth.body.data).toMatchObject({
      state: 'booked_work_month_unavailable', reason: 'no_confirmed_jobs',
      completePeriodVerified: false, forecastIssued: false });
    expect(noHistoryMonth.body.data).not.toHaveProperty('observedBeforeTax');
    expect((await request(f.app)
      .get(`${bookingRoute}/booked-work/months/0000-01/observed`)
      .set(actor.session.headers)).status).toBe(400);
    const otherTenantMonth = await request(f.app).get(observedMonthRoute)
      .set(f.actors.otherOwner.session.headers);
    expect(otherTenantMonth.body.data).toMatchObject({
      state: 'booked_work_month_unavailable', reason: 'no_confirmed_jobs' });
    expect(otherTenantMonth.body.data).not.toHaveProperty('observedBeforeTax');
    expect((await request(f.app).get(observedMonthRoute)
      .set(f.actors.member.session.headers)).status).toBe(403);
    const sourceMonthRoute = `${bookingRoute}/booked-work/months/${confirmationMonth}/source`;
    const missingAnchor = await request(f.app).get(sourceMonthRoute)
      .set(actor.session.headers);
    expect(missingAnchor.body.data).toMatchObject({
      state: 'booked_work_source_month_unavailable',
      reason: 'source_anchor_missing', sourceMonthCoverageVerified: false,
      completePeriodVerified: false, forecastIssued: false });
    expect(missingAnchor.body.data).not.toHaveProperty('currentConfirmedBeforeTax');
    const anchorRoute = `${bookingRoute}/booked-work/source-anchor`;
    const anchorBody = { reason: 'Begin observing future synthetic booked confirmations.',
      confirmed: true, confirmationVersion: 'booked-work-source-anchor-v1' };
    const anchorKey = 'm26-booked-source-anchor-key-001';
    expect((await request(f.app).post(anchorRoute)
      .set(actor.session.headers).set('X-CSRF-Token', 'invalid-csrf-token')
      .set('Idempotency-Key', anchorKey).send(anchorBody)).status).toBe(403);
    expect((await request(f.app).post(anchorRoute)
      .set(f.actors.member.session.headers).set('Idempotency-Key', anchorKey)
      .send(anchorBody)).status).toBe(403);
    const anchored = await request(f.app).post(anchorRoute)
      .set(actor.session.headers).set('Idempotency-Key', anchorKey)
      .send(anchorBody);
    expect(anchored.status).toBe(201);
    expect(anchored.body.data).toMatchObject({
      state: 'booked_work_source_anchored', replayed: false,
      completePeriodVerified: false, forecastIssued: false });
    expect((await request(f.app).post(anchorRoute)
      .set(actor.session.headers).set('Idempotency-Key', anchorKey)
      .send(anchorBody)).body.data).toMatchObject({
      anchorId: anchored.body.data.anchorId, replayed: true });
    expect((await request(f.app).post(anchorRoute)
      .set(actor.session.headers).set('Idempotency-Key', anchorKey)
      .send({ ...anchorBody, reason: 'A changed anchor reason cannot reuse this key.' }))
      .status).toBe(409);
    const incompleteCurrentMonth = await request(f.app).get(sourceMonthRoute)
      .set(actor.session.headers);
    expect(incompleteCurrentMonth.body.data).toMatchObject({
      state: 'booked_work_source_month_unavailable',
      reason: 'month_before_source_anchor', sourceMonthCoverageVerified: false });
    expect(incompleteCurrentMonth.body.data).not.toHaveProperty('currentConfirmedBeforeTax');
    await expect(f.runtimePool.query(
      'SELECT * FROM canonical_forecast_booked_work_anchors'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      'DELETE FROM canonical_forecast_booked_work_anchors WHERE organization_id=$1',
      [f.org])).rejects.toMatchObject({ code: '23514' });
    // Test only: roll back shifted source dates to exercise a closed future
    // month without manufacturing durable historical coverage evidence.
    const syntheticClosedMonth = await f.ownerPool.connect();
    try {
      await syntheticClosedMonth.query('BEGIN');
      await syntheticClosedMonth.query(
        'ALTER TABLE canonical_forecast_booked_work_anchors DISABLE TRIGGER USER');
      await syntheticClosedMonth.query(
        'ALTER TABLE canonical_forecast_booked_work_confirmations DISABLE TRIGGER USER');
      await syntheticClosedMonth.query(
        `UPDATE canonical_forecast_booked_work_anchors
            SET captured_at='2024-12-01T00:00:00Z'
          WHERE organization_id=$1`, [f.org]);
      await syntheticClosedMonth.query(
        `UPDATE canonical_forecast_booked_work_confirmations
            SET confirmed_at='2025-01-15T00:00:00Z'
          WHERE organization_id=$1 AND id=$2`, [f.org, confirmationId]);
      const closed = (await syntheticClosedMonth.query(
        'SELECT public.canonical_forecast_booked_work_source_month($1,$2,$3,$4,$5) value',
        [f.org, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, '2025-01'])).rows[0].value;
      expect(closed).toMatchObject({
        state: 'northstar_confirmation_source_month_current',
        currentConfirmedBeforeTax: storedPrice.reviewed_price_before_tax,
        sourceMonthCoverageVerified: true, completePeriodVerified: false,
        wholeBusinessCoverageVerified: false, forecastIssued: false });
    } finally {
      await syntheticClosedMonth.query('ROLLBACK');
      syntheticClosedMonth.release();
    }
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

    // One opportunity is one commercial sale even when two genuinely scheduled
    // appointments are separately reviewed and confirmed. Exercise the mounted
    // HTTP capture rather than only the private source helper, then cancel the
    // duplicate appointment so the remaining lifecycle assertions stay focused
    // on the original job.
    const duplicateOperationId = crypto.randomUUID();
    const duplicateAppointmentId = crypto.randomUUID();
    const duplicateGraphId = crypto.randomUUID();
    const originalCommercialIdentity = (await f.ownerPool.query(
      `SELECT appointment.opportunity_id,opportunity.customer_id
         FROM canonical_appointments appointment
         JOIN canonical_opportunities opportunity
           ON opportunity.organization_id=appointment.organization_id
          AND opportunity.id=appointment.opportunity_id
        WHERE appointment.organization_id=$1 AND appointment.id=$2`,
      [f.org, appointment])).rows[0];
    await f.ownerPool.query(
      `INSERT INTO canonical_operations(
         id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,
         state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$5,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [duplicateOperationId, f.org, duplicateGraphId,
        crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex')]);
    await f.ownerPool.query(
      `INSERT INTO canonical_transcripts(
         id,organization_id,operation_id,graph_id,customer_id,source,source_version,
         transcript_text,normalized_fingerprint)
       VALUES($1,$2,$3,$4,$5,'manual','m26-part6a-duplicate-proof-v1',$6,$7)`,
      [crypto.randomUUID(), f.org, duplicateOperationId, duplicateGraphId,
        originalCommercialIdentity.customer_id,
        'Second current appointment for duplicate commercial opportunity proof.',
        crypto.randomBytes(32).toString('hex')]);
    await f.ownerPool.query(
      `INSERT INTO canonical_appointments(
         id,organization_id,operation_id,graph_id,opportunity_id,status)
       VALUES($1,$2,$3,$4,$5,'preferred')`,
      [duplicateAppointmentId, f.org, duplicateOperationId, duplicateGraphId,
        originalCommercialIdentity.opportunity_id]);
    const duplicateBefore = (await f.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) AS digest,appointment_status
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`,
      [f.org, duplicateAppointmentId])).rows[0];
    const duplicatePreview = await request(f.app).post(
      `/api/v1/canonical/appointments/${duplicateAppointmentId}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(duplicateBefore.revision),
        expectedDigest: duplicateBefore.digest, expectedTimeZone: 'UTC', action: 'schedule',
        target: { kind: 'unassigned', id: null },
        scheduledStart: '2029-06-13T13:00:00.000Z',
        scheduledEnd: '2029-06-13T14:00:00.000Z',
        appointmentStatus: duplicateBefore.appointment_status,
        reason: 'Schedule a second synthetic appointment for duplicate-sale refusal proof.' });
    expect(duplicatePreview.status).toBe(201);
    const duplicateApproval = await request(f.app).post(
      `/api/v1/canonical/appointments/${duplicateAppointmentId}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ previewId: duplicatePreview.body.data.id,
        previewDigest: duplicatePreview.body.data.previewDigest,
        acknowledgedWarningDigests: duplicatePreview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: duplicatePreview.body.data.reviewReasonDigests,
        reason: 'Schedule a second synthetic appointment for duplicate-sale refusal proof.' });
    expect(duplicateApproval.status).toBe(200);
    const duplicateApprovalId = (await f.ownerPool.query(
      `SELECT id FROM canonical_schedule_human_approvals
        WHERE organization_id=$1 AND appointment_id=$2
        ORDER BY approved_at DESC LIMIT 1`, [f.org, duplicateAppointmentId])).rows[0].id;
    const duplicateReview = await request(f.app).post(`${bookingRoute}/first`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ approvalId: duplicateApprovalId,
        reason: 'Review the second current appointment for duplicate-sale refusal proof.' });
    expect(duplicateReview.status).toBe(201);
    const duplicateReviewId = duplicateReview.body.data.reviewId;

    // The production confirmation function reaches the migration-234 source
    // fence before it inserts. While that transaction is open, integrated
    // capture must report retryable contention and persist no position. The
    // identical request succeeds after the confirmation writer rolls back.
    const confirmationWriter = await f.runtimePool.connect();
    const confirmationRaceKey = crypto.randomUUID();
    const countBeforeConfirmationRace = await integratedPositionCount();
    try {
      await confirmationWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const pendingConfirmation = (await confirmationWriter.query(
        `SELECT public.canonical_forecast_confirm_booked_work(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value`,
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          duplicateReviewId, actor.csrfToken, crypto.randomUUID(),
          'Transactional confirmation writer ordering proof.', true,
          'owner-booked-work-confirm-v1'])).rows[0].value;
      expect(pendingConfirmation).toMatchObject({
        state: 'booking_confirmation_recorded', reviewId: duplicateReviewId,
        replayed: false,
      });
      const busy = await request(f.app).post(integratedRoute)
        .set(actor.session.headers).set('Idempotency-Key', confirmationRaceKey)
        .send({ ...integratedBody,
          reason: 'Capture while a production confirmation writer is in flight.' });
      expect(busy.status).toBe(409);
      expect(busy.body.error.category).toBe('FORECAST_REVIEW_BUSY');
      expect(await integratedPositionCount()).toBe(countBeforeConfirmationRace);
    } finally {
      await confirmationWriter.query('ROLLBACK').catch(() => {});
      confirmationWriter.release();
    }
    const afterConfirmationRace = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', confirmationRaceKey)
      .send({ ...integratedBody,
        reason: 'Capture while a production confirmation writer is in flight.' });
    expect(afterConfirmationRace.status).toBe(201);
    expect(afterConfirmationRace.body.data).toMatchObject({
      state: 'northstar_integrated_commercial_baseline', sourceCurrent: true,
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
    });
    const duplicateConfirmation = await request(f.app)
      .post(`${bookingRoute}/${duplicateReviewId}/confirm-booked`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...confirmBody,
        reason: 'Confirm the second current appointment for duplicate-sale refusal proof.' });
    expect(duplicateConfirmation.status).toBe(201);
    const positionCountBeforeDuplicate = await integratedPositionCount();
    const duplicateCapture = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ approvedPriceOriginId: futureOriginId,
        reason: 'Refuse duplicate current appointments for one commercial opportunity.',
        confirmed: true, confirmationVersion: 'integrated-commercial-baseline-v1' });
    expect(duplicateCapture.status).toBe(200);
    expect(duplicateCapture.body.data).toMatchObject({
      state: 'integrated_commercial_baseline_unavailable',
      reason: 'duplicate_current_booked_opportunity', positionId: null,
      sourceCurrent: false, sourceCohortsCompleteAtRead: false,
      futureApprovedPriceBaselineVerified: false,
    });
    expect(duplicateCapture.body.data).not.toHaveProperty('bookedWorkBeforeTax');
    expect((await f.ownerPool.query(
      `SELECT count(*)::int count FROM canonical_forecast_integrated_commercial_positions
        WHERE organization_id=$1`, [f.org])).rows[0].count)
      .toBe(positionCountBeforeDuplicate);
    const duplicateCancellation = await request(f.app)
      .post(`${bookingRoute}/${duplicateReviewId}/cancel`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Cancel the duplicate synthetic appointment after refusal proof.' });
    expect(duplicateCancellation.status).toBe(201);

    const beforeCorrectionKey = crypto.randomUUID();
    const beforeCorrectionBody = { approvedPriceOriginId: futureOriginId,
      reason: 'Pin the current source digest before correcting the original review.',
      confirmed: true, confirmationVersion: 'integrated-commercial-baseline-v1' };
    const beforeCorrectionIntegrated = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', beforeCorrectionKey)
      .send(beforeCorrectionBody);
    expect(beforeCorrectionIntegrated.status).toBe(201);
    expect(beforeCorrectionIntegrated.body.data).toMatchObject({
      state: 'northstar_integrated_commercial_baseline',
      bookedWorkBeforeTax: storedPrice.reviewed_price_before_tax,
      commercialStatuses: { ownerConfirmedBookedCount: 1,
        cancelledBookingCount: 1, bookingConfirmationSourceCount: 2 },
    });
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
    const integratedAfterCorrection = (await f.ownerPool.query(
      `SELECT public.canonical_forecast_integrated_commercial_sources(
        $1,$2,$3,$4,$5) value`, [f.org, actor.actorUserId,
        actor.actorAccessRole, actor.authSessionId, storedPrice.currency]))
      .rows[0].value;
    expect(integratedAfterCorrection).toMatchObject({
      state: 'current_integrated_commercial_sources', bookedWorkBeforeTax: '0.00',
      commercialStatuses: { correctedAwaitingConfirmationCount: 1,
        correctedFormerlyConfirmedCount: 1, ownerConfirmedBookedCount: 0,
        cancelledBookingCount: 1, cancelledFormerlyConfirmedCount: 1,
        bookingConfirmationSourceCount: 2 },
      sourceCohortsCompleteAtRead: true, forecastIssued: false,
    });
    const correctionStalePosition = await request(f.app).get(
      `${integratedRoute}/${beforeCorrectionIntegrated.body.data.positionId}`)
      .set(actor.session.headers);
    expect(correctionStalePosition.status).toBe(200);
    expect(correctionStalePosition.body.data).toMatchObject({
      state: 'integrated_commercial_baseline_unavailable',
      reason: 'sources_changed_or_future_horizon_elapsed',
      positionId: beforeCorrectionIntegrated.body.data.positionId,
      sourceCurrent: false, sourceCohortsCompleteAtRead: false,
      futureApprovedPriceBaselineVerified: false,
    });
    expect(correctionStalePosition.body.data).not.toHaveProperty('bookedWorkBeforeTax');
    const correctionStaleCount = await integratedPositionCount();
    const sameKeyAfterCorrection = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', beforeCorrectionKey)
      .send(beforeCorrectionBody);
    expect(sameKeyAfterCorrection.status).toBe(200);
    expect(sameKeyAfterCorrection.headers['idempotency-replayed']).toBeUndefined();
    expect(sameKeyAfterCorrection.body.data).toMatchObject({
      state: 'integrated_commercial_baseline_unavailable',
      reason: 'sources_changed_since_capture',
      positionId: beforeCorrectionIntegrated.body.data.positionId,
      sourceCurrent: false, sourceCohortsCompleteAtRead: false,
      futureApprovedPriceBaselineVerified: false, forecastIssued: false,
    });
    expect(sameKeyAfterCorrection.body.data).not.toHaveProperty('replayed');
    expect(sameKeyAfterCorrection.body.data).not.toHaveProperty('bookedWorkBeforeTax');
    expect(await integratedPositionCount()).toBe(correctionStaleCount);
    const changedMonth = await request(f.app).get(observedMonthRoute)
      .set(actor.session.headers);
    expect(changedMonth.body.data).toMatchObject({
      state: 'booked_work_month_unavailable',
      reason: 'confirmation_changed_or_unavailable',
      completePeriodVerified: false, forecastIssued: false });
    expect(changedMonth.body.data).not.toHaveProperty('observedBeforeTax');
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
    // A revoked acceptance must invalidate even an unconfirmed/corrected latest
    // review. Keep the probe transactional so the following saved position can
    // isolate cancellation as its only intervening source change.
    const revokedLineageProbe = await f.ownerPool.connect();
    try {
      await revokedLineageProbe.query('BEGIN');
      await revokedLineageProbe.query(
        `INSERT INTO canonical_customer_estimate_delivery_events(
           organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,
           request_key_hash,request_digest,digest)
         SELECT organization_id,estimate_id,version_id,id,'revoked',
                $2::jsonb,$3,$4,$5,$6
           FROM canonical_customer_estimate_delivery_links WHERE id=$1`,
        [link.body.data.link.id,
          JSON.stringify({ reason: 'Transactional revocation currentness probe.' }),
          actor.actorUserId, crypto.randomBytes(32).toString('hex'),
          crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex')]);
      const revokedCapture = (await revokedLineageProbe.query(
        `SELECT public.canonical_forecast_capture_integrated_commercial_position(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value`,
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          actor.csrfToken, futureOriginId,
          crypto.randomUUID(),
          'Fail closed after a current commercial acceptance is revoked.',
          true, 'integrated-commercial-baseline-v1'])).rows[0].value;
      expect(revokedCapture).toMatchObject({
        state: 'integrated_commercial_baseline_unavailable',
        reason: 'booked_work_lineage_unavailable', sourceCurrent: false,
        sourceCohortsCompleteAtRead: false,
        futureApprovedPriceBaselineVerified: false,
      });
      expect(revokedCapture).not.toHaveProperty('bookedWorkBeforeTax');
    } finally {
      await revokedLineageProbe.query('ROLLBACK');
      revokedLineageProbe.release();
    }
    const beforeCancellationIntegrated = await request(f.app).post(integratedRoute)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ approvedPriceOriginId: futureOriginId,
        reason: 'Pin the current zero source digest before cancelling the original review.',
        confirmed: true, confirmationVersion: 'integrated-commercial-baseline-v1' });
    expect(beforeCancellationIntegrated.status).toBe(201);
    expect(beforeCancellationIntegrated.body.data).toMatchObject({
      state: 'northstar_integrated_commercial_baseline', bookedWorkBeforeTax: '0.00',
      commercialStatuses: { correctedAwaitingConfirmationCount: 1,
        cancelledBookingCount: 1, bookingConfirmationSourceCount: 2 },
    });
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
    const integratedAfterCancellation = (await f.ownerPool.query(
      `SELECT public.canonical_forecast_integrated_commercial_sources(
        $1,$2,$3,$4,$5) value`, [f.org, actor.actorUserId,
        actor.actorAccessRole, actor.authSessionId, storedPrice.currency]))
      .rows[0].value;
    expect(integratedAfterCancellation).toMatchObject({
      state: 'current_integrated_commercial_sources', bookedWorkBeforeTax: '0.00',
      commercialStatuses: { cancelledBookingCount: 2,
        cancelledFormerlyConfirmedCount: 2, ownerConfirmedBookedCount: 0,
        bookingConfirmationSourceCount: 2 },
      sourceCohortsCompleteAtRead: true, forecastIssued: false,
    });
    const cancellationStalePosition = await request(f.app).get(
      `${integratedRoute}/${beforeCancellationIntegrated.body.data.positionId}`)
      .set(actor.session.headers);
    expect(cancellationStalePosition.status).toBe(200);
    expect(cancellationStalePosition.body.data).toMatchObject({
      state: 'integrated_commercial_baseline_unavailable',
      reason: 'sources_changed_or_future_horizon_elapsed',
      positionId: beforeCancellationIntegrated.body.data.positionId,
      sourceCurrent: false, sourceCohortsCompleteAtRead: false,
      futureApprovedPriceBaselineVerified: false,
    });
    expect(cancellationStalePosition.body.data).not.toHaveProperty('bookedWorkBeforeTax');
    const revoked = await post(`/customer-estimate-links/${link.body.data.link.id}/revoke`, {});
    expect(revoked.status).toBe(201);
    expect((await f.runtimePool.query(
      'SELECT public.canonical_forecast_commercial_review_currentness($1,$2,$3,$4,$5) value',
      [...currentnessParams.slice(0, 4), cancellation.reviewId])).rows[0].value)
      .toMatchObject({ state: 'booking_cancelled',
        reviewCurrentAtRead: false, bookedWorkVerified: false });
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
      'customer_estimate_acceptance', 'schedule_approval', 'schedule_approval',
      'schedule_approval', 'schedule_approval', 'customer_estimate_link_revocation',
    ]);
    expect(new Set(ordered.map(row => row.source_order))).toHaveProperty('size', 6);
    expect(ordered[0].delivery_event_id).toBeTruthy();
    expect(ordered[1].approval_id).toBeTruthy();
    expect(ordered[5].delivery_event_id).toBeTruthy();
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

  test('startup rejects inherited access to tenant-private booked-work tables', async () => {
    await f.ownerPool.query(
      'GRANT SELECT ON TABLE public.canonical_forecast_booked_work_confirmations TO PUBLIC');
    try {
      await expect(f.db.runMigrations({ pool: f.ownerPool, runtimePool: f.runtimePool }))
        .rejects.toThrow(/booked_work_confirmations_private/);
    } finally {
      await f.ownerPool.query(
        'REVOKE SELECT ON TABLE public.canonical_forecast_booked_work_confirmations FROM PUBLIC');
    }
    await f.ownerPool.query(
      'GRANT SELECT ON TABLE public.canonical_forecast_booked_work_anchors TO PUBLIC');
    try {
      await expect(f.db.runMigrations({ pool: f.ownerPool, runtimePool: f.runtimePool }))
        .rejects.toThrow(/booked_work_source_anchor_private/);
    } finally {
      await f.ownerPool.query(
        'REVOKE SELECT ON TABLE public.canonical_forecast_booked_work_anchors FROM PUBLIC');
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
      `SELECT source.approval_id
         FROM canonical_forecast_commercial_booking_orders source
         JOIN canonical_schedule_human_approvals approval
           ON approval.organization_id=source.organization_id
          AND approval.id=source.approval_id
         JOIN canonical_appointments appointment
           ON appointment.organization_id=approval.organization_id
          AND appointment.id=approval.appointment_id
        WHERE source.organization_id=$1 AND source.source_kind='schedule_approval'
          AND source.approval_id<>$2
          AND appointment.opportunity_id<>(
            SELECT matched_appointment.opportunity_id
              FROM canonical_schedule_human_approvals matched_approval
              JOIN canonical_appointments matched_appointment
                ON matched_appointment.organization_id=matched_approval.organization_id
               AND matched_appointment.id=matched_approval.appointment_id
             WHERE matched_approval.organization_id=$1 AND matched_approval.id=$2)
        ORDER BY source.source_order LIMIT 1`,
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
    const baselineOrderCount = (await f.ownerPool.query(
      `SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1`, [f.org])).rows[0].count;
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
      expect(beforeRelease).toBe(baselineOrderCount);
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
    const accepted = await acceptance;
    expect(accepted.status).toBe(201);
    const afterRelease = (await f.ownerPool.query(
      `SELECT source_kind FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order`, [f.org])).rows;
    expect(afterRelease).toHaveLength(baselineOrderCount + 1);
    expect(afterRelease.slice(baselineOrderCount)
      .filter(row => row.source_kind === 'customer_estimate_acceptance')).toHaveLength(1);

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
        [f.org])).rows[0].count).toBe(baselineOrderCount + 2);
    } finally {
      await transaction.query('ROLLBACK');
      transaction.release();
    }
    expect((await f.ownerPool.query(
       'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].count).toBe(baselineOrderCount + 1);
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
    const raceAppointment = f.estimateGraphs[0].ids.appointment;
    const raceAssignment = (await f.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) AS digest,appointment_status
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`,
      [f.org, raceAppointment])).rows[0];
    const raceReason = 'Order revocation against a real schedule approval writer';
    const racePreview = await request(f.app).post(
      `/api/v1/canonical/appointments/${raceAppointment}/mutation-previews`)
      .set(actor.session.headers).send({
        expectedRevision: Number(raceAssignment.revision),
        expectedDigest: raceAssignment.digest, expectedTimeZone: 'UTC',
        action: 'schedule', target: { kind: 'unassigned', id: null },
        scheduledStart: '2029-07-16T13:00:00.000Z',
        scheduledEnd: '2029-07-16T14:00:00.000Z',
        appointmentStatus: raceAssignment.appointment_status, reason: raceReason,
      });
    expect(racePreview.status).toBe(201);
    const raceApprovalBody = {
      previewId: racePreview.body.data.id,
      previewDigest: racePreview.body.data.previewDigest,
      acknowledgedWarningDigests: racePreview.body.data.warningDigests,
      acknowledgedReviewReasonDigests: racePreview.body.data.reviewReasonDigests,
      reason: raceReason,
    };
    const held = await f.ownerPool.connect();
    let revocation;
    let scheduleApproval;
    let acceptance;
    try {
      await held.query('BEGIN');
      await held.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('m26:commercial-booking-order:'||$1::text,0))",
        [f.org]);
      revocation = post(`/customer-estimate-links/${linkId}/revoke`, {})
        .then(response => response);
      expect(await waitForAdvisoryWaiters(1)).toBeGreaterThanOrEqual(1);
      scheduleApproval = request(f.app)
        .post(`/api/v1/canonical/appointments/${raceAppointment}/mutation-approvals`)
        .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
        .send(raceApprovalBody).then(response => response);
      acceptance = request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
        .set({ Host: 'localhost', Origin: 'http://localhost' })
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ customerName: 'Concurrent Revoked Customer', confirmed: true,
          confirmationVersion: 'customer-estimate-accept-v1' })
        .then(response => response);
      // The revocation is already queued first on the shared source lock.
      // Give both downstream production requests a chance to enter their
      // transactions, then release promptly inside the application lock
      // timeout. Their durable results below prove the required order.
      await new Promise(resolve => setTimeout(resolve, 100));
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
    const revokedResponse = await revocation;
    const scheduleApprovalResponse = await scheduleApproval;
    const acceptedResponse = await acceptance;
    expect(revokedResponse.status).toBe(201);
    expect(scheduleApprovalResponse.status).toBe(200);
    expect(acceptedResponse.status).toBe(409);
    const raceApprovalId = (await f.ownerPool.query(
      `SELECT id FROM canonical_schedule_human_approvals
        WHERE organization_id=$1 AND appointment_id=$2
        ORDER BY approved_at DESC LIMIT 1`, [f.org, raceAppointment])).rows[0].id;
    const raceOrders = (await f.ownerPool.query(
      `SELECT source_order,source_kind FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 AND
          ((source_kind='customer_estimate_link_revocation' AND delivery_event_id=(
            SELECT id FROM canonical_customer_estimate_delivery_events
             WHERE organization_id=$1 AND link_id=$2 AND kind='revoked'
             ORDER BY id DESC LIMIT 1)) OR
           (source_kind='schedule_approval' AND approval_id=$3))
        ORDER BY source_order`, [f.org, linkId, raceApprovalId])).rows;
    expect(raceOrders.map(row => row.source_kind)).toEqual([
      'customer_estimate_link_revocation', 'schedule_approval',
    ]);
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
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'reschedule',
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
