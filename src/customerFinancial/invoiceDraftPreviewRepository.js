'use strict';

const contract = require('./invoiceDraftPreview');
const originRepository = require('./invoiceDraftOriginRepository');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
function restricted(code, status, message) { return Object.assign(new Error(message), { code, status }); }
function refs(estimateId, receiptId, receiptDigest) {
  if (!UUID.test(estimateId || '') || !UUID.test(receiptId || '') || !DIGEST.test(receiptDigest || '')) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_PREVIEW_INVALID', 400, 'Select one exact current invoice draft.');
  }
}
async function read(pool, source, estimateId, receiptId, receiptDigest) {
  originRepository.actor(source); refs(estimateId, receiptId, receiptDigest);
  const client = await pool.connect(); let begun = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); begun = true;
    await client.query("SET LOCAL statement_timeout='15s'"); await client.query("SET LOCAL lock_timeout='3s'");
    const value = (await client.query(
      `SELECT public.canonical_customer_financial_invoice_draft_preview_v1_read($1,$2,$3,$4,$5,$6,$7) value`,
      [source.organizationId, source.actorUserId, source.actorAccessRole, source.authSessionId,
        estimateId.toLowerCase(), receiptId.toLowerCase(), receiptDigest])).rows[0]?.value;
    await client.query('COMMIT'); begun = false;
    return value?.state === 'unavailable' ? contract.unavailable(value) : contract.project(value);
  } catch (error) { if (begun) await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
module.exports = { read, refs };
