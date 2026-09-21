'use strict';

const { readReviewedRetellLeadReceipts } = require('../../src/forecasting/retellReviewedLeadReceipts');
const org = '11111111-1111-4111-8111-111111111111';
const ids = ['22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'];
const snapshotId = '55555555-5555-4555-8555-555555555555';
const actor = { organizationId: org, actorUserId: '66666666-6666-4666-8666-666666666666',
  actorAccessRole: 'owner', authSessionId: '77777777-7777-4777-8777-777777777777' };
const window = { actor, snapshotId, startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-09-01T00:00:00.000Z' };
const source = { id: snapshotId, stale: false, asOf: '2026-09-02T00:00:00.000000Z',
  sourceSnapshotDigest: 'a'.repeat(64), sources: ids.map((sourceId, index) => ({
    sourceId, digest: 'b'.repeat(64), eventAt: `2026-08-0${index + 1}T12:00:00.000000Z` })) };
const reviews = { snapshotId, stale: false, sourceSnapshotDigest: source.sourceSnapshotDigest,
  calls: ids.map((callSourceId, index) => ({ callSourceId, status: 'reviewed',
    disposition: ['new_lead', 'repeat_lead', 'not_lead'][index],
    reviewDigest: 'c'.repeat(64), reviewedAt: '2026-09-02T12:00:00.000000Z' })) };
const run = (s = source, r = reviews, overrides = {}) => {
  const query = jest.fn(async () => ({ rows: [{ source: s, reviews: r }] }));
  return { query, result: readReviewedRetellLeadReceipts({ ...window, ...overrides, pool: { query } }) };
};

test('projects only reviewed distinct first receipts without certifying coverage', async () => {
  const { query, result } = run();
  await expect(result).resolves.toMatchObject({ state: 'reviewed_source_only',
    callCount: 3, reviewedDistinctLeadCount: 1, historicalCoverageCertified: false,
    leadReceipts: [{ organizationId: org, leadId: ids[0],
      firstReceiptAt: '2026-08-01T12:00:00.000000Z',
      reviewedAt: '2026-09-02T12:00:00.000000Z' }] });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain('canonical_forecast_retell_call_reviews_read');
  expect(query.mock.calls[0][1]).toEqual([org, actor.actorUserId, 'owner', actor.authSessionId, snapshotId]);
});

test('unresolved, stale, missing event time and source mismatch never count as zero', async () => {
  await expect(run(source, { ...reviews, calls: [
    { ...reviews.calls[0], status: 'unresolved', reviewedAt: null },
    ...reviews.calls.slice(1)] }).result).resolves.toMatchObject({ state: 'unavailable' });
  await expect(run({ ...source, stale: true }).result)
    .resolves.toEqual({ state: 'unavailable', reason: 'source_unavailable' });
  await expect(run({ ...source, sources: [{ ...source.sources[0], eventAt: null },
    ...source.sources.slice(1)] }).result)
    .resolves.toEqual({ state: 'unavailable', reason: 'call_occurrence_unknown' });
  await expect(run(source, { ...reviews, sourceSnapshotDigest: 'd'.repeat(64) }).result)
    .resolves.toEqual({ state: 'unavailable', reason: 'source_unavailable' });
});

test('a reviewed empty set remains a source diagnostic, not a complete zero period', async () => {
  const { result } = run({ ...source, sources: [] }, { ...reviews, calls: [] });
  await expect(result).resolves.toMatchObject({ state: 'reviewed_source_only',
    callCount: 0, reviewedDistinctLeadCount: 0, historicalCoverageCertified: false });
});

test('microsecond window boundaries do not count an earlier call', async () => {
  const earlier = { ...source, sources: [{ ...source.sources[0],
    eventAt: '2026-08-01T00:00:00.000100Z' }, ...source.sources.slice(1)] };
  await expect(run(earlier, reviews, {
    startsAt: '2026-08-01T00:00:00.000500Z',
  }).result).resolves.toMatchObject({ state: 'reviewed_source_only',
    callCount: 2, reviewedDistinctLeadCount: 0 });
});

test('normalizes a valid uppercase snapshot ID and rejects normalized calendar dates', async () => {
  const upper = run(source, reviews, { snapshotId: snapshotId.toUpperCase() });
  await expect(upper.result).resolves.toMatchObject({ state: 'reviewed_source_only' });
  expect(upper.query.mock.calls[0][1][4]).toBe(snapshotId);
  await expect(run(source, reviews, {
    startsAt: '2026-02-30T00:00:00.000Z',
  }).result).resolves.toEqual({ state: 'unavailable', reason: 'invalid_source_window' });
});
