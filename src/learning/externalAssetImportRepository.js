'use strict';

function mapped(error) {
  const result = Object.assign(new Error('External vehicle and equipment evidence is temporarily unavailable.'), { code: 'M25_ASSET_IMPORT_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_ASSET_IMPORT_FORBIDDEN', status: 403, message: 'External vehicle and equipment evidence is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: String(error.constraint || '').includes('record_conflict') ? 'M25_ASSET_IMPORT_RECORD_CONFLICT' : 'M25_ASSET_IMPORT_CHANGED', status: 409, message: 'Source consent, cursor, or vehicle and equipment evidence changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_ASSET_IMPORT_KEY_CONFLICT', status: 409, message: 'That request key was already used for different vehicle or equipment evidence.' });
  else if (error && error.code === '22023') Object.assign(result, { code: 'M25_ASSET_IMPORT_INPUT_INVALID', status: 400, message: 'External vehicle or equipment evidence is invalid.' });
  return result;
}
async function tx(pool, isolation, work) { const client = await pool.connect(); try { await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); await client.query("SET LOCAL statement_timeout='5000ms'"); await client.query("SET LOCAL lock_timeout='2000ms'"); await client.query('SET LOCAL search_path=pg_catalog,public'); const value = await work(client); await client.query('COMMIT'); return value; } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw mapped(error); } finally { client.release(); } }
const actor = input => [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
const readConsent = (pool, input) => tx(pool, 'REPEATABLE READ READ ONLY', async client => (await client.query('SELECT public.canonical_external_asset_import_consent_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value);
const mutateConsent = (pool, input) => tx(pool, 'SERIALIZABLE', async client => (await client.query('SELECT public.canonical_external_asset_import_consent_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value', [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value);
const importBatch = (pool, input) => tx(pool, 'SERIALIZABLE', async client => (await client.query('SELECT public.canonical_external_asset_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value', [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value);
const readSource = (pool, input) => tx(pool, 'REPEATABLE READ READ ONLY', async client => (await client.query('SELECT public.canonical_external_asset_import_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value);
module.exports = { readConsent, mutateConsent, importBatch, readSource };
