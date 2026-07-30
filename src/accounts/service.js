'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const credentials = require('../auth/credentials');
const { AccountPersistenceError, AccountRepository } = require('./repository');

class AccountError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AccountError';
    this.status = status;
    this.code = code;
  }
}

function normalizeEmail(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AccountError(400, 'invalid_email', 'Enter a valid email address of at most 254 characters');
  }
  return normalized;
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new AccountError(400, 'invalid_password', 'Password must contain 12 through 128 characters');
  }
  return value;
}

function passwordMaterial(password) {
  return `northstar-sha512:${crypto.createHash('sha512').update(password, 'utf8').digest('base64')}`;
}

async function hashPassword(password) {
  return bcrypt.hash(passwordMaterial(validatePassword(password)), 12);
}

async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string') return { valid: false, needsUpgrade: false };
  const current = await bcrypt.compare(passwordMaterial(password), hash);
  if (current) return { valid: true, needsUpgrade: false };
  const legacy = await bcrypt.compare(password, hash);
  return { valid: legacy, needsUpgrade: legacy };
}

function sessionMaterial() {
  const accessExpiresAt = credentials.accessExpiry();
  const refreshExpiresAt = credentials.refreshExpiry();
  const refreshToken = credentials.randomToken();
  const csrfToken = credentials.randomToken();
  return {
    sessionId: crypto.randomUUID(),
    refreshTokenId: crypto.randomUUID(),
    refreshFamilyId: crypto.randomUUID(),
    refreshToken,
    refreshTokenHash: credentials.hashToken(refreshToken),
    csrfToken,
    csrfTokenHash: credentials.hashToken(csrfToken),
    accessExpiresAt,
    refreshExpiresAt,
  };
}

function accountView(authority) {
  const effectiveOnboarding = authority.active_business_profile_id || authority.activeBusinessProfileId
    ? 'complete'
    : (authority.onboarding_status || authority.stored_onboarding_status || authority.onboardingStatus);
  return {
    user: {
      id: authority.user_id || authority.userId,
      name: authority.name || '',
      email: authority.email || '',
      phone: authority.phone || '',
      status: authority.user_status || authority.userStatus,
    },
    organization: {
      id: authority.organization_id || authority.organizationId,
      name: authority.organization_name || authority.organizationName || '',
    },
    membership: {
      id: authority.membership_id || authority.membershipId,
      role: authority.role,
      status: authority.membership_status || authority.membershipStatus,
    },
    subscription: authority.plan_type ? {
      plan: authority.plan_type,
      status: authority.subscription_status,
      trialEnds: authority.trial_ends,
    } : null,
    onboarding: {
      status: effectiveOnboarding,
      activeBusinessProfileId: authority.active_business_profile_id || null,
    },
  };
}

class AccountService {
  constructor(repository) {
    this.repository = repository || new AccountRepository();
  }

  async consumeLimit(eventType, value, options) {
    const key = credentials.rateLimitKey(eventType, value || 'unknown');
    const state = await this.repository.consumeRateLimit(eventType, key, options);
    if (!state.allowed) throw new AccountError(429, 'rate_limited', 'Too many requests. Try again later.');
    return key;
  }

  async signup(input, requestIp) {
    const email = normalizeEmail(input.email);
    const name = String(input.name || '').trim();
    const businessName = String(input.businessName || '').trim();
    if (!name || !businessName) {
      throw new AccountError(400, 'invalid_signup', 'Name and business name are required');
    }
    const signupKey = await this.consumeLimit('signup_ip', requestIp, {
      limit: 5, windowSeconds: 3600, blockSeconds: 3600,
    });
    const passwordHash = await hashPassword(input.password);
    const material = sessionMaterial();
    const ids = {
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      membershipId: crypto.randomUUID(),
      subscriptionId: crypto.randomUUID(),
      preferencesId: crypto.randomUUID(),
    };
    try {
      const authority = await this.repository.createSignupGraph({
        ...ids,
        ...material,
        name,
        businessName,
        email,
        phone: String(input.phone || '').trim(),
        passwordHash,
      });
      material.accessToken = credentials.signAccess(ids.userId, material.sessionId);
      return { authority, account: accountView({ ...authority, name, email, phone: input.phone, organization_name: businessName }), material };
    } catch (error) {
      if (error && error.code === '23505') {
        throw new AccountError(409, 'account_exists', 'An account already exists for this email address');
      }
      if (error instanceof AccountPersistenceError) throw error;
      throw error;
    } finally {
      void signupKey;
    }
  }

