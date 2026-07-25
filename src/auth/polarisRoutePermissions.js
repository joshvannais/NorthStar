'use strict';

const { requirePermission } = require('./authorize');

const READ_ROLES = Object.freeze(['viewer', 'member', 'admin', 'owner']);
const MUTATE_ROLES = Object.freeze(['member', 'admin', 'owner']);
const ADMIN_ROLES = Object.freeze(['admin', 'owner']);

const routes = Object.freeze([
  // Application-interface router, mounted at /api/v1/polaris.
  entry('polaris', 'POST', '/estimate', 'mutate', 'New record is stamped from persisted tenant context.'),
  entry('polaris', 'POST', '/complete', 'mutate', 'New record is stamped from persisted tenant context.'),
  entry('polaris', 'POST', '/recommendations/generate', 'mutate', 'Generated records are stamped from persisted tenant context.'),
  entry('polaris', 'PUT', '/recommendations/:id/resolve', 'mutate', 'Recommendation must be visible to the persisted tenant before mutation.'),
  entry('polaris', 'POST', '/query', 'mutate', 'Returned stored records are filtered to persisted tenant context.'),
  entry('polaris', 'POST', '/pipeline', 'mutate', 'Returned stored records are filtered to persisted tenant context.'),
  entry('polaris', 'POST', '/config', 'configure', 'Configuration is organization-admin only; no request-selected organization.'),
  entry('polaris', 'POST', '/chat', 'mutate', 'Returned stored records are filtered to persisted tenant context.'),

  // M13 engine router, mounted at /api/v1.
  entry('polaris-engines', 'POST', '/customers', 'mutate', 'New record is stamped from persisted tenant context.'),
  entry('polaris-engines', 'PUT', '/customers/:id', 'mutate', 'Customer must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'DELETE', '/customers/:id', 'delete', 'Customer must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/customers/:id/restore', 'mutate', 'Customer must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/communications', 'mutate', 'Parent customer must be visible; scope is inherited.'),
  entry('polaris-engines', 'PUT', '/communications/:id/status', 'mutate', 'Communication must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/opportunities', 'mutate', 'Parent customer must be visible; scope is inherited.'),
  entry('polaris-engines', 'PUT', '/opportunities/:id', 'mutate', 'Opportunity must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'PUT', '/opportunities/:id/stage', 'mutate', 'Opportunity must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'DELETE', '/opportunities/:id', 'delete', 'Opportunity must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/workflows', 'mutate', 'Referenced customer or opportunity must be visible; scope is inherited.'),
  entry('polaris-engines', 'PUT', '/workflows/:id', 'mutate', 'Workflow must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/workflows/:id/complete', 'mutate', 'Workflow must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/financial/estimates', 'mutate', 'Referenced customer or opportunity must be visible; scope is inherited.'),
  entry('polaris-engines', 'POST', '/financial/invoices', 'mutate', 'Referenced customer or estimate must be visible; scope is inherited.'),
  entry('polaris-engines', 'POST', '/financial/invoices/:id/send', 'mutate', 'Invoice must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/financial/payments', 'mutate', 'Parent invoice must be visible; scope is inherited.'),
  entry('polaris-engines', 'POST', '/assets', 'mutate', 'Referenced parent must be visible; scope is inherited.'),
  entry('polaris-engines', 'PUT', '/assets/:id', 'mutate', 'Asset must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/assets/:id/maintenance', 'mutate', 'Asset must be visible; scope is inherited.'),
  entry('polaris-engines', 'POST', '/crew/employees', 'mutate', 'New record is stamped from persisted tenant context.'),
  entry('polaris-engines', 'PUT', '/crew/employees/:id', 'mutate', 'Employee must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/crew/crews', 'mutate', 'Referenced records must be visible; scope is inherited.'),
  entry('polaris-engines', 'POST', '/crew/crews/:id/assign', 'mutate', 'Crew must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/jobs', 'mutate', 'Referenced customer or opportunity must be visible; scope is inherited.'),
  entry('polaris-engines', 'PUT', '/jobs/:id', 'mutate', 'Job must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/jobs/:id/schedule', 'mutate', 'Job must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/jobs/:id/start', 'mutate', 'Job must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/jobs/:id/complete', 'mutate', 'Job must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/jobs/:id/production', 'mutate', 'Job must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/jobs/:id/issue', 'mutate', 'Job must be visible to the persisted tenant before mutation.'),
  entry('polaris-engines', 'POST', '/polaris/intelligence', 'mutate', 'Referenced customer must be visible to the persisted tenant.'),
  entry('polaris-engines', 'POST', '/polaris/executive-summary', 'mutate', 'Referenced customer must be visible to the persisted tenant.')
]);

function entry(router, method, path, action, ownership) {
  return Object.freeze({
    router,
    method,
    path,
    membership: 'persisted_active_unambiguous',
    permission: `polaris.${action}`,
    roles: action === 'mutate' ? MUTATE_ROLES : ADMIN_ROLES,
    readRoles: READ_ROLES,
    ownership
  });
}

function permissionFor(router, method, path) {
  const normalizedMethod = String(method || '').toUpperCase();
  const match = routes.find((route) => (
    route.router === router &&
    route.method === normalizedMethod &&
    route.path === path
  ));
  if (!match) {
    throw new Error(`Missing Polaris mutation permission inventory: ${router} ${normalizedMethod} ${path}`);
  }
  return requirePermission('polaris', match.permission.split('.')[1]);
}

module.exports = {
  routes,
  permissionFor
};
