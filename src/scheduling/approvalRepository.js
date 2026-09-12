'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { evaluateInTransaction } = require('./conflictRepository');
const { recommendInTransaction } = require('./recommendationRepository');

class ApprovalRepositoryError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'ApprovalRepositoryError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function fail(status, code, message, cause) {
  throw new ApprovalRepositoryError(status, code, message, cause);
}

function trimDigest(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mapDatabaseError(error) {
  if (error instanceof ApprovalRepositoryError) return error;
  if (error && ['ConflictRepositoryError', 'RecommendationRepositoryError'].includes(error.name)) {
    if (error.status === 403) {
      return new ApprovalRepositoryError(403, 'M22_APPROVAL_FORBIDDEN',
        'Current human approval authority is unavailable.', error);
    }
    if (error.status === 404) {
      return new ApprovalRepositoryError(404, 'NOT_FOUND', 'Appointment not found.', error);
    }
    if (error.status === 409) {
      return new ApprovalRepositoryError(409, 'M22_EVIDENCE_STALE',
        'Conflict or recommendation evidence changed; request a new preview.', error);
    }
    if (error.status === 400) {
      return new ApprovalRepositoryError(400, 'M22_APPROVAL_INVALID',
        'Human approval evidence is invalid.', error);
    }
  }
  const constraint = error && error.constraint;
  if (error && ['40001', '40P01'].includes(error.code)) {
    return new ApprovalRepositoryError(409, 'M22_APPROVAL_STALE',
      'Scheduling authority changed; request a new preview.', error);
  }
  if (error && error.code === '42501') {
    return new ApprovalRepositoryError(403, 'M22_APPROVAL_FORBIDDEN',
      'Current human approval authority is unavailable.' +
        (process.env.NODE_ENV === 'test' && constraint ? ` (${constraint})` : ''), error);
  }
  if (error && error.code === '23505') {
    return new ApprovalRepositoryError(409, 'M22_APPROVAL_REPLAYED',
      'The preview or Idempotency-Key was already used for another approval.', error);
  }
  if (error && error.code === '23514') {
    const codes = {
      canonical_schedule_part4_hard_conflict: ['M22_HARD_CONFLICT', 'Hard conflicts cannot be overridden.'],
      canonical_schedule_part4_preview_expired: ['M22_PREVIEW_EXPIRED', 'The 15-minute preview expired.'],
      canonical_schedule_part4_acknowledgement_divergent: ['M22_ACKNOWLEDGEMENT_DIVERGENT', 'The exact warning acknowledgement changed.'],
      canonical_schedule_part4_transition_invalid: ['M22_INVALID_TRANSITION', 'The requested assignment, schedule, or dispatch transition is invalid.'],
      canonical_schedule_part4_evidence_stale: ['M22_EVIDENCE_STALE', 'Conflict or recommendation evidence changed; request a new preview.'],
      canonical_schedule_part4_request_digest_divergent: ['M22_REQUEST_DIGEST_DIVERGENT', 'Human approval request provenance diverged from its canonical inputs.'],
      canonical_schedule_part4_acknowledgement_invalid: ['M22_ACKNOWLEDGEMENT_DIVERGENT', 'The exact warning acknowledgement is invalid.'],
    };
    const mapped = codes[constraint] || ['M22_APPROVAL_INVALID', 'Human approval evidence is invalid.'];
    return new ApprovalRepositoryError(409, mapped[0], mapped[1], error);
  }
  return new ApprovalRepositoryError(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE',
    'Canonical PostgreSQL persistence is unavailable.', error);
}

function recommendationAuthorityDigest(data) {
  const { evaluatedAt: _evaluatedAt, digest: _digest, ...authority } = data || {};
  return sha256(stableValue(authority));
}

function entryDigests(entries) {
  return Object.freeze((Array.isArray(entries) ? entries : []).map(entry => sha256(stableValue(entry))).sort());
}

async function lockMutationAuthority(client, organizationId) {
  const result = await client.query(
    'SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE',
    [organizationId]
  );
  if (result.rowCount !== 1) fail(404, 'NOT_FOUND', 'Scheduling authority not found.');
}

async function assignmentPins(client, input) {
  const result = await client.query(
    `SELECT assignment.id, assignment.revision, assignment.canonical_digest,
            assignment.target_state, assignment.workforce_profile_id, assignment.workforce_crew_id,
            assignment.schedule_state, assignment.dispatch_state,
            assignment.scheduled_start, assignment.scheduled_end, assignment.appointment_status
       FROM public.canonical_schedule_assignments assignment
       JOIN public.canonical_appointments appointment
         ON appointment.organization_id=assignment.organization_id AND appointment.id=assignment.appointment_id
       JOIN public.canonical_transcripts transcript
         ON transcript.organization_id=appointment.organization_id AND transcript.operation_id=appointment.operation_id
      WHERE assignment.organization_id=$1 AND assignment.appointment_id=$2
        AND transcript.source NOT IN ('simulation','demo')`,
    [input.organizationId, input.appointmentId]
  );
  if (result.rowCount !== 1) fail(404, 'NOT_FOUND', 'Appointment not found.');
  const row = result.rows[0];
  if (Number(row.revision) !== input.expectedRevision || trimDigest(row.canonical_digest) !== input.expectedDigest) {
    fail(409, 'M22_APPROVAL_STALE', 'Scheduling authority changed; request a new preview.');
  }
  return row;
}

function unscheduledEvaluation(input, assignment) {
  const result = Object.freeze({
    status: 'needs_review',
    hardConflicts: Object.freeze([]),
    warnings: Object.freeze([]),
    needsReview: true,
    reviewReasons: Object.freeze([{ code: 'appointment_schedule_unavailable' }]),
  });
  const digest = sha256(stableValue({
    assignmentId: assignment.id,
    assignmentRevision: Number(assignment.revision),
    assignmentDigest: trimDigest(assignment.canonical_digest),
    evaluationVersion: 'm22-conflict-v1',
    proposal: input.proposal,
    result,
  }));
  return {
    success: true,
    data: {
      id: digest,
      assignmentId: assignment.id,
      appointmentId: input.appointmentId,
      evaluationVersion: 'm22-conflict-v1',
      assignmentRevision: Number(assignment.revision),
      assignmentDigest: trimDigest(assignment.canonical_digest),
      proposal: input.proposal,
      ...result,
      digest,
      evaluatedAt: new Date().toISOString(),
      persisted: false,
      grantsMutation: false,
    },
  };
}

async function currentEvaluations(client, input, assignment) {
  const conflict = input.scheduledStart === null
    ? unscheduledEvaluation(input, assignment)
    : await evaluateInTransaction(client, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorAccessRole: input.actorAccessRole,
      authSessionId: input.authSessionId,
      appointmentId: input.appointmentId,
      expectedRevision: input.expectedRevision,
      expectedDigest: input.expectedDigest,
      expectedTimeZone: input.expectedTimeZone,
      proposal: input.proposal,
    });
  if (input.scheduledStart === null) {
    const equipment = require('./equipmentReadiness');
    const basis = await equipment.read(client, input);
    if (basis.notRecorded !== true) {
      const addition = equipment.extra(basis, input.proposal);
      const merged = equipment.merge(conflict.data, addition);
      const digest = sha256(stableValue({originalDigest: conflict.data.digest, equipmentDigest: addition.digest, hardConflicts: merged.hardConflicts, reviewReasons: merged.reviewReasons}));
      conflict.data = {...merged, id: digest, digest};
    }
  }
  const recommendation = await recommendInTransaction(client, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorAccessRole: input.actorAccessRole,
    authSessionId: input.authSessionId,
    appointmentId: input.appointmentId,
    expectedRevision: input.expectedRevision,
    expectedDigest: input.expectedDigest,
    expectedTimeZone: input.expectedTimeZone,
  });
  return {
    conflict,
    recommendation,
    recommendationAuthorityDigest: recommendationAuthorityDigest(recommendation.data),
  };
}

