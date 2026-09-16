'use strict';
function mapped(error) {
  const constraint = String(error && error.constraint || '');
  const result = Object.assign(new Error('Imported labor outcome learning is temporarily unavailable.'), { code: 'M25_IMPORTED_OUTCOME_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_IMPORTED_OUTCOME_FORBIDDEN', status: 403, message: 'Imported labor outcome learning is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_IMPORTED_OUTCOME_CHANGED', status: 409, message: 'Source consent, learning consent or imported evidence changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_IMPORTED_OUTCOME_KEY_CONFLICT', status: 409, message: 'That request key was already used for a different imported labor decision.' });
  else if (error && error.code === '22023') Object.assign(result, constraint === 'imported_learning_outcome_already_current' ?
    { code: 'M25_IMPORTED_OUTCOME_CURRENT', status: 409, message: 'The current imported labor outcome is already recorded.' } :
    { code: 'M25_IMPORTED_OUTCOME_INPUT_INVALID', status: 400, message: 'Imported labor outcome details are invalid.' });
  else if (error && error.code === 'P0002') Object.assign(result, { code: 'M25_IMPORTED_OUTCOME_EVIDENCE_INCOMPLETE', status: 409,
    message: constraint === 'imported_learning_records_overlap' ? 'Imported labor intervals overlap and need source review.' :
      constraint.includes('match') ? 'Current reviewed worker and job matches are required.' :
        constraint.includes('plan') ? 'A current adopted labor plan is required.' : 'Current imported labor evidence is incomplete.' });
  return result;
}
async function tx(pool, isolation, work) { const client = await pool.connect(); try {
  await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); await client.query("SET LOCAL statement_timeout='5000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'"); await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
  await client.query('SET LOCAL search_path=pg_catalog,public'); const value = await work(client); await client.query('COMMIT'); return value;
} catch (error) { await client.query('ROLLBACK').catch(() => {}); throw mapped(error); } finally { client.release(); } }
const actor = input => [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
function readConsent(pool, input) { return tx(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_imported_labor_learning_consent_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value); }
function mutateConsent(pool, input) { return tx(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_imported_labor_learning_consent_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
    [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value); }
function observe(pool, input) { return tx(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_imported_labor_outcome_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value',
    [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, input.estimateId, input.externalJobReference,
      input.expectedConsentRevision, input.expectedConsentDigest, input.reason, input.confirmed, input.confirmationVersion])).rows[0].value); }
function readOutcome(pool, input) { return tx(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_imported_labor_outcome_read($1,$2,$3,$4,$5,$6) value',
    [...actor(input), input.sourceKey, input.estimateId])).rows[0].value); }
module.exports = { readConsent, mutateConsent, observe, readOutcome };
