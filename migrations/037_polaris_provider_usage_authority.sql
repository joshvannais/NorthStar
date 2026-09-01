-- Pre-Mission-23 P6 - durable, tenant-scoped Polaris provider spend authority.
-- Provider content is intentionally absent. Only bounded operational metadata
-- and monthly aggregate usage are persisted.

CREATE TABLE public.polaris_provider_monthly_usage (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  month_start DATE NOT NULL,
  collected_subscription_revenue_cents BIGINT NOT NULL DEFAULT 0,
  reserved_cost_nano_usd BIGINT NOT NULL DEFAULT 0,
  reconciled_cost_nano_usd BIGINT NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  completed_requests BIGINT NOT NULL DEFAULT 0,
  failed_requests BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, month_start),
  CONSTRAINT polaris_provider_month_start_check CHECK (month_start = date_trunc('month', month_start)::date),
  CONSTRAINT polaris_provider_monthly_nonnegative_check CHECK (
    collected_subscription_revenue_cents >= 0
    AND reserved_cost_nano_usd >= 0
    AND reconciled_cost_nano_usd >= 0
    AND input_tokens >= 0
    AND output_tokens >= 0
    AND completed_requests >= 0
    AND failed_requests >= 0
  )
);

CREATE TABLE public.polaris_provider_requests (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  request_id UUID NOT NULL,
  month_start DATE NOT NULL,
  model VARCHAR(64) NOT NULL,
  schema_version VARCHAR(128) NOT NULL,
  state VARCHAR(16) NOT NULL,
  reserved_cost_nano_usd BIGINT NOT NULL,
  actual_cost_nano_usd BIGINT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  attempt_count SMALLINT,
  outcome_class VARCHAR(32),
  provider_request_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT polaris_provider_request_actor_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT polaris_provider_request_month_fk
    FOREIGN KEY (organization_id, month_start)
    REFERENCES public.polaris_provider_monthly_usage(organization_id, month_start) ON DELETE RESTRICT,
  CONSTRAINT polaris_provider_request_idempotency_unique UNIQUE (organization_id, user_id, request_id),
  CONSTRAINT polaris_provider_request_model_check CHECK (model = 'gpt-5.6-luna'),
  CONSTRAINT polaris_provider_request_schema_check CHECK (
    schema_version = 'northstar.polaris.assistant-response.v1'
  ),
  CONSTRAINT polaris_provider_request_state_check CHECK (state IN ('reserved', 'completed', 'failed')),
  CONSTRAINT polaris_provider_request_reserve_check CHECK (reserved_cost_nano_usd = 20000000),
  CONSTRAINT polaris_provider_request_usage_check CHECK (
    (state = 'reserved'
      AND actual_cost_nano_usd IS NULL AND input_tokens IS NULL AND output_tokens IS NULL
      AND attempt_count IS NULL AND outcome_class IS NULL AND provider_request_id IS NULL
      AND completed_at IS NULL AND lease_expires_at > created_at)
    OR
    (state IN ('completed', 'failed')
      AND actual_cost_nano_usd BETWEEN 0 AND reserved_cost_nano_usd
      AND input_tokens BETWEEN 0 AND 16000
      AND output_tokens BETWEEN 0 AND 8192
      AND attempt_count BETWEEN 1 AND 2
      AND outcome_class IN ('completed', 'refused', 'incomplete', 'failed', 'ambiguous_timeout')
      AND completed_at IS NOT NULL AND completed_at >= created_at)
  )
);

CREATE INDEX polaris_provider_requests_tenant_rate
  ON public.polaris_provider_requests(organization_id, created_at DESC, id);
CREATE INDEX polaris_provider_requests_user_rate
  ON public.polaris_provider_requests(organization_id, user_id, created_at DESC, id);
CREATE INDEX polaris_provider_requests_active
  ON public.polaris_provider_requests(organization_id, lease_expires_at, id)
  WHERE state = 'reserved';
