'use strict';

function mapped(error) {
  const result = Object.assign(new Error('External financial evidence is temporarily unavailable.'), { code: 'M25_FINANCIAL_IMPORT_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_FINANCIAL_IMPORT_FORBIDDEN', status: 403, message: 'External financial evidence is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: String(error.constraint || '').includes('record_conflict') ? 'M25_FINANCIAL_IMPORT_RECORD_CONFLICT' : 'M25_FINANCIAL_IMPORT_CHANGED', status: 409, message: 'The source permission, import position, or records changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_FINANCIAL_IMPORT_KEY_CONFLICT', status: 409, message: 'This action was already used with different financial details.' });
  else if (error && error.code === '22023') Object.assign(result, { code: 'M25_FINANCIAL_IMPORT_INPUT_INVALID', status: 400, message: 'External financial evidence is invalid.' });
  return result;
}
async function tx(pool, isolation, work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error && attempt < 2 && ((error.code === '40001' && !String(error.constraint || '').includes('record_conflict')) ||
          error.code === '23505')) continue;
      throw mapped(error);
    } finally { client.release(); }
  }
  throw mapped(Object.assign(new Error('Financial evidence changed.'), { code: '40001' }));
}
const actor = input => [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
const readConsent = (pool, input) => tx(pool, 'REPEATABLE READ READ ONLY', async client => (await client.query('SELECT public.canonical_external_financial_import_consent_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value);
const mutateConsent = (pool, input) => tx(pool, 'SERIALIZABLE', async client => (await client.query('SELECT public.canonical_external_financial_import_consent_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value', [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value);
const importBatch = (pool, input) => tx(pool, 'SERIALIZABLE', async client => (await client.query('SELECT public.canonical_external_financial_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value', [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value);
const readSource = (pool, input) => tx(pool, 'REPEATABLE READ READ ONLY', async client => (await client.query('SELECT public.canonical_external_financial_import_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value);
module.exports = { readConsent, mutateConsent, importBatch, readSource };
