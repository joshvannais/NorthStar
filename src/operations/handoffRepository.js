'use strict';
const VERSION = 'm23-downstream-handoffs-v1';
const MISSIONS = Object.freeze([
  { mission: 24, label: 'Estimating', boundary: 'Human-reviewed estimate inputs; no price or quote approval.' },
  { mission: 25, label: 'Private learning', boundary: 'Permitted tenant source references only; no learning or aggregation is enabled.' },
  { mission: 26, label: 'Business intelligence', boundary: 'Evidence references for future metrics; predictions remain separate from facts.' },
  { mission: 27, label: 'Customer lifecycle', boundary: 'Internal review only; no customer message, acceptance, invoice or payment.' },
  { mission: 28, label: 'Business automation', boundary: 'Future owner-controlled review; no trigger or action is enabled.' },
  { mission: 29, label: 'Enterprise governance', boundary: 'Individual attribution and tenant isolation remain required.' },
  { mission: 30, label: 'NorthStar OS', boundary: 'Compose accepted authorities without changing their source records.' },
  { mission: 31, label: 'Interactive experience', boundary: 'Synthetic data only. Real operational references cannot enter the public simulation.', available: false },
  { mission: 32, label: 'Estimate Studio', boundary: 'Future non-binding draft inputs; conversion requires separate human approval.' },
]);
function error(cause) {
  const status = ['42501','P0002'].includes(cause?.code) ? 404 : ['40001','40P01','23505'].includes(cause?.code) ? 409 :
    ['22023','22P02'].includes(cause?.code) ? 400 : cause?.code === '54000' ? 429 : 503;
  return Object.assign(new Error(status === 409 ? 'Handoff or source references changed. Reload before preparing another receipt.' :
    status === 400 ? 'Handoff request or explicit consent is invalid.' : status === 429 ? 'This work exceeds the bounded handoff limit.' :
    'Handoff review is unavailable or access has changed.'), { status, code: 'HANDOFF_UNAVAILABLE' });
}
async function handoff(pool, input, body) {
  if (!pool || typeof pool.connect !== 'function') throw error();
  const write = body !== undefined, identity = `${input.organizationId}:${input.executionId}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await pool.connect(); let authorityLock = false, workLock = false, discard = false;
    try {
      await client.query("SET statement_timeout='5000ms'"); await client.query("SET lock_timeout='2000ms'");
      await client.query("SET idle_in_transaction_session_timeout='5000ms'"); await client.query("SET transaction_timeout='10000ms'");
      await client.query('SELECT pg_advisory_lock_shared(230004,4)'); authorityLock = true;
      await client.query(write ? 'SELECT pg_advisory_lock(230007,hashtext($1))' : 'SELECT pg_advisory_lock_shared(230007,hashtext($1))', [identity]); workLock = true;
      await client.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
      const args = [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.executionId];
      const sql = write ? 'SELECT public.canonical_handoff_mutate($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result' :
        'SELECT public.canonical_handoff_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid) AS result';
      if (write) args.push(input.csrfToken,input.idempotencyKey,body);
      const value = (await client.query(sql,args)).rows[0]?.result;
      if (!value || Buffer.byteLength(JSON.stringify(value)) > 524288 || (write ? !value.receipt?.id : value.version !== VERSION)) throw error();
      await client.query('COMMIT');
      return write ? value : { ...value, missions: MISSIONS };
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => { discard = true; });
      if (write && ['40001','40P01'].includes(cause?.code) && !String(cause.constraint || '').includes('stale') && attempt < 2) continue;
      throw cause?.code === 'HANDOFF_UNAVAILABLE' ? cause : error(cause);
    } finally {
      if (workLock) await client.query(write ? 'SELECT pg_advisory_unlock(230007,hashtext($1))' : 'SELECT pg_advisory_unlock_shared(230007,hashtext($1))',[identity]).catch(() => { discard = true; });
      if (authorityLock) await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(() => { discard = true; });
      await client.query('RESET ALL').catch(() => { discard = true; }); client.release(discard);
    }
  }
  throw error();
}
module.exports = { handoff, MISSIONS, VERSION };
