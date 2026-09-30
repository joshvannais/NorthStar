'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');
const { ingestLead } = require('../../src/services/canonicalGraphService');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 4B scheduling-owned first booking cohort', () => {
  let fixture;
  let profile;
  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    profile = canonicalFenceProfile();
    profile.company.timeZone = 'UTC';
    await putBusinessProfile(fixture.ownerPool, {
      organizationId: fixture.org,
      userId: fixture.actors.owner.actorUserId,
      expectedVersion: 'org-profile-v1', profile,
    });
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function instant(expression) {
    return (await fixture.ownerPool.query(
      `SELECT canonical_forecast_utc_instant(${expression}) value`)).rows[0].value;
  }

  async function approveMutation(context, action, input = {}) {
    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,target_state,
        workforce_profile_id,workforce_crew_id,scheduled_start,scheduled_end,
        appointment_status
       FROM canonical_schedule_assignments
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment])).rows[0];
    const target = before.workforce_profile_id ?
      { kind: 'profile', id: before.workforce_profile_id } :
      before.workforce_crew_id ? { kind: 'crew', id: before.workforce_crew_id } :
        { kind: 'profile', id: fixture.actors.member.actorUserId };
    const fallbackStart = new Date(Date.UTC(2027, 10, 1 + sequence, 13));
    const start = input.scheduledStart ||
      (before.scheduled_start ? before.scheduled_start.toISOString() : fallbackStart.toISOString());
    const end = input.scheduledEnd || (before.scheduled_end ?
      before.scheduled_end.toISOString() :
      new Date(fallbackStart.getTime() + 3600000).toISOString());
    const reason = `Fictional mounted genuine schedule writer ${action} evidence.`;
    const preview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-previews`)
      .set(fixture.actors.owner.session.headers)
      .send({ expectedRevision: Number(before.revision), expectedDigest: before.digest,
        expectedTimeZone: 'UTC', action, target, scheduledStart: start,
        scheduledEnd: end, appointmentStatus: input.appointmentStatus || 'scheduled', reason });
    if (preview.status !== 201) throw new Error(JSON.stringify(preview.body));
    const approval = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-approvals`)
      .set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', key())
      .send({ previewId: preview.body.data.id,
        previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason });
    if (approval.status !== 200) throw new Error(JSON.stringify(approval.body));
    return approval.body.data;
  }

  let sequence = 0;
  async function createUnbooked() {
    sequence += 1;
    const graphKey = key();
    const scheduledStart = new Date(Date.UTC(2027, 9, 1 + sequence, 13));
    const result = await ingestLead(fixture.runtimePool, {
      tenantContext: { organizationId: fixture.org, trusted: true },
      idempotencyKey: graphKey, sourceVersion: 'm26-first-booking-fixture-v1',
      external: { customerId: graphKey, callId: graphKey, transcriptId: graphKey,
        communicationId: graphKey, appointmentId: graphKey },
      customer: { name: `Fictional first-booking customer ${sequence}`,
        phone: `+1555444${String(sequence).padStart(4, '0')}`,
        email: `${graphKey}@example.test`,
        address: { line1: '1 Test Way', city: 'Boston', state: 'MA',
          postalCode: '02108' } },
      transcript: [{ turnId: 'scope', speaker: 'customer',
        text: 'I need a 100-foot cedar fence.' }],
      facts: [{ variable: 'linearFeet', normalizedValue: 100,
        evidenceText: '100-foot', speaker: 'customer', evidenceTurnId: 'scope',
        confidence: 1 }],
      service: { key: 'fence', scope: { jobType: 'replace', linearFeet: 100,
        height: 6, material: 'cedar', removalRequired: true,
        gates: [{ type: 'walk' }], permitsRequired: true } },
      scheduledAppointment: { start: scheduledStart.toISOString(),
        end: new Date(scheduledStart.getTime() + 3600000).toISOString(),
        status: 'scheduled' },
      businessProfile: profile, businessProfileVersion: profile.version,
    });
    if (result.status !== 201) throw new Error(JSON.stringify(result));
    return { appointment: result.body.ids.appointment,
      opportunity: result.body.ids.opportunity };
  }

  async function waitForOpportunitySourceLock() {
    const client = await fixture.ownerPool.connect();
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const acquired = (await client.query(
          `SELECT pg_try_advisory_lock(hashtextextended(
            'm26:opportunity-eligibility:'||$1::text,0)) acquired`,
          [fixture.org])).rows[0].acquired;
        if (!acquired) return;
        await client.query(`SELECT pg_advisory_unlock(hashtextextended(
          'm26:opportunity-eligibility:'||$1::text,0))`, [fixture.org]);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timed out waiting for the genuine schedule writer lock');
    } finally {
      client.release();
    }
  }

  test('freezes eligible opportunities, counts only first accepted booking, excludes later entrants, and replays once', async () => {
    const booked = await createUnbooked();
    const unbooked = await createUnbooked();
    const seedWindow = (await fixture.ownerPool.query(`SELECT
      canonical_forecast_utc_instant(clock_timestamp()-interval '2 milliseconds') cutoff,
      canonical_forecast_utc_instant(clock_timestamp()-interval '1 millisecond') horizon`)).rows[0];
    const seed = await request(fixture.app)
      .post('/api/v1/forecast/transition-cohorts/schedule-bookings')
      .set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', `m26-p4b-first-booking-seed-${key()}`)
      .send({ cutoffAt: seedWindow.cutoff, horizonEndsAt: seedWindow.horizon });
    expect(seed.status).toBe(201);
    expect(seed.body.data).toMatchObject({ state: 'unavailable', eligibleCount: 0 });
    const cutoff = await instant('clock_timestamp()');
    await approveMutation(booked, 'assign');
    const movedStart = new Date(Date.UTC(2027, 10, 15, 13));
    await approveMutation(booked, 'reschedule', {
      scheduledStart: movedStart.toISOString(),
      scheduledEnd: new Date(movedStart.getTime() + 3600000).toISOString(),
    });
    const late = await createUnbooked();
    const horizon = await instant('clock_timestamp()');

    const transitions = (await fixture.ownerPool.query(
      `SELECT transition_kind,count(*)::int count
       FROM canonical_forecast_schedule_booking_events
       WHERE organization_id=$1 GROUP BY transition_kind ORDER BY transition_kind`,
      [fixture.org])).rows;
    expect(transitions).toEqual(expect.arrayContaining([
      { transition_kind: 'accepted_booking', count: 1 },
      { transition_kind: 'state_changed', count: 1 },
    ]));

    const captureKey = `m26-p4b-first-booking-${key()}`;
    const send = () => request(fixture.app)
      .post('/api/v1/forecast/transition-cohorts/schedule-bookings')
      .set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', captureKey)
      .send({ cutoffAt: cutoff, horizonEndsAt: horizon });
    const created = await send();
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      targetKey: 'demand.booking_transition.v1',
      sourceAuthority: 'northstar_canonical_opportunity_and_human_approved_schedule_history',
      state: 'descriptive_only', eligibleCount: 2, bookedCount: 1,
      observedRate: '0.5', sourceAuthenticated: true,
      sourceCoverageComplete: false, offPlatformCoverageVerified: false,
      providerCoverageVerified: false, probabilityCalibrated: false,
      confidence: 'unavailable', forecastIssued: false, paidNumericServing: false,
      replayed: false,
    });
    expect(JSON.stringify(created.body)).not.toMatch(
      new RegExp([booked.opportunity, unbooked.opportunity, late.opportunity].join('|')));

    const replay = await send();
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ cohortId: created.body.data.cohortId,
      replayed: true, eligibleCount: 2, bookedCount: 1 });
    const read = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/schedule-bookings/' +
        created.body.data.cohortId)
      .set(fixture.actors.owner.session.headers);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ eligibleCount: 2, bookedCount: 1 });

    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_schedule_booking_transition_cohorts'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_opportunity_eligibility_events'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_opportunity_eligibility_activations'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_forecast_schedule_booking_transition_cohorts'))
      .rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('refuses source contention, non-owner access and cross-tenant reads', async () => {
    await fixture.ownerPool.query(`
      CREATE FUNCTION public.m26_part4b_first_booking_writer_delay()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$;
      CREATE TRIGGER z_m26_part4b_first_booking_writer_delay
      BEFORE INSERT ON canonical_forecast_opportunity_eligibility_events
      FOR EACH ROW EXECUTE FUNCTION public.m26_part4b_first_booking_writer_delay()`);
    let inFlight;
    try {
      const writer = createUnbooked();
      await waitForOpportunitySourceLock();
      const spanningCutoff = await instant('clock_timestamp()');
      const busy = await request(fixture.app)
        .post('/api/v1/forecast/transition-cohorts/schedule-bookings')
        .set(fixture.actors.owner.session.headers)
        .set('Idempotency-Key', `m26-p4b-booking-busy-${key()}`)
        .send({ cutoffAt: '2026-09-01T00:00:00.000000Z',
          horizonEndsAt: '2026-09-02T00:00:00.000000Z' });
      expect(busy.status).toBe(409);
      expect(busy.body.error.category).toBe('FORECAST_TRANSITION_COHORT_BUSY');
      inFlight = await writer;
      const horizon = await instant('clock_timestamp()');
      const captured = (await fixture.ownerPool.query(
        `SELECT canonical_forecast_schedule_booking_transition_cohort_capture(
          $1,$2,$3,$4,$5,$6,$7,$8) value`,
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId,
          fixture.actors.owner.csrfToken, `m26-p4b-spanning-${key()}`,
          spanningCutoff, horizon])).rows[0].value.cohort;
      const privateReceipt = (await fixture.ownerPool.query(
        `SELECT member_receipts FROM canonical_forecast_schedule_booking_transition_cohorts
         WHERE organization_id=$1 AND id=$2`, [fixture.org, captured.id])).rows[0];
      expect(JSON.stringify(privateReceipt.member_receipts)).not.toContain(inFlight.opportunity);
    } finally {
      await fixture.ownerPool.query(`
        DROP TRIGGER IF EXISTS z_m26_part4b_first_booking_writer_delay
          ON canonical_forecast_opportunity_eligibility_events;
        DROP FUNCTION IF EXISTS public.m26_part4b_first_booking_writer_delay()`);
    }

    const member = await request(fixture.app)
      .post('/api/v1/forecast/transition-cohorts/schedule-bookings')
      .set(fixture.actors.member.session.headers)
      .set('Idempotency-Key', `m26-p4b-booking-member-${key()}`)
      .send({ cutoffAt: '2026-09-01T00:00:00.000000Z',
        horizonEndsAt: '2026-09-02T00:00:00.000000Z' });
    expect(member.status).toBe(403);
    const crossTenant = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/schedule-bookings/' +
        '44444444-4444-4444-8444-444444444444')
      .set(fixture.actors.otherOwner.session.headers);
    expect(crossTenant.status).toBe(503);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/eligible|booked|digest/i);
  }, 120000);

  test('refuses an oversized activation backlog before mutation and keeps reads side-effect free', async () => {
    await fixture.ownerPool.query(`
      INSERT INTO canonical_forecast_opportunity_eligibility_events(
        organization_id,operation_id,graph_id,opportunity_id,transcript_id,
        source_kind,visible_at,source_digest)
      SELECT $1,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
        gen_random_uuid(),'lead',clock_timestamp(),repeat(md5(value::text),2)
      FROM generate_series(1,501) value`, [fixture.org]);
    const before = Number((await fixture.ownerPool.query(
      `SELECT count(*) count
       FROM canonical_forecast_opportunity_eligibility_activations
       WHERE organization_id=$1`, [fixture.org])).rows[0].count);
    const backlogKey = `m26-p4b-activation-backlog-${key()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(fixture.ownerPool.query(
        `SELECT canonical_forecast_schedule_booking_transition_cohort_capture(
          $1,$2,$3,$4,$5,$6,$7,$8) value`,
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId,
          fixture.actors.owner.csrfToken, backlogKey,
          '2026-09-01T00:00:00.000000Z', '2026-09-02T00:00:00.000000Z']))
        .rejects.toMatchObject({ code: '54000' });
    }
    const afterRetry = Number((await fixture.ownerPool.query(
      `SELECT count(*) count
       FROM canonical_forecast_opportunity_eligibility_activations
       WHERE organization_id=$1`, [fixture.org])).rows[0].count);
    expect(afterRetry).toBe(before);
    const missing = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/schedule-bookings/' + key())
      .set(fixture.actors.owner.session.headers);
    expect(missing.status).toBe(503);
    const afterRead = Number((await fixture.ownerPool.query(
      `SELECT count(*) count
       FROM canonical_forecast_opportunity_eligibility_activations
       WHERE organization_id=$1`, [fixture.org])).rows[0].count);
    expect(afterRead).toBe(before);
  }, 120000);

  test('requires migration objects and rejects PUBLIC leakage', async () => {
    const missing = await fixture.ownerPool.connect();
    try {
      await missing.query('BEGIN');
      await missing.query(
        'DROP INDEX canonical_forecast_opportunity_eligibility_activations_tenant_visible');
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(missing,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Required schedule booking transition cohort authority is missing');
    } finally {
      await missing.query('ROLLBACK').catch(() => {});
      missing.release();
    }

    const publicTable = await fixture.ownerPool.connect();
    try {
      await publicTable.query('BEGIN');
      await publicTable.query(
        'GRANT SELECT ON canonical_forecast_schedule_booking_transition_cohorts TO PUBLIC');
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(publicTable,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Runtime database role privilege verification failed');
    } finally {
      await publicTable.query('ROLLBACK').catch(() => {});
      publicTable.release();
    }

    const publicFunction = await fixture.ownerPool.connect();
    try {
      await publicFunction.query('BEGIN');
      await publicFunction.query(`GRANT EXECUTE ON FUNCTION
        canonical_forecast_schedule_booking_transition_cohort_capture(
          uuid,uuid,text,uuid,text,text,timestamptz,timestamptz) TO PUBLIC`);
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(publicFunction,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Runtime database role privilege verification failed');
    } finally {
      await publicFunction.query('ROLLBACK').catch(() => {});
      publicFunction.release();
    }

    const recovered = await fixture.ownerPool.connect();
    try {
      await recovered.query('BEGIN');
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(recovered,
        { runtimeRole: fixture.roles.runtime })).resolves.toBeUndefined();
      await recovered.query('COMMIT');
    } finally {
      await recovered.query('ROLLBACK').catch(() => {});
      recovered.release();
    }
  }, 120000);
});
