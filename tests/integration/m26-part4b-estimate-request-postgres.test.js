'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 4B human-reviewed estimate request cohort', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function instant(expression) {
    return (await fixture.ownerPool.query(
      `SELECT canonical_forecast_utc_instant(${expression}) value`)).rows[0].value;
  }

  async function backdateOpportunity(context, expression) {
    await fixture.ownerPool.query(
      `UPDATE canonical_opportunities SET created_at=${expression},updated_at=${expression}
       WHERE organization_id=$1 AND id=$2`,
    [context.actor.organizationId, context.opportunity]);
  }

  function review(context, action, state, effectiveAt, idempotencyKey = key()) {
    return request(fixture.app)
      .post(`/api/v1/forecast/transition-cohorts/estimate-request-sources/${context.opportunity}/reviews`)
      .set(context.actor.session.headers)
      .set('Idempotency-Key', idempotencyKey)
      .send({ action, state, effectiveAt,
        reason: `Fictional mounted human-reviewed ${state} estimate-request evidence.` });
  }

  function finalize(recordedThrough, actor = fixture.actors.owner,
    idempotencyKey = key()) {
    return request(fixture.app)
      .post('/api/v1/forecast/transition-cohorts/estimate-request-sources/finalizations')
      .set(actor.session.headers)
      .set('Idempotency-Key', idempotencyKey)
      .send({ recordedThrough,
        reason: 'Fictional mounted explicit estimate-request-source finalization.' });
  }

  function capture(cutoffAt, horizonEndsAt, idempotencyKey = key(),
    actor = fixture.actors.owner) {
    return request(fixture.app)
      .post('/api/v1/forecast/transition-cohorts/estimate-requests')
      .set(actor.session.headers)
      .set('Idempotency-Key', idempotencyKey)
      .send({ cutoffAt, horizonEndsAt });
  }

  test('freezes open identities, counts the first accepted request, excludes later entrants and replays once', async () => {
    const first = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const second = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const late = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    for (const context of [first, second, late]) {
      await backdateOpportunity(context, "clock_timestamp()-INTERVAL '5 hours'");
    }
    const openedAt = await instant("clock_timestamp()-INTERVAL '4 hours'");
    const cutoff = await instant("clock_timestamp()-INTERVAL '3 hours'");
    const requestedAt = await instant("clock_timestamp()-INTERVAL '2 hours'");
    const lateAt = await instant("clock_timestamp()-INTERVAL '90 minutes'");
    const horizon = await instant("clock_timestamp()-INTERVAL '1 hour'");

    expect((await review(first, 'observe', 'open', openedAt)).status).toBe(201);
    expect((await review(second, 'observe', 'open', openedAt)).status).toBe(201);
    const acceptedRequest = await review(first, 'observe', 'requested', requestedAt);
    expect(acceptedRequest.status).toBe(201);
    expect(acceptedRequest.body.data.review).toMatchObject({ revision: 2,
      state: 'requested', action: 'observe', opportunityId: first.opportunity });
    expect((await review(late, 'observe', 'open', lateAt)).status).toBe(201);
    const finalization = await finalize(horizon);
    expect(finalization.status).toBe(201);
    expect(finalization.body.data.finalization).toMatchObject({ revision: 1,
      recordedThrough: horizon });

    const captureKey = `m26-p4b-estimate-request-${key()}`;
    const simultaneous = await Promise.all([
      capture(cutoff, horizon, captureKey), capture(cutoff, horizon, captureKey),
    ]);
    expect(simultaneous.map(response => response.status).sort()).toEqual([200, 201]);
    const created = simultaneous.find(response => response.status === 201);
    const replay = simultaneous.find(response => response.status === 200);
    expect(created.body.data).toMatchObject({
      version: 'm26-estimate-request-cohort-v1',
      targetKey: 'demand.estimate_request_transition.v1',
      state: 'descriptive_only', eligibleCount: 2, requestedCount: 1,
      observedRate: '0.5', sourceAuthority: 'northstar_human_reviewed_estimate_request_state',
      sourceAuthenticated: true, sourceCoverageComplete: false,
      offPlatformCoverageVerified: false, providerCoverageVerified: false,
      probabilityCalibrated: false, confidence: 'unavailable',
      forecastIssued: false, paidNumericServing: false, replayed: false,
    });
    expect(JSON.stringify(created.body)).not.toMatch(
      new RegExp([first.opportunity, second.opportunity, late.opportunity].join('|')));
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ cohortId: created.body.data.cohortId,
      eligibleCount: 2, requestedCount: 1, replayed: true });
    const read = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/estimate-requests/' +
        created.body.data.cohortId)
      .set(fixture.actors.owner.session.headers);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ eligibleCount: 2, requestedCount: 1 });

    const history = await request(fixture.app)
      .get(`/api/v1/forecast/transition-cohorts/estimate-request-sources/${first.opportunity}/reviews`)
      .set(fixture.actors.owner.session.headers);
    expect(history.status).toBe(200);
    expect(history.body.data).toMatchObject({ total: 2, truncated: false });
    expect(history.body.data.history).toHaveLength(2);
  }, 120000);

  test('preserves corrections, marks saved evidence stale, and requires re-finalization', async () => {
    const context = await fixture.createExecution({ actor: 'otherOwner',
      useMigrationRoleForUpstreamSeed: true });
    await backdateOpportunity(context, "clock_timestamp()-INTERVAL '5 hours'");
    const openedAt = await instant("clock_timestamp()-INTERVAL '4 hours'");
    const cutoff = await instant("clock_timestamp()-INTERVAL '3 hours'");
    const requestedAt = await instant("clock_timestamp()-INTERVAL '2 hours'");
    const horizon = await instant("clock_timestamp()-INTERVAL '1 hour'");
    expect((await review(context, 'observe', 'open', openedAt)).status).toBe(201);
    const observed = await review(context, 'observe', 'requested', requestedAt);
    expect(observed.status).toBe(201);
    expect((await finalize(horizon, fixture.actors.otherOwner)).status).toBe(201);
    const original = await capture(cutoff, horizon, key(), fixture.actors.otherOwner);
    expect(original.status).toBe(201);
    expect(original.body.data).toMatchObject({ eligibleCount: 1, requestedCount: 1 });

    const correction = await review(context, 'correct', 'withdrawn', requestedAt);
    expect(correction.status).toBe(201);
    expect(correction.body.data.review).toMatchObject({ action: 'correct',
      state: 'withdrawn', eventKey: observed.body.data.review.eventKey,
      supersedesId: observed.body.data.review.id });
    const stale = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/estimate-requests/' +
        original.body.data.cohortId)
      .set(fixture.actors.otherOwner.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'source_stale',
      reason: 'source_changed_inside_horizon', eligibleCount: 0,
      requestedCount: 0, observedRate: null, sourceAuthenticated: false,
      sourceDigest: null, cohortDigest: null });
    expect((await capture(cutoff, horizon, key(), fixture.actors.otherOwner)).status).toBe(503);
    expect((await finalize(await instant("clock_timestamp()-INTERVAL '30 minutes'"),
      fixture.actors.otherOwner)).status)
      .toBe(201);
    const corrected = await capture(cutoff, horizon, key(), fixture.actors.otherOwner);
    expect(corrected.status).toBe(201);
    expect(corrected.body.data).toMatchObject({ eligibleCount: 1,
      requestedCount: 0, observedRate: '0' });
  }, 120000);

  test('fails closed for invalid provenance, source contention, ACL and missing authority', async () => {
    const context = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const beforeCreation = await instant("clock_timestamp()-INTERVAL '1 hour'");
    expect((await review(context, 'observe', 'open', beforeCreation)).status).toBe(403);
    const now = await instant('clock_timestamp()');
    expect((await review(context, 'observe', 'requested', now)).status).toBe(400);

    await fixture.ownerPool.query(`
      CREATE FUNCTION public.m26_part4b_estimate_request_review_delay()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$;
      CREATE TRIGGER z_m26_part4b_estimate_request_review_delay
      BEFORE INSERT ON canonical_estimate_request_state_reviews
      FOR EACH ROW EXECUTE FUNCTION public.m26_part4b_estimate_request_review_delay()`);
    try {
      const writer = review(context, 'observe', 'open', await instant('clock_timestamp()'))
        .then(response => response);
      const probe = await fixture.ownerPool.connect();
      try {
        let writerOwnsSourceLock = false;
        for (let attempt = 0; attempt < 40 && !writerOwnsSourceLock; attempt += 1) {
          const result = await probe.query(
            "SELECT pg_try_advisory_lock(hashtextextended('m26:estimate-request-state:'||$1::text,0)) acquired",
            [fixture.org]);
          if (result.rows[0].acquired) {
            await probe.query(
              "SELECT pg_advisory_unlock(hashtextextended('m26:estimate-request-state:'||$1::text,0))",
              [fixture.org]);
            await new Promise(resolve => setTimeout(resolve, 25));
          } else writerOwnsSourceLock = true;
        }
        expect(writerOwnsSourceLock).toBe(true);
      } finally { probe.release(); }
      const busy = await capture('2026-09-01T00:00:00.000000Z',
        '2026-09-01T02:00:00.000000Z');
      expect(busy.status).toBe(409);
      expect(busy.body.error.category).toBe('FORECAST_TRANSITION_COHORT_BUSY');
      expect((await writer).status).toBe(201);
    } finally {
      await fixture.ownerPool.query(`
        DROP TRIGGER IF EXISTS z_m26_part4b_estimate_request_review_delay
          ON canonical_estimate_request_state_reviews;
        DROP FUNCTION IF EXISTS public.m26_part4b_estimate_request_review_delay()`);
    }

    const member = await request(fixture.app)
      .post(`/api/v1/forecast/transition-cohorts/estimate-request-sources/${context.opportunity}/reviews`)
      .set(fixture.actors.member.session.headers)
      .set('Idempotency-Key', key())
      .send({ action: 'observe', state: 'requested', effectiveAt: await instant('clock_timestamp()'),
        reason: 'Member must not write owner-reviewed estimate-request history.' });
    expect(member.status).toBe(403);
    const crossTenant = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/estimate-requests/' +
        '44444444-4444-4444-8444-444444444444')
      .set(fixture.actors.otherOwner.session.headers);
    expect(crossTenant.status).toBe(503);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/eligible|requested|digest/i);

    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_estimate_request_state_reviews'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      "UPDATE canonical_estimate_request_state_reviews SET request_state='closed'"))
      .rejects.toMatchObject({ code: '23514' });

    const missing = await fixture.ownerPool.connect();
    try {
      await missing.query('BEGIN');
      await missing.query('DROP INDEX canonical_estimate_request_state_reviews_tenant_order');
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(missing,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Required estimate request authority is missing');
    } finally {
      await missing.query('ROLLBACK').catch(() => {});
      missing.release();
    }
  }, 120000);
});
