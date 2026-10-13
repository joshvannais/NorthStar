'use strict';

const contract = require('./invoiceDraftRevision');
const originRepository = require('./invoiceDraftOriginRepository');
const { BUSINESS_PURPOSE, POLICY_VERSION } = require('./invoiceDraftGrantIssuer');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function restricted(code, status, message) { return Object.assign(new Error(message), { code, status }); }
function refs(estimateId, receiptId, receiptDigest) {
  if (!UUID.test(estimateId || '') || !UUID.test(receiptId || '') || !DIGEST.test(receiptDigest || ''))
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID', 400,
      'Select one exact current invoice draft.');
}
function normalize(value) {
  return value?.state === 'unavailable' ? contract.unavailable(value) : contract.project(value);
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
async function read(pool, source, estimateId, receiptId, receiptDigest) {
  originRepository.actor(source); refs(estimateId, receiptId, receiptDigest);
  return transaction(pool, async client => normalize((await client.query(
    `SELECT public.canonical_customer_financial_invoice_draft_revision_v1_read(
      $1,$2,$3,$4,$5,$6,$7) value`, [source.organizationId, source.actorUserId,
      source.actorAccessRole, source.authSessionId, estimateId.toLowerCase(),
      receiptId.toLowerCase(), receiptDigest])).rows[0]?.value));
}
function validateAttempt(raw) {
  const allowed = new Set(['handoffReceiptId','handoffReceiptDigest','capabilityGrantId',
    'capabilityGrantRevision','businessPurpose','policyVersion','expectedRevision',
    'expectedDraftDigest','draft','reason','confirmed','confirmationVersion']);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !allowed.has(key)) || !UUID.test(raw.handoffReceiptId || '') ||
      !DIGEST.test(raw.handoffReceiptDigest || '') || !UUID.test(raw.capabilityGrantId || '') ||
      !Number.isSafeInteger(raw.capabilityGrantRevision) || raw.capabilityGrantRevision < 1 ||
      raw.businessPurpose !== BUSINESS_PURPOSE || raw.policyVersion !== POLICY_VERSION ||
      !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0 ||
      !DIGEST.test(raw.expectedDraftDigest || '') || raw.confirmed !== true ||
      raw.confirmationVersion !== contract.CONFIRMATION_VERSION || typeof raw.reason !== 'string' ||
      raw.reason.trim() !== raw.reason || raw.reason.length < 12 || raw.reason.length > 1000) {
    throw restricted('CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID', 400,
      'Refresh, review, and confirm this exact invoice draft.');
  }
  try { return contract.normalizeEdit(raw.draft); }
  catch (_error) { throw restricted('CUSTOMER_FINANCIAL_INVOICE_DRAFT_INVALID', 400,
    'Refresh, review, and confirm this exact invoice draft.'); }
}
async function save(pool, source, estimateId, raw) {
  originRepository.actor(source, true); const draft = validateAttempt(raw);
  refs(estimateId, raw.handoffReceiptId, raw.handoffReceiptDigest);
  return transaction(pool, async client => {
    const result = (await client.query(
      `SELECT public.canonical_customer_financial_invoice_draft_revision_v1_save(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19) value`,
    [source.organizationId, source.actorUserId, source.actorAccessRole, source.authSessionId,
      source.csrfToken, source.idempotencyKey, estimateId.toLowerCase(), raw.handoffReceiptId,
      raw.handoffReceiptDigest, raw.capabilityGrantId, raw.capabilityGrantRevision,
      raw.businessPurpose, raw.policyVersion, raw.expectedRevision, raw.expectedDraftDigest,
      draft.originId, JSON.stringify(draft), raw.reason, raw.confirmationVersion])).rows[0]?.value;
    if (!result || ![200,201].includes(result.status)) throw new Error('Invoice-draft revision save invalid');
    return { status: result.status, replayed: result.replayed === true, body: normalize(result.body) };
  });
}

module.exports = { read, save, validateAttempt };
