'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const credentials = require('../auth/credentials');
const { AccountPersistenceError, AccountRepository } = require('./repository');
const { projectSubscription } = require('./subscriptionPolicy');

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
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new AccountError(400, 'invalid_password', 'Password must contain 8 through 128 characters');
  }
  return value;
}

function passwordMaterial(password) {
  return `northstar-sha512:${crypto.createHash('sha512').update(password, 'utf8').digest('base64')}`;
}

async function hashVerifiedPassword(password) {
  return bcrypt.hash(passwordMaterial(password), 12);
}

async function hashPassword(password) {
  return hashVerifiedPassword(validatePassword(password));
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

function boundedText(value, maximum, code, message, required = true) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AccountError(400, code, message);
  }
  return normalized;
}

function actionToken() {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  return {
    id: crypto.randomUUID(),
    rawToken,
    tokenHash: credentials.hashToken(rawToken),
  };
}

function tokenHash(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (token.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AccountError(400, 'invalid_token', 'The account action link is invalid or expired');
  }
  return credentials.hashToken(token);
}

function deliveryContext(context, deliveryId) {
  return {
    deliveryId,
    requestId: context && context.requestId,
  };
}

function safeDiagnostic(value, fallback) {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9_]+$/.test(value)
    ? value
    : fallback;
}

function logDeliveryFailure(error, context) {
  const resend = error && error.provider === 'resend';
  const requestId = resend ? error.requestId : context && context.requestId;
  const safe = {
    provider: resend ? 'resend' : 'transactional',
    accepted: false,
    category: resend ? safeDiagnostic(error.category, 'unknown') : 'unknown',
    code: resend ? safeDiagnostic(error.code, 'transactional_delivery_failed') : 'transactional_delivery_failed',
    httpStatus: resend && Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599
      ? error.httpStatus
      : null,
    providerMessageIdPresent: false,
    attemptedAt: resend && typeof error.attemptedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(error.attemptedAt)
      ? error.attemptedAt
      : null,
    requestId: typeof requestId === 'string' && requestId.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(requestId)
      ? requestId
      : 'unavailable',
  };
  console.warn('[Auth] Transactional delivery failed:', safe);
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
      trialStartedAt: authority.trial_started_at,
      trialEndsAt: authority.trial_ends_at,
    } : null,
    onboarding: {
      status: effectiveOnboarding,
      activeBusinessProfileId: authority.active_business_profile_id || null,
    },
  };
}

class AccountService {
  constructor(repository, options = {}) {
    this.repository = repository || new AccountRepository();
    this.transactionalEmail = options.transactionalEmail || null;
  }

  async consumeLimit(eventType, value, options) {
    const key = credentials.rateLimitKey(eventType, value || 'unknown');
    const state = await this.repository.consumeRateLimit(eventType, key, options);
    if (!state.allowed) throw new AccountError(429, 'rate_limited', 'Too many requests. Try again later.');
    return key;
  }

