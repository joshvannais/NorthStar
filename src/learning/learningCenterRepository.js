'use strict';

function mapped(error) {
  const result = Object.assign(new Error('Learning Center is temporarily unavailable.'),
    { code: 'M25_LEARNING_CENTER_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') Object.assign(result, {
    code: 'M25_LEARNING_CENTER_FORBIDDEN', status: 403,
    message: 'Learning Center is restricted to current owners and administrators.',
  });
  return result;
}

async function read(pool, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const value = (await client.query(
      'SELECT public.canonical_learning_center_read($1,$2,$3,$4) value',
      [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId]
    )).rows[0].value;
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapped(error);
  } finally { client.release(); }
}

module.exports = { read };
