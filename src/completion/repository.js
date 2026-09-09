'use strict';

class CompletionRepositoryError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'CompletionRepositoryError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.cause = cause;
  }
}

function mapped(cause) {
  if (cause instanceof CompletionRepositoryError) return cause;
  const constraint = String(cause && cause.constraint || '');
  if (cause && cause.code === 'P0002' || constraint === 'canonical_completion_not_found') {
    return new CompletionRepositoryError(404, 'NOT_FOUND', 'Completion authority was not found.', cause);
  }
  if (constraint === 'canonical_completion_idempotency_conflict') {
    return new CompletionRepositoryError(409, 'COMPLETION_IDEMPOTENCY_CONFLICT',
      'The Idempotency-Key was already used for another completion mutation.', cause);
  }
  if (constraint === 'canonical_completion_expired') {
    return new CompletionRepositoryError(409, 'COMPLETION_PROPOSAL_EXPIRED',
      'The completion proposal has expired and cannot be approved.', cause);
  }
  if (constraint === 'canonical_completion_gate_failed') {
    return new CompletionRepositoryError(409, 'COMPLETION_GATE_FAILED',
      'One or more required completion gates did not pass.', cause);
  }
  if (constraint === 'canonical_completion_transition_invalid') {
    return new CompletionRepositoryError(409, 'COMPLETION_TRANSITION_INVALID',
      'The requested completion transition is not valid from the current state.', cause);
  }
  if (constraint.includes('stale') || constraint.includes('changed') ||
      cause && ['40001', '40P01', '23505'].includes(cause.code)) {
    return new CompletionRepositoryError(409, 'COMPLETION_CONFLICT',
      'Completion authority changed; refresh before trying again.', cause);
  }
  if (cause && cause.code === '42501') {
    return new CompletionRepositoryError(403, 'COMPLETION_FORBIDDEN',
      'Current completion authority is unavailable.', cause);
  }
  if (cause && ['22023', '22P02', '22007', '22008'].includes(cause.code) ||
      constraint === 'canonical_completion_input_invalid') {
    return new CompletionRepositoryError(400, 'INVALID_COMPLETION_REQUEST',
      'Completion authority request is invalid.', cause);
  }
  if (cause && cause.code === '54000') {
    return new CompletionRepositoryError(429, 'COMPLETION_LIMIT_REACHED',
      'The bounded completion history limit was reached.', cause);
  }
  return new CompletionRepositoryError(503, 'COMPLETION_UNAVAILABLE',
    'Completion authority is temporarily unavailable.', cause);
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw mapped();
}

function result(row) {
  const value = row && row.result;
  if (!value || typeof value !== 'object' || !Number.isInteger(value.status) ||
      !value.body || typeof value.body !== 'object' ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 3000000) throw mapped();
  return { status: value.status, body: value.body, replayed: value.replayed === true };
}

async function transaction(pool, write, identity, operation) {
  requirePool(pool);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    let authorityLockHeld = false;
    let workLockHeld = false;
    let discard = false;
    try {
      await client.query("SET statement_timeout='5000ms'");
      await client.query("SET lock_timeout='2000ms'");
      await client.query("SET idle_in_transaction_session_timeout='5000ms'");
      await client.query('SELECT pg_advisory_lock_shared(230004,4)');
      authorityLockHeld = true;
      await client.query(write
        ? 'SELECT pg_advisory_lock(230007,hashtext($1))'
        : 'SELECT pg_advisory_lock_shared(230007,hashtext($1))', [identity]);
      workLockHeld = true;
      await client.query(write
        ? 'BEGIN ISOLATION LEVEL SERIALIZABLE'
        : 'BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => { discard = true; });
      if (write && cause && ['40001', '40P01'].includes(cause.code) &&
          !/stale|changed/.test(String(cause.constraint || '')) && attempt < 2) continue;
      throw mapped(cause);
    } finally {
      if (workLockHeld) await client.query(write
        ? 'SELECT pg_advisory_unlock(230007,hashtext($1))'
        : 'SELECT pg_advisory_unlock_shared(230007,hashtext($1))', [identity])
        .catch(() => { discard = true; });
      if (authorityLockHeld) await client.query('SELECT pg_advisory_unlock_shared(230004,4)')
        .catch(() => { discard = true; });
      await client.query('RESET ALL').catch(() => { discard = true; });
      client.release(discard);
    }
  }
  throw new CompletionRepositoryError(409, 'COMPLETION_CONFLICT',
    'Completion authority changed; refresh before trying again.');
}