// Paused builds still check current actor, session and CSRF before reporting the pause.
// These are the actor rows/conditions from 035; the protected mutation helpers remain withheld.
async function enforceRecoveryPolicy(client,input) {
  if(require('./mutationPolicy').mutationsEnabled)return;
  const rows=await client.query(`SELECT m.role,m.status membership_status,p.operational_role,u.status account_status,
    s.status session_status,s.access_expires_at,s.csrf_token_hash,sub.status subscription_status,
    sub.trial_started_at,sub.trial_ends_at,o.status onboarding_status,b.raw_profile #>> '{company,timeZone}' time_zone
    FROM organization_memberships m JOIN workforce_profiles p ON p.organization_id=m.organization_id AND p.membership_id=m.id
    JOIN users u ON u.organization_id=m.organization_id AND u.id=m.user_id
    JOIN auth_sessions s ON s.organization_id=m.organization_id AND s.membership_id=m.id AND s.user_id=m.user_id AND s.id=$3
    JOIN subscriptions sub ON sub.organization_id=m.organization_id JOIN organization_onboarding o ON o.organization_id=m.organization_id
    JOIN canonical_business_profiles b ON b.organization_id=o.organization_id AND b.id=o.active_business_profile_id AND b.is_active=TRUE
    WHERE m.organization_id=$1 AND m.user_id=$2 FOR SHARE OF m,p,u,s,sub,o,b`,[input.organizationId,input.actorUserId,input.authSessionId]);
  const a=rows.rows[0],clock=(await client.query('SELECT clock_timestamp() now')).rows[0].now;
  const csrf=typeof input.csrfToken==='string'?input.csrfToken:'',csrfBytes=Buffer.byteLength(csrf),now=new Date(clock).getTime();
  const trial=a&&a.subscription_status==='trialing'&&a.trial_started_at&&a.trial_ends_at&&new Date(a.trial_ends_at).getTime()===new Date(a.trial_started_at).getTime()+14*86400000&&new Date(a.trial_ends_at).getTime()>now;
  if(rows.rowCount!==1||!a||a.membership_status!=='active'||a.account_status!=='active'||a.role!==input.actorAccessRole||
     !(['owner','admin'].includes(a.role)||a.role==='member'&&a.operational_role==='dispatcher')||a.session_status!=='active'||
     !a.access_expires_at||new Date(a.access_expires_at).getTime()<=now||csrfBytes<32||csrfBytes>512||require('node:crypto').createHash('sha256').update(csrf,'utf8').digest('hex')!==trimDigest(a.csrf_token_hash)||
     !(a.subscription_status==='active'||trial)||a.onboarding_status!=='complete')fail(403,'M22_APPROVAL_FORBIDDEN','Your current account cannot make this scheduling change.');
  fail(503,'M22_SCHEDULING_PAUSED','New scheduling changes are paused. Refresh to check the saved appointment and dispatch status.');
}

