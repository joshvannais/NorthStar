'use strict';

const identity = require('./billingIdentityRepository');
const review = require('./billingIdentityReviewRepository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(['owner', 'admin']);

function failure(code, status, message) {
  const error = new Error(message); error.code = code; error.status = status; return error;
}
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
}
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function sessionActor(value, mutation) {
  const keys = ['organizationId','actorUserId','actorAccessRole','authSessionId'];
  if (!exact(value, mutation ? [...keys,'csrfToken'] : keys) ||
      !uuid(value.organizationId) || !uuid(value.actorUserId) ||
      !uuid(value.authSessionId) || !ROLES.has(value.actorAccessRole) ||
      (mutation && (typeof value.csrfToken !== 'string' || value.csrfToken.length < 32 ||
        value.csrfToken.length > 512))) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_JOURNEY_RESTRICTED', 403,
      'Billing identity journey access is restricted.');
  }
}
function authority(value, source) {
  const keys = ['organizationId','actorUserId','actorAccessRole','authSessionId',
    'capabilityGrantId','capabilityGrantRevision','businessPurpose','policyVersion'];
  if (!exact(value, keys) || value.organizationId !== source.organizationId ||
      value.actorUserId !== source.actorUserId || value.actorAccessRole !== source.actorAccessRole ||
      value.authSessionId !== source.authSessionId || !uuid(value.capabilityGrantId) ||
      !Number.isSafeInteger(Number(value.capabilityGrantRevision)) || Number(value.capabilityGrantRevision) < 1 ||
      value.businessPurpose !== identity.BUSINESS_PURPOSE ||
      value.policyVersion !== identity.POLICY_VERSION) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_JOURNEY_UNAVAILABLE', 503,
      'Billing identity journey authority is unavailable.');
  }
  return Object.freeze({ ...value, capabilityGrantRevision: Number(value.capabilityGrantRevision) });
}
async function resolve(pool, source, customerId, mutation) {
  sessionActor(source, mutation);
  if (!uuid(customerId)) throw failure('CUSTOMER_FINANCIAL_BILLING_JOURNEY_INVALID', 400,
    'Select one exact current customer.');
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_billing_journey_v1_authority($1,$2,$3,$4,$5,$6,$7) value',
    [source.organizationId, source.actorUserId, source.actorAccessRole, source.authSessionId,
      mutation ? source.csrfToken : null, Boolean(mutation), customerId.toLowerCase()]);
  return authority(result.rows[0]?.value, source);
}
function mutationAuthority(value, source, idempotencyKey) {
  return Object.freeze({ ...value, csrfToken: source.csrfToken, idempotencyKey });
}
async function current(pool, source, customerId) {
  const client = await pool.connect();
  try {
    // The server-side capability resolver takes a shared row lock so a concurrent
    // grant revision cannot cross this exact read. PostgreSQL therefore requires
    // a read-write transaction even though this journey performs no data mutation.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const actor = await resolve(client, source, customerId, false);
    let identityState = await identity.read(client, actor, { customerId });
    if (identityState.state === 'unavailable' && identityState.reason === 'billing_identity_not_established') {
      identityState = await identity.candidate(client, actor, { customerId });
    }
    let reviewState = null; let history = null;
    if (identityState.state === 'established_unreviewed') {
      reviewState = await review.read(client, actor, { customerId });
      if (reviewState.state === 'unavailable' && reviewState.reason === 'billing_identity_review_required') {
        reviewState = await review.candidate(client, actor, { customerId });
      } else if (reviewState.state === 'reviewed_current') {
        history = await review.history(client, actor, { customerId });
      }
    } else if (identityState.state === 'unavailable' && identityState.billingPartyId) {
      reviewState = await review.candidate(client, actor, { customerId });
      if (reviewState.state === 'correction_required') history = await review.history(client, actor, { customerId });
    }
    await client.query('COMMIT');
    return Object.freeze({ version: 'm27-billing-identity-journey-v1', mode: 'paid_tenant',
      fictional: false, customerId: customerId.toLowerCase(), identity: identityState,
      review: reviewState, history, invoiceMutationCount: 0, paymentMutationCount: 0,
      providerCallCount: 0, customerCreationCount: 0 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}
async function establish(pool, source, input, idempotencyKey) {
  const actor = await resolve(pool, source, input?.customerId, true);
  return identity.establish(pool, mutationAuthority(actor, source, idempotencyKey), input);
}
async function accept(pool, source, input, idempotencyKey) {
  const actor = await resolve(pool, source, input?.customerId, true);
  return review.accept(pool, mutationAuthority(actor, source, idempotencyKey), input);
}

module.exports = { current, establish, accept, resolve, sessionActor, authority };
