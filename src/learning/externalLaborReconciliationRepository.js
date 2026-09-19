'use strict';

const { applyTargetLabels, readTargetLabels } = require('./reconciliationTargetLabels');

function mapped(error) {
  const constraint = String(error && error.constraint || '');
  const result = Object.assign(new Error('External labor reconciliation is temporarily unavailable.'), { code: 'M25_MATCH_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_MATCH_FORBIDDEN', status: 403, message: 'External labor reconciliation is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_MATCH_CHANGED', status: 409,
    message: constraint.includes('target') ? 'The selected match target changed. Refresh before continuing.' : 'The imported reference or match changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_MATCH_KEY_CONFLICT', status: 409, message: 'That request key was already used for a different match.' });
  else if (error && error.code === '22023') Object.assign(result, { code: 'M25_MATCH_INPUT_INVALID', status: 400, message: 'External labor reference match details are invalid.' });
  return result;
}
async function tx(pool, isolation, work) { const client = await pool.connect(); try {
  await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); await client.query("SET LOCAL statement_timeout='5000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'"); await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
  await client.query('SET LOCAL search_path=pg_catalog,public'); const value = await work(client); await client.query('COMMIT'); return value;
} catch (error) { await client.query('ROLLBACK').catch(() => {}); throw mapped(error); } finally { client.release(); } }
const actor = input => [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
function readMatches(pool, input) { return tx(pool, 'REPEATABLE READ READ ONLY', async client => {
  const matches = (await client.query('SELECT public.canonical_external_labor_reference_matches_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value;
  return applyTargetLabels(matches, await readTargetLabels(client, input));
}); }
function mutateMatch(pool, input) { return tx(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_external_labor_reference_match_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
    [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value); }
module.exports = { readMatches, mutateMatch };
