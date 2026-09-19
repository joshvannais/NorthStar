'use strict';

function mapped(error) {
  const message = String(error && error.message || '');
  const constraint = String(error && error.constraint || '');
  const result = Object.assign(new Error('External labor imports are temporarily unavailable.'),
    { code: 'M25_IMPORT_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') {
    result.code = 'M25_IMPORT_FORBIDDEN'; result.status = 403;
    result.message = 'External labor imports are restricted to current owners and administrators.';
  } else if (error && error.code === '40001') {
    result.code = constraint === 'learning_import_record_conflict' ? 'M25_IMPORT_RECORD_CONFLICT' : 'M25_IMPORT_CHANGED';
    result.status = 409;
    result.message = constraint === 'learning_import_record_conflict'
      ? 'A source record version contains different details. Correct the source before continuing.'
      : 'Import consent, cursor, or source history changed. Refresh before continuing.';
  } else if (error && error.code === '23505') {
    result.code = 'M25_IMPORT_KEY_CONFLICT'; result.status = 409;
    result.message = 'That request key was already used for a different import.';
  } else if (error && error.code === '22023') {
    result.code = 'M25_IMPORT_INPUT_INVALID'; result.status = 400;
    result.message = message.includes('already active') ? 'This external labor source is already enabled.' :
      message.includes('No active') ? 'This external labor source is already disabled.' :
      message.includes('backfill is complete') ? 'Historical backfill is already complete for this source.' :
      'External labor import details are invalid.';
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
  } finally { client.release(); }
}

function actorValues(input) {
  return [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
}

function readConsent(pool, input) {
  return transaction(pool, 'REPEATABLE READ READ ONLY', async client =>
    (await client.query('SELECT public.canonical_external_labor_import_consent_read($1,$2,$3,$4,$5) value',
      [...actorValues(input), input.sourceKey])).rows[0].value);
}

function mutateConsent(pool, input) {
  return transaction(pool, 'SERIALIZABLE', async client =>
    (await client.query('SELECT public.canonical_external_labor_import_consent_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
      [...actorValues(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value);
}

function executeImportBatch(client, input) {
  return client.query('SELECT public.canonical_external_labor_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
    [...actorValues(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])
    .then(result => result.rows[0].value);
}

async function probeImportBatch(pool, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const value = await executeImportBatch(client, input);
    await client.query('ROLLBACK');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapped(error);
  } finally { client.release(); }
}

async function importBatch(pool, input) {
  try {
    return await transaction(pool, 'SERIALIZABLE', client => executeImportBatch(client, input));
  } catch (error) {
    if (!error || !['M25_IMPORT_CHANGED', 'M25_IMPORT_KEY_CONFLICT'].includes(error.code)) throw error;
    let probe;
    try {
      probe = await probeImportBatch(pool, input);
    } catch (probeError) {
      if (probeError && probeError.code === 'M25_IMPORT_KEY_CONFLICT') throw probeError;
      throw error;
    }
    if (probe && probe.replayed && error.code === 'M25_IMPORT_KEY_CONFLICT') throw mapped({ code: '40001' });
    throw error;
  }
}

function readSource(pool, input) {
  return transaction(pool, 'REPEATABLE READ READ ONLY', async client =>
    (await client.query('SELECT public.canonical_external_labor_import_read($1,$2,$3,$4,$5) value',
      [...actorValues(input), input.sourceKey])).rows[0].value);
}

module.exports = { readConsent, mutateConsent, importBatch, readSource };
