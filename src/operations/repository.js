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
  if (constraint.includes('canonical_labor_stale') ||
      constraint === 'canonical_labor_overlap' || constraint === 'canonical_labor_timer_open' ||
      constraint === 'canonical_labor_one_open_timer') {
    return new FieldExecutionRepositoryError(409,
      constraint === 'canonical_labor_overlap' ? 'M23_LABOR_OVERLAP' :
        ['canonical_labor_timer_open', 'canonical_labor_one_open_timer'].includes(constraint)
          ? 'M23_LABOR_TIMER_ALREADY_OPEN' : 'M23_LABOR_STALE',
      constraint === 'canonical_labor_overlap'
        ? 'Labor evidence overlaps another current interval for this performer.'
        : ['canonical_labor_timer_open', 'canonical_labor_one_open_timer'].includes(constraint)
          ? 'This performer already has an active labor timer.'
          : 'Labor evidence authority changed; refresh before trying again.', error);
  }
  if (constraint === 'canonical_labor_time_authority_stale' ||
      constraint === 'canonical_labor_category_stale') {
    return new FieldExecutionRepositoryError(409, 'M23_LABOR_SOURCE_STALE',
      'Labor category or time-zone authority changed; refresh before trying again.', error);
  }
  if (constraint.includes('canonical_material_stale') ||
      constraint === 'canonical_material_unit_stale') {
    return new FieldExecutionRepositoryError(409, 'M23_MATERIAL_STALE',
      'Material evidence authority changed; refresh before trying again.', error);
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
  if (constraint === 'canonical_labor_interval_not_found') {
    return new FieldExecutionRepositoryError(404, 'NOT_FOUND', 'Labor interval not found.', error);
  }
  if (constraint === 'canonical_labor_idempotency_conflict') {
    return new FieldExecutionRepositoryError(409, 'M23_LABOR_IDEMPOTENCY_CONFLICT',
      'The Idempotency-Key was already used for another labor evidence mutation.', error);
  }
  if (constraint === 'canonical_labor_timer_not_open' || constraint === 'canonical_labor_action_invalid') {
    return new FieldExecutionRepositoryError(409, 'M23_LABOR_ACTION_INVALID',
      'The requested labor evidence action is not valid from the current state.', error);
  }
  if (constraint === 'canonical_labor_dispatch_required') {
    return new FieldExecutionRepositoryError(403, 'M23_EXECUTION_FORBIDDEN',
      'Current labor evidence authority is unavailable.', error);
  }
  if (constraint === 'canonical_material_movement_not_found') {
    return new FieldExecutionRepositoryError(404, 'NOT_FOUND', 'Material movement not found.', error);
  }
  if (constraint === 'canonical_material_idempotency_conflict') {
    return new FieldExecutionRepositoryError(409, 'M23_MATERIAL_IDEMPOTENCY_CONFLICT',
      'The Idempotency-Key was already used for another material evidence mutation.', error);
  }
  if (constraint === 'canonical_material_balance_overflow') {
    return new FieldExecutionRepositoryError(409, 'M23_MATERIAL_BALANCE_LIMIT',
      'The bounded recorded-movement balance limit would be exceeded.', error);
  }
  if (constraint === 'canonical_material_balance_review_required') {
    return new FieldExecutionRepositoryError(409, 'M23_MATERIAL_BALANCE_REVIEW_REQUIRED',
      'The recorded-movement balance remains unresolved and cannot be accepted.', error);
  }
  if (constraint === 'canonical_material_action_invalid') {
    return new FieldExecutionRepositoryError(409, 'M23_MATERIAL_ACTION_INVALID',
      'The requested material evidence action is not valid from the current state.', error);
  }
  if (constraint === 'canonical_material_already_reversed' ||
      constraint === 'canonical_material_reverse_invalid' ||
      constraint === 'canonical_material_reversal_invalid') {
    return new FieldExecutionRepositoryError(409,
      constraint === 'canonical_material_already_reversed'
        ? 'M23_MATERIAL_ALREADY_REVERSED' : 'M23_MATERIAL_ACTION_INVALID',
      constraint === 'canonical_material_already_reversed'
        ? 'This material movement already has a reversal.'
        : 'The requested material reversal is not valid.', error);
  }
  if (constraint === 'canonical_material_dispatch_required') {
    return new FieldExecutionRepositoryError(403, 'M23_EXECUTION_FORBIDDEN',
      'Current material evidence authority is unavailable.', error);
  }
  if (constraint === 'canonical_material_input_invalid' ||
      constraint === 'canonical_material_quantity_invalid') {
    return new FieldExecutionRepositoryError(400, 'INVALID_MATERIAL_REQUEST',
      'Material evidence request is invalid.', error);
  }
  if (constraint === 'canonical_labor_input_invalid' || constraint === 'canonical_labor_instant_invalid') {
    return new FieldExecutionRepositoryError(400, 'INVALID_LABOR_REQUEST',
      'Labor evidence request is invalid.', error);
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

async function materialSerializable(pool, operation) {
  requirePool(pool);
  const client = await pool.connect();
  let authorityLockHeld = false;
  try {
    await client.query("SET statement_timeout='5000ms'");
    await client.query("SET lock_timeout='2000ms'");
    await client.query("SET idle_in_transaction_session_timeout='5000ms'");
    await client.query('SELECT pg_advisory_lock_shared(230004,4)');
    authorityLockHeld = true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query('SET LOCAL search_path=pg_catalog,public');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error && ['40001', '40P01'].includes(error.code) &&
            !String(error.constraint || '').includes('stale') && attempt < 2) continue;
        throw mapDatabaseError(error);
      }
    }
    fail(409, 'M23_EXECUTION_STALE',
      'Field execution authority changed; refresh before trying again.');
  } finally {
    if (authorityLockHeld) await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(() => {});
    await client.query('RESET ALL').catch(() => {});
    client.release();
  }
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

