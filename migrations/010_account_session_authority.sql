-- Account Lifecycle PR A - PostgreSQL account, session, and onboarding authority.
-- This migration is intentionally additive and imports no filesystem data.

DO $$
DECLARE
  collision TEXT;
BEGIN
  SELECT string_agg(normalized_email, ', ' ORDER BY normalized_email)
    INTO collision
    FROM (
      SELECT lower(btrim(email)) AS normalized_email
        FROM users
       GROUP BY lower(btrim(email))
      HAVING count(*) > 1
    ) duplicates;
  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'account email normalization collision'
      USING DETAIL = collision, HINT = 'Resolve duplicate PostgreSQL users before applying migration 010.';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'users.organization_id contains NULL ownership'
      USING HINT = 'Assign explicit PostgreSQL organization ownership before applying migration 010.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM users
     WHERE length(btrim(email)) = 0 OR length(btrim(email)) > 254
  ) THEN
    RAISE EXCEPTION 'users.email contains an invalid normalized length'
      USING HINT = 'Account emails must be non-empty and at most 254 characters after trimming.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM users
     WHERE role NOT IN ('owner', 'admin', 'dispatcher', 'tech', 'member', 'viewer')
        OR status NOT IN ('pending_verification', 'active', 'suspended', 'disabled')
  ) THEN
    RAISE EXCEPTION 'users contains an unsupported role or status'
      USING HINT = 'Normalize PostgreSQL account roles and statuses before applying migration 010.';
  END IF;

  SELECT string_agg(organization_id::text, ', ' ORDER BY organization_id::text)
    INTO collision
    FROM (
      SELECT organization_id
        FROM subscriptions
       WHERE status IN ('trial', 'active', 'past_due')
       GROUP BY organization_id
      HAVING count(*) > 1
    ) duplicates;
  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'organization has multiple current subscriptions'
      USING DETAIL = collision, HINT = 'Resolve duplicate current subscriptions before applying migration 010.';
  END IF;
END;
$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_normalized VARCHAR(254);

UPDATE users
   SET email_normalized = lower(btrim(email))
 WHERE email_normalized IS NULL;

ALTER TABLE users
  ALTER COLUMN email_normalized SET NOT NULL,
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS account_users_email_normalized_check;
ALTER TABLE users ADD CONSTRAINT account_users_email_normalized_check CHECK (
  email_normalized = lower(btrim(email))
  AND length(email_normalized) BETWEEN 1 AND 254
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS account_users_role_check;
ALTER TABLE users ADD CONSTRAINT account_users_role_check CHECK (
  role IN ('owner', 'admin', 'dispatcher', 'tech', 'member', 'viewer')
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS account_users_status_check;
ALTER TABLE users ADD CONSTRAINT account_users_status_check CHECK (
  status IN ('pending_verification', 'active', 'suspended', 'disabled')
);

CREATE UNIQUE INDEX IF NOT EXISTS account_users_email_normalized_unique
  ON users(email_normalized);

CREATE OR REPLACE FUNCTION account_normalize_user_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email := btrim(NEW.email);
  NEW.email_normalized := lower(NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS account_users_normalize_email ON users;
CREATE TRIGGER account_users_normalize_email
  BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION account_normalize_user_email();

CREATE TABLE IF NOT EXISTS organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role VARCHAR(50) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT organization_memberships_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT organization_memberships_user_unique UNIQUE (user_id),
  CONSTRAINT organization_memberships_org_user_unique UNIQUE (organization_id, user_id),
  CONSTRAINT organization_memberships_role_check CHECK (
    role IN ('owner', 'admin', 'dispatcher', 'tech', 'member', 'viewer')
  ),
  CONSTRAINT organization_memberships_status_check CHECK (
    status IN ('active', 'suspended', 'revoked')
  ),
  CONSTRAINT organization_memberships_revocation_check CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL)
  )
);

INSERT INTO organization_memberships (organization_id, user_id, role, status)
SELECT organization_id, id, role,
       CASE WHEN status IN ('suspended', 'disabled') THEN 'suspended' ELSE 'active' END
  FROM users
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE subscriptions
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN trial_ends SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_current_per_organization
  ON subscriptions(organization_id)
  WHERE status IN ('trial', 'active', 'past_due');

-- No durable explicit-consent provenance exists for the legacy operational
-- notification booleans. Preserve the configured destinations, but make the
-- deterministic upgrade disposition opt-in by disabling every delivery type.
UPDATE notification_preferences
   SET email_new_lead = FALSE,
       email_call_summary = FALSE,
       email_appointment = FALSE,
       sms_new_lead = FALSE,
       sms_urgent = FALSE,
       notification_email = COALESCE(notification_email, ''),
       notification_phone = COALESCE(notification_phone, '');

ALTER TABLE notification_preferences
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN email_new_lead SET DEFAULT FALSE,
  ALTER COLUMN email_new_lead SET NOT NULL,
  ALTER COLUMN email_call_summary SET DEFAULT FALSE,
  ALTER COLUMN email_call_summary SET NOT NULL,
  ALTER COLUMN email_appointment SET DEFAULT FALSE,
  ALTER COLUMN email_appointment SET NOT NULL,
  ALTER COLUMN sms_new_lead SET DEFAULT FALSE,
  ALTER COLUMN sms_new_lead SET NOT NULL,
  ALTER COLUMN sms_urgent SET DEFAULT FALSE,
  ALTER COLUMN sms_urgent SET NOT NULL,
  ALTER COLUMN notification_email SET DEFAULT '',
  ALTER COLUMN notification_email SET NOT NULL,
  ALTER COLUMN notification_phone SET DEFAULT '',
  ALTER COLUMN notification_phone SET NOT NULL;

