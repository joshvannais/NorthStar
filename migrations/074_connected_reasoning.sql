-- Part7 Slice3: grounded conversation admission and source candidates.
-- No validated tax rules or external provider activation ship here.
ALTER TABLE public.polaris_provider_requests DROP CONSTRAINT polaris_provider_request_schema_check;
ALTER TABLE public.polaris_provider_requests ADD CONSTRAINT polaris_provider_request_schema_check CHECK(schema_version IN ('northstar.polaris.assistant-response.v1','northstar.polaris.grounded-conversation.v2'));
CREATE OR REPLACE FUNCTION public.polaris_provider_reserve_usage(
  requested_organization_id UUID,
  requested_user_id UUID,
  requested_request_id UUID,
  requested_fingerprint TEXT,
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
  current_month DATE := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
  generated_reservation UUID := gen_random_uuid();
  revenue_cents BIGINT;
  tenant_spend BIGINT;
  project_spend BIGINT;
  target_cap BIGINT;
  warning_cap BIGINT;
  hard_cap BIGINT;
  project_cap BIGINT;
  expired_group RECORD;
  existing_request public.polaris_provider_requests%ROWTYPE;
  re_admitting BOOLEAN := FALSE;
  denial TEXT := NULL;
  retry_seconds INTEGER := NULL;
BEGIN
  IF requested_fingerprint !~ '^[0-9a-f]{64}$'
     OR requested_model <> 'gpt-5.6-luna'
     OR requested_schema_version NOT IN ('northstar.polaris.assistant-response.v1','northstar.polaris.grounded-conversation.v2')
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

  SELECT * INTO existing_request
    FROM public.polaris_provider_requests request
   WHERE request.organization_id = requested_organization_id
     AND request.user_id = requested_user_id
     AND request.request_id = requested_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF existing_request.request_fingerprint = requested_fingerprint
       AND existing_request.state = 'failed'
       AND existing_request.outcome_class = 'failed'
       AND existing_request.actual_cost_nano_usd = 0
       AND existing_request.input_tokens = 0
       AND existing_request.output_tokens = 0
       AND existing_request.provider_request_id IS NULL
       AND existing_request.retry_after_at IS NOT NULL
       AND existing_request.retry_after_at <= clock_timestamp()
       AND existing_request.re_admission_count = 0 THEN
      re_admitting := TRUE;
      generated_reservation := existing_request.id;
    ELSE
      denial := 'idempotency_conflict'; retry_seconds := 1;
    END IF;
  END IF;

  IF denial IS NULL AND (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id
            AND request.user_id = requested_user_id
            AND request.state = 'reserved' AND request.lease_expires_at > clock_timestamp()) >= 1 THEN
    denial := 'user_concurrency'; retry_seconds := 25;
  ELSIF denial IS NULL AND (SELECT count(*) FROM public.polaris_provider_requests request
          WHERE request.organization_id = requested_organization_id
            AND request.state = 'reserved' AND request.lease_expires_at > clock_timestamp()) >= 4 THEN
    denial := 'tenant_concurrency'; retry_seconds := 25;
  ELSIF denial IS NULL AND (SELECT count(*) FROM (
          SELECT request.created_at AS admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
          UNION ALL
          SELECT request.re_admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
             AND request.re_admitted_at IS NOT NULL
        ) attempt WHERE attempt.admitted_at > clock_timestamp() - INTERVAL '1 minute') >= 12 THEN
    denial := 'user_minute_rate'; retry_seconds := 60;
  ELSIF denial IS NULL AND (SELECT count(*) FROM (
          SELECT request.created_at AS admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
          UNION ALL
          SELECT request.re_admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
             AND request.re_admitted_at IS NOT NULL
        ) attempt WHERE attempt.admitted_at > clock_timestamp() - INTERVAL '1 hour') >= 120 THEN
    denial := 'user_hour_rate'; retry_seconds := 3600;
  ELSIF denial IS NULL AND (SELECT count(*) FROM (
          SELECT request.created_at AS admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
          UNION ALL
          SELECT request.re_admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.user_id = requested_user_id
             AND request.re_admitted_at IS NOT NULL
        ) attempt WHERE attempt.admitted_at > clock_timestamp() - INTERVAL '1 day') >= 600 THEN
    denial := 'user_day_rate'; retry_seconds := 86400;
  ELSIF denial IS NULL AND (SELECT count(*) FROM (
          SELECT request.created_at AS admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id
          UNION ALL
          SELECT request.re_admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.re_admitted_at IS NOT NULL
        ) attempt WHERE attempt.admitted_at > clock_timestamp() - INTERVAL '1 minute') >= 60 THEN
    denial := 'tenant_minute_rate'; retry_seconds := 60;
  ELSIF denial IS NULL AND (SELECT count(*) FROM (
          SELECT request.created_at AS admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id
          UNION ALL
          SELECT request.re_admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.re_admitted_at IS NOT NULL
        ) attempt WHERE attempt.admitted_at > clock_timestamp() - INTERVAL '1 hour') >= 600 THEN
    denial := 'tenant_hour_rate'; retry_seconds := 3600;
  ELSIF denial IS NULL AND (SELECT count(*) FROM (
          SELECT request.created_at AS admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id
          UNION ALL
          SELECT request.re_admitted_at FROM public.polaris_provider_requests request
           WHERE request.organization_id = requested_organization_id AND request.re_admitted_at IS NOT NULL
        ) attempt WHERE attempt.admitted_at > clock_timestamp() - INTERVAL '1 day') >= 3000 THEN
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

  IF re_admitting THEN
    UPDATE public.polaris_provider_requests
       SET month_start = current_month,
           state = 'reserved',
           actual_cost_nano_usd = NULL,
           input_tokens = NULL,
           output_tokens = NULL,
           attempt_count = NULL,
           outcome_class = NULL,
           provider_request_id = NULL,
           lease_expires_at = clock_timestamp() + INTERVAL '25 seconds',
           retry_after_at = NULL,
           re_admission_count = 1,
           re_admitted_at = clock_timestamp(),
           completed_at = NULL
     WHERE id = generated_reservation;
  ELSE
    INSERT INTO public.polaris_provider_requests(
      id, organization_id, user_id, request_id, request_fingerprint, month_start, model, schema_version,
      state, reserved_cost_nano_usd, lease_expires_at
    ) VALUES (
      generated_reservation, requested_organization_id, requested_user_id, requested_request_id,
      requested_fingerprint, current_month, requested_model, requested_schema_version, 'reserved',
      requested_cost_nano_usd, clock_timestamp() + INTERVAL '25 seconds'
    );
  END IF;
  UPDATE public.polaris_provider_monthly_usage AS admitted_month
     SET reserved_cost_nano_usd = admitted_month.reserved_cost_nano_usd + requested_cost_nano_usd,
         updated_at = transaction_timestamp()
   WHERE organization_id = requested_organization_id AND month_start = current_month;

  RETURN QUERY SELECT generated_reservation, TRUE, NULL::text, NULL::integer,
    requested_cost_nano_usd, tenant_spend + requested_cost_nano_usd,
    target_cap, warning_cap, hard_cap, project_cap;
END
$polaris_provider_reserve$;

CREATE TABLE public.demo_polaris_provider_windows(
 window_start timestamptz NOT NULL,scope text NOT NULL CHECK(scope IN('source_hour','global_day')),
 subject_hash text NOT NULL CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
 reservations integer NOT NULL CHECK(reservations BETWEEN 1 AND 100),reserved_cost_nano_usd bigint NOT NULL,
 PRIMARY KEY(window_start,scope,subject_hash),CHECK(reserved_cost_nano_usd=reservations::bigint*20000000)
);
CREATE TABLE public.demo_polaris_provider_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),request_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),basis_digest text NOT NULL CHECK(basis_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('reserved','completed','failed')),reserved_cost_nano_usd bigint NOT NULL DEFAULT 20000000 CHECK(reserved_cost_nano_usd=20000000),
 actual_cost_nano_usd bigint CHECK(actual_cost_nano_usd BETWEEN 0 AND 20000000),usage jsonb,
 created_at timestamptz NOT NULL,lease_until timestamptz NOT NULL,session_expires_at timestamptz NOT NULL,completed_at timestamptz,
 UNIQUE(token_hash,request_id),CHECK(lease_until>created_at AND session_expires_at>created_at),
 CHECK((state='reserved' AND usage IS NULL AND completed_at IS NULL AND actual_cost_nano_usd IS NULL) OR(state<>'reserved' AND usage IS NOT NULL AND completed_at IS NOT NULL AND actual_cost_nano_usd IS NOT NULL)),
 CHECK(usage IS NULL OR octet_length(usage::text)<=2048)
);
CREATE INDEX demo_polaris_provider_requests_token ON public.demo_polaris_provider_requests(token_hash,created_at);
CREATE INDEX demo_polaris_provider_requests_retention ON public.demo_polaris_provider_requests(created_at);
CREATE FUNCTION public.demo_polaris_provider_reserve(tenant uuid,token text,request uuid,request_hash text,basis text,expires timestamptz,source_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE moment timestamptz:=clock_timestamp();day_start timestamptz;hour_start timestamptz;existing public.demo_polaris_provider_requests%ROWTYPE;
 session_row public.demo_command_center_sessions%ROWTYPE;count_value integer;new_id uuid;global_hash text:=repeat('0',64);
BEGIN
 IF tenant IS NULL OR request IS NULL OR token IS NULL OR token!~'^[a-f0-9]{64}$' OR request_hash IS NULL OR request_hash!~'^[a-f0-9]{64}$' OR basis IS NULL OR basis!~'^[a-f0-9]{64}$' OR source_hash IS NULL OR source_hash!~'^[a-f0-9]{64}$' OR expires IS NULL OR expires<=moment OR expires>moment+interval '24 hours' THEN RAISE EXCEPTION 'Demo conversation authority invalid' USING ERRCODE='22023';END IF;
 day_start:=date_trunc('day',moment AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';hour_start:=date_trunc('hour',moment AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 PERFORM pg_advisory_xact_lock(hashtextextended('demo-polaris-global:'||day_start::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('demo-polaris-source:'||source_hash||':'||hour_start::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('demo-polaris-token:'||token,0));
 moment:=clock_timestamp();
 IF date_trunc('hour',moment AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'<>hour_start THEN RAISE EXCEPTION 'Conversation window changed' USING ERRCODE='40001';END IF;
 IF expires<=moment THEN RAISE EXCEPTION 'Demo session expired' USING ERRCODE='P0001',CONSTRAINT='demo_polaris_expired';END IF;
 SELECT * INTO session_row FROM public.demo_command_center_sessions WHERE token_hash=token;
 IF FOUND AND (session_row.tenant_id<>tenant OR session_row.expires_at<>expires OR session_row.expires_at<=moment) THEN RAISE EXCEPTION 'Demo session changed' USING ERRCODE='P0001',CONSTRAINT='demo_polaris_changed';END IF;
 SELECT * INTO existing FROM public.demo_polaris_provider_requests WHERE token_hash=token AND request_id=request FOR UPDATE;
 IF FOUND THEN
  IF existing.tenant_id<>tenant OR existing.request_digest<>request_hash OR existing.basis_digest<>basis OR existing.session_expires_at<>expires THEN RAISE EXCEPTION 'Conversation request changed' USING ERRCODE='23505',CONSTRAINT='demo_polaris_request_changed';END IF;
  RETURN jsonb_build_object('id',existing.id,'admitted',false,'state',existing.state,'replay',true);
 END IF;
 SELECT count(*) INTO count_value FROM public.demo_polaris_provider_requests WHERE token_hash=token;
 IF count_value>=4 THEN RETURN jsonb_build_object('admitted',false,'reason','session_limit');END IF;
 IF EXISTS(SELECT 1 FROM public.demo_polaris_provider_requests WHERE token_hash=token AND state='reserved' AND lease_until>moment) THEN RETURN jsonb_build_object('admitted',false,'reason','busy');END IF;
 SELECT reservations INTO count_value FROM public.demo_polaris_provider_windows WHERE window_start=day_start AND scope='global_day' AND subject_hash=global_hash;
 IF COALESCE(count_value,0)>=100 THEN RETURN jsonb_build_object('admitted',false,'reason','global_limit');END IF;
 SELECT reservations INTO count_value FROM public.demo_polaris_provider_windows WHERE window_start=hour_start AND scope='source_hour' AND subject_hash=source_hash;
 IF COALESCE(count_value,0)>=4 THEN RETURN jsonb_build_object('admitted',false,'reason','source_limit');END IF;
 INSERT INTO public.demo_polaris_provider_windows VALUES(day_start,'global_day',global_hash,1,20000000)
 ON CONFLICT(window_start,scope,subject_hash) DO UPDATE SET reservations=demo_polaris_provider_windows.reservations+1,reserved_cost_nano_usd=demo_polaris_provider_windows.reserved_cost_nano_usd+20000000;
 INSERT INTO public.demo_polaris_provider_windows VALUES(hour_start,'source_hour',source_hash,1,20000000)
 ON CONFLICT(window_start,scope,subject_hash) DO UPDATE SET reservations=demo_polaris_provider_windows.reservations+1,reserved_cost_nano_usd=demo_polaris_provider_windows.reserved_cost_nano_usd+20000000;
 INSERT INTO public.demo_polaris_provider_requests(tenant_id,token_hash,request_id,request_digest,basis_digest,state,created_at,lease_until,session_expires_at)
 VALUES(tenant,token,request,request_hash,basis,'reserved',moment,moment+interval '30 seconds',expires) RETURNING id INTO new_id;
 RETURN jsonb_build_object('id',new_id,'admitted',true,'state','reserved','replay',false);
END $$;
CREATE FUNCTION public.demo_polaris_provider_reconcile(reservation uuid,token text,value jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE existing public.demo_polaris_provider_requests%ROWTYPE;cost_value bigint;
BEGIN
 IF value IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['costNanoUsd','inputTokens','outputTokens','attemptCount','latencyMs']) k WHERE jsonb_typeof(value->k) IS DISTINCT FROM 'number') OR jsonb_typeof(value->'outcomeClass') IS DISTINCT FROM 'string' OR jsonb_typeof(value->'providerRequestId') NOT IN('string','null') OR NOT(value ? 'providerRequestId') OR length(value->>'providerRequestId')>128 THEN RAISE EXCEPTION 'Conversation usage invalid' USING ERRCODE='22023';END IF;
 IF public.canonical_field_evidence_object_keys_exact(value,ARRAY['costNanoUsd','inputTokens','outputTokens','attemptCount','outcomeClass','latencyMs','providerRequestId']) IS NOT TRUE OR value->>'costNanoUsd'!~'^[0-9]{1,8}$' OR value->>'inputTokens'!~'^[0-9]{1,5}$' OR value->>'outputTokens'!~'^[0-9]{1,4}$' OR value->>'attemptCount' NOT IN('1','2') OR value->>'latencyMs'!~'^[0-9]{1,5}$' OR value->>'outcomeClass' NOT IN('completed','refused','incomplete','failed','ambiguous_timeout') OR octet_length(value::text)>2048 THEN RAISE EXCEPTION 'Conversation usage invalid' USING ERRCODE='22023';END IF;
 cost_value:=(value->>'costNanoUsd')::bigint;
 IF cost_value>20000000 OR (value->>'inputTokens')::integer>16000 OR (value->>'outputTokens')::integer>8192 OR (value->>'latencyMs')::integer>25000 THEN RAISE EXCEPTION 'Conversation usage outside limits' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('demo-polaris-token:'||token,0));
 SELECT * INTO existing FROM public.demo_polaris_provider_requests WHERE id=reservation AND token_hash=token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation reservation unavailable' USING ERRCODE='P0002';END IF;
 IF existing.state<>'reserved' THEN
  IF existing.usage IS DISTINCT FROM value THEN RAISE EXCEPTION 'Conversation receipt changed' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('id',existing.id,'replay',true);
 END IF;
 UPDATE public.demo_polaris_provider_requests SET actual_cost_nano_usd=cost_value,usage=value,completed_at=clock_timestamp(),state=CASE WHEN value->>'outcomeClass'='completed' THEN 'completed' ELSE 'failed' END WHERE id=reservation;
 RETURN jsonb_build_object('id',reservation,'replay',false);
END $$;

CREATE TABLE public.canonical_tax_research_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),preparation_job_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest~'^[a-f0-9]{64}$'),rules_digest text NOT NULL CHECK(rules_digest~'^[a-f0-9]{64}$'),public_context_digest text NOT NULL CHECK(public_context_digest~'^[a-f0-9]{64}$'),
 public_context jsonb NOT NULL CHECK(octet_length(public_context::text)<=8192),as_of_date date NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','done','exhausted')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_token uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,preparation_job_id,public_context_digest),
 FOREIGN KEY(organization_id,preparation_job_id) REFERENCES public.canonical_tax_preparation_jobs(organization_id,id),
 CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(state<>'leased' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX canonical_tax_research_pending ON public.canonical_tax_research_jobs(state,created_at);
CREATE TABLE public.canonical_tax_research_candidates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,job_id uuid NOT NULL,attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 disposition text NOT NULL CHECK(disposition IN('candidate','unsupported','conflicting','stale','expired','invalid')),content jsonb NOT NULL CHECK(octet_length(content::text)<=65536),
 digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(job_id,attempt),FOREIGN KEY(organization_id,job_id) REFERENCES public.canonical_tax_research_jobs(organization_id,id),
 CHECK(NOT content @> '{"validation":"validated"}'::jsonb)
);
CREATE TRIGGER canonical_tax_research_candidates_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_tax_research_candidates FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_commercial_immutable();
CREATE FUNCTION public.canonical_tax_research_enqueue(org uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE preparation public.canonical_tax_preparation_jobs%ROWTYPE;context_value jsonb;public_value jsonb;added integer:=0;row_count integer;inserted_count integer;candidate_org uuid;
BEGIN
 -- Internal worker-only bounded discovery; browser adapters never pass NULL.
 IF org IS NULL THEN
  FOR candidate_org IN
   SELECT p.organization_id FROM public.canonical_tax_preparation_jobs p
   WHERE p.id=(SELECT latest.id FROM public.canonical_tax_preparation_jobs latest WHERE latest.organization_id=p.organization_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
    AND p.as_of_date=(clock_timestamp() AT TIME ZONE 'UTC')::date
    AND p.input_digest=public.canonical_completion_digest(public.canonical_commercial_tax_inputs(p.organization_id))
    AND p.rules_digest=public.canonical_completion_digest(public.canonical_commercial_tax_rules())
    AND EXISTS(SELECT 1 FROM public.canonical_tax_preparation_results r WHERE r.job_id=p.id AND r.disposition='published' AND r.result->>'state' IN('unsupported','conflicting_coverage','missing_inputs'))
    AND (SELECT count(*) FROM public.canonical_tax_research_jobs j WHERE j.organization_id=p.organization_id)<1000
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.inputs#>'{declared,contexts}') c
      WHERE COALESCE(c->>'country','')<>'' AND COALESCE(c->>'region','')<>'' AND COALESCE(c->>'serviceKey','')<>''
      AND NOT EXISTS(SELECT 1 FROM public.canonical_tax_research_jobs j WHERE j.organization_id=p.organization_id AND j.preparation_job_id=p.id AND j.public_context_digest=public.canonical_completion_digest(jsonb_build_object('country',COALESCE(c->>'country',''),'region',COALESCE(c->>'region',''),'locality',COALESCE(c->>'locality',''),'jurisdiction',COALESCE(c->>'jurisdiction',''),'serviceKey',COALESCE(c->>'serviceKey',''),'classification',COALESCE(c->>'classification','')))))
   ORDER BY p.created_at,p.id LIMIT 5
  LOOP
   added:=added+public.canonical_tax_research_enqueue(candidate_org);
  END LOOP;
  RETURN added;
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO preparation FROM public.canonical_tax_preparation_jobs WHERE organization_id=org ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND OR preparation.input_digest<>public.canonical_completion_digest(public.canonical_commercial_tax_inputs(org)) OR preparation.rules_digest<>public.canonical_completion_digest(public.canonical_commercial_tax_rules()) OR preparation.as_of_date<>(clock_timestamp() AT TIME ZONE 'UTC')::date THEN RETURN 0;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_tax_preparation_results WHERE job_id=preparation.id AND disposition='published' AND result->>'state' IN('unsupported','conflicting_coverage','missing_inputs')) THEN RETURN 0;END IF;
 SELECT count(*) INTO row_count FROM public.canonical_tax_research_jobs WHERE organization_id=org;
 -- Immutable candidates remain retained; stop acquisition at a documented bound.
 IF row_count>=1000 THEN RETURN 0;END IF;
 FOR context_value IN SELECT value FROM jsonb_array_elements(preparation.inputs#>'{declared,contexts}') LIMIT 12 LOOP
  public_value:=jsonb_build_object('country',COALESCE(context_value->>'country',''),'region',COALESCE(context_value->>'region',''),'locality',COALESCE(context_value->>'locality',''),'jurisdiction',COALESCE(context_value->>'jurisdiction',''),'serviceKey',COALESCE(context_value->>'serviceKey',''),'classification',COALESCE(context_value->>'classification',''));
  IF public_value->>'country'='' OR public_value->>'region'='' OR public_value->>'serviceKey'='' THEN CONTINUE;END IF;
  IF row_count>=1000 THEN EXIT;END IF;
  INSERT INTO public.canonical_tax_research_jobs(organization_id,preparation_job_id,input_digest,rules_digest,public_context_digest,public_context,as_of_date)
  VALUES(org,preparation.id,preparation.input_digest,preparation.rules_digest,public.canonical_completion_digest(public_value),public_value,preparation.as_of_date)
  ON CONFLICT(organization_id,preparation_job_id,public_context_digest) DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;added:=added+inserted_count;row_count:=row_count+inserted_count;
 END LOOP;
 RETURN added;
END $$;
CREATE FUNCTION public.canonical_tax_research_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate record;job public.canonical_tax_research_jobs%ROWTYPE;moment timestamptz;token uuid;
BEGIN
 FOR candidate IN SELECT id,organization_id FROM public.canonical_tax_research_jobs WHERE state='pending' OR(state='leased' AND lease_until<=clock_timestamp()) ORDER BY created_at,id LIMIT 5 LOOP
  PERFORM 1 FROM public.organizations WHERE id=candidate.organization_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  SELECT * INTO job FROM public.canonical_tax_research_jobs WHERE id=candidate.id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  moment:=clock_timestamp();IF job.state NOT IN('pending','leased') OR(job.state='leased' AND job.lease_until>moment) THEN CONTINUE;END IF;
  IF job.attempts>=3 OR job.input_digest<>public.canonical_completion_digest(public.canonical_commercial_tax_inputs(job.organization_id)) OR job.rules_digest<>public.canonical_completion_digest(public.canonical_commercial_tax_rules()) OR job.as_of_date<>(moment AT TIME ZONE 'UTC')::date THEN
   UPDATE public.canonical_tax_research_jobs SET state='exhausted',lease_token=NULL,lease_until=NULL WHERE id=job.id;CONTINUE;
  END IF;
  token:=gen_random_uuid();UPDATE public.canonical_tax_research_jobs SET state='leased',attempts=attempts+1,lease_token=token,lease_until=moment+interval '60 seconds' WHERE id=job.id;
  RETURN jsonb_build_object('id',job.id,'organizationId',job.organization_id,'leaseToken',token,'context',job.public_context,'inputDigest',job.input_digest,'rulesDigest',job.rules_digest,'asOfDate',job.as_of_date);
 END LOOP;RETURN NULL;
END $$;
CREATE FUNCTION public.canonical_tax_research_finish(job_id_value uuid,token uuid,result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org uuid;job public.canonical_tax_research_jobs%ROWTYPE;moment timestamptz;state_value text;result_id uuid;
BEGIN
 SELECT organization_id INTO org FROM public.canonical_tax_research_jobs WHERE id=job_id_value;IF NOT FOUND THEN RAISE EXCEPTION 'Research request unavailable' USING ERRCODE='P0002';END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO job FROM public.canonical_tax_research_jobs WHERE id=job_id_value FOR UPDATE;moment:=clock_timestamp();
 IF job.state<>'leased' OR job.lease_token IS DISTINCT FROM token THEN RAISE EXCEPTION 'Research lease changed' USING ERRCODE='40001';END IF;
 state_value:=result->>'state';
 IF public.canonical_field_evidence_object_keys_exact(result,ARRAY['version','state','context','candidates']) IS NOT TRUE OR result->>'version' IS DISTINCT FROM 'tax-source-candidate-v1' OR result->'context' IS DISTINCT FROM job.public_context OR state_value IS NULL OR state_value NOT IN('candidate','unsupported','conflicting') OR jsonb_typeof(result->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'candidates')>8 OR octet_length(result::text)>65536 THEN state_value:='invalid';result:='{}';END IF;
 IF state_value<>'invalid' AND EXISTS(SELECT 1 FROM jsonb_array_elements(result->'candidates') c WHERE c->>'state' IS DISTINCT FROM 'candidate' OR c ? 'validation' OR c ? 'validated' OR c ? 'rate' OR c->'context' IS DISTINCT FROM job.public_context) THEN state_value:='invalid';result:='{}';END IF;
 IF job.lease_until<=moment THEN state_value:='expired';ELSIF job.input_digest<>public.canonical_completion_digest(public.canonical_commercial_tax_inputs(org)) OR job.rules_digest<>public.canonical_completion_digest(public.canonical_commercial_tax_rules()) OR job.as_of_date<>(moment AT TIME ZONE 'UTC')::date THEN state_value:='stale';END IF;
 INSERT INTO public.canonical_tax_research_candidates(organization_id,job_id,attempt,disposition,content,digest) VALUES(org,job.id,job.attempts,state_value,result,public.canonical_completion_digest(result)) RETURNING id INTO result_id;
 UPDATE public.canonical_tax_research_jobs SET state=CASE WHEN state_value IN('candidate','unsupported','conflicting') THEN 'done' WHEN state_value='expired' AND attempts<3 THEN 'pending' ELSE 'exhausted' END,lease_token=NULL,lease_until=NULL WHERE id=job.id;
 RETURN jsonb_build_object('id',result_id,'disposition',state_value);
END $$;
REVOKE ALL ON TABLE public.demo_polaris_provider_windows,public.demo_polaris_provider_requests,public.canonical_tax_research_jobs,public.canonical_tax_research_candidates FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_polaris_provider_reserve(uuid,text,uuid,text,text,timestamptz,text),public.demo_polaris_provider_reconcile(uuid,text,jsonb),public.canonical_tax_research_enqueue(uuid),public.canonical_tax_research_claim(),public.canonical_tax_research_finish(uuid,uuid,jsonb) FROM PUBLIC;

-- Bounded operational retirement: no active token, lease or accounting window is removed.
CREATE FUNCTION public.connected_reasoning_retire() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE moment timestamptz:=clock_timestamp();requests_removed integer;windows_removed integer;
BEGIN
 WITH victims AS(SELECT id FROM public.demo_polaris_provider_requests WHERE created_at<moment-interval '30 days' AND session_expires_at<moment AND lease_until<moment ORDER BY created_at,id LIMIT 200 FOR UPDATE SKIP LOCKED)
 DELETE FROM public.demo_polaris_provider_requests r USING victims v WHERE r.id=v.id;
 GET DIAGNOSTICS requests_removed=ROW_COUNT;
 WITH victims AS(SELECT window_start,scope,subject_hash FROM public.demo_polaris_provider_windows WHERE window_start<moment-interval '2 days' ORDER BY window_start,scope,subject_hash LIMIT 200 FOR UPDATE SKIP LOCKED)
 DELETE FROM public.demo_polaris_provider_windows w USING victims v WHERE w.window_start=v.window_start AND w.scope=v.scope AND w.subject_hash=v.subject_hash;
 GET DIAGNOSTICS windows_removed=ROW_COUNT;
 RETURN jsonb_build_object('requestsRetired',requests_removed,'windowsRetired',windows_removed);
END $$;
CREATE FUNCTION public.canonical_tax_research_status(org uuid,actor uuid,session_value uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE role_value text;counts jsonb;
BEGIN
 IF current_setting('transaction_isolation') NOT IN('repeatable read','serializable') THEN RAISE EXCEPTION 'Protected research status read required' USING ERRCODE='42501';END IF;
 SELECT role INTO role_value FROM public.organization_memberships WHERE organization_id=org AND user_id=actor AND status='active';
 IF role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT jsonb_build_object('total',count(*),'pending',count(*) FILTER(WHERE state='pending'),'leased',count(*) FILTER(WHERE state='leased'),'done',count(*) FILTER(WHERE state='done'),'exhausted',count(*) FILTER(WHERE state='exhausted'),'capacity',1000,'capacityReached',count(*)>=1000) INTO counts FROM public.canonical_tax_research_jobs WHERE organization_id=org;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 RETURN counts;
END $$;
REVOKE ALL ON FUNCTION public.connected_reasoning_retire(),public.canonical_tax_research_status(uuid,uuid,uuid) FROM PUBLIC;


-- Call admission has no fabricated user. It shares037 monthly accounting/lock order.
CREATE TABLE public.canonical_call_provider_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),
 voice_session_id uuid NOT NULL REFERENCES public.canonical_voice_sessions(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),basis text NOT NULL CHECK(basis ~ '^[a-f0-9]{64}$'),
 month_start date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_until timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','completed','failed','unknown')),
 reserved_cost_nano_usd bigint NOT NULL DEFAULT 20000000 CHECK(reserved_cost_nano_usd=20000000),actual_cost_nano_usd bigint CHECK(actual_cost_nano_usd BETWEEN 0 AND 20000000),
 settled_at timestamptz,usage jsonb,UNIQUE(voice_session_id,request_hash),
 CHECK((state='reserved' AND settled_at IS NULL AND actual_cost_nano_usd IS NULL) OR (state<>'reserved' AND settled_at IS NOT NULL AND actual_cost_nano_usd IS NOT NULL))
);
CREATE INDEX canonical_call_provider_current ON public.canonical_call_provider_requests(organization_id,created_at,state);
CREATE FUNCTION public.canonical_call_provider_retire() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item public.canonical_call_provider_requests%ROWTYPE;count_value integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(19000037::bigint);
 FOR item IN SELECT * FROM public.canonical_call_provider_requests WHERE state='reserved' AND lease_until<=clock_timestamp() ORDER BY lease_until,id LIMIT 200 FOR UPDATE LOOP
  -- Preserve conservative charge on unknown/expired results. Never refund a timeout.
  UPDATE public.polaris_provider_monthly_usage SET reserved_cost_nano_usd=reserved_cost_nano_usd-item.reserved_cost_nano_usd,reconciled_cost_nano_usd=reconciled_cost_nano_usd+item.reserved_cost_nano_usd,failed_requests=failed_requests+1,updated_at=clock_timestamp() WHERE organization_id=item.organization_id AND month_start=item.month_start;
  IF NOT FOUND AND item.month_start >= (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '12 months')::date THEN RAISE EXCEPTION 'Call accounting unavailable' USING ERRCODE='55000';END IF;
  UPDATE public.canonical_call_provider_requests SET state='unknown',actual_cost_nano_usd=reserved_cost_nano_usd,settled_at=clock_timestamp(),usage='{"outcome":"expired_unknown"}'::jsonb WHERE id=item.id;
  count_value:=count_value+1;
 END LOOP;
 DELETE FROM public.canonical_call_provider_requests WHERE id IN(SELECT id FROM public.canonical_call_provider_requests WHERE state<>'reserved' AND settled_at<clock_timestamp()-interval '90 days' ORDER BY settled_at,id LIMIT 200);
 RETURN count_value;
END $$;
CREATE FUNCTION public.canonical_call_provider_reserve(session_value uuid,request_value text,basis_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org uuid;s public.canonical_voice_sessions%ROWTYPE;existing public.canonical_call_provider_requests%ROWTYPE;moment timestamptz;month_value date;monthly public.polaris_provider_monthly_usage%ROWTYPE;project_spend numeric;project_cap numeric;identifier uuid;
BEGIN
 IF request_value IS NULL OR request_value !~ '^[a-f0-9]{64}$' OR basis_value IS NULL OR basis_value !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Call admission invalid' USING ERRCODE='22023';END IF;
 SELECT organization_id INTO org FROM public.canonical_voice_sessions WHERE id=session_value;IF org IS NULL THEN RAISE EXCEPTION 'Call unavailable' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19000037::bigint);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,19000037));
 PERFORM public.canonical_call_provider_retire();
 SELECT * INTO s FROM public.canonical_voice_sessions WHERE id=session_value AND organization_id=org FOR UPDATE;moment:=clock_timestamp();
 IF s.status<>'active' OR s.provider<>'retell' OR s.canonical_operation_id IS NOT NULL OR s.started_at+interval '2 hours'<=moment OR NOT EXISTS(SELECT 1 FROM public.canonical_integration_ownership i WHERE i.id=s.integration_ownership_id AND i.organization_id=org AND i.provider='retell' AND i.status='active') OR NOT EXISTS(SELECT 1 FROM public.canonical_business_profiles p WHERE p.id=s.business_profile_id AND p.organization_id=org AND p.is_active AND p.normalized_profile_hash=s.business_profile_hash) OR NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=org AND status='active' AND plan_type IN('Growth','Complete')) THEN RAISE EXCEPTION 'Call authority unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO existing FROM public.canonical_call_provider_requests WHERE voice_session_id=session_value AND request_hash=request_value;
 IF FOUND THEN IF existing.basis<>basis_value THEN RAISE EXCEPTION 'Call request changed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('id',existing.id,'admitted',false,'state',existing.state,'organizationId',org);END IF;
 IF (SELECT count(*) FROM public.canonical_call_provider_requests WHERE voice_session_id=session_value)>=32 OR EXISTS(SELECT 1 FROM public.canonical_call_provider_requests WHERE voice_session_id=session_value AND state='reserved') OR (SELECT count(*) FROM public.canonical_call_provider_requests WHERE organization_id=org AND state='reserved')>=2 OR (SELECT count(*) FROM public.canonical_call_provider_requests WHERE organization_id=org AND created_at>=(moment AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC')>=10 OR (SELECT count(*) FROM public.canonical_call_provider_requests WHERE created_at>=(moment AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC')>=100 THEN RETURN jsonb_build_object('admitted',false,'state','limited');END IF;
 month_value:=date_trunc('month',moment AT TIME ZONE 'UTC')::date;
 SELECT * INTO monthly FROM public.polaris_provider_monthly_usage WHERE organization_id=org AND month_start=month_value FOR UPDATE;
 IF NOT FOUND OR monthly.collected_subscription_revenue_cents<=0 OR monthly.reserved_cost_nano_usd+monthly.reconciled_cost_nano_usd+20000000>monthly.collected_subscription_revenue_cents::numeric*2000000 THEN RETURN jsonb_build_object('admitted',false,'state','limited');END IF;
 SELECT COALESCE(sum(reserved_cost_nano_usd+reconciled_cost_nano_usd),0) INTO project_spend FROM public.polaris_provider_monthly_usage WHERE month_start=month_value;
 SELECT greatest(100000000000::numeric,COALESCE(sum(m.collected_subscription_revenue_cents::numeric*2000000),0)*1.10) INTO project_cap FROM public.polaris_provider_monthly_usage m JOIN public.subscriptions subscription ON subscription.organization_id=m.organization_id WHERE m.month_start=month_value AND subscription.status='active' AND subscription.plan_type IN('Growth','Complete');
 IF project_spend+20000000>project_cap THEN RETURN jsonb_build_object('admitted',false,'state','limited');END IF;
 -- No provider transport runs under this transaction. Post-wait JS reload is additional authority.
 IF s.started_at+interval '2 hours'<=clock_timestamp() THEN RAISE EXCEPTION 'Call expired' USING ERRCODE='42501';END IF;
 INSERT INTO public.canonical_call_provider_requests(organization_id,voice_session_id,request_hash,basis,month_start,lease_until) VALUES(org,session_value,request_value,basis_value,month_value,clock_timestamp()+interval '25 seconds') RETURNING id INTO identifier;
 UPDATE public.polaris_provider_monthly_usage SET reserved_cost_nano_usd=reserved_cost_nano_usd+20000000,updated_at=clock_timestamp() WHERE organization_id=org AND month_start=month_value;
 RETURN jsonb_build_object('id',identifier,'admitted',true,'state','reserved','organizationId',org);
END $$;
CREATE FUNCTION public.canonical_call_provider_reconcile(reservation_value uuid,value jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org uuid;item public.canonical_call_provider_requests%ROWTYPE;cost_value bigint:=20000000;input_value integer:=0;output_value integer:=0;state_value text:='unknown';safe boolean:=false;
BEGIN
 IF value IS NULL OR octet_length(value::text)>4096 THEN value:='{}'::jsonb;END IF;
 SELECT organization_id INTO org FROM public.canonical_call_provider_requests WHERE id=reservation_value;IF org IS NULL THEN RAISE EXCEPTION 'Call reservation unavailable' USING ERRCODE='55000';END IF;
 PERFORM pg_advisory_xact_lock(19000037::bigint);PERFORM pg_advisory_xact_lock(hashtextextended(org::text,19000037));
 SELECT * INTO item FROM public.canonical_call_provider_requests WHERE id=reservation_value FOR UPDATE;
 IF item.state<>'reserved' THEN IF item.state='unknown' OR item.usage IS NOT DISTINCT FROM value THEN RETURN jsonb_build_object('state',item.state,'alreadySettled',true);END IF;RAISE EXCEPTION 'Call reconciliation changed' USING ERRCODE='40001';END IF;
 IF item.lease_until>clock_timestamp() AND public.canonical_field_evidence_object_keys_exact(value,ARRAY['costNanoUsd','inputTokens','outputTokens','outcome']) IS TRUE AND value->>'costNanoUsd' ~ '^(0|[1-9][0-9]{0,8})$' AND value->>'inputTokens' ~ '^(0|[1-9][0-9]{0,4})$' AND value->>'outputTokens' ~ '^(0|[1-9][0-9]{0,3})$' AND value->>'outcome' IN('completed','refused','incomplete','failed') THEN
  safe:=(value->>'costNanoUsd')::bigint<=20000000 AND (value->>'inputTokens')::int<=16000 AND (value->>'outputTokens')::int<=8192;
 END IF;
 IF safe THEN cost_value:=(value->>'costNanoUsd')::bigint;input_value:=(value->>'inputTokens')::int;output_value:=(value->>'outputTokens')::int;state_value:=CASE WHEN value->>'outcome'='completed' THEN 'completed' ELSE 'failed' END;END IF;
 UPDATE public.polaris_provider_monthly_usage SET reserved_cost_nano_usd=reserved_cost_nano_usd-item.reserved_cost_nano_usd,reconciled_cost_nano_usd=reconciled_cost_nano_usd+cost_value,input_tokens=input_tokens+input_value,output_tokens=output_tokens+output_value,completed_requests=completed_requests+CASE WHEN state_value='completed' THEN 1 ELSE 0 END,failed_requests=failed_requests+CASE WHEN state_value='completed' THEN 0 ELSE 1 END,updated_at=clock_timestamp() WHERE organization_id=org AND month_start=item.month_start;
 IF NOT FOUND AND item.month_start >= (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '12 months')::date THEN RAISE EXCEPTION 'Call accounting unavailable' USING ERRCODE='55000';END IF;
 UPDATE public.canonical_call_provider_requests SET state=state_value,actual_cost_nano_usd=cost_value,settled_at=clock_timestamp(),usage=value WHERE id=item.id;
 RETURN jsonb_build_object('state',state_value,'alreadySettled',false);
END $$;
REVOKE ALL ON TABLE public.canonical_call_provider_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_call_provider_reserve(uuid,text,text),public.canonical_call_provider_reconcile(uuid,jsonb),public.canonical_call_provider_retire() FROM PUBLIC;
