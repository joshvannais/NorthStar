-- Durable, opaque, single-use OAuth authorization state.
-- The production migration runner owns the surrounding transaction.

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_organization_user_identity
  UNIQUE (organization_id, user_id, id);

CREATE TABLE oauth_authorization_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(32) NOT NULL,
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  auth_session_id UUID NOT NULL,
  state_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  consumed_at TIMESTAMPTZ,
  CONSTRAINT oauth_authorization_states_hash_unique UNIQUE (state_hash),
  CONSTRAINT oauth_authorization_states_provider_check CHECK (
    provider ~ '^[a-z][a-z0-9_-]{0,31}$'
  ),
  CONSTRAINT oauth_authorization_states_hash_check CHECK (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT oauth_authorization_states_expiry_check CHECK (
    expires_at = created_at + INTERVAL '10 minutes'
  ),
  CONSTRAINT oauth_authorization_states_status_check CHECK (
    (status = 'pending' AND consumed_at IS NULL)
    OR
    (status = 'consumed' AND consumed_at IS NOT NULL
      AND consumed_at >= created_at AND consumed_at <= expires_at)
  ),
  CONSTRAINT oauth_authorization_states_session_fk FOREIGN KEY (
    organization_id, user_id, auth_session_id
  ) REFERENCES auth_sessions (organization_id, user_id, id) ON DELETE RESTRICT
);

CREATE INDEX oauth_authorization_states_pending_expiry
  ON oauth_authorization_states (expires_at, id)
  WHERE status = 'pending';

CREATE INDEX oauth_authorization_states_consumed_cleanup
  ON oauth_authorization_states (consumed_at, id)
  WHERE status = 'consumed';

CREATE INDEX oauth_authorization_states_organization_provider
  ON oauth_authorization_states (organization_id, provider, created_at DESC);
