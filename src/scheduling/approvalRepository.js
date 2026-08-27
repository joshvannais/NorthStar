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

async function createPreviewInTransaction(client, input) {
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
    try {
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
      client.release();
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
      evidence.conflict.data.digest, evidence.recommendationAuthorityDigest,
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
    try {
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
      client.release();
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
