'use strict';

const { v5: uuidv5 } = require('uuid');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const reviewContract = require('./billingIdentityReviewRepository');

const NAMESPACE = '7e9f04c8-c092-4fc1-9ac2-00e8d6223fa3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function fail(status, code, message) {
  const error = new Error(message); error.status = status; error.code = code; throw error;
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
}
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function text(value, minimum, maximum) {
  return typeof value === 'string' && value === value.trim() &&
    Buffer.byteLength(value) >= minimum && Buffer.byteLength(value) <= maximum;
}
function utc(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function micro(value) {
  const iso = new Date(value).toISOString(); return iso.slice(0, -1) + '000Z';
}
function journeyMap(state) {
  return state.billingIdentityJourneys && typeof state.billingIdentityJourneys === 'object' &&
    !Array.isArray(state.billingIdentityJourneys) ? state.billingIdentityJourneys : {};
}
function sourceAddress(value) {
  const source = value && typeof value === 'object' ? value : {};
  return stableValue({ line1: String(source.line1 || source.street || '1 Fictional Review Way'),
    line2: source.line2 ? String(source.line2) : null,
    city: String(source.city || 'Example Falls'), region: String(source.region || source.state || 'NC'),
    postalCode: String(source.postalCode || '00000'), countryCode: String(source.countryCode || source.country || 'US') });
}
function sourcePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 ? '+1' + digits : /^1[0-9]{10}$/.test(digits) ? '+' + digits : '+15550109000';
}
function sourceBasis(state, customerId) {
  const matches = state.graphs.filter(graph => graph?.ids?.customer === customerId);
  if (matches.length !== 1) fail(404, 'DEMO_BILLING_IDENTITY_SOURCE_UNAVAILABLE',
    'That fictional billing identity source is unavailable.');
  const graph = matches[0]; const saved = journeyMap(state)[customerId] || null;
  const latest = saved?.corrections?.[saved.corrections.length - 1] || null;
  const base = { name: String(graph.customer?.name || ''),
    email: graph.customer?.email ? String(graph.customer.email) : null,
    phone: sourcePhone(graph.customer?.phone), address: sourceAddress(graph.customer?.address) };
  const value = latest ? latest.value : base;
  const updatedAt = latest?.correctedAt || micro(graph.timestamps?.updatedAt || graph.timestamps?.createdAt);
  const basis = { version: 'm27-demo-billing-source-v1', fictional: true,
    sourceClass: 'account_free_demo.fictional_customer.v1', customerId,
    operationId: graph.ids.operation, graphId: graph.ids.graph,
    name: value.name, email: value.email, phone: value.phone,
    address: value.address, updatedAt };
  return stableValue({ ...basis, digest: sha256(basis) });
}
function validateSaved(value) {
  if (!exact(value, ['version','customerId','origin','reviews','corrections']) ||
      value.version !== 'm27-demo-billing-identity-state-v1' || !uuid(value.customerId) ||
      !Array.isArray(value.reviews) || value.reviews.length > 100 ||
      !Array.isArray(value.corrections) || value.corrections.length > 12) throw new Error('invalid demo billing identity state');
  if (value.origin !== null) {
    const origin = value.origin;
    if (!exact(origin, ['billingPartyId','snapshotId','sourceDigest','sourceUpdatedAt','reason',
      'establishedAt','requestKey','digest']) || !uuid(origin.billingPartyId) ||
      !uuid(origin.snapshotId) || !digest(origin.sourceDigest) || !utc(origin.sourceUpdatedAt) ||
      !text(origin.reason, 12, 500) || !utc(origin.establishedAt) || !digest(origin.requestKey) ||
      origin.digest !== sha256({ ...origin, digest: undefined })) throw new Error('invalid demo billing origin');
  }
  value.corrections.forEach((entry, index) => {
    if (!exact(entry, ['sequence','previousSourceDigest','value','reason','correctedAt','requestKey','digest']) ||
        entry.sequence !== index + 1 || !digest(entry.previousSourceDigest) ||
        !text(entry.reason, 12, 500) || !utc(entry.correctedAt) || !digest(entry.requestKey) ||
        entry.digest !== sha256({ ...entry, digest: undefined })) throw new Error('invalid demo source correction');
  });
  value.reviews.forEach((entry, index) => {
    if (!exact(entry, ['reviewId','sequence','previousReviewId','previousReviewDigest','sourceDigest',
      'sourceUpdatedAt','payload','reason','reviewedAt','requestKey','digest']) ||
        !uuid(entry.reviewId) || entry.sequence !== index + 1 || !digest(entry.sourceDigest) ||
        !utc(entry.sourceUpdatedAt) || !text(entry.reason, 12, 500) || !utc(entry.reviewedAt) ||
        !digest(entry.requestKey) || entry.digest !== sha256({ ...entry, digest: undefined }) ||
        (index === 0 ? entry.previousReviewId !== null || entry.previousReviewDigest !== null :
          entry.previousReviewId !== value.reviews[index - 1].reviewId ||
          entry.previousReviewDigest !== value.reviews[index - 1].digest)) throw new Error('invalid demo billing review');
  });
}
function validate(value) {
  const map = journeyMap(value); const keys = Object.keys(map);
  if (keys.length > 12 || keys.some(key => !uuid(key) || map[key]?.customerId !== key)) {
    throw new Error('invalid demo billing identity map');
  }
  keys.forEach(key => validateSaved(map[key])); return true;
}
function empty(customerId) {
  return { version: 'm27-demo-billing-identity-state-v1', customerId,
    origin: null, reviews: [], corrections: [] };
}
function candidateValue(source) {
  return { version: 'm27-demo-billing-review-candidate-v1', fictional: true,
    customerIdentity: { kind: 'fictional_demo_customer', id: source.customerId,
      operationId: source.operationId, graphId: source.graphId },
    name: source.name, email: source.email, phone: source.phone,
    serviceAddress: source.address };
}
function identityProjection(saved, source) {
  if (!saved.origin) return { state: 'candidate_unreviewed', available: true, current: true,
    reason: null, customerId: source.customerId, billingPartyId: null, snapshotId: null,
    sourceDigest: source.digest, sourceUpdatedAt: source.updatedAt, reviewState: 'unreviewed',
    documentUseAuthorized: false, value: candidateValue(source) };
  const current = saved.origin.sourceDigest === source.digest;
  return { state: current ? 'established_unreviewed' : 'unavailable', available: current,
    current, reason: current ? null : 'billing_identity_source_changed_requires_review',
    customerId: source.customerId, billingPartyId: saved.origin.billingPartyId,
    snapshotId: saved.origin.snapshotId, sourceDigest: current ? source.digest : null,
    sourceUpdatedAt: current ? source.updatedAt : null, reviewState: current ? 'unreviewed' : null,
    documentUseAuthorized: false, value: current ? candidateValue(source) : null };
}
function reviewProjection(saved, source) {
  if (!saved.origin) return null;
  const latest = saved.reviews[saved.reviews.length - 1] || null;
  if (latest && latest.sourceDigest === source.digest) return {
    state: 'reviewed_current', available: true, current: true, reason: null,
    customerId: source.customerId, billingPartyId: saved.origin.billingPartyId,
    reviewId: latest.reviewId, sequence: latest.sequence, sourceDigest: source.digest,
    sourceUpdatedAt: source.updatedAt, reviewDigest: latest.digest, reviewState: 'reviewed',
    documentUseAuthorized: true,
    value: { version: 'm27-demo-billing-identity-review-v1', fictional: true,
      customerId: source.customerId, billingPartyId: saved.origin.billingPartyId,
      reviewId: latest.reviewId, sequence: latest.sequence,
      previousReviewId: latest.previousReviewId, previousReviewDigest: latest.previousReviewDigest,
      sourceDigest: latest.sourceDigest, sourceUpdatedAt: latest.sourceUpdatedAt,
      payload: latest.payload, reason: latest.reason, reviewedAt: latest.reviewedAt } };
  return { state: latest ? 'correction_required' : 'review_required', available: true,
    current: true, reason: null, customerId: source.customerId,
    billingPartyId: saved.origin.billingPartyId, reviewId: latest?.reviewId || null,
    sequence: latest?.sequence || 0, sourceDigest: source.digest,
    sourceUpdatedAt: source.updatedAt, reviewDigest: latest?.digest || null,
    reviewState: 'unreviewed', documentUseAuthorized: false, value: candidateValue(source) };
}
function historyProjection(saved) {
  return { complete: true, total: saved.reviews.length, revisions: saved.reviews.map(entry => ({
    reviewId: entry.reviewId, sequence: entry.sequence, previousReviewId: entry.previousReviewId,
    reviewDigest: entry.digest, sourceDigest: entry.sourceDigest,
    sourceUpdatedAt: entry.sourceUpdatedAt, reviewedAt: entry.reviewedAt, reason: entry.reason })) };
}
function journeyEnvelope(state, workspaceRevision, customerId) {
  const source = sourceBasis(state, customerId); const saved = journeyMap(state)[customerId] || empty(customerId);
  validateSaved(saved);
  return stableValue({ version: 'm27-billing-identity-journey-v1', mode: 'isolated_fictional_demo',
    fictional: true, accountFree: true, resettable: true, demoWorkspaceRevision: workspaceRevision,
    customerId, identity: identityProjection(saved, source), review: reviewProjection(saved, source),
    history: historyProjection(saved), invoiceMutationCount: 0, paymentMutationCount: 0,
    providerCallCount: 0, customerCreationCount: 0 });
}
function normalizeAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['establish','review','correct_source'].includes(value.action) || !uuid(value.customerId)) {
    fail(400, 'DEMO_BILLING_IDENTITY_REQUEST_INVALID', 'Check the fictional billing identity review.');
  }
  if (value.action === 'establish') {
    if (!exact(value, ['action','customerId','expectedSourceDigest','expectedSourceUpdatedAt','reason']) ||
        !digest(value.expectedSourceDigest) || !utc(value.expectedSourceUpdatedAt) ||
        !text(value.reason, 12, 500)) fail(400, 'DEMO_BILLING_IDENTITY_REQUEST_INVALID',
      'Check the fictional billing identity establishment.');
  } else if (value.action === 'correct_source') {
    if (!exact(value, ['action','customerId','expectedSourceDigest','reason']) ||
        !digest(value.expectedSourceDigest) || !text(value.reason, 12, 500)) {
      fail(400, 'DEMO_BILLING_IDENTITY_REQUEST_INVALID', 'Check the fictional source correction.');
    }
  } else {
    const normalized = reviewContract.normalizeReview({ customerId: value.customerId,
      billingPartyId: value.billingPartyId, originSnapshotId: value.originSnapshotId,
      expectedSourceDigest: value.expectedSourceDigest,
      expectedSourceUpdatedAt: value.expectedSourceUpdatedAt,
      expectedPreviousReviewId: value.expectedPreviousReviewId,
      expectedPreviousReviewDigest: value.expectedPreviousReviewDigest,
      expectedPreviousSequence: value.expectedPreviousSequence,
      payload: value.payload, reason: value.reason });
    return stableValue({ action: 'review', ...normalized });
  }
  return stableValue(value);
}
function withSaved(state, saved) {
  const map = { ...journeyMap(state), [saved.customerId]: stableValue(saved) };
  const result = stableValue({ ...state, billingIdentityJourneys: map }); validate(result); return result;
}
function apply(state, rawAction, requestKey, nowValue) {
  const action = normalizeAction(rawAction); const source = sourceBasis(state, action.customerId);
  const saved = journeyMap(state)[action.customerId] || empty(action.customerId);
  const now = micro(nowValue); const key = String(requestKey || '');
  if (!digest(key)) fail(400, 'DEMO_BILLING_IDENTITY_REQUEST_INVALID',
    'A bounded fictional review key is required.');
  if (action.action === 'establish') {
    if (saved.origin) fail(409, 'DEMO_BILLING_IDENTITY_ALREADY_ESTABLISHED',
      'This fictional billing identity is already established.');
    if (source.digest !== action.expectedSourceDigest || source.updatedAt !== action.expectedSourceUpdatedAt) {
      fail(409, 'DEMO_BILLING_IDENTITY_SOURCE_CHANGED',
        'The fictional customer source changed. Refresh before reviewing again.');
    }
    const body = { billingPartyId: uuidv5(action.customerId + ':party', NAMESPACE),
      snapshotId: uuidv5(action.customerId + ':origin', NAMESPACE), sourceDigest: source.digest,
      sourceUpdatedAt: source.updatedAt, reason: action.reason, establishedAt: now, requestKey: key };
    const origin = { ...body, digest: sha256(body) };
    return withSaved(state, { ...saved, origin });
  }
  if (!saved.origin) fail(409, 'DEMO_BILLING_IDENTITY_NOT_ESTABLISHED',
    'Establish the fictional billing identity before reviewing it.');
  if (action.action === 'correct_source') {
    if (source.digest !== action.expectedSourceDigest) fail(409, 'DEMO_BILLING_IDENTITY_SOURCE_CHANGED',
      'The fictional customer source changed. Refresh before reviewing again.');
    const sequence = saved.corrections.length + 1;
    const correctionBody = { sequence, previousSourceDigest: source.digest,
      value: { name: source.name + ' corrected ' + sequence,
        email: source.email, phone: source.phone,
        address: { ...source.address, line1: String(100 + sequence) + ' Fictional Correction Way' } },
      reason: action.reason, correctedAt: now, requestKey: key };
    const correction = { ...correctionBody, digest: sha256(correctionBody) };
    return withSaved(state, { ...saved, corrections: [...saved.corrections, correction] });
  }
  const latest = saved.reviews[saved.reviews.length - 1] || null;
  if (source.digest !== action.expectedSourceDigest || source.updatedAt !== action.expectedSourceUpdatedAt ||
      saved.origin.billingPartyId !== action.billingPartyId || saved.origin.snapshotId !== action.originSnapshotId ||
      (latest?.reviewId || null) !== action.expectedPreviousReviewId ||
      (latest?.digest || null) !== action.expectedPreviousReviewDigest ||
      (latest?.sequence || 0) !== action.expectedPreviousSequence) {
    fail(409, 'DEMO_BILLING_IDENTITY_REVIEW_CHANGED',
      'The fictional billing identity changed. Refresh before reviewing again.');
  }
  const sequence = saved.reviews.length + 1;
  const body = { reviewId: uuidv5(action.customerId + ':review:' + sequence, NAMESPACE), sequence,
    previousReviewId: latest?.reviewId || null, previousReviewDigest: latest?.digest || null,
    sourceDigest: source.digest, sourceUpdatedAt: source.updatedAt, payload: action.payload,
    reason: action.reason, reviewedAt: now, requestKey: key };
  const accepted = { ...body, digest: sha256(body) };
  return withSaved(state, { ...saved, reviews: [...saved.reviews, accepted] });
}

module.exports = { apply, journeyEnvelope, normalizeAction, sourceBasis, validate };