  async signup(input, requestIp, context = {}) {
    if (!this.transactionalEmail || typeof this.transactionalEmail.verification !== 'function') {
      throw new AccountError(503, 'signup_disabled', 'Account signup is not currently available');
    }
    const email = normalizeEmail(input.email);
    const name = boundedText(input.name, 120, 'invalid_signup', 'Enter a valid name of at most 120 characters');
    const businessName = boundedText(
      input.businessName, 160, 'invalid_signup', 'Enter a valid business name of at most 160 characters'
    );
    const phone = boundedText(
      input.phone || '', 32, 'invalid_signup', 'Enter a valid phone number of at most 32 characters', false
    );
    const signupKey = await this.consumeLimit('signup_ip', requestIp, {
      limit: 5, windowSeconds: 3600, blockSeconds: 3600,
    });
    const passwordHash = await hashPassword(input.password);
    const verification = actionToken();
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
        verificationTokenId: verification.id,
        verificationTokenHash: verification.tokenHash,
        name,
        businessName,
        email,
        phone,
        passwordHash,
      });
      try {
        await this.transactionalEmail.verification(
          email,
          verification.rawToken,
          deliveryContext(context, verification.id)
        );
      } catch (error) {
        logDeliveryFailure(error, context);
        throw new AccountError(
          503,
          'verification_delivery_failed',
          'Account created, but verification delivery failed. Sign in and request a new link.'
        );
      }
      return {
        authority,
        account: accountView({ ...authority, name, email, phone, organization_name: businessName }),
      };
    } catch (error) {
      if (error && error.code === '23505') {
        return { duplicate: true };
      }
      if (error instanceof AccountPersistenceError) throw error;
      throw error;
    } finally {
      void signupKey;
    }
  }

  async verifyEmail(rawToken) {
    const verified = await this.repository.verifyEmailToken(tokenHash(rawToken));
    if (!verified) {
      throw new AccountError(400, 'verification_invalid', 'The verification link is invalid or expired');
    }
    return verified;
  }

  async resendVerification(authority, requestIp, context = {}) {
    await this.consumeLimit('verification_ip', requestIp, {
      limit: 8, windowSeconds: 3600, blockSeconds: 3600,
    });
    await this.consumeLimit('verification_user', authority.user_id, {
      limit: 4, windowSeconds: 3600, blockSeconds: 3600,
    });
    if (!this.transactionalEmail || typeof this.transactionalEmail.verification !== 'function') {
      throw new AccountError(503, 'verification_delivery_unavailable', 'Verification delivery is temporarily unavailable');
    }
    const token = actionToken();
    const pending = await this.repository.replaceVerificationToken({
      userId: authority.user_id,
      organizationId: authority.organization_id,
      tokenId: token.id,
      tokenHash: token.tokenHash,
    });
    if (!pending) return { accepted: true };
    try {
      await this.transactionalEmail.verification(
        pending.email,
        token.rawToken,
        deliveryContext(context, token.id)
      );
    } catch (error) {
      logDeliveryFailure(error, context);
      throw new AccountError(503, 'verification_delivery_failed', 'Verification delivery failed. Try again later.');
    }
    return { accepted: true };
  }

  async forgotPassword(input, requestIp, context = {}) {
    await this.consumeLimit('forgot_ip', requestIp, {
      limit: 8, windowSeconds: 3600, blockSeconds: 3600,
    });
    let email;
    try { email = normalizeEmail(input && input.email); } catch (_error) { return { accepted: true }; }
    const authority = await this.repository.findRecoveryAuthority(email);
    if (!authority || authority.user_status !== 'active' || authority.membership_status !== 'active' ||
        !this.transactionalEmail || typeof this.transactionalEmail.passwordReset !== 'function') {
      return { accepted: true };
    }
    const token = actionToken();
    const current = await this.repository.replaceResetToken({
      userId: authority.user_id,
      organizationId: authority.organization_id,
      tokenId: token.id,
      tokenHash: token.tokenHash,
    });
    if (!current) return { accepted: true };
    try {
      await this.transactionalEmail.passwordReset(
        current.email,
        token.rawToken,
        deliveryContext(context, token.id)
      );
    } catch (error) {
      logDeliveryFailure(error, context);
    }
    return { accepted: true };
  }

  async resetPassword(input, requestIp) {
    await this.consumeLimit('reset_ip', requestIp, {
      limit: 8, windowSeconds: 3600, blockSeconds: 3600,
    });
    const passwordHash = await hashPassword(input && input.password);
    const reset = await this.repository.resetPasswordWithToken({
      tokenHash: tokenHash(input && input.token),
      passwordHash,
    });
    if (!reset) throw new AccountError(400, 'reset_invalid', 'The reset link is invalid or expired');
    return reset;
  }

  async subscriptionStatus(organizationId) {
    return projectSubscription(await this.repository.expireAndReadSubscription(organizationId));
  }

  async login(input, requestIp) {
    const email = normalizeEmail(input.email);
    const submittedPassword = String(input.password || '');
    const ipKey = await this.consumeLimit('login_ip', requestIp, {
      limit: 10, windowSeconds: 900, blockSeconds: 900,
    });
    const emailKey = await this.consumeLimit('login_email', email, {
      limit: 5, windowSeconds: 900, blockSeconds: 900,
    });
    const authority = await this.repository.findLoginAuthority(email);
    const verification = authority
      ? await verifyPassword(submittedPassword, authority.password_hash)
      : { valid: false, needsUpgrade: false };
    if (!authority || !verification.valid) {
      throw new AccountError(401, 'invalid_credentials', 'Invalid email or password');
    }
    if (!['pending_verification', 'active'].includes(authority.user_status) || authority.membership_status !== 'active') {
      throw new AccountError(403, 'account_inactive', 'This account is not available');
    }
    if (verification.needsUpgrade) {
      await this.repository.upgradePasswordHash(authority.user_id, await hashVerifiedPassword(submittedPassword));
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
    if (!rawRefresh || !headerCsrf || !cookieCsrf || !credentials.safeEqual(headerCsrf, cookieCsrf)) {
      throw new AccountError(403, 'csrf_invalid', 'CSRF validation failed');
    }
    const result = await this.repository.revokeSessionForLogout({
      presentedTokenHash: credentials.hashToken(rawRefresh),
      csrfTokenHash: credentials.hashToken(headerCsrf),
    });
    if (!result || !['revoked', 'confirmed_revoked'].includes(result.outcome)) {
      throw new AccountError(403, 'csrf_invalid', 'CSRF validation failed');
    }
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
  actionToken,
  boundedText,
  tokenHash,
};
