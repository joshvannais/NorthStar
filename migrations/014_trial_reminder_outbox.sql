-- Account Lifecycle - durable trial-ending reminder authority.
-- Transaction body only: src/db.js owns BEGIN/COMMIT and the advisory lock.
--
-- Release order is a hard gate: reviewed migration 013 must be present and
-- applied before this migration is merged or deployed. The table below is
-- intentionally independent of migration 013's Stripe schema so this slice can
-- be reviewed and exercised on disposable PostgreSQL without copying 013.

CREATE TABLE trial_reminder_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  trial_ends_at TIMESTAMPTZ NOT NULL,
  threshold_days SMALLINT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  recipient_sha256 CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  terminal_code VARCHAR(64),
  provider_message_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT trial_reminder_threshold_check CHECK (threshold_days IN (7, 3, 1)),
  CONSTRAINT trial_reminder_schedule_check CHECK (
    scheduled_for = trial_ends_at - ((threshold_days * 24) * INTERVAL '1 hour')
  ),
  CONSTRAINT trial_reminder_recipient_hash_check CHECK (
    recipient_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trial_reminder_status_check CHECK (
    status IN ('pending', 'leased', 'sent', 'canceled', 'failed')
  ),
  CONSTRAINT trial_reminder_attempt_check CHECK (attempt_count BETWEEN 0 AND 4),
  CONSTRAINT trial_reminder_terminal_code_check CHECK (
    terminal_code IS NULL OR terminal_code ~ '^[a-z0-9_]{1,64}$'
  ),
  CONSTRAINT trial_reminder_provider_id_check CHECK (
    provider_message_id IS NULL OR provider_message_id ~ '^[A-Za-z0-9_-]{1,128}$'
  ),
  CONSTRAINT trial_reminder_state_shape_check CHECK (
    (status = 'pending'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND sent_at IS NULL AND canceled_at IS NULL AND failed_at IS NULL
      AND terminal_code IS NULL AND provider_message_id IS NULL)
    OR (status = 'leased'
      AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND sent_at IS NULL AND canceled_at IS NULL AND failed_at IS NULL
      AND terminal_code IS NULL AND provider_message_id IS NULL)
    OR (status = 'sent'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND sent_at IS NOT NULL AND canceled_at IS NULL AND failed_at IS NULL
      AND terminal_code = 'accepted' AND provider_message_id IS NOT NULL)
    OR (status = 'canceled'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND sent_at IS NULL AND canceled_at IS NOT NULL AND failed_at IS NULL
      AND terminal_code IS NOT NULL AND provider_message_id IS NULL)
    OR (status = 'failed'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND sent_at IS NULL AND canceled_at IS NULL AND failed_at IS NOT NULL
      AND terminal_code IS NOT NULL AND provider_message_id IS NULL)
  ),
  CONSTRAINT trial_reminder_generation_unique UNIQUE (
    organization_id, subscription_id, trial_ends_at, threshold_days, recipient_sha256
  )
);

CREATE UNIQUE INDEX trial_reminder_one_live_or_sent_generation
  ON trial_reminder_outbox(
    organization_id, subscription_id, trial_ends_at, threshold_days
  )
  WHERE status IN ('pending', 'leased', 'sent');

CREATE INDEX trial_reminder_due_claim
  ON trial_reminder_outbox(next_attempt_at, scheduled_for, id)
  WHERE status = 'pending';

CREATE INDEX trial_reminder_expired_lease
  ON trial_reminder_outbox(lease_expires_at, id)
  WHERE status = 'leased';

CREATE INDEX trial_reminder_subscription_authority
  ON trial_reminder_outbox(subscription_id, trial_ends_at, status);
