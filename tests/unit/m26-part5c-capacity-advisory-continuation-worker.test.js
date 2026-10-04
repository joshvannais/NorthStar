'use strict';

const { CapacityAdvisoryContinuationWorker } =
  require('../../src/services/capacityAdvisoryContinuationWorker');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ID_A = '33333333-3333-4333-8333-333333333333';
const ID_B = '44444444-4444-4444-8444-444444444444';

function mockPool(items, { failIds = new Set() } = {}) {
  const claimed = new Set();
  const queries = [];
  const client = { query: jest.fn(async (sql, params = []) => {
    queries.push([sql, params.map(value => Array.isArray(value) ? [...value] : value)]);
    if (sql.includes('_continuation_claim_due')) {
      const excluded = new Set(params[0] || []);
      const item = items.find(value => !claimed.has(`${value.organization_id}:${value.continuation_id}`) &&
        !excluded.has(`${value.organization_id}:${value.continuation_id}`));
      if (item) claimed.add(item.continuation_id);
      return { rows: item ? [item] : [] };
    }
    if (sql.includes('_continuation_activate')) {
      if (failIds.has(params[1])) throw new Error('private tenant detail');
      return { rows: [{ value: { state: 'capacity_advisory_continuation_activated' } }] };
    }
    return { rows: [] };
  }), release: jest.fn() };
  return { pool: { connect: jest.fn(async () => client) }, client, queries };
}

describe('Mission 26 Part 5C prospective continuation worker', () => {
  test('claims every server-selected reservation in a separate serializable transaction', async () => {
    const { pool, client, queries } = mockPool([
      { organization_id: ORG_A, continuation_id: ID_A },
      { organization_id: ORG_B, continuation_id: ID_B },
    ]);
    const worker = new CapacityAdvisoryContinuationWorker({ getPool: () => pool, batchSize: 2 });
    await expect(worker.drainOnce()).resolves.toEqual({ due: 2, attempted: 2 });
    expect(queries.filter(([sql]) => sql.includes('_continuation_claim_due'))).toHaveLength(2);
    expect(queries.filter(([sql]) => sql.includes('_continuation_activate'))).toHaveLength(2);
    expect(queries.filter(([sql]) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(4);
    expect(queries.filter(([sql]) => sql === 'COMMIT')).toHaveLength(4);
    expect(client.release).toHaveBeenCalledTimes(4);
  });

  test('isolates a failed first tenant and continues to a later valid reservation', async () => {
    const { pool, queries } = mockPool([
      { organization_id: ORG_A, continuation_id: ID_A },
      { organization_id: ORG_B, continuation_id: ID_B },
    ], { failIds: new Set([ID_A]) });
    const worker = new CapacityAdvisoryContinuationWorker({ getPool: () => pool, batchSize: 2 });
    await expect(worker.drainOnce()).resolves.toEqual({ due: 2, attempted: 2 });
    expect(queries.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(queries.filter(([sql]) => sql === 'COMMIT')).toHaveLength(3);
    expect(queries.filter(([sql, params]) => sql.includes('_continuation_activate') && params[1] === ID_B))
      .toHaveLength(1);
    const secondClaim = queries.filter(([sql]) => sql.includes('_continuation_claim_due'))[1];
    expect(secondClaim[1][0]).toEqual([`${ORG_A}:${ID_A}`]);
  });

  test('is side-effect free without a pool and keeps pre-claim failures private', async () => {
    const absent = new CapacityAdvisoryContinuationWorker({ getPool: () => null });
    await expect(absent.drainOnce()).resolves.toEqual({ due: 0, attempted: 0 });
    const failing = new CapacityAdvisoryContinuationWorker({ getPool: () => ({
      connect: jest.fn(async () => { throw new Error('private tenant detail'); }),
    }) });
    failing.stopped = false;
    await expect(failing.tick()).resolves.toBe(true);
    failing.stop();
  });
});
