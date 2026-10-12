'use strict';

const contract = require('./invoiceDraftOrigin');
const { BUSINESS_PURPOSE, POLICY_VERSION } = require('./invoiceDraftGrantIssuer');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function restricted(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}
function actor(source, write = false) {
  if (!source || !UUID.test(source.organizationId || '') || !UUID.test(source.actorUserId || '') ||
      !UUID.test(source.authSessionId || '') || !['owner','admin'].includes(source.actorAccessRole) ||
      (write && (typeof source.csrfToken !== 'string' || source.csrfToken.length < 16 ||
        typeof source.idempotencyKey !== 'string' || source.idempotencyKey.length < 16 ||
        source.idempotencyKey.length > 200))) throw restricted(
    'CUSTOMER_FINANCIAL_INVOICE_DRAFT_RESTRICTED', 403, 'Invoice-draft access is restricted.');
}
function refs(estimateId, handoffReceiptId, handoffReceiptDigest) {
  if (!UUID.test(estimateId || '') || !UUID.test(handoffReceiptId || '') ||
      !DIGEST.test(handoffReceiptDigest || '')) throw restricted(
    'CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID', 400, 'Select one exact reviewed handoff.');
}
function validateAttempt(raw) {
  const allowed = new Set(['handoffReceiptId','handoffReceiptDigest','capabilityGrantId',
    'capabilityGrantRevision','businessPurpose','policyVersion','expectedCandidateDigest',
    'reason','confirmed','confirmationVersion']);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !allowed.has(key)) || !UUID.test(raw.handoffReceiptId || '') ||
      !DIGEST.test(raw.handoffReceiptDigest || '') || !UUID.test(raw.capabilityGrantId || '') ||
      !Number.isSafeInteger(raw.capabilityGrantRevision) || raw.capabilityGrantRevision < 1 ||
      raw.businessPurpose !== BUSINESS_PURPOSE || raw.policyVersion !== POLICY_VERSION ||
      !DIGEST.test(raw.expectedCandidateDigest || '') || raw.confirmed !== true ||
      raw.confirmationVersion !== contract.CONFIRMATION_VERSION || typeof raw.reason !== 'string' ||
      raw.reason.trim() !== raw.reason || raw.reason.length < 12 || raw.reason.length > 1000) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID', 400,
      'Refresh and confirm this exact invoice-draft origin.');
  }
}
async function transaction(pool, action) {
  const client = await pool.connect(); let begun = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); begun = true;
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    const result = await action(client); await client.query('COMMIT'); begun = false; return result;
  } catch (error) { if (begun) await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
function normalize(value) {
  return value?.state === 'unavailable' ? contract.unavailable(value) : contract.project(value);
}
async function read(pool, source, estimateId, handoffReceiptId, handoffReceiptDigest) {
  actor(source); refs(estimateId, handoffReceiptId, handoffReceiptDigest);
  return transaction(pool, async client => normalize((await client.query(
    `SELECT public.canonical_customer_financial_invoice_draft_v1_read(
      $1,$2,$3,$4,$5,$6,$7) value`, [source.organizationId, source.actorUserId,
      source.actorAccessRole, source.authSessionId, estimateId.toLowerCase(),
      handoffReceiptId.toLowerCase(), handoffReceiptDigest])).rows[0]?.value));
}
async function capture(pool, source, estimateId, raw) {
  actor(source, true); validateAttempt(raw); refs(estimateId, raw.handoffReceiptId, raw.handoffReceiptDigest);
  return transaction(pool, async client => {
    const result = (await client.query(
      `SELECT public.canonical_customer_financial_invoice_draft_v1_capture(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) value`,
    [source.organizationId, source.actorUserId, source.actorAccessRole, source.authSessionId,
      source.csrfToken, source.idempotencyKey, estimateId.toLowerCase(), raw.handoffReceiptId,
      raw.handoffReceiptDigest, raw.capabilityGrantId, raw.capabilityGrantRevision,
      raw.businessPurpose, raw.policyVersion, raw.expectedCandidateDigest, raw.reason,
      raw.confirmationVersion])).rows[0]?.value;
    if (!result || ![200,201].includes(result.status)) throw new Error('Invoice-draft capture invalid');
    return { status: result.status, replayed: result.replayed === true, body: normalize(result.body) };
  });
}

module.exports = { read, capture, actor, validateAttempt };
