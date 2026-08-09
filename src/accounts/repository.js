'use strict';

const db = require('../db');

class AccountPersistenceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AccountPersistenceError';
    this.cause = cause;
  }
}

function rows(result) {
  return result && Array.isArray(result.rows) ? result.rows : [];
}

class AccountRepository {
  constructor(pool, options = {}) {
    this.explicitPool = Boolean(pool);
    this.pool = pool || db.getPool();
    this.testClock = typeof options.testClock === 'function' ? options.testClock : null;
  }

  currentTimeOverride() {
    if (!this.testClock) return null;
    const value = this.testClock();
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid test clock');
    return date.toISOString();
  }

  requirePool() {
    if (!this.pool || (!this.explicitPool && !db.isAvailable())) {
      throw new AccountPersistenceError('PostgreSQL account authority is unavailable');
    }
    return this.pool;
  }

  async transaction(work) {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createSignupGraph(input) {
    return this.transaction(async client => {
      await client.query(
        `INSERT INTO organizations (id, name, owner_name, email, phone)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.organizationId, input.businessName, input.name, input.email, input.phone]
      );
      await client.query(
        `INSERT INTO users (
           id, organization_id, name, email, email_normalized, password_hash, phone, role, status
         ) VALUES ($1, $2, $3, $4, $4, $5, $6, 'owner', 'pending_verification')`,
        [input.userId, input.organizationId, input.name, input.email, input.passwordHash, input.phone]
      );
      await client.query(
        `INSERT INTO organization_memberships (
           id, organization_id, user_id, role, status
         ) VALUES ($1, $2, $3, 'owner', 'active')`,
        [input.membershipId, input.organizationId, input.userId]
      );
      await client.query(
        `INSERT INTO subscriptions (
           id, organization_id, plan_type, status, trial_started_at, trial_ends_at
         ) VALUES ($1, $2, 'Trial', 'pending_verification', NULL, NULL)`,
        [input.subscriptionId, input.organizationId]
      );
      await client.query(
        `INSERT INTO notification_preferences (
           id, organization_id, email_new_lead, email_call_summary,
           email_appointment, sms_new_lead, sms_urgent,
           notification_email, notification_phone
         ) VALUES ($1, $2, FALSE, FALSE, FALSE, FALSE, FALSE, $3, $4)`,
        [input.preferencesId, input.organizationId, input.email, input.phone]
      );
      await client.query(
        `INSERT INTO organization_account_preferences (organization_id, preferences)
         VALUES ($1, '{}'::jsonb)`,
        [input.organizationId]
      );
      await client.query(
        `INSERT INTO organization_onboarding (organization_id, status)
         VALUES ($1, 'pending_verification')`,
        [input.organizationId]
      );
      await client.query(
        `INSERT INTO account_action_tokens (
           id, user_id, organization_id, purpose, token_hash, expires_at
         ) VALUES ($1, $2, $3, 'email_verification', $4, NOW() + INTERVAL '24 hours')`,
        [
          input.verificationTokenId,
          input.userId,
          input.organizationId,
          input.verificationTokenHash,
        ]
      );
      return {
        userId: input.userId,
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        userStatus: 'pending_verification',
        membershipStatus: 'active',
        role: 'owner',
        onboardingStatus: 'pending_verification',
      };
    });
  }

  async findLoginAuthority(emailNormalized) {
    const result = await this.requirePool().query(
      `SELECT u.id AS user_id,
              u.organization_id,
              u.name,
              u.email,
              u.phone,
              u.password_hash,
              u.status AS user_status,
              m.id AS membership_id,
              m.role,
              m.status AS membership_status,
              o.name AS organization_name,
              onboard.status AS onboarding_status,
              active_profile.id AS active_business_profile_id
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
         JOIN organization_memberships m
           ON m.user_id = u.id AND m.organization_id = u.organization_id
         JOIN organization_onboarding onboard ON onboard.organization_id = o.id
         LEFT JOIN canonical_business_profiles active_profile
           ON active_profile.organization_id = o.id AND active_profile.is_active = TRUE
        WHERE u.email_normalized = $1`,
      [emailNormalized]
    );
    return rows(result)[0] || null;
  }

  async upgradePasswordHash(userId, passwordHash) {
    await this.requirePool().query(
      'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
      [userId, passwordHash]
    );
  }

  async createLoginSession(input) {
    return this.transaction(async client => {
      const authorityResult = await client.query(
        `SELECT u.id AS user_id,
                u.organization_id,
                u.name,
                u.email,
                u.phone,
                u.status AS user_status,
                m.id AS membership_id,
                m.role,
                m.status AS membership_status,
                o.name AS organization_name,
                onboard.status AS onboarding_status,
                active_profile.id AS active_business_profile_id
           FROM users u
           JOIN organizations o ON o.id = u.organization_id
           JOIN organization_memberships m
             ON m.user_id = u.id AND m.organization_id = u.organization_id
           JOIN organization_onboarding onboard ON onboard.organization_id = o.id
           LEFT JOIN canonical_business_profiles active_profile
             ON active_profile.organization_id = o.id AND active_profile.is_active = TRUE
          WHERE u.id = $1
          FOR UPDATE OF u, m`,
        [input.userId]
      );
      const authority = rows(authorityResult)[0];
      if (!authority || authority.membership_status !== 'active' ||
          !['pending_verification', 'active'].includes(authority.user_status)) {
        return null;
      }

      await client.query(
        `INSERT INTO auth_sessions (
           id, user_id, organization_id, membership_id, access_expires_at,
           refresh_expires_at, csrf_token_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.sessionId,
          authority.user_id,
          authority.organization_id,
          authority.membership_id,
          input.accessExpiresAt,
          input.refreshExpiresAt,
          input.csrfTokenHash,
        ]
      );
      await client.query(
        `INSERT INTO auth_refresh_tokens (
           id, session_id, family_id, token_hash, expires_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [input.refreshTokenId, input.sessionId, input.refreshFamilyId, input.refreshTokenHash, input.refreshExpiresAt]
      );
      return authority;
    });
  }

  async sessionAuthority(sessionId, userId) {
    const result = await this.requirePool().query(
      `SELECT session.id AS session_id,
              session.user_id,
              session.organization_id,
              session.membership_id,
              session.status AS session_status,
              session.access_expires_at,
              session.refresh_expires_at,
              session.csrf_token_hash,
              u.name,
              u.email,
              u.phone,
              u.status AS user_status,
              membership.role,
              membership.status AS membership_status,
              organization.name AS organization_name,
              onboarding.status AS stored_onboarding_status,
              active_profile.id AS active_business_profile_id,
              CASE WHEN active_profile.id IS NOT NULL THEN 'complete' ELSE onboarding.status END AS onboarding_status,
              subscription.plan_type,
              subscription.status AS subscription_status,
              subscription.trial_started_at,
              subscription.trial_ends_at,
              COALESCE($3::timestamptz, clock_timestamp()) AS server_now
         FROM auth_sessions session
         JOIN users u ON u.id = session.user_id
         JOIN organizations organization ON organization.id = session.organization_id
         JOIN organization_memberships membership
           ON membership.id = session.membership_id
          AND membership.organization_id = session.organization_id
          AND membership.user_id = session.user_id
         JOIN organization_onboarding onboarding
           ON onboarding.organization_id = session.organization_id
         LEFT JOIN canonical_business_profiles active_profile
           ON active_profile.organization_id = session.organization_id
          AND active_profile.is_active = TRUE
         LEFT JOIN LATERAL (
           SELECT plan_type, status, trial_started_at, trial_ends_at
             FROM subscriptions
            WHERE organization_id = session.organization_id
            LIMIT 1
         ) subscription ON TRUE
        WHERE session.id = $1 AND session.user_id = $2`,
      [sessionId, userId, this.currentTimeOverride()]
    );
    return rows(result)[0] || null;
  }

  async replaceVerificationToken(input) {
    return this.transaction(async client => {
      const authorityResult = await client.query(
        `SELECT u.id AS user_id, u.organization_id, u.email, u.status AS user_status,
                s.status AS subscription_status
           FROM users u
           JOIN organization_memberships m
             ON m.user_id = u.id AND m.organization_id = u.organization_id
           JOIN subscriptions s ON s.organization_id = u.organization_id
          WHERE u.id = $1 AND u.organization_id = $2 AND m.status = 'active'
          FOR UPDATE OF u, m, s`,
        [input.userId, input.organizationId]
      );
      const authority = rows(authorityResult)[0];
      if (!authority || authority.user_status !== 'pending_verification' ||
          authority.subscription_status !== 'pending_verification') return null;
      const prior = await client.query(
        `SELECT id FROM account_action_tokens
          WHERE user_id = $1 AND purpose = 'email_verification'
            AND consumed_at IS NULL AND revoked_at IS NULL
          FOR UPDATE`,
        [input.userId]
      );
      if (prior.rowCount > 0) {
        await client.query(
          `UPDATE account_action_tokens
              SET revoked_at = NOW(), superseded_by_token_id = $2
            WHERE id = $1`,
          [prior.rows[0].id, input.tokenId]
        );
      }
      await client.query(
        `INSERT INTO account_action_tokens (
           id, user_id, organization_id, purpose, token_hash, expires_at
         ) VALUES ($1, $2, $3, 'email_verification', $4, NOW() + INTERVAL '24 hours')`,
        [input.tokenId, input.userId, input.organizationId, input.tokenHash]
      );
      return authority;
    });
  }

  async verifyEmailToken(tokenHash) {
    return this.transaction(async client => {
      const currentTime = this.currentTimeOverride();
      const result = await client.query(
        `SELECT t.id AS token_id, t.user_id, t.organization_id, t.purpose,
                t.expires_at, t.consumed_at, t.revoked_at,
                t.expires_at > COALESCE($2::timestamptz, clock_timestamp()) AS token_valid,
                u.status AS user_status, s.status AS subscription_status
           FROM account_action_tokens t
           JOIN users u ON u.id = t.user_id AND u.organization_id = t.organization_id
           JOIN organization_memberships m
             ON m.user_id = t.user_id AND m.organization_id = t.organization_id
           JOIN subscriptions s ON s.organization_id = t.organization_id
          WHERE t.token_hash = $1
          FOR UPDATE OF t, u, m, s`,
        [tokenHash, currentTime]
      );
      const authority = rows(result)[0];
      if (!authority || authority.purpose !== 'email_verification' ||
          authority.consumed_at || authority.revoked_at || authority.token_valid !== true) return null;
      if (authority.user_status === 'active') return null;
      if (authority.user_status !== 'pending_verification' ||
          authority.subscription_status !== 'pending_verification') return null;

      const subscription = await client.query(
        `UPDATE subscriptions
            SET status = 'trialing',
                trial_started_at = COALESCE($2::timestamptz, transaction_timestamp()),
                trial_ends_at = COALESCE($2::timestamptz, transaction_timestamp()) + INTERVAL '14 days',
                updated_at = COALESCE($2::timestamptz, transaction_timestamp())
          WHERE organization_id = $1 AND status = 'pending_verification'
          RETURNING trial_started_at, trial_ends_at`,
        [authority.organization_id, currentTime]
      );
      if (subscription.rowCount !== 1) return null;
      await client.query(
        `UPDATE users SET status = 'active', updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'pending_verification'`,
        [authority.user_id]
      );
      await client.query(
        `UPDATE organization_onboarding
            SET status = CASE
                  WHEN active_business_profile_id IS NULL THEN 'business_profile_required'
                  ELSE 'complete'
                END,
                updated_at = clock_timestamp()
          WHERE organization_id = $1`,
        [authority.organization_id]
      );
      await client.query(
        `UPDATE account_action_tokens SET consumed_at = clock_timestamp()
          WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [authority.token_id]
      );
      return {
        userId: authority.user_id,
        organizationId: authority.organization_id,
        trialStartedAt: subscription.rows[0].trial_started_at,
        trialEndsAt: subscription.rows[0].trial_ends_at,
      };
    });
  }

  async findRecoveryAuthority(emailNormalized) {
    const result = await this.requirePool().query(
      `SELECT u.id AS user_id, u.organization_id, u.email, u.status AS user_status,
              m.status AS membership_status
         FROM users u
         JOIN organization_memberships m
           ON m.user_id = u.id AND m.organization_id = u.organization_id
        WHERE u.email_normalized = $1`,
      [emailNormalized]
    );
    return rows(result)[0] || null;
  }

  async replaceResetToken(input) {
    return this.transaction(async client => {
      const locked = await client.query(
        `SELECT u.id, u.organization_id, u.email, u.status, m.status AS membership_status
           FROM users u
           JOIN organization_memberships m
             ON m.user_id = u.id AND m.organization_id = u.organization_id
          WHERE u.id = $1 AND u.organization_id = $2
          FOR UPDATE OF u, m`,
        [input.userId, input.organizationId]
      );
      const authority = rows(locked)[0];
      if (!authority || authority.status !== 'active' || authority.membership_status !== 'active') return null;
      const prior = await client.query(
        `SELECT id FROM account_action_tokens
          WHERE user_id = $1 AND purpose = 'password_reset'
            AND consumed_at IS NULL AND revoked_at IS NULL
          FOR UPDATE`,
        [input.userId]
      );
      if (prior.rowCount > 0) {
        await client.query(
          `UPDATE account_action_tokens
              SET revoked_at = NOW(), superseded_by_token_id = $2
            WHERE id = $1`,
          [prior.rows[0].id, input.tokenId]
        );
      }
      await client.query(
        `INSERT INTO account_action_tokens (
           id, user_id, organization_id, purpose, token_hash, expires_at
         ) VALUES ($1, $2, $3, 'password_reset', $4, NOW() + INTERVAL '30 minutes')`,
        [input.tokenId, input.userId, input.organizationId, input.tokenHash]
      );
      return authority;
    });
  }

  async resetPasswordWithToken(input) {
    return this.transaction(async client => {
      const currentTime = this.currentTimeOverride();
      const result = await client.query(
        `SELECT t.id AS token_id, t.user_id, t.organization_id, t.purpose,
                t.expires_at, t.consumed_at, t.revoked_at,
                t.expires_at > COALESCE($2::timestamptz, clock_timestamp()) AS token_valid
           FROM account_action_tokens t
           JOIN users u ON u.id = t.user_id AND u.organization_id = t.organization_id
          WHERE t.token_hash = $1
          FOR UPDATE OF t, u`,
        [input.tokenHash, currentTime]
      );
      const token = rows(result)[0];
      if (!token || token.purpose !== 'password_reset' || token.consumed_at || token.revoked_at ||
          token.token_valid !== true) return null;
      await client.query(
        `UPDATE users SET password_hash = $2, updated_at = clock_timestamp() WHERE id = $1`,
        [token.user_id, input.passwordHash]
      );
      await client.query(
        `UPDATE auth_sessions
            SET status = 'revoked', revoked_at = clock_timestamp(), revoke_reason = 'password_reset'
          WHERE user_id = $1 AND status = 'active'`,
        [token.user_id]
      );
      await client.query(
        `UPDATE auth_refresh_tokens token
            SET status = 'revoked', revoked_at = clock_timestamp(), revoke_reason = 'password_reset'
           FROM auth_sessions session
          WHERE token.session_id = session.id AND session.user_id = $1
            AND token.status = 'active'`,
        [token.user_id]
      );
      await client.query(
        `UPDATE account_action_tokens SET consumed_at = clock_timestamp()
          WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [token.token_id]
      );
      const remaining = await client.query(
        `SELECT
           (SELECT count(*)::int FROM auth_sessions
             WHERE user_id = $1 AND status = 'active') AS sessions,
           (SELECT count(*)::int FROM auth_refresh_tokens token
              JOIN auth_sessions session ON session.id = token.session_id
             WHERE session.user_id = $1 AND token.status = 'active') AS refresh_tokens`,
        [token.user_id]
      );
      if (remaining.rows[0].sessions !== 0 || remaining.rows[0].refresh_tokens !== 0) {
        throw new Error('Password reset left active credential authority');
      }
      return { userId: token.user_id, organizationId: token.organization_id };
    });
  }

  async expireAndReadSubscription(organizationId, options = {}) {
    const work = async client => {
      const currentTime = this.currentTimeOverride();
      await client.query(
        `UPDATE subscriptions
            SET status = 'expired', updated_at = clock_timestamp()
          WHERE organization_id = $1 AND status = 'trialing'
            AND trial_ends_at <= COALESCE($2::timestamptz, clock_timestamp())`,
        [organizationId, currentTime]
      );
      const result = await client.query(
        `SELECT status AS subscription_status, trial_started_at, trial_ends_at,
                COALESCE($2::timestamptz, clock_timestamp()) AS server_now
           FROM subscriptions WHERE organization_id = $1`,
        [organizationId, currentTime]
      );
      return rows(result)[0] || null;
    };
    if (options.client) {
      if (typeof options.client.query !== 'function') {
        throw new AccountPersistenceError('PostgreSQL account transaction client is unavailable');
      }
      return work(options.client);
    }
    return this.transaction(work);
  }

  async accountPreferences(organizationId) {
    const result = await this.requirePool().query(
      `SELECT notification.email_new_lead,
              notification.email_call_summary,
              notification.email_appointment,
              notification.sms_new_lead,
              notification.sms_urgent,
              notification.notification_email,
              notification.notification_phone,
              account.preferences AS internal_preferences
         FROM notification_preferences notification
         JOIN organization_account_preferences account
           ON account.organization_id = notification.organization_id
        WHERE notification.organization_id = $1`,
      [organizationId]
    );
    return rows(result)[0] || null;
  }

  async updateAccountPreferences(organizationId, notification, internalPreferences) {
    try {
      return await this.transaction(async client => {
        const authority = await client.query(
          `SELECT notification.organization_id
             FROM notification_preferences notification
             JOIN organization_account_preferences account
               ON account.organization_id = notification.organization_id
            WHERE notification.organization_id = $1
            FOR UPDATE OF notification, account`,
          [organizationId]
        );
        if (authority.rowCount !== 1) return null;

        const notificationResult = await client.query(
          `UPDATE notification_preferences
              SET email_new_lead = $2,
                  email_call_summary = $3,
                  email_appointment = $4,
                  sms_new_lead = $5,
                  sms_urgent = $6,
                  notification_email = $7,
                  notification_phone = $8,
                  updated_at = NOW()
            WHERE organization_id = $1
            RETURNING email_new_lead, email_call_summary, email_appointment,
                      sms_new_lead, sms_urgent, notification_email, notification_phone`,
          [
            organizationId,
            notification.emailNewLead,
            notification.emailCallSummary,
            notification.emailAppointment,
            notification.smsNewLead,
            notification.smsUrgent,
            notification.notificationEmail,
            notification.notificationPhone,
          ]
        );
        const internalResult = await client.query(
          `UPDATE organization_account_preferences
              SET preferences = $2::jsonb, updated_at = NOW()
            WHERE organization_id = $1
            RETURNING preferences`,
          [organizationId, JSON.stringify(internalPreferences)]
        );
        if (notificationResult.rowCount !== 1 || internalResult.rowCount !== 1) {
          throw new Error('Account preference authority update was incomplete');
        }
        return {
          ...notificationResult.rows[0],
          internal_preferences: internalResult.rows[0].preferences,
        };
      });
    } catch (error) {
      if (error instanceof AccountPersistenceError) throw error;
      throw new AccountPersistenceError('PostgreSQL account preferences are unavailable', error);
    }
  }

  async rotateRefresh(input) {
    return this.transaction(async client => {
      const result = await client.query(
        `SELECT token.id AS token_id,
                token.session_id,
                token.family_id,
                token.status AS token_status,
                token.expires_at AS token_expires_at,
                session.user_id,
                session.organization_id,
                session.membership_id,
                session.status AS session_status,
                session.refresh_expires_at,
                u.status AS user_status,
                membership.status AS membership_status
           FROM auth_refresh_tokens token
           JOIN auth_sessions session ON session.id = token.session_id
           JOIN users u ON u.id = session.user_id
           JOIN organization_memberships membership
             ON membership.id = session.membership_id
            AND membership.organization_id = session.organization_id
            AND membership.user_id = session.user_id
          WHERE token.token_hash = $1
          FOR UPDATE OF token, session, u, membership`,
        [input.presentedTokenHash]
      );
      const current = rows(result)[0];
      if (!current) return { outcome: 'invalid' };

      if (current.token_status !== 'active') {
        await client.query(
          `UPDATE auth_refresh_tokens
              SET status = CASE
                    WHEN status = 'rotated' THEN 'reused'
                    WHEN status = 'active' THEN 'revoked'
                    ELSE status
                  END,
                  revoked_at = COALESCE(revoked_at, NOW()),
                  revoke_reason = COALESCE(revoke_reason, 'refresh_replay')
            WHERE family_id = $1`,
          [current.family_id]
        );
        await client.query(
          `UPDATE auth_sessions
              SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'refresh_replay'
            WHERE id = $1 AND status = 'active'`,
          [current.session_id]
        );
        return { outcome: 'replay' };
      }

      const expired = new Date(current.token_expires_at).getTime() <= Date.now() ||
        new Date(current.refresh_expires_at).getTime() <= Date.now();
      const invalidAuthority = current.session_status !== 'active' ||
        current.membership_status !== 'active' ||
        !['pending_verification', 'active'].includes(current.user_status);
      if (expired || invalidAuthority) {
        const reason = expired ? 'refresh_expired' : 'account_inactive';
        await client.query(
          `UPDATE auth_refresh_tokens
              SET status = $2, revoked_at = NOW(), revoke_reason = $3
            WHERE family_id = $1 AND status = 'active'`,
          [current.family_id, expired ? 'expired' : 'revoked', reason]
        );
        await client.query(
          `UPDATE auth_sessions
              SET status = $2, revoked_at = NOW(), revoke_reason = $3
            WHERE id = $1 AND status = 'active'`,
          [current.session_id, expired ? 'expired' : 'revoked', reason]
        );
        return { outcome: expired ? 'expired' : 'inactive' };
      }

      await client.query(
        `UPDATE auth_refresh_tokens
            SET status = 'rotated', consumed_at = NOW(), last_used_at = NOW(),
                replaced_by_token_id = $2
          WHERE id = $1 AND status = 'active'`,
        [current.token_id, input.nextTokenId]
      );
      await client.query(
        `INSERT INTO auth_refresh_tokens (
           id, session_id, family_id, parent_token_id, token_hash, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.nextTokenId,
          current.session_id,
          current.family_id,
          current.token_id,
          input.nextTokenHash,
          current.refresh_expires_at,
        ]
      );
      await client.query(
        `UPDATE auth_sessions
            SET access_expires_at = $2,
                csrf_token_hash = $3,
                last_used_at = NOW()
          WHERE id = $1`,
        [current.session_id, input.accessExpiresAt, input.csrfTokenHash]
      );
      return {
        outcome: 'rotated',
        sessionId: current.session_id,
        userId: current.user_id,
        refreshExpiresAt: current.refresh_expires_at,
      };
    });
  }

  async refreshSessionAuthority(presentedTokenHash) {
    const result = await this.requirePool().query(
      `SELECT token.session_id,
              token.status AS token_status,
              session.csrf_token_hash,
              session.status AS session_status
         FROM auth_refresh_tokens token
         JOIN auth_sessions session ON session.id = token.session_id
        WHERE token.token_hash = $1`,
      [presentedTokenHash]
    );
    return rows(result)[0] || null;
  }

  async revokeSessionForLogout(input) {
    try {
      return await this.transaction(async client => {
        const authorityResult = await client.query(
          `SELECT token.id AS token_id,
                  token.session_id,
                  token.family_id,
                  token.status AS token_status,
                  token.revoke_reason AS token_revoke_reason,
                  token.expires_at AS token_expires_at,
                  session.status AS session_status,
                  session.revoke_reason AS session_revoke_reason,
                  session.refresh_expires_at,
                  session.csrf_token_hash
             FROM auth_refresh_tokens token
             JOIN auth_sessions session ON session.id = token.session_id
            WHERE token.token_hash = $1
            FOR UPDATE OF token, session`,
          [input.presentedTokenHash]
        );
        const authority = rows(authorityResult)[0];
        const csrfMatches = authority && authority.csrf_token_hash === input.csrfTokenHash;
        const confirmedLogout = csrfMatches && authority.token_status === 'revoked' &&
            authority.session_status === 'revoked' &&
            authority.token_revoke_reason === 'logout' &&
            authority.session_revoke_reason === 'logout';
        const invalid = !confirmedLogout && (!csrfMatches || authority.token_status !== 'active' ||
          authority.session_status !== 'active' ||
          new Date(authority.token_expires_at).getTime() <= Date.now() ||
          new Date(authority.refresh_expires_at).getTime() <= Date.now());
        if (invalid) return { outcome: 'invalid' };

        const familyResult = await client.query(
          `SELECT id, status
             FROM auth_refresh_tokens
            WHERE session_id = $1 OR family_id = $2
            FOR UPDATE`,
          [authority.session_id, authority.family_id]
        );
        if (!familyResult.rows.some(row => row.id === authority.token_id)) {
          throw new Error('Durable logout refresh family lock was incomplete');
        }
        if (!confirmedLogout) {
          const sessionResult = await client.query(
            `UPDATE auth_sessions
                SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'logout'
              WHERE id = $1 AND status = 'active'
              RETURNING id`,
            [authority.session_id]
          );
          if (sessionResult.rowCount !== 1) {
            throw new Error('Durable logout session revocation was incomplete');
          }
        }
        const tokenResult = await client.query(
          `UPDATE auth_refresh_tokens
              SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'logout'
            WHERE (session_id = $1 OR family_id = $2) AND status = 'active'
            RETURNING id`,
          [authority.session_id, authority.family_id]
        );
        if (!confirmedLogout &&
            (tokenResult.rowCount < 1 || !tokenResult.rows.some(row => row.id === authority.token_id))) {
          throw new Error('Durable logout refresh revocation was incomplete');
        }
        const remainingResult = await client.query(
          `SELECT count(*)::int AS active_count
             FROM auth_refresh_tokens
            WHERE (session_id = $1 OR family_id = $2) AND status = 'active'`,
          [authority.session_id, authority.family_id]
        );
        if (remainingResult.rows[0].active_count !== 0) {
          throw new Error('Durable logout left an active refresh credential');
        }
        return {
          outcome: confirmedLogout ? 'confirmed_revoked' : 'revoked',
          sessionId: authority.session_id,
        };
      });
    } catch (error) {
      if (error instanceof AccountPersistenceError) throw error;
      throw new AccountPersistenceError('PostgreSQL logout revocation is unavailable', error);
    }
  }

  async consumeRateLimit(eventType, keyHash, options) {
    const result = await this.requirePool().query(
      `INSERT INTO auth_rate_limits (
         event_type, key_hash, window_started_at, attempt_count, blocked_until
       ) VALUES ($1, $2, NOW(), 1, NULL)
       ON CONFLICT (event_type, key_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 second') THEN NOW()
           ELSE auth_rate_limits.window_started_at
         END,
         attempt_count = CASE
           WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 second') THEN 1
           ELSE auth_rate_limits.attempt_count + 1
         END,
         blocked_until = CASE
           WHEN auth_rate_limits.blocked_until > NOW() THEN auth_rate_limits.blocked_until
           WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 second') THEN NULL
           WHEN auth_rate_limits.attempt_count + 1 > $4 THEN NOW() + ($5 * INTERVAL '1 second')
           ELSE NULL
         END,
         updated_at = NOW()
       RETURNING attempt_count, blocked_until, blocked_until IS NULL OR blocked_until <= NOW() AS allowed`,
      [eventType, keyHash, options.windowSeconds, options.limit, options.blockSeconds]
    );
    const state = rows(result)[0];
    return { allowed: Boolean(state && state.allowed), blockedUntil: state && state.blocked_until };
  }

  async clearRateLimit(eventType, keyHash) {
    await this.requirePool().query(
      'DELETE FROM auth_rate_limits WHERE event_type = $1 AND key_hash = $2',
      [eventType, keyHash]
    );
  }
}

module.exports = { AccountPersistenceError, AccountRepository };
