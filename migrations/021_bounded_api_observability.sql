-- Mission 20 Phase 7 Lane 5: fixed-cardinality anonymous API 404 observability.
--
-- One row per HTTP method class and UTC hour-of-day slot retains an actionable
-- rolling signal without persisting attacker-controlled paths, identifiers, or
-- one durable row per request. The primary key makes the hard maximum 192 rows;
-- each row stops changing at 1,000 observations in its one-hour window.

CREATE TABLE api_observability_hourly (
  event_key VARCHAR(64) NOT NULL,
  method_class VARCHAR(8) NOT NULL,
  bucket_slot SMALLINT NOT NULL,
  bucket_started_at TIMESTAMPTZ NOT NULL,
  request_count BIGINT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT api_observability_hourly_pkey
    PRIMARY KEY (event_key, method_class, bucket_slot),
  CONSTRAINT api_observability_hourly_event_key_check
    CHECK (event_key = 'anonymous_api_not_found'),
  CONSTRAINT api_observability_hourly_method_class_check
    CHECK (method_class IN ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER')),
  CONSTRAINT api_observability_hourly_bucket_slot_check
    CHECK (bucket_slot BETWEEN 0 AND 23),
  CONSTRAINT api_observability_hourly_request_count_check
    CHECK (request_count BETWEEN 1 AND 1000),
  CONSTRAINT api_observability_hourly_window_check
    CHECK (
      last_seen_at >= bucket_started_at
      AND last_seen_at < bucket_started_at + INTERVAL '1 hour'
    )
) WITH (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 32,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 32
);
