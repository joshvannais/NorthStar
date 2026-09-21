'use strict';

function mapped(error) {
  const constraint = String(error && error.constraint || '');
  const result = Object.assign(new Error('Customer outcome learning is temporarily unavailable.'), { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_UNAVAILABLE', status: 503, cause: error });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_FORBIDDEN', status: 403, message: 'Customer outcome learning is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_CHANGED', status: 409, message: 'Source permission, learning permission, reviewed links, company records, or imported evidence changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_KEY_CONFLICT', status: 409, message: 'That request key was already used for a different customer outcome decision.' });
  else if (error && error.code === '22023') Object.assign(result, constraint.includes('already_current') ? { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_CURRENT', status: 409, message: 'The current customer outcome is already recorded.' } : { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_INPUT_INVALID', status: 400, message: 'Customer outcome details are invalid.' });
  else if (error && error.code === 'P0002') Object.assign(result, { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_EVIDENCE_INCOMPLETE', status: 409, message: constraint.includes('lineage') ? 'Current reviewed estimate links and imported evidence are required.' : 'Current source and customer outcome permissions are required.' });
  return result;
}
async function tx(pool, isolation, work) {
  for (let attempt=0;attempt<3;attempt+=1) {
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
      if (['40001','23505'].includes(error && error.code) && attempt<2) continue;
      throw mapped(error);
    } finally { client.release(); }
  }
  throw mapped(Object.assign(new Error('Customer outcome learning changed.'), { code: '40001' }));
}
const actor = input => [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId];
const readConsent = (pool,input) => tx(pool,'REPEATABLE READ READ ONLY',async client => (await client.query(
  'SELECT public.canonical_external_customer_outcome_consent_read($1,$2,$3,$4,$5,$6) value',
  [...actor(input),input.crmSourceKey,input.communicationSourceKey])).rows[0].value);
const mutateConsent = (pool,input) => tx(pool,'SERIALIZABLE',async client => (await client.query(
  'SELECT public.canonical_external_customer_outcome_consent_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) value',
  [...actor(input),input.csrfToken,input.idempotencyKey,input.crmSourceKey,input.communicationSourceKey,JSON.stringify(input.body)])).rows[0].value);
const observe = (pool,input) => tx(pool,'SERIALIZABLE',async client => (await client.query(
  'SELECT public.canonical_external_customer_outcome_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) value',
  [...actor(input),input.csrfToken,input.idempotencyKey,input.crmSourceKey,input.communicationSourceKey,input.estimateId,input.crmEstimateReference,input.communicationEstimateReference,input.expectedConsentRevision,input.expectedConsentDigest,input.reason,input.confirmed,input.confirmationVersion])).rows[0].value);
const readOutcome = (pool,input) => tx(pool,'REPEATABLE READ READ ONLY',async client => (await client.query(
  'SELECT public.canonical_external_customer_outcome_read($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
  [...actor(input),input.crmSourceKey,input.communicationSourceKey,input.estimateId,input.crmEstimateReference,input.communicationEstimateReference])).rows[0].value);

module.exports = { mapped, mutateConsent, observe, readConsent, readOutcome };
