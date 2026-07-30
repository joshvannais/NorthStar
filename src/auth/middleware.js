/**
 * PostgreSQL-backed session, account-state, and role authorization boundaries.
 * Browser credentials are accepted only from secure cookies. A separately
 * gated Authorization header path remains for tested API compatibility.
 */

'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');
const credentials = require('./credentials');
const { AccountRepository } = require('../accounts/repository');

const trustedTenantRequests = new WeakSet();
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function sendAuthError(req, res, status, message, code) {
  return res.status(status).json({ error: message, code, requestId: requestId(req) });
}

function attachTenantContext(req, authority, session) {
  const userId = authority.user_id || authority.id;
  const organizationId = authority.organization_id;
  const role = authority.role;
  const context = Object.freeze({ userId, organizationId, role });
  const trustedUser = Object.freeze({
    id: userId,
    sub: userId,
    email: authority.email || '',
    name: authority.name || '',
    role,
    status: authority.user_status || authority.status,
    organizationId,
    orgId: organizationId,
    onboardingStatus: authority.onboarding_status || 'complete',
  });

  Object.defineProperties(req, {
    user: { value: trustedUser, enumerable: true, configurable: false, writable: false },
    tenantContext: { value: context, enumerable: true, configurable: false, writable: false },
    orgId: { value: organizationId, enumerable: true, configurable: false, writable: false },
    userRole: { value: role, enumerable: true, configurable: false, writable: false },
    authSession: { value: session ? Object.freeze(session) : null, enumerable: true, configurable: false, writable: false },
    accountAuthority: { value: Object.freeze({ ...authority }), enumerable: false, configurable: false, writable: false },
  });
  trustedTenantRequests.add(req);
}

function validateCookieCsrf(req, res, authority) {
  if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return true;
  const cookies = credentials.parseCookies(req.headers.cookie);
  const header = req.headers['x-csrf-token'];
  const cookie = cookies[credentials.CSRF_COOKIE];
  if (!header || !cookie || !credentials.safeEqual(header, cookie) ||
      !credentials.safeEqual(credentials.hashToken(header), authority.csrf_token_hash)) {
    sendAuthError(req, res, 403, 'CSRF validation failed', 'csrf_invalid');
    return false;
  }
  return true;
}

async function cookieSession(req, res, token) {
  let decoded;
  try {
    decoded = credentials.verifyAccess(token);
    if (decoded.typ !== 'access' || !decoded.sid) throw new Error('invalid browser access type');
  } catch (error) {
    const code = error && error.name === 'TokenExpiredError' ? 'access_expired' : 'invalid_token';
    return sendAuthError(req, res, 401, 'Invalid or expired session', code);
  }
  if (!db.isAvailable()) {
    return sendAuthError(req, res, 503, 'Account authorization is temporarily unavailable', 'authorization_unavailable');
  }
  try {
    const authority = await new AccountRepository().sessionAuthority(decoded.sid, decoded.sub);
    if (!authority || authority.session_status !== 'active') {
      return sendAuthError(req, res, 401, 'Session is no longer active', 'session_inactive');
    }
    if (new Date(authority.access_expires_at).getTime() <= Date.now()) {
      return sendAuthError(req, res, 401, 'Access credential expired', 'access_expired');
    }
    if (authority.membership_status !== 'active' ||
        !['pending_verification', 'active'].includes(authority.user_status)) {
      return sendAuthError(req, res, 403, 'Active organization membership required', 'organization_membership_required');
    }
    if (!validateCookieCsrf(req, res, authority)) return undefined;
    attachTenantContext(req, authority, {
      id: authority.session_id,
      transport: 'cookie',
      csrfTokenHash: authority.csrf_token_hash,
    });
    return true;
  } catch (_error) {
    console.warn('[Auth] Session lookup warning:', {
      requestId: requestId(req),
      event: 'authorization_persistence_unavailable',
    });
    return sendAuthError(req, res, 503, 'Account authorization is temporarily unavailable', 'authorization_unavailable');
  }
}

