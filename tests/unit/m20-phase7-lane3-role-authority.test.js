'use strict';

const {
  CANONICAL_ACCESS_ROLES,
  hasPermission,
  isCanonicalAccessRole,
  navigationForRole,
} = require('../../src/auth/permissions');
const {
  AccountService,
  hashPassword,
} = require('../../src/accounts/service');

describe('Mission 20 Phase 7 Lane 3 canonical access-role authority', () => {
  test('the authenticated authority is exactly owner, admin, member, or viewer', () => {
    expect(Array.from(CANONICAL_ACCESS_ROLES)).toEqual(['owner', 'admin', 'member', 'viewer']);
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      expect(isCanonicalAccessRole(role)).toBe(true);
      expect(navigationForRole(role).length).toBeGreaterThan(0);
    }
    for (const role of ['dispatcher', 'tech', 'technician', 'OWNER', '', null, undefined, {}, 1]) {
      expect(isCanonicalAccessRole(role)).toBe(false);
      expect(hasPermission(role, 'dashboard', 'read')).toBe(false);
      expect(navigationForRole(role)).toEqual([]);
    }
  });

  test.each(['dispatcher', 'tech', 'technician', 'unknown'])('login rejects noncanonical role %s before session creation', async role => {
    const password = 'Lane3-role-authority-password-1!';
    const authority = {
      user_id: '81000000-0000-4000-8000-000000000001',
      organization_id: '82000000-0000-4000-8000-000000000001',
      membership_id: '83000000-0000-4000-8000-000000000001',
      user_status: 'active',
      membership_status: 'active',
      role,
      password_hash: await hashPassword(password),
    };
    const repository = {
      consumeRateLimit: jest.fn(async () => ({ allowed: true })),
      findLoginAuthority: jest.fn(async () => authority),
      createLoginSession: jest.fn(async () => authority),
      clearRateLimit: jest.fn(async () => undefined),
    };
    const service = new AccountService(repository, { sleep: async () => {} });

    await expect(service.login({ email: 'legacy@example.test', password }, '127.0.0.1'))
      .rejects.toMatchObject({ status: 403, code: 'account_inactive' });
    expect(repository.createLoginSession).not.toHaveBeenCalled();
  }, 30000);
});
