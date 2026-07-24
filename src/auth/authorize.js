/**
 * Authorization & RBAC Middleware
 * 
 * Role-based access control for contractor organizations and NorthStar admins.
 * 
 * Contractor Roles: Owner > Admin > Member > Viewer
 * Admin Roles: super_admin > support_admin > billing_admin
 * 
 * See V3-02_Authorization_Roles.md for full permission matrix.
 */

const { ApiError } = require('../middleware/errorHandler');

/**
 * Permission map for contractor roles.
 * Each entry: resource: { action: [roles that can perform it] }
 */
const contractorPermissions = {
  dashboard: { view: ['owner', 'admin', 'member', 'viewer'] },
  leads: {
    view: ['owner', 'admin', 'member', 'viewer'],
    create: ['owner', 'admin', 'member'],
    edit: ['owner', 'admin', 'member'],
    delete: ['owner', 'admin']
  },
  calls: {
    view: ['owner', 'admin', 'member', 'viewer'],
    flag: ['owner', 'admin', 'member']
  },
  calendar: {
    view: ['owner', 'admin', 'member', 'viewer'],
    schedule: ['owner', 'admin', 'member']
  },
  settings: {
    view: ['owner', 'admin', 'member', 'viewer'],
    edit: ['owner', 'admin']
  },
  integrations: {
    manage: ['owner', 'admin']
  },
  team: {
    manage: ['owner', 'admin']
  },
  billing: {
    view: ['owner'],
    manage: ['owner']
  },
  organization: {
    delete: ['owner']
  }
};

/**
 * Permission map for NorthStar admin roles.
 */
const adminPermissions = {
  contractorData: { view: ['super_admin', 'support_admin'] },
  billing: { view: ['super_admin', 'billing_admin'], manage: ['super_admin', 'billing_admin'] },
  system: { view: ['super_admin', 'support_admin'], manage: ['super_admin'] },
  impersonate: ['super_admin'],
  suspend: ['super_admin'],
  delete: ['super_admin']
};

/**
 * Check if a contractor role has permission for a resource+action.
 */
function hasContractorPermission(role, resource, action) {
  const resourcePerms = contractorPermissions[resource];
  if (!resourcePerms) return false;
  const actionPerms = resourcePerms[action];
  if (!actionPerms) return false;
  return actionPerms.includes(role);
}

/**
 * Check if an admin role has permission for a resource+action.
 */
function hasAdminPermission(role, resource, action) {
  const resourcePerms = adminPermissions[resource];
  if (!resourcePerms) return false;
  if (Array.isArray(resourcePerms)) return resourcePerms.includes(role);
  const actionPerms = resourcePerms[action];
  if (!actionPerms) return false;
  return actionPerms.includes(role);
}

/**
 * Middleware factory: require a specific permission for a resource+action.
 * 
 * Usage: app.get('/api/leads', requirePermission('leads', 'view'), handler)
 */
function requirePermission(resource, action) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required.' } });
    }

    // Contractor JWTs identify the token class as "contractor"; until a
    // persisted organization role is attached, retain the established member
    // capabilities instead of denying every permissioned v1 route.
    const role = user.role === 'contractor' ? 'member' : (user.role || 'member');

    if (!hasContractorPermission(role, resource, action)) {
      return res.status(403).json({
        error: {
          code: 'forbidden',
          message: `You do not have permission to ${action} ${resource}. Required role: ${getRequiredRole(resource, action)}`
        }
      });
    }

    next();
  };
}

/**
 * Middleware: require contractor to be the Owner (for billing, delete-org, etc.)
 */
function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({
      error: { code: 'forbidden', message: 'Only the organization owner can perform this action.' }
    });
  }
  next();
}

/**
 * Middleware: require admin with a specific permission.
 */
function requireAdminPermission(resource, action) {
  return (req, res, next) => {
    const admin = req.admin;
    if (!admin) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Admin authentication required.' } });
    }

    if (!hasAdminPermission(admin.role || 'support_admin', resource, action)) {
      return res.status(403).json({
        error: { code: 'forbidden', message: 'You do not have permission for this admin action.' }
      });
    }

    next();
  };
}

/**
 * Get the lowest role required for a permission.
 */
function getRequiredRole(resource, action) {
  const resourcePerms = contractorPermissions[resource];
  if (!resourcePerms) return 'owner';
  const actionPerms = resourcePerms[action];
  if (!actionPerms) return 'owner';
  // Return the highest-privilege (first) role in the allowed list
  return actionPerms[0];
}

module.exports = {
  requirePermission,
  requireOwner,
  requireAdminPermission,
  hasContractorPermission,
  hasAdminPermission,
  contractorPermissions,
  adminPermissions
};
