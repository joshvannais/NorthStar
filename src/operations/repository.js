'use strict';

class FieldExecutionRepositoryError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'FieldExecutionRepositoryError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.cause = cause;
  }
}

function fail(status, code, message, cause) {
  throw new FieldExecutionRepositoryError(status, code, message, cause);
}

function mapDatabaseError(error) {
  if (error instanceof FieldExecutionRepositoryError) return error;
  const constraint = String(error && error.constraint || '');
  if (constraint === 'canonical_field_execution_not_found' || error && error.code === 'P0002') {
    return new FieldExecutionRepositoryError(404, 'NOT_FOUND', 'Field execution not found.', error);
  }
  if (constraint.includes('stale') || error && ['40001', '40P01'].includes(error.code)) {
    return new FieldExecutionRepositoryError(409, 'M23_EXECUTION_STALE',
      'Field execution authority changed; refresh before trying again.', error);
  }
  if (constraint === 'canonical_field_execution_idempotency_conflict') {
    return new FieldExecutionRepositoryError(409, 'M23_EXECUTION_IDEMPOTENCY_CONFLICT',
      'The Idempotency-Key was already used for another field execution mutation.', error);
  }
  if (constraint === 'canonical_field_execution_already_exists') {
    return new FieldExecutionRepositoryError(409, 'M23_EXECUTION_ALREADY_EXISTS',
      'A canonical field execution already exists for this appointment.', error);
  }
  if (constraint === 'canonical_field_execution_transition_invalid') {
    return new FieldExecutionRepositoryError(409, 'M23_EXECUTION_TRANSITION_INVALID',
      'The requested field execution transition is not valid from the current state.', error);
  }
  if (constraint === 'canonical_field_execution_dispatch_required') {
    return new FieldExecutionRepositoryError(409, 'M23_EXECUTION_DISPATCH_REQUIRED',
      'A current dispatched assignment is required for field execution.', error);
  }
  if (error && error.code === '42501') {
    return new FieldExecutionRepositoryError(403, 'M23_EXECUTION_FORBIDDEN',
      'Current field execution authority is unavailable.', error);
  }
  if (constraint === 'canonical_field_execution_input_invalid') {
    return new FieldExecutionRepositoryError(400, 'INVALID_EXECUTION_REQUEST',
      'Field execution request is invalid.', error);
  }
  return new FieldExecutionRepositoryError(503, 'M23_EXECUTION_PERSISTENCE_UNAVAILABLE',
    'Canonical field execution persistence is unavailable.', error);
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    fail(503, 'M23_EXECUTION_PERSISTENCE_UNAVAILABLE',
      'Canonical field execution persistence is unavailable.');
  }
}

function databaseResult(row) {
  const value = row && row.result;
  if (!value || typeof value !== 'object' || !Number.isInteger(value.status) ||
      !value.body || typeof value.body !== 'object') {
    fail(503, 'M23_EXECUTION_PERSISTENCE_UNAVAILABLE',
      'Canonical field execution persistence returned an invalid result.');
  }
  return {
    status: value.status,
    body: value.body,
    replayed: value.replayed === true,
  };
}

async function serializable(pool, operation) {
  requirePool(pool);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error && ['40001', '40P01'].includes(error.code) &&
          !String(error.constraint || '').includes('stale') && attempt < 2) continue;
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }
  fail(409, 'M23_EXECUTION_STALE',
    'Field execution authority changed; refresh before trying again.');
}

async function initializeFieldExecution(pool, input) {
  return serializable(pool, async client => {
    const result = await client.query(
      `SELECT public.canonical_field_execution_initialize(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::bigint,
         $8::text,$9::text,$10::text,$11::text
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole,
        input.authSessionId, input.csrfToken, input.appointmentId,
        input.expectedAssignmentRevision, input.expectedAssignmentDigest,
        input.idempotencyKey, input.reason, input.requestCorrelationId]
    );
    return databaseResult(result.rows[0]);
  });
}

async function transitionFieldExecution(pool, input) {
  return serializable(pool, async client => {
    const result = await client.query(
      `SELECT public.canonical_field_execution_transition(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::bigint,
         $8::text,$9::bigint,$10::text,$11::text,$12::text,$13::text,$14::text
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole,
        input.authSessionId, input.csrfToken, input.executionId,
        input.expectedRevision, input.expectedDigest,
        input.expectedAssignmentRevision, input.expectedAssignmentDigest,
        input.action, input.idempotencyKey, input.reason, input.requestCorrelationId]
    );
    return databaseResult(result.rows[0]);
  });
}

async function readFieldExecution(pool, input) {
  requirePool(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const result = await client.query(
      `SELECT public.canonical_field_execution_read(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole,
        input.authSessionId, input.executionId]
    );
    await client.query('COMMIT');
    const body = result.rows[0] && result.rows[0].result;
    if (!body || typeof body !== 'object') {
      fail(503, 'M23_EXECUTION_PERSISTENCE_UNAVAILABLE',
        'Canonical field execution persistence returned an invalid result.');
    }
    return { status: 200, body, replayed: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDatabaseError(error);
  } finally {
    client.release();
  }
}

module.exports = {
  FieldExecutionRepositoryError,
  initializeFieldExecution,
  mapDatabaseError,
  readFieldExecution,
  transitionFieldExecution,
};
