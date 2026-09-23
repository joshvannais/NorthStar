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

test('a synthetic ordered NorthStar month remains a non-forecast candidate', () => {
  const result = assessOrderedPriceMonthCandidate(source(), month);
  expect(result).toMatchObject({ state: 'candidate_window_checks_passed',
    scope: 'northstar_m24_approved_price_decisions',
    inputOrderTimestampDecisionCount: 1, candidateWindowChecksPassed: true,
    sourceMonthVerified: false,
    sourceAuthenticated: false, calendarPeriodVerified: false,
    eligibleForForecast: false,
    wholeBusinessCoverageVerified: false, forecastIssued: false });
  expect(result).not.toHaveProperty('amount');
  expect(result).not.toHaveProperty('confidence');
  expect(result).not.toHaveProperty('probability');
});

test('an empty NorthStar month never becomes a whole-business zero', () => {
  const result = assessOrderedPriceMonthCandidate(source([]), month);
  expect(result).toMatchObject({ state: 'candidate_window_checks_passed',
    inputOrderTimestampDecisionCount: 0, candidateWindowChecksPassed: true,
    sourceMonthVerified: false, calendarPeriodVerified: false,
    wholeBusinessCoverageVerified: false,
    eligibleForForecast: false });
});

test('a boundary trigger timestamp is only a diagnostic, not commit visibility proof', () => {
  const boundary = { ...event('2026-11-30T23:59:59.999999Z'),
    recordedAt: '2026-11-30T23:59:00.000000Z' };
  const result = assessOrderedPriceMonthCandidate(source([boundary]), month);
  expect(result).toMatchObject({ inputOrderTimestampDecisionCount: 1,
    sourceMonthVerified: false, calendarPeriodVerified: false,
    eligibleForForecast: false });
  expect(result).not.toHaveProperty('commitAt');
});

test('first-approval input amount uses decision time and excludes amendments and withdrawals', () => {
  const approval = event();
  const amendmentId = '55555555-5555-4555-8555-555555555555';
  const withdrawalId = '66666666-6666-4666-8666-666666666666';
  const amendment = { ...approval, decisionId: amendmentId, revision: 2,
    previousId: DECISION, priceBeforeTax: '900.00',
    recordedAt: '2026-11-16T11:59:00.000000Z',
    sourceObservedAt: '2026-11-16T12:00:00.000000Z' };
  const withdrawal = { ...amendment, decisionId: withdrawalId, revision: 3,
    previousId: amendmentId, action: 'withdraw', priceBeforeTax: null,
    recordedAt: '2026-11-17T11:59:00.000000Z',
    sourceObservedAt: '2026-11-17T12:00:00.000000Z' };
  const result = assessOrderedPriceMonthCandidate(
    source([approval, amendment, withdrawal]), month, 'USD');
  expect(result).toMatchObject({ state: 'candidate_window_checks_passed',
    inputOrderTimestampDecisionCount: 3, inputCurrency: 'USD',
    inputFirstApprovalCount: 1, inputFirstApprovalAmount: '500.00',
    sourceMonthVerified: false, eligibleForForecast: false });

  const late = { ...approval,
    recordedAt: '2026-11-30T23:59:00.000000Z',
    sourceObservedAt: '2026-12-01T00:00:00.000000Z' };
  const lateResult = assessOrderedPriceMonthCandidate(source([late]), month, 'USD');
  expect(lateResult).toMatchObject({ inputOrderTimestampDecisionCount: 0,
    inputFirstApprovalCount: 1, inputFirstApprovalAmount: '500.00',
    sourceMonthVerified: false });
});

test('mixed first-approval currency and broken revision lineage remain unavailable', () => {
  const euro = { ...event(), currency: 'EUR' };
  expect(assessOrderedPriceMonthCandidate(source([euro]), month, 'USD'))
    .toMatchObject({ state: 'unavailable', reason: 'currency_mismatch',
      inputFirstApprovalAmount: null, calendarPeriodVerified: false,
      eligibleForForecast: false });
  const broken = { ...event(), action: 'withdraw', priceBeforeTax: null,
    previousId: DECISION };
  expect(assessOrderedPriceMonthCandidate(source([broken]), month, 'USD'))
    .toMatchObject({ state: 'unavailable', reason: 'source_revision_conflict' });
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
