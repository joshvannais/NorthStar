'use strict';

const { summarizeApprovedPriceFlow } =
  require('../../src/forecasting/approvedPriceFlowPosition');

const org = '11111111-1111-4111-8111-111111111111';
const estimateA = '22222222-2222-4222-8222-222222222222';
const estimateB = '33333333-3333-4333-8333-333333333333';
const decisionA = '44444444-4444-4444-8444-444444444444';
const decisionB = '55555555-5555-4555-8555-555555555555';
const decisionC = '66666666-6666-4666-8666-666666666666';
const at = n => `2026-09-22T12:00:0${n}.000000Z`;
const event = (estimateId, decisionId, revision, previousId, action,
  priceBeforeTax, recordedAt, currency = 'USD') => ({
  estimateId, decisionId, revision, previousId, action, priceBeforeTax,
  currency, recordedAt, digest: decisionId.slice(0, 1).repeat(64),
});
const receipt = events => ({
  id: '77777777-7777-4777-8777-777777777777',
  version: 'm26-price-event-source-v1', organizationId: org,
  asOf: '2026-09-22T12:01:00.000000Z',
  purposeKey: 'forecast_approved_price_flow',
  targetKey: 'revenue.approved_price_flow', events, eventCount: events.length,
  sourceSnapshotDigest: 'a'.repeat(64),
  boundary: 'Historical decision evidence only.',
});
const window = { startsAt: at(1), endsAt: at(5) };

test('counts each first approval once despite later amendment and withdrawal', () => {
  const source = receipt([
    event(estimateA, decisionA, 1, null, 'approve', '100.00', at(1)),
    event(estimateA, decisionB, 2, decisionA, 'approve', '250.00', at(2)),
    event(estimateA, decisionC, 3, decisionB, 'withdraw', null, at(3)),
  ]);
  const result = summarizeApprovedPriceFlow(source, window, 'USD');
  expect(result.position).toEqual({ state: 'descriptive_only', reason: null,
    amount: '100.00', includedEventCount: 1 });
  expect(result).toMatchObject({ historicalOnly: true,
    sourceAuthenticated: false, currentnessVerified: false,
    forecastIssued: false, earnedRevenueMeasured: false,
    collectedCashMeasured: false });
});

test('uses half-open microsecond boundaries and exact cents', () => {
  const source = receipt([
    event(estimateA, decisionA, 1, null, 'approve', '0.01', at(1)),
    event(estimateB, decisionB, 1, null, 'approve', '0.02', at(4)),
  ]);
  expect(summarizeApprovedPriceFlow(source, window, 'USD').position.amount).toBe('0.03');
  expect(summarizeApprovedPriceFlow(source,
    { startsAt: at(4), endsAt: at(5) }, 'USD').position.amount).toBe('0.02');
  expect(summarizeApprovedPriceFlow(source,
    { startsAt: at(2), endsAt: at(4) }, 'USD').position.amount).toBe('0.00');
});

test('does not sum unlike currencies or pretend source authorization', () => {
  const source = receipt([
    event(estimateA, decisionA, 1, null, 'approve', '100.00', at(1)),
    event(estimateB, decisionB, 1, null, 'approve', '200.00', at(2), 'EUR'),
  ]);
  expect(summarizeApprovedPriceFlow(source, window, 'USD').position).toEqual({
    state: 'unavailable', reason: 'currency_mismatch', amount: null,
    includedEventCount: null,
  });
  expect(summarizeApprovedPriceFlow(receipt([]), window, 'USD').position)
    .toMatchObject({ state: 'descriptive_only', amount: '0.00' });
});

test('rejects invalid lineage, window and future cutoff', () => {
  expect(() => summarizeApprovedPriceFlow(receipt([]),
    { startsAt: at(5), endsAt: at(1) }, 'USD')).toThrow();
  expect(() => summarizeApprovedPriceFlow(receipt([]),
    { startsAt: at(1), endsAt: '2026-09-22T12:02:00.000000Z' }, 'USD')).toThrow();
  expect(() => summarizeApprovedPriceFlow(receipt([]), window, 'usd')).toThrow();
  expect(() => summarizeApprovedPriceFlow(receipt([
    event(estimateA, decisionA, 2, null, 'approve', '100.00', at(1)),
  ]), window, 'USD')).toThrow();
});