async function mutateLaborTime(pool, input) {
  return serializable(pool, async client => {
    const result = await client.query(
      `SELECT public.canonical_labor_time_mutate(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,$8::uuid,
         $9::text,$10::text,$11::text,$12::bigint,$13::text,$14::bigint,$15::text,
         $16::uuid,$17::bigint,$18::text,$19::text,$20::text,$21::text,$22::uuid,
         $23::bigint,$24::text,$25::text,$26::text,$27::text,$28::text
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
        input.csrfToken, input.executionId, input.action, input.performerProfileId,
        input.category, input.categoryContractVersion, input.categoryContractDigest,
        input.expectedExecutionRevision, input.expectedExecutionDigest,
        input.expectedAssignmentRevision, input.expectedAssignmentDigest,
        input.businessProfileId, input.businessProfileVersion, input.businessProfileHash,
        input.timeZone, input.observedStart, input.observedEnd, input.intervalId,
        input.expectedIntervalRevision, input.expectedIntervalDigest, input.reviewOutcome,
        input.idempotencyKey, input.reason, input.requestCorrelationId]
    );
    return databaseResult(result.rows[0]);
  });
}

async function readLaborTime(pool, input) {
  requirePool(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const result = await client.query(
      `SELECT public.canonical_labor_time_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole,
        input.authSessionId, input.executionId]
    );
    await client.query('COMMIT');
    const body = result.rows[0] && result.rows[0].result;
    if (!body || typeof body !== 'object') {
      fail(503, 'M23_EXECUTION_PERSISTENCE_UNAVAILABLE',
        'Canonical labor evidence persistence returned an invalid result.');
    }
    return { status: 200, body, replayed: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDatabaseError(error);
  } finally {
    client.release();
  }
}

async function mutateMaterialInventory(pool, input) {
  return materialSerializable(pool, async client => {
    const result = await client.query(
      `SELECT public.canonical_material_inventory_mutate(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,$8::uuid,
         $9::text,$10::text,$11::text,$12::text,$13::text,$14::text,$15::text,
         $16::text,$17::text,$18::text,$19::text,$20::uuid,$21::bigint,$22::text,
         $23::text,$24::bigint,$25::text,$26::bigint,$27::text,$28::text,$29::text,$30::text
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
        input.csrfToken, input.executionId, input.action, input.performerProfileId,
        input.movementKind, input.itemKey, input.description, input.quantity, input.unitCode,
        input.unitContractVersion, input.unitContractDigest, input.locationKey,
        input.destinationLocationKey, input.lotCode, input.adjustmentDirection, input.movementId,
        input.expectedMovementRevision, input.expectedMovementDigest, input.reviewOutcome,
        input.expectedExecutionRevision, input.expectedExecutionDigest,
        input.expectedAssignmentRevision, input.expectedAssignmentDigest,
        input.idempotencyKey, input.reason, input.requestCorrelationId]
    );
    return databaseResult(result.rows[0]);
  });
}

async function readMaterialInventory(pool, input) {
  requirePool(pool);
  const client = await pool.connect();
  let authorityLockHeld = false;
  try {
    await client.query("SET statement_timeout='5000ms'");
    await client.query("SET lock_timeout='2000ms'");
    await client.query("SET idle_in_transaction_session_timeout='5000ms'");
    await client.query('SELECT pg_advisory_lock_shared(230004,4)');
    authorityLockHeld = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const result = await client.query(
      `SELECT public.canonical_material_inventory_read(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::integer
       ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole,
        input.authSessionId, input.executionId,
        input.balanceOffset === undefined ? 0 : input.balanceOffset,
        input.balanceLimit === undefined ? 200 : input.balanceLimit]
    );
    await client.query('COMMIT');
    const body = result.rows[0] && result.rows[0].result;
    if (!body || typeof body !== 'object') {
      fail(503, 'M23_EXECUTION_PERSISTENCE_UNAVAILABLE',
        'Canonical material evidence persistence returned an invalid result.');
    }
    return { status: 200, body, replayed: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDatabaseError(error);
  } finally {
    if (authorityLockHeld) await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(() => {});
    await client.query('RESET ALL').catch(() => {});
    client.release();
  }
}

module.exports = {
  FieldExecutionRepositoryError,
  initializeFieldExecution,
  mapDatabaseError,
  mutateMaterialInventory,
  mutateLaborTime,
  readFieldExecution,
  readLaborTime,
  readMaterialInventory,
  transitionFieldExecution,
};
