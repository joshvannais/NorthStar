'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { evaluateConflictEvidence, EVALUATION_VERSION } = require('./conflictEvaluator');

const MAXIMUM_CANDIDATE_MEMBERS = 100;
const MAXIMUM_CANDIDATE_SKILLS = 4096;
const MAXIMUM_CANDIDATE_INTERVALS = 4096;

class ConflictRepositoryError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'ConflictRepositoryError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function fail(status, code, message, cause) {
  throw new ConflictRepositoryError(status, code, message, cause);
}

function digest(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

function json(value) {
  return JSON.stringify(stableValue(value));
}

function mapDatabaseError(error) {
  if (error instanceof ConflictRepositoryError) return error;
  if (error && ['40001', '40P01'].includes(error.code)) {
    return new ConflictRepositoryError(409, 'M22_EVALUATION_STALE', 'Scheduling authority changed; refresh and evaluate again.', error);
  }
  if (error && error.code === '42501') {
    return new ConflictRepositoryError(403, 'M22_EVALUATION_FORBIDDEN', 'Current scheduling authority is unavailable.', error);
  }
  if (error && error.code === '23514') {
    return new ConflictRepositoryError(400, 'M22_EVALUATION_INVALID', 'Scheduling evidence is invalid.', error);
  }
  return new ConflictRepositoryError(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.', error);
}

async function lockOrganization(client, organizationId, mutation) {
  const result = await client.query(
    `SELECT id FROM public.organizations WHERE id = $1 ${mutation ? 'FOR UPDATE' : 'FOR SHARE'}`,
    [organizationId]
  );
  if (result.rowCount !== 1) fail(404, 'NOT_FOUND', 'Scheduling authority not found.');
}

async function requireCurrentActor(client, input) {
  const result = await client.query(
    `SELECT membership.id, membership.role, membership.status AS membership_status,
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
  const subscriptionCurrent = authority && (authority.subscription_status === 'active' ||
    (authority.subscription_status === 'trialing' && authority.trial_started_at && authority.trial_ends_at &&
      new Date(authority.trial_ends_at).getTime() > Date.now() &&
      new Date(authority.trial_ends_at).getTime() - new Date(authority.trial_started_at).getTime() === 14 * 86400000));
  const roleAllowed = authority && (authority.role === 'owner' || authority.role === 'admin' ||
    (authority.role === 'member' && authority.operational_role === 'dispatcher'));
  if (!authority || authority.membership_status !== 'active' || authority.role !== input.actorAccessRole ||
      !roleAllowed || authority.session_status !== 'active' ||
      new Date(authority.access_expires_at).getTime() <= Date.now() || !subscriptionCurrent ||
      authority.onboarding_status !== 'complete') {
    fail(403, 'M22_EVALUATION_FORBIDDEN', 'Current scheduling authority is unavailable.');
  }
  return authority;
}

async function currentBusinessProfile(client, input) {
  const result = await client.query(
    `SELECT profile.id, profile.version_number, profile.normalized_profile_hash,
            profile.raw_profile, profile.raw_profile #>> '{company,timeZone}' AS time_zone
       FROM public.organization_onboarding onboarding
       JOIN public.canonical_business_profiles profile
         ON profile.organization_id = onboarding.organization_id
        AND profile.id = onboarding.active_business_profile_id
      WHERE onboarding.organization_id = $1 AND onboarding.status = 'complete'
        AND profile.is_active = TRUE
      FOR SHARE OF onboarding, profile`,
    [input.organizationId]
  );
  const row = result.rowCount === 1 ? result.rows[0] : null;
  if (!row || row.time_zone !== input.expectedTimeZone) {
    fail(409, 'M22_STALE_TIME_ZONE', 'The tenant time zone changed; refresh and evaluate again.');
  }
  return {
    id: String(row.id),
    version: Number(row.version_number),
    hash: digest(row.normalized_profile_hash),
    rawProfile: row.raw_profile && typeof row.raw_profile === 'object' ? row.raw_profile : {},
    timeZone: row.time_zone,
  };
}

function timeZoneAuthority(profile) {
  return stableValue({
    profileHash: profile.hash,
    profileId: profile.id,
    profileVersion: profile.version,
    timeZone: profile.timeZone,
  });
}

function availabilityResponse(row, intervals) {
  return {
    id: row.id,
    profileId: row.workforce_profile_id,
    coverageStart: timestamp(row.coverage_start),
    coverageEnd: timestamp(row.coverage_end),
    intervals: intervals.map(function (interval) {
      return {
        ordinal: Number(interval.ordinal),
        kind: interval.interval_kind,
        start: timestamp(interval.starts_at),
        end: timestamp(interval.ends_at),
      };
    }),
    revision: Number(row.revision),
    digest: digest(row.canonical_digest),
    updatedAt: timestamp(row.updated_at),
  };
}

async function replayAvailability(client, input) {
  const result = await client.query(
    `SELECT request_digest, response_status, response_body
       FROM public.canonical_workforce_availability_idempotency
      WHERE organization_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
    [input.organizationId, input.actorUserId, input.idempotencyKeyHash]
  );
  if (result.rowCount === 0) return null;
  if (digest(result.rows[0].request_digest) !== input.requestDigest) {
    fail(409, 'M22_AVAILABILITY_IDEMPOTENCY_CONFLICT', 'The Idempotency-Key was already used for another availability write.');
  }
  return { status: result.rows[0].response_status, body: result.rows[0].response_body, replayed: true };
}

async function replaceAvailabilityInTransaction(client, input) {
  await lockOrganization(client, input.organizationId, true);
  await requireCurrentActor(client, input);
  const profile = await currentBusinessProfile(client, input);
  const target = await client.query(
    `SELECT profile.id
       FROM public.workforce_profiles profile
       JOIN public.organization_memberships membership
         ON membership.organization_id = profile.organization_id
        AND membership.id = profile.membership_id
      WHERE profile.organization_id = $1 AND profile.id = $2
        AND membership.status = 'active'
      FOR UPDATE OF profile, membership`,
    [input.organizationId, input.profileId]
  );
  if (target.rowCount !== 1) fail(404, 'NOT_FOUND', 'Workforce profile not found.');
  const replay = await replayAvailability(client, input);
  if (replay) return replay;

  const currentResult = await client.query(
    `SELECT * FROM public.canonical_workforce_availability_authorities
      WHERE organization_id = $1 AND workforce_profile_id = $2 FOR UPDATE`,
    [input.organizationId, input.profileId]
  );
  const current = currentResult.rows[0] || null;
  const currentRevision = current ? Number(current.revision) : 0;
  const currentDigest = current ? digest(current.canonical_digest) : null;
  if (currentRevision !== input.expectedRevision || currentDigest !== input.expectedDigest) {
    fail(409, 'M22_AVAILABILITY_STALE', 'Availability authority changed; refresh before replacing it.');
  }
  const canonicalIntervals = input.intervals.map(interval => ({
    end: interval.end,
    kind: interval.kind,
    ordinal: interval.ordinal,
    start: interval.start,
  }));
  const digestResult = await client.query(
    `SELECT public.canonical_workforce_availability_digest($1,$2,$3,$4::jsonb) AS digest`,
    [input.profileId, input.coverageStart, input.coverageEnd, json(canonicalIntervals)]
  );
  const afterDigest = digest(digestResult.rows[0].digest);
  const afterRevision = currentRevision + 1;
  let authority;
  if (!current) {
    authority = (await client.query(
      `INSERT INTO public.canonical_workforce_availability_authorities
        (organization_id, workforce_profile_id, coverage_start, coverage_end,
         revision, canonical_digest, last_actor_user_id, last_auth_session_id,
         last_reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING *`,
      [input.organizationId, input.profileId, input.coverageStart, input.coverageEnd,
        afterRevision, afterDigest, input.actorUserId, input.authSessionId, input.reason]
    )).rows[0];
  } else {
    authority = (await client.query(
      `UPDATE public.canonical_workforce_availability_authorities
          SET coverage_start = $3, coverage_end = $4, revision = $5,
              canonical_digest = $6, last_actor_user_id = $7,
              last_auth_session_id = $8, last_reason = $9, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [input.organizationId, current.id, input.coverageStart, input.coverageEnd,
        afterRevision, afterDigest, input.actorUserId, input.authSessionId, input.reason]
    )).rows[0];
    await client.query(
      `DELETE FROM public.canonical_workforce_availability_intervals
        WHERE organization_id = $1 AND availability_id = $2`,
      [input.organizationId, authority.id]
    );
  }
  for (const interval of input.intervals) {
    await client.query(
      `INSERT INTO public.canonical_workforce_availability_intervals
        (organization_id, availability_id, ordinal, interval_kind, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [input.organizationId, authority.id, interval.ordinal, interval.kind, interval.start, interval.end]
    );
  }
  const revision = (await client.query(
    `INSERT INTO public.canonical_workforce_availability_revisions
      (organization_id, availability_id, workforce_profile_id, revision,
       canonical_digest, coverage_start, coverage_end, intervals,
       submitted_coverage, submitted_intervals, time_zone_authority,
       actor_user_id, actor_access_role, auth_session_id, request_digest,
       idempotency_key_hash, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
             $12,$13,$14,$15,$16,$17) RETURNING id`,
    [input.organizationId, authority.id, input.profileId, afterRevision, afterDigest,
      input.coverageStart, input.coverageEnd, json(canonicalIntervals),
      json(input.submittedCoverage), json(input.submittedIntervals), json(timeZoneAuthority(profile)),
      input.actorUserId, input.actorAccessRole, input.authSessionId, input.requestDigest,
      input.idempotencyKeyHash, input.reason]
  )).rows[0];
  await client.query(
    `INSERT INTO public.canonical_workforce_availability_audit_events
      (organization_id, availability_id, availability_revision_id,
       workforce_profile_id, actor_user_id, before_revision, after_revision,
       before_digest, after_digest, reason, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [input.organizationId, authority.id, revision.id, input.profileId, input.actorUserId,
      currentRevision, afterRevision, currentDigest, afterDigest, input.reason,
      json({ coverageStart: input.coverageStart, coverageEnd: input.coverageEnd,
        intervalCount: input.intervals.length, timeZoneAuthority: timeZoneAuthority(profile) })]
  );
  const intervalRows = input.intervals.map(interval => ({
    ordinal: interval.ordinal,
    interval_kind: interval.kind,
    starts_at: interval.start,
    ends_at: interval.end,
  }));
  const responseBody = { success: true, data: availabilityResponse(authority, intervalRows) };
  await client.query(
    `INSERT INTO public.canonical_workforce_availability_idempotency
      (organization_id, actor_user_id, idempotency_key_hash, request_digest,
       availability_id, availability_revision_id, response_status, response_body)
     VALUES ($1,$2,$3,$4,$5,$6,200,$7::jsonb)`,
    [input.organizationId, input.actorUserId, input.idempotencyKeyHash, input.requestDigest,
      authority.id, revision.id, json(responseBody)]
  );
  return { status: 200, body: responseBody, replayed: false };
}

async function replaceAvailability(pool, input) {
  if (!pool || typeof pool.connect !== 'function') {
    fail(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const result = await replaceAvailabilityInTransaction(client, input);
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
  fail(409, 'M22_AVAILABILITY_STALE', 'Availability authority changed; refresh before replacing it.');
}

async function assignmentEvidence(client, input) {
  const result = await client.query(
    `SELECT assignment.*, opportunity.service_type, opportunity.job_scope,
            opportunity.updated_at AS opportunity_updated_at, transcript.source,
            transcript.external_call_id
       FROM public.canonical_schedule_assignments assignment
       JOIN public.canonical_appointments appointment
         ON appointment.organization_id = assignment.organization_id
        AND appointment.id = assignment.appointment_id
       JOIN public.canonical_opportunities opportunity
         ON opportunity.organization_id = assignment.organization_id
        AND opportunity.id = assignment.opportunity_id
       JOIN public.canonical_transcripts transcript
         ON transcript.organization_id = appointment.organization_id
        AND transcript.operation_id = appointment.operation_id
      WHERE assignment.organization_id = $1 AND assignment.appointment_id = $2
        AND (transcript.source NOT IN ('simulation', 'demo')
          OR ($3::text IS NOT NULL AND transcript.external_call_id = $3 || ':call'))
      FOR SHARE OF assignment, appointment, opportunity, transcript`,
    [input.organizationId, input.appointmentId, input.explicitSession]
  );
  const row = result.rows[0];
  if (!row) fail(404, 'NOT_FOUND', 'Appointment not found.');
  if (Number(row.revision) !== input.expectedRevision || digest(row.canonical_digest) !== input.expectedDigest) {
    fail(409, 'M22_EVALUATION_STALE', 'Scheduling authority changed; refresh and evaluate again.');
  }
  return row;
}

async function candidateEvidence(client, input) {
  if (input.proposal.target.kind === 'unassigned') return { exists: true, kind: 'unassigned', targetId: null, members: [], locationId: null };
  if (input.proposal.target.kind === 'profile') {
    const profile = await client.query(
      `SELECT profile.id AS profile_id, profile.home_location_id, profile.updated_at AS profile_updated_at,
              membership.status AS membership_status, membership.updated_at AS membership_updated_at,
              account.status AS user_status
         FROM public.workforce_profiles profile
         JOIN public.organization_memberships membership
           ON membership.organization_id = profile.organization_id
          AND membership.id = profile.membership_id
         JOIN public.users account
           ON account.organization_id = membership.organization_id
          AND account.id = membership.user_id
        WHERE profile.organization_id = $1 AND profile.id = $2
        FOR SHARE OF profile, membership, account`,
      [input.organizationId, input.proposal.target.id]
    );
    if (profile.rowCount !== 1) return { exists: false, kind: 'profile', targetId: input.proposal.target.id, members: [], locationId: null };
    const row = profile.rows[0];
    return {
      exists: true,
      kind: 'profile',
      targetId: row.profile_id,
      locationId: row.home_location_id,
      updatedAt: timestamp(row.profile_updated_at),
      members: [{
        profileId: row.profile_id,
        membershipStatus: row.membership_status,
        membershipUpdatedAt: timestamp(row.membership_updated_at),
        userStatus: row.user_status,
      }],
    };
  }
  const crew = await client.query(
    `SELECT id, home_location_id, updated_at
       FROM public.workforce_crews
      WHERE organization_id = $1 AND id = $2 FOR SHARE`,
    [input.organizationId, input.proposal.target.id]
  );
  if (crew.rowCount !== 1) return { exists: false, kind: 'crew', targetId: input.proposal.target.id, members: [], locationId: null };
  const members = await client.query(
    `SELECT profile.id AS profile_id, membership.status AS membership_status,
            membership.updated_at AS membership_updated_at, account.status AS user_status,
            relation.crew_role, relation.created_at AS crew_member_created_at
       FROM public.workforce_crew_members relation
       JOIN public.workforce_profiles profile
         ON profile.organization_id = relation.organization_id AND profile.id = relation.profile_id
       JOIN public.organization_memberships membership
         ON membership.organization_id = profile.organization_id AND membership.id = profile.membership_id
       JOIN public.users account
         ON account.organization_id = membership.organization_id AND account.id = membership.user_id
      WHERE relation.organization_id = $1 AND relation.crew_id = $2
      ORDER BY profile.id
      LIMIT ${MAXIMUM_CANDIDATE_MEMBERS + 1}
      FOR SHARE OF relation, profile, membership, account`,
    [input.organizationId, input.proposal.target.id]
  );
  return {
    exists: true,
    kind: 'crew',
    targetId: crew.rows[0].id,
    locationId: crew.rows[0].home_location_id,
    updatedAt: timestamp(crew.rows[0].updated_at),
    membersTruncated: members.rows.length > MAXIMUM_CANDIDATE_MEMBERS,
    members: members.rows.slice(0, MAXIMUM_CANDIDATE_MEMBERS).map(row => ({
      profileId: row.profile_id,
      membershipStatus: row.membership_status,
      membershipUpdatedAt: timestamp(row.membership_updated_at),
      userStatus: row.user_status,
      crewRole: row.crew_role,
      crewMemberCreatedAt: timestamp(row.crew_member_created_at),
    })),
  };
}

async function attachSkillsAndAvailability(client, organizationId, candidate) {
  const profileIds = candidate.members.map(member => member.profileId);
  if (!profileIds.length) return candidate;
  const skills = await client.query(
    `SELECT relation.profile_id, skill.service_id
       FROM public.workforce_profile_skills relation
       JOIN public.workforce_skills skill
         ON skill.organization_id = relation.organization_id AND skill.id = relation.skill_id
      WHERE relation.organization_id = $1 AND relation.profile_id = ANY($2::uuid[])
      ORDER BY relation.profile_id, skill.service_id, skill.id
      LIMIT ${MAXIMUM_CANDIDATE_SKILLS + 1}`,
    [organizationId, profileIds]
  );
  const authorities = await client.query(
    `SELECT * FROM public.canonical_workforce_availability_authorities
      WHERE organization_id = $1 AND workforce_profile_id = ANY($2::uuid[])
      ORDER BY workforce_profile_id FOR SHARE`,
    [organizationId, profileIds]
  );
  const intervals = authorities.rowCount ? await client.query(
    `SELECT interval.*, authority.workforce_profile_id
       FROM public.canonical_workforce_availability_intervals interval
       JOIN public.canonical_workforce_availability_authorities authority
         ON authority.organization_id = interval.organization_id
        AND authority.id = interval.availability_id
      WHERE interval.organization_id = $1 AND authority.workforce_profile_id = ANY($2::uuid[])
      ORDER BY authority.workforce_profile_id, interval.ordinal
      LIMIT ${MAXIMUM_CANDIDATE_INTERVALS + 1}`,
    [organizationId, profileIds]
  ) : { rows: [] };
  const skillMap = new Map();
  const skillRows = skills.rows.slice(0, MAXIMUM_CANDIDATE_SKILLS);
  const intervalRows = intervals.rows.slice(0, MAXIMUM_CANDIDATE_INTERVALS);
  for (const row of skillRows) {
    if (!skillMap.has(row.profile_id)) skillMap.set(row.profile_id, []);
    if (row.service_id !== null) skillMap.get(row.profile_id).push(row.service_id);
  }
  const authorityMap = new Map(authorities.rows.map(row => [row.workforce_profile_id, row]));
  const intervalMap = new Map();
  for (const row of intervalRows) {
    if (!intervalMap.has(row.workforce_profile_id)) intervalMap.set(row.workforce_profile_id, []);
    intervalMap.get(row.workforce_profile_id).push({
      ordinal: Number(row.ordinal), kind: row.interval_kind,
      start: timestamp(row.starts_at), end: timestamp(row.ends_at),
    });
  }
  candidate.members = candidate.members.map(function (member) {
    const authority = authorityMap.get(member.profileId);
    return {
      ...member,
      serviceIds: (skillMap.get(member.profileId) || []).sort(),
      availability: authority ? {
        id: authority.id,
        revision: Number(authority.revision),
        digest: digest(authority.canonical_digest),
        coverageStart: timestamp(authority.coverage_start),
        coverageEnd: timestamp(authority.coverage_end),
        updatedAt: timestamp(authority.updated_at),
        intervals: intervalMap.get(member.profileId) || [],
      } : null,
    };
  });
  candidate.skillEvidenceTruncated = skills.rows.length > MAXIMUM_CANDIDATE_SKILLS;
  candidate.availabilityEvidenceTruncated = intervals.rows.length > MAXIMUM_CANDIDATE_INTERVALS;
  return candidate;
}

async function scheduleEvidence(client, input, bufferMinutes) {
  const result = await client.query(
    `SELECT assignment.id, assignment.revision, assignment.canonical_digest,
            assignment.scheduled_start, assignment.scheduled_end,
            (assignment.last_approval_id IS NOT NULL) AS approved,
            COALESCE(targets.profile_ids, ARRAY[]::uuid[]) AS profile_ids,
            COALESCE(array_length(targets.profile_ids, 1), 0) >
              ${MAXIMUM_CANDIDATE_MEMBERS} AS targets_truncated
       FROM public.canonical_schedule_assignments assignment
       LEFT JOIN LATERAL (
         SELECT array_agg(bounded.profile_id ORDER BY bounded.profile_id) AS profile_ids
           FROM (
             SELECT candidate.profile_id
               FROM (
                 SELECT assignment.workforce_profile_id AS profile_id
                  WHERE assignment.workforce_profile_id IS NOT NULL
                 UNION
                 SELECT member.profile_id
                   FROM public.workforce_crew_members member
                  WHERE member.organization_id = assignment.organization_id
                    AND member.crew_id = assignment.workforce_crew_id
               ) candidate
              ORDER BY candidate.profile_id
              LIMIT ${MAXIMUM_CANDIDATE_MEMBERS + 1}
           ) bounded
       ) targets ON TRUE
      WHERE assignment.organization_id = $1 AND assignment.id <> $2
        AND assignment.schedule_state = 'scheduled'
        AND assignment.appointment_status <> 'cancelled'
        AND assignment.scheduled_start < $4::timestamptz + make_interval(mins => $5)
        AND assignment.scheduled_end > $3::timestamptz - make_interval(mins => $5)
      ORDER BY assignment.scheduled_start, assignment.id
      LIMIT 1001
      FOR SHARE OF assignment`,
    [input.organizationId, input.assignmentId, input.proposal.scheduledStart,
      input.proposal.scheduledEnd, bufferMinutes]
  );
  return {
    truncated: result.rows.length > 1000 || result.rows.some(row => row.targets_truncated === true),
    rows: result.rows.slice(0, 1000).map(row => ({
      assignmentId: row.id,
      revision: Number(row.revision),
      digest: digest(row.canonical_digest),
      scheduledStart: timestamp(row.scheduled_start),
      scheduledEnd: timestamp(row.scheduled_end),
      approved: row.approved === true,
      profileIds: row.profile_ids.slice(0, MAXIMUM_CANDIDATE_MEMBERS),
    })),
  };
}

function evaluationResponse(row) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    appointmentId: row.appointment_id,
    evaluationVersion: Number(row.evaluation_version),
    assignmentRevision: Number(row.expected_revision),
    assignmentDigest: digest(row.expected_digest),
    proposal: row.proposal,
    status: row.status,
    hardConflicts: row.hard_conflicts,
    warnings: row.warnings,
    needsReview: row.needs_review,
    reviewReasons: row.review_reasons,
    digest: digest(row.canonical_digest),
    evaluatedAt: timestamp(row.evaluated_at),
    grantsMutation: false,
  };
}

async function evaluateInTransaction(client, input) {
  await lockOrganization(client, input.organizationId, false);
  await requireCurrentActor(client, input);
  const profile = await currentBusinessProfile(client, input);
  const assignment = await assignmentEvidence(client, input);
  input.assignmentId = assignment.id;
  let candidate = await candidateEvidence(client, input);
  candidate = await attachSkillsAndAvailability(client, input.organizationId, candidate);

  const rawScheduling = profile.rawProfile && profile.rawProfile.scheduling || {};
  const appointmentBuffer = Number.isFinite(rawScheduling.appointmentBuffer) ? rawScheduling.appointmentBuffer : 0;
  const travelBuffer = Number.isFinite(rawScheduling.travelBuffer) ? rawScheduling.travelBuffer : 0;
  const bufferMinutes = Math.max(0, Math.min(1440, Math.max(appointmentBuffer, travelBuffer)));
  const schedules = await scheduleEvidence(client, input, bufferMinutes);
  const rawScope = assignment.job_scope && typeof assignment.job_scope === 'object' && !Array.isArray(assignment.job_scope)
    ? assignment.job_scope : {};
  const serviceId = typeof assignment.service_type === 'string' ? assignment.service_type : null;
  const skillAuthority = serviceId ? await client.query(
    `SELECT COUNT(*)::int AS count FROM public.workforce_skills
      WHERE organization_id = $1 AND lower(service_id) = lower($2)`,
    [input.organizationId, serviceId]
  ) : { rows: [{ count: 0 }] };
  const evaluatorInput = {
    proposal: input.proposal,
    businessProfile: profile.rawProfile,
    appointment: {
      serviceId,
      locationId: typeof rawScope.locationId === 'string' ? rawScope.locationId : null,
    },
    skillAuthorityKnown: Number(skillAuthority.rows[0].count) > 0,
    candidate,
    schedules: schedules.rows,
    scheduleSetTruncated: schedules.truncated,
  };
  const result = evaluateConflictEvidence(evaluatorInput);
  const evidence = stableValue({
    assignment: {
      id: assignment.id, revision: Number(assignment.revision), digest: digest(assignment.canonical_digest),
    },
    appointment: {
      opportunityUpdatedAt: timestamp(assignment.opportunity_updated_at), serviceId,
      locationId: evaluatorInput.appointment.locationId,
    },
    businessProfile: {
      id: profile.id, version: profile.version, hash: profile.hash, timeZone: profile.timeZone,
      policyDigest: sha256({
        hours: profile.rawProfile.hours || null,
        scheduling: profile.rawProfile.scheduling || null,
        crew: profile.rawProfile.crew || null,
        locations: profile.rawProfile.headquarters || null,
      }),
    },
    candidate,
    schedules: schedules.rows,
    scheduleSetTruncated: schedules.truncated,
    skillAuthorityKnown: evaluatorInput.skillAuthorityKnown,
  });
  const evaluationDigest = digest((await client.query(
    `SELECT public.canonical_schedule_conflict_evaluation_digest(
       $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb
     ) AS digest`,
    [EVALUATION_VERSION, assignment.id, input.expectedRevision, input.expectedDigest,
      json(input.proposal), json(evidence), json(result.hardConflicts), json(result.warnings),
      json(result.reviewReasons)]
  )).rows[0].digest);
  const inserted = await client.query(
    `INSERT INTO public.canonical_schedule_conflict_evaluations
      (organization_id, assignment_id, appointment_id, actor_user_id,
       actor_access_role, auth_session_id, evaluation_version, expected_revision,
       expected_digest, request_digest, proposal, evidence, status,
       hard_conflicts, warnings, needs_review, review_reasons, canonical_digest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,
             $14::jsonb,$15::jsonb,$16,$17::jsonb,$18)
     ON CONFLICT (organization_id, assignment_id, canonical_digest) DO NOTHING
     RETURNING *`,
    [input.organizationId, assignment.id, input.appointmentId, input.actorUserId,
      input.actorAccessRole, input.authSessionId, EVALUATION_VERSION, input.expectedRevision,
      input.expectedDigest, input.requestDigest, json(input.proposal), json(evidence), result.status,
      json(result.hardConflicts), json(result.warnings), result.needsReview,
      json(result.reviewReasons), evaluationDigest]
  );
  const row = inserted.rows[0] || (await client.query(
    `SELECT * FROM public.canonical_schedule_conflict_evaluations
      WHERE organization_id = $1 AND assignment_id = $2 AND canonical_digest = $3`,
    [input.organizationId, assignment.id, evaluationDigest]
  )).rows[0];
  return { success: true, data: evaluationResponse(row) };
}

async function evaluateScheduleConflicts(pool, input) {
  if (!pool || typeof pool.connect !== 'function') {
    fail(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const response = await evaluateInTransaction(client, input);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the authoritative failure. */ }
      if (error && ['40001', '40P01'].includes(error.code) && attempt < 2) continue;
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }
  fail(409, 'M22_EVALUATION_STALE', 'Scheduling authority changed; refresh and evaluate again.');
}

module.exports = {
  MAXIMUM_CANDIDATE_INTERVALS,
  MAXIMUM_CANDIDATE_MEMBERS,
  MAXIMUM_CANDIDATE_SKILLS,
  ConflictRepositoryError,
  availabilityResponse,
  evaluateScheduleConflicts,
  replaceAvailability,
};
