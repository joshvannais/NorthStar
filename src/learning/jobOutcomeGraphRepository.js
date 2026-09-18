'use strict';

function mapped(error) {
  const constraint = String(error && error.constraint || '');
  const result = Object.assign(new Error('Job outcome review is temporarily unavailable.'), {
    code: 'M25_JOB_OUTCOME_GRAPH_UNAVAILABLE', status: 503, cause: error,
  });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_JOB_OUTCOME_GRAPH_FORBIDDEN', status: 403, message: 'Job outcome review is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_JOB_OUTCOME_GRAPH_CHANGED', status: 409, message: 'Permission or job outcome evidence changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_JOB_OUTCOME_GRAPH_KEY_CONFLICT', status: 409, message: 'That request key was already used for different job outcome details.' });
  else if (error && error.code === '22023') Object.assign(result, constraint.includes('already_current') ? { code: 'M25_JOB_OUTCOME_GRAPH_CURRENT', status: 409, message: 'The current job outcome review is already recorded.' } : { code: 'M25_JOB_OUTCOME_GRAPH_INPUT_INVALID', status: 400, message: 'Job outcome review details are invalid.' });
  else if (error && error.code === 'P0002') Object.assign(result, { code: 'M25_JOB_OUTCOME_GRAPH_EVIDENCE_INCOMPLETE', status: 409, message: constraint.includes('consent') ? 'Current permission is required before reviewing job outcomes together.' : 'Two or more current outcome sources for this job are required.' });
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
      if (error && ['40001', '23505'].includes(error.code) && attempt < 2) continue;
      throw mapped(error);
    } finally { client.release(); }
  }
  throw mapped(Object.assign(new Error('Job outcome review changed.'), { code: '40001' }));
}

const actor = input => [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId];
const readConsent = (pool,input) => tx(pool,'REPEATABLE READ READ ONLY',async client => (await client.query(
  'SELECT public.canonical_job_outcome_graph_consent_read($1,$2,$3,$4) value', actor(input))).rows[0].value);
const mutateConsent = (pool,input) => tx(pool,'SERIALIZABLE',async client => (await client.query(
  'SELECT public.canonical_job_outcome_graph_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
  [...actor(input),input.csrfToken,input.idempotencyKey,JSON.stringify(input.body)])).rows[0].value);
const build = (pool,input) => tx(pool,'SERIALIZABLE',async client => (await client.query(
  'SELECT public.canonical_job_outcome_graph_build($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) value',
  [...actor(input),input.csrfToken,input.idempotencyKey,input.estimateId,input.expectedConsentRevision,
    input.expectedConsentDigest,JSON.stringify(input.nodes),input.reason,input.confirmed,input.confirmationVersion])).rows[0].value);
const read = (pool,input) => tx(pool,'REPEATABLE READ READ ONLY',async client => (await client.query(
  'SELECT public.canonical_job_outcome_graph_read($1,$2,$3,$4,$5) value', [...actor(input),input.estimateId])).rows[0].value);

module.exports = { build, mapped, mutateConsent, read, readConsent };
