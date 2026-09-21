'use strict';

function mapped(error) {
  const constraint = String(error && error.constraint || '');
  const result = Object.assign(new Error('Source operations are temporarily unavailable.'),
    { code: 'M25_EXTERNAL_BUSINESS_OPERATIONS_UNAVAILABLE', status: 503, cause: error });
  if (constraint === 'external_business_cleanup_active_hold') Object.assign(result, {
    code: 'M25_EXTERNAL_BUSINESS_OPERATIONS_HOLD_ACTIVE', status: 409,
    message: 'Cleanup is paused while a legal or audit hold is active. Release the hold before continuing.',
  });
  else if (error && error.code === '42501') Object.assign(result, { code: 'M25_EXTERNAL_BUSINESS_OPERATIONS_FORBIDDEN', status: 403, message: 'Source operations are restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_EXTERNAL_BUSINESS_OPERATIONS_CHANGED', status: 409, message: constraint === 'external_business_deletion_blocks_consent_grant' ? 'Cancel source deletion before starting a new permission period.' : 'The source operation changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_EXTERNAL_BUSINESS_OPERATIONS_KEY_CONFLICT', status: 409, message: 'That request key was already used for another source operation.' });
  else if (error && error.code === '22023') Object.assign(result, { code: 'M25_EXTERNAL_BUSINESS_OPERATIONS_INPUT_INVALID', status: 400, message: 'Source operation details are invalid.' });
  return result;
}
async function tx(pool, isolation, work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const value = await work(client); await client.query('COMMIT'); return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (['40001','23505'].includes(error && error.code) && attempt < 2) continue;
      throw mapped(error);
    } finally { client.release(); }
  }
  throw mapped(Object.assign(new Error('Source operation changed.'), { code: '40001' }));
}
const actor = input => [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId];
const read = (pool,input) => tx(pool,'REPEATABLE READ READ ONLY',async client => (await client.query(
  'SELECT public.canonical_external_business_operations_read($1,$2,$3,$4,$5,$6) value',
  [...actor(input),input.sourceClass,input.sourceKey])).rows[0].value);
const mutate = (pool,input,name) => tx(pool,'SERIALIZABLE',async client => (await client.query(
  `SELECT public.${name}($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) value`,
  [...actor(input),input.csrfToken,input.idempotencyKey,input.sourceClass,input.sourceKey,JSON.stringify(input.body)])).rows[0].value);

module.exports = {
  mapped, read,
  mutateAdapter: (pool,input) => mutate(pool,input,'canonical_external_business_adapter_mutate'),
  mutateRetention: (pool,input) => mutate(pool,input,'canonical_external_business_retention_mutate'),
  mutateDeletion: (pool,input) => mutate(pool,input,'canonical_external_business_deletion_mutate'),
  mutateHold: (pool,input) => mutate(pool,input,'canonical_external_business_hold_mutate'),
  executeCleanup: (pool,input) => mutate(pool,input,'canonical_external_business_cleanup_execute'),
};