async function createPreviewInTransaction(client, input) {
  // Match the trusted database entry boundary's lock order before Part 2/3
  // reads. This avoids lock upgrades after the evaluators acquire row shares.
  await lockMutationAuthority(client, input.organizationId);
  await enforceRecoveryPolicy(client,input);
  const assignment = await assignmentPins(client, input);
  const evidence = await currentEvaluations(client, input, assignment);
  const warningDigests = entryDigests(evidence.conflict.data.warnings);
  const reviewReasonDigests = entryDigests(evidence.conflict.data.reviewReasons);
  const result = await client.query(
    `SELECT public.canonical_schedule_create_mutation_preview(
       $1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,
       $7::bigint,$8::text,$9::text,$10::text,$11::text,$12::uuid,
       $13::timestamptz,$14::timestamptz,$15::jsonb,$16::text,$17::text,
       $18::jsonb,$19::text,$20::jsonb,$21::jsonb,$22::text,$23::text,$24::text
     ) AS response`,
    [input.organizationId, input.appointmentId, input.actorUserId, input.actorAccessRole,
      input.authSessionId, input.csrfToken, input.expectedRevision, input.expectedDigest,
      input.expectedTimeZone, input.action, input.target.kind, input.target.id,
      input.scheduledStart, input.scheduledEnd, JSON.stringify({
        scheduledStart: input.rawScheduledStart, scheduledEnd: input.rawScheduledEnd,
      }), input.appointmentStatus, input.reason, JSON.stringify(evidence.conflict.data),
      evidence.conflict.data.digest, JSON.stringify(warningDigests), JSON.stringify(reviewReasonDigests),
      evidence.recommendation.data.digest, evidence.recommendationAuthorityDigest, input.requestDigest]
  );
  const body = result.rows[0].response;
  body.data.recommendation = evidence.recommendation.data;
  return { status: 201, body };
}

