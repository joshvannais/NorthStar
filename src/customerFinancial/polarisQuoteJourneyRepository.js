'use strict';

const contract = require('./polarisQuoteJourney');
const basisRepository = require('./editableEstimateBasisRepository');
const { PURPOSE, POLICY_VERSION } = require('./estimateJourneyGrantIssuer');

const CAP_EDIT_DRAFT = 'customer_financial.estimate.edit_draft';
const CAP_EDIT_OPTIONS = 'customer_financial.estimate.edit_options';
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
function checkedHistoryPage(raw = {}) {
  const limit = raw.limit === undefined ? 20 : Number(raw.limit);
  const beforeRevision = raw.beforeRevision === undefined || raw.beforeRevision === null ? null :
    Number(raw.beforeRevision);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 ||
      (beforeRevision !== null && (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1))) {
    throw failure('CUSTOMER_FINANCIAL_QUOTE_JOURNEY_INVALID',
      'Choose a valid bounded revision-history page.');
  }
  return Object.freeze({ limit, beforeRevision });
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
async function readSaved(client, source, estimateId, historyPage = {}) {
  const page = checkedHistoryPage(historyPage);
  return (await client.query(
    'SELECT public.canonical_customer_financial_estimate_journey_v1_read($1,$2,$3,$4,$5,$6,$7) value',
    [source.organizationId, source.actorUserId, source.actorAccessRole,
      source.authSessionId, estimateId, page.limit, page.beforeRevision])).rows[0]?.value;
}
async function read(pool, source, estimateId, historyPage = {}, dependencies = {}) {
  estimateId = checkedId(estimateId, 'estimate');
  return withCommercialFence(pool, source.organizationId, async client => {
    const saved = await readSaved(client, source, estimateId, historyPage);
    if (saved?.state === 'source_currentness_unavailable') return contract.unavailable(
      'source_currentness_unavailable', ['mission24.current_customer_estimate_version']);
    if (saved?.draft) return Object.freeze({ ...saved,
      capabilities: Object.freeze(saved.capabilities || {}), providerCallCount: 0,
      receiverMutationCount: 0 });
    if (source.actorAccessRole === 'member') return contract.unavailable(
      'mission24_current_estimate_unavailable', ['owner_admin.current_mission24_source_review']);
    const readBasis = dependencies.readBasis || basisRepository.read;
    const basis = await readBasis(pool, source, estimateId);
    if (basis?.state === 'unavailable') return contract.unavailable(basis.reason,
      ['mission24.current_accepted_estimate']);
    return Object.freeze({ ...contract.draftFromBasis(basis),
      sourceProposal: saved?.sourceProposal || null,
      capabilities: Object.freeze(saved?.capabilities || {}),
      signature: contract.unavailable('legal_review_unavailable', [
        'mission24.current_source_proposal_digest', 'mission24.reviewed_recipient',
        'professional_review.legal',
      ]),
      workHandoff: contract.unavailable('work_handoff_receiver_unavailable',
        ['mission23.work_intake.review.v1.receiver']), providerCallCount: 0,
      receiverMutationCount: 0 });
  });
}
async function save(pool, source, estimateId, raw, dependencies = {}) {
  estimateId = checkedId(estimateId, 'estimate');
  const capability = raw?.draft?.options?.length > 1 ? CAP_EDIT_OPTIONS : CAP_EDIT_DRAFT;
  checkedMutation(source, raw, capability, contract.CONTRACT_VERSION);
  return withCommercialFence(pool, source.organizationId, async client => {
    let draftSource;
    if (source.actorAccessRole === 'member') {
      const saved = await readSaved(client, source, estimateId);
      if (!saved?.draft || saved.state !== 'current') throw failure(
        'CUSTOMER_FINANCIAL_QUOTE_SOURCE_UNAVAILABLE',
        'A current owner-reviewed Mission 24 source is required before a member can edit.', 409);
      draftSource = saved.draft;
    } else {
      const basis = await (dependencies.readBasis || basisRepository.read)(pool, source, estimateId);
      if (basis?.state === 'unavailable') throw failure('CUSTOMER_FINANCIAL_QUOTE_SOURCE_UNAVAILABLE',
        'The current Mission 24 estimate is unavailable.', 409);
      draftSource = { estimateId, customerId: basis.estimate.customerId,
        sourceDigest: basis.currentness.sourceDigest,
        sourceRevisionDigest: basis.revision.digest,
        sourceProposalDigest: basis.revision.documentDigest,
        sourceProposalRevisionDigest: basis.revision.digest };
    }
    const normalized = contract.normalizeDraft(raw.draft, draftSource);
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
async function requestHandoff(pool, source, estimateId, raw) {
  checkedId(estimateId, 'estimate');
  checkedMutation(source, raw, CAP_REQUEST_HANDOFF, 'm27-polaris-work-handoff-review-v1');
  return Object.freeze({ state: 'unavailable', reason: 'work_handoff_receiver_unavailable',
    value: null, missingEvidence: Object.freeze(['mission23.work_intake.review.v1.receiver']),
    available: false, refreshRequired: true, providerCallCount: 0, receiverMutationCount: 0,
    schedulingMutationCount: 0, workMutationCount: 0, financialActionAuthorized: false });
}

module.exports = { read, save, requestHandoff, withCommercialFence, readSaved,
  checkedMutation, checkedHistoryPage, CAP_EDIT_DRAFT, CAP_EDIT_OPTIONS, CAP_REQUEST_HANDOFF };
