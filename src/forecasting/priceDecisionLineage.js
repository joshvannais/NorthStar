'use strict';

// Pure interpretation of the bounded M24 event receipt. Authentication belongs
// to the guarded database read; this module cannot certify a caller's object.
const VERSION = 'm26-price-decision-lineage-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const PRICE = /^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
const RECEIPT_KEYS = ['id', 'version', 'organizationId', 'asOf', 'purposeKey',
  'targetKey', 'events', 'eventCount', 'sourceSnapshotDigest', 'boundary'];
const EVENT_KEYS = ['estimateId', 'decisionId', 'revision', 'previousId', 'action',
  'priceBeforeTax', 'currency', 'recordedAt', 'digest'];

function invalid() {
  const error = new Error('Approved-price decision history is invalid.');
  error.code = 'M26_PRICE_LINEAGE_INVALID';
  throw error;
}

function fields(value, keys, requireExact = true) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    if (requireExact) {
      const own = Reflect.ownKeys(value);
      if (own.length !== keys.length || own.some(key =>
        typeof key !== 'string' || !keys.includes(key))) return null;
    }
    const captured = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      captured[key] = descriptor.value;
    }
    return captured;
  } catch { return null; }
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function dense(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 1000 ||
        Reflect.ownKeys(value).length !== length + 1) return null;
    const captured = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      captured.push(descriptor.value);
    }
    return captured;
  } catch { return null; }
}

const uuid = value => typeof value === 'string' && UUID.test(value);
const digest = value => typeof value === 'string' && DIGEST.test(value);
const price = value => typeof value === 'string' && PRICE.test(value);
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function derivePriceDecisionLineage(receipt) {
  const source = fields(receipt, RECEIPT_KEYS);
  const events = dense(source?.events);
  if (!source || !uuid(source.id) ||
      source.version !== 'm26-price-event-source-v1' ||
      !uuid(source.organizationId) || !instant(source.asOf) ||
      source.purposeKey !== 'forecast_approved_price_flow' ||
      source.targetKey !== 'revenue.approved_price_flow' ||
      !events || source.eventCount !== events.length ||
      !digest(source.sourceSnapshotDigest) ||
      typeof source.boundary !== 'string') invalid();

  const estimates = new Map();
  const decisionIds = new Set();
  for (const rawEvent of events) {
    const event = fields(rawEvent, EVENT_KEYS);
    if (!event || !uuid(event.estimateId) ||
        !uuid(event.decisionId) || decisionIds.has(event.decisionId) ||
        !Number.isSafeInteger(event.revision) || event.revision < 1 ||
        event.revision > 10000 ||
        !(event.previousId === null || uuid(event.previousId)) ||
        !['approve', 'withdraw'].includes(event.action) ||
        !currency(event.currency) ||
        !instant(event.recordedAt) || event.recordedAt > source.asOf ||
        !digest(event.digest) ||
        (event.action === 'approve' ? !price(event.priceBeforeTax) :
          event.priceBeforeTax !== null)) invalid();
    decisionIds.add(event.decisionId);
    const prior = estimates.get(event.estimateId);
    if (prior && (event.revision !== prior.latestDecision.revision + 1 ||
        event.previousId !== prior.latestDecision.decisionId ||
        event.recordedAt < prior.latestDecision.recordedAt ||
        event.currency !== prior.currency)) invalid();
    if (!prior && (event.revision !== 1 || event.previousId !== null ||
        event.action !== 'approve' || estimates.size >= 256)) invalid();
    const pin = { decisionId: event.decisionId, revision: event.revision,
      action: event.action, recordedAt: event.recordedAt,
      priceBeforeTax: event.priceBeforeTax, currency: event.currency,
      digest: event.digest };
    if (prior) {
      prior.latestDecision = pin;
      if (event.action === 'approve') prior.amendmentCount += 1;
      else prior.withdrawalCount += 1;
    } else {
      estimates.set(event.estimateId, {
        estimateId: event.estimateId, currency: event.currency,
        firstApproval: pin, latestDecision: pin,
        amendmentCount: 0, withdrawalCount: 0,
      });
    }
  }
  const rows = [...estimates.values()].map(row => ({
    ...row, currentState: row.latestDecision.action === 'approve' ? 'approved' : 'withdrawn',
  }));
  return freeze({ version: VERSION, organizationId: source.organizationId,
    asOf: source.asOf, sourceSnapshotId: source.id,
    sourceSnapshotDigest: source.sourceSnapshotDigest,
    eventCount: source.eventCount, estimateCount: rows.length,
    estimates: rows, historicalOnly: true, sourceAuthenticated: false,
    forecastIssued: false });
}

function unavailable(reason) { return Object.freeze({ state: 'unavailable', reason }); }

async function readPriceDecisionLineage({ pool, actor, snapshotId }) {
  const identity = fields(actor, ['organizationId', 'actorUserId',
    'authSessionId', 'actorAccessRole'], false);
  const query = pool?.query;
  if (typeof query !== 'function' || !identity || !uuid(snapshotId) ||
      !uuid(identity.organizationId) || !uuid(identity.actorUserId) ||
      !uuid(identity.authSessionId) ||
      !['owner', 'admin'].includes(identity.actorAccessRole)) {
    return unavailable('invalid_source_request');
  }
  // The SECURITY DEFINER read checks current membership, session, tenant and
  // paid access. The returned receipt is historical; it may no longer be current.
  const result = await query.call(pool,
    'SELECT public.canonical_forecast_price_event_snapshot_read($1,$2,$3,$4,$5) source',
    [identity.organizationId, identity.actorUserId, identity.actorAccessRole,
      identity.authSessionId, snapshotId]);
  const source = result.rows[0]?.source;
  if (!source) return unavailable('source_unavailable');
  let lineage;
  try { lineage = derivePriceDecisionLineage(source); }
  catch (error) {
    if (error.code === 'M26_PRICE_LINEAGE_INVALID') return unavailable('source_projection_invalid');
    throw error;
  }
  if (lineage.sourceSnapshotId !== snapshotId ||
      lineage.organizationId !== identity.organizationId)
    return unavailable('source_identity_mismatch');
  return Object.freeze({ state: 'historical_source_only', lineage,
    historicalSourceReadAuthorized: true, currentnessVerified: false,
    forecastIssued: false });
}

module.exports = { VERSION, derivePriceDecisionLineage, readPriceDecisionLineage };
