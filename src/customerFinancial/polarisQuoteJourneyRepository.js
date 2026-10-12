'use strict';

const crypto = require('node:crypto');
const contract = require('./polarisQuoteJourney');
const basisRepository = require('./editableEstimateBasisRepository');
const { PURPOSE, POLICY_VERSION } = require('./estimateJourneyGrantIssuer');

const CAP_EDIT_DRAFT = 'customer_financial.estimate.edit_draft';
const CAP_EDIT_OPTIONS = 'customer_financial.estimate.edit_options';
const CAP_REQUEST_SIGNATURE = 'customer_financial.estimate.request_signature';
const CAP_REQUEST_HANDOFF = 'customer_financial.estimate.request_work_handoff';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
function checkedId(value, label) {
  if (!UUID.test(value || '')) throw failure('CUSTOMER_FINANCIAL_QUOTE_JOURNEY_INVALID',
    `Choose one exact ${label}.`);
  return value.toLowerCase();
}
function checkedMutation(source, raw, capability, confirmationVersion) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      !UUID.test(raw.capabilityGrantId || '') || !Number.isSafeInteger(raw.capabilityGrantRevision) ||
      raw.capabilityGrantRevision < 1 || raw.businessPurpose !== PURPOSE[capability] ||
      raw.policyVersion !== POLICY_VERSION || raw.confirmed !== true ||
      raw.confirmationVersion !== confirmationVersion || typeof raw.reason !== 'string' ||
      raw.reason !== raw.reason.trim() || raw.reason.length < 12 || raw.reason.length > 1000 ||
      typeof source.csrfToken !== 'string' || source.csrfToken.length < 16 ||
      typeof source.idempotencyKey !== 'string' || source.idempotencyKey.length < 16 ||
      source.idempotencyKey.length > 200) {
    throw failure('CUSTOMER_FINANCIAL_QUOTE_JOURNEY_INVALID',
      'Refresh this quote, review the reason, and confirm this exact action.');
  }
  return raw;
}
function authorityArgs(source, estimateId, raw, capability) {
  return [source.organizationId, source.actorUserId, source.actorAccessRole,
    source.authSessionId, source.csrfToken, estimateId, raw.capabilityGrantId,
    raw.capabilityGrantRevision, capability, PURPOSE[capability], raw.policyVersion];
}
async function withCommercialFence(pool, organizationId, action) {
  const client = await pool.connect(); let locked = false; let begun = false; let discard = false;
  try {
    await client.query("SET statement_timeout='10s'"); await client.query("SET lock_timeout='2s'");
    await client.query('SELECT pg_advisory_lock_shared(230004,4)'); locked = true;
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); begun = true;
    await client.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [organizationId]);
    const result = await action(client); await client.query('COMMIT'); begun = false; return result;
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => { discard = true; });
    throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock_shared(230004,4)')
      .catch(() => { discard = true; });
    await client.query('RESET ALL').catch(() => { discard = true; });
    client.release(discard);
  }
}
function sameBasis(draft, basis) {
  return draft?.estimateId === basis?.estimate?.id && draft?.customerId === basis?.estimate?.customerId &&
    draft?.sourceDigest === basis?.currentness?.sourceDigest &&
    draft?.sourceRevisionDigest === basis?.revision?.digest;
}
async function read(pool, source, estimateId, dependencies = {}) {
  checkedId(estimateId, 'estimate');
  const readBasis = dependencies.readBasis || basisRepository.read;
  const basis = await readBasis(pool, source, estimateId);
  if (basis?.state === 'unavailable') return contract.unavailable(basis.reason,
    ['mission24.current_accepted_estimate']);
  return withCommercialFence(pool, source.organizationId, async client => {
    const current = await readBasis(pool, source, estimateId);
    if (current?.state === 'unavailable' || current?.digest !== basis.digest) {
      return contract.unavailable('source_currentness_unavailable', ['mission24.current_accepted_estimate']);
    }
    const saved = (await client.query(
      'SELECT public.canonical_customer_financial_estimate_journey_v1_read($1,$2,$3,$4,$5) value',
      [source.organizationId, source.actorUserId, source.actorAccessRole,
        source.authSessionId, estimateId])).rows[0]?.value;
    if (!saved?.draft) return Object.freeze({ ...contract.draftFromBasis(current),
      capabilities: Object.freeze(saved?.capabilities || {}),
      signature: contract.unavailable('legal_review_unavailable', ['professional_review.legal']),
      workHandoff: contract.unavailable('work_handoff_receiver_unavailable',
        ['mission23.work_intake.review.v1.receiver']), providerCallCount: 0,
      receiverMutationCount: 0 });
    if (!sameBasis(saved.draft, current)) return contract.unavailable(
      'source_currentness_unavailable', ['mission24.current_accepted_estimate']);
    let pendingProposal = null;
    if (!saved.proposal && saved.pendingProposal) {
      pendingProposal = contract.proposal(saved.draft, saved.pendingProposal.id,
        Number(saved.pendingProposal.revision), saved.draft.updatedAt);
      if (pendingProposal.proposalDigest !== saved.pendingProposal.proposalDigest) {
        return contract.unavailable('proposal_integrity_unavailable',
          ['mission24.multi_option_proposal.review']);
      }
    }
    return Object.freeze({ ...saved, proposal: saved.proposal || pendingProposal,
      proposalState: saved.proposal ? 'proposal_current' : pendingProposal ?
        'independent_review_required' : null,
      capabilities: Object.freeze(saved.capabilities || {}),
      providerCallCount: 0, receiverMutationCount: 0 });
  });
}
async function save(pool, source, estimateId, raw, dependencies = {}) {
  estimateId = checkedId(estimateId, 'estimate');
  const capability = raw?.draft?.options?.length > 1 ? CAP_EDIT_OPTIONS : CAP_EDIT_DRAFT;
  checkedMutation(source, raw, capability, contract.CONTRACT_VERSION);
  const readBasis = dependencies.readBasis || basisRepository.read;
  return withCommercialFence(pool, source.organizationId, async client => {
    const basis = await readBasis(pool, source, estimateId);
    if (basis?.state === 'unavailable') throw failure('CUSTOMER_FINANCIAL_QUOTE_SOURCE_UNAVAILABLE',
      'The current Mission 24 estimate is unavailable.', 409);
    const normalized = contract.normalizeDraft(raw.draft, { estimateId,
      customerId: basis.estimate.customerId, sourceDigest: basis.currentness.sourceDigest,
      sourceRevisionDigest: basis.revision.digest });
    const expectedRevision = Number(raw.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw failure(
      'CUSTOMER_FINANCIAL_QUOTE_JOURNEY_INVALID', 'Refresh the draft before saving.');
    const value = (await client.query(
      `SELECT public.canonical_customer_financial_estimate_journey_v1_save_draft(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) value`,
      [...authorityArgs(source, estimateId, raw, capability), source.idempotencyKey,
        expectedRevision, JSON.stringify(normalized), raw.reason, raw.confirmationVersion])).rows[0]?.value;
    if (!value?.draft || value.draft.draftDigest !== normalized.draftDigest) throw new Error('Quote save invalid');
    return value;
  });
}
async function requestProposal(pool, source, estimateId, raw, dependencies = {}) {
  estimateId = checkedId(estimateId, 'estimate');
  checkedMutation(source, raw, CAP_REQUEST_SIGNATURE, 'm27-polaris-proposal-review-v1');
  return withCommercialFence(pool, source.organizationId, async client => {
    const basis = await (dependencies.readBasis || basisRepository.read)(pool, source, estimateId);
    if (basis?.state === 'unavailable') throw failure('CUSTOMER_FINANCIAL_QUOTE_SOURCE_UNAVAILABLE',
      'The current Mission 24 estimate is unavailable.', 409);
    const saved = (await client.query(
      'SELECT public.canonical_customer_financial_estimate_journey_v1_read($1,$2,$3,$4,$5) value',
      [source.organizationId, source.actorUserId, source.actorAccessRole,
        source.authSessionId, estimateId])).rows[0]?.value;
    if (!saved?.draft || !sameBasis(saved.draft, basis) ||
        saved.draft.draftDigest !== raw.expectedDraftDigest ||
        Number(saved.draft.revision) !== Number(raw.expectedDraftRevision)) {
      throw failure('CUSTOMER_FINANCIAL_QUOTE_DRAFT_CHANGED',
        'The quote changed. Refresh and review it again.', 409);
    }
    const proposal = contract.proposal(saved.draft, raw.proposalId,
      Number(raw.proposalRevision), saved.draft.updatedAt);
    const value = (await client.query(
      `SELECT public.canonical_customer_financial_estimate_journey_v1_proposal(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) value`,
      [...authorityArgs(source, estimateId, raw, CAP_REQUEST_SIGNATURE), source.idempotencyKey,
        JSON.stringify(proposal), raw.reason, raw.confirmationVersion])).rows[0]?.value;
    if (!value?.proposal || value.proposal.proposalDigest !== proposal.proposalDigest) {
      throw new Error('Proposal request invalid');
    }
    return value;
  });
}
async function requestHandoff(pool, source, estimateId, raw) {
  checkedId(estimateId, 'estimate');
  checkedMutation(source, raw, CAP_REQUEST_HANDOFF, 'm27-polaris-work-handoff-review-v1');
  return Object.freeze({ state: 'unavailable', reason: 'work_handoff_receiver_unavailable',
    value: null, missingEvidence: Object.freeze(['mission23.work_intake.review.v1.receiver']),
    available: false, refreshRequired: true, providerCallCount: 0, receiverMutationCount: 0,
    schedulingMutationCount: 0, workMutationCount: 0, financialActionAuthorized: false });
}

module.exports = { read, save, requestProposal, requestHandoff, withCommercialFence,
  checkedMutation, CAP_EDIT_DRAFT, CAP_EDIT_OPTIONS, CAP_REQUEST_SIGNATURE, CAP_REQUEST_HANDOFF };
