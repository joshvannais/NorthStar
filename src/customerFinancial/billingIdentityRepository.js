'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ROLES = new Set(['owner', 'admin']);
const UNAVAILABLE = new Set([
  'billing_customer_identity_unavailable',
  'billing_customer_source_shape_unavailable',
  'billing_customer_source_changed',
  'billing_identity_not_established',
  'billing_identity_history_unavailable',
  'billing_identity_source_changed_requires_review',
]);

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
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function utc(value) { return typeof value === 'string' && UTC.test(value) && Number.isFinite(Date.parse(value)); }
function nullableText(value, maximum) {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= maximum);
}
function actor(value, mutation) {
  const keys = mutation ? ['organizationId','actorUserId','actorAccessRole','authSessionId',
    'csrfToken','idempotencyKey'] : ['organizationId','actorUserId','actorAccessRole','authSessionId'];
  if (!exact(value, keys) || !uuid(value.organizationId) || !uuid(value.actorUserId) ||
      !uuid(value.authSessionId) || !ROLES.has(value.actorAccessRole) ||
      (mutation && (typeof value.csrfToken !== 'string' || value.csrfToken.length < 32 ||
        value.csrfToken.length > 512 || !KEY.test(value.idempotencyKey || '')))) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_RESTRICTED', 403,
      'Billing identity access is restricted.');
  }
}
function sourceField(value, maximum, objectValue = false) {
  if (!exact(value, objectValue ? ['state','value','reason','sourceRole'] :
    ['state','value','reason'])) return false;
  if (objectValue && value.sourceRole !== 'unclassified_customer_address') return false;
  if (value.state === 'unavailable') {
    return value.value === null && value.reason === 'source_value_missing';
  }
  if (value.state !== 'source_candidate' || value.reason !== null) return false;
  if (objectValue) return value.value && typeof value.value === 'object' &&
    !Array.isArray(value.value) && Buffer.byteLength(JSON.stringify(value.value)) <= maximum;
  return typeof value.value === 'string' && value.value.length > 0 && value.value.length <= maximum;
}
function unavailableField(value) {
  return exact(value, ['state','value','reason']) && value.state === 'unavailable' &&
    value.value === null && value.reason === 'owner_review_required';
}
function snapshot(value, organizationId, customerId, billingPartyId) {
  if (!exact(value, ['version','organizationId','billingPartyId','customer','name','address',
    'contact','tax','exemption','delivery','actor','capturedAt','reviewState',
    'documentUseAuthorized','automaticCustomerCreationAuthorized']) ||
      value.version !== 'm27-billing-identity-origin-v1' ||
      value.organizationId !== organizationId || value.billingPartyId !== billingPartyId ||
      value.reviewState !== 'unreviewed' || value.documentUseAuthorized !== false ||
      value.automaticCustomerCreationAuthorized !== false || !utc(value.capturedAt)) return false;
  const customer = value.customer;
  if (!exact(customer, ['identityKind','id','source']) ||
      customer.identityKind !== 'canonical_customer' || customer.id !== customerId) return false;
  const source = customer.source;
  if (!exact(source, ['class','operationId','graphId','externalCustomerId','createdAt','updatedAt','digest']) ||
      source.class !== 'canonical_customer.v1' || !uuid(source.operationId) || !uuid(source.graphId) ||
      !nullableText(source.externalCustomerId, 255) || !utc(source.createdAt) ||
      !utc(source.updatedAt) || !digest(source.digest)) return false;
  if (!sourceField(value.name, 255) || !sourceField(value.address, 16384, true) ||
      !exact(value.contact, ['email','phone']) || !sourceField(value.contact.email, 255) ||
      !sourceField(value.contact.phone, 100) || !unavailableField(value.tax) ||
      !unavailableField(value.exemption) || !unavailableField(value.delivery)) return false;
  const sourceActor = value.actor;
  return exact(sourceActor, ['userId','accessRole','membershipId','authSessionId']) &&
    uuid(sourceActor.userId) && ROLES.has(sourceActor.accessRole) &&
    uuid(sourceActor.membershipId) && uuid(sourceActor.authSessionId);
}
function verified(value, organizationId) {
  const keys = ['version','state','available','current','reason','customerId','billingPartyId',
    'snapshotId','sourceDigest','sourceUpdatedAt','reviewState','documentUseAuthorized','value',
    'automaticCustomerCreationAuthorized'];
  if (!exact(value, keys) || value.version !== 'm27-billing-identity-v1' ||
      value.documentUseAuthorized !== false || value.automaticCustomerCreationAuthorized !== false) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_UNAVAILABLE', 503,
      'Billing identity evidence is unavailable.');
  }
  if (value.state === 'unavailable') {
    if (value.available !== false || ![false, null].includes(value.current) ||
        !UNAVAILABLE.has(value.reason) || value.sourceDigest !== null ||
        value.sourceUpdatedAt !== null || value.reviewState !== null || value.value !== null ||
        (value.customerId !== null && !uuid(value.customerId)) ||
        (value.billingPartyId !== null && !uuid(value.billingPartyId)) ||
        (value.snapshotId !== null && !uuid(value.snapshotId))) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_UNAVAILABLE', 503,
        'Billing identity evidence is unavailable.');
    }
  } else {
    const candidate = value.state === 'candidate_unreviewed';
    if (!['candidate_unreviewed','established_unreviewed'].includes(value.state) ||
        value.available !== true || value.current !== true || value.reason !== null ||
        !uuid(value.customerId) || (candidate ? value.billingPartyId !== null : !uuid(value.billingPartyId)) ||
        (candidate ? value.snapshotId !== null : !uuid(value.snapshotId)) ||
        !digest(value.sourceDigest) || !utc(value.sourceUpdatedAt) ||
        value.reviewState !== 'unreviewed' ||
        !snapshot(value.value, organizationId, value.customerId, value.billingPartyId) ||
        value.value.customer.source.digest !== value.sourceDigest ||
        value.value.customer.source.updatedAt !== value.sourceUpdatedAt) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_UNAVAILABLE', 503,
        'Billing identity evidence is unavailable.');
    }
  }
  return freeze(JSON.parse(JSON.stringify(value)));
}
function normalizeSelection(value) {
  if (!exact(value, ['customerId']) || !uuid(value.customerId)) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_INVALID', 400,
      'Select one exact current customer.');
  }
  return Object.freeze({ customerId: value.customerId.toLowerCase() });
}
function normalizeEstablishment(value) {
  if (!exact(value, ['customerId','expectedSourceDigest','expectedSourceUpdatedAt','reason']) ||
      !uuid(value.customerId) || !digest(value.expectedSourceDigest) ||
      !utc(value.expectedSourceUpdatedAt) || typeof value.reason !== 'string' ||
      value.reason !== value.reason.trim() || Buffer.byteLength(value.reason) < 12 ||
      Buffer.byteLength(value.reason) > 500) {
    throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_INVALID', 400,
      'Billing identity establishment evidence is invalid.');
  }
  return Object.freeze({ customerId: value.customerId.toLowerCase(),
    expectedSourceDigest: value.expectedSourceDigest,
    expectedSourceUpdatedAt: value.expectedSourceUpdatedAt, reason: value.reason });
}
async function candidate(pool, actorValue, selectionValue) {
  actor(actorValue, false); const selection = normalizeSelection(selectionValue);
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_billing_identity_v1_candidate($1,$2,$3,$4,$5) value',
    [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
      actorValue.authSessionId,selection.customerId]);
  return verified(result.rows[0]?.value, actorValue.organizationId);
}
async function read(pool, actorValue, selectionValue) {
  actor(actorValue, false); const selection = normalizeSelection(selectionValue);
  const result = await pool.query(
    'SELECT public.canonical_customer_financial_billing_identity_v1_read($1,$2,$3,$4,$5) value',
    [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
      actorValue.authSessionId,selection.customerId]);
  return verified(result.rows[0]?.value, actorValue.organizationId);
}
async function establish(pool, actorValue, inputValue) {
  actor(actorValue, true); const input = normalizeEstablishment(inputValue);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await client.query(
      'SELECT public.canonical_customer_financial_billing_identity_v1_establish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
      [actorValue.organizationId,actorValue.actorUserId,actorValue.actorAccessRole,
        actorValue.authSessionId,actorValue.csrfToken,actorValue.idempotencyKey,
        input.customerId,input.expectedSourceDigest,input.expectedSourceUpdatedAt,input.reason]);
    const response = result.rows[0]?.value;
    if (!exact(response, ['status','body','replayed']) || ![200,201,409].includes(response.status) ||
        typeof response.replayed !== 'boolean' || (response.replayed && response.status !== 200)) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_UNAVAILABLE', 503,
        'Billing identity evidence is unavailable.');
    }
    const body = verified(response.body, actorValue.organizationId);
    if ((response.status === 409) !== (body.state === 'unavailable') ||
        (response.status === 201 && body.state !== 'established_unreviewed')) {
      throw failure('CUSTOMER_FINANCIAL_BILLING_IDENTITY_UNAVAILABLE', 503,
        'Billing identity evidence is unavailable.');
    }
    await client.query('COMMIT');
    return freeze({ status: response.status, body, replayed: response.replayed });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

module.exports = { candidate, read, establish, normalizeSelection, normalizeEstablishment, verified };
