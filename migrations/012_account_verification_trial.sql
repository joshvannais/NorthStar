-- Account Lifecycle PR B1 - verification, recovery, and organization trial authority.
-- Transaction body only: src/db.js owns BEGIN/COMMIT and the advisory lock.

DO $$
DECLARE
  collision TEXT;
BEGIN
  SELECT string_agg(organization_id::text, ', ' ORDER BY organization_id::text)
    INTO collision
    FROM (
      SELECT organization_id
        FROM subscriptions
       GROUP BY organization_id
      HAVING count(*) > 1
    ) duplicates;
  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'organization has multiple subscription rows'
      USING DETAIL = collision,
            HINT = 'Resolve historical subscription ownership before Account Lifecycle PR B1.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM subscriptions
     WHERE status NOT IN ('trial', 'active', 'past_due', 'canceled', 'expired')
  ) THEN
    RAISE EXCEPTION 'subscriptions contains an unsupported legacy state';
  END IF;
END;
$$;

DROP INDEX IF EXISTS subscriptions_one_current_per_organization;

ALTER TABLE subscriptions
  RENAME COLUMN trial_ends TO trial_ends_at;

ALTER TABLE subscriptions
  ALTER COLUMN trial_ends_at DROP DEFAULT,
  ALTER COLUMN trial_ends_at DROP NOT NULL,
  ALTER COLUMN trial_ends_at TYPE TIMESTAMPTZ
    USING trial_ends_at AT TIME ZONE 'UTC',
  ADD COLUMN trial_started_at TIMESTAMPTZ;

-- No pre-B1 row receives a fresh or continuing trial. Legacy `trial` rows are
-- relabeled as restricted records without inventing a start or changing their
-- historical timestamps. Paid labels and all paid-period fields are preserved
-- for future signed Stripe reconciliation. B1 never creates paid labels.
UPDATE subscriptions
   SET status = 'expired',
       updated_at = NOW()
 WHERE status = 'trial';

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check CHECK (
    status IN ('pending_verification', 'trialing', 'expired', 'active', 'past_due', 'canceled')
  );

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_trial_window_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_trial_window_check CHECK (
    (status = 'pending_verification' AND trial_started_at IS NULL AND trial_ends_at IS NULL)
    OR (status = 'trialing' AND trial_started_at IS NOT NULL
        AND trial_ends_at = trial_started_at + INTERVAL '14 days')
    -- Restricted legacy rows may retain a historical end without an inferred
    -- start. They never grant access; new B1 expirations retain an exact pair.
    OR status = 'expired'
    OR status IN ('active', 'past_due', 'canceled')
  );

CREATE UNIQUE INDEX subscriptions_one_per_organization
  ON subscriptions(organization_id);

CREATE INDEX subscriptions_state_trial_end
  ON subscriptions(status, trial_ends_at)
  WHERE status IN ('pending_verification', 'trialing', 'expired');

CREATE TABLE account_action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  purpose VARCHAR(32) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  superseded_by_token_id UUID REFERENCES account_action_tokens(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT account_action_tokens_purpose_check CHECK (
    purpose IN ('email_verification', 'password_reset')
  ),
  CONSTRAINT account_action_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT account_action_tokens_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT account_action_tokens_terminal_check CHECK (
    NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT account_action_tokens_supersession_check CHECK (
    superseded_by_token_id IS NULL OR revoked_at IS NOT NULL
  ),
  CONSTRAINT account_action_tokens_tenant_user_fk FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX account_action_tokens_one_current
  ON account_action_tokens(user_id, purpose)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX account_action_tokens_expiry_cleanup
  ON account_action_tokens(purpose, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE auth_rate_limits
  DROP CONSTRAINT IF EXISTS auth_rate_limits_event_check;
ALTER TABLE auth_rate_limits
  ADD CONSTRAINT auth_rate_limits_event_check CHECK (
    event_type IN (
      'login_ip', 'login_email', 'signup_ip', 'verification_ip',
      'verification_user', 'forgot_ip', 'reset_ip'
    )
  );
