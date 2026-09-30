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

  async function recordLegacyStatus(context, status, reason) {
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
      idempotencyKey: `m26-p4b-legacy-status-${key()}`,
      body: { status, expectedRevision: Number(current.revision),
        expectedDigest: current.digest, expectedTimeZone: 'UTC',
        action: 'calendar_edit',
        reason },
    }));
  }

  async function recordOperationalCancellation(context) {
    return recordLegacyStatus(context, 'cancelled',
      'Fictional mounted explicit operational cancellation.');
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
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_schedule_booking_lineage_gaps'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      "UPDATE canonical_forecast_schedule_booking_events SET transition_kind='state_changed'"))
      .rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('refuses source contention, non-owner access, cross-tenant reads and missing authority', async () => {
    const inFlight = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    await fixture.ownerPool.query(`
      CREATE FUNCTION public.m26_part4b_schedule_writer_delay()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$;
      CREATE TRIGGER z_m26_part4b_schedule_writer_delay
      BEFORE INSERT ON canonical_schedule_assignment_revisions
      FOR EACH ROW EXECUTE FUNCTION public.m26_part4b_schedule_writer_delay()`);
    try {
      const writer = recordOperationalCancellation(inFlight);
      await new Promise(resolve => setTimeout(resolve, 150));
      const busy = await request(fixture.app)
        .post('/api/v1/forecast/transition-cohorts/schedule-booking-cancellations')
        .set(fixture.actors.owner.session.headers)
        .set('Idempotency-Key', `m26-p4b-busy-${key()}`)
        .send({ cutoffAt: '2026-09-01T00:00:00.000000Z',
          horizonEndsAt: '2026-09-02T00:00:00.000000Z' });
      expect(busy.status).toBe(409);
      expect(busy.body.error.category).toBe('FORECAST_TRANSITION_COHORT_BUSY');
      await expect(writer).resolves.toMatchObject({ status: 200, replayed: false });
    } finally {
      await fixture.ownerPool.query(`
        DROP TRIGGER IF EXISTS z_m26_part4b_schedule_writer_delay
          ON canonical_schedule_assignment_revisions;
        DROP FUNCTION IF EXISTS public.m26_part4b_schedule_writer_delay()`);
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

    const publicTable = await fixture.ownerPool.connect();
    try {
      await publicTable.query('BEGIN');
      await publicTable.query(
        'GRANT SELECT ON canonical_forecast_schedule_booking_events TO PUBLIC');
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
        canonical_forecast_schedule_booking_cancellation_cohort_capture(
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

  test('uses approval decision time and rejects transaction-start-shaped legacy evidence', async () => {
    const legacyDefault = (await fixture.ownerPool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='canonical_schedule_approvals'
        AND column_name='approved_at'`)).rows[0].column_default;
    expect(legacyDefault).toBe('clock_timestamp()');
    const live = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const liveApproval = (await fixture.ownerPool.query(
      `SELECT approval.approved_at,event_value.occurred_at,revision.created_at
       FROM canonical_schedule_assignment_revisions revision
       JOIN canonical_schedule_human_approvals approval
        ON approval.organization_id=revision.organization_id
        AND approval.id=revision.human_approval_id
       JOIN canonical_forecast_schedule_booking_events event_value
        ON event_value.organization_id=revision.organization_id
        AND event_value.source_revision_id=revision.id
       WHERE revision.organization_id=$1 AND revision.assignment_id=(
        SELECT id FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2)
        AND revision.source_kind='human_preview_approved'
       ORDER BY revision.revision DESC LIMIT 1`, [fixture.org, live.appointment])).rows[0];
    expect(liveApproval.occurred_at.getTime()).toBe(liveApproval.approved_at.getTime());
    expect(liveApproval.occurred_at.getTime()).toBeGreaterThan(
      liveApproval.created_at.getTime());

    const legacy = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    await recordOperationalCancellation(legacy);
    await recordLegacyStatus(legacy, 'scheduled',
      'Fictional mounted durable scheduled successor.');
    const legacyApproval = (await fixture.ownerPool.query(
      `SELECT approval.approved_at,event_value.occurred_at,revision.created_at
       FROM canonical_schedule_assignment_revisions revision
       JOIN canonical_schedule_approvals approval
        ON approval.organization_id=revision.organization_id
        AND approval.id=revision.approval_id
       JOIN canonical_forecast_schedule_booking_events event_value
        ON event_value.organization_id=revision.organization_id
        AND event_value.source_revision_id=revision.id
       WHERE revision.organization_id=$1 AND revision.assignment_id=(
        SELECT id FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2)
        AND revision.source_kind='human_approved'
       ORDER BY revision.revision DESC LIMIT 1`, [fixture.org, legacy.appointment])).rows[0];
    expect(legacyApproval.occurred_at.getTime()).toBe(legacyApproval.approved_at.getTime());
    expect(legacyApproval.occurred_at.getTime()).toBeGreaterThan(
      legacyApproval.created_at.getTime());

    const unsafe = await fixture.ownerPool.connect();
    try {
      await unsafe.query('BEGIN');
      await unsafe.query('SELECT pg_sleep(0.05)');
      const window = (await unsafe.query(`SELECT
        canonical_forecast_utc_instant(clock_timestamp()-interval '1 millisecond') cutoff,
        canonical_forecast_utc_instant(clock_timestamp()) horizon`)).rows[0];
      const beforeGap = (await unsafe.query(
        `SELECT canonical_forecast_schedule_booking_cancellation_cohort_capture(
          $1,$2,$3,$4,$5,$6,$7,$8) value`,
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId,
          fixture.actors.owner.csrfToken, `m26-p4b-before-gap-${key()}`,
          window.cutoff, window.horizon])).rows[0].value.cohort;
      const assignment = (await unsafe.query(
        `SELECT * FROM canonical_schedule_assignments
         WHERE organization_id=$1 AND appointment_id=$2 FOR UPDATE`,
        [fixture.org, legacy.appointment])).rows[0];
      const unsafeDigest = (await unsafe.query(
        `SELECT canonical_schedule_assignment_digest(
          $1,$2,$3,$4,$5,$6,$7,'cancelled',$8,$9::jsonb) digest`,
        [assignment.target_state, assignment.workforce_profile_id,
          assignment.workforce_crew_id, assignment.schedule_state,
          assignment.dispatch_state, assignment.scheduled_start, assignment.scheduled_end,
          assignment.needs_review, JSON.stringify(assignment.review_reasons)])).rows[0].digest;
      const oldRequest = crypto.createHash('sha256').update(`old-request:${key()}`).digest('hex');
      const oldKey = crypto.createHash('sha256').update(`old-key:${key()}`).digest('hex');
      const oldApproval = (await unsafe.query(
        `INSERT INTO canonical_schedule_approvals(
          organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
          auth_session_id,expected_revision,expected_digest,applied_revision,applied_digest,
          request_digest,idempotency_key_hash,action_code,reason,approved_scheduled_start,
          approved_scheduled_end,approved_appointment_status,resulting_schedule_state,
          resulting_dispatch_state,resulting_needs_review,resulting_review_reasons,
          time_evidence_version,submitted_schedule,time_zone_authority,time_evidence_digest,
          approved_at)
         SELECT approval.organization_id,approval.assignment_id,approval.appointment_id,
          approval.actor_user_id,approval.actor_access_role,approval.auth_session_id,
           $2::bigint,$3::char(64),$2::bigint+1,$7::char(64),
           $4::char(64),$5::char(64),'calendar_edit',
           'Synthetic pre-203 transaction-start approval evidence.',
           assignment.scheduled_start,assignment.scheduled_end,'cancelled',
          assignment.schedule_state,assignment.dispatch_state,assignment.needs_review,
          assignment.review_reasons,
          approval.time_evidence_version,approval.submitted_schedule,
          approval.time_zone_authority,approval.time_evidence_digest,
          transaction_timestamp()
         FROM canonical_schedule_approvals approval
         CROSS JOIN canonical_schedule_assignments assignment
         WHERE approval.organization_id=$1 AND assignment.organization_id=$1
          AND assignment.id=$6 AND approval.assignment_id=assignment.id
         ORDER BY approval.approved_at DESC LIMIT 1 RETURNING id,approved_at`,
        [fixture.org, Number(assignment.revision), assignment.canonical_digest.trim(),
          oldRequest, oldKey, assignment.id, unsafeDigest])).rows[0];
      await unsafe.query(`ALTER TABLE canonical_schedule_assignments
        DISABLE TRIGGER canonical_schedule_assignments_guard`);
      await unsafe.query(
        `UPDATE canonical_schedule_assignments SET revision=revision+1,
          last_approval_id=$3,last_human_approval_id=NULL,last_actor_user_id=$4,
          last_action_code='calendar_edit',last_reason=$5,appointment_status='cancelled',
          canonical_digest=$6,updated_at=transaction_timestamp()
         WHERE organization_id=$1 AND id=$2`,
        [fixture.org, assignment.id, oldApproval.id, fixture.actors.owner.actorUserId,
          'Synthetic pre-203 transaction-start approval evidence.', unsafeDigest]);
      const oldRevision = (await unsafe.query(
        `INSERT INTO canonical_schedule_assignment_revisions(
          organization_id,assignment_id,revision,workforce_profile_id,workforce_crew_id,
          target_state,schedule_state,dispatch_state,scheduled_start,scheduled_end,
          appointment_status,needs_review,review_reasons,canonical_digest,source_kind,
          approval_id,human_approval_id,actor_user_id,action_code,reason,request_digest,
          source_snapshot,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'human_approved',
          $15,NULL,$16,'calendar_edit',
          'Synthetic pre-203 transaction-start approval evidence.',
          $17,'{}'::jsonb,transaction_timestamp()) RETURNING id,created_at`,
        [fixture.org, assignment.id, Number(assignment.revision) + 1,
          assignment.workforce_profile_id, assignment.workforce_crew_id,
          assignment.target_state, assignment.schedule_state, assignment.dispatch_state,
          assignment.scheduled_start, assignment.scheduled_end, 'cancelled',
          assignment.needs_review, JSON.stringify(assignment.review_reasons),
          unsafeDigest,
          oldApproval.id, fixture.actors.owner.actorUserId, oldRequest])).rows[0];
      expect(oldRevision.created_at.getTime()).toBe(oldApproval.approved_at.getTime());
      expect((await unsafe.query(
        `SELECT count(*)::int count FROM canonical_forecast_schedule_booking_events
         WHERE organization_id=$1 AND source_revision_id=$2`,
        [fixture.org, oldRevision.id])).rows[0].count).toBe(0);
      const gap = (await unsafe.query(
        `SELECT reason,uncertain_from_at,gap_digest
         FROM canonical_forecast_schedule_booking_lineage_gaps
         WHERE organization_id=$1 AND source_revision_id=$2`,
        [fixture.org, oldRevision.id])).rows[0];
      expect(gap).toMatchObject({ reason: 'legacy_transaction_start_timestamp' });
      expect(gap.uncertain_from_at.getTime()).toBe(oldRevision.created_at.getTime());
      expect(gap.gap_digest).toMatch(/^[a-f0-9]{64}$/);

      const successorRequest = crypto.createHash('sha256')
        .update(`successor-request:${key()}`).digest('hex');
      const successorKey = crypto.createHash('sha256')
        .update(`successor-key:${key()}`).digest('hex');
      const successorApproval = (await unsafe.query(
        `INSERT INTO canonical_schedule_approvals(
          organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
          auth_session_id,expected_revision,expected_digest,applied_revision,applied_digest,
          request_digest,idempotency_key_hash,action_code,reason,approved_scheduled_start,
          approved_scheduled_end,approved_appointment_status,resulting_schedule_state,
          resulting_dispatch_state,resulting_needs_review,resulting_review_reasons,
          time_evidence_version,submitted_schedule,time_zone_authority,time_evidence_digest,
          approved_at)
         SELECT organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
          auth_session_id,$2::bigint,$3::char(64),$2::bigint+1,$3::char(64),
          $4::char(64),$5::char(64),'calendar_edit',
          'Durable successor after uncertain legacy cancellation.',approved_scheduled_start,
          approved_scheduled_end,'cancelled',resulting_schedule_state,
          resulting_dispatch_state,resulting_needs_review,resulting_review_reasons,
          time_evidence_version,submitted_schedule,time_zone_authority,time_evidence_digest,
          clock_timestamp()
         FROM canonical_schedule_approvals WHERE organization_id=$1 AND id=$6
         RETURNING id,approved_at`,
        [fixture.org, Number(assignment.revision) + 1, unsafeDigest,
          successorRequest, successorKey, oldApproval.id])).rows[0];
      await unsafe.query(
        `UPDATE canonical_schedule_assignments SET revision=revision+1,
          last_approval_id=$3,last_actor_user_id=$4,last_action_code='calendar_edit',
          last_reason='Durable successor after uncertain legacy cancellation.',
          updated_at=$5 WHERE organization_id=$1 AND id=$2`,
        [fixture.org, assignment.id, successorApproval.id,
          fixture.actors.owner.actorUserId, successorApproval.approved_at]);
      const successorRevision = (await unsafe.query(
        `INSERT INTO canonical_schedule_assignment_revisions(
          organization_id,assignment_id,revision,workforce_profile_id,workforce_crew_id,
          target_state,schedule_state,dispatch_state,scheduled_start,scheduled_end,
          appointment_status,needs_review,review_reasons,canonical_digest,source_kind,
          approval_id,human_approval_id,actor_user_id,action_code,reason,request_digest,
          source_snapshot,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'cancelled',$11,$12,$13,'human_approved',
          $14,NULL,$15,'calendar_edit',
          'Durable successor after uncertain legacy cancellation.',
          $16,'{}'::jsonb,transaction_timestamp()) RETURNING id`,
        [fixture.org, assignment.id, Number(assignment.revision) + 2,
          assignment.workforce_profile_id, assignment.workforce_crew_id,
          assignment.target_state, assignment.schedule_state, assignment.dispatch_state,
          assignment.scheduled_start, assignment.scheduled_end, assignment.needs_review,
          JSON.stringify(assignment.review_reasons), unsafeDigest, successorApproval.id,
          fixture.actors.owner.actorUserId, successorRequest])).rows[0];
      expect((await unsafe.query(
        `SELECT transition_kind FROM canonical_forecast_schedule_booking_events
         WHERE organization_id=$1 AND source_revision_id=$2`,
        [fixture.org, successorRevision.id])).rows[0].transition_kind).toBe('state_changed');

      const withheld = (await unsafe.query(
        `SELECT canonical_forecast_schedule_booking_cancellation_cohort_read(
          $1,$2,$3,$4,$5) value`,
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId,
          beforeGap.id])).rows[0].value;
      expect(withheld).toMatchObject({ state: 'source_stale',
        reason: 'source_changed_inside_horizon', eligibleCount: 0,
        cancelledCount: 0, observedRate: null, sourceAuthenticated: false,
        sourceDigest: null, cohortDigest: null, paidNumericServing: false });

      await expect(unsafe.query(
        `SELECT canonical_forecast_schedule_booking_cancellation_cohort_capture(
          $1,$2,$3,$4,$5,$6,$7,$8) value`,
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId,
          fixture.actors.owner.csrfToken, `m26-p4b-after-gap-${key()}`,
          window.cutoff, window.horizon])).rejects.toMatchObject({ code: '55000' });
    } finally {
      await unsafe.query('ROLLBACK').catch(() => {});
      unsafe.release();
    }

    const revision = (await fixture.ownerPool.query(
      `SELECT revision.id,revision.organization_id,revision.approval_id,
        revision.human_approval_id,revision.source_kind
       FROM canonical_schedule_assignment_revisions revision
       WHERE revision.organization_id=$1 AND revision.source_kind IN (
        'human_approved','human_preview_approved') ORDER BY revision.created_at LIMIT 1`,
      [fixture.org])).rows[0];
    const evidenceTable = revision.source_kind === 'human_approved' ?
      'canonical_schedule_approvals' : 'canonical_schedule_human_approvals';
    const evidenceId = revision.approval_id || revision.human_approval_id;
    const decisionTime = (await fixture.ownerPool.query(
      `SELECT approved_at FROM ${evidenceTable} WHERE organization_id=$1 AND id=$2`,
      [revision.organization_id, evidenceId])).rows[0].approved_at;
    const rebuilt = await fixture.ownerPool.query(
      `SELECT CASE WHEN revision.source_kind='human_approved'
        THEN legacy.approved_at ELSE preview.approved_at END occurred_at
       FROM canonical_schedule_assignment_revisions revision
       LEFT JOIN canonical_schedule_approvals legacy
        ON legacy.organization_id=revision.organization_id AND legacy.id=revision.approval_id
       LEFT JOIN canonical_schedule_human_approvals preview
        ON preview.organization_id=revision.organization_id AND preview.id=revision.human_approval_id
       WHERE revision.organization_id=$1 AND revision.id=$2`,
      [revision.organization_id, revision.id]);
    expect(rebuilt.rows[0].occurred_at.getTime()).toBe(decisionTime.getTime());

    const migrationContract = require('node:fs').readFileSync(require('node:path').join(
      __dirname, '../../migrations/203_canonical_forecast_schedule_booking_cancellation.sql'),
    'utf8');
    expect(migrationContract).toContain(
      "event_occurred_at<=NEW.created_at THEN\n  gap_hash:=");
    expect(migrationContract).toContain(
      "FROM human_ordered\n WHERE source_kind<>'human_approved' OR event_occurred_at>created_at");
    expect(migrationContract).toContain(
      'canonical_forecast_schedule_booking_lineage_gaps gap_value');
  }, 120000);
});