  async login(input, requestIp) {
    const email = normalizeEmail(input.email);
    const ipKey = await this.consumeLimit('login_ip', requestIp, {
      limit: 10, windowSeconds: 900, blockSeconds: 900,
    });
    const emailKey = await this.consumeLimit('login_email', email, {
      limit: 5, windowSeconds: 900, blockSeconds: 900,
    });
    const authority = await this.repository.findLoginAuthority(email);
    const verification = authority
      ? await verifyPassword(String(input.password || ''), authority.password_hash)
      : { valid: false, needsUpgrade: false };
    if (!authority || !verification.valid) {
      throw new AccountError(401, 'invalid_credentials', 'Invalid email or password');
    }
    if (!['pending_verification', 'active'].includes(authority.user_status) || authority.membership_status !== 'active') {
      throw new AccountError(403, 'account_inactive', 'This account is not available');
    }
    if (verification.needsUpgrade) {
      await this.repository.upgradePasswordHash(authority.user_id, await hashPassword(input.password));
    }
    const material = sessionMaterial();
    const current = await this.repository.createLoginSession({
      userId: authority.user_id,
      ...material,
    });
    if (!current) throw new AccountError(403, 'account_inactive', 'This account is not available');
    material.accessToken = credentials.signAccess(current.user_id, material.sessionId);
    await Promise.all([
      this.repository.clearRateLimit('login_ip', ipKey),
      this.repository.clearRateLimit('login_email', emailKey),
    ]);
    return { authority: current, account: accountView(current), material };
  }

  async validateRefreshCsrf(rawRefresh, headerCsrf, cookieCsrf) {
    if (!rawRefresh || !headerCsrf || !cookieCsrf || !credentials.safeEqual(headerCsrf, cookieCsrf)) {
      throw new AccountError(403, 'csrf_invalid', 'CSRF validation failed');
    }
    const tokenHash = credentials.hashToken(rawRefresh);
    const authority = await this.repository.refreshSessionAuthority(tokenHash);
    if (!authority || authority.session_status !== 'active' ||
        (authority.token_status === 'active' &&
         !credentials.safeEqual(credentials.hashToken(headerCsrf), authority.csrf_token_hash))) {
      throw new AccountError(403, 'csrf_invalid', 'CSRF validation failed');
    }
    return { tokenHash, authority };
  }

  async refresh(rawRefresh, headerCsrf, cookieCsrf) {
    const csrf = await this.validateRefreshCsrf(rawRefresh, headerCsrf, cookieCsrf);
    const nextRefreshToken = credentials.randomToken();
    const nextCsrfToken = credentials.randomToken();
    const accessExpiresAt = credentials.accessExpiry();
    const rotated = await this.repository.rotateRefresh({
      presentedTokenHash: csrf.tokenHash,
      nextTokenId: crypto.randomUUID(),
      nextTokenHash: credentials.hashToken(nextRefreshToken),
      csrfTokenHash: credentials.hashToken(nextCsrfToken),
      accessExpiresAt,
    });
    if (rotated.outcome !== 'rotated') {
      const code = rotated.outcome === 'replay' ? 'refresh_replay' : 'refresh_invalid';
      throw new AccountError(401, code, 'Refresh credential is invalid or expired');
    }
    return {
      material: {
        accessToken: credentials.signAccess(rotated.userId, rotated.sessionId),
        refreshToken: nextRefreshToken,
        csrfToken: nextCsrfToken,
        accessExpiresAt,
        refreshExpiresAt: new Date(rotated.refreshExpiresAt),
      },
    };
  }

  async logout(rawRefresh, headerCsrf, cookieCsrf) {
    const csrf = await this.validateRefreshCsrf(rawRefresh, headerCsrf, cookieCsrf);
    await this.repository.revokeSession(csrf.authority.session_id, 'logout');
  }
}

module.exports = {
  AccountError,
  AccountService,
  accountView,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword,
};
