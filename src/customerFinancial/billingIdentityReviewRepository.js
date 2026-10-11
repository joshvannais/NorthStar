'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9][0-9]{7,14}$/;
const POSTAL = /^[0-9]{5}(?:-[0-9]{4})?$/;
const REGIONS = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const ROLES = new Set(['owner', 'admin']);
const CAPABILITY = 'customer_financial.billing_identity.review';
const BUSINESS_PURPOSE = 'customer_financial.billing_identity';
const POLICY_VERSION = 'mission27.launch.v1';
const UNAVAILABLE = new Set(['billing_customer_identity_unavailable','billing_identity_not_established',
  'billing_identity_history_unavailable','billing_identity_review_required',
  'billing_identity_review_source_changed','billing_customer_source_changed',
  'billing_identity_review_conflict','billing_identity_review_limit_reached',
  'billing_identity_review_superseded']);

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
const text = (value, maximum) => typeof value === 'string' && value === value.trim() &&
  Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= maximum;
const nullableText = (value, maximum) => value === null || text(value, maximum);

function actor(value, mutation) {
  const authorityKeys = ['organizationId','actorUserId','actorAccessRole','authSessionId',
    'capabilityGrantId','capabilityGrantRevision','businessPurpose','policyVersion'];
  const keys = mutation ? [...authorityKeys,'csrfToken','idempotencyKey'] : authorityKeys;
  if (!exact(value, keys) || !uuid(value.organizationId) || !uuid(value.actorUserId) ||
      !uuid(value.authSessionId) || !ROLES.has(value.actorAccessRole) ||
      !uuid(value.capabilityGrantId) || !Number.isSafeInteger(value.capabilityGrantRevision) ||
      value.capabilityGrantRevision < 1 || value.businessPurpose !== BUSINESS_PURPOSE ||
      value.policyVersion !== POLICY_VERSION ||
      (mutation && (typeof value.csrfToken !== 'string' || value.csrfToken.length < 32 ||
        value.csrfToken.length > 512 || !KEY.test(value.idempotencyKey || '')))) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_RESTRICTED', 403,
      'Billing identity review access is restricted.');
  }
}
function address(value) {
  return exact(value, ['line1','line2','city','region','postalCode','countryCode']) &&
    text(value.line1, 255) && nullableText(value.line2, 255) && text(value.city, 100) &&
    REGIONS.has(value.region) && POSTAL.test(value.postalCode || '') && value.countryCode === 'US';
}
function payload(value) {
  return exact(value, ['contact','serviceAddress','billingAddress','purchaseOrderReference',
    'customerReference']) && exact(value.contact, ['name','email','phone']) &&
    text(value.contact.name, 255) && nullableText(value.contact.email, 255) &&
    nullableText(value.contact.phone, 16) &&
    (value.contact.email !== null || value.contact.phone !== null) &&
    (value.contact.email === null || EMAIL.test(value.contact.email)) &&
    (value.contact.phone === null || PHONE.test(value.contact.phone)) &&
    address(value.serviceAddress) && address(value.billingAddress) &&
    nullableText(value.purchaseOrderReference, 100) && nullableText(value.customerReference, 100) &&
    Buffer.byteLength(JSON.stringify(value)) <= 32768;
}
function normalizeSelection(value) {
  if (!exact(value, ['customerId']) || !uuid(value.customerId)) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_INVALID', 400,
      'Select one exact current customer.');
  }
  return Object.freeze({ customerId: value.customerId.toLowerCase() });
}
function normalizeReview(value) {
  const keys = ['customerId','billingPartyId','originSnapshotId','expectedSourceDigest',
    'expectedSourceUpdatedAt','expectedPreviousReviewId','expectedPreviousReviewDigest',
    'expectedPreviousSequence','payload','reason'];
  if (!exact(value, keys) || !uuid(value.customerId) || !uuid(value.billingPartyId) ||
      !uuid(value.originSnapshotId) || !digest(value.expectedSourceDigest) ||
      !utc(value.expectedSourceUpdatedAt) || !Number.isSafeInteger(value.expectedPreviousSequence) ||
      value.expectedPreviousSequence < 0 || value.expectedPreviousSequence > 99 ||
      ((value.expectedPreviousSequence === 0) !== (value.expectedPreviousReviewId === null)) ||
      ((value.expectedPreviousSequence === 0) !== (value.expectedPreviousReviewDigest === null)) ||
      (value.expectedPreviousReviewId !== null && !uuid(value.expectedPreviousReviewId)) ||
      (value.expectedPreviousReviewDigest !== null && !digest(value.expectedPreviousReviewDigest)) ||
      !payload(value.payload) || !text(value.reason, 500) || Buffer.byteLength(value.reason) < 12) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_INVALID', 400,
      'Billing identity review evidence is invalid.');
  }
  return freeze(JSON.parse(JSON.stringify({ ...value, customerId: value.customerId.toLowerCase(),
    billingPartyId: value.billingPartyId.toLowerCase(),
    originSnapshotId: value.originSnapshotId.toLowerCase(),
    expectedPreviousReviewId: value.expectedPreviousReviewId?.toLowerCase() ?? null })));
}
function provenance(value) {
  return exact(value, ['class','customerSourceDigest','customerSourceUpdatedAt','reviewActorUserId','reviewId']) &&
    ['canonical_customer.v1','owner_admin_review.v1'].includes(value.class) &&
    digest(value.customerSourceDigest) && utc(value.customerSourceUpdatedAt) &&
    uuid(value.reviewActorUserId) && uuid(value.reviewId);
}
function reviewedField(value, validator) {
  if (!exact(value, ['state','value','provenance']) || !provenance(value.provenance)) return false;
  if (value.state === 'not_supplied') return value.value === null;
  return value.state === 'reviewed' && validator(value.value);
}
function snapshot(value, organizationId, customerId, partyId, reviewId, sequence, reviewDigest) {
  if (!exact(value, ['version','organizationId','billingPartyId','customerId','reviewId','sequence',
    'previousReviewId','previousReviewDigest','origin','customerIdentity','prospectIdentity',
    'billingContact','serviceLocation','billingAddress','references','actor','reason',
    'sourceCustomerDigest','sourceCustomerUpdatedAt','reviewedAt','reviewState',
    'documentUseAuthorized','automaticCustomerCreationAuthorized']) ||
      value.version !== 'm27-billing-identity-review-v1' || value.organizationId !== organizationId ||
      value.customerId !== customerId || value.billingPartyId !== partyId || value.reviewId !== reviewId ||
      value.sequence !== sequence || value.reviewState !== 'reviewed' ||
      value.documentUseAuthorized !== true || value.automaticCustomerCreationAuthorized !== false ||
      !digest(value.sourceCustomerDigest) || !utc(value.sourceCustomerUpdatedAt) ||
      !utc(value.reviewedAt) || !text(value.reason, 500) || Buffer.byteLength(value.reason) < 12) return false;
  if ((sequence === 1 && (value.previousReviewId !== null || value.previousReviewDigest !== null)) ||
      (sequence > 1 && (!uuid(value.previousReviewId) || !digest(value.previousReviewDigest)))) return false;
  if (!exact(value.origin, ['snapshotId','snapshotDigest']) || !uuid(value.origin.snapshotId) ||
      !digest(value.origin.snapshotDigest) ||
      !exact(value.customerIdentity, ['kind','id','source']) ||
      value.customerIdentity.kind !== 'canonical_customer' || value.customerIdentity.id !== customerId ||
      !exact(value.customerIdentity.source, ['class','operationId','graphId','externalCustomerId','digest','updatedAt']) ||
      value.customerIdentity.source.class !== 'canonical_customer.v1' ||
      !uuid(value.customerIdentity.source.operationId) || !uuid(value.customerIdentity.source.graphId) ||
      !nullableText(value.customerIdentity.source.externalCustomerId, 255) ||
      !digest(value.customerIdentity.source.digest) || !utc(value.customerIdentity.source.updatedAt) ||
      value.customerIdentity.source.digest !== value.sourceCustomerDigest ||
      value.customerIdentity.source.updatedAt !== value.sourceCustomerUpdatedAt) return false;
  if (!exact(value.prospectIdentity, ['state','value','reason']) ||
      value.prospectIdentity.state !== 'unavailable' || value.prospectIdentity.value !== null ||
      value.prospectIdentity.reason !== 'canonical_prospect_source_unavailable') return false;
  if (!exact(value.billingContact, ['id','name','email','phone']) || !uuid(value.billingContact.id) ||
      !reviewedField(value.billingContact.name, candidate => text(candidate, 255)) ||
      !reviewedField(value.billingContact.email, candidate => text(candidate, 255) && EMAIL.test(candidate)) ||
      !reviewedField(value.billingContact.phone, candidate => PHONE.test(candidate))) return false;
  if (value.billingContact.email.state === 'not_supplied' &&
      value.billingContact.phone.state === 'not_supplied') return false;
  if (!exact(value.serviceLocation, ['id','address']) || !uuid(value.serviceLocation.id) ||
      !reviewedField(value.serviceLocation.address, address) ||
      !exact(value.billingAddress, ['id','address']) || !uuid(value.billingAddress.id) ||
      !reviewedField(value.billingAddress.address, address) ||
      !exact(value.references, ['purchaseOrder','customer']) ||
      !reviewedField(value.references.purchaseOrder, candidate => text(candidate, 100)) ||
      !reviewedField(value.references.customer, candidate => text(candidate, 100))) return false;
  const sourceActor = value.actor;
  if (!exact(sourceActor, ['userId','accessRole','membershipId','authSessionId','capability',
    'capabilityGrantId','capabilityGrantRevision','businessPurpose','policyVersion']) ||
      !uuid(sourceActor.userId) || !ROLES.has(sourceActor.accessRole) ||
      !uuid(sourceActor.membershipId) || !uuid(sourceActor.authSessionId) ||
      sourceActor.capability !== CAPABILITY || !uuid(sourceActor.capabilityGrantId) ||
      !Number.isSafeInteger(sourceActor.capabilityGrantRevision) ||
      sourceActor.capabilityGrantRevision < 1 || sourceActor.businessPurpose !== BUSINESS_PURPOSE ||
      sourceActor.policyVersion !== POLICY_VERSION) return false;
  return digest(reviewDigest);
}
function candidateValue(value, customerId) {
  return exact(value, ['version','originSnapshotId','originSnapshotDigest','customerIdentity',
    'prospectIdentity','name','email','phone','unclassifiedAddress']) &&
    value.version === 'm27-billing-identity-review-candidate-v1' &&
    uuid(value.originSnapshotId) && digest(value.originSnapshotDigest) &&
    exact(value.customerIdentity, ['kind','id','operationId','graphId']) &&
    value.customerIdentity.kind === 'canonical_customer' && value.customerIdentity.id === customerId &&
    uuid(value.customerIdentity.operationId) && uuid(value.customerIdentity.graphId) &&
    exact(value.prospectIdentity, ['state','value','reason']) &&
    value.prospectIdentity.state === 'unavailable' && value.prospectIdentity.value === null &&
    value.prospectIdentity.reason === 'canonical_prospect_source_unavailable';
}
function verified(value, organizationId) {
  const keys = ['version','state','available','current','reason','customerId','billingPartyId',
    'reviewId','sequence','sourceDigest','sourceUpdatedAt','reviewDigest','reviewState',
    'documentUseAuthorized','value','automaticCustomerCreationAuthorized'];
  if (!exact(value, keys) || value.version !== 'm27-billing-identity-review-state-v1' ||
      value.automaticCustomerCreationAuthorized !== false) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
      'Billing identity review evidence is unavailable.');
  }
  if (value.state === 'unavailable') {
    if (value.available !== false || ![false, null, true].includes(value.current) ||
        !UNAVAILABLE.has(value.reason) || value.value !== null || value.sourceDigest !== null ||
        value.sourceUpdatedAt !== null || value.reviewDigest !== null || value.reviewState !== null ||
        value.documentUseAuthorized !== false || value.sequence !== null ||
        (value.customerId !== null && !uuid(value.customerId)) ||
        (value.billingPartyId !== null && !uuid(value.billingPartyId)) ||
        (value.reviewId !== null && !uuid(value.reviewId))) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
        'Billing identity review evidence is unavailable.');
    }
  } else if (['review_required','correction_required'].includes(value.state)) {
    if (value.available !== true || value.current !== true || value.reason !== null ||
        !uuid(value.customerId) || !uuid(value.billingPartyId) ||
        !Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.sequence > 99 ||
        !digest(value.sourceDigest) || !utc(value.sourceUpdatedAt) ||
        value.reviewState !== 'unreviewed' || value.documentUseAuthorized !== false ||
        !candidateValue(value.value, value.customerId) ||
        (value.sequence === 0 ? value.reviewId !== null || value.reviewDigest !== null :
          !uuid(value.reviewId) || !digest(value.reviewDigest))) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
        'Billing identity review evidence is unavailable.');
    }
  } else if (value.state === 'reviewed_current') {
    if (value.available !== true || value.current !== true || value.reason !== null ||
        !uuid(value.customerId) || !uuid(value.billingPartyId) || !uuid(value.reviewId) ||
        !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 100 ||
        !digest(value.sourceDigest) || !utc(value.sourceUpdatedAt) || !digest(value.reviewDigest) ||
        value.reviewState !== 'reviewed' || value.documentUseAuthorized !== true ||
        !snapshot(value.value, organizationId, value.customerId, value.billingPartyId,
          value.reviewId, value.sequence, value.reviewDigest) ||
        value.value.sourceCustomerDigest !== value.sourceDigest ||
        value.value.sourceCustomerUpdatedAt !== value.sourceUpdatedAt) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
        'Billing identity review evidence is unavailable.');
    }
  } else {
    throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
      'Billing identity review evidence is unavailable.');
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function verifiedLineage(value) {
  if (!exact(value, ['version','available','customerId','billingPartyId','complete','total',
    'revisions','automaticCustomerCreationAuthorized']) ||
      value.version !== 'm27-billing-identity-review-lineage-v1' || value.available !== true ||
      !uuid(value.customerId) || !uuid(value.billingPartyId) || value.complete !== true ||
      value.automaticCustomerCreationAuthorized !== false || !Number.isSafeInteger(value.total) ||
      value.total < 0 || value.total > 100 || !Array.isArray(value.revisions) ||
      value.revisions.length !== value.total) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
      'Billing identity correction lineage is unavailable.');
  }
  value.revisions.forEach((revision, index) => {
    if (!exact(revision, ['reviewId','sequence','previousReviewId','reviewDigest','sourceDigest',
      'sourceUpdatedAt','reviewedAt','reviewedByUserId','reason']) || !uuid(revision.reviewId) ||
        revision.sequence !== index + 1 || !digest(revision.reviewDigest) ||
        !digest(revision.sourceDigest) || !utc(revision.sourceUpdatedAt) ||
        !utc(revision.reviewedAt) || !uuid(revision.reviewedByUserId) ||
        !text(revision.reason, 500) || Buffer.byteLength(revision.reason) < 12 ||
        (index === 0 ? revision.previousReviewId !== null :
          revision.previousReviewId !== value.revisions[index - 1].reviewId)) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
        'Billing identity correction lineage is unavailable.');
    }
  });
  return freeze(JSON.parse(JSON.stringify(value)));
}
async function candidate(pool, actorValue, selectionValue) {
  actor(actorValue, false); const selection = normalizeSelection(selectionValue);
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_billing_review_v1_candidate($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
    [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
      actorValue.authSessionId,actorValue.capabilityGrantId,actorValue.capabilityGrantRevision,
      actorValue.businessPurpose,actorValue.policyVersion,selection.customerId]);
  return verified(result.rows[0]?.value, actorValue.organizationId);
}
async function read(pool, actorValue, selectionValue) {
  actor(actorValue, false); const selection = normalizeSelection(selectionValue);
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_billing_review_v1_read($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
    [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
      actorValue.authSessionId,actorValue.capabilityGrantId,actorValue.capabilityGrantRevision,
      actorValue.businessPurpose,actorValue.policyVersion,selection.customerId]);
  return verified(result.rows[0]?.value, actorValue.organizationId);
}
async function history(pool, actorValue, selectionValue) {
  actor(actorValue, false); const selection = normalizeSelection(selectionValue);
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_billing_review_v1_history($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
    [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
      actorValue.authSessionId,actorValue.capabilityGrantId,actorValue.capabilityGrantRevision,
      actorValue.businessPurpose,actorValue.policyVersion,selection.customerId]);
  if (result.rows[0]?.value?.state === 'unavailable') {
    return verified(result.rows[0].value, actorValue.organizationId);
  }
  return verifiedLineage(result.rows[0]?.value);
}
async function accept(pool, actorValue, inputValue) {
  actor(actorValue, true); const input = normalizeReview(inputValue);
  const client = await pool.connect();
  try {
    // The database function serializes the request key and billing party itself. READ COMMITTED
    // is deliberate: a waiter must take a new command snapshot after those locks are acquired so
    // a human correction that won the lock cannot be replayed through an older transaction view.
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await client.query(
      'SELECT public.canonical_customer_financial_billing_review_v1_accept($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20) value',
      [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
        actorValue.authSessionId,actorValue.capabilityGrantId,actorValue.capabilityGrantRevision,
        actorValue.businessPurpose,actorValue.policyVersion,actorValue.csrfToken,
        actorValue.idempotencyKey,input.customerId,input.billingPartyId,input.originSnapshotId,
        input.expectedSourceDigest,input.expectedSourceUpdatedAt,input.expectedPreviousReviewId,
        input.expectedPreviousReviewDigest,input.expectedPreviousSequence,JSON.stringify(input.payload),
        input.reason]);
    const response = result.rows[0]?.value;
    if (!exact(response, ['status','body','replayed']) || ![200,201,409].includes(response.status) ||
        typeof response.replayed !== 'boolean' || (response.replayed && ![200,409].includes(response.status))) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
        'Billing identity review evidence is unavailable.');
    }
    const body = verified(response.body, actorValue.organizationId);
    if ((response.status === 409) !== (body.state === 'unavailable') ||
        (response.status === 201 && body.state !== 'reviewed_current')) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_REVIEW_UNAVAILABLE', 503,
        'Billing identity review evidence is unavailable.');
    }
    await client.query('COMMIT');
    return freeze({ status: response.status, body, replayed: response.replayed });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

module.exports = { candidate, read, history, accept, normalizeSelection, normalizeReview,
  verified, verifiedLineage, CAPABILITY, BUSINESS_PURPOSE, POLICY_VERSION };
