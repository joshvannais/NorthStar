'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 4B scheduling-owned booking cancellation cohort', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function approveMutation(context, action, input = {}) {
    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,target_state,
        workforce_profile_id,workforce_crew_id,scheduled_start,scheduled_end,
        appointment_status
       FROM canonical_schedule_assignments
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment])).rows[0];
    const target = Object.prototype.hasOwnProperty.call(input, 'target') ? input.target :
      before.target_state === 'unassigned' ? { kind: 'unassigned', id: null } :
        before.workforce_profile_id ? { kind: 'profile', id: before.workforce_profile_id } :
          { kind: 'crew', id: before.workforce_crew_id };
    const start = Object.prototype.hasOwnProperty.call(input, 'scheduledStart') ?
      input.scheduledStart : before.scheduled_start.toISOString();
    const end = Object.prototype.hasOwnProperty.call(input, 'scheduledEnd') ?
      input.scheduledEnd : before.scheduled_end.toISOString();
    const reason = `Fictional mounted genuine schedule writer ${action} evidence.`;
    const preview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${context.appointment}/mutation-previews`)
      .set(fixture.actors.owner.session.headers)
      .send({ expectedRevision: Number(before.revision), expectedDigest: before.digest,
        expectedTimeZone: 'UTC', action, target, scheduledStart: start,
        scheduledEnd: end,
        appointmentStatus: input.appointmentStatus || before.appointment_status, reason });
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

  async function instant(expression) {
    return (await fixture.ownerPool.query(
      `SELECT canonical_forecast_utc_instant(${expression}) value`)).rows[0].value;
  }

  async function recordOperationalCancellation(context) {
    const current = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest
       FROM canonical_schedule_assignments
       WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, context.appointment])).rows[0];
    return updateAppointmentSchedule(fixture.ownerPool, normalizeScheduleMutation({
      organizationId: fixture.org,
      actorUserId: fixture.actors.owner.actorUserId,
      actorAccessRole: fixture.actors.owner.actorAccessRole,
      authSessionId: fixture.actors.owner.authSessionId,
      appointmentId: context.appointment,
      explicitSession: null,
      idempotencyKey: `m26-p4b-operational-cancel-${key()}`,
      body: { status: 'cancelled', expectedRevision: Number(current.revision),
        expectedDigest: current.digest, expectedTimeZone: 'UTC',
        action: 'calendar_edit',
        reason: 'Fictional mounted explicit operational cancellation.' },
    }));
  }

  test('composes genuine schedule writers, excludes reschedule and later entrant, and replays once', async () => {
    const first = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const rescheduleStart = new Date(Date.UTC(2027, 9, 15, 13));
    await approveMutation(first, 'reschedule', {
      scheduledStart: rescheduleStart.toISOString(),
      scheduledEnd: new Date(rescheduleStart.getTime() + 3600000).toISOString(),
    });
    const second = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const cutoff = await instant(
      `(SELECT max(occurred_at) FROM canonical_forecast_schedule_booking_events
        WHERE organization_id='${fixture.org}'::uuid)`);
    await recordOperationalCancellation(second);
    const late = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    expect(late.appointment).toBeDefined();
    const horizon = await instant('clock_timestamp()');

    const transitions = (await fixture.ownerPool.query(
      `SELECT transition_kind,count(*)::int count
       FROM canonical_forecast_schedule_booking_events
       WHERE organization_id=$1 GROUP BY transition_kind ORDER BY transition_kind`,
      [fixture.org])).rows;
    expect(transitions).toEqual(expect.arrayContaining([
      { transition_kind: 'accepted_booking', count: 3 },
      { transition_kind: 'booking_cancelled', count: 1 },
    ]));

    const captureKey = `m26-p4b-schedule-${key()}`;
    const send = () => request(fixture.app)
      .post('/api/v1/forecast/transition-cohorts/schedule-booking-cancellations')
      .set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', captureKey)
      .send({ cutoffAt: cutoff, horizonEndsAt: horizon });
    const created = await send();
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      targetKey: 'demand.booking_cancellation.v1',
      sourceAuthority: 'northstar_human_approved_schedule_history',
      state: 'descriptive_only', eligibleCount: 2, cancelledCount: 1,
      observedRate: '0.5', sourceAuthenticated: true,
      sourceCoverageComplete: false, offPlatformCoverageVerified: false,
      providerCoverageVerified: false, probabilityCalibrated: false,
      confidence: 'unavailable', forecastIssued: false, paidNumericServing: false,
      replayed: false,
    });
    expect(JSON.stringify(created.body)).not.toMatch(
      new RegExp([first.appointment, second.appointment, late.appointment].join('|')));
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ cohortId: created.body.data.cohortId,
      replayed: true, eligibleCount: 2, cancelledCount: 1 });

    const read = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/schedule-booking-cancellations/' +
        created.body.data.cohortId)
      .set(fixture.actors.owner.session.headers);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ eligibleCount: 2, cancelledCount: 1 });

    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_schedule_booking_events'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      "UPDATE canonical_forecast_schedule_booking_events SET transition_kind='state_changed'"))
      .rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('refuses source contention, non-owner access, cross-tenant reads and missing authority', async () => {
    const lock = await fixture.ownerPool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query(`SELECT pg_advisory_xact_lock(hashtextextended(
        'm26:schedule-booking-events:'||$1::text,0))`, [fixture.org]);
      const busy = await request(fixture.app)
        .post('/api/v1/forecast/transition-cohorts/schedule-booking-cancellations')
        .set(fixture.actors.owner.session.headers)
        .set('Idempotency-Key', `m26-p4b-busy-${key()}`)
        .send({ cutoffAt: '2026-09-01T00:00:00.000000Z',
          horizonEndsAt: '2026-09-02T00:00:00.000000Z' });
      expect(busy.status).toBe(409);
      expect(busy.body.error.category).toBe('FORECAST_TRANSITION_COHORT_BUSY');
    } finally {
      await lock.query('ROLLBACK').catch(() => {});
      lock.release();
    }

    const member = await request(fixture.app)
      .post('/api/v1/forecast/transition-cohorts/schedule-booking-cancellations')
      .set(fixture.actors.member.session.headers)
      .set('Idempotency-Key', `m26-p4b-member-${key()}`)
      .send({ cutoffAt: '2026-09-01T00:00:00.000000Z',
        horizonEndsAt: '2026-09-02T00:00:00.000000Z' });
    expect(member.status).toBe(403);
    const crossTenant = await request(fixture.app)
      .get('/api/v1/forecast/transition-cohorts/schedule-booking-cancellations/' +
        '44444444-4444-4444-8444-444444444444')
      .set(fixture.actors.otherOwner.session.headers);
    expect(crossTenant.status).toBe(503);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/eligible|cancelled|digest/i);

    const missing = await fixture.ownerPool.connect();
    try {
      await missing.query('BEGIN');
      await missing.query(
        'DROP INDEX canonical_forecast_schedule_booking_events_candidates');
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(missing,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Required schedule booking cancellation cohort authority is missing');
    } finally {
      await missing.query('ROLLBACK').catch(() => {});
      missing.release();
    }
  }, 120000);
});