async function createMutationPreview(pool, input) {
  if (!pool || typeof pool.connect !== 'function') {
    fail(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    let sourceFence=false,discard=false;
    try {
      await client.query("SET lock_timeout='2000ms'");await client.query("SET statement_timeout='10000ms'");
      await client.query('SELECT pg_advisory_lock_shared(230004,4)');sourceFence=true;
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      await client.query("SET LOCAL statement_timeout='10000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const response = await createPreviewInTransaction(client, input);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the authoritative failure. */ }
      if (error && ['40001', '40P01'].includes(error.code) && attempt < 2) continue;
      throw mapDatabaseError(error);
    } finally {
      if(sourceFence)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});
      await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);
    }
  }
  fail(409, 'M22_APPROVAL_STALE', 'Scheduling authority changed; request a new preview.');
}

async function previewRecord(client, input) {
  const result = await client.query(
    `SELECT preview.*, assignment.revision AS current_revision,
            assignment.canonical_digest AS current_digest
       FROM public.canonical_schedule_mutation_previews preview
       JOIN public.canonical_schedule_assignments assignment
         ON assignment.organization_id=preview.organization_id AND assignment.id=preview.assignment_id
      WHERE preview.organization_id=$1 AND preview.appointment_id=$2 AND preview.id=$3
        AND preview.actor_user_id=$4 AND preview.auth_session_id=$5`,
    [input.organizationId, input.appointmentId, input.previewId, input.actorUserId, input.authSessionId]
  );
  if (result.rowCount !== 1) fail(404, 'NOT_FOUND', 'Mutation preview not found.');
  const row = result.rows[0];
  if (trimDigest(row.preview_digest) !== input.previewDigest || row.reason !== input.reason) {
    fail(409, 'M22_PREVIEW_DIVERGENT', 'Mutation preview evidence changed; request a new preview.');
  }
  return row;
}

function previewInput(input, row) {
  const submitted = row.submitted_schedule || {};
  const target = row.proposed_target_kind === 'unassigned'
    ? { kind: 'unassigned', id: null }
    : { kind: row.proposed_target_kind, id: row.proposed_target_id };
  return {
    ...input,
    expectedRevision: Number(row.expected_revision),
    expectedDigest: trimDigest(row.expected_digest),
    expectedTimeZone: row.expected_time_zone,
    scheduledStart: row.proposed_scheduled_start === null ? null : new Date(row.proposed_scheduled_start).toISOString(),
    scheduledEnd: row.proposed_scheduled_end === null ? null : new Date(row.proposed_scheduled_end).toISOString(),
    proposal: stableValue({
      target,
      scheduledStart: row.proposed_scheduled_start === null ? null : new Date(row.proposed_scheduled_start).toISOString(),
      scheduledEnd: row.proposed_scheduled_end === null ? null : new Date(row.proposed_scheduled_end).toISOString(),
      submittedScheduledStart: submitted.scheduledStart === undefined ? null : submitted.scheduledStart,
      submittedScheduledEnd: submitted.scheduledEnd === undefined ? null : submitted.scheduledEnd,
      timeZone: row.expected_time_zone,
      appointmentStatus: row.proposed_appointment_status,
    }),
  };
}

