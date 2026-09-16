'use strict';

function mapped(error) {
  const constraint = String(error && error.constraint || '');
  const message = String(error && error.message || '');
  const result = new Error('Labor outcome learning is temporarily unavailable.');
  result.code = 'M25_LEARNING_UNAVAILABLE';
  result.status = 503;
  if (error && error.code === '42501') {
    result.code = 'M25_LEARNING_FORBIDDEN'; result.status = 403;
    result.message = 'Labor outcome learning is restricted to current owners and administrators.';
  } else if (error && error.code === '40001') {
    result.code = 'M25_LEARNING_CHANGED'; result.status = 409;
    result.message = 'Learning consent or source records changed. Refresh before continuing.';
  } else if (error && error.code === '23505') {
    result.code = 'M25_LEARNING_KEY_CONFLICT'; result.status = 409;
    result.message = 'That request key was already used for different learning details.';
  } else if (error && error.code === '22023') {
    result.code = 'M25_LEARNING_INPUT_INVALID'; result.status = 400;
    result.message = message.includes('already active') ? 'Labor outcome learning is already enabled.' :
      message.includes('No active') ? 'Labor outcome learning is already disabled.' :
      message.includes('already observed') ? 'The current labor outcome has already been recorded. Refresh to view it.' :
      'Learning details are invalid.';
    if (message.includes('already observed')) { result.code = 'M25_LABOR_OUTCOME_CURRENT'; result.status = 409; }
  } else if (error && error.code === 'P0002') {
    result.status = 409;
    if (constraint === 'learning_labor_plan_unavailable') {
      result.code = 'M25_LABOR_PLAN_REQUIRED'; result.message = 'Adopt a labor plan before comparing planned and recorded hours.';
    } else if (constraint === 'learning_completion_unavailable') {
      result.code = 'M25_COMPLETED_WORK_REQUIRED'; result.message = 'Finish the job before comparing planned and recorded hours.';
    } else if (constraint === 'learning_labor_review_incomplete') {
      result.code = 'M25_LABOR_REVIEW_REQUIRED'; result.message = 'Review every recorded labor interval before using it for learning.';
    } else if (constraint === 'learning_labor_outcome_unavailable') {
      result.code = 'M25_LABOR_OUTCOME_REQUIRED'; result.message = 'Accepted labor records are required for this comparison.';
    } else {
      result.code = 'M25_ESTIMATE_UNAVAILABLE'; result.status = 404;
      result.message = 'That estimate is unavailable in the current business.';
    }
  }
  return result;
}

async function transaction(pool, isolation, work) {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapped(error);
  } finally {
    client.release();
  }
}

function actorValues(input) {
  return [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
}

function readConsent(pool, input) {
  return transaction(pool, 'REPEATABLE READ READ ONLY', async client => {
    const result = await client.query('SELECT public.canonical_learning_consent_read($1,$2,$3,$4) AS value', actorValues(input));
    return result.rows[0].value;
  });
}

function mutateConsent(pool, input, body) {
  return transaction(pool, 'SERIALIZABLE', async client => {
    const result = await client.query(
      'SELECT public.canonical_learning_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) AS value',
      [...actorValues(input), input.csrfToken, input.idempotencyKey, JSON.stringify(body)]
    );
    return result.rows[0].value;
  });
}

function observe(pool, input) {
  return transaction(pool, 'SERIALIZABLE', async client => {
    const result = await client.query(
      'SELECT public.canonical_labor_outcome_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',
      [...actorValues(input), input.csrfToken, input.idempotencyKey, input.estimateId,
        input.expectedConsentRevision, input.expectedConsentDigest, input.reason]
    );
    return result.rows[0].value;
  });
}

function readOutcome(pool, input) {
  return transaction(pool, 'REPEATABLE READ READ ONLY', async client => {
    const result = await client.query(
      'SELECT public.canonical_labor_outcome_read($1,$2,$3,$4,$5) AS value',
      [...actorValues(input), input.estimateId]
    );
    return result.rows[0].value;
  });
}

module.exports = { readConsent, mutateConsent, observe, readOutcome };
