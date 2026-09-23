'use strict';

// Pure M26 Part 6A evaluator, mounted only behind a guarded paid route.
// Only a guarded source read can authenticate its input. This evaluates one
// structural NorthStar ledger month; it never issues a forecast or claims
// whole-business revenue.

const VERSION = 'm26-ordered-price-month-candidate-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function own(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const names = Reflect.ownKeys(value);
    if (names.length !== keys.length || names.some(name =>
      typeof name !== 'string' || !keys.includes(name))) return null;
    const result = {};
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) return null;
      result[key] = property.value;
    }
    return result;
  } catch { return null; }
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function invalid() {
  const error = new Error('Approved-price calendar window is invalid.');
  error.code = 'M26_PRICE_MONTH_CANDIDATE_INVALID';
  throw error;
}

function calendarMonth(window) {
  const value = own(window, ['startsAt', 'endsAt']);
  if (!value || !instant(value.startsAt) || !instant(value.endsAt) ||
      !/^\d{4}-\d{2}-01T00:00:00\.000000Z$/.test(value.startsAt)) invalid();
  const nextMonth = new Date(value.startsAt);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const next = nextMonth.toISOString().replace('.000Z', '.000000Z');
  if (value.endsAt !== next) invalid();
  return value;
}

function unavailable(reason) {
  return Object.freeze({ version: VERSION, state: 'unavailable', reason,
    candidateWindowChecksPassed: false, sourceMonthVerified: false,
    sourceAuthenticated: false,
    eligibleForForecast: false,
    wholeBusinessCoverageVerified: false, forecastIssued: false });
}

function assessOrderedPriceMonthCandidate(readback, requestedWindow) {
  const window = calendarMonth(requestedWindow);
  const source = own(readback, ['snapshot', 'coverageStartsAt', 'firstReceiptId',
    'state', 'sourceOrderCurrent', 'calendarPeriodVerified',
    'eligibleForForecast', 'wholeBusinessCoverageVerified', 'forecastIssued']);
  if (!source || !['current', 'stale'].includes(source.state) ||
      source.sourceOrderCurrent !== (source.state === 'current') ||
      source.calendarPeriodVerified !== false ||
      source.eligibleForForecast !== false ||
      source.wholeBusinessCoverageVerified !== false ||
      source.forecastIssued !== false || !UUID.test(source.firstReceiptId || '') ||
      !instant(source.coverageStartsAt)) return unavailable('invalid_guarded_source');

  const snapshot = own(source.snapshot, ['id', 'version', 'organizationId',
    'capturedAt', 'events', 'eventCount', 'sourceSnapshotDigest', 'scope',
    'wholeBusinessCoverageVerified', 'forecastIssued']);
  if (!snapshot || !UUID.test(snapshot.id || '') ||
      !UUID.test(snapshot.organizationId || '') ||
      snapshot.version !== 'm26-price-ordered-source-v1' ||
      snapshot.scope !== 'northstar_m24_approved_price_decisions' ||
      !instant(snapshot.capturedAt) || !DIGEST.test(snapshot.sourceSnapshotDigest || '') ||
      snapshot.wholeBusinessCoverageVerified !== false ||
      snapshot.forecastIssued !== false ||
      !Number.isSafeInteger(snapshot.eventCount) ||
      snapshot.eventCount < 0 || snapshot.eventCount > 1000 ||
      !Array.isArray(snapshot.events) || snapshot.events.length !== snapshot.eventCount ||
      source.coverageStartsAt > snapshot.capturedAt) {
    return unavailable('invalid_guarded_source');
  }
  if (source.state !== 'current') return unavailable('source_changed');
  if (window.startsAt < source.coverageStartsAt) {
    return unavailable('period_before_ordered_anchor');
  }
  if (window.endsAt > snapshot.capturedAt) {
    return unavailable('period_not_yet_closed');
  }

  let previous = source.coverageStartsAt;
  let count = 0;
  const decisionIds = new Set();
  for (const raw of snapshot.events) {
    const event = own(raw, ['estimateId', 'decisionId', 'revision', 'previousId',
      'action', 'priceBeforeTax', 'currency', 'recordedAt', 'sourceObservedAt',
      'digest']);
    if (!event || !UUID.test(event.estimateId || '') ||
        !UUID.test(event.decisionId || '') ||
        decisionIds.has(event.decisionId) ||
        !Number.isSafeInteger(event.revision) ||
        event.revision < 1 || event.revision > 10000 ||
        event.previousId !== null && !UUID.test(event.previousId || '') ||
        !['approve', 'withdraw'].includes(event.action) ||
        typeof event.currency !== 'string' || !/^[A-Z]{3}$/.test(event.currency) ||
        (event.action === 'approve' &&
          (typeof event.priceBeforeTax !== 'string' ||
           !/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(event.priceBeforeTax))) ||
        (event.action === 'withdraw' &&
          (event.priceBeforeTax !== null || event.previousId === null)) ||
        !instant(event.recordedAt) || !instant(event.sourceObservedAt) ||
        event.recordedAt > event.sourceObservedAt ||
        !DIGEST.test(event.digest || '') ||
        event.sourceObservedAt < previous ||
        event.sourceObservedAt > snapshot.capturedAt) {
      return unavailable('source_clock_order_conflict');
    }
    decisionIds.add(event.decisionId);
    previous = event.sourceObservedAt;
    if (event.sourceObservedAt >= window.startsAt &&
        event.sourceObservedAt < window.endsAt) count += 1;
  }

  return Object.freeze({ version: VERSION,
    state: 'candidate_window_checks_passed', reason: null,
    organizationId: snapshot.organizationId,
    sourceSnapshotId: snapshot.id,
    sourceSnapshotDigest: snapshot.sourceSnapshotDigest,
    coverageStartsAt: source.coverageStartsAt,
    capturedAt: snapshot.capturedAt,
    window: Object.freeze({ ...window }),
    scope: 'northstar_m24_approved_price_decisions',
    inputDecisionCount: count,
    candidateWindowChecksPassed: true,
    sourceMonthVerified: false,
    sourceAuthenticated: false,
    calendarPeriodVerified: false,
    eligibleForForecast: false,
    wholeBusinessCoverageVerified: false,
    forecastIssued: false });
}

module.exports = { VERSION, calendarMonth, assessOrderedPriceMonthCandidate };
