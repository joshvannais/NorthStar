'use strict';

const { derivePriceDecisionLineage, readPriceDecisionLineage } =
  require('../../src/forecasting/priceDecisionLineage');

const org = '11111111-1111-4111-8111-111111111111';
const estimate = '22222222-2222-4222-8222-222222222222';
const first = '33333333-3333-4333-8333-333333333333';
const second = '44444444-4444-4444-8444-444444444444';
const third = '55555555-5555-4555-8555-555555555555';
const stamp = n => `2026-09-22T12:00:0${n}.000000Z`;
const event = (revision, overrides = {}) => ({
  estimateId: estimate, decisionId: [first, second, third][revision - 1],
  revision, previousId: revision === 1 ? null : [first, second][revision - 2],
  action: 'approve', priceBeforeTax: `${revision}00.00`, currency: 'USD',
  recordedAt: stamp(revision), digest: String(revision).repeat(64), ...overrides,
});
const receipt = (events, overrides = {}) => ({
  id: '66666666-6666-4666-8666-666666666666', version: 'm26-price-event-source-v1',
  organizationId: org, asOf: '2026-09-22T12:01:00.000000Z',
  purposeKey: 'forecast_approved_price_flow', targetKey: 'revenue.approved_price_flow',
  events, eventCount: events.length, sourceSnapshotDigest: 'a'.repeat(64),
  boundary: 'Historical approved-price decision evidence, not earned revenue or a forecast.',
  ...overrides,
});

test('preserves first approval, amendment and withdrawal separately', () => {
  const source = receipt([event(1), event(2, { priceBeforeTax: '250.00' }),
    event(3, { action: 'withdraw', priceBeforeTax: null })]);
  const result = derivePriceDecisionLineage(source);
  expect(result).toMatchObject({ eventCount: 3, estimateCount: 1,
    historicalOnly: true, sourceAuthenticated: false, forecastIssued: false });
  expect(result.estimates[0]).toMatchObject({ estimateId: estimate,
    currentState: 'withdrawn', amendmentCount: 1, withdrawalCount: 1,
    firstApproval: { decisionId: first, priceBeforeTax: '100.00' },
    latestDecision: { decisionId: third, priceBeforeTax: null } });
  source.events[0].priceBeforeTax = '999.00';
  expect(result.estimates[0].firstApproval.priceBeforeTax).toBe('100.00');
  expect(Object.isFrozen(result.estimates[0].firstApproval)).toBe(true);
});

test('empty receipt is historical evidence, not a zero forecast', () => {
  const result = derivePriceDecisionLineage(receipt([]));
  expect(result.estimates).toEqual([]);
  expect(result.estimateCount).toBe(0);
  expect(result.forecastIssued).toBe(false);
});

test.each([
  ['skipped revision', [event(1), event(3, { previousId: first })]],
  ['broken previous decision', [event(1), event(2, { previousId: third })]],
  ['backdated amendment', [event(1), event(2, { recordedAt: stamp(0) })]],
  ['future decision', [event(1, { recordedAt: '2026-09-23T00:00:00.000000Z' })]],
  ['mixed currency in one estimate', [event(1), event(2, { currency: 'EUR' })]],
  ['withdrawal with a price', [event(1), event(2, { action: 'withdraw' })]],
  ['duplicate decision', [event(1), event(2, { decisionId: first })]],
])('rejects %s', (_, events) => {
  expect(() => derivePriceDecisionLineage(receipt(events)))
    .toThrow('Approved-price decision history is invalid.');
});

test('rejects a claimed purpose, count or inherited event field', () => {
  expect(() => derivePriceDecisionLineage(receipt([event(1)],
    { purposeKey: 'forecast_pipeline' }))).toThrow();
  expect(() => derivePriceDecisionLineage(receipt([event(1)],
    { eventCount: 0 }))).toThrow();
  const inherited = Object.create({ estimateId: estimate });
  Object.assign(inherited, event(1));
  expect(() => derivePriceDecisionLineage(receipt([inherited]))).toThrow();
});

test('guarded reader does not call SQL for a member or accept a mismatched receipt', async () => {
  const pool = { query: jest.fn(async () => ({ rows: [{ source: receipt([]) }] })) };
  const actor = { organizationId: org,
    actorUserId: '77777777-7777-4777-8777-777777777777',
    authSessionId: '88888888-8888-4888-8888-888888888888',
    actorAccessRole: 'member' };
  expect(await readPriceDecisionLineage({ pool, actor,
    snapshotId: '99999999-9999-4999-8999-999999999999' }))
    .toEqual({ state: 'unavailable', reason: 'invalid_source_request' });
  expect(pool.query).not.toHaveBeenCalled();
  actor.actorAccessRole = 'owner';
  expect(await readPriceDecisionLineage({ pool, actor,
    snapshotId: '99999999-9999-4999-8999-999999999999' }))
    .toEqual({ state: 'unavailable', reason: 'source_identity_mismatch' });
});
