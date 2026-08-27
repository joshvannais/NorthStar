'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { evaluateConflictEvidence, EVALUATION_VERSION } = require('./conflictEvaluator');
const { evaluateRecommendationCandidates, RECOMMENDATION_VERSION } = require('./routeRecommendationEvaluator');

const MAXIMUM_RECOMMENDATION_CANDIDATES = 20;
const MAXIMUM_CREW_MEMBERS = 100;
const MAXIMUM_MEMBER_LINKS = 2000;
const MAXIMUM_SKILL_EVIDENCE = 4096;
const MAXIMUM_AVAILABILITY_INTERVALS = 4096;
const MAXIMUM_SCHEDULE_EVIDENCE = 1000;
const MAXIMUM_RESPONSE_BYTES = 256 * 1024;

class RecommendationRepositoryError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'RecommendationRepositoryError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function fail(status, code, message, cause) {
  throw new RecommendationRepositoryError(status, code, message, cause);
}

function digest(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

function mapDatabaseError(error) {
  if (error instanceof RecommendationRepositoryError) return error;
  if (error && ['40001', '40P01'].includes(error.code)) {
    return new RecommendationRepositoryError(409, 'M22_RECOMMENDATION_STALE',
      'Scheduling authority changed; refresh and request recommendations again.', error);
  }
  if (error && error.code === '42501') {
    return new RecommendationRepositoryError(403, 'M22_RECOMMENDATION_FORBIDDEN',
      'Current recommendation authority is unavailable.', error);
  }
  return new RecommendationRepositoryError(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE',
    'Canonical PostgreSQL persistence is unavailable.', error);
}

async function requireCurrentActor(client, input) {
  const result = await client.query(
    `SELECT membership.role, membership.status AS membership_status,
            membership.updated_at AS membership_updated_at,
            profile.operational_role, profile.updated_at AS profile_updated_at,
            account.status AS account_status,
            account.updated_at AT TIME ZONE 'UTC' AS account_updated_at,
            session.status AS session_status, session.access_expires_at,
            subscription.status AS subscription_status,
            subscription.trial_started_at, subscription.trial_ends_at,
            onboarding.status AS onboarding_status,
            transaction_timestamp() AS evaluated_at
       FROM public.organization_memberships membership
       JOIN public.workforce_profiles profile
         ON profile.organization_id = membership.organization_id
        AND profile.membership_id = membership.id
       JOIN public.users account
         ON account.organization_id = membership.organization_id
        AND account.id = membership.user_id
       JOIN public.auth_sessions session
         ON session.organization_id = membership.organization_id
        AND session.membership_id = membership.id
        AND session.user_id = membership.user_id
        AND session.id = $3
       JOIN public.subscriptions subscription
         ON subscription.organization_id = membership.organization_id
       JOIN public.organization_onboarding onboarding
         ON onboarding.organization_id = membership.organization_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2`,
    [input.organizationId, input.actorUserId, input.authSessionId]
  );
  const authority = result.rows[0];
  const evaluatedAt = authority && new Date(authority.evaluated_at).getTime();
  const subscriptionCurrent = authority && (authority.subscription_status === 'active' ||
    (authority.subscription_status === 'trialing' && authority.trial_started_at && authority.trial_ends_at &&
      new Date(authority.trial_ends_at).getTime() > evaluatedAt &&
      new Date(authority.trial_ends_at).getTime() - new Date(authority.trial_started_at).getTime() === 14 * 86400000));
  const roleAllowed = authority && (authority.role === 'owner' || authority.role === 'admin' ||
    (authority.role === 'member' && authority.operational_role === 'dispatcher'));
  if (!authority || authority.membership_status !== 'active' || authority.account_status !== 'active' ||
      authority.role !== input.actorAccessRole || !roleAllowed || authority.session_status !== 'active' ||
      new Date(authority.access_expires_at).getTime() <= evaluatedAt || !subscriptionCurrent ||
      authority.onboarding_status !== 'complete') {
    fail(403, 'M22_RECOMMENDATION_FORBIDDEN', 'Current recommendation authority is unavailable.');
  }
  return {
    evaluatedAt: timestamp(authority.evaluated_at),
    authorityDigest: sha256({
      accessRole: authority.role,
      accountUpdatedAt: timestamp(authority.account_updated_at),
      membershipUpdatedAt: timestamp(authority.membership_updated_at),
      operationalRole: authority.operational_role,
      profileUpdatedAt: timestamp(authority.profile_updated_at),
      sessionId: input.authSessionId,
    }),
  };
}

async function currentBusinessProfile(client, input) {
  const result = await client.query(
    `SELECT profile.id, profile.version_number, profile.normalized_profile_hash,
            profile.raw_profile, profile.created_at,
            profile.raw_profile #>> '{company,timeZone}' AS time_zone
       FROM public.organization_onboarding onboarding
       JOIN public.canonical_business_profiles profile
         ON profile.organization_id = onboarding.organization_id
        AND profile.id = onboarding.active_business_profile_id
      WHERE onboarding.organization_id = $1 AND onboarding.status = 'complete'
        AND profile.is_active = TRUE`,
    [input.organizationId]
  );
  const row = result.rowCount === 1 ? result.rows[0] : null;
  if (!row || row.time_zone !== input.expectedTimeZone) {
    fail(409, 'M22_STALE_TIME_ZONE', 'The tenant time zone changed; refresh and request recommendations again.');
  }
  return {
    id: String(row.id),
    version: Number(row.version_number),
    hash: digest(row.normalized_profile_hash),
    rawProfile: row.raw_profile && typeof row.raw_profile === 'object' && !Array.isArray(row.raw_profile)
      ? row.raw_profile : {},
    createdAt: timestamp(row.created_at),
    timeZone: row.time_zone,
  };
}

async function assignmentEvidence(client, input) {
  const result = await client.query(
    `SELECT assignment.*, appointment.updated_at AS appointment_updated_at,
            appointment.operation_id, appointment.graph_id,
            opportunity.service_type, opportunity.job_scope,
            opportunity.updated_at AS opportunity_updated_at,
            transcript.source, transcript.external_call_id
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
        AND transcript.source NOT IN ('simulation', 'demo')`,
    [input.organizationId, input.appointmentId]
  );
  const row = result.rows[0];
  if (!row) fail(404, 'NOT_FOUND', 'Appointment not found.');
  if (Number(row.revision) !== input.expectedRevision || digest(row.canonical_digest) !== input.expectedDigest) {
    fail(409, 'M22_RECOMMENDATION_STALE',
      'Scheduling authority changed; refresh and request recommendations again.');
  }
  return row;
}

async function candidateSet(client, organizationId) {
  const result = await client.query(
    `SELECT candidate_kind, candidate_id, display_name, home_location_id,
            candidate_updated_at, membership_status, membership_updated_at,
            user_status, user_updated_at
       FROM (
         SELECT 'profile'::text AS candidate_kind, profile.id AS candidate_id,
                account.name AS display_name, profile.home_location_id,
                profile.updated_at AS candidate_updated_at,
                membership.status AS membership_status,
                membership.updated_at AS membership_updated_at,
                account.status AS user_status,
                account.updated_at AT TIME ZONE 'UTC' AS user_updated_at
           FROM public.workforce_profiles profile
           JOIN public.organization_memberships membership
             ON membership.organization_id = profile.organization_id
            AND membership.id = profile.membership_id
           JOIN public.users account
             ON account.organization_id = membership.organization_id
            AND account.id = membership.user_id
          WHERE profile.organization_id = $1
            AND membership.status = 'active' AND account.status = 'active'
         UNION ALL
         SELECT 'crew'::text, crew.id, crew.name, crew.home_location_id,
                crew.updated_at, NULL::text, NULL::timestamp with time zone,
                NULL::text, NULL::timestamp with time zone
           FROM public.workforce_crews crew
          WHERE crew.organization_id = $1
       ) candidates
      ORDER BY candidate_kind, candidate_id
      LIMIT ${MAXIMUM_RECOMMENDATION_CANDIDATES + 1}`,
    [organizationId]
  );
  const rows = result.rows.slice(0, MAXIMUM_RECOMMENDATION_CANDIDATES);
  return {
    truncated: result.rows.length > MAXIMUM_RECOMMENDATION_CANDIDATES,
    rows: rows.map(row => ({
      kind: row.candidate_kind,
      id: row.candidate_id,
      label: row.display_name,
      homeLocationId: row.home_location_id,
      updatedAt: timestamp(row.candidate_updated_at),
      membershipStatus: row.membership_status,
      membershipUpdatedAt: timestamp(row.membership_updated_at),
      userStatus: row.user_status,
      userUpdatedAt: timestamp(row.user_updated_at),
    })),
  };
}

async function attachCrewMembers(client, organizationId, candidates) {
  const crewIds = candidates.filter(candidate => candidate.kind === 'crew').map(candidate => candidate.id);
  const normalizedCandidates = candidates.map(function (candidate) {
    if (candidate.kind === 'profile') {
      return {
        ...candidate,
        membersTruncated: false,
        members: [{
          profileId: candidate.id,
          membershipStatus: candidate.membershipStatus,
          membershipUpdatedAt: candidate.membershipUpdatedAt,
          userStatus: candidate.userStatus,
          userUpdatedAt: candidate.userUpdatedAt,
          profileUpdatedAt: candidate.updatedAt,
        }],
      };
    }
    return { ...candidate, membersTruncated: false, members: [] };
  });
  if (!crewIds.length) return { truncated: false, candidates: normalizedCandidates };
  const result = await client.query(
    `SELECT * FROM (
       SELECT relation.crew_id, profile.id AS profile_id,
              membership.status AS membership_status,
              membership.updated_at AS membership_updated_at,
              account.status AS user_status,
              account.updated_at AT TIME ZONE 'UTC' AS user_updated_at,
              profile.updated_at AS profile_updated_at,
              relation.crew_role, relation.created_at AS crew_member_created_at,
              row_number() OVER (PARTITION BY relation.crew_id ORDER BY profile.id) AS member_ordinal
         FROM public.workforce_crew_members relation
         JOIN public.workforce_profiles profile
           ON profile.organization_id = relation.organization_id AND profile.id = relation.profile_id
         JOIN public.organization_memberships membership
           ON membership.organization_id = profile.organization_id AND membership.id = profile.membership_id
         JOIN public.users account
           ON account.organization_id = membership.organization_id AND account.id = membership.user_id
        WHERE relation.organization_id = $1 AND relation.crew_id = ANY($2::uuid[])
     ) bounded
      WHERE member_ordinal <= ${MAXIMUM_CREW_MEMBERS + 1}
      ORDER BY crew_id, profile_id
      LIMIT ${MAXIMUM_MEMBER_LINKS + 1}`,
    [organizationId, crewIds]
  );
  const globallyTruncated = result.rows.length > MAXIMUM_MEMBER_LINKS;
  const rows = result.rows.slice(0, MAXIMUM_MEMBER_LINKS);
  const byCrew = new Map();
  for (const row of rows) {
    if (!byCrew.has(row.crew_id)) byCrew.set(row.crew_id, []);
    byCrew.get(row.crew_id).push(row);
  }
  return {
    truncated: globallyTruncated || rows.some(row => Number(row.member_ordinal) > MAXIMUM_CREW_MEMBERS),
    candidates: normalizedCandidates.map(function (candidate) {
      if (candidate.kind === 'profile') return candidate;
      const candidateRows = byCrew.get(candidate.id) || [];
      return {
        ...candidate,
        membersTruncated: globallyTruncated || candidateRows.some(row => Number(row.member_ordinal) > MAXIMUM_CREW_MEMBERS),
        members: candidateRows.slice(0, MAXIMUM_CREW_MEMBERS).map(row => ({
          profileId: row.profile_id,
          membershipStatus: row.membership_status,
          membershipUpdatedAt: timestamp(row.membership_updated_at),
          userStatus: row.user_status,
          userUpdatedAt: timestamp(row.user_updated_at),
          profileUpdatedAt: timestamp(row.profile_updated_at),
          crewRole: row.crew_role,
          crewMemberCreatedAt: timestamp(row.crew_member_created_at),
        })),
      };
    }),
  };
}

async function attachSkillsAndAvailability(client, organizationId, candidates) {
  const profileIds = Array.from(new Set(candidates.flatMap(candidate => candidate.members.map(member => member.profileId)))).sort();
  if (!profileIds.length) {
    return { candidates, skillTruncated: false, availabilityTruncated: false };
  }
  const skills = await client.query(
    `SELECT relation.profile_id, skill.id AS skill_id, skill.service_id,
            skill.updated_at AS skill_updated_at
       FROM public.workforce_profile_skills relation
       JOIN public.workforce_skills skill
         ON skill.organization_id = relation.organization_id AND skill.id = relation.skill_id
      WHERE relation.organization_id = $1 AND relation.profile_id = ANY($2::uuid[])
      ORDER BY relation.profile_id, skill.service_id, skill.id
      LIMIT ${MAXIMUM_SKILL_EVIDENCE + 1}`,
    [organizationId, profileIds]
  );
  const authorities = await client.query(
    `SELECT * FROM public.canonical_workforce_availability_authorities
      WHERE organization_id = $1 AND workforce_profile_id = ANY($2::uuid[])
      ORDER BY workforce_profile_id`,
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
      LIMIT ${MAXIMUM_AVAILABILITY_INTERVALS + 1}`,
    [organizationId, profileIds]
  ) : { rows: [] };
  const skillRows = skills.rows.slice(0, MAXIMUM_SKILL_EVIDENCE);
  const intervalRows = intervals.rows.slice(0, MAXIMUM_AVAILABILITY_INTERVALS);
  const skillMap = new Map();
  for (const row of skillRows) {
    if (!skillMap.has(row.profile_id)) skillMap.set(row.profile_id, []);
    skillMap.get(row.profile_id).push({
      id: row.skill_id,
      serviceId: row.service_id,
      updatedAt: timestamp(row.skill_updated_at),
    });
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
  const skillTruncated = skills.rows.length > MAXIMUM_SKILL_EVIDENCE;
  const availabilityTruncated = intervals.rows.length > MAXIMUM_AVAILABILITY_INTERVALS;
  return {
    skillTruncated,
    availabilityTruncated,
    candidates: candidates.map(function (candidate) {
      return {
        ...candidate,
        skillEvidenceTruncated: skillTruncated,
        availabilityEvidenceTruncated: availabilityTruncated,
        members: candidate.members.map(function (member) {
          const authority = authorityMap.get(member.profileId);
          const memberSkills = skillMap.get(member.profileId) || [];
          return {
            ...member,
            serviceIds: memberSkills.map(skill => skill.serviceId).filter(value => value !== null).sort(),
            skillEvidenceDigest: sha256(memberSkills),
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
        }),
      };
    }),
  };
}

function scheduleRow(row) {
  return {
    assignmentId: row.id,
    revision: Number(row.revision),
    digest: digest(row.canonical_digest),
    scheduledStart: timestamp(row.scheduled_start),
    scheduledEnd: timestamp(row.scheduled_end),
    approved: row.approved === true,
    profileIds: row.profile_ids.slice(0, MAXIMUM_CREW_MEMBERS),
  };
}

const SCHEDULE_SELECT = `
  SELECT assignment.id, assignment.revision, assignment.canonical_digest,
         assignment.scheduled_start, assignment.scheduled_end,
         (assignment.last_approval_id IS NOT NULL) AS approved,
         COALESCE(targets.profile_ids, ARRAY[]::uuid[]) AS profile_ids,
         COALESCE(array_length(targets.profile_ids, 1), 0) >
           ${MAXIMUM_CREW_MEMBERS} AS targets_truncated
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
           LIMIT ${MAXIMUM_CREW_MEMBERS + 1}
        ) bounded
    ) targets ON TRUE`;

async function scheduleEvidence(client, input, bufferMinutes) {
  if (!input.scheduledStart || !input.scheduledEnd) return { rows: [], truncated: false };
  const result = await client.query(
    `${SCHEDULE_SELECT}
     WHERE assignment.organization_id = $1 AND assignment.id <> $2
       AND assignment.schedule_state = 'scheduled'
       AND assignment.appointment_status <> 'cancelled'
       AND assignment.scheduled_start < $4::timestamptz + make_interval(mins => $5)
       AND assignment.scheduled_end > $3::timestamptz - make_interval(mins => $5)
     ORDER BY assignment.scheduled_start, assignment.id
     LIMIT ${MAXIMUM_SCHEDULE_EVIDENCE + 1}`,
    [input.organizationId, input.assignmentId, input.scheduledStart, input.scheduledEnd, bufferMinutes]
  );
  return {
    truncated: result.rows.length > MAXIMUM_SCHEDULE_EVIDENCE || result.rows.some(row => row.targets_truncated === true),
    rows: result.rows.slice(0, MAXIMUM_SCHEDULE_EVIDENCE).map(scheduleRow),
  };
}

async function workloadEvidence(client, input) {
  if (!input.scheduledStart || !input.scheduledEnd) return { rows: [], truncated: false, missing: true };
  const result = await client.query(
    `${SCHEDULE_SELECT}
     WHERE assignment.organization_id = $1 AND assignment.id <> $2
       AND assignment.schedule_state = 'scheduled'
       AND assignment.appointment_status <> 'cancelled'
       AND assignment.scheduled_start < $4::timestamptz + INTERVAL '48 hours'
       AND assignment.scheduled_end > $3::timestamptz - INTERVAL '48 hours'
     ORDER BY assignment.scheduled_start, assignment.id
     LIMIT ${MAXIMUM_SCHEDULE_EVIDENCE + 1}`,
    [input.organizationId, input.assignmentId, input.scheduledStart, input.scheduledEnd]
  );
  return {
    truncated: result.rows.length > MAXIMUM_SCHEDULE_EVIDENCE || result.rows.some(row => row.targets_truncated === true),
    missing: false,
    rows: result.rows.slice(0, MAXIMUM_SCHEDULE_EVIDENCE).map(scheduleRow),
  };
}

function candidateAuthorityPins(candidate) {
  const members = candidate.members.map(member => ({
    profileId: member.profileId,
    membershipStatus: member.membershipStatus,
    membershipUpdatedAt: member.membershipUpdatedAt,
    userStatus: member.userStatus,
    userUpdatedAt: member.userUpdatedAt,
    profileUpdatedAt: member.profileUpdatedAt,
    crewRole: member.crewRole || null,
    crewMemberCreatedAt: member.crewMemberCreatedAt || null,
    skillEvidenceDigest: member.skillEvidenceDigest,
    availability: member.availability ? {
      id: member.availability.id,
      revision: member.availability.revision,
      digest: member.availability.digest,
      coverageStart: member.availability.coverageStart,
      coverageEnd: member.availability.coverageEnd,
      updatedAt: member.availability.updatedAt,
      intervalDigest: sha256(member.availability.intervals),
    } : null,
  }));
  return stableValue({
    candidateUpdatedAt: candidate.updatedAt,
    homeLocationId: candidate.homeLocationId,
    memberCount: members.length,
    membersTruncated: candidate.membersTruncated === true,
    memberAuthorityDigest: sha256(members),
    skillEvidenceTruncated: candidate.skillEvidenceTruncated === true,
    availabilityEvidenceTruncated: candidate.availabilityEvidenceTruncated === true,
  });
}

function unscheduledConflict() {
  return Object.freeze({
    version: EVALUATION_VERSION,
    status: 'needs_review',
    hardConflicts: Object.freeze([]),
    warnings: Object.freeze([]),
    needsReview: true,
    reviewReasons: Object.freeze([{ code: 'appointment_schedule_unavailable' }]),
  });
}

function boundEvaluation(evaluation) {
  if (Buffer.byteLength(JSON.stringify(evaluation), 'utf8') <= MAXIMUM_RESPONSE_BYTES) return evaluation;
  const boundedMarker = { code: 'recommendation_response_bounded' };
  const alternatives = evaluation.alternatives.map(function (candidate) {
    return stableValue({
      ...candidate,
      conflicts: {
        ...candidate.conflicts,
        hardConflicts: candidate.conflicts.hardConflicts.slice(0, 2),
        warnings: candidate.conflicts.warnings.slice(0, 2),
        reviewReasons: candidate.conflicts.reviewReasons.slice(0, 2),
        detailsTruncated: true,
      },
      reasons: candidate.reasons.slice(0, 2),
      uncertainty: [boundedMarker],
      route: { ...candidate.route, reviewReasons: candidate.route.reviewReasons.slice(0, 4) },
    });
  });
  const bounded = stableValue({
    ...evaluation,
    alternatives,
    status: 'needs_review',
    needsReview: true,
    rankingComplete: false,
    reviewReasons: [boundedMarker, ...evaluation.reviewReasons],
  });
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAXIMUM_RESPONSE_BYTES) {
    fail(503, 'M22_RECOMMENDATION_BOUNDED', 'Recommendation evidence exceeds the safe response bound.');
  }
  return bounded;
}

async function recommendInTransaction(client, input) {
  const organization = await client.query('SELECT id FROM public.organizations WHERE id = $1', [input.organizationId]);
  if (organization.rowCount !== 1) fail(404, 'NOT_FOUND', 'Appointment not found.');
  const actor = await requireCurrentActor(client, input);
  const profile = await currentBusinessProfile(client, input);
  const assignment = await assignmentEvidence(client, input);
  const rawScope = assignment.job_scope && typeof assignment.job_scope === 'object' && !Array.isArray(assignment.job_scope)
    ? assignment.job_scope : {};
  const serviceId = typeof assignment.service_type === 'string' ? assignment.service_type : null;
  const rawScheduling = profile.rawProfile && profile.rawProfile.scheduling || {};
  const appointmentBuffer = Number.isFinite(rawScheduling.appointmentBuffer) ? rawScheduling.appointmentBuffer : 0;
  const travelBuffer = Number.isFinite(rawScheduling.travelBuffer) ? rawScheduling.travelBuffer : 0;
  const bufferMinutes = Math.max(0, Math.min(1440, Math.max(appointmentBuffer, travelBuffer)));

  let loadedCandidates = await candidateSet(client, input.organizationId);
  const memberEvidence = await attachCrewMembers(client, input.organizationId, loadedCandidates.rows);
  const enriched = await attachSkillsAndAvailability(client, input.organizationId, memberEvidence.candidates);
  loadedCandidates = { ...loadedCandidates, rows: enriched.candidates };
  const scheduleInput = {
    organizationId: input.organizationId,
    assignmentId: assignment.id,
    scheduledStart: timestamp(assignment.scheduled_start),
    scheduledEnd: timestamp(assignment.scheduled_end),
  };
  const schedules = await scheduleEvidence(client, scheduleInput, bufferMinutes);
  const workload = await workloadEvidence(client, scheduleInput);
  const skillAuthority = serviceId ? await client.query(
    `SELECT COUNT(*)::int AS count FROM public.workforce_skills
      WHERE organization_id = $1 AND lower(service_id) = lower($2)`,
    [input.organizationId, serviceId]
  ) : { rows: [{ count: 0 }] };
  const skillAuthorityKnown = Number(skillAuthority.rows[0].count) > 0;
  const proposalScheduleAvailable = assignment.schedule_state === 'scheduled' &&
    assignment.scheduled_start && assignment.scheduled_end;
  const destinationLocationId = typeof rawScope.locationId === 'string' ? rawScope.locationId : null;
  const globalEvidenceIncomplete = loadedCandidates.truncated || memberEvidence.truncated ||
    enriched.skillTruncated || enriched.availabilityTruncated || schedules.truncated || workload.truncated ||
    !proposalScheduleAvailable;
  const evaluatedCandidates = loadedCandidates.rows.map(function (candidate) {
    const proposal = proposalScheduleAvailable ? {
      target: { kind: candidate.kind, id: candidate.id },
      scheduledStart: scheduleInput.scheduledStart,
      scheduledEnd: scheduleInput.scheduledEnd,
      submittedScheduledStart: scheduleInput.scheduledStart,
      submittedScheduledEnd: scheduleInput.scheduledEnd,
      timeZone: profile.timeZone,
    } : null;
    const conflicts = proposal ? evaluateConflictEvidence({
      proposal,
      businessProfile: profile.rawProfile,
      appointment: { serviceId, locationId: destinationLocationId },
      skillAuthorityKnown,
      candidate: {
        exists: true,
        kind: candidate.kind,
        targetId: candidate.id,
        locationId: candidate.homeLocationId,
        membersTruncated: candidate.membersTruncated,
        members: candidate.members,
        skillEvidenceTruncated: candidate.skillEvidenceTruncated,
        availabilityEvidenceTruncated: candidate.availabilityEvidenceTruncated,
      },
      schedules: schedules.rows,
      scheduleSetTruncated: schedules.truncated,
      workloadSchedules: workload.rows,
      workloadSetTruncated: workload.truncated,
      workloadAuthorityMissing: workload.missing,
    }) : unscheduledConflict();
    return {
      kind: candidate.kind,
      id: candidate.id,
      label: candidate.label,
      homeLocationId: candidate.homeLocationId,
      authority: candidateAuthorityPins(candidate),
      conflicts,
    };
  });
  const recommendation = boundEvaluation(evaluateRecommendationCandidates({
    businessProfile: profile.rawProfile,
    destinationLocationId,
    candidates: evaluatedCandidates,
    candidateSetTruncated: loadedCandidates.truncated,
    globalEvidenceIncomplete,
  }));
  const assignmentPins = stableValue({
    id: assignment.id,
    appointmentId: input.appointmentId,
    revision: Number(assignment.revision),
    digest: digest(assignment.canonical_digest),
    targetState: assignment.target_state,
    scheduleState: assignment.schedule_state,
    dispatchState: assignment.dispatch_state,
    scheduledStart: scheduleInput.scheduledStart,
    scheduledEnd: scheduleInput.scheduledEnd,
    appointmentStatus: assignment.appointment_status,
    needsReview: assignment.needs_review === true,
    updatedAt: timestamp(assignment.updated_at),
  });
  const appointmentPins = stableValue({
    id: input.appointmentId,
    operationId: assignment.operation_id,
    graphId: assignment.graph_id,
    opportunityId: assignment.opportunity_id,
    appointmentUpdatedAt: timestamp(assignment.appointment_updated_at),
    opportunityUpdatedAt: timestamp(assignment.opportunity_updated_at),
    serviceId,
    destinationLocationId,
  });
  const candidateSetPins = stableValue({
    count: evaluatedCandidates.length,
    truncated: loadedCandidates.truncated,
    memberEvidenceTruncated: memberEvidence.truncated,
    skillEvidenceTruncated: enriched.skillTruncated,
    availabilityEvidenceTruncated: enriched.availabilityTruncated,
    digest: sha256(evaluatedCandidates.map(candidate => ({
      kind: candidate.kind, id: candidate.id, authority: candidate.authority,
    }))),
  });
  const conflictInputs = stableValue({
    evaluationVersion: EVALUATION_VERSION,
    scheduleEvidenceCount: schedules.rows.length,
    scheduleEvidenceTruncated: schedules.truncated,
    scheduleEvidenceDigest: sha256(schedules.rows),
    workloadEvidenceCount: workload.rows.length,
    workloadEvidenceTruncated: workload.truncated,
    workloadEvidenceDigest: sha256(workload.rows),
    skillAuthorityKnown,
  });
  const businessProfilePins = stableValue({
    id: profile.id,
    version: profile.version,
    digest: profile.hash,
    createdAt: profile.createdAt,
    timeZone: profile.timeZone,
    policyDigest: sha256({
      hours: profile.rawProfile.hours || null,
      scheduling: profile.rawProfile.scheduling || null,
      crew: profile.rawProfile.crew || null,
      headquarters: profile.rawProfile.headquarters || null,
    }),
  });
  const constraints = stableValue({
    recommendationVersion: RECOMMENDATION_VERSION,
    candidateLimit: MAXIMUM_RECOMMENDATION_CANDIDATES,
    crewMemberLimit: MAXIMUM_CREW_MEMBERS,
    memberLinkLimit: MAXIMUM_MEMBER_LINKS,
    skillEvidenceLimit: MAXIMUM_SKILL_EVIDENCE,
    availabilityIntervalLimit: MAXIMUM_AVAILABILITY_INTERVALS,
    scheduleEvidenceLimit: MAXIMUM_SCHEDULE_EVIDENCE,
    responseByteLimit: MAXIMUM_RESPONSE_BYTES,
    providerCallsAllowed: 0,
    drivingRouteEvidence: 'unavailable_without_separately_authorized_current_durable_evidence',
    mutationGrant: false,
  });
  const canonical = stableValue({
    appointmentId: input.appointmentId,
    assignmentId: assignment.id,
    evaluatedAt: actor.evaluatedAt,
    timeZone: profile.timeZone,
    assignmentPins,
    appointmentPins: { ...appointmentPins, digest: sha256(appointmentPins) },
    businessProfilePins,
    candidateSetPins,
    conflictInputs,
    actorAuthorityDigest: actor.authorityDigest,
    constraints: { ...constraints, digest: sha256(constraints) },
    ...recommendation,
  });
  const finalDigest = sha256(canonical);
  const data = Object.freeze({ ...canonical, digest: finalDigest });
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAXIMUM_RESPONSE_BYTES) {
    fail(503, 'M22_RECOMMENDATION_BOUNDED', 'Recommendation evidence exceeds the safe response bound.');
  }
  return { success: true, data };
}

async function recommendAppointmentCandidates(pool, input) {
  if (!pool || typeof pool.connect !== 'function') {
    fail(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      await client.query('SET LOCAL search_path = pg_catalog, public');
      const response = await recommendInTransaction(client, input);
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
  fail(409, 'M22_RECOMMENDATION_STALE',
    'Scheduling authority changed; refresh and request recommendations again.');
}

module.exports = {
  MAXIMUM_AVAILABILITY_INTERVALS,
  MAXIMUM_CREW_MEMBERS,
  MAXIMUM_MEMBER_LINKS,
  MAXIMUM_RECOMMENDATION_CANDIDATES,
  MAXIMUM_RESPONSE_BYTES,
  MAXIMUM_SCHEDULE_EVIDENCE,
  MAXIMUM_SKILL_EVIDENCE,
  RecommendationRepositoryError,
  attachCrewMembers,
  recommendAppointmentCandidates,
};
