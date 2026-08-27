'use strict';

const {
  MAXIMUM_GRAPH_CURSOR_CHARACTERS,
  encodeGraphCursor,
  validateGraphCursor,
} = require('../../src/scheduling/graphCursor');
const { buildSchedulingOverviewPage } = require('../../src/scheduling/overviewRepository');

const CREATED_AT = '2026-02-28T00:00:00.123456Z';
const OPERATION_ID = 'abcdef00-0000-4000-8000-abcdef000001';

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('Mission 22 Part 5 strict canonical graph cursor boundary', () => {
  test('round-trips only the exact canonical six-microsecond payload', () => {
    const item = { ids: { operation: OPERATION_ID } };
    Object.defineProperty(item, '_paginationCreatedAt', { value: CREATED_AT });
    const encoded = encodeGraphCursor(item);
    expect(validateGraphCursor(encoded)).toEqual({
      raw: encoded,
      createdAt: CREATED_AT,
      operationId: OPERATION_ID,
    });
  });

  test.each([
    ['empty', ''],
    ['trailing junk', encode({ createdAt: CREATED_AT, operationId: OPERATION_ID }) + '!!!'],
    ['padding', encode({ createdAt: CREATED_AT, operationId: OPERATION_ID }) + '='],
    ['oversize', 'A'.repeat(MAXIMUM_GRAPH_CURSOR_CHARACTERS + 1)],
    ['invalid JSON', Buffer.from('{', 'utf8').toString('base64url')],
    ['array schema', encode([CREATED_AT, OPERATION_ID])],
    ['extra key', encode({ createdAt: CREATED_AT, operationId: OPERATION_ID, tenantId: OPERATION_ID })],
    ['reordered keys', encode({ operationId: OPERATION_ID, createdAt: CREATED_AT })],
    ['timestamp type', encode({ createdAt: 1, operationId: OPERATION_ID })],
    ['operation type', encode({ createdAt: CREATED_AT, operationId: 1 })],
    ['uppercase operation', encode({ createdAt: CREATED_AT, operationId: OPERATION_ID.toUpperCase() })],
    ['invalid operation', encode({ createdAt: CREATED_AT, operationId: 'not-a-uuid' })],
    ['milliseconds only', encode({ createdAt: '2026-02-28T00:00:00.123Z', operationId: OPERATION_ID })],
    ['explicit offset', encode({ createdAt: '2026-02-28T00:00:00.123456+00:00', operationId: OPERATION_ID })],
    ['impossible day', encode({ createdAt: '2026-02-31T00:00:00.000000Z', operationId: OPERATION_ID })],
    ['non-leap day', encode({ createdAt: '2025-02-29T00:00:00.000000Z', operationId: OPERATION_ID })],
    ['invalid month', encode({ createdAt: '2026-13-01T00:00:00.000000Z', operationId: OPERATION_ID })],
    ['invalid hour', encode({ createdAt: '2026-02-28T24:00:00.000000Z', operationId: OPERATION_ID })],
    ['leap second', encode({ createdAt: '2026-02-28T23:59:60.000000Z', operationId: OPERATION_ID })],
  ])('rejects %s with one bounded error', (_label, value) => {
    expect(() => validateGraphCursor(value)).toThrow(expect.objectContaining({
      code: 'INVALID_CURSOR', statusCode: 400,
    }));
  });

  test('rejects an invalid requested page before opening a PostgreSQL snapshot', async () => {
    let connects = 0;
    const pool = {
      async connect() {
        connects += 1;
        throw new Error('must not connect');
      },
    };
    await expect(buildSchedulingOverviewPage(pool, {
      cursor: encode({ createdAt: '2026-02-31T00:00:00.000000Z', operationId: OPERATION_ID }),
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', statusCode: 400 });
    expect(connects).toBe(0);
  });
});
