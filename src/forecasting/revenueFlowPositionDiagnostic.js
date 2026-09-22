'use strict';

// Pure, unmounted M26 Part 6A arithmetic. Source ownership, first-event
// identity, corrections and complete as-of coverage must be proved elsewhere.
const VERSION = 'm26-revenue-flow-position-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MONEY = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const MAX_RECORDS = 256;

function invalid() {
  const error = new Error('Revenue flow position details are invalid.');
  error.code = 'M26_REVENUE_FLOW_INVALID';
  throw error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function dense(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MAX_RECORDS || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function cents(value) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}
function money(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
function position(state, reason, centsValue, count) {
  return Object.freeze({ state, reason, amount: centsValue === null ? null : money(centsValue),
    includedEventCount: state === 'descriptive_only' ? count : null });
}
function summarizeRevenueFlowPosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'window', 'currency',
    'sourceSnapshotDigest', 'coverage', 'records']) || input.version !== VERSION ||
      !UUID.test(input.organizationId) || !instant(input.asOf) ||
      !exact(input.window, ['startsAt', 'endsAt']) ||
      !instant(input.window.startsAt) || !instant(input.window.endsAt) ||
      input.window.startsAt >= input.window.endsAt || input.window.endsAt > input.asOf ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      typeof input.sourceSnapshotDigest !== 'string' || !DIGEST.test(input.sourceSnapshotDigest) ||
      !exact(input.coverage, ['state', 'recordedThrough', 'hasMore']) ||
      !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
      !instant(input.coverage.recordedThrough) || typeof input.coverage.hasMore !== 'boolean' ||
      input.coverage.recordedThrough > input.asOf ||
      !dense(input.records)) invalid();

  const identities = new Set(), approvalIds = new Set(), bookingIds = new Set();
  let approvedCents = 0n, bookedCents = 0n, approvedCount = 0, bookedCount = 0;
  let approvalProblem = null, bookingProblem = null;
  for (const record of input.records) {
    if (!exact(record, ['estimateId', 'organizationId', 'approvalState', 'approval',
      'bookingState', 'booking']) || !UUID.test(record.estimateId) ||
        record.organizationId !== input.organizationId || identities.has(record.estimateId) ||
        !['approved', 'unapproved', 'unknown'].includes(record.approvalState) ||
        !['booked', 'not_booked', 'unknown'].includes(record.bookingState) ||
        (record.approvalState === 'approved') !== (record.approval !== null) ||
        (record.bookingState === 'booked') !== (record.booking !== null)) invalid();
    identities.add(record.estimateId);
    const approval = record.approval;
    if (approval !== null && (!exact(approval, ['decisionId', 'at', 'recordedAt',
      'price', 'currency']) || !UUID.test(approval.decisionId) ||
      !instant(approval.at) || !instant(approval.recordedAt) ||
      approval.at > approval.recordedAt || approval.recordedAt > input.asOf ||
      typeof approval.price !== 'string' || !MONEY.test(approval.price) ||
      !/^[A-Z]{3}$/.test(approval.currency))) invalid();
    if (approval && approvalIds.has(approval.decisionId)) invalid();
    if (approval) approvalIds.add(approval.decisionId);
    const booking = record.booking;
    if (booking !== null && (!exact(booking, ['bookingId', 'at', 'recordedAt',
      'priceDecisionId', 'effectivePrice', 'linkState']) || !UUID.test(booking.bookingId) ||
      !instant(booking.at) || !instant(booking.recordedAt) ||
      booking.at > booking.recordedAt || booking.recordedAt > input.asOf ||
      !(booking.priceDecisionId === null || UUID.test(booking.priceDecisionId)) ||
      !['reviewed', 'unresolved'].includes(booking.linkState))) invalid();
    if (booking && bookingIds.has(booking.bookingId)) invalid();
    if (booking) bookingIds.add(booking.bookingId);
    const effective = booking?.effectivePrice;
    if (booking && effective !== null &&
        (!exact(effective, ['decisionId', 'approvedAt', 'recordedAt', 'price', 'currency']) ||
          !UUID.test(effective.decisionId) || !instant(effective.approvedAt) ||
          !instant(effective.recordedAt) || effective.approvedAt > effective.recordedAt ||
          effective.recordedAt > input.asOf || typeof effective.price !== 'string' ||
          !MONEY.test(effective.price) || !/^[A-Z]{3}$/.test(effective.currency))) invalid();

    if (record.approvalState === 'unknown') approvalProblem ||= 'unresolved_approval';
    if (approval && approval.at >= input.window.startsAt &&
        approval.at < input.window.endsAt && approval.currency !== input.currency) {
      approvalProblem ||= 'currency_mismatch';
    }
    if (approval && approval.at >= input.window.startsAt && approval.at < input.window.endsAt &&
        approval.currency === input.currency) {
      approvedCents += cents(approval.price); approvedCount += 1;
    }
    if (record.bookingState === 'unknown') bookingProblem ||= 'unresolved_booking';
    if (booking && booking.at >= input.window.startsAt && booking.at < input.window.endsAt) {
      if (!approval || !effective || booking.linkState !== 'reviewed' ||
          booking.priceDecisionId !== effective.decisionId ||
          approval.at > effective.approvedAt ||
          approval.recordedAt > booking.at || effective.recordedAt > booking.at) {
        bookingProblem ||= 'unresolved_price_at_booking';
      } else if (effective.currency !== input.currency) {
        bookingProblem ||= 'currency_mismatch';
      } else {
        bookedCents += cents(effective.price); bookedCount += 1;
      }
    }
  }
  const coverageComplete = input.coverage.state === 'complete' &&
    !input.coverage.hasMore && input.coverage.recordedThrough === input.asOf;
  if (!coverageComplete) approvalProblem = bookingProblem = 'incomplete_source_coverage';
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, window: Object.freeze({ ...input.window }),
    currency: input.currency, sourceSnapshotDigest: input.sourceSnapshotDigest,
    approvedPriceFlow: approvalProblem ? position('unavailable', approvalProblem, null, 0) :
      position('descriptive_only', null, approvedCents, approvedCount),
    bookedWorkValue: bookingProblem ? position('unavailable', bookingProblem, null, 0) :
      position('descriptive_only', null, bookedCents, bookedCount),
    sourceAuthenticated: false, forecastIssued: false,
    earnedRevenueMeasured: false, collectedCashMeasured: false });
}

module.exports = { VERSION, MAX_RECORDS, summarizeRevenueFlowPosition };
