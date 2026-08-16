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
