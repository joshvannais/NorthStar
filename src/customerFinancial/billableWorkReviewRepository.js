'use strict';

const contract = require('./billableWorkReview');
const { BUSINESS_PURPOSE, POLICY_VERSION } = require('./billableWorkReviewGrantIssuer');

function failure(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}
function checkedSourceClass(value) {
  if (![contract.FINAL_BALANCE, contract.PRE_WORK_DEPOSIT, contract.MILESTONE].includes(value)) {
    throw failure('CUSTOMER_FINANCIAL_BILLABLE_SOURCE_INVALID',
      'Choose a supported billable-work source.', 400);
  }
  return value;
}
function assertAttempt(raw) {
  const allowed = new Set(['sourceClass','expectedDecisionDigest','capabilityGrantId',
    'capabilityGrantRevision','businessPurpose','policyVersion','reason','confirmed',
    'confirmationVersion']);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.confirmed !== true ||
      Object.keys(raw).some(key => !allowed.has(key)) ||
      raw.confirmationVersion !== contract.CONTRACT_VERSION ||
      !/^[0-9a-f]{64}$/.test(raw.expectedDecisionDigest || '') ||
      raw.capabilityGrantId === undefined || !Number.isSafeInteger(raw.capabilityGrantRevision) ||
      raw.capabilityGrantRevision < 1 || raw.businessPurpose !== BUSINESS_PURPOSE ||
      raw.policyVersion !== POLICY_VERSION || typeof raw.reason !== 'string' ||
      raw.reason.trim() !== raw.reason || raw.reason.length < 12 || raw.reason.length > 1000) {
    throw failure('CUSTOMER_FINANCIAL_BILLABLE_REVIEW_INVALID',
      'Refresh the source, review the reason, and confirm this exact decision.', 400);
  }
}
async function withinCommercialFence(pool, organizationId, action) {
  const client = await pool.connect(); let authorityLock = false; let transaction = false;
  let discard = false;
  try {
    await client.query("SET statement_timeout='15s'"); await client.query("SET lock_timeout='3s'");
    await client.query('SELECT pg_advisory_lock_shared(230004,4)'); authorityLock = true;
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); transaction = true;
    await client.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [organizationId]);
    const result = await action(client); await client.query('COMMIT'); transaction = false; return result;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => { discard = true; }); throw error;
  } finally {
    if (authorityLock) await client.query('SELECT pg_advisory_unlock_shared(230004,4)')
      .catch(() => { discard = true; });
    await client.query('RESET ALL').catch(() => { discard = true; }); client.release(discard);
  }
}
async function databaseRead(client, source, estimateId, sourceClass) {
  return (await client.query(
    `SELECT public.canonical_customer_financial_billable_review_v1_read(
      $1,$2,$3,$4,$5,$6) result`, [source.organizationId, source.actorUserId,
      source.actorAccessRole, source.authSessionId, estimateId, sourceClass])).rows[0]?.result;
}
async function candidate(pool, source, estimateId, sourceClass) {
  const selected = checkedSourceClass(sourceClass);
  if (selected === contract.MILESTONE) return contract.candidate(selected, null);
  return withinCommercialFence(pool, source.organizationId,
    client => databaseRead(client, source, estimateId, selected));
}
async function callAccept(client, source, estimateId, raw) {
  assertAttempt(raw);
  const value = (await client.query(
    `SELECT public.canonical_customer_financial_billable_review_v1_accept(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) result`,
    [source.organizationId, source.actorUserId, source.actorAccessRole, source.authSessionId,
      source.csrfToken, source.idempotencyKey, estimateId, raw.capabilityGrantId,
      raw.capabilityGrantRevision, raw.businessPurpose, raw.policyVersion, raw.sourceClass,
      raw.expectedDecisionDigest, raw.reason, raw.confirmationVersion])).rows[0]?.result;
  if (!value?.body || ![200,201,202].includes(value.status)) throw new Error('Billable review invalid');
  return value;
}
async function accept(pool, source, estimateId, raw) {
  const selected = checkedSourceClass(raw?.sourceClass);
  if (selected === contract.MILESTONE) throw failure('CUSTOMER_FINANCIAL_MILESTONE_UNSUPPORTED',
    'Milestone billing needs separately accepted Mission 23 work-package authority.', 422);
  assertAttempt(raw);
  return withinCommercialFence(pool, source.organizationId,
    client => callAccept(client, source, estimateId, raw));
}
async function read(pool, source, estimateId, sourceClass) {
  return candidate(pool, source, estimateId, sourceClass);
}

module.exports = { candidate, accept, read, callAccept, withinCommercialFence,
  checkedSourceClass, databaseRead };