CREATE INDEX polaris_provider_requests_retention
  ON public.polaris_provider_requests(completed_at, id)
  WHERE state <> 'reserved';

CREATE TABLE public.polaris_provider_security_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  request_id UUID NOT NULL,
  event_class VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT polaris_provider_security_actor_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT polaris_provider_security_event_check CHECK (
    event_class IN (
      'idempotency_conflict', 'user_concurrency', 'tenant_concurrency',
      'user_minute_rate', 'user_hour_rate', 'user_day_rate',
      'tenant_minute_rate', 'tenant_hour_rate', 'tenant_day_rate',
      'tenant_spend_limit', 'project_spend_limit'
    )
  )
);

CREATE INDEX polaris_provider_security_events_retention
  ON public.polaris_provider_security_events(created_at, id);

CREATE FUNCTION public.polaris_provider_reserve_usage(
  requested_organization_id UUID,
  requested_user_id UUID,
  requested_request_id UUID,
  requested_model TEXT,
  requested_schema_version TEXT,
  requested_cost_nano_usd BIGINT
)
RETURNS TABLE (
  reservation_id UUID,
  admitted BOOLEAN,
  denial_code TEXT,
  retry_after_seconds INTEGER,
  reserved_cost_nano_usd BIGINT,
  tenant_spend_nano_usd BIGINT,
  tenant_target_nano_usd BIGINT,
  tenant_warning_nano_usd BIGINT,
  tenant_hard_nano_usd BIGINT,
  project_hard_nano_usd BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $polaris_provider_reserve$
DECLARE
  current_month DATE := date_trunc('month', clock_timestamp())::date;
  generated_reservation UUID := gen_random_uuid();
  revenue_cents BIGINT;
  tenant_spend BIGINT;
  project_spend BIGINT;
  target_cap BIGINT;
  warning_cap BIGINT;
  hard_cap BIGINT;
  project_cap BIGINT;
  expired_group RECORD;
  denial TEXT := NULL;
  retry_seconds INTEGER := NULL;
BEGIN
  IF requested_model <> 'gpt-5.6-luna'
     OR requested_schema_version <> 'northstar.polaris.assistant-response.v1'
     OR requested_cost_nano_usd <> 20000000 THEN
    RAISE EXCEPTION 'Unsupported Polaris provider reservation contract'
      USING ERRCODE = '22023', CONSTRAINT = 'polaris_provider_reservation_contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_memberships membership
      JOIN public.subscriptions subscription
        ON subscription.organization_id = membership.organization_id
     WHERE membership.organization_id = requested_organization_id
       AND membership.user_id = requested_user_id
       AND membership.status = 'active'
       AND membership.role IN ('owner', 'admin', 'member', 'viewer')
       AND subscription.plan_type IN ('Growth', 'Complete')
       AND subscription.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Polaris provider authority is unavailable for this actor'
      USING ERRCODE = '42501', CONSTRAINT = 'polaris_provider_actor_not_entitled';
  END IF;

  -- Lock project first and tenant second so every caller uses one deadlock-safe order.
  PERFORM pg_advisory_xact_lock(19000037::bigint);
  PERFORM pg_advisory_xact_lock(hashtextextended(requested_organization_id::text, 19000037));

  -- Ambiguous expired reservations are conservatively charged at the full reserve.
  FOR expired_group IN
    WITH expired AS (
      UPDATE public.polaris_provider_requests AS stale_request
         SET state = 'failed',
             actual_cost_nano_usd = stale_request.reserved_cost_nano_usd,
             input_tokens = 0,
             output_tokens = 0,
             attempt_count = 1,
             outcome_class = 'ambiguous_timeout',
             completed_at = clock_timestamp()
       WHERE stale_request.state = 'reserved' AND stale_request.lease_expires_at <= clock_timestamp()
       RETURNING stale_request.organization_id, stale_request.month_start,
                 stale_request.reserved_cost_nano_usd AS expired_reserved_cost_nano_usd
    )
    SELECT organization_id, month_start,
           sum(expired_reserved_cost_nano_usd)::bigint AS expired_cost,
           count(*)::bigint AS expired_count
      FROM expired
     GROUP BY organization_id, month_start
  LOOP
    UPDATE public.polaris_provider_monthly_usage AS expired_month
       SET reserved_cost_nano_usd = expired_month.reserved_cost_nano_usd - expired_group.expired_cost,
           reconciled_cost_nano_usd = expired_month.reconciled_cost_nano_usd + expired_group.expired_cost,
           failed_requests = expired_month.failed_requests + expired_group.expired_count,
           updated_at = transaction_timestamp()
     WHERE organization_id = expired_group.organization_id
       AND month_start = expired_group.month_start;
  END LOOP;

  DELETE FROM public.polaris_provider_requests
   WHERE state <> 'reserved' AND completed_at < clock_timestamp() - INTERVAL '30 days';
  DELETE FROM public.polaris_provider_security_events
   WHERE created_at < clock_timestamp() - INTERVAL '90 days';
  DELETE FROM public.polaris_provider_monthly_usage
   WHERE month_start < (current_month - INTERVAL '12 months')::date;

  INSERT INTO public.polaris_provider_monthly_usage(organization_id, month_start)
  VALUES (requested_organization_id, current_month)
  ON CONFLICT (organization_id, month_start) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM public.polaris_provider_requests request
     WHERE request.organization_id = requested_organization_id
       AND request.user_id = requested_user_id
       AND request.request_id = requested_request_id
  ) THEN
    denial := 'idempotency_conflict'; retry_seconds := 1;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id
            AND request.user_id = requested_user_id
            AND request.state = 'reserved' AND request.lease_expires_at > clock_timestamp()) >= 1 THEN
    denial := 'user_concurrency'; retry_seconds := 25;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id
            AND request.state = 'reserved' AND request.lease_expires_at > clock_timestamp()) >= 4 THEN
    denial := 'tenant_concurrency'; retry_seconds := 25;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
            AND request.created_at > clock_timestamp() - INTERVAL '1 minute') >= 12 THEN
    denial := 'user_minute_rate'; retry_seconds := 60;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
            AND request.created_at > clock_timestamp() - INTERVAL '1 hour') >= 120 THEN
    denial := 'user_hour_rate'; retry_seconds := 3600;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
            AND request.created_at > clock_timestamp() - INTERVAL '1 day') >= 600 THEN
    denial := 'user_day_rate'; retry_seconds := 86400;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id
            AND request.created_at > clock_timestamp() - INTERVAL '1 minute') >= 60 THEN
    denial := 'tenant_minute_rate'; retry_seconds := 60;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id
            AND request.created_at > clock_timestamp() - INTERVAL '1 hour') >= 600 THEN
    denial := 'tenant_hour_rate'; retry_seconds := 3600;
  ELSIF (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id
            AND request.created_at > clock_timestamp() - INTERVAL '1 day') >= 3000 THEN
    denial := 'tenant_day_rate'; retry_seconds := 86400;
  END IF;

  SELECT monthly.collected_subscription_revenue_cents,
         monthly.reserved_cost_nano_usd + monthly.reconciled_cost_nano_usd
    INTO revenue_cents, tenant_spend
    FROM public.polaris_provider_monthly_usage monthly
   WHERE monthly.organization_id = requested_organization_id
     AND monthly.month_start = current_month
   FOR UPDATE;
  target_cap := revenue_cents * 500000;
  warning_cap := revenue_cents * 1000000;
  hard_cap := revenue_cents * 2000000;

  SELECT GREATEST(
           100000000000::numeric,
           COALESCE(sum(monthly.collected_subscription_revenue_cents::numeric * 2000000), 0) * 1.10
         )::bigint
    INTO project_cap
    FROM public.polaris_provider_monthly_usage monthly
    JOIN public.subscriptions subscription ON subscription.organization_id = monthly.organization_id
   WHERE monthly.month_start = current_month
     AND subscription.status = 'active'
     AND subscription.plan_type IN ('Growth', 'Complete');
  SELECT COALESCE(sum(monthly.reserved_cost_nano_usd + monthly.reconciled_cost_nano_usd), 0)::bigint
    INTO project_spend
    FROM public.polaris_provider_monthly_usage monthly
   WHERE monthly.month_start = current_month;

  IF denial IS NULL AND tenant_spend + requested_cost_nano_usd > hard_cap THEN
    denial := 'tenant_spend_limit'; retry_seconds := 3600;
  END IF;
  IF denial IS NULL AND project_spend + requested_cost_nano_usd > project_cap THEN
    denial := 'project_spend_limit'; retry_seconds := 3600;
  END IF;

  IF denial IS NOT NULL THEN
    INSERT INTO public.polaris_provider_security_events(
      id, organization_id, user_id, request_id, event_class
    ) VALUES (
      gen_random_uuid(), requested_organization_id, requested_user_id, requested_request_id, denial
    );
    RETURN QUERY SELECT NULL::uuid, FALSE, denial, retry_seconds, requested_cost_nano_usd,
      tenant_spend, target_cap, warning_cap, hard_cap, project_cap;
    RETURN;
  END IF;

  INSERT INTO public.polaris_provider_requests(
    id, organization_id, user_id, request_id, month_start, model, schema_version,
    state, reserved_cost_nano_usd, lease_expires_at
  ) VALUES (
    generated_reservation, requested_organization_id, requested_user_id, requested_request_id,
    current_month, requested_model, requested_schema_version, 'reserved',
    requested_cost_nano_usd, clock_timestamp() + INTERVAL '25 seconds'
  );
  UPDATE public.polaris_provider_monthly_usage AS admitted_month
     SET reserved_cost_nano_usd = admitted_month.reserved_cost_nano_usd + requested_cost_nano_usd,
         updated_at = transaction_timestamp()
   WHERE organization_id = requested_organization_id AND month_start = current_month;

  RETURN QUERY SELECT generated_reservation, TRUE, NULL::text, NULL::integer,
    requested_cost_nano_usd, tenant_spend + requested_cost_nano_usd,
    target_cap, warning_cap, hard_cap, project_cap;
