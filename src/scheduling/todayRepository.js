'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');

const MAXIMUM_TODAY_RECORDS = 100;
const MAXIMUM_TEAMMATES = 50;
const MAXIMUM_RESPONSE_BYTES = 131072;
const MAXIMUM_INSTRUCTION_BYTES = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function typed(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  return error;
}

function validateInput(pool, input) {
  if (!pool || typeof pool.connect !== 'function' || !input ||
      !UUID.test(String(input.organizationId || '')) || !UUID.test(String(input.actorUserId || '')) ||
      !UUID.test(String(input.membershipId || '')) || !UUID.test(String(input.authSessionId || '')) ||
      !['owner', 'admin', 'member', 'viewer'].includes(input.actorAccessRole)) {
    throw typed('The signed-in Today authority is unavailable.', 'M22_TODAY_AUTHORITY_UNAVAILABLE', 503);
  }
}

function plainText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const result = String(value);
  return result || fallback;
}

function boundedText(value, maximumBytes = MAXIMUM_INSTRUCTION_BYTES) {
  const original = plainText(value);
  if (Buffer.byteLength(original, 'utf8') <= maximumBytes) return { text: original, truncated: false };
  let lower = 0;
  let upper = original.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (Buffer.byteLength(original.slice(0, middle), 'utf8') <= maximumBytes) lower = middle;
    else upper = middle - 1;
  }
  return { text: original.slice(0, lower), truncated: true };
}

function stringList(value, maximum = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).map(reason => {
    if (typeof reason === 'string') return plainText(reason).slice(0, 120);
    return reason && typeof reason.code === 'string' ? plainText(reason.code).slice(0, 120) : 'needs_review';
  });
}

function iso(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw typed(
    'Current Today schedule time is invalid.', 'M22_TODAY_SCHEDULE_INVALID', 503
  );
  return date.toISOString();
}

function serviceLocation(row) {
  const fields = [
    ['street', row.address_street], ['line2', row.address_line2], ['city', row.address_city],
    ['state', row.address_state], ['postalCode', row.address_postal], ['country', row.address_country],
  ];
  const result = {};
  for (const [key, value] of fields) {
    const projected = plainText(value).trim();
    if (projected) result[key] = projected;
  }
  return result;
}

function currentApproval(row) {
  const human = Boolean(row.last_human_approval_id) && Number(row.human_applied_revision) === Number(row.revision) &&
    plainText(row.human_applied_digest).trim() === plainText(row.canonical_digest).trim();
  const legacy = Boolean(row.last_approval_id) && Number(row.legacy_applied_revision) === Number(row.revision) &&
    plainText(row.legacy_applied_digest).trim() === plainText(row.canonical_digest).trim();
  return { current: human || legacy };
}

function routeProjection(row) {
  const review = row.needs_review === true;
  return {
    providerNeutral: true,
    providerCalls: 0,
    status: review ? 'needs_review' : 'unavailable',
    evidenceDigest: null,
    travelDurationMinutes: null,
    distance: null,
    implications: ['No current durable route or travel evidence is available for this job.'],
    uncertainty: review ? ['Current scheduling authority needs review.', 'No live provider lookup was performed.']
      : ['No live provider lookup was performed.'],
  };
}

function rowProjection(row, timeZone) {
  const approval = currentApproval(row);
  const instructions = boundedText(row.instructions);
  const teammates = (Array.isArray(row.teammates) ? row.teammates : []).slice(0, MAXIMUM_TEAMMATES).map(member => ({
    name: plainText(member && member.name, 'Teammate'),
    role: member && member.crewRole === 'lead' ? 'lead' : 'member',
    self: member && member.profileId === row.actor_profile_id,
  }));
  const teammateTotal = Number(row.teammate_total || 0);
  const direct = row.workforce_profile_id === row.actor_profile_id;
  const assignmentKind = direct ? 'worker' : 'crew';
  return stableValue({
    appointmentId: row.appointment_id,
    title: plainText(row.job_title, plainText(row.service_type, 'Service appointment')),
    serviceType: plainText(row.service_type) || null,
    appointmentStatus: plainText(row.appointment_status),
    schedule: {
      state: plainText(row.schedule_state),
      start: iso(row.scheduled_start),
      end: iso(row.scheduled_end),
      timeZone,
      spansDayBoundary: row.spans_day_boundary === true,
    },
    assignment: {
      kind: assignmentKind,
      label: direct ? plainText(row.actor_name, 'You') : plainText(row.crew_name, 'Current crew'),
      direct,
      currentCrew: !direct,
    },
    dispatch: { state: plainText(row.dispatch_state) },
    review: { needsReview: row.needs_review === true, reasons: stringList(row.review_reasons) },
    route: routeProjection(row),
    instructions: {
      status: instructions.text ? 'available' : 'unavailable',
      text: instructions.text || null,
      truncated: instructions.truncated,
    },
    customer: {
      name: plainText(row.customer_name, 'Customer'),
      phone: plainText(row.customer_phone) || null,
      serviceLocation: serviceLocation(row),
    },
    crew: direct ? null : {
      name: plainText(row.crew_name, 'Current crew'),
      teammates,
      shown: teammates.length,
      total: teammateTotal,
      truncated: teammateTotal > teammates.length,
    },
    authority: {
      revision: Number(row.revision),
      digest: plainText(row.canonical_digest).trim(),
      approvedCurrent: approval.current,
    },
  });
}

