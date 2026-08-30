-- Pre-Mission-23 Package 2 - durable tenant-scoped bug-report authority.
-- Email forwarding is an outbox notification; PostgreSQL remains canonical.

CREATE TABLE support_cases (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  created_by_user_id UUID NOT NULL,
  case_number VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(512) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received',
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT support_cases_tenant_identity_unique UNIQUE (organization_id, id),
  CONSTRAINT support_cases_idempotency_unique
    UNIQUE (organization_id, created_by_user_id, idempotency_key_hash),
  CONSTRAINT support_cases_actor_fk
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT support_cases_reference_check CHECK (case_number ~ '^NS-BUG-[0-9A-F]{32}$'),
  CONSTRAINT support_cases_title_check CHECK (
    title = btrim(title) AND octet_length(title) BETWEEN 1 AND 512
    AND title !~ '[[:cntrl:]]'
  ),
  CONSTRAINT support_cases_description_check CHECK (
    description = btrim(description) AND octet_length(description) BETWEEN 1 AND 12000
    AND regexp_replace(description, E'[\n\r\t]', '', 'g') !~ '[[:cntrl:]]'
  ),
  CONSTRAINT support_cases_status_check CHECK (
    status IN ('received', 'investigating', 'fix_prepared', 'resolved', 'closed')
  ),
  CONSTRAINT support_cases_digest_check CHECK (
    idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT support_cases_time_check CHECK (updated_at >= created_at)
);

CREATE INDEX support_cases_tenant_history
  ON support_cases(organization_id, created_at DESC, id DESC);
CREATE INDEX support_cases_actor_rate
  ON support_cases(organization_id, created_by_user_id, created_at DESC);

CREATE TABLE support_case_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  case_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  customer_state VARCHAR(32) NOT NULL,
  customer_message VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT support_case_events_case_fk
    FOREIGN KEY (organization_id, case_id)
    REFERENCES support_cases(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT support_case_events_actor_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT support_case_events_type_check CHECK (
    event_type IN ('case_received', 'status_changed')
  ),
  CONSTRAINT support_case_events_state_check CHECK (
    customer_state IN ('received', 'investigating', 'fix_prepared', 'resolved', 'closed')
  ),
  CONSTRAINT support_case_events_message_check CHECK (
    customer_message = btrim(customer_message)
    AND octet_length(customer_message) BETWEEN 1 AND 1000
    AND regexp_replace(customer_message, E'[\n\r\t]', '', 'g') !~ '[[:cntrl:]]'
  )
);

CREATE INDEX support_case_events_tenant_history
  ON support_case_events(organization_id, case_id, created_at, id);

CREATE TABLE support_case_attachments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  case_id UUID NOT NULL,
  uploaded_by_user_id UUID NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  media_type VARCHAR(32) NOT NULL,
  original_size INTEGER NOT NULL,
  stored_size INTEGER NOT NULL,
  original_sha256 CHAR(64) NOT NULL,
  stored_sha256 CHAR(64) NOT NULL,
  image_width INTEGER NOT NULL,
  image_height INTEGER NOT NULL,
  image_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT support_case_attachments_one_per_case UNIQUE (organization_id, case_id),
  CONSTRAINT support_case_attachments_case_fk
    FOREIGN KEY (organization_id, case_id)
    REFERENCES support_cases(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT support_case_attachments_actor_fk
    FOREIGN KEY (organization_id, uploaded_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT support_case_attachments_filename_check CHECK (
    original_filename = btrim(original_filename)
    AND octet_length(original_filename) BETWEEN 1 AND 255
    AND original_filename !~ '[[:cntrl:]/\\]'
  ),
  CONSTRAINT support_case_attachments_media_check CHECK (
    media_type IN ('image/png', 'image/jpeg', 'image/webp')
  ),
  CONSTRAINT support_case_attachments_size_check CHECK (
    original_size BETWEEN 1 AND 5242880
    AND stored_size BETWEEN 1 AND 5242880
    AND stored_size <= original_size
    AND stored_size = octet_length(image_bytes)
  ),
  CONSTRAINT support_case_attachments_digest_check CHECK (
    original_sha256 ~ '^[0-9a-f]{64}$' AND stored_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT support_case_attachments_dimensions_check CHECK (
    image_width BETWEEN 1 AND 8192 AND image_height BETWEEN 1 AND 8192
    AND image_width::bigint * image_height::bigint <= 33554432
  )
);

CREATE TABLE support_case_email_outbox (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  case_id UUID NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  claimed_at TIMESTAMPTZ,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  dead_at TIMESTAMPTZ,
  last_error_category VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT support_case_email_outbox_one_per_case UNIQUE (organization_id, case_id),
  CONSTRAINT support_case_email_outbox_case_fk
    FOREIGN KEY (organization_id, case_id)
    REFERENCES support_cases(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT support_case_email_outbox_state_check CHECK (
    state IN ('pending', 'claimed', 'retry', 'delivered', 'unavailable', 'dead')
  ),
  CONSTRAINT support_case_email_outbox_attempt_check CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT support_case_email_outbox_error_check CHECK (
    last_error_category IS NULL OR last_error_category ~ '^[a-z0-9_]{1,64}$'
  ),
  CONSTRAINT support_case_email_outbox_lifecycle_check CHECK (
    (state IN ('pending', 'retry', 'unavailable')
      AND claimed_at IS NULL AND claim_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NULL AND dead_at IS NULL)
    OR
    (state = 'claimed'
      AND claimed_at IS NOT NULL AND claim_token IS NOT NULL AND lease_expires_at > claimed_at
      AND delivered_at IS NULL AND dead_at IS NULL)
    OR
    (state = 'delivered'
      AND claimed_at IS NULL AND claim_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NOT NULL AND dead_at IS NULL)
    OR
    (state = 'dead'
      AND claimed_at IS NULL AND claim_token IS NULL AND lease_expires_at IS NULL
      AND delivered_at IS NULL AND dead_at IS NOT NULL)
  )
);

CREATE INDEX support_case_email_outbox_available
  ON support_case_email_outbox(available_at, created_at, id)
  WHERE state IN ('pending', 'retry', 'unavailable');
CREATE INDEX support_case_email_outbox_expired_claims
  ON support_case_email_outbox(lease_expires_at, id)
  WHERE state = 'claimed';

CREATE FUNCTION support_case_immutable_evidence_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $support_case_immutable$
BEGIN
  RAISE EXCEPTION 'support case evidence is immutable'
    USING ERRCODE = '55000', CONSTRAINT = 'support_case_immutable_evidence';
END
$support_case_immutable$;

CREATE TRIGGER support_case_events_immutable
  BEFORE UPDATE OR DELETE ON support_case_events
  FOR EACH ROW EXECUTE FUNCTION support_case_immutable_evidence_guard();
CREATE TRIGGER support_case_attachments_immutable
  BEFORE UPDATE OR DELETE ON support_case_attachments
  FOR EACH ROW EXECUTE FUNCTION support_case_immutable_evidence_guard();

REVOKE ALL ON FUNCTION support_case_immutable_evidence_guard() FROM PUBLIC;