async function apiCompatibilitySession(req, res, token) {
  if (process.env.NODE_ENV !== 'test' && process.env.AUTH_BEARER_COMPAT_ENABLED !== 'true') {
    return sendAuthError(req, res, 401, 'Authentication required', 'unauthorized');
  }
  let decoded;
  try {
    decoded = jwt.verify(token, credentials.JWT_SECRET);
    if (!decoded.sub || !['api_compat', undefined].includes(decoded.typ) ||
        (decoded.typ === undefined && decoded.role !== 'contractor')) {
      return sendAuthError(req, res, 403, 'Invalid API credential', 'forbidden');
    }
  } catch (_error) {
    return sendAuthError(req, res, 401, 'Invalid or expired token', 'invalid_token');
  }
  if (!db.isAvailable()) {
    return sendAuthError(req, res, 503, 'Organization authorization is temporarily unavailable', 'authorization_unavailable');
  }
  try {
    const result = await db.query(
      `SELECT u.id, u.organization_id, u.role, u.status, u.email, u.name
         FROM users u
        WHERE u.id = $1`,
      [decoded.sub]
    );
    const membershipRows = result && Array.isArray(result.rows) ? result.rows : [];
    if (membershipRows.length !== 1) {
      return sendAuthError(req, res, 403, 'Active organization membership required', 'organization_membership_required');
    }
    const membership = membershipRows[0];
    if (!membership.id || !membership.organization_id || membership.status !== 'active' || !membership.role) {
      return sendAuthError(req, res, 403, 'Active organization membership required', 'organization_membership_required');
    }
    attachTenantContext(req, { ...membership, user_status: membership.status, onboarding_status: 'complete' }, {
      id: null,
      transport: 'authorization_header',
    });
    return true;
  } catch (_error) {
    console.warn('[Auth] Membership lookup warning:', {
      requestId: requestId(req),
      event: 'authorization_persistence_unavailable',
    });
    return sendAuthError(req, res, 503, 'Organization authorization is temporarily unavailable', 'authorization_unavailable');
  }
}

async function requireSession(req, res, next) {
  if (trustedTenantRequests.has(req)) return next();
  const cookies = credentials.parseCookies(req.headers.cookie);
  if (cookies[credentials.ACCESS_COOKIE]) {
    const accepted = await cookieSession(req, res, cookies[credentials.ACCESS_COOKIE]);
    if (accepted === true) return next();
    return undefined;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const accepted = await apiCompatibilitySession(req, res, authHeader.slice('Bearer '.length));
    if (accepted === true) return next();
    return undefined;
  }
  return sendAuthError(req, res, 401, 'Authentication required', 'unauthorized');
}

function afterSession(predicate, code, message) {
  return async function accountBoundary(req, res, next) {
    const proceed = () => {
      if (!predicate(req)) return sendAuthError(req, res, 403, message, code);
      return next();
    };
    if (trustedTenantRequests.has(req)) return proceed();
    return requireSession(req, res, proceed);
  };
}

const requireVerifiedAccount = afterSession(
  req => req.user.status === 'active' && ['business_profile_required', 'complete'].includes(req.user.onboardingStatus),
  'verification_required',
  'Verified account required'
);

const requireActiveAccount = afterSession(
  req => req.user.status === 'active' && req.user.onboardingStatus === 'complete',
  'onboarding_required',
  'Completed account onboarding required'
);

function requireRole(...roles) {
  return afterSession(
    req => roles.includes(req.userRole),
    'role_required',
    'Required account role is unavailable'
  );
}

function generateToken(user) {
  return credentials.signApiCompatibility(user);
}

function requireAdmin(req, res) {
  return sendAuthError(req, res, 410, 'Legacy administrative authentication is disabled', 'legacy_admin_disabled');
}

module.exports = {
  JWT_SECRET: credentials.JWT_SECRET,
  attachTenantContext,
  generateToken,
  requireActiveAccount,
  requireAdmin,
  requireAuth: requireActiveAccount,
  requireRole,
  requireSession,
  requireVerifiedAccount,
};
