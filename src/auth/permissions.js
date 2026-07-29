/**
 * Authorization & Permission Middleware (V3-02)
 * RBAC: Owner, Admin, Member, Viewer
 * Data isolation enforced via organization_id
 */

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
    'team': ['read'],
    'billing': [],
    'organization': [],
  },
};

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
  hasPermission,
  requirePermission,
  requireOrgMembership,
  PERMISSIONS,
};
