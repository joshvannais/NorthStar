'use strict';

jest.mock('../../src/db', () => ({
  getPool: jest.fn(),
  isAvailable: jest.fn(),
}));

const db = require('../../src/db');
const {
  SupportCasePersistenceError,
  SupportCaseRepository,
} = require('../../src/support/repository');

describe('Pre-Mission-23 P2 support repository startup boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a worker constructed before database initialization resolves the runtime pool lazily', () => {
    const runtimePool = { connect: jest.fn() };
    db.getPool.mockReturnValueOnce(null).mockReturnValue(runtimePool);
    db.isAvailable.mockReturnValue(true);
    const repository = new SupportCaseRepository();

    expect(repository.pool).toBeNull();
    expect(repository.requirePool()).toBe(runtimePool);
    expect(db.getPool).toHaveBeenCalledTimes(2);
  });

  test('connection failures become truthful persistence-unavailable errors', async () => {
    const runtimePool = { connect: jest.fn().mockRejectedValue(new Error('intercepted connection failure')) };
    db.getPool.mockReturnValue(runtimePool);
    db.isAvailable.mockReturnValue(true);
    const repository = new SupportCaseRepository();

    await expect(repository.transaction(async () => true)).rejects.toBeInstanceOf(SupportCasePersistenceError);
  });
});
