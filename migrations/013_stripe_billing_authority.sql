-- Account Lifecycle PR B2 - Stripe billing evidence and replay-safe authority.
-- Transaction body only: src/db.js owns BEGIN/COMMIT and the advisory lock.

DO $$
DECLARE
  collision TEXT;
BEGIN
  SELECT string_agg(provider_id, ', ' ORDER BY provider_id)
    INTO collision
    FROM (
      SELECT stripe_customer_id AS provider_id
        FROM subscriptions
       WHERE stripe_customer_id IS NOT NULL
       GROUP BY stripe_customer_id
      HAVING count(*) > 1
      UNION ALL
      SELECT stripe_subscription_id AS provider_id
        FROM subscriptions
       WHERE stripe_subscription_id IS NOT NULL
       GROUP BY stripe_subscription_id
      HAVING count(*) > 1
    ) duplicates;
  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'Stripe provider object has multiple organization owners'
      USING DETAIL = collision,
            HINT = 'Resolve historical provider ownership before Account Lifecycle PR B2.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM subscriptions
     WHERE (stripe_customer_id IS NOT NULL AND stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$')
        OR (stripe_subscription_id IS NOT NULL AND stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$')
  ) THEN
    RAISE EXCEPTION 'subscriptions contains malformed Stripe provider identity';
  END IF;
END;
$$;

ALTER TABLE subscriptions
  ALTER COLUMN current_period_start TYPE TIMESTAMPTZ
    USING current_period_start AT TIME ZONE 'UTC',
  ALTER COLUMN current_period_end TYPE TIMESTAMPTZ
    USING current_period_end AT TIME ZONE 'UTC',
  ALTER COLUMN canceled_at TYPE TIMESTAMPTZ
    USING canceled_at AT TIME ZONE 'UTC',
  ADD COLUMN billing_plan_key VARCHAR(32),
  ADD COLUMN billing_authority_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN last_checkout_event_created_at TIMESTAMPTZ,
  ADD COLUMN last_subscription_event_created_at TIMESTAMPTZ,
  ADD COLUMN last_invoice_event_created_at TIMESTAMPTZ,
  ADD COLUMN last_provider_event_id VARCHAR(255);

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_billing_plan_key_check CHECK (
    billing_plan_key IS NULL OR billing_plan_key IN ('starter', 'professional', 'enterprise')
  ),
  ADD CONSTRAINT subscriptions_stripe_customer_format_check CHECK (
    stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'
  ),
  ADD CONSTRAINT subscriptions_stripe_subscription_format_check CHECK (
    stripe_subscription_id IS NULL OR stripe_subscription_id ~ '^sub_[A-Za-z0-9_]+$'
  ),
  ADD CONSTRAINT subscriptions_cancel_provider_check CHECK (
    cancel_at_period_end = FALSE OR stripe_subscription_id IS NOT NULL
  ),
  ADD CONSTRAINT subscriptions_verified_billing_check CHECK (
    billing_authority_verified = FALSE OR (
      status IN ('active', 'past_due', 'canceled')
      AND billing_plan_key IS NOT NULL
      AND stripe_customer_id IS NOT NULL
      AND stripe_subscription_id IS NOT NULL
      AND current_period_start IS NOT NULL
      AND current_period_end IS NOT NULL
      AND current_period_end > current_period_start
    )
  );

CREATE UNIQUE INDEX subscriptions_one_stripe_customer_owner
  ON subscriptions(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX subscriptions_one_stripe_subscription_owner
  ON subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE billing_provider_operations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  operation_type VARCHAR(32) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  idempotency_key VARCHAR(96) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL,
  provider_object_id VARCHAR(255),
  provider_redirect_url VARCHAR(2048),
  failure_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT billing_provider_operations_type_check CHECK (operation_type = 'checkout'),
  CONSTRAINT billing_provider_operations_status_check CHECK (
    status IN ('requested', 'accepted', 'indeterminate', 'rejected', 'completed', 'expired')
  ),
  CONSTRAINT billing_provider_operations_accepted_result_check CHECK (
    status <> 'accepted' OR (provider_object_id IS NOT NULL AND provider_redirect_url IS NOT NULL)
  ),
  CONSTRAINT billing_provider_operations_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT billing_provider_operations_key_check CHECK (idempotency_key ~ '^northstar-b2-[0-9a-f]{64}$'),
  CONSTRAINT billing_provider_operations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT billing_provider_operations_actor_fk FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX billing_provider_operations_one_checkout
  ON billing_provider_operations(organization_id, operation_type)
  WHERE status IN ('requested', 'accepted', 'indeterminate');

CREATE INDEX billing_provider_operations_expiry
  ON billing_provider_operations(expires_at)
  WHERE status IN ('requested', 'accepted', 'indeterminate');

CREATE TABLE billing_webhook_events (
  provider_event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(128) NOT NULL,
  event_created_at TIMESTAMPTZ NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  processing_status VARCHAR(32) NOT NULL,
  result_code VARCHAR(64) NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT billing_webhook_events_id_check CHECK (provider_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  CONSTRAINT billing_webhook_events_hash_check CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT billing_webhook_events_status_check CHECK (
    processing_status IN ('processing', 'processed', 'ignored')
  )
);

CREATE INDEX billing_webhook_events_created
  ON billing_webhook_events(event_created_at, provider_event_id);

CREATE TABLE billing_invoice_reconciliation (
  provider_invoice_id VARCHAR(255) PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  provider_customer_id VARCHAR(255) NOT NULL,
  provider_subscription_id VARCHAR(255) NOT NULL,
  billing_plan_key VARCHAR(32) NOT NULL,
  payment_status VARCHAR(32) NOT NULL,
  currency CHAR(3) NOT NULL,
  base_amount_cents BIGINT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  last_event_created_at TIMESTAMPTZ NOT NULL,
  last_provider_event_id VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT billing_invoice_id_check CHECK (provider_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  CONSTRAINT billing_invoice_customer_check CHECK (provider_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  CONSTRAINT billing_invoice_subscription_check CHECK (provider_subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  CONSTRAINT billing_invoice_plan_check CHECK (
    billing_plan_key IN ('starter', 'professional', 'enterprise')
  ),
  CONSTRAINT billing_invoice_status_check CHECK (payment_status IN ('paid', 'payment_failed')),
  CONSTRAINT billing_invoice_currency_check CHECK (currency = 'usd'),
  CONSTRAINT billing_invoice_amount_check CHECK (base_amount_cents > 0),
  CONSTRAINT billing_invoice_period_check CHECK (period_end > period_start)
);

CREATE INDEX billing_invoice_reconciliation_org_period
  ON billing_invoice_reconciliation(organization_id, period_end DESC);
