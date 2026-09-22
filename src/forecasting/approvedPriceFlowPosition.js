'use strict';

// A historical position over a bounded M24 price-event receipt. The caller
// supplies the receipt; only the guarded DB reader can authenticate its origin.
const { derivePriceDecisionLineage } = require('./priceDecisionLineage');

const VERSION = 'm26-approved-price-flow-position-v1';
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function invalid() {
  const error = new Error('Approved-price flow window is invalid.');
  error.code = 'M26_APPROVED_PRICE_FLOW_INVALID';
  throw error;
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function exact(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some(key =>
      typeof key !== 'string' || !keys.includes(key))) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}

function cents(value) {
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function summarizeApprovedPriceFlow(receipt, requestedWindow, requestedCurrency) {
  const window = exact(requestedWindow, ['startsAt', 'endsAt']);
  if (!window || !instant(window.startsAt) || !instant(window.endsAt) ||
      window.startsAt >= window.endsAt ||
      typeof requestedCurrency !== 'string' ||
      !/^[A-Z]{3}$/.test(requestedCurrency)) invalid();

  const lineage = derivePriceDecisionLineage(receipt);
  if (window.endsAt > lineage.asOf) invalid();

  let total = 0n;
  let count = 0;
  let mixedCurrency = false;
  for (const row of lineage.estimates) {
    const approval = row.firstApproval;
    if (approval.recordedAt < window.startsAt ||
        approval.recordedAt >= window.endsAt) continue;
    if (approval.currency !== requestedCurrency) {
      mixedCurrency = true;
      continue;
    }
    total += cents(approval.priceBeforeTax);
    count += 1;
  }

  return Object.freeze({
    version: VERSION,
    organizationId: lineage.organizationId,
    asOf: lineage.asOf,
    window: Object.freeze({ ...window }),
    currency: requestedCurrency,
    sourceSnapshotId: lineage.sourceSnapshotId,
    sourceSnapshotDigest: lineage.sourceSnapshotDigest,
    position: Object.freeze(mixedCurrency ? {
      state: 'unavailable', reason: 'currency_mismatch', amount: null,
      includedEventCount: null,
    } : {
      state: 'descriptive_only', reason: null,
      amount: `${total / 100n}.${String(total % 100n).padStart(2, '0')}`,
      includedEventCount: count,
    }),
    historicalOnly: true,
    sourceAuthenticated: false,
    currentnessVerified: false,
    forecastIssued: false,
    earnedRevenueMeasured: false,
    collectedCashMeasured: false,
  });
}

module.exports = { VERSION, summarizeApprovedPriceFlow };