CREATE TABLE IF NOT EXISTS organization_account_preferences (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_account_preferences_object_check CHECK (jsonb_typeof(preferences) = 'object')
);

INSERT INTO organization_account_preferences (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- This generic JSON document retains only unrelated internal settings. It is
-- not an operational email/SMS authority and cannot acquire notification keys.
UPDATE organization_account_preferences
   SET preferences = preferences - ARRAY[
     'emailEnabled', 'emailCallSummary', 'emailAppointment', 'smsEnabled',
     'smsUrgent', 'emailAddress', 'smsNumber', 'email_new_lead',
     'email_call_summary', 'email_appointment', 'sms_new_lead', 'sms_urgent',
     'notification_email', 'notification_phone', 'notificationPreferences',
     'notifications'
   ]::TEXT[];

ALTER TABLE organization_account_preferences
  DROP CONSTRAINT IF EXISTS organization_account_preferences_no_notifications;
ALTER TABLE organization_account_preferences
  ADD CONSTRAINT organization_account_preferences_no_notifications CHECK (
    NOT (preferences ?| ARRAY[
      'emailEnabled', 'emailCallSummary', 'emailAppointment', 'smsEnabled',
      'smsUrgent', 'emailAddress', 'smsNumber', 'email_new_lead',
      'email_call_summary', 'email_appointment', 'sms_new_lead', 'sms_urgent',
      'notification_email', 'notification_phone', 'notificationPreferences',
      'notifications'
    ]::TEXT[])
  );

CREATE TABLE IF NOT EXISTS organization_onboarding (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  status VARCHAR(40) NOT NULL,
  active_business_profile_id UUID,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_onboarding_status_check CHECK (
    status IN ('pending_verification', 'business_profile_required', 'complete')
  ),
  CONSTRAINT organization_onboarding_profile_fk FOREIGN KEY
    (organization_id, active_business_profile_id)
    REFERENCES canonical_business_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT organization_onboarding_completion_check CHECK (
    (status = 'complete' AND active_business_profile_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'complete' AND completed_at IS NULL)
  )
);

INSERT INTO organization_onboarding (
  organization_id,
  status,
  active_business_profile_id,
  completed_at
)
SELECT organizations.id,
       CASE WHEN active_profile.id IS NULL THEN 'business_profile_required' ELSE 'complete' END,
       active_profile.id,
       CASE WHEN active_profile.id IS NULL THEN NULL ELSE NOW() END
  FROM organizations
  LEFT JOIN canonical_business_profiles active_profile
    ON active_profile.organization_id = organizations.id
   AND active_profile.is_active = TRUE
ON CONFLICT (organization_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  csrf_token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoke_reason VARCHAR(80),
  CONSTRAINT auth_sessions_status_check CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT auth_sessions_expiry_check CHECK (refresh_expires_at > access_expires_at),
  CONSTRAINT auth_sessions_csrf_hash_check CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_sessions_membership_fk FOREIGN KEY (organization_id, membership_id)
    REFERENCES organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT auth_sessions_revocation_check CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status <> 'active' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_status
  ON auth_sessions(user_id, status, refresh_expires_at);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  family_id UUID NOT NULL,
  parent_token_id UUID REFERENCES auth_refresh_tokens(id) ON DELETE RESTRICT,
  replaced_by_token_id UUID REFERENCES auth_refresh_tokens(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  token_hash CHAR(64) NOT NULL UNIQUE,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason VARCHAR(80),
  CONSTRAINT auth_refresh_tokens_status_check CHECK (
    status IN ('active', 'rotated', 'reused', 'revoked', 'expired')
  ),
  CONSTRAINT auth_refresh_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_refresh_tokens_rotation_check CHECK (
    (status = 'active' AND consumed_at IS NULL AND replaced_by_token_id IS NULL)
    OR (status = 'rotated' AND consumed_at IS NOT NULL AND replaced_by_token_id IS NOT NULL)
    OR status IN ('reused', 'revoked', 'expired')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_refresh_tokens_one_active_per_session
  ON auth_refresh_tokens(session_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_family_status
  ON auth_refresh_tokens(family_id, status, expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  event_type VARCHAR(32) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_type, key_hash),
  CONSTRAINT auth_rate_limits_event_check CHECK (event_type IN ('login_ip', 'login_email', 'signup_ip')),
  CONSTRAINT auth_rate_limits_hash_check CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_rate_limits_count_check CHECK (attempt_count >= 0)
);

-- Invalidate every token minted by the legacy, non-family refresh implementation.
UPDATE refresh_tokens
   SET revoked_at = COALESCE(revoked_at, NOW())
 WHERE revoked_at IS NULL;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_status_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_status_check CHECK (status IN ('active', 'disabled'));

-- Disable only the known source-seeded administrative identity.
UPDATE admin_users
   SET status = 'disabled', disabled_at = COALESCE(disabled_at, NOW())
 WHERE lower(btrim(email)) = 'admin@northstarsolutions.app'
   AND name = 'NorthStar Admin';

-- The legacy demo password is source-known. Demo access now requires separately
-- provisioned canonical_demo_authority and an independently provisioned account.
UPDATE users
   SET status = 'disabled', updated_at = NOW()
 WHERE id = '00000000-0000-0000-0000-000000000002'
   AND email_normalized = 'demo@northstarsolutions.app';

UPDATE organization_memberships
   SET status = 'suspended', updated_at = NOW()
 WHERE user_id = '00000000-0000-0000-0000-000000000002'
   AND status = 'active';
