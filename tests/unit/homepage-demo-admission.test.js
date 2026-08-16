'use strict';

const {
  GLOBAL_CALLS_PER_MINUTE,
  HomepageDemoAdmissionRepository,
  PROJECTION_CALLS_GLOBAL_PER_MINUTE,
  PROJECTION_CALLS_PER_SOURCE_MINUTE,
  PURGE_CALLS_GLOBAL_PER_MINUTE,
  PURGE_CALLS_PER_SOURCE_MINUTE,
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

  test('verified deletion uses separate durable source and global minute ceilings', async () => {
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
    await expect(repository.admitPurge('d'.repeat(64))).resolves.toBe(true);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual(expect.arrayContaining([
      'minute', 'purge_source_minute', 'd'.repeat(64), PURGE_CALLS_PER_SOURCE_MINUTE,
    ]));
    expect(claims[1]).toEqual(expect.arrayContaining([
      'minute', 'purge_global_minute', PURGE_CALLS_GLOBAL_PER_MINUTE,
    ]));
  });
});
