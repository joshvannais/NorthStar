-- Mission 26 Part 3D: a non-serving synthetic origin follows the owner's
-- current research choice. This is not a production algorithm promotion.
CREATE TABLE public.canonical_forecast_price_flow_research_selected_origins (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 base_run_id UUID NOT NULL,
 selected_run_id UUID NOT NULL,
 selection_event_id UUID REFERENCES public.canonical_forecast_price_flow_research_selections(id),
 algorithm_version TEXT NOT NULL REFERENCES public.canonical_forecast_price_flow_algorithms(algorithm_version),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 research_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(research_only),
 forecast_serving_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT forecast_serving_enabled),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,base_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,selected_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE TRIGGER canonical_forecast_price_flow_research_selected_origin_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_research_selected_origins
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_capture_research_selected_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,base_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_price_flow_research_selected_origins%ROWTYPE;
 choice public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 base_row public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 selected public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 reviewed JSONB; source_state JSONB; current_source JSONB; profile_state JSONB;
 zero JSONB;
 key_hash TEXT; request_hash TEXT; zero_key TEXT;
 chosen_run UUID; chosen_version TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    base_run_value IS NULL THEN
  RAISE EXCEPTION 'Research origin request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'baseRunId',base_run_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':'||actor::text||':research-selected-origin:'||key_hash,0));
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_research_selected_origins
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Research origin replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','research_selected_origin_saved',
   'selectionReceiptId',prior.id,
   'runId',prior.selected_run_id,'baseRunId',prior.base_run_id,
   'algorithmVersion',prior.algorithm_version,
   'selectionEventId',prior.selection_event_id,
   'replayed',TRUE,'researchOnly',TRUE,'forecastServingEnabled',FALSE,
   'preHorizonCommitVerified',FALSE);
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast profile source busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO base_row FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=base_run_value;
 IF base_row.id IS NULL OR base_row.output->>'calculationVersion'<>
    'm26_price_flow_carry_forward_v1' OR
    base_row.receipt_digest<>public.canonical_completion_digest(base_row.output) THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','base_origin_unavailable','forecastServingEnabled',FALSE);
 END IF;
 -- Both selected definitions must be chosen before the future outcome can
 -- become visible. The base run's separate activation proves its commit;
 -- this new research selection remains unverified until separately observed.
 IF clock_timestamp()>=base_row.horizon_start THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','origin_window_not_eligible','forecastServingEnabled',FALSE);
 END IF;
 source_state:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,base_run_value);
 current_source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,base_row.source_receipt_id);
 IF source_state->>'state' IS DISTINCT FROM 'pair_source_verified' OR
    current_source->>'state' IS DISTINCT FROM 'current' OR
    source_state->>'sourceReceiptDigest' IS DISTINCT FROM
      base_row.receipt_digest THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','base_source_unavailable','forecastServingEnabled',FALSE);
 END IF;
 profile_state:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,
  (source_state->>'profileAnchorId')::uuid,base_row.saved_at,clock_timestamp());
 IF profile_state->>'state' IS DISTINCT FROM
    'profile_effective_window_verified' THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','base_profile_source_changed','forecastServingEnabled',FALSE);
 END IF;
 SELECT * INTO choice FROM public.canonical_forecast_price_flow_research_selections
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF choice.id IS NOT NULL THEN
  reviewed:=public.canonical_forecast_price_flow_research_review(
   org,actor,role_value,session_value);
  IF reviewed->>'state' IS DISTINCT FROM 'research_review_ready' OR
     reviewed->>'comparisonDigest' IS DISTINCT FROM choice.comparison_digest OR
     (reviewed->>'currentRevision')::integer<>choice.revision THEN
   RETURN jsonb_build_object('state','research_selected_origin_unavailable',
    'reason','selection_evidence_changed','forecastServingEnabled',FALSE);
  END IF;
 END IF;
 chosen_version:=COALESCE(choice.algorithm_version,
  'm26_price_flow_carry_forward_v1');
 chosen_run:=base_run_value;
 IF chosen_version='m26_price_flow_zero_baseline_v1' THEN
  zero_key:=encode(sha256(convert_to('research-zero:'||key_value,'UTF8')),'hex');
  zero:=public.canonical_forecast_capture_price_flow_zero_baseline(
   org,actor,role_value,session_value,csrf,zero_key,base_run_value);
  IF zero->>'state' IS DISTINCT FROM 'saved_price_flow_origin' THEN
   RETURN jsonb_build_object('state','research_selected_origin_unavailable',
    'reason',COALESCE(zero->>'reason','selected_origin_unavailable'),
    'forecastServingEnabled',FALSE);
  END IF;
  chosen_run:=(zero->>'runId')::uuid;
 END IF;
 SELECT * INTO selected FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen_run;
 IF selected.id IS NULL OR selected.output->>'calculationVersion'<>
    chosen_version OR selected.horizon_start<>base_row.horizon_start OR
    selected.horizon_end<>base_row.horizon_end OR
    selected.source_receipt_id<>base_row.source_receipt_id THEN
  RAISE EXCEPTION 'Research selected origin mismatch' USING ERRCODE='23514';
 END IF;
 IF clock_timestamp()>=base_row.horizon_start THEN
  RAISE EXCEPTION 'Research selection crossed horizon before insert'
   USING ERRCODE='23514';
 END IF;
 INSERT INTO public.canonical_forecast_price_flow_research_selected_origins(
  organization_id,base_run_id,selected_run_id,selection_event_id,
  algorithm_version,actor_user_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,base_run_value,chosen_run,choice.id,chosen_version,
  actor,session_value,key_hash,request_hash) RETURNING * INTO prior;
 IF clock_timestamp()>=base_row.horizon_start THEN
  -- Also catch a testable delayed insert (for example a trigger wait).
  -- The transaction rolls back the sidecar and any newly inserted zero run.
  RAISE EXCEPTION 'Research selection crossed horizon after insert'
   USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object('state','research_selected_origin_saved',
  'selectionReceiptId',prior.id,
  'runId',prior.selected_run_id,'baseRunId',prior.base_run_id,
  'algorithmVersion',prior.algorithm_version,
  'selectionEventId',prior.selection_event_id,
  'replayed',FALSE,'researchOnly',TRUE,'forecastServingEnabled',FALSE,
  'preHorizonCommitVerified',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_selected_origins FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_research_selected_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_selected_origins
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_research_selected_price_flow_origin(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID)
  TO northstar_app_runtime;
END IF; END $$;
