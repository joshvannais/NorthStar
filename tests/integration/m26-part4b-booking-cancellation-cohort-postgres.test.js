'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastTransitionCohortsRouter } =
  require('../../src/routes/forecastTransitionCohorts');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const CUTOFF = '2026-09-01T00:00:00.000000Z';
const HORIZON = '2026-09-08T00:00:00.000000Z';

realPostgres('Mission 26 Part 4B booking-cancellation cohort', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    // This focused cohort fixture writes only immutable source-history rows.
    // Remove unrelated upstream foreign keys in the disposable database so it
    // does not need to manufacture scheduling and estimating authority.
    const constraints = (await fixture.ownerPool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid='public.canonical_forecast_commercial_booking_reviews'::regclass
        AND contype='f'`)).rows;
    for (const { conname } of constraints) await fixture.ownerPool.query(
      `ALTER TABLE canonical_forecast_commercial_booking_reviews
       DROP CONSTRAINT "${conname.replace(/"/g, '""')}"`);
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function seedReview({ tenant = fixture.org, appointmentId = key(),
    action = 'first_booking_reviewed', previousReviewId = null,
    reviewedAt = '2026-08-20T12:00:00Z', reviewOrder = 1,
    connection = fixture.ownerPool } = {}) {
    const id = key(), actor = tenant === fixture.org ? fixture.actors.owner :
      fixture.actors.otherOwner;
    await connection.query(
        `INSERT INTO canonical_forecast_commercial_booking_reviews(
          id,organization_id,appointment_id,opportunity_id,approval_id,acceptance_id,
          estimate_id,issued_version_id,approved_decision_id,approved_decision_digest,
          reviewed_price_before_tax,currency,action,previous_review_id,reason,
          actor_user_id,auth_session_id,request_key_hash,request_digest,review_order,
          reviewed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'100.00','USD',$11,$12,
          'Fictional mounted transition cohort evidence',$13,$14,$15,$16,$17,$18)`,
        [id, tenant, appointmentId, key(), key(), key(), key(), key(), key(),
          hash(id + ':decision'), action, previousReviewId, actor.actorUserId,
          actor.authSessionId, hash(id + ':key'), hash(id + ':request'),
          reviewOrder, reviewedAt]);
    return { id, appointmentId };
  }

  function application(actor = fixture.actors.owner) {
    const app = express();
    app.use(express.json());
    const auth = (req, _res, next) => {
      req.user = { id: actor.actorUserId };
      req.tenantContext = { organizationId: actor.organizationId,
        userId: actor.actorUserId };
      req.orgId = actor.organizationId;
      req.userRole = actor.actorAccessRole;
      req.authSession = { id: actor.authSessionId };
      next();
    };
    const bypass = (_req, _res, next) => next();
    app.use('/api/v1/forecast/transition-cohorts',
      createForecastTransitionCohortsRouter({ auth, throttle: bypass,
        captureThrottle: bypass, poolProvider: () => fixture.runtimePool }));
    return app;
  }

  async function startupAuthority() {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      try {
        await fixture.db.grantAndVerifyRuntimeAuthorityForTests(client,
          { runtimeRole: fixture.roles.runtime });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  test('overlapping identical captures serialize into one create and one replay', async () => {
    await seedReview({ tenant: fixture.otherOrg, reviewOrder: 100 });
    await fixture.ownerPool.query(`
      CREATE FUNCTION public.m26_part4b_test_insert_delay()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.25); RETURN NEW; END $$;
      CREATE TRIGGER m26_part4b_test_insert_delay
      BEFORE INSERT ON canonical_forecast_booking_cancellation_cohorts
      FOR EACH ROW EXECUTE FUNCTION public.m26_part4b_test_insert_delay()`);
    try {
      const app = application(fixture.actors.otherOwner);
      const captureKey = `m26-p4b-overlap-${key()}`;
      const send = () => request(app)
        .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
        .set('X-CSRF-Token', fixture.actors.otherOwner.csrfToken)
        .set('Idempotency-Key', captureKey)
        .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map(value => value.status).sort()).toEqual([200, 201]);
      expect(responses.map(value => value.body.data.cohortId))
        .toEqual([responses[0].body.data.cohortId, responses[0].body.data.cohortId]);
      expect(responses.map(value => value.body.data.replayed).sort())
        .toEqual([false, true]);

      await fixture.ownerPool.query(`
        INSERT INTO canonical_forecast_commercial_booking_reviews(
          id,organization_id,appointment_id,opportunity_id,approval_id,acceptance_id,
          estimate_id,issued_version_id,approved_decision_id,approved_decision_digest,
          reviewed_price_before_tax,currency,action,previous_review_id,reason,
          actor_user_id,auth_session_id,request_key_hash,request_digest,review_order,
          reviewed_at)
        SELECT gen_random_uuid(),$1,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
          encode(sha256(convert_to('decision-'||series_value::text,'UTF8')),'hex'),
          '100.00','USD','first_booking_reviewed',NULL,
          'Fictional bounded overflow evidence',$2,$3,
          encode(sha256(convert_to('key-'||series_value::text,'UTF8')),'hex'),
          encode(sha256(convert_to('request-'||series_value::text,'UTF8')),'hex'),
          100+series_value,'2026-08-25T12:00:00Z'
        FROM generate_series(1,500) series_value`, [fixture.otherOrg,
        fixture.actors.otherOwner.actorUserId,
        fixture.actors.otherOwner.authSessionId]);
      const overflow = await request(app)
        .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
        .set('X-CSRF-Token', fixture.actors.otherOwner.csrfToken)
        .set('Idempotency-Key', `m26-p4b-overflow-${key()}`)
        .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
      expect(overflow.status).toBe(503);
      expect(JSON.stringify(overflow.body))
        .not.toMatch(/observedRate|eligibleCount|sourceDigest|cohortDigest/);
    } finally {
      await fixture.ownerPool.query(`
        DROP TRIGGER IF EXISTS m26_part4b_test_insert_delay
          ON canonical_forecast_booking_cancellation_cohorts;
        DROP FUNCTION IF EXISTS public.m26_part4b_test_insert_delay()`);
    }
  }, 120000);

  test('mounted paid route freezes eligible identities and observes only in-horizon cancellation', async () => {
    const active = await seedReview({ reviewOrder: 1 });
    const cancelled = await seedReview({ reviewOrder: 2,
      reviewedAt: '2026-08-21T12:00:00Z' });
    await seedReview({ appointmentId: cancelled.appointmentId,
      action: 'booking_cancelled', previousReviewId: cancelled.id,
      reviewOrder: 3, reviewedAt: '2026-09-03T12:00:00Z' });
    const lateCancellation = await seedReview({ reviewOrder: 4,
      reviewedAt: '2026-08-22T12:00:00Z' });
    await seedReview({ appointmentId: lateCancellation.appointmentId,
      action: 'booking_cancelled', previousReviewId: lateCancellation.id,
      reviewOrder: 5, reviewedAt: '2026-09-20T12:00:00Z' });
    await seedReview({ reviewOrder: 6, reviewedAt: '2026-09-02T12:00:00Z' });
    await seedReview({ tenant: fixture.otherOrg, reviewOrder: 1,
      reviewedAt: '2026-08-20T12:00:00Z' });

    const app = application();
    const captureKey = `m26-p4b-${key()}`;
    const captured = await request(app)
      .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
      .set('X-CSRF-Token', fixture.actors.owner.csrfToken)
      .set('Idempotency-Key', captureKey)
      .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
    expect(captured.status).toBe(201);
    expect(captured.body.data).toMatchObject({ state: 'descriptive_only',
      eligibleCount: 3, cancelledCount: 1, observedRate: '0.333333',
      sourceAuthenticated: true, sourceCoverageComplete: false,
      offPlatformCoverageVerified: false, probabilityCalibrated: false,
      forecastIssued: false, paidNumericServing: false });
    expect(JSON.stringify(captured.body)).not.toContain(active.appointmentId);
    const cohortId = captured.body.data.cohortId;
    const read = await request(app)
      .get(`/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals/${cohortId}`);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ state: 'descriptive_only',
      cohortId, eligibleCount: 3, cancelledCount: 1 });

    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_booking_cancellation_cohorts'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_booking_cancellation_cohorts SET eligible_count=0'))
      .rejects.toMatchObject({ code: '23514' });

    const writer = await fixture.ownerPool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`SELECT pg_advisory_xact_lock(hashtextextended(
        'm26:commercial-booking-order:'||$1::text,0))`, [fixture.org]);
      await seedReview({ appointmentId: active.appointmentId,
        action: 'booking_corrected', previousReviewId: active.id,
        reviewOrder: 7, reviewedAt: '2026-09-04T12:00:00Z', connection: writer });
      const contendedReplay = await request(app)
        .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
        .set('X-CSRF-Token', fixture.actors.owner.csrfToken)
        .set('Idempotency-Key', captureKey)
        .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
      expect(contendedReplay.status).toBe(409);
      expect(contendedReplay.body.error.category)
        .toBe('FORECAST_TRANSITION_COHORT_BUSY');
      expect(JSON.stringify(contendedReplay.body))
        .not.toMatch(/observedRate|eligibleCount|sourceDigest|cohortDigest/);
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }

    const correction = await seedReview({ appointmentId: active.appointmentId,
      action: 'booking_corrected', previousReviewId: active.id,
      reviewOrder: 7, reviewedAt: '2026-09-04T12:00:00Z' });
    expect(correction.id).toBeDefined();
    const stale = await request(app)
      .get(`/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals/${cohortId}`);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'source_stale',
      reason: 'source_changed_inside_horizon', eligibleCount: 0,
      observedRate: null, sourceAuthenticated: false,
      probabilityCalibrated: false, forecastIssued: false });

    const staleReplay = await request(app)
      .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
      .set('X-CSRF-Token', fixture.actors.owner.csrfToken)
      .set('Idempotency-Key', captureKey)
      .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
    expect(staleReplay.status).toBe(200);
    expect(staleReplay.headers['idempotency-replayed']).toBe('true');
    expect(staleReplay.body.data).toMatchObject({ state: 'source_stale',
      sourceAuthenticated: false, replayed: true });

    const correctedCapture = await request(app)
      .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
      .set('X-CSRF-Token', fixture.actors.owner.csrfToken)
      .set('Idempotency-Key', `m26-p4b-${key()}`)
      .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
    expect(correctedCapture.status).toBe(200);
    expect(correctedCapture.body.data).toEqual({
      state: 'source_changed_inside_horizon',
      reason: 'source_correction_inside_horizon', sourceAuthenticated: false,
      sourceCoverageComplete: false, offPlatformCoverageVerified: false,
      providerCoverageVerified: false, probabilityCalibrated: false,
      confidence: 'unavailable', forecastIssued: false, paidNumericServing: false });
  }, 120000);

  test('paid role, tenant, CSRF and current subscription remain server-owned', async () => {
    const owner = fixture.actors.owner;
    const app = application(owner);
    const member = application(fixture.actors.member);
    const memberResponse = await request(member)
      .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
      .set('X-CSRF-Token', fixture.actors.member.csrfToken)
      .set('Idempotency-Key', `m26-p4b-${key()}`)
      .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
    expect(memberResponse.status).toBe(403);
    const badCsrf = await request(app)
      .post('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals')
      .set('X-CSRF-Token', 'wrong').set('Idempotency-Key', `m26-p4b-${key()}`)
      .send({ cutoffAt: CUTOFF, horizonEndsAt: HORIZON });
    expect(badCsrf.status).toBe(403);
    const crossTenant = await request(application(fixture.actors.otherOwner))
      .get('/api/v1/forecast/transition-cohorts/commercial-booking-withdrawals/' +
        '44444444-4444-4444-8444-444444444444');
    expect(crossTenant.status).toBe(503);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/eligible|cancelled|digest/i);
  }, 120000);

  test('startup refuses missing authority and inherited PUBLIC entry access', async () => {
    const missing = await fixture.ownerPool.connect();
    try {
      await missing.query('BEGIN');
      await missing.query(`ALTER TABLE canonical_forecast_booking_cancellation_cohorts
        RENAME TO canonical_forecast_booking_cancellation_cohorts_missing_test`);
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(missing,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Required booking withdrawal cohort authority is missing');
    } finally {
      await missing.query('ROLLBACK').catch(() => {});
      missing.release();
    }

    await fixture.ownerPool.query(`GRANT EXECUTE ON FUNCTION
      canonical_forecast_booking_cancellation_cohort_capture(
        uuid,uuid,text,uuid,text,text,timestamptz,timestamptz) TO PUBLIC`);
    try {
      await expect(startupAuthority())
        .rejects.toThrow('Runtime database role privilege verification failed');
    } finally {
      await fixture.ownerPool.query(`REVOKE ALL ON FUNCTION
        canonical_forecast_booking_cancellation_cohort_capture(
          uuid,uuid,text,uuid,text,text,timestamptz,timestamptz) FROM PUBLIC`);
    }
    await expect(startupAuthority()).resolves.toBeUndefined();
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_booking_cancellation_cohorts'))
      .rejects.toMatchObject({ code: '42501' });
  }, 120000);
});
