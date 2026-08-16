-- Demo/Paid Command Center Parity Prelude: isolated durable public demo state.
--
-- The opaque browser token is never persisted. Only its SHA-256 digest binds a
-- fictional tenant to one bounded session. Public GETs remain projection-only;
-- a row is created only when the visitor explicitly simulates or resets.

CREATE TABLE demo_command_center_sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL UNIQUE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  state JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  simulation_count SMALLINT NOT NULL DEFAULT 0,
  mutation_count SMALLINT NOT NULL DEFAULT 0,
  last_simulated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT demo_command_center_sessions_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT demo_command_center_sessions_state_check
    CHECK (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 524288),
  CONSTRAINT demo_command_center_sessions_revision_check
    CHECK (revision >= 1),
  CONSTRAINT demo_command_center_sessions_simulation_count_check
    CHECK (simulation_count BETWEEN 0 AND 12),
  CONSTRAINT demo_command_center_sessions_mutation_count_check
    CHECK (mutation_count BETWEEN 0 AND 24),
  CONSTRAINT demo_command_center_sessions_time_check
    CHECK (updated_at >= created_at AND updated_at < expires_at
      AND expires_at <= created_at + INTERVAL '24 hours')
);

CREATE INDEX demo_command_center_sessions_expiry
  ON demo_command_center_sessions (expires_at);

-- Public session creation is admitted through PostgreSQL, not process-local
-- memory. The source identifier is an HMAC digest; raw addresses are never
-- persisted. A separate global row bounds distributed allocation.
CREATE TABLE demo_command_center_admission_windows (
  window_start TIMESTAMPTZ NOT NULL,
  scope VARCHAR(16) NOT NULL,
  subject_hash CHAR(64) NOT NULL,
  request_count SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT demo_command_center_admission_windows_pkey
    PRIMARY KEY (window_start, scope, subject_hash),
  CONSTRAINT demo_command_center_admission_windows_scope_check
    CHECK (scope IN ('source', 'global')),
  CONSTRAINT demo_command_center_admission_windows_subject_hash_check
    CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT demo_command_center_admission_windows_count_check
    CHECK (request_count BETWEEN 1 AND 32767),
  CONSTRAINT demo_command_center_admission_windows_time_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX demo_command_center_admission_windows_expiry
  ON demo_command_center_admission_windows (window_start);

CREATE TABLE demo_command_center_mutations (
  session_id UUID NOT NULL,
  idempotency_hash CHAR(64) NOT NULL,
  operation VARCHAR(16) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  response_revision BIGINT NOT NULL,
  response_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT demo_command_center_mutations_pkey
    PRIMARY KEY (session_id, idempotency_hash),
  CONSTRAINT demo_command_center_mutations_session_fk
    FOREIGN KEY (session_id) REFERENCES demo_command_center_sessions(id) ON DELETE CASCADE,
  CONSTRAINT demo_command_center_mutations_idempotency_hash_check
    CHECK (idempotency_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT demo_command_center_mutations_operation_check
    CHECK (operation IN ('simulate_lead', 'reset')),
  CONSTRAINT demo_command_center_mutations_request_digest_check
    CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT demo_command_center_mutations_response_revision_check
    CHECK (response_revision >= 1),
  CONSTRAINT demo_command_center_mutations_response_digest_check
    CHECK (response_digest ~ '^[0-9a-f]{64}$')
);