async function mutateCompletion(pool, input) {
  const document = {
    contractVersion: input.contractVersion,
    proposal: input.proposal,
    completion: input.completion,
    reopening: input.reopening,
    record: input.record,
    expiresAt: input.expiresAt,
    gateRequirements: input.gateRequirements,
    nextAction: input.nextAction,
    annotation: input.annotation,
  };
  return transaction(pool, true, `${input.organizationId}:${input.executionId}`, async client => {
    const query = await client.query(
      `SELECT public.canonical_completion_mutate(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,
         $8::bigint,$9::text,$10::bigint,$11::text,$12::jsonb,$13::text,$14::text,$15::text
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
        input.csrfToken, input.executionId, input.action, input.expectedExecutionRevision,
        input.expectedExecutionDigest, input.expectedAssignmentRevision,
        input.expectedAssignmentDigest, document, input.idempotencyKey, input.reason,
        input.requestCorrelationId]
    );
    return result(query.rows[0]);
  });
}

async function completionBody(client, input) {
    const query = await client.query(
      `SELECT public.canonical_completion_read(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole,
        input.authSessionId, input.executionId]
    );
    const body = query.rows[0] && query.rows[0].result;
    if (!body || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body), 'utf8') > 3000000) {
      throw mapped();
    }
    return body;
}

async function readCompletion(pool, input) {
  return transaction(pool, false, `${input.organizationId}:${input.executionId}`, async client => {
    return { status: 200, body: await completionBody(client, input), replayed: false };
  });
}

async function readOwnerCompletionReview(pool, input) {
  if (!input || !['owner', 'admin'].includes(input.actorAccessRole)) {
    throw new CompletionRepositoryError(403, 'COMPLETION_FORBIDDEN', 'Owner completion review is restricted.');
  }
  return transaction(pool, false, `${input.organizationId}:${input.executionId}`, async client => {
    // The existing canonical entry rechecks live actor/session/tenant/source
    // authority before this minimal context read. No private completion table
    // or helper grant is needed, and both projections share one snapshot.
    const body = await completionBody(client, input);
    const execution = body && body.data && body.data.execution;
    if (!execution || execution.id !== input.executionId) throw mapped();
    const context = await client.query(
      `SELECT assignment.id AS assignment_id,assignment.appointment_id,assignment.revision,
        rtrim(assignment.canonical_digest) AS digest,
        left(COALESCE(NULLIF(opportunity.job_scope->>'jobTitle',''),NULLIF(opportunity.service_type,''),'Service appointment'),500) AS title,
        onboarding.status AS onboarding_status,subscription.status AS subscription_status,
        subscription.trial_started_at,subscription.trial_ends_at,clock_timestamp() AS server_now
       FROM public.canonical_schedule_assignments assignment
       JOIN public.canonical_appointments appointment ON appointment.organization_id=assignment.organization_id
        AND appointment.id=assignment.appointment_id AND appointment.operation_id=assignment.operation_id
        AND appointment.graph_id=assignment.graph_id AND appointment.opportunity_id=assignment.opportunity_id
       JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=appointment.organization_id
        AND opportunity.id=appointment.opportunity_id AND opportunity.operation_id=appointment.operation_id
        AND opportunity.graph_id=appointment.graph_id
       JOIN public.organization_onboarding onboarding ON onboarding.organization_id=assignment.organization_id
       LEFT JOIN public.subscriptions subscription ON subscription.organization_id=assignment.organization_id
       WHERE assignment.organization_id=$1::uuid AND assignment.id=$2::uuid AND appointment.id=$3::uuid`,
      [input.organizationId, execution.assignmentId, execution.appointmentId]
    );
    if (context.rowCount !== 1) throw mapped();
    const data = require('./ownerReview').projectOwnerReview(body, context.rows[0], input);
    return { status: 200, body: { success: true, data }, replayed: false };
  });
}

module.exports = {
  CompletionRepositoryError,
  mutateCompletion,
  readCompletion,
  readOwnerCompletionReview,
};
