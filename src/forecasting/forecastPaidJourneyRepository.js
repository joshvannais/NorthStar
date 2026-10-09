'use strict';

const { sha256 } = require('../services/businessProfileAdapter');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const ROLES = new Set(['owner', 'admin']);
const STATES = new Set(['ready', 'current', 'unavailable']);

function failure(code, status, message) {
  const error = new Error(message); error.code = code; error.status = status; return error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' &&
    keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function actorValid(actor, mutation) {
  const keys = mutation ? ['organizationId','actorUserId','actorAccessRole','authSessionId',
    'csrfToken','idempotencyKey'] :
    ['organizationId','actorUserId','actorAccessRole','authSessionId'];
  if (!exact(actor, keys) || !UUID.test(actor.organizationId || '') ||
      !UUID.test(actor.actorUserId || '') || !UUID.test(actor.authSessionId || '') ||
      !ROLES.has(actor.actorAccessRole) || (mutation &&
        (!KEY.test(actor.idempotencyKey || '') || typeof actor.csrfToken !== 'string'))) {
    throw failure('FORECAST_PAID_JOURNEY_ACCESS_RESTRICTED', 403,
      'The paid forecast journey is restricted.');
  }
}
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function validHistory(history, organizationId, runId) {
  if (!Array.isArray(history) || history.length > 100) return false;
  return history.every((event, index) => {
    const fields = ['revision','action','recordedAction','recordedAt','expiresAt',
      'organizationId','runId','actorUserId','actorAccessRole','predecessorDigest',
      'runDigest','currentnessRevision','currentnessDigest','target','horizon',
      'outputDigest','recommendationType','receiving','evidence','uncertainty',
      'missingInformation','tradeoff','digest'];
    const recordedAt = Date.parse(event?.recordedAt);
    const expiresAt = Date.parse(event?.expiresAt);
    const actionValid = ['requested','dismissed'].includes(event?.recordedAction) &&
      (event.action === event.recordedAction ||
        (event.recordedAction === 'requested' && event.action === 'expired'));
    const predecessorValid = index === 0 ? event?.predecessorDigest === null :
      event?.predecessorDigest === history[index - 1]?.digest;
    return exact(event, fields) && event.revision === index + 1 && actionValid &&
      Number.isFinite(recordedAt) && Number.isFinite(expiresAt) && recordedAt < expiresAt &&
      event.organizationId === organizationId && event.runId === runId &&
      UUID.test(event.actorUserId || '') && ROLES.has(event.actorAccessRole) &&
      predecessorValid && digest(event.runDigest) &&
      Number.isSafeInteger(event.currentnessRevision) && event.currentnessRevision > 0 &&
      digest(event.currentnessDigest) &&
      exact(event.target, ['key','definitionVersion','semantic']) &&
      event.target.key === 'revenue.approved_price_flow' &&
      event.target.definitionVersion === 'v1' &&
      event.target.semantic === 'future_human_approved_commercial_price_decisions' &&
      exact(event.horizon, ['grain','startsAt','endsAt']) && event.horizon.grain === 'month' &&
      Number.isFinite(Date.parse(event.horizon.startsAt)) &&
      Number.isFinite(Date.parse(event.horizon.endsAt)) &&
      Date.parse(event.horizon.startsAt) < Date.parse(event.horizon.endsAt) &&
      digest(event.outputDigest) && event.recommendationType === 'review_approved_price_flow' &&
      exact(event.receiving, ['mission','workflow','recordId','expectedRevision','availability','reason']) &&
      event.receiving.mission === null && event.receiving.workflow === null &&
      event.receiving.recordId === null && event.receiving.expectedRevision === null &&
      event.receiving.availability === 'unavailable' &&
      event.receiving.reason === 'no_exact_receiving_adapter' &&
      exact(event.evidence, ['receiptDigest','explanationDigest','sourcePositionDigest']) &&
      [event.evidence.receiptDigest,event.evidence.explanationDigest,
        event.evidence.sourcePositionDigest].every(digest) &&
      exact(event.uncertainty, ['state','calibratedIntervalAvailable','reason']) &&
      event.uncertainty.state === 'unquantified' &&
      event.uncertainty.calibratedIntervalAvailable === false &&
      event.uncertainty.reason === 'empirical_calibration_unavailable' &&
      Array.isArray(event.missingInformation) && event.missingInformation.length === 4 &&
      event.missingInformation.every(item => typeof item === 'string') &&
      event.tradeoff === 'Review can inform a later independently authorized workflow; no receiver or operational state changes here.' &&
      digest(event.digest);
  });
}
function validRun(run, organizationId) {
  if (!run || !UUID.test(run.id || '') || !digest(run.receipt?.digest) ||
      !digest(run.output?.digest) || !digest(run.explanation?.digest) ||
      !digest(run.currentness?.digest) ||
      !['unchanged_candidate','stale'].includes(run.currentness.state) ||
      run.currentness.adviceDisplayAuthorized !== false ||
      run.target?.key !== 'revenue.approved_price_flow' ||
      run.target?.definitionVersion !== 'v1' ||
      run.target?.semantic !== 'future_human_approved_commercial_price_decisions' ||
      run.output?.predictionKind !== 'deterministic_point' ||
      run.output?.unit?.key !== 'money' || !/^[A-Z]{3}$/.test(run.output?.unit?.currency || '') ||
      !/^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/.test(run.output?.value?.amount || '') ||
      run.explanation?.customerSafe !== true || run.explanation?.advisoryOnly !== true ||
      run.review?.receiverAvailability !== 'unavailable' ||
      run.review?.receiverHref !== null || run.review?.receiverMutationCount !== 0 ||
      run.automaticActionAuthorized !== false || run.outboundCommunicationAuthorized !== false ||
      run.receipt?.organizationId !== organizationId) return false;
  const required = [run.settings?.digest, run.source?.positionDigest,
    run.source?.sourceSnapshotDigest, run.source?.reportingWindowDigest,
    run.source?.featureSetDigest, run.algorithm?.definitionDigest,
    run.algorithm?.implementationDigest, run.algorithm?.configurationDigest];
  return Number.isSafeInteger(run.settings?.revision) && run.settings.revision > 0 &&
    required.every(digest) && validHistory(run.review.history, organizationId, run.id);
}
function verifiedJourney(value, organizationId, allowReplay = false) {
  if (!value || !STATES.has(value.state) || value.version !== 'm26-paid-journey-v1' ||
      value.targetKey !== 'revenue.approved_price_flow' ||
      value.syntheticImplementationEvidenceOnly !== true ||
      value.liveValidationAvailable !== false || value.automaticActionAuthorized !== false ||
      (allowReplay && typeof value.replayed !== 'boolean') ||
      (!allowReplay && Object.hasOwn(value, 'replayed'))) {
    throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
      'The paid forecast journey is temporarily unavailable.');
  }
  if (value.state === 'current') {
    const latestReview = value.run?.review?.history[value.run.review.history.length - 1];
    const requestReviewAvailable = value.run?.currentness?.state === 'unchanged_candidate' &&
      (!latestReview || ['dismissed','expired'].includes(latestReview.action));
    if (value.reason !== null || !validRun(value.run, organizationId) ||
        value.review?.availability !== 'unavailable' ||
        value.review?.reason !== 'no_exact_receiving_adapter' ||
        value.review?.requestReviewAvailable !== requestReviewAvailable) {
      throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
        'The paid forecast journey is temporarily unavailable.');
    }
  } else if (value.run !== null || value.review !== null ||
      (value.state === 'ready' ? value.reason !== null :
        typeof value.reason !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(value.reason))) {
    throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
      'The paid forecast journey is temporarily unavailable.');
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function verifiedRerun(value) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state','reason','runId','comparison','automaticActionAuthorized']) ||
        typeof value.reason !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(value.reason) ||
        value.runId !== null || value.comparison !== null || value.automaticActionAuthorized !== false) {
      throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
        'The paid forecast journey is temporarily unavailable.');
    }
  } else if (!exact(value, ['state','runId','runDigest','storedOutputDigest',
    'freshOutputDigest','sameResults','automaticActionAuthorized']) ||
      !['reproduced','result_mismatch'].includes(value.state) || !UUID.test(value.runId || '') ||
      ![value.runDigest,value.storedOutputDigest,value.freshOutputDigest].every(digest) ||
      value.sameResults !== (value.state === 'reproduced') ||
      value.automaticActionAuthorized !== false) {
    throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
      'The paid forecast journey is temporarily unavailable.');
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function verifiedReview(value, organizationId) {
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state','reason','journey']) || value.journey !== null ||
        typeof value.reason !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(value.reason)) {
      throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
        'The paid forecast journey is temporarily unavailable.');
    }
    return freeze(JSON.parse(JSON.stringify(value)));
  }
  if (!exact(value, ['state','journey']) ||
      !['requested','dismissed','replay'].includes(value.state)) {
    throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
      'The paid forecast journey is temporarily unavailable.');
  }
  const journey = verifiedJourney(value.journey, organizationId);
  const latest = journey.run.review.history[journey.run.review.history.length - 1];
  if (value.state !== 'replay' && latest?.action !== value.state) {
    throw failure('FORECAST_PAID_JOURNEY_UNAVAILABLE', 503,
      'The paid forecast journey is temporarily unavailable.');
  }
  return freeze({ state: value.state, journey });
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
async function current(pool, actor) {
  actorValid(actor, false);
  return transaction(pool, async client => verifiedJourney((await client.query(
    'SELECT public.canonical_forecast_paid_journey_v1_current($1,$2,$3,$4) value',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId])).rows[0]?.value, actor.organizationId));
}
function issueInput(input) {
  if (!exact(input, ['expectedSettingsRevision','expectedSettingsDigest','approvedPriceOriginId','reason']) ||
      !Number.isSafeInteger(input.expectedSettingsRevision) || input.expectedSettingsRevision < 1 ||
      !digest(input.expectedSettingsDigest) || !UUID.test(input.approvedPriceOriginId || '') ||
      typeof input.reason !== 'string' || input.reason.trim().length < 10 ||
      input.reason.trim().length > 1000 || Buffer.byteLength(input.reason) > 4000) {
    throw failure('FORECAST_PAID_JOURNEY_REQUEST_INVALID', 400,
      'Check the paid forecast journey request and try again.');
  }
  return { ...input, reason: input.reason.trim() };
}
async function issue(pool, actor, rawInput) {
  actorValid(actor, true); const input = issueInput(rawInput);
  return transaction(pool, async client => verifiedJourney((await client.query(
    `SELECT public.canonical_forecast_paid_journey_v1_issue(
     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value`,
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, actor.csrfToken, actor.idempotencyKey, sha256(input),
      input.expectedSettingsRevision, input.expectedSettingsDigest,
      input.approvedPriceOriginId, input.reason])).rows[0]?.value,
  actor.organizationId, true));
}
async function rerun(pool, actor, runId) {
  actorValid(actor, true);
  if (!UUID.test(runId || '')) throw failure('FORECAST_PAID_JOURNEY_REQUEST_INVALID', 400,
    'Choose a valid paid forecast run.');
  return transaction(pool, async client => verifiedRerun((await client.query(
    'SELECT public.canonical_forecast_paid_journey_v1_rerun($1,$2,$3,$4,$5,$6) value',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, actor.csrfToken, runId])).rows[0]?.value));
}
function reviewInput(input) {
  const expires = Date.parse(input?.expiresAt);
  if (!exact(input, ['runId','runDigest','currentnessDigest','action','expectedRevision','expectedDigest','expiresAt']) ||
      !UUID.test(input.runId || '') || !digest(input.runDigest) || !digest(input.currentnessDigest) ||
      !['requested','dismissed'].includes(input.action) ||
      !Number.isFinite(expires) || expires > Date.now() + 30 * 86400000 ||
      (input.action === 'requested' ? expires <= Date.now() + 3600000 : expires <= Date.now()) ||
      (input.action === 'requested' ? input.expectedRevision !== null || input.expectedDigest !== null :
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !digest(input.expectedDigest))) {
    throw failure('FORECAST_PAID_JOURNEY_REQUEST_INVALID', 400,
      'Check the paid forecast review request and try again.');
  }
  return input;
}
async function review(pool, actor, rawInput) {
  actorValid(actor, true); const input = reviewInput(rawInput);
  return transaction(pool, async client => verifiedReview((await client.query(
    `SELECT public.canonical_forecast_paid_journey_v1_review(
     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value`,
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, actor.csrfToken, actor.idempotencyKey, sha256(input),
      input.runId, input.runDigest, input.currentnessDigest, input.action,
      input.expectedRevision, input.expectedDigest, input.expiresAt])).rows[0]?.value,
  actor.organizationId));
}

module.exports = { current, issue, rerun, review, verifiedJourney, issueInput, reviewInput };
