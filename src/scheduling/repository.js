'use strict';

const schedulingTime = require('../../public/js/scheduling-time-contract');

class ScheduleRepositoryError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'ScheduleRepositoryError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function fail(status, code, message, cause) {
  throw new ScheduleRepositoryError(status, code, message, cause);
}

function trimDigest(value) {
  return String(value || '').trim();
}

function timestamp(value) {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

function scheduleAuthority(row) {
  return {
    id: row.assignment_id,
    appointmentId: row.appointment_id,
    operationId: row.operation_id,
    graphId: row.graph_id,
    opportunityId: row.opportunity_id,
    targetState: row.target_state,
    workforceProfileId: row.workforce_profile_id,
    workforceCrewId: row.workforce_crew_id,
    scheduleState: row.schedule_state,
    dispatchState: row.dispatch_state,
    scheduledStart: timestamp(row.scheduled_start),
    scheduledEnd: timestamp(row.scheduled_end),
    appointmentStatus: row.appointment_status,
    needsReview: row.needs_review,
    reviewReasons: row.review_reasons,
    revision: Number(row.revision),
    digest: trimDigest(row.canonical_digest),
    lastAction: row.last_action_code,
    lastReason: row.last_reason,
    updatedAt: timestamp(row.assignment_updated_at || row.updated_at),
  };
}

function appointmentResponse(appointment, authority) {
  return {
    id: appointment.id,
    organization_id: appointment.organization_id,
    operation_id: appointment.operation_id,
    graph_id: appointment.graph_id,
    opportunity_id: appointment.opportunity_id,
    external_appointment_id: appointment.external_appointment_id,
    preference: appointment.preference,
    scheduled_start: timestamp(appointment.scheduled_start),
    scheduled_end: timestamp(appointment.scheduled_end),
    status: appointment.status,
    created_at: timestamp(appointment.created_at),
    updated_at: timestamp(appointment.updated_at),
    scheduleAuthority: authority,
  };
}

function mapDatabaseError(error) {
  if (error instanceof ScheduleRepositoryError) return error;
  const constraint = error && error.constraint;
  if (error && (error.code === '40001' || error.code === '40P01')) {
    return new ScheduleRepositoryError(409, 'M22_STALE_APPROVAL', 'Schedule authority changed; refresh before approving again.', error);
  }
  if (error && error.code === '23505' &&
      ['canonical_schedule_approvals_idempotency_unique', 'canonical_schedule_idempotency_primary'].includes(constraint)) {
    return new ScheduleRepositoryError(409, 'M22_IDEMPOTENCY_CONFLICT', 'The Idempotency-Key was already used for another schedule approval.', error);
  }
  if (error && error.code === '42501') {
    return new ScheduleRepositoryError(403, 'M22_APPROVAL_FORBIDDEN', 'Current schedule approval authority is unavailable.', error);
  }
  if (error && error.code === '23514') {
    return new ScheduleRepositoryError(400, 'INVALID_APPOINTMENT_SCHEDULE', 'Appointment schedule is invalid.', error);
  }
  return new ScheduleRepositoryError(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.', error);
}

async function idempotencyResult(client, input) {
  const replay = await client.query(
    `SELECT request_digest, response_status, response_body
       FROM public.canonical_schedule_idempotency
      WHERE organization_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
    [input.organizationId, input.actorUserId, input.idempotencyKeyHash]
  );
  if (replay.rowCount === 0) return null;
  if (trimDigest(replay.rows[0].request_digest) !== input.requestDigest) {
    fail(409, 'M22_IDEMPOTENCY_CONFLICT', 'The Idempotency-Key was already used for another schedule approval.');
  }
  return {
    status: replay.rows[0].response_status,
    body: replay.rows[0].response_body,
    replayed: true,
  };
}

async function requireCurrentAuthority(client, input) {
  const result = await client.query(
    `SELECT membership.role, membership.status AS membership_status,
            profile.operational_role, session.status AS session_status,
            session.access_expires_at, subscription.status AS subscription_status,
            subscription.trial_started_at, subscription.trial_ends_at,
            onboarding.status AS onboarding_status
       FROM public.organization_memberships membership
       JOIN public.workforce_profiles profile
         ON profile.organization_id = membership.organization_id
        AND profile.membership_id = membership.id
       JOIN public.auth_sessions session
         ON session.organization_id = membership.organization_id
        AND session.membership_id = membership.id
        AND session.user_id = membership.user_id
        AND session.id = $3
       JOIN public.subscriptions subscription
         ON subscription.organization_id = membership.organization_id
       JOIN public.organization_onboarding onboarding
         ON onboarding.organization_id = membership.organization_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2
      FOR SHARE OF membership, profile, session, subscription, onboarding`,
    [input.organizationId, input.actorUserId, input.authSessionId]
  );
  const authority = result.rows[0];
  const currentSubscription = authority && (authority.subscription_status === 'active' ||
    (authority.subscription_status === 'trialing' && authority.trial_started_at && authority.trial_ends_at &&
      new Date(authority.trial_ends_at).getTime() > Date.now() &&
      new Date(authority.trial_ends_at).getTime() - new Date(authority.trial_started_at).getTime() === 14 * 86400000));
  const roleAllowed = authority && (authority.role === 'owner' || authority.role === 'admin' ||
    (authority.role === 'member' && authority.operational_role === 'dispatcher'));
  if (!authority || authority.membership_status !== 'active' || authority.role !== input.actorAccessRole ||
      !roleAllowed || authority.session_status !== 'active' ||
      new Date(authority.access_expires_at).getTime() <= Date.now() || !currentSubscription ||
      authority.onboarding_status !== 'complete') {
    fail(403, 'M22_APPROVAL_FORBIDDEN', 'Current schedule approval authority is unavailable.');
  }
  return authority;
}

async function requireRecordScope(client, input) {
  const scoped = await client.query(
    `SELECT 1
       FROM public.canonical_schedule_assignments assignment
       JOIN public.canonical_appointments appointment
         ON appointment.organization_id = assignment.organization_id
        AND appointment.id = assignment.appointment_id
       JOIN public.canonical_transcripts transcript
         ON transcript.organization_id = appointment.organization_id
        AND transcript.operation_id = appointment.operation_id
      WHERE assignment.organization_id = $1 AND assignment.appointment_id = $2
        AND (transcript.source NOT IN ('simulation', 'demo')
          OR ($3::text IS NOT NULL AND transcript.external_call_id = $3 || ':call'))`,
    [input.organizationId, input.appointmentId, input.explicitSession]
  );
  if (scoped.rowCount !== 1) fail(404, 'NOT_FOUND', 'Appointment not found.');
}

async function lockTenantTimeZoneMutationLane(client, input) {
  // Business Profile version changes take this organization lock first, then
  // update the active profile and onboarding pointer. Match that order before
  // the existing authority query locks onboarding so concurrent zone rotation
  // cannot deadlock with schedule approval.
  await client.query(
    'SELECT id FROM public.organizations WHERE id = $1 FOR SHARE',
    [input.organizationId]
  );
}

async function requireCurrentTimeZoneAuthority(client, input) {
  const result = await client.query(
    `SELECT id, version_number, normalized_profile_hash,
            raw_profile #>> '{company,timeZone}' AS time_zone
       FROM public.canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE
      ORDER BY version_number DESC, id
      FOR SHARE`,
    [input.organizationId]
  );
  const profile = result.rowCount === 1 ? result.rows[0] : null;
  if (!profile || !schedulingTime.isValidTimeZone(profile.time_zone)) {
    fail(409, 'M22_TIME_ZONE_AUTHORITY_REQUIRED', 'A current authoritative tenant IANA time zone is required before scheduling.');
  }
  if (profile.time_zone !== input.expectedTimeZone) {
    fail(409, 'M22_STALE_TIME_ZONE', 'The tenant time zone changed; refresh and review the schedule again.');
  }
  return Object.freeze({
    profileId: String(profile.id),
    profileVersion: Number(profile.version_number),
    profileHash: trimDigest(profile.normalized_profile_hash),
    timeZone: profile.time_zone,
  });
}

function validatedScheduleInstant(rawValue, canonicalValue, timeZone) {
  if (rawValue === undefined || rawValue === null) return rawValue;
  try {
    const validated = schedulingTime.validateRfc3339InZone(rawValue, timeZone);
    if (validated.instant !== canonicalValue) {
      fail(400, 'INVALID_APPOINTMENT_SCHEDULE', 'Appointment schedule changed during normalization.');
    }
    return validated.instant;
  } catch (error) {
    if (error instanceof ScheduleRepositoryError) throw error;
    fail(400, 'INVALID_APPOINTMENT_SCHEDULE', 'Appointment schedule does not agree with the current tenant IANA time zone.', error);
  }
}

async function mutateInTransaction(client, input) {
  await lockTenantTimeZoneMutationLane(client, input);
  await requireCurrentAuthority(client, input);
  await requireRecordScope(client, input);
  const replay = await idempotencyResult(client, input);
  if (replay) return replay;

  const locked = await client.query(
    `SELECT assignment.*, assignment.id AS assignment_id,
            assignment.updated_at AS assignment_updated_at,
            appointment.*, transcript.source, transcript.external_call_id
       FROM public.canonical_schedule_assignments assignment
       JOIN public.canonical_appointments appointment
         ON appointment.organization_id = assignment.organization_id
        AND appointment.id = assignment.appointment_id
       JOIN public.canonical_transcripts transcript
         ON transcript.organization_id = appointment.organization_id
        AND transcript.operation_id = appointment.operation_id
      WHERE assignment.organization_id = $1 AND assignment.appointment_id = $2
        AND (transcript.source NOT IN ('simulation', 'demo')
          OR ($3::text IS NOT NULL AND transcript.external_call_id = $3 || ':call'))
      FOR UPDATE OF assignment, appointment`,
    [input.organizationId, input.appointmentId, input.explicitSession]
  );
  if (locked.rowCount !== 1) fail(404, 'NOT_FOUND', 'Appointment not found.');
  const current = locked.rows[0];
  if (Number(current.revision) !== input.expectedRevision || trimDigest(current.canonical_digest) !== input.expectedDigest) {
    fail(409, 'M22_STALE_APPROVAL', 'Schedule authority changed; refresh before approving again.');
  }

  const timeZoneAuthority = await requireCurrentTimeZoneAuthority(client, input);
  const validatedStart = validatedScheduleInstant(
    input.rawScheduledStart, input.scheduledStart, timeZoneAuthority.timeZone
  );
  const validatedEnd = validatedScheduleInstant(
    input.rawScheduledEnd, input.scheduledEnd, timeZoneAuthority.timeZone
  );

  const scheduledStart = validatedStart === undefined ? timestamp(current.scheduled_start) : validatedStart;
  const scheduledEnd = validatedEnd === undefined ? timestamp(current.scheduled_end) : validatedEnd;
  if ((scheduledStart === null) !== (scheduledEnd === null) ||
      (scheduledStart !== null && new Date(scheduledEnd).getTime() <= new Date(scheduledStart).getTime())) {
    fail(400, 'INVALID_APPOINTMENT_SCHEDULE', 'Appointment schedule must be absent or have a strictly positive interval.');
  }
  const appointmentStatus = input.status === undefined ? current.appointment_status : input.status;
  const scheduleState = scheduledStart === null ? 'unscheduled' : 'scheduled';
  const dispatchState = current.dispatch_state === 'dispatched' &&
    (timestamp(current.scheduled_start) !== scheduledStart || timestamp(current.scheduled_end) !== scheduledEnd)
    ? 'revoked' : current.dispatch_state;
  const needsReview = true;
  const reviewReasons = ['conflict_evaluation_not_available'];
  const digestResult = await client.query(
    `SELECT public.canonical_schedule_assignment_digest(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) AS digest`,
    [current.target_state, current.workforce_profile_id, current.workforce_crew_id,
      scheduleState, dispatchState, scheduledStart, scheduledEnd, appointmentStatus,
      needsReview, JSON.stringify(reviewReasons)]
  );
  const afterRevision = Number(current.revision) + 1;
  const afterDigest = trimDigest(digestResult.rows[0].digest);
  const approval = await client.query(
    `INSERT INTO public.canonical_schedule_approvals
       (organization_id, assignment_id, appointment_id, actor_user_id,
        actor_access_role, auth_session_id, expected_revision, expected_digest,
        applied_revision, applied_digest, request_digest, idempotency_key_hash,
        action_code, reason, approved_scheduled_start, approved_scheduled_end,
        approved_appointment_status, resulting_schedule_state, resulting_dispatch_state,
        resulting_needs_review, resulting_review_reasons)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)
     RETURNING *`,
    [input.organizationId, current.assignment_id, input.appointmentId, input.actorUserId,
      input.actorAccessRole, input.authSessionId, input.expectedRevision, input.expectedDigest,
      afterRevision, afterDigest, input.requestDigest, input.idempotencyKeyHash,
      input.action, input.reason, scheduledStart, scheduledEnd, appointmentStatus,
      scheduleState, dispatchState, needsReview, JSON.stringify(reviewReasons)]
  );
  const approvalRow = approval.rows[0];
  const assignmentResult = await client.query(
    `UPDATE public.canonical_schedule_assignments
        SET schedule_state = $3, dispatch_state = $4, scheduled_start = $5,
            scheduled_end = $6, appointment_status = $7, needs_review = $8,
            review_reasons = $9::jsonb, revision = $10, canonical_digest = $11,
            last_approval_id = $12, last_actor_user_id = $13,
            last_action_code = $14, last_reason = $15, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2
      RETURNING *, id AS assignment_id, updated_at AS assignment_updated_at`,
    [input.organizationId, current.assignment_id, scheduleState, dispatchState,
      scheduledStart, scheduledEnd, appointmentStatus, needsReview,
      JSON.stringify(reviewReasons), afterRevision, afterDigest, approvalRow.id,
      input.actorUserId, input.action, input.reason]
  );
  const assignment = assignmentResult.rows[0];
  await client.query(
    `INSERT INTO public.canonical_schedule_assignment_revisions
       (organization_id, assignment_id, revision, workforce_profile_id,
        workforce_crew_id, target_state, schedule_state, dispatch_state,
        scheduled_start, scheduled_end, appointment_status, needs_review,
        review_reasons, canonical_digest, source_kind, approval_id,
        actor_user_id, action_code, reason, request_digest, source_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,
             'human_approved',$15,$16,$17,$18,$19,$20::jsonb)`,
    [input.organizationId, assignment.id, afterRevision, assignment.workforce_profile_id,
      assignment.workforce_crew_id, assignment.target_state, scheduleState, dispatchState,
      scheduledStart, scheduledEnd, appointmentStatus, needsReview,
      JSON.stringify(reviewReasons), afterDigest, approvalRow.id, input.actorUserId,
      input.action, input.reason, input.requestDigest, JSON.stringify({
        appointmentId: input.appointmentId,
        expectedRevision: input.expectedRevision,
        expectedDigest: input.expectedDigest,
        submittedSchedule: {
          scheduledStart: input.rawScheduledStart === undefined ? null : input.rawScheduledStart,
          scheduledEnd: input.rawScheduledEnd === undefined ? null : input.rawScheduledEnd,
        },
        timeZoneAuthority,
      })]
  );
  const appointmentResult = await client.query(
    `UPDATE public.canonical_appointments
        SET scheduled_start = $3, scheduled_end = $4, status = $5, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    [input.organizationId, input.appointmentId, scheduledStart, scheduledEnd, appointmentStatus]
  );
  await client.query(
    `INSERT INTO public.canonical_schedule_audit_events
       (organization_id, assignment_id, approval_id, actor_user_id, action_code,
        reason, before_revision, after_revision, before_digest, after_digest, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [input.organizationId, assignment.id, approvalRow.id, input.actorUserId,
      input.action, input.reason, input.expectedRevision, afterRevision,
      input.expectedDigest, afterDigest, JSON.stringify({
        appointmentId: input.appointmentId,
        scheduleState,
        dispatchState,
        needsReview,
        reviewReasons,
        submittedSchedule: {
          scheduledStart: input.rawScheduledStart === undefined ? null : input.rawScheduledStart,
          scheduledEnd: input.rawScheduledEnd === undefined ? null : input.rawScheduledEnd,
        },
        timeZoneAuthority,
      })]
  );
  const authority = scheduleAuthority(assignment);
  const responseBody = { success: true, data: appointmentResponse(appointmentResult.rows[0], authority) };
  await client.query(
    `INSERT INTO public.canonical_schedule_idempotency
       (organization_id, actor_user_id, idempotency_key_hash, request_digest,
        assignment_id, approval_id, response_status, response_body)
     VALUES ($1,$2,$3,$4,$5,$6,200,$7::jsonb)`,
    [input.organizationId, input.actorUserId, input.idempotencyKeyHash,
      input.requestDigest, assignment.id, approvalRow.id, JSON.stringify(responseBody)]
  );
  return {
    status: 200,
    body: responseBody,
    replayed: false,
    audit: {
      before: appointmentResponse(current, scheduleAuthority(current)),
      after: responseBody.data,
    },
  };
}

async function updateAppointmentSchedule(pool, input) {
  if (!pool || typeof pool.connect !== 'function') {
    fail(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const result = await mutateInTransaction(client, input);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the authoritative failure. */ }
      if (error && ['40001', '40P01'].includes(error.code) && attempt < 2) continue;
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }
  fail(409, 'M22_STALE_APPROVAL', 'Schedule authority changed; refresh before approving again.');
}

module.exports = {
  ScheduleRepositoryError,
  appointmentResponse,
  scheduleAuthority,
  updateAppointmentSchedule,
};