async function currentAuthority(client, input) {
  const result = await client.query(
    `SELECT membership.id AS membership_id,membership.role AS access_role,membership.status AS membership_status,
            account.id AS user_id,account.name AS actor_name,account.status AS user_status,
            profile.id AS profile_id,profile.operational_role,
            session.id AS session_id,session.user_id AS session_user_id,
            session.organization_id AS session_organization_id,session.membership_id AS session_membership_id,
            session.status AS session_status,session.access_expires_at,
            active_profile.raw_profile #>> '{company,timeZone}' AS time_zone,
            transaction_timestamp() AS evaluated_at
       FROM public.organization_memberships membership
       JOIN public.users account
         ON account.organization_id=membership.organization_id AND account.id=membership.user_id
       LEFT JOIN public.workforce_profiles profile
         ON profile.organization_id=membership.organization_id AND profile.membership_id=membership.id
       LEFT JOIN public.auth_sessions session ON session.id=$4::uuid
       LEFT JOIN LATERAL (
         SELECT profile_authority.raw_profile
           FROM public.canonical_business_profiles profile_authority
          WHERE profile_authority.organization_id=membership.organization_id AND profile_authority.is_active=TRUE
          ORDER BY profile_authority.version_number DESC,profile_authority.id
          LIMIT 1
       ) active_profile ON TRUE
      WHERE membership.organization_id=$1::uuid AND membership.user_id=$2::uuid AND membership.id=$3::uuid`,
    [input.organizationId, input.actorUserId, input.membershipId, input.authSessionId]
  );
  if (result.rowCount !== 1) throw typed(
    'The signed-in workforce membership is no longer current.', 'M22_TODAY_WORKFORCE_RESTRICTED', 403
  );
  const row = result.rows[0];
  const currentSession = row.session_id === input.authSessionId && row.session_user_id === input.actorUserId &&
    row.session_organization_id === input.organizationId && row.session_membership_id === row.membership_id &&
    row.session_status === 'active' && row.access_expires_at &&
    new Date(row.access_expires_at).getTime() > new Date(row.evaluated_at).getTime();
  if (!currentSession) throw typed(
    'The signed-in Today session is no longer current.', 'M22_TODAY_SESSION_NOT_CURRENT', 401
  );
  if (row.membership_status !== 'active' || row.user_status !== 'active' || !row.profile_id ||
      !row.operational_role || row.access_role !== input.actorAccessRole || !row.time_zone) {
    throw typed('Today is limited to a current active workforce identity.', 'M22_TODAY_WORKFORCE_RESTRICTED', 403);
  }
  return row;
}

