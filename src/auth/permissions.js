/**
 * Authorization & Permission Middleware (V3-02)
 * RBAC: Owner, Admin, Member, Viewer
 * Data isolation enforced via organization_id
 */

const db = require('../db');

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
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!req.tenantContext || !req.orgId || !req.userRole) {
      return res.status(403).json({ error: 'Active organization membership required' });
    }
    if (!hasPermission(req.userRole, resource, action)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Middleware: require organization membership for data isolation.
 * Attaches orgId from the user's JWT or DB lookup.
 */
async function requireOrgMembership(req, res, next) {
  try {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.tenantContext && req.orgId && req.userRole) {
      return next();
    }

    if (!db.isAvailable()) {
      return res.status(503).json({
        error: {
          code: 'authorization_unavailable',
          message: 'Organization authorization is temporarily unavailable.',
        },
      });
    }

    const result = await db.query(
      'SELECT id, organization_id, role, status FROM users WHERE id = $1',
      [userId]
    );
    if (!result.rows || result.rows.length !== 1) {
      return res.status(403).json({ error: 'Active organization membership required' });
    }

    const membership = result.rows[0];
    const allowedRoles = new Set(['owner', 'admin', 'member', 'viewer']);
    if (!membership.organization_id ||
        membership.status !== 'active' ||
        !allowedRoles.has(membership.role)) {
      return res.status(403).json({ error: 'Active organization membership required' });
    }

    req.orgId = membership.organization_id;
    req.userRole = membership.role;
    req.tenantContext = Object.freeze({
      userId: membership.id,
      organizationId: membership.organization_id,
      role: membership.role,
    });
    return next();
  } catch (err) {
    console.error('[Auth] Organization membership lookup failed:', {
      userId: req.user && (req.user.sub || req.user.id),
      message: err.message,
      stack: err.stack,
    });
    return res.status(503).json({
      error: {
        code: 'authorization_unavailable',
        message: 'Organization authorization is temporarily unavailable.',
      },
    });
  }
}

module.exports = {
  hasPermission,
  requirePermission,
  requireOrgMembership,
  PERMISSIONS,
};
