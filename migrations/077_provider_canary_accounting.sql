-- Mission 24 Part 7: fail-closed synthetic caller canary and separate count receipts.
-- This migration does not enable either provider or create a live Retell configuration.
ALTER TABLE public.canonical_call_provider_requests
  ADD COLUMN canary_binding_digest text CHECK(canary_binding_digest IS NULL OR canary_binding_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN count_endpoint_version text,
  ADD COLUMN count_request_digest text CHECK(count_request_digest IS NULL OR count_request_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN count_response_digest text CHECK(count_response_digest IS NULL OR count_response_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN count_input_tokens integer CHECK(count_input_tokens IS NULL OR count_input_tokens BETWEEN 0 AND 16000),
  ADD COLUMN count_cost_ceiling_nano_usd bigint CHECK(count_cost_ceiling_nano_usd IS NULL OR count_cost_ceiling_nano_usd BETWEEN 0 AND 6169600),
  ADD COLUMN count_tariff_evidence_digest text CHECK(count_tariff_evidence_digest IS NULL OR count_tariff_evidence_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN count_tariff_reviewed_on text CHECK(count_tariff_reviewed_on IS NULL OR count_tariff_reviewed_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  ADD COLUMN generation_provider_request_id text CHECK(generation_provider_request_id IS NULL OR (length(generation_provider_request_id) BETWEEN 1 AND 128 AND generation_provider_request_id !~ '[[:cntrl:]]'));

CREATE FUNCTION public.canonical_call_provider_canary_reserve(
  session_value uuid, request_value text, basis_value text, binding_digest_value text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org uuid;s public.canonical_voice_sessions%ROWTYPE;existing public.canonical_call_provider_requests%ROWTYPE;moment timestamptz;month_value date;monthly public.polaris_provider_monthly_usage%ROWTYPE;project_spend numeric;project_cap numeric;identifier uuid;
BEGIN
 IF request_value IS NULL OR request_value !~ '^[a-f0-9]{64}$' OR basis_value IS NULL OR basis_value !~ '^[a-f0-9]{64}$' OR binding_digest_value IS NULL OR binding_digest_value !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Call canary admission invalid' USING ERRCODE='22023';END IF;
 SELECT organization_id INTO org FROM public.canonical_voice_sessions WHERE id=session_value;IF org IS NULL THEN RAISE EXCEPTION 'Call unavailable' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19000037::bigint);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,19000037));
 PERFORM public.canonical_call_provider_retire();
 SELECT * INTO s FROM public.canonical_voice_sessions WHERE id=session_value AND organization_id=org FOR UPDATE;moment:=clock_timestamp();
 IF s.status<>'active' OR s.provider<>'retell' OR s.canonical_operation_id IS NOT NULL OR s.started_at+interval '60 seconds'<=moment OR NOT EXISTS(SELECT 1 FROM public.canonical_integration_ownership i WHERE i.id=s.integration_ownership_id AND i.organization_id=org AND i.provider='retell' AND i.status='active') OR NOT EXISTS(SELECT 1 FROM public.canonical_business_profiles p WHERE p.id=s.business_profile_id AND p.organization_id=org AND p.is_active AND p.normalized_profile_hash=s.business_profile_hash) OR NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=org AND status='active' AND plan_type IN('Growth','Complete')) THEN RAISE EXCEPTION 'Call authority unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO existing FROM public.canonical_call_provider_requests WHERE voice_session_id=session_value AND request_hash=request_value;
 IF FOUND THEN IF existing.basis<>basis_value OR existing.canary_binding_digest IS DISTINCT FROM binding_digest_value THEN RAISE EXCEPTION 'Call canary request changed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('id',existing.id,'admitted',false,'state',existing.state,'organizationId',org);END IF;
 -- A synthetic canary admits at most one provider generation for the entire call.
 IF EXISTS(SELECT 1 FROM public.canonical_call_provider_requests WHERE voice_session_id=session_value) OR EXISTS(SELECT 1 FROM public.canonical_call_provider_requests WHERE organization_id=org AND state='reserved') OR (SELECT count(*) FROM public.canonical_call_provider_requests WHERE organization_id=org AND created_at>=(moment AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC')>=10 OR (SELECT count(*) FROM public.canonical_call_provider_requests WHERE created_at>=(moment AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC')>=100 THEN RETURN jsonb_build_object('admitted',false,'state','limited');END IF;
 month_value:=date_trunc('month',moment AT TIME ZONE 'UTC')::date;
 SELECT * INTO monthly FROM public.polaris_provider_monthly_usage WHERE organization_id=org AND month_start=month_value FOR UPDATE;
 IF NOT FOUND OR monthly.collected_subscription_revenue_cents<=0 OR monthly.reserved_cost_nano_usd+monthly.reconciled_cost_nano_usd+20000000>monthly.collected_subscription_revenue_cents::numeric*2000000 THEN RETURN jsonb_build_object('admitted',false,'state','limited');END IF;
 SELECT COALESCE(sum(reserved_cost_nano_usd+reconciled_cost_nano_usd),0) INTO project_spend FROM public.polaris_provider_monthly_usage WHERE month_start=month_value;
 SELECT greatest(100000000000::numeric,COALESCE(sum(m.collected_subscription_revenue_cents::numeric*2000000),0)*1.10) INTO project_cap FROM public.polaris_provider_monthly_usage m JOIN public.subscriptions subscription ON subscription.organization_id=m.organization_id WHERE m.month_start=month_value AND subscription.status='active' AND subscription.plan_type IN('Growth','Complete');
 IF project_spend+20000000>project_cap THEN RETURN jsonb_build_object('admitted',false,'state','limited');END IF;
 IF s.started_at+interval '60 seconds'<=clock_timestamp() THEN RAISE EXCEPTION 'Call expired' USING ERRCODE='42501';END IF;
 INSERT INTO public.canonical_call_provider_requests(organization_id,voice_session_id,request_hash,basis,month_start,lease_until,canary_binding_digest) VALUES(org,session_value,request_value,basis_value,month_value,clock_timestamp()+interval '25 seconds',binding_digest_value) RETURNING id INTO identifier;
 UPDATE public.polaris_provider_monthly_usage SET reserved_cost_nano_usd=reserved_cost_nano_usd+20000000,updated_at=clock_timestamp() WHERE organization_id=org AND month_start=month_value;
 RETURN jsonb_build_object('id',identifier,'admitted',true,'state','reserved','organizationId',org);
END $$;

CREATE FUNCTION public.canonical_call_provider_canary_reconcile(
  reservation_value uuid, value jsonb, binding_digest_value text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org uuid;item public.canonical_call_provider_requests%ROWTYPE;cost_value bigint:=20000000;input_value integer:=0;output_value integer:=0;state_value text:='unknown';safe boolean:=false;count_value jsonb;generation_value jsonb;
BEGIN
 IF binding_digest_value IS NULL OR binding_digest_value !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Call canary reconciliation invalid' USING ERRCODE='22023';END IF;
 IF value IS NULL OR octet_length(value::text)>4096 THEN value:='{}'::jsonb;END IF;
 SELECT organization_id INTO org FROM public.canonical_call_provider_requests WHERE id=reservation_value;IF org IS NULL THEN RAISE EXCEPTION 'Call reservation unavailable' USING ERRCODE='55000';END IF;
 PERFORM pg_advisory_xact_lock(19000037::bigint);PERFORM pg_advisory_xact_lock(hashtextextended(org::text,19000037));
 SELECT * INTO item FROM public.canonical_call_provider_requests WHERE id=reservation_value FOR UPDATE;
 IF item.canary_binding_digest IS DISTINCT FROM binding_digest_value THEN RAISE EXCEPTION 'Call canary binding changed' USING ERRCODE='40001';END IF;
 IF item.state<>'reserved' THEN IF item.state='unknown' OR item.usage IS NOT DISTINCT FROM value THEN RETURN jsonb_build_object('state',item.state,'alreadySettled',true);END IF;RAISE EXCEPTION 'Call reconciliation changed' USING ERRCODE='40001';END IF;
 count_value:=value->'count';generation_value:=value->'generation';
 IF item.lease_until>clock_timestamp()
    AND public.canonical_field_evidence_object_keys_exact(value,ARRAY['accountingVersion','costNanoUsd','inputTokens','outputTokens','outcome','count','generation']) IS TRUE
    AND value->>'accountingVersion'='northstar.openai.counted-generation.v1'
    AND value->>'costNanoUsd' ~ '^(0|[1-9][0-9]{0,8})$' AND value->>'inputTokens' ~ '^(0|[1-9][0-9]{0,4})$' AND value->>'outputTokens' ~ '^(0|[1-9][0-9]{0,3})$' AND value->>'outcome' IN('completed','refused','incomplete','failed')
    AND public.canonical_field_evidence_object_keys_exact(count_value,ARRAY['endpointVersion','requestDigest','responseDigest','inputTokens','costCeilingNanoUsd','tariffEvidenceDigest','tariffReviewedOn','outcomeClass','attemptCount','latencyMs']) IS TRUE
    AND count_value->>'endpointVersion'='openai.responses.input_tokens.v1' AND count_value->>'requestDigest' ~ '^[a-f0-9]{64}$' AND count_value->>'responseDigest' ~ '^[a-f0-9]{64}$'
    AND count_value->>'inputTokens' ~ '^(0|[1-9][0-9]{0,4})$' AND (count_value->>'inputTokens')::integer<=16000 AND count_value->>'costCeilingNanoUsd' ~ '^(0|[1-9][0-9]{0,6})$' AND (count_value->>'costCeilingNanoUsd')::bigint<=6169600 AND count_value->>'tariffEvidenceDigest' ~ '^[a-f0-9]{64}$' AND count_value->>'tariffReviewedOn' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND count_value->>'outcomeClass'='completed' AND count_value->>'attemptCount'='1' AND count_value->>'latencyMs' ~ '^(0|[1-9][0-9]{0,9})$'
    AND public.canonical_field_evidence_object_keys_exact(generation_value,ARRAY['inputTokens','outputTokens','costNanoUsd','latencyMs','attemptCount','outcomeClass','providerRequestId']) IS TRUE
    AND generation_value->>'inputTokens' ~ '^(0|[1-9][0-9]{0,4})$' AND (generation_value->>'inputTokens')::integer<=16000 AND generation_value->>'outputTokens' ~ '^(0|[1-9][0-9]{0,3})$' AND (generation_value->>'outputTokens')::integer<=8192 AND generation_value->>'costNanoUsd' ~ '^(0|[1-9][0-9]{0,8})$' AND (generation_value->>'costNanoUsd')::bigint<=13830400
    AND generation_value->>'latencyMs' ~ '^(0|[1-9][0-9]{0,9})$' AND generation_value->>'attemptCount'='1' AND generation_value->>'outcomeClass'=value->>'outcome' AND length(generation_value->>'providerRequestId') BETWEEN 1 AND 128 AND generation_value->>'providerRequestId' !~ '[[:cntrl:]]'
    AND (value->>'costNanoUsd')::bigint=(count_value->>'costCeilingNanoUsd')::bigint+(generation_value->>'costNanoUsd')::bigint
    AND (value->>'inputTokens')::integer=(generation_value->>'inputTokens')::integer AND (value->>'outputTokens')::integer=(generation_value->>'outputTokens')::integer
 THEN safe:=(value->>'costNanoUsd')::bigint<=20000000;END IF;
 IF safe THEN cost_value:=(value->>'costNanoUsd')::bigint;input_value:=(value->>'inputTokens')::integer;output_value:=(value->>'outputTokens')::integer;state_value:=CASE WHEN value->>'outcome'='completed' THEN 'completed' ELSE 'failed' END;END IF;
 UPDATE public.polaris_provider_monthly_usage SET reserved_cost_nano_usd=reserved_cost_nano_usd-item.reserved_cost_nano_usd,reconciled_cost_nano_usd=reconciled_cost_nano_usd+cost_value,input_tokens=input_tokens+input_value,output_tokens=output_tokens+output_value,completed_requests=completed_requests+CASE WHEN state_value='completed' THEN 1 ELSE 0 END,failed_requests=failed_requests+CASE WHEN state_value='completed' THEN 0 ELSE 1 END,updated_at=clock_timestamp() WHERE organization_id=org AND month_start=item.month_start;
 IF NOT FOUND AND item.month_start >= (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '12 months')::date THEN RAISE EXCEPTION 'Call accounting unavailable' USING ERRCODE='55000';END IF;
 UPDATE public.canonical_call_provider_requests SET state=state_value,actual_cost_nano_usd=cost_value,settled_at=clock_timestamp(),usage=value,count_endpoint_version=CASE WHEN safe THEN count_value->>'endpointVersion' END,count_request_digest=CASE WHEN safe THEN count_value->>'requestDigest' END,count_response_digest=CASE WHEN safe THEN count_value->>'responseDigest' END,count_input_tokens=CASE WHEN safe THEN (count_value->>'inputTokens')::integer END,count_cost_ceiling_nano_usd=CASE WHEN safe THEN (count_value->>'costCeilingNanoUsd')::bigint END,count_tariff_evidence_digest=CASE WHEN safe THEN count_value->>'tariffEvidenceDigest' END,count_tariff_reviewed_on=CASE WHEN safe THEN count_value->>'tariffReviewedOn' END,generation_provider_request_id=CASE WHEN safe THEN generation_value->>'providerRequestId' END WHERE id=item.id;
 RETURN jsonb_build_object('state',state_value,'alreadySettled',false);
END $$;

REVOKE ALL ON FUNCTION public.canonical_call_provider_canary_reserve(uuid,text,text,text),public.canonical_call_provider_canary_reconcile(uuid,jsonb,text) FROM PUBLIC;