async function idempotencyReplay(client, input) {
  const result = await client.query(
    `SELECT request_digest,response_status,response_body
       FROM public.canonical_schedule_human_idempotency
      WHERE organization_id=$1 AND actor_user_id=$2 AND idempotency_key_hash=$3`,
    [input.organizationId, input.actorUserId, input.idempotencyKeyHash]
  );
  return result.rowCount !== 0;
}

async function applyApprovalInTransaction(client, input) {
  await lockMutationAuthority(client, input.organizationId);
  await enforceRecoveryPolicy(client,input);
  const replay = await idempotencyReplay(client, input);
  if (replay) {
    const replayResult = await client.query(
      `SELECT public.canonical_schedule_apply_mutation_approval(
         $1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,
         $7::uuid,$8::text,$9::jsonb,$10::jsonb,$11::text,
         $12::text,$13::text,$14::text,$15::text
       ) AS response`,
      [input.organizationId, input.appointmentId, input.actorUserId, input.actorAccessRole,
        input.authSessionId, input.csrfToken, input.previewId, input.previewDigest,
        JSON.stringify(input.acknowledgedWarningDigests),
        JSON.stringify(input.acknowledgedReviewReasonDigests), input.reason,
        '', '', input.idempotencyKeyHash, input.requestDigest]
    );
    return { status: 200, body: replayResult.rows[0].response, replayed: true };
  }
  const preview = await previewRecord(client, input);
  const current = previewInput(input, preview);
  const assignment = await assignmentPins(client, current);
  const evidence = await currentEvaluations(client, current, assignment);
  const result = await client.query(
    `SELECT public.canonical_schedule_apply_mutation_approval(
       $1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,
       $7::uuid,$8::text,$9::jsonb,$10::jsonb,$11::text,
       $12::text,$13::text,$14::text,$15::text
     ) AS response`,
    [input.organizationId, input.appointmentId, input.actorUserId, input.actorAccessRole,
      input.authSessionId, input.csrfToken, input.previewId, input.previewDigest,
      JSON.stringify(input.acknowledgedWarningDigests),
      JSON.stringify(input.acknowledgedReviewReasonDigests), input.reason,
      // PostgreSQL independently recomputes the complete locked Part 2/3
      // authority. These values identify the durable preview being rechecked;
      // the freshly evaluated JavaScript evidence above remains display and
      // fail-fast context, never mutation authority.
      trimDigest(preview.conflict_digest), trimDigest(preview.recommendation_authority_digest),
      input.idempotencyKeyHash, input.requestDigest]
  );
  return { status: 200, body: result.rows[0].response, replayed: false };
}

async function approveMutation(pool, input) {
  if (!pool || typeof pool.connect !== 'function') {
    fail(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    let sourceFence=false,discard=false;
    try {
      await client.query("SET lock_timeout='2000ms'");await client.query("SET statement_timeout='10000ms'");
      await client.query('SELECT pg_advisory_lock_shared(230004,4)');sourceFence=true;
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
      await client.query("SET LOCAL statement_timeout='10000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const response = await applyApprovalInTransaction(client, input);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the authoritative failure. */ }
      if (error && ['40001', '40P01'].includes(error.code) && attempt < 2) continue;
      throw mapDatabaseError(error);
    } finally {
      if(sourceFence)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});
      await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);
    }
  }
  fail(409, 'M22_APPROVAL_STALE', 'Scheduling authority changed; request a new preview.');
}

module.exports = {
  ApprovalRepositoryError,
  approveMutation,
  createMutationPreview,
  recommendationAuthorityDigest,
};
