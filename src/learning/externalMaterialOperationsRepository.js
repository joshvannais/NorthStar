'use strict';

function mapped(error) {
  const result = Object.assign(new Error('External material source operations are temporarily unavailable.'),
    { code: 'M25_MATERIAL_IMPORT_OPERATIONS_UNAVAILABLE', status: 503 });
  if (error && error.constraint === 'external_material_cleanup_active_hold') { result.code = 'M25_MATERIAL_IMPORT_OPERATIONS_HOLD_ACTIVE'; result.status = 409; result.message = 'Cleanup is paused while a legal or audit hold is active. Release the hold before continuing.'; }
  else if (error && error.code === '42501') { result.code = 'M25_MATERIAL_IMPORT_OPERATIONS_FORBIDDEN'; result.status = 403; result.message = 'Source operations are restricted to current owners and administrators.'; }
  else if (error && error.code === '40001') { result.code = 'M25_MATERIAL_IMPORT_OPERATIONS_CHANGED'; result.status = 409; result.message = 'The source operation changed. Refresh before continuing.'; }
  else if (error && error.code === '23505') { result.code = 'M25_MATERIAL_IMPORT_OPERATIONS_KEY_CONFLICT'; result.status = 409; result.message = 'That request key was already used for another source operation.'; }
  else if (error && error.code === '22023') { result.code = 'M25_MATERIAL_IMPORT_OPERATIONS_INPUT_INVALID'; result.status = 400; result.message = 'Source operation details are invalid.'; }
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
    const value = await work(client); await client.query('COMMIT'); return value;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw mapped(error); }
  finally { client.release(); }
}

function actor(input) { return [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId]; }
function read(pool, input) { return transaction(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_external_material_operations_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value); }
function mutate(pool, input, functionName) { return transaction(pool, 'SERIALIZABLE', async client =>
  (await client.query(`SELECT public.${functionName}($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value`,
    [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value); }

module.exports = {
  read,
  mutateAdapter: (pool, input) => mutate(pool, input, 'canonical_external_material_adapter_mutate'),
  mutateRetention: (pool, input) => mutate(pool, input, 'canonical_external_material_retention_mutate'),
  mutateDeletion: (pool, input) => mutate(pool, input, 'canonical_external_material_deletion_mutate'),
  mutateHold: (pool, input) => mutate(pool, input, 'canonical_external_material_hold_mutate'),
  executeCleanup: (pool, input) => mutate(pool, input, 'canonical_external_material_cleanup_execute'),
};
