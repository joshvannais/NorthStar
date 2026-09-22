'use strict';

// Internal M26 Part 5B source read. M22 remains the availability and access
// authority. This snapshot does not establish role qualification, commitments,
// attendance, or usable capacity.
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const scheduling = require('../scheduling/conflictRepository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_WORKERS = 100;
const MAX_HORIZON_MS = 31 * 86400000;

function error(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function microsecondKey(value) {
  return value.replace(/\.(\d{3})Z$/, '.$1000Z');
}

function validate(input) {
  if (!exact(input, ['organizationId', 'actorUserId', 'actorAccessRole',
    'authSessionId', 'expectedTimeZone', 'horizon']) ||
      !UUID.test(input.organizationId) || !UUID.test(input.actorUserId) ||
      !UUID.test(input.authSessionId) ||
      !['owner', 'admin', 'member'].includes(input.actorAccessRole) ||
      typeof input.expectedTimeZone !== 'string' || input.expectedTimeZone.length > 100 ||
      !exact(input.horizon, ['startsAt', 'endsAt']) ||
      !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
      Date.parse(input.horizon.endsAt) <= Date.parse(input.horizon.startsAt) ||
      Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > MAX_HORIZON_MS) {
    throw error('M26_AVAILABILITY_SNAPSHOT_INVALID', 'Availability snapshot request is invalid.');
  }
}

function unavailable(reason) {
  return Object.freeze({ state: 'unavailable', reason, forecastIssued: false });
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

async function readDeclaredAvailabilitySnapshot(pool, input) {
  validate(input);
  if (!pool || typeof pool.connect !== 'function') {
    throw error('CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.', 503);
  }
  let client;
  try {
    client = await pool.connect();
    // M22's existing guarded reads use FOR SHARE. No write is performed here.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await scheduling.lockOrganization(client, input.organizationId, false);
    // The first row read above establishes the repeatable-read MVCC snapshot.
    // Transaction start time predates that snapshot and cannot label it.
    const observed = (await client.query(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at,
         pg_current_snapshot()::text AS snapshot_id`
    )).rows[0];
    const observedAt = observed?.observed_at;
    const snapshotId = observed?.snapshot_id;
    if (typeof observedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(observedAt) ||
        typeof snapshotId !== 'string' || !snapshotId) {
      throw error('CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.', 503);
    }
    await scheduling.requireCurrentActor(client, { ...input, readOnlyOperator: false });
    const profile = await scheduling.currentBusinessProfile(client, { ...input, readOnlyOperator: false });
    if (microsecondKey(input.horizon.startsAt) < observedAt || !profile.rawProfile.hours ||
        typeof profile.rawProfile.hours !== 'object' || Array.isArray(profile.rawProfile.hours)) {
      await client.query('COMMIT');
      return unavailable('working_hours_or_future_window_unavailable');
    }

    const roster = await client.query(
      `SELECT profile.id AS profile_id, profile.operational_role,
              profile.home_location_id, profile.updated_at AS profile_updated_at,
              membership.updated_at AS membership_updated_at
         FROM public.workforce_profiles profile
         JOIN public.organization_memberships membership
           ON membership.organization_id = profile.organization_id
          AND membership.id = profile.membership_id
         JOIN public.users account
           ON account.organization_id = membership.organization_id
          AND account.id = membership.user_id
        WHERE profile.organization_id = $1 AND membership.status = 'active'
          AND account.status = 'active'
        ORDER BY profile.id
        LIMIT ${MAX_WORKERS + 1}
        FOR SHARE OF profile, membership, account`,
      [input.organizationId]
    );
    if (roster.rows.length > MAX_WORKERS) {
      await client.query('COMMIT');
      return unavailable('workforce_evidence_bounded');
    }
    const candidate = { members: roster.rows.map(row => ({ profileId: row.profile_id })) };
    await scheduling.attachSkillsAndAvailability(client, input.organizationId, candidate);
    if (candidate.skillEvidenceTruncated || candidate.availabilityEvidenceTruncated) {
      await client.query('COMMIT');
      return unavailable('workforce_evidence_bounded');
    }
    // Read the M22-owned skill associations in the same MVCC snapshot. A skill
    // assignment describes company records; it does not prove certification
    // or job-specific qualification.
    const skillRecords = await client.query(
      `SELECT relation.profile_id, skill.id AS skill_id, skill.skill_key,
              skill.service_id, relation.created_at AS assigned_at,
              skill.updated_at AS skill_updated_at
         FROM public.workforce_profile_skills relation
         JOIN public.workforce_skills skill
           ON skill.organization_id = relation.organization_id
          AND skill.id = relation.skill_id
        WHERE relation.organization_id = $1
          AND relation.profile_id = ANY($2::uuid[])
        ORDER BY relation.profile_id, skill.id
        LIMIT ${scheduling.MAXIMUM_CANDIDATE_SKILLS + 1}`,
      [input.organizationId, roster.rows.map(row => row.profile_id)]
    );
    if (skillRecords.rows.length > scheduling.MAXIMUM_CANDIDATE_SKILLS) {
      await client.query('COMMIT');
      return unavailable('workforce_evidence_bounded');
    }
    const skillsByProfile = new Map();
    for (const row of skillRecords.rows) {
      if (!skillsByProfile.has(row.profile_id)) skillsByProfile.set(row.profile_id, []);
      skillsByProfile.get(row.profile_id).push({
        skillId: row.skill_id, skillKey: row.skill_key,
        serviceId: row.service_id,
        assignedAt: new Date(row.assigned_at).toISOString(),
        skillUpdatedAt: new Date(row.skill_updated_at).toISOString(),
      });
    }
    const members = roster.rows.map((row, index) => {
      const attached = candidate.members[index];
      const availability = attached.availability;
      return {
        profileId: row.profile_id,
        operationalRole: row.operational_role,
        homeLocationId: row.home_location_id,
        profileUpdatedAt: new Date(row.profile_updated_at).toISOString(),
        membershipUpdatedAt: new Date(row.membership_updated_at).toISOString(),
        serviceIds: attached.serviceIds,
        assignedSkills: skillsByProfile.get(row.profile_id) || [],
        availability,
      };
    });
    if (members.some(member => !member.availability ||
        member.availability.coverageStart > input.horizon.startsAt ||
        member.availability.coverageEnd < input.horizon.endsAt ||
        microsecondKey(member.availability.updatedAt) > observedAt)) {
      await client.query('COMMIT');
      return unavailable('declared_availability_incomplete');
    }
    const schedules = await scheduling.scheduleEvidence(client, {
      organizationId: input.organizationId,
      assignmentId: null,
      proposal: { scheduledStart: input.horizon.startsAt,
        scheduledEnd: input.horizon.endsAt },
    }, 0);
    if (schedules.truncated) {
      await client.query('COMMIT');
      return unavailable('schedule_evidence_bounded');
    }
    const activeWorkers = new Set(members.map(member => member.profileId));
    if (schedules.rows.some(schedule => schedule.approved !== true ||
        !Array.isArray(schedule.profileIds) || schedule.profileIds.length === 0 ||
        schedule.profileIds.some(profileId => !activeWorkers.has(profileId)))) {
      await client.query('COMMIT');
      return unavailable('schedule_commitment_unresolved');
    }
    const basis = deepFreeze(stableValue({
      organizationId: input.organizationId, observedAt, snapshotId, horizon: input.horizon,
      businessProfile: { id: profile.id, version: profile.version, digest: profile.hash,
        timeZone: profile.timeZone, hours: profile.rawProfile.hours },
      members,
      approvedScheduledAssignments: schedules.rows,
    }));
    await client.query('COMMIT');
    return Object.freeze({ state: 'source_snapshot', sourceSnapshotDigest: sha256(basis),
      basis, sourceAuthenticated: true, temporalCutoffVerified: false,
      roleQualificationVerified: false,
      assignedSkillRecordsRead: true,
      approvedScheduleIntervalsRead: true, commitmentsCovered: false,
      resourceConstraintsChecked: false,
      forecastIssued: false });
  } catch (cause) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (cause && cause.status) throw cause;
    throw error('CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.', 503);
  } finally {
    if (client) client.release();
  }
}

module.exports = { MAX_WORKERS, readDeclaredAvailabilitySnapshot };
