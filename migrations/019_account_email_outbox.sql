-- Mission 20 Phase 7 Lane 2 - source-aware login throttling and durable
-- account verification/recovery delivery authority.

ALTER TABLE auth_rate_limits
  DROP CONSTRAINT IF EXISTS auth_rate_limits_event_check;
ALTER TABLE auth_rate_limits
  ADD CONSTRAINT auth_rate_limits_event_check CHECK (
    event_type IN (
      'login_ip', 'login_email', 'login_source_email', 'signup_ip',
      'verification_ip', 'verification_user', 'forgot_ip', 'reset_ip',
      'workforce_invite_ip', 'workforce_accept_ip'
    )
  );

ALTER TABLE account_action_tokens
  ADD CONSTRAINT account_action_tokens_outbox_identity
  UNIQUE (id, user_id, organization_id, purpose);

CREATE TABLE account_email_outbox (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  raw_token VARCHAR(43),
  state VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  dead_at TIMESTAMPTZ,
  last_error_category VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_email_outbox_tenant_user_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT account_email_outbox_token_identity_fk
    FOREIGN KEY (id, user_id, organization_id, purpose)
    REFERENCES account_action_tokens(id, user_id, organization_id, purpose) ON DELETE RESTRICT,
  CONSTRAINT account_email_outbox_purpose_check CHECK (
    purpose IN ('email_verification', 'password_reset')
  ),
  CONSTRAINT account_email_outbox_recipient_check CHECK (
    recipient = lower(btrim(recipient))
    AND octet_length(recipient) BETWEEN 3 AND 254
    AND recipient !~ '[[:cntrl:]]'
  ),
  CONSTRAINT account_email_outbox_token_check CHECK (
    raw_token IS NULL OR raw_token ~ '^[A-Za-z0-9_-]{43}$'
  ),
  CONSTRAINT account_email_outbox_state_check CHECK (
    state IN ('pending', 'claimed', 'retry', 'delivered', 'dead')
  ),
  CONSTRAINT account_email_outbox_attempt_check CHECK (
    attempt_count BETWEEN 0 AND 5
  ),
  CONSTRAINT account_email_outbox_error_check CHECK (
    last_error_category IS NULL OR last_error_category ~ '^[a-z0-9_]{1,64}$'
  ),
  CONSTRAINT account_email_outbox_lifecycle_check CHECK (
    (state IN ('pending', 'retry')
      AND raw_token IS NOT NULL
      AND claimed_at IS NULL AND claim_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NULL AND dead_at IS NULL)
    OR
    (state = 'claimed'
      AND raw_token IS NOT NULL
      AND claimed_at IS NOT NULL AND claim_token IS NOT NULL AND lease_expires_at > claimed_at
      AND delivered_at IS NULL AND dead_at IS NULL)
    OR
    (state = 'delivered'
      AND raw_token IS NULL
      AND claimed_at IS NULL AND claim_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NOT NULL AND dead_at IS NULL)
    OR
    (state = 'dead'
      AND raw_token IS NULL
      AND claimed_at IS NULL AND claim_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NULL AND dead_at IS NOT NULL)
  )
);

CREATE INDEX account_email_outbox_available
  ON account_email_outbox(available_at, created_at, id)
  WHERE state IN ('pending', 'retry');

CREATE INDEX account_email_outbox_expired_claims
  ON account_email_outbox(lease_expires_at, id)
  WHERE state = 'claimed';

CREATE INDEX account_email_outbox_user_purpose
  ON account_email_outbox(user_id, purpose, created_at DESC, id);