END
$polaris_provider_reserve$;

CREATE FUNCTION public.polaris_provider_reconcile_usage(
  requested_organization_id UUID,
  requested_user_id UUID,
  requested_reservation_id UUID,
  requested_cost_nano_usd BIGINT,
  requested_input_tokens INTEGER,
  requested_output_tokens INTEGER,
  requested_attempt_count SMALLINT,
  requested_outcome_class TEXT,
  requested_provider_request_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $polaris_provider_reconcile$
DECLARE
  reserved_request public.polaris_provider_requests%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(19000037::bigint);
  PERFORM pg_advisory_xact_lock(hashtextextended(requested_organization_id::text, 19000037));
  SELECT * INTO reserved_request
    FROM public.polaris_provider_requests request
   WHERE request.id = requested_reservation_id
     AND request.organization_id = requested_organization_id
     AND request.user_id = requested_user_id
   FOR UPDATE;
  IF NOT FOUND OR reserved_request.state <> 'reserved' THEN
    RAISE EXCEPTION 'Polaris reservation is unavailable for reconciliation'
      USING ERRCODE = '55000', CONSTRAINT = 'polaris_provider_reservation_unavailable';
  END IF;
  IF requested_cost_nano_usd < 0 OR requested_cost_nano_usd > reserved_request.reserved_cost_nano_usd
     OR requested_input_tokens < 0 OR requested_input_tokens > 16000
     OR requested_output_tokens < 0 OR requested_output_tokens > 8192
     OR requested_attempt_count NOT BETWEEN 1 AND 2
     OR requested_outcome_class NOT IN ('completed', 'refused', 'incomplete', 'failed')
     OR requested_provider_request_id IS NOT NULL
       AND octet_length(requested_provider_request_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Unsupported Polaris reconciliation contract'
      USING ERRCODE = '22023', CONSTRAINT = 'polaris_provider_reconciliation_contract';
  END IF;

  UPDATE public.polaris_provider_requests
     SET state = CASE WHEN requested_outcome_class = 'completed' THEN 'completed' ELSE 'failed' END,
         actual_cost_nano_usd = requested_cost_nano_usd,
         input_tokens = requested_input_tokens,
         output_tokens = requested_output_tokens,
         attempt_count = requested_attempt_count,
         outcome_class = requested_outcome_class,
         provider_request_id = requested_provider_request_id,
         completed_at = clock_timestamp()
   WHERE id = requested_reservation_id;
  UPDATE public.polaris_provider_monthly_usage
     SET reserved_cost_nano_usd = reserved_cost_nano_usd - reserved_request.reserved_cost_nano_usd,
         reconciled_cost_nano_usd = reconciled_cost_nano_usd + requested_cost_nano_usd,
         input_tokens = input_tokens + requested_input_tokens,
         output_tokens = output_tokens + requested_output_tokens,
         completed_requests = completed_requests + CASE WHEN requested_outcome_class = 'completed' THEN 1 ELSE 0 END,
         failed_requests = failed_requests + CASE WHEN requested_outcome_class = 'completed' THEN 0 ELSE 1 END,
         updated_at = transaction_timestamp()
   WHERE organization_id = reserved_request.organization_id
     AND month_start = reserved_request.month_start;
  RETURN TRUE;
END
$polaris_provider_reconcile$;

CREATE FUNCTION public.polaris_provider_usage_policy_status(
  requested_organization_id UUID,
  requested_user_id UUID
)
RETURNS TABLE (policy_state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $polaris_provider_usage_policy$
DECLARE
  current_month DATE := date_trunc('month', clock_timestamp())::date;
  revenue_cents BIGINT;
  tenant_spend BIGINT;
  target_cap BIGINT;
  warning_cap BIGINT;
  hard_cap BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_memberships membership
      JOIN public.subscriptions subscription
        ON subscription.organization_id = membership.organization_id
     WHERE membership.organization_id = requested_organization_id
       AND membership.user_id = requested_user_id
       AND membership.status = 'active'
       AND membership.role IN ('owner', 'admin')
       AND subscription.plan_type IN ('Growth', 'Complete')
       AND subscription.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Polaris usage policy is unavailable for this actor'
      USING ERRCODE = '42501', CONSTRAINT = 'polaris_provider_actor_not_entitled';
  END IF;

  SELECT monthly.collected_subscription_revenue_cents,
         monthly.reserved_cost_nano_usd + monthly.reconciled_cost_nano_usd
    INTO revenue_cents, tenant_spend
    FROM public.polaris_provider_monthly_usage monthly
   WHERE monthly.organization_id = requested_organization_id
     AND monthly.month_start = current_month;

  IF NOT FOUND OR revenue_cents <= 0 THEN
    RETURN QUERY SELECT 'limit'::text;
    RETURN;
  END IF;

  target_cap := revenue_cents * 500000;
  warning_cap := revenue_cents * 1000000;
  hard_cap := revenue_cents * 2000000;
  RETURN QUERY SELECT CASE
    WHEN tenant_spend >= hard_cap THEN 'limit'::text
    WHEN tenant_spend >= warning_cap THEN 'warning'::text
    WHEN tenant_spend >= target_cap THEN 'target'::text
    ELSE 'within_target'::text
  END;
END
$polaris_provider_usage_policy$;

REVOKE ALL ON TABLE public.polaris_provider_monthly_usage FROM PUBLIC;
REVOKE ALL ON TABLE public.polaris_provider_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.polaris_provider_security_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.polaris_provider_reserve_usage(uuid,uuid,uuid,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.polaris_provider_reconcile_usage(uuid,uuid,uuid,bigint,integer,integer,smallint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.polaris_provider_usage_policy_status(uuid,uuid) FROM PUBLIC;
