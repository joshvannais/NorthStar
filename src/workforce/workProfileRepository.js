'use strict';
const { normalizeAction, certificationState } = require('./workProfileContract');
function mapped(error) {
  const code = error && error.code;
  const category = ['40001','23505','40P01','55P03'].includes(code) ? [409,'WORK_PROFILE_CONFLICT','The profile changed. Reload the current version before deciding.']
    : code === '42501' ? [403,'WORK_PROFILE_FORBIDDEN','Current profile access is unavailable.']
      : code === 'P0002' ? [404,'WORK_PROFILE_NOT_FOUND','Work profile not found.']
        : ['22023','22007','22008'].includes(code) ? [400,'WORK_PROFILE_INVALID','The submitted profile information is invalid.']
          : [503,'WORK_PROFILE_UNAVAILABLE','Work profiles are temporarily unavailable.'];
  return Object.assign(new Error(category[2]), { status: category[0], code: category[1] });
}
async function transaction(pool, readOnly, operation) {
  if (!pool || typeof pool.connect !== 'function') throw mapped(null);
  let client;
  try {
    client = await pool.connect();
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await client.query("SET LOCAL statement_timeout='15000ms'");
    await client.query("SET LOCAL lock_timeout='3000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error && error.status) throw error;
    throw mapped(error);
  } finally { if (client) client.release(); }
}
const actor = input => [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId];
async function readProfile(pool, input, target = null, historyOffset = 0) {
  return transaction(pool, true, async client => {
    const data = (await client.query('SELECT public.canonical_work_profile_read($1,$2,$3,$4,$5,$6) AS data', [...actor(input),target,historyOffset])).rows[0].data;
    const today = new Date(data.serverNow).toISOString().slice(0,10);
    data.certifications = data.profile.document ? data.profile.document.certifications.map(cert => ({ ...cert,
      state: data.person.membershipStatus !== 'active' || data.person.accountStatus !== 'active' ? 'revoked' : certificationState(cert,data.profile.status,data.profile.verifiedCertificationIds,today) })) : [];
    return data;
  });
}
async function directory(pool, input, after = null) {
  return transaction(pool,true,async client => (await client.query('SELECT public.canonical_work_profile_directory($1,$2,$3,$4,$5) AS data',[...actor(input),after])).rows[0].data);
}
async function mutate(pool, input, target, requestKey, body) {
  // PostgreSQL checks time for new requests after checking durable retry identity.
  // A confirmed request remains replayable after its availability window ends.
  normalizeAction(body, null);
  return transaction(pool,false,async client => (await client.query('SELECT public.canonical_work_profile_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS data',
    [...actor(input),input.csrfToken,target,requestKey,JSON.stringify(body)])).rows[0].data);
}
module.exports = { readProfile,directory,mutate };
