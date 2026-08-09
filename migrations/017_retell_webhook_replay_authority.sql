-- Mission 20 Phase 6A - provider-global Retell webhook replay authority.
-- The claim precedes JSON parsing, so tenant identity is intentionally absent.
-- Only a domain-separated request fingerprint and bounded claim lifecycle are
-- retained; raw payloads, signatures, API keys, and provider identifiers are not.

CREATE TABLE retell_webhook_replay_claims (
  request_fingerprint CHAR(64) PRIMARY KEY,
  state VARCHAR(16) NOT NULL,
  claim_token UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retell_webhook_replay_fingerprint_check CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT retell_webhook_replay_state_check CHECK (
    state IN ('claimed', 'accepted')
  ),
  CONSTRAINT retell_webhook_replay_lifecycle_check CHECK (
    (
      state = 'claimed'
      AND lease_expires_at IS NOT NULL
      AND accepted_at IS NULL
      AND lease_expires_at > claimed_at
      AND expires_at >= lease_expires_at
    )
    OR (
      state = 'accepted'
      AND lease_expires_at IS NULL
      AND accepted_at IS NOT NULL
      AND accepted_at >= claimed_at
      AND expires_at > accepted_at
    )
  )
);

CREATE INDEX retell_webhook_replay_claims_expiry
  ON retell_webhook_replay_claims(expires_at, request_fingerprint);
