'use strict';

const { assessOrderedPriceMonthCandidate } =
  require('../../src/forecasting/orderedPriceMonthCandidate');

const ORG = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = '22222222-2222-4222-8222-222222222222';
const DECISION = '33333333-3333-4333-8333-333333333333';
const ESTIMATE = '44444444-4444-4444-8444-444444444444';
const DIGEST = 'a'.repeat(64);
const month = { startsAt: '2026-11-01T00:00:00.000000Z',
  endsAt: '2026-12-01T00:00:00.000000Z' };

function event(sourceObservedAt = '2026-11-15T12:00:00.000000Z') {
  return { estimateId: ESTIMATE, decisionId: DECISION, revision: 1,
    previousId: null, action: 'approve', priceBeforeTax: '500.00', currency: 'USD',
    recordedAt: '2026-11-15T11:59:00.000000Z', sourceObservedAt,
    digest: DIGEST };
}

function source(events = [event()]) {
  return {
    snapshot: { id: SNAPSHOT, version: 'm26-price-ordered-source-v1',
      organizationId: ORG, capturedAt: '2026-12-02T00:00:00.000000Z',
      events, eventCount: events.length, sourceSnapshotDigest: DIGEST,
      scope: 'northstar_m24_approved_price_decisions',
      wholeBusinessCoverageVerified: false, forecastIssued: false },
    coverageStartsAt: '2026-10-01T00:00:00.000000Z',
    firstReceiptId: SNAPSHOT, state: 'current', sourceOrderCurrent: true,
    calendarPeriodVerified: false, eligibleForForecast: false,
    wholeBusinessCoverageVerified: false, forecastIssued: false,
  };
}

test('a complete ordered NorthStar month remains a non-forecast candidate', () => {
  const result = assessOrderedPriceMonthCandidate(source(), month);
  expect(result).toMatchObject({ state: 'candidate_northstar_ledger_month',
    scope: 'northstar_m24_approved_price_decisions',
    sourceObservedDecisionCount: 1, sourceMonthStructurallyCovered: true,
    sourceAuthenticated: false, calendarPeriodVerified: false,
    eligibleForForecast: false,
    wholeBusinessCoverageVerified: false, forecastIssued: false });
  expect(result).not.toHaveProperty('amount');
  expect(result).not.toHaveProperty('confidence');
  expect(result).not.toHaveProperty('probability');
});

test('an empty NorthStar month never becomes a whole-business zero', () => {
  const result = assessOrderedPriceMonthCandidate(source([]), month);
  expect(result).toMatchObject({ state: 'candidate_northstar_ledger_month',
    sourceObservedDecisionCount: 0, wholeBusinessCoverageVerified: false,
    eligibleForForecast: false });
});

test('pre-anchor, unclosed and stale months remain unavailable', () => {
  const before = source();
  before.coverageStartsAt = '2026-11-02T00:00:00.000000Z';
  expect(assessOrderedPriceMonthCandidate(before, month)).toMatchObject({
    state: 'unavailable', reason: 'period_before_ordered_anchor' });
  const unclosed = source();
  unclosed.snapshot.capturedAt = '2026-11-30T23:59:59.999999Z';
  expect(assessOrderedPriceMonthCandidate(unclosed, month)).toMatchObject({
    state: 'unavailable', reason: 'period_not_yet_closed' });
  const stale = source();
  stale.state = 'stale'; stale.sourceOrderCurrent = false;
  expect(assessOrderedPriceMonthCandidate(stale, month)).toMatchObject({
    state: 'unavailable', reason: 'source_changed' });
});

test('out-of-order source clock or private global order input fails closed', () => {
  const rollback = source([event('2026-11-15T12:00:00.000000Z'),
    { ...event('2026-11-14T12:00:00.000000Z'), decisionId: SNAPSHOT,
      recordedAt: '2026-11-14T11:59:00.000000Z' }]);
  expect(assessOrderedPriceMonthCandidate(rollback, month)).toMatchObject({
    state: 'unavailable', reason: 'source_clock_order_conflict' });
  const leaked = source();
  leaked.snapshot.events[0].sourceOrder = 997;
  expect(assessOrderedPriceMonthCandidate(leaked, month)).toMatchObject({
    state: 'unavailable', reason: 'source_clock_order_conflict' });
  const duplicate = source([event(), event()]);
  expect(assessOrderedPriceMonthCandidate(duplicate, month)).toMatchObject({
    state: 'unavailable', reason: 'source_clock_order_conflict' });
});

test('a partial or non-canonical calendar window is rejected', () => {
  expect(() => assessOrderedPriceMonthCandidate(source(), {
    startsAt: '2026-11-02T00:00:00.000000Z', endsAt: month.endsAt,
  })).toThrow('Approved-price calendar window is invalid.');
  expect(() => assessOrderedPriceMonthCandidate(source(), {
    startsAt: month.startsAt, endsAt: '2026-12-02T00:00:00.000000Z',
  })).toThrow('Approved-price calendar window is invalid.');
  expect(() => assessOrderedPriceMonthCandidate(source(), {
    startsAt: month.startsAt, endsAt: month.endsAt, discount: 1,
  })).toThrow('Approved-price calendar window is invalid.');
});
