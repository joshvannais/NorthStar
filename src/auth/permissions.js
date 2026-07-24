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
  return async (req, res, next) => {
    try {
      const userId = req.user?.sub;
      const orgId = req.user?.orgId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Resolve role from DB
      let role = 'viewer';
      if (db.isAvailable()) {
        const result = await db.query(
          'SELECT role FROM users WHERE id = $1',
          [userId]
        );
        if (result.rows.length > 0) {
          role = result.rows[0].role;
        }
      }

      if (!hasPermission(role, resource, action)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: { resource, action },
          role,
        });
      }

      // Attach orgId for data isolation
      req.orgId = orgId;
      req.userRole = role;
      next();
    } catch (err) {
      console.error('[Auth] Permission check error:', err.message);
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

/**
 * Middleware: require organization membership for data isolation.
 * Attaches orgId from the user's JWT or DB lookup.
 */
async function requireOrgMembership(req, res, next) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.orgId) {
      return next();
    }

    // File-mode development has no organization table. User ownership still
    // protects simulated records; database-backed routes must resolve a real
    // organization below.
    if (!db.isAvailable()) {
      req.orgId = req.user?.orgId || null;
      return next();
    }

    if (db.isAvailable()) {
      const result = await db.query(
        'SELECT organization_id FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length > 0) {
        req.orgId = result.rows[0].organization_id;
        return next();
      }
    }

    return res.status(403).json({ error: 'No organization membership found' });
  } catch (err) {
    console.error('[Auth] Org membership error:', err.message);
    res.status(500).json({ error: 'Authorization check failed' });
  }
}

module.exports = {
  hasPermission,
  requirePermission,
  requireOrgMembership,
  PERMISSIONS,
};