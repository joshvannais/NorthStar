/**
 * Authorization & Permission Middleware (V3-02)
 * RBAC: Owner, Admin, Member, Viewer
 * Data isolation enforced via organization_id
 */

const commandCenterContract = require('../../public/js/command-center-contract');

const CANONICAL_ACCESS_ROLES = Object.freeze(['owner', 'admin', 'member', 'viewer']);
const canonicalAccessRoleSet = new Set(CANONICAL_ACCESS_ROLES);

function isCanonicalAccessRole(role) {
  return typeof role === 'string' && canonicalAccessRoleSet.has(role);
}

// Permission matrix: role -> [resource:action]
const PERMISSIONS = {
  owner: {
    'dashboard': ['read'],
    'leads': ['read', 'create', 'update', 'delete'],
    'calls': ['read', 'create', 'update'],
    'calendar': ['read', 'create', 'update', 'delete'],
    'settings': ['read', 'update'],
    'ai': ['read', 'update'],
    'integrations': ['read', 'create', 'update', 'delete'],
    'assets': ['read', 'create', 'update'],
    'operations': ['read', 'update'],
    'team': ['read', 'create', 'update', 'delete'],
    'billing': ['read', 'update'],
    'organization': ['read', 'update', 'delete'],
  },
  admin: {
    'dashboard': ['read'],
    'leads': ['read', 'create', 'update', 'delete'],
    'calls': ['read', 'create', 'update'],
    'calendar': ['read', 'create', 'update', 'delete'],
    'settings': ['read', 'update'],
    'ai': ['read', 'update'],
    'integrations': ['read', 'create', 'update', 'delete'],
    'assets': ['read', 'create', 'update'],
    'operations': ['read', 'update'],
    'team': ['read', 'create', 'update', 'delete'],
    'billing': ['read'],
    'organization': ['read'],
  },
  member: {
    'dashboard': ['read'],
    'leads': ['read', 'create', 'update'],
    'calls': ['read', 'create'],
    'calendar': ['read', 'create', 'update'],
    'settings': ['read'],
    'ai': ['read'],
    'integrations': ['read'],
    'assets': ['read'],
    'operations': ['read', 'update'],
    'team': ['read'],
    'billing': [],
    'organization': [],
  },
  viewer: {
    'dashboard': ['read'],
    'leads': ['read'],
    'calls': ['read'],
    'calendar': ['read'],
    'settings': ['read'],
    'ai': ['read'],
    'integrations': ['read'],
    'assets': ['read'],
    'operations': ['read'],
    'team': ['read'],
    'billing': [],
    'organization': [],
  },
};

// The server permission matrix is the visibility authority. The browser keeps
// labels and icons only; it never derives destination visibility from a role.
const NAVIGATION_DESTINATIONS = Object.freeze(commandCenterContract.PAID_ROUTES.map(destination => Object.freeze({
  id: destination.id,
  href: destination.paidPath,
  resource: destination.resource,
})));

/**
 * Check if a role has permission for a resource+action.
 */
function hasPermission(role, resource, action) {
  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return false;
  const resourcePerms = rolePerms[resource];
  if (!resourcePerms) return false;
  return resourcePerms.includes(action);
}

function navigationForRole(role) {
  return NAVIGATION_DESTINATIONS
    .filter(destination => hasPermission(role, destination.resource, 'read'))
    .map(destination => ({ id: destination.id, href: destination.href }));
}

/**
 * Middleware: require a specific permission.
 * Usage: requirePermission('leads', 'read')
 */
function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', requestId: req.requestId || req.correlationId || 'unavailable' });
    }
    if (!req.tenantContext || !req.orgId || !req.userRole) {
      return res.status(403).json({ error: 'Active organization membership required', requestId: req.requestId || req.correlationId || 'unavailable' });
    }
    if (!hasPermission(req.userRole, resource, action)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: { resource, action },
        role: req.userRole,
        requestId: req.requestId || req.correlationId || 'unavailable',
      });
    }
    return next();
  };
}

/**
 * Middleware: require organization membership for data isolation.
 * Attaches orgId from the user's JWT or DB lookup.
 */
async function requireOrgMembership(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', requestId: req.requestId || req.correlationId || 'unavailable' });
  }
  if (!req.tenantContext || !req.orgId || !req.userRole) {
    return res.status(403).json({ error: 'Active organization membership required', requestId: req.requestId || req.correlationId || 'unavailable' });
  }
  return next();
}

module.exports = {
  CANONICAL_ACCESS_ROLES,
  hasPermission,
  isCanonicalAccessRole,
  navigationForRole,
  requirePermission,
  requireOrgMembership,
  PERMISSIONS,
  NAVIGATION_DESTINATIONS,
};
