'use strict';

const {
  GLOBAL_CALLS_PER_MINUTE,
  HomepageDemoAdmissionHousekeepingWorker,
  HomepageDemoAdmissionRepository,
  PROJECTION_CALLS_GLOBAL_PER_MINUTE,
  PROJECTION_CALLS_PER_SOURCE_MINUTE,
  PURGE_CALLS_GLOBAL_PER_MINUTE,
  PURGE_CALLS_PER_SOURCE_MINUTE,
  PURGE_ATTEMPTS_PER_CAPABILITY,
  SOURCE_CALLS_PER_HOUR,
  sourceHash,
} = require('../../src/services/homepageDemoAdmission');

describe('Homepage Web Call durable admission', () => {
  const secret = 'admission-test-secret-'.padEnd(64, 'z');

  test('source identifiers become stable HMACs without raw-address persistence', () => {
    const first = sourceHash('203.0.113.42', secret);
    const second = sourceHash('203.0.113.42', secret);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('203.0.113.42');
    expect(sourceHash('203.0.113.43', secret)).not.toBe(first);
  });

  test('invalid source or short secret fails closed', () => {
    expect(() => sourceHash('', secret)).toThrow(/admission authority is unavailable/i);
    expect(() => sourceHash('203.0.113.42', 'short')).toThrow(/admission authority is unavailable/i);
  });

  test('transaction claims source and global windows with bounded cleanup', async () => {
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql: String(sql), params });
        if (String(sql).includes('RETURNING request_count')) return { rowCount: 1, rows: [{ request_count: 1 }] };
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client) };
    const repository = new HomepageDemoAdmissionRepository({
      pool,
      now: () => new Date('2026-08-16T12:34:00.000Z'),
    });
    await expect(repository.admit('a'.repeat(64))).resolves.toBe(true);
    expect(statements[0].sql).toBe('BEGIN');
    expect(statements.at(-1).sql).toBe('COMMIT');
    const claims = statements.filter(entry => entry.sql.includes('RETURNING request_count'));
    expect(claims).toHaveLength(2);
    expect(claims[0].params).toEqual(expect.arrayContaining(['hour', 'source_hour', 'a'.repeat(64), SOURCE_CALLS_PER_HOUR]));
    expect(claims[1].params).toEqual(expect.arrayContaining(['minute', 'global_minute', GLOBAL_CALLS_PER_MINUTE]));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('a full window rolls back and returns the bounded 429', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (String(sql).includes('RETURNING request_count')) return { rowCount: 0, rows: [] };
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    const repository = new HomepageDemoAdmissionRepository({
      pool: { connect: jest.fn(async () => client) },
      now: () => new Date('2026-08-16T12:34:00.000Z'),
    });
    await expect(repository.admit('b'.repeat(64))).rejects.toMatchObject({
      status: 429,
      code: 'homepage_web_call_rate_limited',
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('Polaris projection uses separate durable source and global minute ceilings', async () => {
    const claims = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        if (String(sql).includes('RETURNING request_count')) {
          claims.push(params);
          return { rowCount: 1, rows: [{ request_count: 1 }] };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    const repository = new HomepageDemoAdmissionRepository({
      pool: { connect: jest.fn(async () => client) },
      now: () => new Date('2026-08-16T12:34:00.000Z'),
    });
    await expect(repository.admitProjection('c'.repeat(64))).resolves.toBe(true);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual(expect.arrayContaining([
      'minute', 'projection_source_minute', 'c'.repeat(64), PROJECTION_CALLS_PER_SOURCE_MINUTE,
    ]));
    expect(claims[1]).toEqual(expect.arrayContaining([
      'minute', 'projection_global_minute', PROJECTION_CALLS_GLOBAL_PER_MINUTE,
    ]));
  });

  test('verified deletion claims one durable capability lease before source and global quota', async () => {
    const claims = [];
    const now = new Date('2026-08-16T12:34:00.000Z');
    const client = {
      query: jest.fn(async (sql, params) => {
        if (String(sql).includes('INSERT INTO homepage_demo_purge_operations')) {
          return {
            rowCount: 1,
            rows: [{
              state: 'in_progress',
              attempt_count: 1,
              lease_expires_at: new Date(now.getTime() + 120000),
              authority_expires_at: new Date(now.getTime() + 600000),
            }],
          };
        }
        if (String(sql).includes('RETURNING request_count')) {
          claims.push(params);
          return { rowCount: 1, rows: [{ request_count: 1 }] };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    const repository = new HomepageDemoAdmissionRepository({
      pool: { connect: jest.fn(async () => client) },
      now: () => now,
    });
    await expect(repository.beginPurge(
      'd'.repeat(64),
      'e'.repeat(64),
      now.getTime() + 600000
    )).resolves.toEqual({ execute: true, verified: false, attemptCount: 1 });
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual(expect.arrayContaining([
      'minute', 'purge_source_minute', 'd'.repeat(64), PURGE_CALLS_PER_SOURCE_MINUTE,
    ]));
    expect(claims[1]).toEqual(expect.arrayContaining([
      'minute', 'purge_global_minute', PURGE_CALLS_GLOBAL_PER_MINUTE,
    ]));
  });

  test('verified capability replay returns cached success without spending quota', async () => {
    const now = new Date('2026-08-16T12:34:00.000Z');
    const client = {
      query: jest.fn(async sql => {
        const text = String(sql);
        if (text.includes('INSERT INTO homepage_demo_purge_operations')) return { rowCount: 0, rows: [] };
        if (text.includes('SELECT state, attempt_count, lease_expires_at, authority_expires_at')) {
          return {
            rowCount: 1,
            rows: [{
              state: 'verified',
              attempt_count: 1,
              lease_expires_at: null,
              authority_expires_at: new Date(now.getTime() + 600000),
            }],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    const repository = new HomepageDemoAdmissionRepository({
      pool: { connect: jest.fn(async () => client) },
      now: () => now,
    });
    await expect(repository.beginPurge(
      'f'.repeat(64),
      'a'.repeat(64),
      now.getTime() + 600000
    )).resolves.toEqual({ execute: false, verified: true, attemptCount: 1 });
    expect(client.query.mock.calls.filter(call => String(call[0]).includes('RETURNING request_count')))
      .toHaveLength(0);
  });

  test('live lease and exhausted capability both fail before quota claims', async () => {
    const now = new Date('2026-08-16T12:34:00.000Z');
    async function outcome(attemptCount, leaseExpiresAt) {
      const client = {
        query: jest.fn(async sql => {
          const text = String(sql);
          if (text.includes('INSERT INTO homepage_demo_purge_operations')) return { rowCount: 0, rows: [] };
          if (text.includes('SELECT state, attempt_count, lease_expires_at, authority_expires_at')) {
            return {
              rowCount: 1,
              rows: [{
                state: 'in_progress',
                attempt_count: attemptCount,
                lease_expires_at: leaseExpiresAt,
                authority_expires_at: new Date(now.getTime() + 600000),
              }],
            };
          }
          return { rowCount: 0, rows: [] };
        }),
        release: jest.fn(),
      };
      const repository = new HomepageDemoAdmissionRepository({
        pool: { connect: jest.fn(async () => client) },
        now: () => now,
      });
      return { repository, client };
    }
    const active = await outcome(1, new Date(now.getTime() + 60000));
    await expect(active.repository.beginPurge(
      'b'.repeat(64), 'c'.repeat(64), now.getTime() + 600000
    )).rejects.toMatchObject({ status: 409, code: 'homepage_purge_in_progress' });
    const exhausted = await outcome(PURGE_ATTEMPTS_PER_CAPABILITY, new Date(now.getTime() - 1));
    await expect(exhausted.repository.beginPurge(
      'b'.repeat(64), 'd'.repeat(64), now.getTime() + 600000
    )).rejects.toMatchObject({ status: 429, code: 'homepage_purge_retry_limit_reached' });
    for (const subject of [active, exhausted]) {
      expect(subject.client.query.mock.calls.filter(call => String(call[0]).includes('RETURNING request_count')))
        .toHaveLength(0);
      expect(subject.client.query).toHaveBeenCalledWith('ROLLBACK');
    }
  });

  test('housekeeping drains both expired operation and admission records in bounded batches', async () => {
    const repository = {
      expire: jest.fn()
        .mockResolvedValueOnce({ admissionWindows: 2, purgeOperations: 2 })
        .mockResolvedValueOnce({ admissionWindows: 0, purgeOperations: 1 }),
    };
    const worker = new HomepageDemoAdmissionHousekeepingWorker({
      repository,
      batchSize: 2,
      maxBatches: 3,
    });
    await expect(worker.drainOnce()).resolves.toEqual({ admissionWindows: 2, purgeOperations: 3 });
    expect(repository.expire).toHaveBeenCalledTimes(2);
  });
});
