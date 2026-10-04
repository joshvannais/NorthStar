'use strict';

const { CapacityAdvisoryContinuationWorker } =
  require('../../src/services/capacityAdvisoryContinuationWorker');

describe('Mission 26 Part 5C prospective continuation worker', () => {
  test('activates every server-selected due reservation in its own serializable transaction', async () => {
    const queries = [];
    const client = { query: jest.fn(async (sql, params) => {
      queries.push([sql, params]); return { rows: [{ value: { state: 'capacity_advisory_continuation_activated' } }] };
    }), release: jest.fn() };
    const pool = { query: jest.fn(async () => ({ rows: [
      { organization_id: '11111111-1111-4111-8111-111111111111', continuation_id: '22222222-2222-4222-8222-222222222222' },
      { organization_id: '11111111-1111-4111-8111-111111111111', continuation_id: '33333333-3333-4333-8333-333333333333' },
    ] })), connect: jest.fn(async () => client) };
    const worker = new CapacityAdvisoryContinuationWorker({ getPool: () => pool, batchSize: 2 });
    await expect(worker.drainOnce()).resolves.toEqual({ due: 2, attempted: 2 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('canonical_forecast_capacity_advisory_v1_continuation_due'), [2]);
    expect(queries.filter(([sql]) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(2);
    expect(queries.filter(([sql]) => sql.includes('_continuation_activate'))).toHaveLength(2);
    expect(queries.filter(([sql]) => sql === 'COMMIT')).toHaveLength(2);
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  test('is side-effect free without a pool and keeps polling failures private', async () => {
    const absent = new CapacityAdvisoryContinuationWorker({ getPool: () => null });
    await expect(absent.drainOnce()).resolves.toEqual({ due: 0, attempted: 0 });
    const failing = new CapacityAdvisoryContinuationWorker({ getPool: () => ({
      query: jest.fn(async () => { throw new Error('private tenant detail'); }),
    }) });
    failing.stopped = false;
    await expect(failing.tick()).resolves.toBe(true);
    failing.stop();
  });
});
