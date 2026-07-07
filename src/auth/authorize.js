/**
 * Authorization & RBAC Middleware
 * V3-02: Role-based access control for contractor (Owner/Admin/Member/Viewer) and admin roles.
 */

const contractorPermissions = {
  dashboard: { view: ['owner', 'admin', 'member', 'viewer'] },
  leads: { view: ['owner', 'admin', 'member', 'viewer'], create: ['owner', 'admin', 'member'], edit: ['owner', 'admin', 'member'], delete: ['owner', 'admin'] },
  calls: { view: ['owner', 'admin', 'member', 'viewer'], flag: ['owner', 'admin', 'member'] },
  calendar: { view: ['owner', 'admin', 'member', 'viewer'], schedule: ['owner', 'admin', 'member'] },
  settings: { view: ['owner', 'admin', 'member', 'viewer'], edit: ['owner', 'admin'] },
  integrations: { manage: ['owner', 'admin'] },
  team: { manage: ['owner', 'admin'] },
  billing: { view: ['owner'], manage: ['owner'] },
  organization: { delete: ['owner'] }
};

const adminPermissions = {
  contractorData: { view: ['super_admin', 'support_admin'] },
  billing: { view: ['super_admin', 'billing_admin'], manage: ['super_admin', 'billing_admin'] },
  system: { view: ['super_admin', 'support_admin'], manage: ['super_admin'] },
  impersonate: { manage: ['super_admin'] },
  suspend: { manage: ['super_admin'] }
};

function hasContractorPermission(role, resource, action) {
  const rp = contractorPermissions[resource];
  if (!rp) return false;
  const ap = rp[action];
  return ap ? ap.includes(role) : false;
}

function hasAdminPermission(role, resource, action) {
  const rp = adminPermissions[resource];
  if (!rp) return false;
  if (Array.isArray(rp)) return rp.includes(role);
  const ap = rp[action];
  return ap ? ap.includes(role) : false;
}

function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required.' } });
    if (!hasContractorPermission(req.user.role || 'member', resource, action)) {
      return res.status(403).json({ error: { code: 'forbidden', message: `You do not have permission to ${action} ${resource}.` } });
    }
    next();
  };
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ error: { code: 'forbidden', message: 'Only the organization owner can perform this action.' } });
  }
  next();
}

function requireAdminPermission(resource, action) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: { code: 'unauthorized', message: 'Admin authentication required.' } });
    if (!hasAdminPermission(req.admin.role || 'support_admin', resource, action)) {
      return res.status(403).json({ error: { code: 'forbidden', message: 'You do not have permission for this admin action.' } });
    }
    next();
  };
}

module.exports = { requirePermission, requireOwner, requireAdminPermission, hasContractorPermission, hasAdminPermission };