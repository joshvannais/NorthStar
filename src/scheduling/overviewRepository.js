'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { evaluateInTransaction } = require('./conflictRepository');
const { scheduleAuthority } = require('./repository');
const { validateGraphCursor } = require('./graphCursor');

const DUE_HORIZON_MILLISECONDS = 24 * 60 * 60 * 1000;
const AT_RISK_HORIZON_MILLISECONDS = 48 * 60 * 60 * 1000;
const MAXIMUM_OVERVIEW_RECORDS = 100;
const MAXIMUM_OVERVIEW_SCAN_RECORDS = 1000;

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
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND membership.status='active' AND account.status='active'
        AND session.status='active' AND session.access_expires_at>clock_timestamp()
      FOR SHARE OF membership,profile,account,session`,
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
      opportunityId: item.ids.opportunity,
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

async function refreshItemAuthority(client, input, item) {
  const appointmentId = item && item.ids && item.ids.appointment;
  if (!appointmentId) throw new Error('Canonical scheduling authority is unavailable.');
  const result = await client.query(
    `SELECT assignment.id AS assignment_id, assignment.appointment_id,
            assignment.operation_id, assignment.graph_id, assignment.opportunity_id,
            assignment.target_state, assignment.workforce_profile_id,
            assignment.workforce_crew_id, assignment.schedule_state,
            assignment.dispatch_state, assignment.scheduled_start,
            assignment.scheduled_end, assignment.appointment_status,
            assignment.needs_review, assignment.review_reasons, assignment.revision,
            assignment.canonical_digest, assignment.last_action_code,
            assignment.last_reason, assignment.updated_at AS assignment_updated_at
       FROM public.canonical_schedule_assignments assignment
      WHERE assignment.organization_id=$1 AND assignment.appointment_id=$2
      FOR SHARE OF assignment`,
    [input.organizationId, appointmentId]
  );
  if (result.rowCount !== 1) throw new Error('Current canonical scheduling authority is unavailable.');
  const current = scheduleAuthority(result.rows[0]);
  if ((item.ids.operation && current.operationId !== item.ids.operation) ||
      (item.ids.graph && current.graphId !== item.ids.graph) ||
      (item.ids.opportunity && current.opportunityId !== item.ids.opportunity)) {
    throw new Error('Canonical graph and scheduling authority disagree.');
  }
  return {
    ...item,
    appointment: { ...item.appointment, scheduleAuthority: current },
  };
}

async function evaluateItem(client, input, item, timeZone, now) {
  const currentItem = await refreshItemAuthority(client, input, item);
  const authority = currentItem.appointment.scheduleAuthority;
  let conflict = unscheduledConflict(currentItem);
  if (authority.scheduleState === 'scheduled') {
    const evaluated = await evaluateInTransaction(client, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorAccessRole: input.actorAccessRole,
      authSessionId: input.authSessionId,
      explicitSession: null,
      readOnlyOperator: true,
      appointmentId: currentItem.ids.appointment,
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
  return recordProjection(currentItem, conflict, now);
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
  const allRecords = [];
  const recordByAppointment = new Map();
  let firstPage = null;
  if (typeof input.loadPage === 'function') {
    let scanCursor = null;
    do {
      const page = await input.loadPage(client, { cursor: scanCursor, limit: MAXIMUM_OVERVIEW_RECORDS });
      if (!page || !Array.isArray(page.items) || page.items.length > MAXIMUM_OVERVIEW_RECORDS) {
        throw new Error('Bounded canonical scheduling pagination is unavailable.');
      }
      if (scanCursor === null) firstPage = page;
      for (const item of page.items) {
        if (allRecords.length >= MAXIMUM_OVERVIEW_SCAN_RECORDS) {
          const error = new Error('The scheduling overview exceeds the bounded authoritative scan limit. Narrow the tenant data before retrying.');
          error.code = 'M22_OVERVIEW_RESOURCE_BOUND';
          error.status = 503;
          error.statusCode = 503;
          throw error;
        }
        const record = await evaluateItem(client, input, item, timeZone, now);
        allRecords.push(record);
        recordByAppointment.set(record.appointmentId, record);
      }
      scanCursor = page.nextCursor || null;
    } while (scanCursor);
  } else {
    const items = Array.isArray(input.items) ? input.items.slice(0, MAXIMUM_OVERVIEW_RECORDS) : [];
    firstPage = { items, cursor: null, nextCursor: null, pageSize: MAXIMUM_OVERVIEW_RECORDS, shown: items.length, hasMore: false };
    for (const item of items) {
      const record = await evaluateItem(client, input, item, timeZone, now);
      allRecords.push(record);
      recordByAppointment.set(record.appointmentId, record);
    }
  }
  const selectedPage = input.cursor && typeof input.loadPage === 'function'
    ? await input.loadPage(client, { cursor: input.cursor, limit: MAXIMUM_OVERVIEW_RECORDS })
    : firstPage;
  const records = (selectedPage && selectedPage.items || []).map(item => {
    const record = recordByAppointment.get(item.ids.appointment);
    if (!record) throw new Error('The requested scheduling page changed during authoritative evaluation.');
    return record;
  });
  const categories = categoryProjection(allRecords);
  const overview = {
    version: 'm22-part5-overview-v1',
    evaluatedAt: now,
    timeZone,
    total: allRecords.length,
    shown: records.length,
    truncated: allRecords.length > records.length,
    page: {
      size: MAXIMUM_OVERVIEW_RECORDS,
      cursor: selectedPage && selectedPage.cursor || null,
      nextCursor: selectedPage && selectedPage.nextCursor || null,
      hasPrevious: Boolean(selectedPage && selectedPage.cursor),
      hasNext: Boolean(selectedPage && selectedPage.nextCursor),
      shown: records.length,
      total: allRecords.length,
    },
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
  return Object.freeze({
    overview: Object.freeze({ ...overview, digest: sha256(stableValue(overview)) }),
    pageItems: Object.freeze((selectedPage && selectedPage.items || []).slice()),
  });
}

async function buildSchedulingOverviewPage(pool, input) {
  const requestedCursor = validateGraphCursor(input && input.cursor);
  const normalizedInput = { ...input, cursor: requestedCursor && requestedCursor.raw || null };
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
      await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const schedulingOperator = typeof normalizedInput.loadOperator === 'function'
        ? await normalizedInput.loadOperator(client) : null;
      const timeZoneAuthority = typeof normalizedInput.loadTimeZoneAuthority === 'function'
        ? await normalizedInput.loadTimeZoneAuthority(client) : null;
      const evaluated = await evaluateOverview(client, normalizedInput);
      await client.query('COMMIT');
      return Object.freeze({ ...evaluated, schedulingOperator, timeZoneAuthority });
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

async function buildSchedulingOverview(pool, input) {
  return (await buildSchedulingOverviewPage(pool, input)).overview;
}

module.exports = {
  AT_RISK_HORIZON_MILLISECONDS,
  DUE_HORIZON_MILLISECONDS,
  MAXIMUM_OVERVIEW_RECORDS,
  MAXIMUM_OVERVIEW_SCAN_RECORDS,
  allowedActions,
  buildSchedulingOverview,
  buildSchedulingOverviewPage,
  classifyRecord,
};
