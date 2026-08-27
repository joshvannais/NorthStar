'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { evaluateInTransaction } = require('./conflictRepository');

const DUE_HORIZON_MILLISECONDS = 24 * 60 * 60 * 1000;
const AT_RISK_HORIZON_MILLISECONDS = 48 * 60 * 60 * 1000;
const MAXIMUM_OVERVIEW_RECORDS = 100;

function forbidden() {
  const error = new Error('Current owner or dispatcher scheduling authority is unavailable.');
  error.code = 'M22_OVERVIEW_FORBIDDEN';
  error.status = 403;
  error.statusCode = 403;
  throw error;
}

async function requireOverviewActor(client, input) {
  const result = await client.query(
    `SELECT membership.role,profile.operational_role
       FROM public.organization_memberships membership
       JOIN public.workforce_profiles profile
         ON profile.organization_id=membership.organization_id AND profile.membership_id=membership.id
       JOIN public.users account
         ON account.organization_id=membership.organization_id AND account.id=membership.user_id
       JOIN public.auth_sessions session
         ON session.organization_id=membership.organization_id AND session.membership_id=membership.id
        AND session.user_id=membership.user_id AND session.id=$3
       JOIN public.subscriptions subscription ON subscription.organization_id=membership.organization_id
       JOIN public.organization_onboarding onboarding ON onboarding.organization_id=membership.organization_id
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND membership.status='active' AND account.status='active'
        AND session.status='active' AND session.access_expires_at>clock_timestamp()
        AND onboarding.status='complete'
        AND (subscription.status='active' OR (
          subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
          AND subscription.trial_ends_at>clock_timestamp()
          AND subscription.trial_ends_at-subscription.trial_started_at=INTERVAL '14 days'
        ))
      FOR SHARE OF membership,profile,account,session,subscription,onboarding`,
    [input.organizationId, input.actorUserId, input.authSessionId]
  );
  const actor = result.rowCount === 1 ? result.rows[0] : null;
  const roleAllowed = actor && (actor.role === 'owner' || actor.role === 'admin' ||
    (actor.role === 'member' && actor.operational_role === 'dispatcher'));
  if (!actor || actor.role !== input.actorAccessRole || !roleAllowed) forbidden();
}

