(function (root, factory) {
  'use strict';
  var contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  if (root) root.NorthStarCommandCenterContract = contract;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var CONTRACT_VERSION = 1;
  var WORKSPACE_CONTRACT = 'northstar_command_center_workspace_v1';
  var ROUTES = Object.freeze([
    Object.freeze({ id: 'command-center', label: 'Command Center', resource: 'dashboard', paidPath: '/dashboard', demoPath: '/demo' }),
    Object.freeze({ id: 'polaris', label: 'Polaris', resource: 'ai', paidPath: '/dashboard/polaris', demoPath: '/demo/polaris' }),
    Object.freeze({ id: 'leads', label: 'Leads', resource: 'leads', paidPath: '/dashboard/leads', demoPath: '/demo/leads' }),
    Object.freeze({ id: 'communications', label: 'Communications', resource: 'calls', paidPath: '/dashboard/communications', demoPath: '/demo/communications' }),
    Object.freeze({ id: 'my-number', label: 'My Number', resource: 'calls', paidPath: '/dashboard/my-number', demoPath: '/demo/my-number' }),
    Object.freeze({ id: 'calendar', label: 'Calendar', resource: 'calendar', paidPath: '/dashboard/calendar', demoPath: '/demo/calendar' }),
    Object.freeze({ id: 'team', label: 'Team', resource: 'team', paidPath: '/dashboard/team', demoPath: '/demo/team' }),
    Object.freeze({ id: 'ai-settings', label: 'AI Settings', resource: 'ai', paidPath: '/dashboard/ai-settings', demoPath: '/demo/ai-settings' }),
    Object.freeze({ id: 'business-profile', label: 'Business Profile', resource: 'settings', paidPath: '/dashboard/business-profile', demoPath: '/demo/business-profile' }),
    Object.freeze({ id: 'settings', label: 'Settings', resource: 'settings', paidPath: '/dashboard/settings', demoPath: '/demo/settings' }),
    Object.freeze({ id: 'integrations', label: 'Integrations', resource: 'integrations', paidPath: '/dashboard/integrations', demoPath: '/demo/integrations' }),
  ]);

  function normalizePath(value) {
    var path = String(value || '/').split('?')[0].split('#')[0];
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    return path;
  }

  function modeForPath(value) {
    var path = normalizePath(value);
    return path === '/demo-dashboard' || path === '/demo' || path.indexOf('/demo/') === 0
      ? 'demo'
      : 'paid';
  }

  function routeForPath(value) {
    var path = normalizePath(value);
    if (path === '/demo-dashboard') return ROUTES[0];
    for (var index = 0; index < ROUTES.length; index += 1) {
      if (ROUTES[index].paidPath === path || ROUTES[index].demoPath === path) return ROUTES[index];
    }
    return null;
  }

  function destinationPath(id, mode) {
    for (var index = 0; index < ROUTES.length; index += 1) {
      if (ROUTES[index].id === id) return mode === 'demo' ? ROUTES[index].demoPath : ROUTES[index].paidPath;
    }
    return null;
  }

  function validateWorkspace(value, expectedMode) {
    if (!value || typeof value !== 'object' || value.contract !== WORKSPACE_CONTRACT ||
        value.contractVersion !== CONTRACT_VERSION || value.mode !== expectedMode ||
        !value.tenant || typeof value.tenant.id !== 'string' ||
        !Array.isArray(value.navigation) || !Array.isArray(value.graphs) ||
        !value.configuration || !value.integrity ||
        !Number.isSafeInteger(value.integrity.revision) || value.integrity.revision < 1 ||
        typeof value.integrity.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.integrity.digest)) {
      throw new Error('The Command Center workspace contract is unavailable.');
    }
    var expected = ROUTES.map(function (route) { return route.id; });
    var actual = value.navigation.map(function (route) { return route && route.id; });
    if (expected.length !== actual.length || expected.some(function (id, index) { return actual[index] !== id; })) {
      throw new Error('The Command Center navigation contract is unavailable.');
    }
    return value;
  }

  return Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    WORKSPACE_CONTRACT: WORKSPACE_CONTRACT,
    ROUTES: ROUTES,
    destinationPath: destinationPath,
    modeForPath: modeForPath,
    normalizePath: normalizePath,
    routeForPath: routeForPath,
    validateWorkspace: validateWorkspace,
  });
});
