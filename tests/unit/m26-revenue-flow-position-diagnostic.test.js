'use strict';

const { VERSION, summarizeRevenueFlowPosition } =
  require('../../src/forecasting/revenueFlowPositionDiagnostic');

const organizationId = '11111111-1111-4111-8111-111111111111';
const estimateA = '22222222-2222-4222-8222-222222222222';
const estimateB = '33333333-3333-4333-8333-333333333333';
const decisionA = '44444444-4444-4444-8444-444444444444';
const bookingA = '55555555-5555-4555-8555-555555555555';
const asOf = '2026-10-08T00:00:00.000Z';
const window = { startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-10-07T00:00:00.000Z' };
const approval = (overrides = {}) => ({ decisionId: decisionA,
  at: '2026-10-02T12:00:00.000Z', recordedAt: '2026-10-02T12:01:00.000Z',
  price: '1234.50', currency: 'USD', ...overrides });
const booking = (overrides = {}) => ({ bookingId: bookingA,
  at: '2026-10-04T12:00:00.000Z', recordedAt: '2026-10-04T12:01:00.000Z',
  priceDecisionId: decisionA, effectivePrice: { decisionId: decisionA,
    approvedAt: '2026-10-02T12:00:00.000Z',
    recordedAt: '2026-10-02T12:01:00.000Z', price: '1234.50', currency: 'USD' },
  linkState: 'reviewed', ...overrides });
const record = (overrides = {}) => ({ estimateId: estimateA, organizationId,
  approvalState: 'approved', approval: approval(), bookingState: 'booked',
  booking: booking(), ...overrides });
const input = (records = [record()], overrides = {}) => ({ version: VERSION,
  organizationId, asOf, window, currency: 'USD', sourceSnapshotDigest: 'a'.repeat(64),
  coverage: { state: 'complete', recordedThrough: asOf, hasMore: false },
  records, ...overrides });

test('keeps approved price and booked value as distinct event flows', () => {
  const result = summarizeRevenueFlowPosition(input([record(), record({
    estimateId: estimateB, approval: approval({ decisionId: estimateB,
      at: '2026-09-30T12:00:00.000Z', recordedAt: '2026-09-30T12:01:00.000Z',
      price: '500.00' }), booking: booking({ bookingId: estimateB,
      priceDecisionId: estimateB, effectivePrice: {
        decisionId: estimateB, approvedAt: '2026-09-30T12:00:00.000Z',
        recordedAt: '2026-09-30T12:01:00.000Z', price: '500.00', currency: 'USD',
      } }) })]));
  expect(result.approvedPriceFlow).toMatchObject({ amount: '1234.50',
    includedEventCount: 1, state: 'descriptive_only' });
  expect(result.bookedWorkValue).toMatchObject({ amount: '1734.50',
    includedEventCount: 2, state: 'descriptive_only' });
  expect(result.forecastIssued).toBe(false);
  expect(result.sourceAuthenticated).toBe(false);
  expect(result.earnedRevenueMeasured).toBe(false);
  expect(result.collectedCashMeasured).toBe(false);
  expect(Object.isFrozen(result.approvedPriceFlow)).toBe(true);
});

test('a reviewed amendment effective before booking changes booked value only', () => {
  const result = summarizeRevenueFlowPosition(input([record({ booking: booking({
    priceDecisionId: estimateB, effectivePrice: {
      decisionId: estimateB, approvedAt: '2026-10-03T12:00:00.000Z',
      recordedAt: '2026-10-03T12:01:00.000Z', price: '1500.00', currency: 'USD',
    },
  }) })]));
  expect(result.approvedPriceFlow.amount).toBe('1234.50');
  expect(result.bookedWorkValue.amount).toBe('1500.00');
});

test('unapproved proposal is not approved price or booked work', () => {
  const result = summarizeRevenueFlowPosition(input([{ estimateId: estimateA,
    organizationId, approvalState: 'unapproved', approval: null,
    bookingState: 'not_booked', booking: null }]));
  expect(result.approvedPriceFlow.amount).toBe('0.00');
  expect(result.bookedWorkValue.amount).toBe('0.00');
});

test('a booking without a visible reviewed price withholds only booked value', () => {
  const result = summarizeRevenueFlowPosition(input([record({
    booking: booking({ priceDecisionId: estimateB }) })]));
  expect(result.approvedPriceFlow.amount).toBe('1234.50');
  expect(result.bookedWorkValue).toMatchObject({ state: 'unavailable',
    reason: 'unresolved_price_at_booking', amount: null });
});

test('an approval recorded after booking cannot be retroactively counted', () => {
  const result = summarizeRevenueFlowPosition(input([record({
    approval: approval({ recordedAt: '2026-10-05T00:00:00.000Z' }),
    booking: booking({ effectivePrice: { ...booking().effectivePrice,
      recordedAt: '2026-10-05T00:00:00.000Z' } }),
  })]));
  expect(result.bookedWorkValue.reason).toBe('unresolved_price_at_booking');
});

test('mixed currencies and incomplete coverage never become zeros', () => {
  const mixed = summarizeRevenueFlowPosition(input([record({
    approval: approval({ currency: 'CAD' }), booking: booking({
      effectivePrice: { ...booking().effectivePrice, currency: 'CAD' },
    }) })]));
  expect(mixed.approvedPriceFlow).toMatchObject({ state: 'unavailable',
    reason: 'currency_mismatch', amount: null });
  expect(mixed.bookedWorkValue.reason).toBe('currency_mismatch');
  const missing = summarizeRevenueFlowPosition(input([], {
    coverage: { state: 'incomplete', recordedThrough: asOf, hasMore: true },
  }));
  expect(missing.approvedPriceFlow.amount).toBeNull();
  expect(missing.bookedWorkValue.amount).toBeNull();
});

test('malformed, repeated, later, or over-bound records fail closed', () => {
  expect(() => summarizeRevenueFlowPosition(input([record(), record()])))
    .toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([record(), record({
    estimateId: estimateB, approval: approval({ decisionId: estimateB }),
  })]))).toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([record({
    booking: booking({ priceDecisionId: estimateB,
      effectivePrice: { ...booking().effectivePrice, decisionId: estimateB },
    }),
  }), record({ estimateId: estimateB,
    approval: approval({ decisionId: estimateB }),
    booking: booking({ bookingId: estimateB, priceDecisionId: estimateB,
      effectivePrice: { ...booking().effectivePrice, decisionId: estimateB },
    }),
  })]))).toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([record({
    approval: approval({ recordedAt: '2026-10-09T00:00:00.000Z' }) })])))
    .toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([record({
    approval: approval({ price: '-1.00' }) })])))
    .toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([record({
    booking: booking({ effectivePrice: undefined }) })])))
    .toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([record({ booking: booking({
    effectivePrice: { ...booking().effectivePrice, price: '999.00' },
  }) })]))).toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  const disguisedId = { toString: () => estimateA };
  expect(() => summarizeRevenueFlowPosition(input([record({
    estimateId: disguisedId,
  })]))).toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([], {
    currency: { toString: () => 'USD' },
  }))).toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input([], { window: {
    startsAt: window.startsAt, endsAt: '2026-10-09T00:00:00.000Z',
  } }))).toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
  expect(() => summarizeRevenueFlowPosition(input(Array(257).fill(record()))))
    .toThrow(expect.objectContaining({ code: 'M26_REVENUE_FLOW_INVALID' }));
});