async function todayRows(client, input, authority) {
  return client.query(
    `WITH authority AS (
       SELECT $1::uuid AS organization_id,$2::uuid AS profile_id,$3::text AS time_zone
     ), bounds AS (
       SELECT to_char((transaction_timestamp() AT TIME ZONE authority.time_zone)::date,'YYYY-MM-DD') AS local_day,
              ((transaction_timestamp() AT TIME ZONE authority.time_zone)::date::timestamp AT TIME ZONE authority.time_zone) AS day_start,
              (((transaction_timestamp() AT TIME ZONE authority.time_zone)::date + 1)::timestamp AT TIME ZONE authority.time_zone) AS day_end
         FROM authority
     )
     SELECT assignment.appointment_id,assignment.workforce_profile_id,assignment.workforce_crew_id,
            assignment.schedule_state,assignment.dispatch_state,assignment.scheduled_start,assignment.scheduled_end,
            assignment.appointment_status,assignment.needs_review,assignment.review_reasons,
            assignment.revision,assignment.canonical_digest,assignment.last_approval_id,assignment.last_human_approval_id,
            opportunity.service_type,
            COALESCE(
              CASE WHEN jsonb_typeof(opportunity.job_scope->'jobTitle')='string' THEN left(opportunity.job_scope->>'jobTitle',240) END,
              CASE WHEN jsonb_typeof(opportunity.job_scope->'title')='string' THEN left(opportunity.job_scope->>'title',240) END,
              opportunity.service_type,'Service appointment') AS job_title,
            COALESCE(
              CASE WHEN jsonb_typeof(opportunity.job_scope->'operationalInstructions')='string' THEN left(opportunity.job_scope->>'operationalInstructions',4100) END,
              CASE WHEN jsonb_typeof(opportunity.job_scope->'instructions')='string' THEN left(opportunity.job_scope->>'instructions',4100) END,
              CASE WHEN jsonb_typeof(opportunity.job_scope->'workDescription')='string' THEN left(opportunity.job_scope->>'workDescription',4100) END,
              CASE WHEN jsonb_typeof(opportunity.job_scope->'description')='string' THEN left(opportunity.job_scope->>'description',4100) END) AS instructions,
            customer.name AS customer_name,customer.phone AS customer_phone,
            CASE WHEN jsonb_typeof(customer.address)='object' THEN left(COALESCE(customer.address->>'street',customer.address->>'address1',customer.address->>'line1'),240) END AS address_street,
            CASE WHEN jsonb_typeof(customer.address)='object' THEN left(COALESCE(customer.address->>'line2',customer.address->>'address2'),240) END AS address_line2,
            CASE WHEN jsonb_typeof(customer.address)='object' THEN left(customer.address->>'city',120) END AS address_city,
            CASE WHEN jsonb_typeof(customer.address)='object' THEN left(customer.address->>'state',120) END AS address_state,
            CASE WHEN jsonb_typeof(customer.address)='object' THEN left(COALESCE(customer.address->>'postalCode',customer.address->>'postal_code',customer.address->>'zip'),32) END AS address_postal,
            CASE WHEN jsonb_typeof(customer.address)='object' THEN left(customer.address->>'country',120) END AS address_country,
            assigned_user.name AS actor_name,crew.name AS crew_name,
            COALESCE(teammate_context.members,'[]'::jsonb) AS teammates,
            COALESCE(teammate_context.total_count,0)::int AS teammate_total,
            human_approval.applied_revision AS human_applied_revision,
            human_approval.applied_digest AS human_applied_digest,
            legacy_approval.applied_revision AS legacy_applied_revision,
            legacy_approval.applied_digest AS legacy_applied_digest,
            (assignment.scheduled_start AT TIME ZONE authority.time_zone)::date <>
              (assignment.scheduled_end AT TIME ZONE authority.time_zone)::date AS spans_day_boundary,
            bounds.local_day,bounds.day_start,bounds.day_end
       FROM authority CROSS JOIN bounds
       JOIN public.canonical_schedule_assignments assignment
         ON assignment.organization_id=authority.organization_id
       JOIN public.canonical_appointments appointment
         ON appointment.organization_id=assignment.organization_id AND appointment.id=assignment.appointment_id
       JOIN public.canonical_opportunities opportunity
         ON opportunity.organization_id=assignment.organization_id AND opportunity.id=assignment.opportunity_id
       JOIN public.canonical_customers customer
         ON customer.organization_id=opportunity.organization_id AND customer.id=opportunity.customer_id
       LEFT JOIN public.workforce_crews crew
         ON crew.organization_id=assignment.organization_id AND crew.id=assignment.workforce_crew_id
       LEFT JOIN public.organization_memberships assigned_membership
         ON assigned_membership.organization_id=assignment.organization_id AND assigned_membership.id=authority.profile_id
       LEFT JOIN public.users assigned_user
         ON assigned_user.organization_id=assigned_membership.organization_id AND assigned_user.id=assigned_membership.user_id
       LEFT JOIN public.canonical_schedule_human_approvals human_approval
         ON human_approval.organization_id=assignment.organization_id AND human_approval.id=assignment.last_human_approval_id
       LEFT JOIN public.canonical_schedule_approvals legacy_approval
         ON legacy_approval.organization_id=assignment.organization_id AND legacy_approval.id=assignment.last_approval_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('profileId',team_row.profile_id,'name',team_row.name,'crewRole',team_row.crew_role)
                  ORDER BY team_row.name COLLATE "C",team_row.profile_id) AS members,
                max(team_row.total_count)::int AS total_count
           FROM (
             SELECT crew_profile.id AS profile_id,crew_account.name,crew_relation.crew_role,
                    count(*) OVER() AS total_count
               FROM public.workforce_crew_members crew_relation
               JOIN public.workforce_profiles crew_profile
                 ON crew_profile.organization_id=crew_relation.organization_id AND crew_profile.id=crew_relation.profile_id
               JOIN public.organization_memberships crew_membership
                 ON crew_membership.organization_id=crew_profile.organization_id AND crew_membership.id=crew_profile.membership_id
                AND crew_membership.status='active'
               JOIN public.users crew_account
                 ON crew_account.organization_id=crew_membership.organization_id AND crew_account.id=crew_membership.user_id
                AND crew_account.status='active'
              WHERE crew_relation.organization_id=assignment.organization_id
                AND crew_relation.crew_id=assignment.workforce_crew_id
              ORDER BY crew_account.name COLLATE "C",crew_profile.id
              LIMIT 51
           ) team_row
       ) teammate_context ON TRUE
      WHERE assignment.target_state='assigned' AND assignment.schedule_state='scheduled'
        AND assignment.scheduled_start < bounds.day_end AND assignment.scheduled_end > bounds.day_start
        AND assignment.appointment_status<>'cancelled'
        AND EXISTS (
          SELECT 1 FROM public.canonical_transcripts transcript
           WHERE transcript.organization_id=assignment.organization_id
             AND transcript.operation_id=assignment.operation_id
             AND transcript.source NOT IN ('simulation','demo')
        )
        AND (assignment.workforce_profile_id=authority.profile_id OR EXISTS (
          SELECT 1 FROM public.workforce_crew_members current_crew
           WHERE current_crew.organization_id=assignment.organization_id
             AND current_crew.crew_id=assignment.workforce_crew_id
             AND current_crew.profile_id=authority.profile_id
        ))
      ORDER BY assignment.scheduled_start,assignment.scheduled_end,assignment.appointment_id
      LIMIT 101`,
    [input.organizationId, authority.profile_id, authority.time_zone]
  );
}

