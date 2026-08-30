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
    Object.freeze({ id: 'calendar', label: 'Calendar', resource: 'calendar', paidPath: '/dashboard/calendar', demoPath: '/demo/calendar' }),
    Object.freeze({ id: 'team', label: 'Team', resource: 'team', paidPath: '/dashboard/team', demoPath: '/demo/team' }),
    Object.freeze({ id: 'business-profile', label: 'Business Profile', resource: 'settings', paidPath: '/dashboard/business-profile', demoPath: '/demo/business-profile' }),
    Object.freeze({ id: 'settings', label: 'Settings', resource: 'settings', paidPath: '/dashboard/settings', demoPath: '/demo/settings' }),
    Object.freeze({ id: 'integrations', label: 'Integrations', resource: 'integrations', paidPath: '/dashboard/integrations', demoPath: '/demo/integrations' }),
  ]);
  var TODAY_ROUTE = Object.freeze({ id: 'today', label: 'Today', resource: 'dashboard', paidPath: '/dashboard/today', demoPath: null });
  // Today is signed-in workforce authority only. Keeping it outside ROUTES
  // preserves the accepted account-free demo contract and prevents a demo
  // route from being mistaken for employee scope.
  var PAID_ROUTES = Object.freeze([ROUTES[0], TODAY_ROUTE].concat(ROUTES.slice(1)));

  function routesForMode(mode) {
    return mode === 'demo' ? ROUTES : PAID_ROUTES;
  }

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
    for (var index = 0; index < PAID_ROUTES.length; index += 1) {
      if (PAID_ROUTES[index].paidPath === path || PAID_ROUTES[index].demoPath === path) return PAID_ROUTES[index];
    }
    return null;
  }

  function destinationPath(id, mode) {
    for (var index = 0; index < PAID_ROUTES.length; index += 1) {
      if (PAID_ROUTES[index].id === id) return mode === 'demo' ? PAID_ROUTES[index].demoPath : PAID_ROUTES[index].paidPath;
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
    var expected = routesForMode(expectedMode).map(function (route) { return route.id; });
    var actual = value.navigation.map(function (route) { return route && route.id; });
    if (expected.length !== actual.length || expected.some(function (id, index) { return actual[index] !== id; })) {
      throw new Error('The Command Center navigation contract is unavailable.');
    }
    if (expectedMode === 'paid') {
      var operator = value.schedulingOperator;
      var discovery = operator && operator.discovery;
      var overview = value.schedulingOverview;
      var categories = ['unassigned', 'due', 'overdue', 'atRisk', 'conflicting'];
      if (!operator || operator.canRead !== true || typeof operator.canMutate !== 'boolean' || !Array.isArray(operator.targets) ||
          typeof operator.digest !== 'string' || !/^[0-9a-f]{64}$/.test(operator.digest) ||
          !discovery || discovery.version !== 'm22-part5-target-directory-v1' ||
          discovery.endpoint !== '/api/v1/canonical/operator-targets' ||
          !Number.isSafeInteger(discovery.pageSize) || discovery.pageSize < 1 || discovery.pageSize > 100 ||
          !Number.isSafeInteger(discovery.shown) || !Number.isSafeInteger(discovery.total) ||
          discovery.shown < 0 || discovery.total < discovery.shown ||
          typeof discovery.truncated !== 'boolean' || discovery.truncated !== operator.truncated ||
          !overview || overview.version !== 'm22-part5-overview-v1' ||
          typeof overview.timeZone !== 'string' || !overview.definitions || !overview.categories ||
          !overview.counts || !Array.isArray(overview.records) || !overview.page ||
          !Number.isSafeInteger(overview.total) || overview.total < overview.records.length ||
          !Number.isSafeInteger(overview.shown) || overview.shown !== overview.records.length ||
          !Number.isSafeInteger(overview.page.size) || overview.page.size < 1 || overview.page.size > 100 ||
          overview.page.shown !== overview.shown || overview.page.total !== overview.total ||
          typeof overview.digest !== 'string' || !/^[0-9a-f]{64}$/.test(overview.digest) ||
          categories.some(function (name) {
            return typeof overview.definitions[name] !== 'string' || !Array.isArray(overview.categories[name]) ||
              !Number.isSafeInteger(overview.counts[name]) || overview.counts[name] !== overview.categories[name].length;
          }) || overview.records.some(function (record) {
            return !record || typeof record.appointmentId !== 'string' || !record.authority ||
              !Number.isSafeInteger(record.authority.revision) ||
              typeof record.authority.digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.authority.digest) ||
              !Array.isArray(record.allowedActions) || !record.flags || !record.conflict;
          })) {
        throw new Error('The scheduling overview is unavailable.');
      }
    }
    return value;
  }

  return Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    WORKSPACE_CONTRACT: WORKSPACE_CONTRACT,
    ROUTES: ROUTES,
    PAID_ROUTES: PAID_ROUTES,
    TODAY_ROUTE: TODAY_ROUTE,
    destinationPath: destinationPath,
    modeForPath: modeForPath,
    normalizePath: normalizePath,
    routeForPath: routeForPath,
    routesForMode: routesForMode,
    validateWorkspace: validateWorkspace,
  });
});
