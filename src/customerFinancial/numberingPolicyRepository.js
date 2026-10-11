'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CAPABILITY = 'customer_financial.document_numbering.review';
const BUSINESS_PURPOSE = 'customer_financial.document_numbering';
const POLICY_VERSION = 'mission27.launch.v1';

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
const uuid = value => typeof value === 'string' && UUID.test(value);
const digest = value => typeof value === 'string' && DIGEST.test(value);
const utc = value => typeof value === 'string' && UTC.test(value) && Number.isFinite(Date.parse(value));

function actor(value, mutation) {
  const authorityKeys = ['organizationId','actorUserId','actorAccessRole','authSessionId',
    'capabilityGrantId','capabilityGrantRevision','businessPurpose','policyVersion'];
  const keys = mutation ? [...authorityKeys,'csrfToken','idempotencyKey'] : authorityKeys;
  if (!exact(value, keys) || !uuid(value.organizationId) || !uuid(value.actorUserId) ||
      value.actorAccessRole !== 'owner' || !uuid(value.authSessionId) ||
      !uuid(value.capabilityGrantId) || !Number.isSafeInteger(value.capabilityGrantRevision) ||
      value.capabilityGrantRevision < 1 || value.businessPurpose !== BUSINESS_PURPOSE ||
      value.policyVersion !== POLICY_VERSION ||
      (mutation && (typeof value.csrfToken !== 'string' || value.csrfToken.length < 32 ||
        value.csrfToken.length > 512 || !KEY.test(value.idempotencyKey || '')))) {
    throw failure('CUSTOMER_FINANCIAL_NUMBERING_POLICY_RESTRICTED', 403,
      'Document numbering policy access is restricted.');
  }
}
function contract(value) {
  if (!exact(value, ['version','currency','location','documents','reuseAllowed','gapsAllowed',
    'yearResetAllowed','serverAssigned','statutorySufficiencyClaimed']) ||
      value.version !== 'm27-document-numbering-contract-v1' ||
      !exact(value.currency, ['code','minorUnitExponent','rounding','foreignExchangeSupported']) ||
      value.currency.code !== 'USD' || value.currency.minorUnitExponent !== 2 ||
      value.currency.rounding !== 'half_away_from_zero_at_owning_boundary' ||
      value.currency.foreignExchangeSupported !== false ||
      !exact(value.location, ['scope','locationId']) || value.location.scope !== 'tenant_global' ||
      value.location.locationId !== null ||
      !exact(value.documents, ['invoice','credit','receipt']) ||
      !['invoice','credit','receipt'].every((kind, index) => {
        const item = value.documents[kind];
        return exact(item, ['prefix','width','firstSequence']) &&
          item.prefix === ['INV-','CR-','RCT-'][index] && item.width === 10 &&
          item.firstSequence === '1';
      }) || value.reuseAllowed !== false || value.gapsAllowed !== true ||
      value.yearResetAllowed !== false || value.serverAssigned !== true ||
      value.statutorySufficiencyClaimed !== false) return false;
  return true;
}
function reviewedValue(value, organizationId, policyId, policyDigest) {
  return exact(value, ['contract','actor','reason','reviewedAt']) && contract(value.contract) &&
    exact(value.actor, ['organizationId','userId','accessRole','membershipId','authSessionId',
      'capability','capabilityGrantId','capabilityGrantRevision','businessPurpose','policyVersion',
      'actionMode','assurance']) &&
    value.actor.organizationId === organizationId && uuid(value.actor.userId) &&
    value.actor.accessRole === 'owner' && uuid(value.actor.membershipId) &&
    uuid(value.actor.authSessionId) && value.actor.capability === CAPABILITY &&
    uuid(value.actor.capabilityGrantId) &&
    Number.isSafeInteger(value.actor.capabilityGrantRevision) &&
    value.actor.capabilityGrantRevision >= 1 && value.actor.businessPurpose === BUSINESS_PURPOSE &&
    value.actor.policyVersion === POLICY_VERSION && value.actor.actionMode === 'single_control' &&
    value.actor.assurance === 'current_session' && typeof value.reason === 'string' &&
    value.reason === value.reason.trim() && Buffer.byteLength(value.reason) >= 12 &&
    Buffer.byteLength(value.reason) <= 500 && utc(value.reviewedAt) && uuid(policyId) && digest(policyDigest);
}
function verified(value, organizationId) {
  if (!exact(value, ['version','state','available','current','reason','organizationId','policyId',
    'policyDigest','reviewState','numberReservationAvailable','value']) ||
      value.version !== 'm27-document-numbering-policy-state-v1' ||
      value.organizationId !== organizationId) {
    throw failure('CUSTOMER_FINANCIAL_NUMBERING_POLICY_UNAVAILABLE', 503,
      'Document numbering policy evidence is unavailable.');
  }
  if (value.state === 'review_required') {
    if (value.available !== true || value.current !== true || value.reason !== null ||
        value.policyId !== null || !digest(value.policyDigest) ||
        value.reviewState !== 'unreviewed' || value.numberReservationAvailable !== false ||
        !exact(value.value, ['contract','ownerReviewRequired']) ||
        !contract(value.value.contract) || value.value.ownerReviewRequired !== true) {
      throw failure('CUSTOMER_FINANCIAL_NUMBERING_POLICY_UNAVAILABLE', 503,
        'Document numbering policy evidence is unavailable.');
    }
  } else if (value.state === 'reviewed_current') {
    if (value.available !== true || value.current !== true || value.reason !== null ||
        !uuid(value.policyId) || !digest(value.policyDigest) || value.reviewState !== 'reviewed' ||
        value.numberReservationAvailable !== true ||
        !reviewedValue(value.value, organizationId, value.policyId, value.policyDigest)) {
      throw failure('CUSTOMER_FINANCIAL_NUMBERING_POLICY_UNAVAILABLE', 503,
        'Document numbering policy evidence is unavailable.');
    }
  } else {
    throw failure('CUSTOMER_FINANCIAL_NUMBERING_POLICY_UNAVAILABLE', 503,
      'Document numbering policy evidence is unavailable.');
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function normalizeReview(value) {
  if (!exact(value, ['expectedPolicyDigest','reason']) || !digest(value.expectedPolicyDigest) ||
      typeof value.reason !== 'string' || value.reason !== value.reason.trim() ||
      Buffer.byteLength(value.reason) < 12 || Buffer.byteLength(value.reason) > 500) {
    throw failure('CUSTOMER_FINANCIAL_NUMBERING_POLICY_INVALID', 400,
      'Document numbering policy review evidence is invalid.');
  }
  return Object.freeze({ expectedPolicyDigest: value.expectedPolicyDigest, reason: value.reason });
}
async function candidate(pool, actorValue) {
  actor(actorValue, false);
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_numbering_v1_candidate($1,$2,$3,$4,$5,$6,$7,$8) value',
    [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
      actorValue.authSessionId,actorValue.capabilityGrantId,actorValue.capabilityGrantRevision,
      actorValue.businessPurpose,actorValue.policyVersion]);
  return verified(result.rows[0]?.value, actorValue.organizationId);
}
async function read(pool, actorValue) {
  actor(actorValue, false);
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_numbering_v1_read($1,$2,$3,$4,$5,$6,$7,$8) value',
    [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
      actorValue.authSessionId,actorValue.capabilityGrantId,actorValue.capabilityGrantRevision,
      actorValue.businessPurpose,actorValue.policyVersion]);
  return verified(result.rows[0]?.value, actorValue.organizationId);
}
async function review(pool, actorValue, inputValue) {
  actor(actorValue, true); const input = normalizeReview(inputValue);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await client.query(
      'SELECT public.canonical_customer_financial_numbering_v1_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
      [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
        actorValue.authSessionId,actorValue.capabilityGrantId,actorValue.capabilityGrantRevision,
        actorValue.businessPurpose,actorValue.policyVersion,actorValue.csrfToken,
        actorValue.idempotencyKey,input.expectedPolicyDigest,input.reason]);
    const response = result.rows[0]?.value;
    if (!exact(response, ['status','body','replayed']) || ![200,201].includes(response.status) ||
        typeof response.replayed !== 'boolean' || (response.replayed && response.status !== 200)) {
      throw failure('CUSTOMER_FINANCIAL_NUMBERING_POLICY_UNAVAILABLE', 503,
        'Document numbering policy evidence is unavailable.');
    }
    const body = verified(response.body, actorValue.organizationId);
    if (body.state !== 'reviewed_current') throw failure(
      'CUSTOMER_FINANCIAL_NUMBERING_POLICY_UNAVAILABLE', 503,
      'Document numbering policy evidence is unavailable.');
    await client.query('COMMIT');
    return freeze({ status: response.status, body, replayed: response.replayed });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

module.exports = { candidate, read, review, normalizeReview, verified,
  CAPABILITY, BUSINESS_PURPOSE, POLICY_VERSION };
