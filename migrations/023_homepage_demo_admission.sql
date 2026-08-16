-- Homepage browser Web Call admission is durable and provider-global without
-- persisting raw source addresses, transcript content, or browser results.
CREATE TABLE homepage_demo_admission_windows (
  window_start TIMESTAMPTZ NOT NULL,
  scope VARCHAR(32) NOT NULL,
  subject_hash CHAR(64) NOT NULL,
  request_count SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT homepage_demo_admission_windows_pkey
    PRIMARY KEY (window_start, scope, subject_hash),
  CONSTRAINT homepage_demo_admission_windows_scope_check
    CHECK (scope IN (
      'source_hour',
      'global_minute',
      'projection_source_minute',
      'projection_global_minute',
      'purge_source_minute',
      'purge_global_minute'
    )),
  CONSTRAINT homepage_demo_admission_windows_subject_hash_check
    CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT homepage_demo_admission_windows_count_check
    CHECK (request_count BETWEEN 1 AND 32767),
  CONSTRAINT homepage_demo_admission_windows_time_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX homepage_demo_admission_windows_expiry
  ON homepage_demo_admission_windows (window_start);

-- A verified purge capability receives one short-lived durable execution
-- lease. Only its keyed digest and operational timestamps are stored; call
-- identifiers, raw tokens, source addresses, transcripts, and results are not.
CREATE TABLE homepage_demo_purge_operations (
  capability_hash CHAR(64) PRIMARY KEY,
  state VARCHAR(16) NOT NULL,
  attempt_count SMALLINT NOT NULL DEFAULT 1,
  lease_expires_at TIMESTAMPTZ,
  authority_expires_at TIMESTAMPTZ NOT NULL,
  retire_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT homepage_demo_purge_operations_hash_check
    CHECK (capability_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT homepage_demo_purge_operations_state_check
    CHECK (state IN ('in_progress', 'verified')),
  CONSTRAINT homepage_demo_purge_operations_attempt_check
    CHECK (attempt_count BETWEEN 1 AND 3),
  CONSTRAINT homepage_demo_purge_operations_lifecycle_check
    CHECK (
      (state = 'in_progress' AND lease_expires_at IS NOT NULL AND verified_at IS NULL) OR
      (state = 'verified' AND lease_expires_at IS NULL AND verified_at IS NOT NULL)
    ),
  CONSTRAINT homepage_demo_purge_operations_time_check
    CHECK (
      authority_expires_at > created_at AND
      retire_at > authority_expires_at AND
      updated_at >= created_at AND
      (verified_at IS NULL OR (verified_at >= created_at AND updated_at >= verified_at))
    )
);

CREATE INDEX homepage_demo_purge_operations_retirement
  ON homepage_demo_purge_operations (retire_at);
