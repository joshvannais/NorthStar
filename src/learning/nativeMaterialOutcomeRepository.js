'use strict';

function mapped(error) {
  const constraint = String(error && error.constraint || ''), message = String(error && error.message || '');
  const result = Object.assign(new Error('Material outcome learning is temporarily unavailable.'),
    { code: 'M25_NATIVE_MATERIAL_UNAVAILABLE', status: 503 });
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_FORBIDDEN', status: 403,
    message: 'Material outcome learning is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_CHANGED', status: 409,
    message: 'Your material learning permission or job records changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_KEY_CONFLICT', status: 409,
    message: 'This action was already used with different details. Refresh before trying again.' });
  else if (error && error.code === '54000') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_LIMIT', status: 429,
    message: 'This job has too many material records to compare at once. Review or narrow the records first.' });
  else if (error && error.code === '22023') Object.assign(result, {
    code: message.includes('already observed') ? 'M25_NATIVE_MATERIAL_CURRENT' : 'M25_NATIVE_MATERIAL_INPUT_INVALID',
    status: message.includes('already observed') ? 409 : 400,
    message: message.includes('already observed') ? 'The current material outcome is already recorded.' :
      message.includes('already active') ? 'Material outcome learning is already enabled.' :
      message.includes('No active') ? 'Material outcome learning is already disabled.' : 'Material outcome details are invalid.',
  });
  else if (error && error.code === 'P0002') {
    result.status = 409;
    if (constraint === 'native_material_plan_unavailable') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_PLAN_REQUIRED', message: 'Adopt a current multi-line material plan before comparing recorded use.' });
    else if (constraint === 'native_material_completion_unavailable') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_COMPLETION_REQUIRED', message: 'Finish the selected job before comparing material use.' });
    else if (constraint === 'native_material_binding_unavailable') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_BINDING_REQUIRED', message: 'Each planned material line needs one unique exact recorded item reference.' });
    else if (constraint === 'native_material_review_required') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_REVIEW_REQUIRED', message: 'Review the current material movement records before comparing them.' });
    else if (constraint === 'native_material_unit_mismatch') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_UNIT_REQUIRED', message: 'Planned and recorded material units must already match. No conversion was inferred.' });
    else if (constraint === 'native_material_usage_unavailable') Object.assign(result, { code: 'M25_NATIVE_MATERIAL_EVIDENCE_REQUIRED', message: 'Record accepted material consumption or waste for every planned line.' });
    else Object.assign(result, { code: 'M25_NATIVE_MATERIAL_ESTIMATE_UNAVAILABLE', status: 404, message: 'That estimate or job is unavailable in the current business.' });
  }
  return result;
}
async function transaction(pool, isolation, work) {
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
      if (error && error.code === '40001' && attempt < 2) continue;
      throw mapped(error);
    } finally { client.release(); }
  }
  throw mapped(new Error('Material outcome transaction retry limit reached.'));
}
const actor = input => [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId];
function readConsent(pool, input) { return transaction(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_material_learning_consent_read($1,$2,$3,$4) value', actor(input))).rows[0].value); }
function mutateConsent(pool, input) { return transaction(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_material_learning_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
    [...actor(input),input.csrfToken,input.idempotencyKey,JSON.stringify(input.body)])).rows[0].value); }
function observe(pool, input) { return transaction(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_native_material_outcome_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) value',
    [...actor(input),input.csrfToken,input.idempotencyKey,input.estimateId,input.executionId,input.expectedConsentRevision,input.expectedConsentDigest,
      JSON.stringify(input.bindings),input.reason,input.confirmed,input.confirmationVersion])).rows[0].value); }
function readOutcome(pool, input) { return transaction(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_native_material_outcome_read($1,$2,$3,$4,$5,$6) value',
    [...actor(input),input.estimateId,input.executionId])).rows[0].value); }
module.exports = { readConsent, mutateConsent, observe, readOutcome };
