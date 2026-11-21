'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PERMISSIONS_PATH = path.join(ROOT, 'src', 'auth', 'permissions.js');
const ACCOUNT_SERVICE_PATH = path.join(ROOT, 'src', 'accounts', 'service.js');
const COMMAND_CENTER_CONTRACT_PATH = path.join(ROOT, 'public', 'js', 'command-center-contract.js');
const NAV_PATH = path.join(ROOT, 'public', 'js', 'nav-component.js');

const EXPECTED_NAVIGATION = Object.freeze([
  Object.freeze({ id: 'command-center', href: '/dashboard', resource: 'dashboard' }),
  Object.freeze({ id: 'today', href: '/dashboard/today', resource: 'dashboard' }),
  Object.freeze({ id: 'polaris', href: '/dashboard/polaris', resource: 'ai' }),
  Object.freeze({ id: 'leads', href: '/dashboard/leads', resource: 'leads' }),
  Object.freeze({ id: 'communications', href: '/dashboard/communications', resource: 'calls' }),
  Object.freeze({ id: 'calendar', href: '/dashboard/calendar', resource: 'calendar' }),
  Object.freeze({ id: 'operations', href: '/dashboard/operations', resource: 'operations' }),
  Object.freeze({ id: 'automation-center', href: '/dashboard/automation', resource: 'automation' }),
  Object.freeze({ id: 'learning-center', href: '/dashboard/learning-center', resource: 'learning' }),
  Object.freeze({ id: 'team', href: '/dashboard/team', resource: 'team' }),
  Object.freeze({ id: 'business-profile', href: '/dashboard/business-profile', resource: 'settings' }),
  Object.freeze({ id: 'settings', href: '/dashboard/settings', resource: 'settings' }),
  Object.freeze({ id: 'integrations', href: '/dashboard/integrations', resource: 'integrations' }),
]);

function expectedNavigationForRole(role) {
  const canUseOwnerControls = role === 'owner' || role === 'admin';
  return EXPECTED_NAVIGATION
    .filter(item => canUseOwnerControls || !['automation-center', 'learning-center'].includes(item.id))
    .map(item => ({ id: item.id, href: item.href }));
}

const EXCEPTIONS = Object.freeze([
  Object.freeze({ file: 'public/dashboard.html', active: 'command-center' }),
  Object.freeze({ file: 'public/dashboard/lead.html', active: 'leads' }),
  Object.freeze({ file: 'public/dashboard/executive-brief.html', active: 'command-center' }),
]);

function read(relative) {
  return fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
}

function accountAuthority(role) {
  return {
    user_id: '00000000-0000-4000-8000-000000000801',
    name: 'Navigation Contract',
    email: 'navigation@example.test',
    user_status: 'active',
    organization_id: '00000000-0000-4000-8000-000000000802',
    organization_name: 'Navigation Contract',
    membership_id: '00000000-0000-4000-8000-000000000803',
    membership_status: 'active',
    role,
    onboarding_status: 'complete',
  };
}

describe('Mission 19 universal navigation authority', () => {
  test('the server RBAC source projects one exact role-to-destination read contract', () => {
    jest.resetModules();
    const authorization = require(PERMISSIONS_PATH);
    expect(typeof authorization.navigationForRole).toBe('function');
    expect(authorization.NAVIGATION_DESTINATIONS).toEqual(EXPECTED_NAVIGATION);

    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const expected = expectedNavigationForRole(role);
      expect(authorization.navigationForRole(role)).toEqual(expected);
      for (const item of EXPECTED_NAVIGATION) {
        expect(authorization.hasPermission(role, item.resource, 'read')).toBe(
          expected.some(destination => destination.id === item.id)
        );
      }
    }

    expect(authorization.navigationForRole('owner')).toContainEqual({ id: 'automation-center', href: '/dashboard/automation' });
    expect(authorization.navigationForRole('admin')).toContainEqual({ id: 'automation-center', href: '/dashboard/automation' });
    expect(authorization.navigationForRole('member')).not.toContainEqual(expect.objectContaining({ id: 'automation-center' }));
    expect(authorization.navigationForRole('viewer')).not.toContainEqual(expect.objectContaining({ id: 'automation-center' }));

    expect(authorization.navigationForRole('unknown')).toEqual([]);
    expect(authorization.navigationForRole(null)).toEqual([]);
  });

  test('the mounted account response carries only the server-projected destinations', () => {
    jest.resetModules();
    const { accountView } = require(ACCOUNT_SERVICE_PATH);
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const account = accountView(accountAuthority(role));
      expect(account.membership.role).toBe(role);
      expect(account.navigation).toEqual(expectedNavigationForRole(role));
      expect(JSON.stringify(account.navigation)).not.toMatch(/resource|action|role|permission/i);
    }
  });

  test('the paid-only Automation destination never enters demo navigation', () => {
    jest.resetModules();
    const commandCenterContract = require(COMMAND_CENTER_CONTRACT_PATH);
    const demoRoutes = commandCenterContract.routesForMode('demo');

    expect(demoRoutes.map(route => route.id)).toEqual([
      'command-center',
      'polaris',
      'leads',
      'communications',
      'calendar',
      'operations',
      'learning-center',
      'team',
      'business-profile',
      'settings',
      'integrations',
    ]);
    expect(demoRoutes).not.toContainEqual(expect.objectContaining({ id: 'automation-center' }));
    expect(commandCenterContract.destinationPath('automation-center', 'demo')).toBeNull();
    expect(commandCenterContract.routeForPath('/demo/automation')).toBeNull();
  });

  test('the browser component consumes the server projection and fails closed on deep links', () => {
    const source = fs.readFileSync(NAV_PATH, 'utf8');
    expect(source).toMatch(/NorthStarAccountSession\.load\(\)/);
    expect(source).toMatch(/account\.navigation/);
    expect(source).toMatch(/data-nav-id/);
    expect(source).toMatch(/mode === 'demo' \? '\/demo' : '\/dashboard'/);
    expect(source).toMatch(/contractRoute\.demoPath/);
    expect(source).toMatch(/data-northstar-navigation/);
    expect(source).not.toMatch(/ROLE_PERMISSIONS|owner\s*:\s*\[|viewer\s*:\s*\[/);
    expect(source).toMatch(/<button[^>]*class="northstar-nav-action"[^>]*data-account-logout/);
    expect(source).not.toMatch(/href="\/login"[^>]*data-account-logout/);
  });

  test('all three mounted exceptions contain only a canonical placeholder and delegate once', () => {
    for (const exception of EXCEPTIONS) {
      const source = read(exception.file);
      expect(source).toContain('<script src="/js/nav-component.js"></script>');
      expect(source).toContain(`NavComponent.init("${exception.active}")`);
      expect(source).not.toMatch(/preservedSidebar|generatedSidebar|cloneNode\(true\)/);

      const sidebars = Array.from(source.matchAll(/<aside class="sidebar"[^>]*>([\s\S]*?)<\/aside>/g));
      expect(sidebars).toHaveLength(1);
      expect(sidebars[0][1]).not.toMatch(/<a\b|<nav\b|data-account-logout/);
    }

    const legacy = read('public/dashboard.html');
    expect(legacy).not.toMatch(/<div class="mobile-menu"|<nav class="mobile-menu-nav"/);
  });
});
