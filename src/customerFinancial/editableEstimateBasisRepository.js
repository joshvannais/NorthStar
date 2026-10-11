'use strict';

const adapter = require('./editableEstimateBasis');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted(code, status, message) {
  const error = new Error(message); error.code = code; error.status = status; return error;
}
function actor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !UUID.test(value.organizationId || '') || !UUID.test(value.actorUserId || '') ||
      !UUID.test(value.authSessionId || '') || !['owner','admin'].includes(value.actorAccessRole)) {
    throw restricted('CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_RESTRICTED', 403,
      'Editable estimate access is restricted.');
  }
}
async function read(pool, source, estimateId) {
  actor(source);
  if (!UUID.test(estimateId || '')) throw restricted(
    'CUSTOMER_FINANCIAL_EDITABLE_ESTIMATE_INVALID', 400, 'Select one exact estimate.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const raw = (await client.query(
      'SELECT public.canonical_customer_financial_editable_basis_v1_read($1,$2,$3,$4,$5) value',
      [source.organizationId, source.actorUserId, source.actorAccessRole,
        source.authSessionId, estimateId.toLowerCase()])).rows[0]?.value;
    const result = raw?.state === 'unavailable' ? adapter.unavailable(raw) : adapter.project(raw);
    await client.query('COMMIT'); return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

module.exports = { read, actor };
