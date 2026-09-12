'use strict';
const contract = require('./materialAdoptionContract');
const policy = require('./materialAdoptionPolicy');
function failure(error) {
  if (error?.status) return error;
  const status = error?.code === '42501' ? 403 : error?.code === 'P0002' ? 404 :
    ['40001', '40P01', '23505'].includes(error?.code) ? 409 : ['22023', '22P02'].includes(error?.code) ? 400 : error?.code === '54000' ? 429 : 503;
  return Object.assign(new Error(status === 409 ? 'The estimate or cost plan changed. Refresh and review it again.' :
    status === 403 ? 'Your current account cannot change this estimate.' : status === 400 ? 'Review the cost plan and confirmation before continuing.' :
    'Estimate changes are unavailable. Saved estimates remain available.'), { status, code: 'ESTIMATE_ADOPTION_UNAVAILABLE' });
}
function args(input) { return [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId, input.estimateId]; }
async function readRevisions(client, input, selected = null) {
  try { return (await client.query('SELECT public.canonical_estimate_revision_read($1,$2,$3,$4,$5,$6) result', [...args(input), selected])).rows[0].result; }
  catch (error) { throw failure(error); }
}
async function readSelectedDecisions(client, input, selected = null) {
  try { return (await client.query('SELECT public.canonical_estimate_revision_decisions($1,$2,$3,$4,$5,$6) result', [...args(input), selected])).rows[0].result; }
  catch (error) { throw failure(error); }
}
async function mutateAdoption(pool, input, raw, prepare) {
  if (!policy.mutationsEnabled) throw Object.assign(new Error('New estimate changes are paused. Saved estimates remain available.'), { status: 503,code:'ESTIMATE_ADOPTION_PAUSED' });
  const body = contract.normalize(raw), client = await pool.connect(); let discard = false,locked=false;
  try {
    if(body.confirmationVersion==='estimate-cost-adoption-v2'){await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;}
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL statement_timeout='10000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
    // Protected SQL checks current authority before replay and source binding after
    // the shared estimate lock. Derive every receipt within this same snapshot;
    // a calculation failure rolls the insertion back, including overflow.
    const result = (await client.query('SELECT public.canonical_estimate_revision_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',
      [...args(input), input.csrfToken, input.idempotencyKey, body])).rows[0].result;
    await prepare(client, result.receipt);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => { discard = true; }); throw failure(error); }
  finally { if(locked){await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});}client.release(discard); }
}
module.exports = { readRevisions, readSelectedDecisions, mutateAdoption };
