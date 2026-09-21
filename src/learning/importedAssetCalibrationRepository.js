'use strict';

function mapped(error) {
  const constraint = String(error && error.constraint || '');
  const result = Object.assign(new Error('Vehicle and equipment calibration is temporarily unavailable.'),
    { code: 'M25_IMPORTED_ASSET_CALIBRATION_UNAVAILABLE', status: 503, cause: error });
  if (error && error.code === '42501') Object.assign(result, {
    code: 'M25_IMPORTED_ASSET_CALIBRATION_FORBIDDEN', status: 403,
    message: 'Vehicle and equipment calibration is restricted to current owners and administrators.',
  });
  else if (error && error.code === '40001') Object.assign(result, {
    code: 'M25_IMPORTED_ASSET_CALIBRATION_CHANGED', status: 409,
    message: 'Calibration consent or current vehicle and equipment evidence changed. Refresh before continuing.',
  });
  else if (error && error.code === '23505') Object.assign(result, {
    code: 'M25_IMPORTED_ASSET_CALIBRATION_KEY_CONFLICT', status: 409,
    message: 'That request key was already used for different calibration details.',
  });
  else if (error && error.code === '22023') Object.assign(result,
    constraint === 'imported_asset_calibration_already_current' ? {
      code: 'M25_IMPORTED_ASSET_CALIBRATION_CURRENT', status: 409,
      message: 'The current vehicle and equipment calibration is already recorded.',
    } : { code: 'M25_IMPORTED_ASSET_CALIBRATION_INPUT_INVALID', status: 400,
      message: 'Vehicle and equipment calibration details are invalid.' });
  else if (error && error.code === 'P0002') Object.assign(result, {
    code: constraint.includes('sample_insufficient') ? 'M25_IMPORTED_ASSET_CALIBRATION_SAMPLE_REQUIRED' :
      'M25_IMPORTED_ASSET_CALIBRATION_EVIDENCE_INCOMPLETE', status: 409,
    message: constraint === 'imported_asset_calibration_sample_insufficient' ?
      'At least five current reviewed vehicle and equipment outcomes for this service are required.' :
      constraint === 'imported_asset_calibration_dimension_sample_insufficient' ?
        'At least one vehicle or equipment dimension needs five comparable current outcomes.' :
        'Current reviewed vehicle and equipment outcomes are required.',
  });
  return result;
}

async function tx(pool, isolation, work) {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const value = await work(client); await client.query('COMMIT'); return value;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw mapped(error); } finally { client.release(); }
}

const actor = input => [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
function readConsent(pool, input) { return tx(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_imported_asset_calibration_consent_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value); }
function mutateConsent(pool, input) { return tx(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_imported_asset_calibration_consent_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value', [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value); }
function propose(pool, input) { return tx(pool, 'SERIALIZABLE', async client =>
  (await client.query('SELECT public.canonical_imported_asset_calibration_propose($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value', [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, input.serviceKey, input.expectedConsentRevision, input.expectedConsentDigest, input.reason, input.confirmed, input.confirmationVersion])).rows[0].value); }
function read(pool, input) { return tx(pool, 'REPEATABLE READ READ ONLY', async client =>
  (await client.query('SELECT public.canonical_imported_asset_calibration_read($1,$2,$3,$4,$5,$6) value', [...actor(input), input.sourceKey, input.serviceKey])).rows[0].value); }
module.exports = { readConsent, mutateConsent, propose, read };
