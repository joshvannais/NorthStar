'use strict';

const contract = require('./billableWorkReview');
const basisRepository = require('./editableEstimateBasisRepository');
const workRepository = require('./billableWorkContextRepository');
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
async function candidate(pool, source, estimateId, sourceClass, dependencies = {}) {
  const selected = checkedSourceClass(sourceClass);
  if (selected === contract.MILESTONE) return contract.candidate(selected, null);
  const read = selected === contract.FINAL_BALANCE ?
    (dependencies.readWorkContext || workRepository.read) :
    (dependencies.readBasis || basisRepository.read);
  return contract.candidate(selected, await read(pool, source, estimateId));
}
function assertAttempt(raw, current) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.confirmed !== true ||
      raw.confirmationVersion !== contract.CONTRACT_VERSION ||
      raw.expectedDecisionDigest !== current?.source?.decisionDigest ||
      raw.capabilityGrantId === undefined || !Number.isSafeInteger(raw.capabilityGrantRevision) ||
      raw.capabilityGrantRevision < 1 || raw.businessPurpose !== BUSINESS_PURPOSE ||
      raw.policyVersion !== POLICY_VERSION || typeof raw.reason !== 'string' ||
      raw.reason.trim() !== raw.reason || raw.reason.length < 12 || raw.reason.length > 1000) {
    throw failure('CUSTOMER_FINANCIAL_BILLABLE_REVIEW_INVALID',
      'Refresh the source, review the reason, and confirm this exact decision.', 400);
  }
}
async function callAccept(client, source, estimateId, current, raw) {
  assertAttempt(raw, current);
  const value = (await client.query(
    `SELECT public.canonical_customer_financial_billable_review_v1_accept(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) result`,
    [source.organizationId, source.actorUserId, source.actorAccessRole, source.authSessionId,
      source.csrfToken, source.idempotencyKey, estimateId, raw.capabilityGrantId,
      raw.capabilityGrantRevision, raw.businessPurpose, raw.policyVersion,
      JSON.stringify(current.source), raw.reason, raw.confirmationVersion],
  )).rows[0]?.result;
  if (!value?.body || ![200,201,202].includes(value.status)) throw new Error('Billable review invalid');
  return value;
}
async function withinCommercialFence(pool, organizationId, action) {
  const client = await pool.connect(); let authorityLock = false; let transaction = false;
  let discard = false;
  try {
    await client.query("SET statement_timeout='10s'"); await client.query("SET lock_timeout='2s'");
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
async function accept(pool, source, estimateId, raw, dependencies = {}) {
  const selected = checkedSourceClass(raw?.sourceClass);
  if (selected === contract.MILESTONE) throw failure('CUSTOMER_FINANCIAL_MILESTONE_UNSUPPORTED',
    'Milestone billing needs separately accepted Mission 23 work-package authority.', 422);
  const readCandidate = dependencies.candidate || candidate;
  const initial = await readCandidate(pool, source, estimateId, selected, dependencies);
  if (initial.state !== 'review_required') throw failure(
    initial.reason || 'CUSTOMER_FINANCIAL_BILLABLE_SOURCE_UNAVAILABLE',
    'The selected billable-work source is unavailable.', 409);
  const run = async client => {
    const current = await readCandidate(pool, source, estimateId, selected, dependencies);
    if (current.state !== 'review_required' ||
        current.source.decisionDigest !== initial.source.decisionDigest) {
      throw failure('CUSTOMER_FINANCIAL_BILLABLE_SOURCE_CHANGED',
        'The billable-work source changed. Refresh and review it again.', 409);
    }
    return callAccept(client, source, estimateId, current, raw);
  };
  if (selected === contract.FINAL_BALANCE) {
    return workRepository.withinWorkFence(pool, source.organizationId,
      initial.source.workId, async client => {
        await client.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [source.organizationId]);
        return run(client);
      });
  }
  return withinCommercialFence(pool, source.organizationId, run);
}
async function read(pool, source, estimateId, sourceClass, dependencies = {}) {
  const selected = checkedSourceClass(sourceClass);
  const readCandidate = dependencies.candidate || candidate;
  const initial = await readCandidate(pool, source, estimateId, selected, dependencies);
  if (initial.state !== 'review_required') return initial;
  const run = async client => {
    const current = await readCandidate(pool, source, estimateId, selected, dependencies);
    if (current.state !== 'review_required' ||
        current.source.decisionDigest !== initial.source.decisionDigest) {
      return contract.unavailable('source_currentness_unavailable',
        ['part3c.exact_review_source']);
    }
    const value = (await client.query(
      `SELECT public.canonical_customer_financial_billable_review_v1_read(
        $1,$2,$3,$4,$5,$6) result`, [source.organizationId, source.actorUserId,
        source.actorAccessRole, source.authSessionId, estimateId,
        current.source.decisionDigest],
    )).rows[0]?.result;
    if (!value) return current;
    if (value.sourceDigest !== current.source.sourceDigest ||
        value.sourceAuthorityDigest !== current.source.sourceAuthorityDigest ||
        value.commercialBasisDigest !== current.source.commercialBasisDigest) {
      return contract.unavailable('source_currentness_unavailable',
        ['part3c.exact_review_source']);
    }
    return Object.freeze({ ...value, sourceCurrent: true });
  };
  if (selected === contract.FINAL_BALANCE) {
    return workRepository.withinWorkFence(pool, source.organizationId,
      initial.source.workId, async client => {
        await client.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE',
          [source.organizationId]);
        return run(client);
      });
  }
  return withinCommercialFence(pool, source.organizationId, run);
}

module.exports = { candidate, accept, read, callAccept, withinCommercialFence, checkedSourceClass };