function instant(value) {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function currentTarget(authority) {
  if (authority.targetState === 'unassigned') return { kind: 'unassigned', id: null };
  if (authority.workforceProfileId) return { kind: 'profile', id: authority.workforceProfileId };
  return { kind: 'crew', id: authority.workforceCrewId };
}

function allowedActions(authority) {
  const actions = [];
  const assigned = authority.targetState !== 'unassigned';
  const scheduled = authority.scheduleState === 'scheduled';
  if (!assigned) actions.push('assign');
  if (assigned) actions.push('reassign', 'unassign');
  if (!scheduled) actions.push('schedule');
  if (scheduled) actions.push('reschedule');
  if (assigned && scheduled && authority.dispatchState !== 'dispatched' &&
      !['cancelled', 'completed'].includes(authority.appointmentStatus)) actions.push('dispatch');
  return actions;
}

function unscheduledConflict(item) {
  const authority = item.appointment.scheduleAuthority;
  return {
    status: 'needs_review', hardConflicts: [], warnings: [], needsReview: true,
    reviewReasons: [{ code: 'appointment_schedule_unavailable' }],
    assignmentRevision: authority.revision, assignmentDigest: authority.digest,
    persisted: false, grantsMutation: false,
  };
}

function classifyRecord(item, conflict, now) {
  const authority = item.appointment.scheduleAuthority;
  const nowMs = new Date(now).getTime();
  const start = instant(authority.scheduledStart);
  const end = instant(authority.scheduledEnd);
  const startMs = start === null ? null : new Date(start).getTime();
  const endMs = end === null ? null : new Date(end).getTime();
  const cancelled = authority.appointmentStatus === 'cancelled';
  const unassigned = authority.targetState === 'unassigned';
  const overdue = !cancelled && endMs !== null && endMs < nowMs;
  const due = !cancelled && startMs !== null && startMs >= nowMs && startMs <= nowMs + DUE_HORIZON_MILLISECONDS;
  const conflicting = Array.isArray(conflict.hardConflicts) && conflict.hardConflicts.length > 0;
  const nearingWithoutDispatch = !cancelled && startMs !== null && startMs >= nowMs &&
    startMs <= nowMs + AT_RISK_HORIZON_MILLISECONDS && authority.dispatchState !== 'dispatched';
  const atRisk = !cancelled && (unassigned || authority.needsReview === true || conflict.needsReview === true ||
    conflicting || (Array.isArray(conflict.warnings) && conflict.warnings.length > 0) ||
    authority.dispatchState === 'revoked' || nearingWithoutDispatch);
  return { unassigned, due, overdue, atRisk, conflicting };
}

function recordProjection(item, conflict, now) {
  const authority = item.appointment.scheduleAuthority;
  const flags = classifyRecord(item, conflict, now);
  return stableValue({
    appointmentId: item.ids.appointment,
    graphId: item.ids.graph,
    customer: { id: item.customer.id, name: item.customer.name },
    work: {
      serviceType: item.opportunity.serviceType,
      title: item.snapshot && item.snapshot.service && item.snapshot.service.label || item.opportunity.serviceType || 'Appointment',
      appointmentStatus: authority.appointmentStatus,
    },
    authority,
    conflict: {
      status: conflict.status,
      hardConflicts: conflict.hardConflicts || [],
      warnings: conflict.warnings || [],
      needsReview: conflict.needsReview === true,
      reviewReasons: conflict.reviewReasons || [],
      digest: conflict.digest || null,
      evaluatedAt: conflict.evaluatedAt || now,
      persisted: false,
      grantsMutation: false,
    },
    flags,
    allowedActions: allowedActions(authority),
  });
}

function categoryProjection(records) {
  const categories = {};
  for (const name of ['unassigned', 'due', 'overdue', 'atRisk', 'conflicting']) {
    categories[name] = records.filter(record => record.flags[name]).map(record => record.appointmentId);
  }
  return categories;
}

async function evaluateOverview(client, input) {
  await requireOverviewActor(client, input);
  const clock = await client.query(
    `SELECT clock_timestamp() AS now,
            profile.raw_profile #>> '{company,timeZone}' AS time_zone
       FROM public.canonical_business_profiles profile
      WHERE profile.organization_id=$1 AND profile.is_active=TRUE
      ORDER BY profile.version_number DESC,profile.id`,
    [input.organizationId]
  );
  if (clock.rowCount !== 1) throw new Error('Current scheduling time authority is unavailable.');
  const now = new Date(clock.rows[0].now).toISOString();
  const timeZone = clock.rows[0].time_zone;
  const items = input.items.slice(0, MAXIMUM_OVERVIEW_RECORDS);
  const records = [];
  for (const item of items) {
    const authority = item && item.appointment && item.appointment.scheduleAuthority;
    if (!authority) throw new Error('Canonical scheduling authority is unavailable.');
    let conflict = unscheduledConflict(item);
    if (authority.scheduleState === 'scheduled') {
      const evaluated = await evaluateInTransaction(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorAccessRole: input.actorAccessRole,
        authSessionId: input.authSessionId,
        explicitSession: null,
        appointmentId: item.ids.appointment,
        expectedRevision: authority.revision,
        expectedDigest: authority.digest,
        expectedTimeZone: timeZone,
        proposal: {
          target: currentTarget(authority),
          scheduledStart: instant(authority.scheduledStart),
          scheduledEnd: instant(authority.scheduledEnd),
          submittedScheduledStart: instant(authority.scheduledStart),
          submittedScheduledEnd: instant(authority.scheduledEnd),
          timeZone,
          appointmentStatus: authority.appointmentStatus,
        },
      });
      conflict = evaluated.data;
    }
    records.push(recordProjection(item, conflict, now));
  }
  const categories = categoryProjection(records);
  const overview = {
    version: 'm22-part5-overview-v1',
    evaluatedAt: now,
    timeZone,
    truncated: input.items.length > MAXIMUM_OVERVIEW_RECORDS,
    definitions: {
      unassigned: 'Current canonical assignment target is unassigned.',
      due: 'Scheduled start is within the next 24 hours in current PostgreSQL time authority.',
      overdue: 'Scheduled end is before current PostgreSQL time; appointment completed remains compatibility metadata and is not field-completion evidence.',
      atRisk: 'Current work is unassigned, needs review, has warnings or conflicts, has revoked dispatch, or begins within 48 hours without current dispatch.',
      conflicting: 'Current Part 2 evaluation contains at least one hard conflict; no override is available.',
    },
    categories,
    counts: Object.keys(categories).reduce((value, key) => ({ ...value, [key]: categories[key].length }), {}),
    records,
  };
  return Object.freeze({ ...overview, digest: sha256(stableValue(overview)) });
}

async function buildSchedulingOverview(pool, input) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Canonical PostgreSQL persistence is unavailable.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      // The Part 2 evaluator acquires shared row locks while proving current
      // actor, tenant, assignment, and policy authority. This transaction is
      // intentionally mutation-free, but PostgreSQL forbids FOR SHARE inside
      // an explicitly READ ONLY transaction.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL statement_timeout='15000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const overview = await evaluateOverview(client, input);
      await client.query('COMMIT');
      return overview;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (error && ['40001', '40P01'].includes(error.code) && attempt < 2) continue;
      throw error;
    } finally {
      client.release();
    }
  }
  throw new Error('Scheduling overview changed during evaluation.');
}

module.exports = {
  AT_RISK_HORIZON_MILLISECONDS,
  DUE_HORIZON_MILLISECONDS,
  MAXIMUM_OVERVIEW_RECORDS,
  allowedActions,
  buildSchedulingOverview,
  classifyRecord,
};
