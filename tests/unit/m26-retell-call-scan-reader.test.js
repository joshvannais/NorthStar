'use strict';

const { inspectRetellCallWindow } = require('../../src/forecasting/retellCallScanReader');

const actor = { organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222', actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333' };
const first = { state: 'ready_for_diagnostic', agentId: 'agent_tenant',
  startsAt: '2026-08-01T00:00:00.000000Z', endsAt: '2026-09-01T00:00:00.000000Z',
  canonicalCallDigests: [], sourceSnapshotDigest: 'a'.repeat(64),
  historicalCoverageCertified: false };
const args = { actor, snapshotId: '44444444-4444-4444-8444-444444444444',
  startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z' };

test('only a current guarded scan input can run the provider diagnostic', async () => {
  const query = jest.fn(async () => ({ rows: [{ value: first }] }));
  const fetchPage = jest.fn(async () => ({ has_more: false, items: [] }));
  await expect(inspectRetellCallWindow({ ...args, pool: { query }, fetchPage }))
    .resolves.toMatchObject({ state: 'snapshot_matched', historicalCoverageCertified: false });
  expect(query).toHaveBeenCalledTimes(2);
  expect(fetchPage).toHaveBeenCalledWith({ agentId: first.agentId,
    startsAtMs: Date.parse(args.startsAt), endsAtMs: Date.parse(args.endsAt),
    paginationKey: undefined });
});

test('a changed source or permission during the provider scan is unavailable', async () => {
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ value: first }] })
    .mockResolvedValueOnce({ rows: [{ value: { state: 'unavailable', reason: 'source_stale' } }] });
  await expect(inspectRetellCallWindow({ ...args, pool: { query },
    fetchPage: async () => ({ has_more: false, items: [] }) }))
    .resolves.toEqual({ state: 'unavailable', reason: 'source_changed_during_scan' });
});

test('unavailable guarded source never contacts Retell', async () => {
  const fetchPage = jest.fn();
  const pool = { query: async () => ({ rows: [{ value: { state: 'unavailable', reason: 'source_stale' } }] }) };
  await expect(inspectRetellCallWindow({ ...args, pool, fetchPage }))
    .resolves.toEqual({ state: 'unavailable', reason: 'source_stale' });
  expect(fetchPage).not.toHaveBeenCalled();
});
