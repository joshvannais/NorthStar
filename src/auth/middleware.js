/**
 * PostgreSQL-backed session, account-state, and role authorization boundaries.
 * Browser credentials are accepted only from secure cookies. User Bearer
 * credentials are deliberately unsupported: every mounted user request must
 * resolve a current durable session and its PostgreSQL-owned tenant state.
 */

'use strict';

const db = require('../db');
const credentials = require('./credentials');
const { AccountRepository } = require('../accounts/repository');
const {
  canMutateInternal,
  canPerformExternal,
  projectSubscription,
} = require('../accounts/subscriptionPolicy');
const { isCanonicalAccessRole } = require('./permissions');

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
    onboardingStatus: authority.onboarding_status || null,
    emailVerified: authority.user_status === 'active',
  });
  const subscription = projectSubscription(authority);

  Object.defineProperties(req, {
    user: { value: trustedUser, enumerable: true, configurable: false, writable: false },
    tenantContext: { value: context, enumerable: true, configurable: false, writable: false },
    orgId: { value: organizationId, enumerable: true, configurable: false, writable: false },
    userRole: { value: role, enumerable: true, configurable: false, writable: false },
    authSession: { value: session ? Object.freeze(session) : null, enumerable: true, configurable: false, writable: false },
    accountAuthority: { value: Object.freeze({ ...authority }), enumerable: false, configurable: false, writable: false },
    subscriptionAuthority: { value: subscription, enumerable: true, configurable: false, writable: false },
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
    // Test applications may inject a repository with a controllable clock at
    // construction time. Production leaves this absent and always reloads
    // PostgreSQL clock authority. Request data can never select the repository.
    const repository = req.app && req.app.locals && req.app.locals.accountRepository;
    const authority = await (repository && typeof repository.sessionAuthority === 'function'
      ? repository
      : new AccountRepository()).sessionAuthority(decoded.sid, decoded.sub);
    if (!authority || authority.session_status !== 'active') {
      return sendAuthError(req, res, 401, 'Session is no longer active', 'session_inactive');
    }
    if (new Date(authority.access_expires_at).getTime() <= Date.now()) {
      return sendAuthError(req, res, 401, 'Access credential expired', 'access_expired');
    }
    if (!authority.user_id || !authority.organization_id || !isCanonicalAccessRole(authority.role) ||
        authority.membership_status !== 'active' ||
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

async function requireSession(req, res, next) {
  if (trustedTenantRequests.has(req)) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && /^Bearer(?:\s|$)/i.test(authHeader)) {
    return sendAuthError(req, res, 401, 'Authentication required', 'unauthorized');
  }
  const cookies = credentials.parseCookies(req.headers.cookie);
  if (cookies[credentials.ACCESS_COOKIE]) {
    const accepted = await cookieSession(req, res, cookies[credentials.ACCESS_COOKIE]);
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
  req => req.user.status === 'active',
  'verification_required',
  'Verified account required'
);

const requireOnboardedInternal = afterSession(
  req => req.user.onboardingStatus === 'complete' && canMutateInternal(req.subscriptionAuthority),
  'product_access_required',
  'Completed onboarding and current subscription access are required'
);

const requireAccountMutation = afterSession(
  req => canMutateInternal(req.subscriptionAuthority, { allowPending: true }),
  'subscription_read_only',
  'Organization subscription access is read-only'
);

async function requireVerifiedExternalAction(req, res, next) {
  const proceed = () => {
    if (req.user.status !== 'active') {
      return sendAuthError(req, res, 403, 'Verified account required', 'verification_required');
    }
    if (req.user.onboardingStatus !== 'complete') {
      return sendAuthError(req, res, 403, 'Completed account onboarding required', 'onboarding_required');
    }
    if (!canPerformExternal(req.subscriptionAuthority)) {
      return sendAuthError(req, res, 403, 'Organization subscription access is read-only', 'subscription_read_only');
    }
    return next();
  };
  if (trustedTenantRequests.has(req)) return proceed();
  return requireSession(req, res, proceed);
}

const requireTenantAccess = requireSession;

function requireRole(...roles) {
  return afterSession(
    req => roles.includes(req.userRole),
    'role_required',
    'Required account role is unavailable'
  );
}

function requireAdmin(req, res) {
  return sendAuthError(req, res, 410, 'Legacy administrative authentication is disabled', 'legacy_admin_disabled');
}

module.exports = {
  attachTenantContext,
  requireActiveAccount: requireVerifiedExternalAction,
  requireAdmin,
  requireAuth: requireTenantAccess,
  requireAccountMutation,
  requireOnboardedInternal,
  requireRole,
  requireSession,
  requireTenantAccess,
  requireVerifiedAccount,
  requireVerifiedExternalAction,
};
