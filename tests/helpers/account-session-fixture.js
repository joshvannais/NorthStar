'use strict';

const crypto = require('crypto');

/**
 * Test provisioning for legacy mounted suites that predate the account signup
 * route. This creates the same durable membership/onboarding/session authority
 * that production middleware resolves. Its default `active` subscription is
 * an explicitly test-owned PostgreSQL fixture; no public production path can
 * create that paid state. It is not an authentication-flow or payment test.
 */
async function provisionDurableSession(pool, input) {
  const credentials = require('../../src/auth/credentials');
  const membershipId = input.membershipId || crypto.randomUUID();
  const sessionId = input.sessionId || crypto.randomUUID();
  const csrfToken = input.csrfToken || crypto.randomBytes(32).toString('base64url');
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const refreshExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const activeProfile = await pool.query(
    `SELECT id FROM canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE
      ORDER BY created_at DESC LIMIT 1`,
    [input.organizationId]
  );
  const profileId = activeProfile.rows[0] && activeProfile.rows[0].id;
  const onboardingStatus = input.onboardingStatus || (profileId ? 'complete' : 'business_profile_required');

  await pool.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id) DO UPDATE
       SET role = EXCLUDED.role, status = EXCLUDED.status, revoked_at = NULL, updated_at = NOW()
     RETURNING id`,
    [membershipId, input.organizationId, input.userId, input.role, input.membershipStatus || 'active']
  );
  const membership = await pool.query(
    'SELECT id FROM organization_memberships WHERE user_id = $1',
    [input.userId]
  );
  await pool.query(
    `INSERT INTO organization_onboarding (
       organization_id, status, active_business_profile_id, completed_at
     ) VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id) DO UPDATE SET
       status = EXCLUDED.status,
       active_business_profile_id = EXCLUDED.active_business_profile_id,
       completed_at = EXCLUDED.completed_at,
       updated_at = NOW()`,
    [
      input.organizationId,
      onboardingStatus,
      onboardingStatus === 'complete' ? profileId : null,
      onboardingStatus === 'complete' ? new Date() : null,
    ]
  );
  await pool.query(
    `INSERT INTO subscriptions (
       id, organization_id, plan_type, status, trial_started_at, trial_ends_at
     ) VALUES ($1,$2,'Test fixture',$3,NULL,NULL)
     ON CONFLICT (organization_id) DO UPDATE SET
       plan_type = EXCLUDED.plan_type,
       status = EXCLUDED.status,
       trial_started_at = NULL,
       trial_ends_at = NULL,
       updated_at = NOW()`,
    [crypto.randomUUID(), input.organizationId, input.subscriptionStatus || 'active']
  );
  await pool.query(
    `INSERT INTO auth_sessions (
       id, user_id, organization_id, membership_id, access_expires_at,
       refresh_expires_at, csrf_token_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      sessionId,
      input.userId,
      input.organizationId,
      membership.rows[0].id,
      accessExpiresAt,
      refreshExpiresAt,
      credentials.hashToken(csrfToken),
    ]
  );

  const accessToken = credentials.signAccess(input.userId, sessionId);
  const cookies = {
    [credentials.ACCESS_COOKIE]: accessToken,
    [credentials.CSRF_COOKIE]: csrfToken,
  };
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  return {
    accessToken,
    csrfToken,
    sessionId,
    cookies,
    headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken },
  };
}

module.exports = { provisionDurableSession };
