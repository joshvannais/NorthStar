'use strict';

function mapped(error) {
  const constraint = String(error && error.constraint || ''), message = String(error && error.message || '');
  const result = Object.assign(new Error('Native equipment utilization learning is temporarily unavailable.'),
    { code: 'M25_NATIVE_EQUIPMENT_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_FORBIDDEN', status: 403,
    message: 'Equipment utilization learning is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_CHANGED', status: 409,
    message: 'Equipment learning consent or source evidence changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_KEY_CONFLICT', status: 409,
    message: 'That request key was already used for different equipment learning details.' });
  else if (error && error.code === '54000') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_LIMIT', status: 429,
    message: 'The bounded equipment evidence limit was reached. Review or narrow the source records first.' });
  else if (error && error.code === '22023') Object.assign(result, {
    code: message.includes('already observed') ? 'M25_NATIVE_EQUIPMENT_CURRENT' : 'M25_NATIVE_EQUIPMENT_INPUT_INVALID',
    status: message.includes('already observed') ? 409 : 400,
    message: message.includes('already observed') ? 'The current equipment utilization outcome is already recorded.' :
      message.includes('already active') ? 'Equipment utilization learning is already enabled.' :
      message.includes('No active') ? 'Equipment utilization learning is already disabled.' : 'Equipment learning details are invalid.',
  });
  else if (error && error.code === 'P0002') {
    result.status = 409;
    if (constraint === 'native_equipment_plan_unavailable') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_PLAN_REQUIRED', message: 'Adopt equipment with planned hours before comparing utilization.' });
    else if (constraint === 'native_equipment_completion_unavailable') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_COMPLETION_REQUIRED', message: 'Finish the job before comparing equipment utilization.' });
    else if (constraint === 'native_equipment_asset_unavailable' || constraint === 'native_equipment_asset_duplicated') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_ASSET_REQUIRED', message: 'Each planned line needs one current reviewed native asset.' });
    else if (constraint === 'native_equipment_utilization_incomplete') Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_EVIDENCE_REQUIRED', message: 'Complete check-out and check-in evidence is required for every planned asset.' });
    else Object.assign(result, { code: 'M25_NATIVE_EQUIPMENT_ESTIMATE_UNAVAILABLE', status: 404, message: 'That estimate is unavailable in the current business.' });
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
    const value = await work(client); await client.query('COMMIT'); return value;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw mapped(error); }
  finally { client.release(); }
}
const actor = input => [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId];
function readConsent(pool, input) { return transaction(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_equipment_learning_consent_read($1,$2,$3,$4) value', actor(input))).rows[0].value); }
function mutateConsent(pool, input) { return transaction(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_equipment_learning_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
    [...actor(input),input.csrfToken,input.idempotencyKey,JSON.stringify(input.body)])).rows[0].value); }
function observe(pool, input) { return transaction(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_native_equipment_utilization_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
    [...actor(input),input.csrfToken,input.idempotencyKey,input.estimateId,input.expectedConsentRevision,input.expectedConsentDigest,
      input.reason,input.confirmed,input.confirmationVersion])).rows[0].value); }
function readOutcome(pool, input) { return transaction(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_native_equipment_utilization_read($1,$2,$3,$4,$5) value',
    [...actor(input),input.estimateId])).rows[0].value); }
module.exports = { readConsent, mutateConsent, observe, readOutcome };
