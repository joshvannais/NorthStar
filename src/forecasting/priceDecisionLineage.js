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

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key =>
    typeof key === 'string' && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function dense(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 1000 || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function derivePriceDecisionLineage(receipt) {
  if (!exact(receipt, RECEIPT_KEYS) || !UUID.test(receipt.id) ||
      receipt.version !== 'm26-price-event-source-v1' ||
      !UUID.test(receipt.organizationId) || !instant(receipt.asOf) ||
      receipt.purposeKey !== 'forecast_approved_price_flow' ||
      receipt.targetKey !== 'revenue.approved_price_flow' ||
      !dense(receipt.events) || receipt.eventCount !== receipt.events.length ||
      !DIGEST.test(receipt.sourceSnapshotDigest) ||
      typeof receipt.boundary !== 'string') invalid();

  const estimates = new Map();
  const decisionIds = new Set();
  for (const event of receipt.events) {
    if (!exact(event, EVENT_KEYS) || !UUID.test(event.estimateId) ||
        !UUID.test(event.decisionId) || decisionIds.has(event.decisionId) ||
        !Number.isSafeInteger(event.revision) || event.revision < 1 ||
        event.revision > 10000 ||
        !(event.previousId === null || UUID.test(event.previousId)) ||
        !['approve', 'withdraw'].includes(event.action) ||
        !/^[A-Z]{3}$/.test(event.currency) ||
        !instant(event.recordedAt) || event.recordedAt > receipt.asOf ||
        !DIGEST.test(event.digest) ||
        (event.action === 'approve' ? !PRICE.test(event.priceBeforeTax) :
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
  return freeze({ version: VERSION, organizationId: receipt.organizationId,
    asOf: receipt.asOf, sourceSnapshotId: receipt.id,
    sourceSnapshotDigest: receipt.sourceSnapshotDigest,
    eventCount: receipt.eventCount, estimateCount: rows.length,
    estimates: rows, historicalOnly: true, sourceAuthenticated: false,
    forecastIssued: false });
}

function unavailable(reason) { return Object.freeze({ state: 'unavailable', reason }); }

async function readPriceDecisionLineage({ pool, actor, snapshotId }) {
  if (!pool?.query || !actor || !UUID.test(snapshotId) ||
      !UUID.test(actor.organizationId) || !UUID.test(actor.actorUserId) ||
      !UUID.test(actor.authSessionId) ||
      !['owner', 'admin'].includes(actor.actorAccessRole)) {
    return unavailable('invalid_source_request');
  }
  // The SECURITY DEFINER read checks current membership, session, tenant and
  // paid access. The returned receipt is historical; it may no longer be current.
  const result = await pool.query(
    'SELECT public.canonical_forecast_price_event_snapshot_read($1,$2,$3,$4,$5) source',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, snapshotId]);
  const source = result.rows[0]?.source;
  if (!source) return unavailable('source_unavailable');
  if (source.id !== snapshotId || source.organizationId !== actor.organizationId)
    return unavailable('source_identity_mismatch');
  let lineage;
  try { lineage = derivePriceDecisionLineage(source); }
  catch (error) {
    if (error.code === 'M26_PRICE_LINEAGE_INVALID') return unavailable('source_projection_invalid');
    throw error;
  }
  return Object.freeze({ state: 'historical_source_only', lineage,
    historicalSourceReadAuthorized: true, currentnessVerified: false,
    forecastIssued: false });
}

module.exports = { VERSION, derivePriceDecisionLineage, readPriceDecisionLineage };