async function loadToday(pool, input) {
  validateInput(pool, input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const authority = await currentAuthority(client, input);
    const selected = await todayRows(client, input, authority);
    if (selected.rows.length > MAXIMUM_TODAY_RECORDS) throw typed(
      'Today exceeds the bounded 100-record read limit.', 'M22_TODAY_RESOURCE_BOUND', 503
    );
    if (selected.rows.some(row => !currentApproval(row).current)) throw typed(
      'Today encountered work without a current approved scheduling record.', 'M22_TODAY_APPROVAL_UNAVAILABLE', 503
    );
    const first = selected.rows[0];
    const records = selected.rows.map(row => rowProjection({ ...row, actor_profile_id: authority.profile_id }, authority.time_zone));
    const data = stableValue({
      version: 'm22-part6-today-v1',
      readOnly: true,
      mutationCapabilities: [],
      evaluatedAt: iso(authority.evaluated_at),
      identity: {
        displayName: plainText(authority.actor_name, 'Workforce member'),
        operationalRole: plainText(authority.operational_role),
      },
      day: {
        date: first ? String(first.local_day).slice(0, 10) : null,
        start: first ? iso(first.day_start) : null,
        end: first ? iso(first.day_end) : null,
        timeZone: authority.time_zone,
      },
      count: records.length,
      shown: records.length,
      total: records.length,
      truncated: false,
      records,
    });
    // An empty day still requires canonical tenant-day bounds. Query only the
    // bounded authority CTE again inside the same snapshot; no browser clock is used.
    if (!first) {
      const bounds = await client.query(
        `WITH authority AS (SELECT $1::text AS time_zone)
         SELECT to_char((transaction_timestamp() AT TIME ZONE authority.time_zone)::date,'YYYY-MM-DD') AS local_day,
                ((transaction_timestamp() AT TIME ZONE authority.time_zone)::date::timestamp AT TIME ZONE authority.time_zone) AS day_start,
                (((transaction_timestamp() AT TIME ZONE authority.time_zone)::date+1)::timestamp AT TIME ZONE authority.time_zone) AS day_end
           FROM authority`, [authority.time_zone]
      );
      data.day.date = String(bounds.rows[0].local_day).slice(0, 10);
      data.day.start = iso(bounds.rows[0].day_start);
      data.day.end = iso(bounds.rows[0].day_end);
    }
    data.digest = sha256(stableValue(data));
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAXIMUM_RESPONSE_BYTES) throw typed(
      'Today exceeds the bounded response size.', 'M22_TODAY_RESPONSE_BOUND', 503
    );
    await client.query('COMMIT');
    return Object.freeze(data);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error && ['40001', '40P01', '55P03', '57014'].includes(error.code)) {
      throw typed('Today changed while it was being read. Reload to retry.', 'M22_TODAY_STALE_RETRY', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MAXIMUM_TODAY_RECORDS,
  MAXIMUM_TEAMMATES,
  MAXIMUM_RESPONSE_BYTES,
  loadToday,
  rowProjection,
};
