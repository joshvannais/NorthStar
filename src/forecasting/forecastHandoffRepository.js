'use strict';

const { sha256 } = require('../services/businessProfileAdapter');

const VERSION = 'm26-forecast-reviewed-handoff-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;
const ROLES = new Set(['owner', 'admin']);
const UNAVAILABLE_REASONS = new Set(['run_not_found', 'settings_not_current',
  'dependency_index_unavailable', 'unsupported_source_currentness',
  'source_currentness_unknown', 'algorithm_unknown', 'run_stale',
  'run_identity_unavailable', 'proposal_expired']);

function failure(code, status, message) {
  const error = new Error(message); error.code = code; error.status = status; return error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && keys.includes(key) && descriptor?.enumerable &&
      Object.hasOwn(descriptor, 'value');
  });
}
function dense(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function identity(actor, mutation) {
  const keys = mutation ? ['organizationId','actorUserId','actorAccessRole','authSessionId',
    'csrfToken','idempotencyKey'] :
    ['organizationId','actorUserId','actorAccessRole','authSessionId'];
  if (!exact(actor, keys) || !UUID.test(actor.organizationId || '') ||
      !UUID.test(actor.actorUserId || '') || !UUID.test(actor.authSessionId || '') ||
      !ROLES.has(actor.actorAccessRole) ||
      (mutation && (!KEY.test(actor.idempotencyKey || '') ||
        typeof actor.csrfToken !== 'string'))) {
    throw failure('FORECAST_HANDOFF_ACCESS_RESTRICTED', 403,
      'Reviewed forecast handoffs are restricted.');
  }
}
function validInstant(value) {
  const match = typeof value === 'string' ? INSTANT.exec(value) : null;
  if (!match) return false;
  const comparable = `${match[1]}.${(match[2] || '').padEnd(3, '0').slice(0, 3)}Z`;
  return Number.isFinite(Date.parse(comparable)) &&
    new Date(comparable).toISOString() === comparable;
}
function validReceiver(value) {
  return exact(value, ['mission','workflow','recordId','expectedRevision','expectedDigest',
    'availability','reason','href']) && value.mission === '22' &&
    value.workflow === 'calendar_capacity_review' && value.recordId === null &&
    value.expectedRevision === null && value.expectedDigest === null &&
    value.availability === 'unavailable' &&
    value.reason === 'exact_receiving_record_not_available' && value.href === null;
}
function validEvidence(value, runDigest, outputDigest) {
  return exact(value, ['predictionKind','amount','unit','runDigest','outputDigest']) &&
    value.predictionKind === 'point' && value.unit === 'count' &&
    /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/.test(value.amount || '') &&
    value.runDigest === runDigest && value.outputDigest === outputDigest;
}
function validUncertainty(value) {
  return exact(value, ['state','drivers']) && value.state === 'unquantified' &&
    dense(value.drivers, 12) && value.drivers.every(item =>
      typeof item === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(item));
}
function validRecommendation(value, runDigest, outputDigest) {
  return exact(value, ['type','evidence','uncertainty','missingInformation','tradeoff']) &&
    value.type === 'review_demand_capacity' &&
    validEvidence(value.evidence, runDigest, outputDigest) &&
    validUncertainty(value.uncertainty) && dense(value.missingInformation, 8) &&
    JSON.stringify(value.missingInformation) ===
      JSON.stringify(['calibrated_interval','current_capacity_record','exact_receiving_record']) &&
    typeof value.tradeoff === 'string' && value.tradeoff.length > 0 &&
    value.tradeoff.length <= 500;
}
function validHistory(value, revision) {
  if (!dense(value, 100) || value.length < 1 || value.length !== revision) return false;
  return value.every((event, index) => exact(event,
    ['revision','action','recordedAt','actorUserId','digest']) &&
    event.revision === index + 1 && ['requested','dismissed','consumed','withdrawn']
      .includes(event.action) && validInstant(event.recordedAt) &&
    UUID.test(event.actorUserId || '') && DIGEST.test(event.digest || ''));
}
function validProposal(value, organizationId) {
  if (!exact(value, ['version','id','state','revision','organizationId','createdAt',
    'expiresAt','reviewer','run','recommendation','receiver','history','advisoryOnly',
    'navigationIsApproval','receiverRecheckRequired','automaticActionAuthorized',
    'outboundCommunicationAuthorized','proposalDigest','digest']) ||
    value.version !== VERSION || !UUID.test(value.id || '') ||
    !['requested','dismissed','consumed','withdrawn','expired'].includes(value.state) ||
    !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    value.organizationId !== organizationId || !validInstant(value.createdAt) ||
    !validInstant(value.expiresAt) || value.createdAt >= value.expiresAt ||
    !exact(value.reviewer, ['userId','accessRole']) ||
    !UUID.test(value.reviewer.userId || '') || !ROLES.has(value.reviewer.accessRole) ||
    !exact(value.run, ['id','digest','targetKey','targetVersion','horizon','outputDigest',
      'currentnessRevision','currentnessDigest']) || !UUID.test(value.run.id || '') ||
    !DIGEST.test(value.run.digest || '') || value.run.targetKey !== 'demand.inbound_leads' ||
    value.run.targetVersion !== 'v1' || !exact(value.run.horizon, ['grain','localStart']) ||
    value.run.horizon.grain !== 'month' || !MONTH.test(value.run.horizon.localStart || '') ||
    !DIGEST.test(value.run.outputDigest || '') ||
    !Number.isSafeInteger(value.run.currentnessRevision) || value.run.currentnessRevision < 1 ||
    !DIGEST.test(value.run.currentnessDigest || '') ||
    !validRecommendation(value.recommendation, value.run.digest, value.run.outputDigest) ||
    !validReceiver(value.receiver) || !validHistory(value.history, value.revision) ||
    value.advisoryOnly !== true || value.navigationIsApproval !== false ||
    value.receiverRecheckRequired !== true || value.automaticActionAuthorized !== false ||
    value.outboundCommunicationAuthorized !== false ||
    !DIGEST.test(value.proposalDigest || '') || !DIGEST.test(value.digest || '')) return false;
  const last = value.history[value.history.length - 1].action;
  if (value.state === 'expired') return last === 'requested';
  return value.state === last;
}
function validCandidate(value) {
  return exact(value, ['runId','runDigest','targetKey','targetVersion','horizon',
    'outputDigest','currentness','recommendation','receiver','advisoryOnly',
    'navigationIsApproval','receiverRecheckRequired','automaticActionAuthorized']) &&
    UUID.test(value.runId || '') && DIGEST.test(value.runDigest || '') &&
    value.targetKey === 'demand.inbound_leads' && value.targetVersion === 'v1' &&
    exact(value.horizon, ['grain','localStart']) && value.horizon.grain === 'month' &&
    MONTH.test(value.horizon.localStart || '') && DIGEST.test(value.outputDigest || '') &&
    exact(value.currentness, ['revision','digest']) &&
    Number.isSafeInteger(value.currentness.revision) && value.currentness.revision >= 1 &&
    DIGEST.test(value.currentness.digest || '') &&
    exact(value.recommendation, ['type','summary','evidence','uncertainty',
      'missingInformation','tradeoff']) &&
    typeof value.recommendation.summary === 'string' &&
    validRecommendation({ type: value.recommendation.type,
      evidence: value.recommendation.evidence, uncertainty: value.recommendation.uncertainty,
      missingInformation: value.recommendation.missingInformation,
      tradeoff: value.recommendation.tradeoff }, value.runDigest, value.outputDigest) &&
    validReceiver(value.receiver) && value.advisoryOnly === true &&
    value.navigationIsApproval === false && value.receiverRecheckRequired === true &&
    value.automaticActionAuthorized === false;
}
function verifiedEnvelope(value, organizationId) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['version','state','reason','candidate','proposals',
      'automaticActionAuthorized','outboundCommunicationAuthorized']) ||
      value.version !== VERSION || !UNAVAILABLE_REASONS.has(value.reason) ||
      value.candidate !== null || value.proposals !== null ||
      value.automaticActionAuthorized !== false ||
      value.outboundCommunicationAuthorized !== false) {
      throw failure('FORECAST_HANDOFF_UNAVAILABLE', 503,
        'Reviewed forecast handoffs are temporarily unavailable.');
    }
    return freeze({ ...value });
  }
  if (!exact(value, ['version','state','reason','candidate','proposals',
    'automaticActionAuthorized','outboundCommunicationAuthorized']) ||
    value.version !== VERSION || value.state !== 'current' || value.reason !== null ||
    !validCandidate(value.candidate) || !dense(value.proposals, 20) ||
    value.proposals.some(proposal => !validProposal(proposal, organizationId) ||
      proposal.run.id !== value.candidate.runId ||
      proposal.run.currentnessDigest !== value.candidate.currentness.digest) ||
    value.automaticActionAuthorized !== false ||
    value.outboundCommunicationAuthorized !== false) {
    throw failure('FORECAST_HANDOFF_UNAVAILABLE', 503,
      'Reviewed forecast handoffs are temporarily unavailable.');
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function verifiedMutation(value, organizationId, expectedStates) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state','reason','proposal']) ||
      !UNAVAILABLE_REASONS.has(value.reason) || value.proposal !== null) {
      throw failure('FORECAST_HANDOFF_UNAVAILABLE', 503,
        'Reviewed forecast handoffs are temporarily unavailable.');
    }
    return freeze({ ...value });
  }
  if (!exact(value, ['state','proposal']) || !expectedStates.includes(value.state) ||
      !validProposal(value.proposal, organizationId)) {
    throw failure('FORECAST_HANDOFF_UNAVAILABLE', 503,
      'Reviewed forecast handoffs are temporarily unavailable.');
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const result = await work(client); await client.query('COMMIT'); return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}
async function list(pool, actor) {
  identity(actor, false);
  return transaction(pool, async client => verifiedEnvelope((await client.query(
    'SELECT public.canonical_forecast_handoff_v1_read($1,$2,$3,$4) value',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId])).rows[0]?.value, actor.organizationId));
}
function requestInput(input) {
  if (!exact(input, ['runId','runDigest','currentnessDigest','expiresAt']) ||
      !UUID.test(input.runId || '') || !DIGEST.test(input.runDigest || '') ||
      !DIGEST.test(input.currentnessDigest || '') || !validInstant(input.expiresAt)) {
    throw failure('FORECAST_HANDOFF_REQUEST_INVALID', 400,
      'Check the reviewed handoff request and try again.');
  }
  return input;
}
async function requestReview(pool, actor, rawInput) {
  identity(actor, true); const input = requestInput(rawInput);
  const requestDigest = sha256(input);
  return transaction(pool, async client => verifiedMutation((await client.query(
    `SELECT public.canonical_forecast_handoff_v1_request(
     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value`,
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, actor.csrfToken, actor.idempotencyKey, requestDigest,
      input.runId, input.runDigest, input.currentnessDigest, input.expiresAt]))
    .rows[0]?.value, actor.organizationId, ['created','replay']));
}
function dismissInput(input) {
  if (!exact(input, ['expectedRevision','expectedDigest']) ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
      !DIGEST.test(input.expectedDigest || '')) {
    throw failure('FORECAST_HANDOFF_REQUEST_INVALID', 400,
      'Check the reviewed handoff request and try again.');
  }
  return input;
}
async function dismiss(pool, actor, proposalId, rawInput) {
  identity(actor, true); const input = dismissInput(rawInput);
  if (!UUID.test(proposalId || '')) throw failure('FORECAST_HANDOFF_REQUEST_INVALID', 400,
    'Check the reviewed handoff request and try again.');
  const requestDigest = sha256({ proposalId, ...input });
  return transaction(pool, async client => verifiedMutation((await client.query(
    `SELECT public.canonical_forecast_handoff_v1_dismiss(
     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value`,
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, actor.csrfToken, actor.idempotencyKey, requestDigest,
      proposalId, input.expectedRevision, input.expectedDigest])).rows[0]?.value,
  actor.organizationId, ['dismissed','replay']));
}

module.exports = { VERSION, list, requestReview, dismiss, verifiedEnvelope,
  validProposal, validCandidate };
