-- A future synthetic selected-M24 run follows the current human active
-- algorithm event. The selected output remains private and non-serving.
ALTER TABLE public.canonical_forecast_price_flow_active_algorithms
 ADD CONSTRAINT canonical_forecast_price_flow_active_tenant_id
 UNIQUE(organization_id,id);

CREATE TABLE public.canonical_forecast_price_flow_active_origins (
 organization_id UUID NOT NULL,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 active_event_id UUID NOT NULL,
 base_run_id UUID NOT NULL,
 selected_run_id UUID NOT NULL,
 algorithm_version TEXT NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 paid_numeric_serving BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT paid_numeric_serving),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,active_event_id)
  REFERENCES public.canonical_forecast_price_flow_active_algorithms(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,base_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,selected_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT
);
CREATE TRIGGER canonical_forecast_price_flow_active_origins_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_flow_active_origins
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE TABLE public.canonical_forecast_price_flow_active_origin_activations (
 organization_id UUID NOT NULL,
 origin_receipt_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 proof JSONB NOT NULL,
 proof_digest TEXT NOT NULL CHECK(proof_digest~'^[a-f0-9]{64}$'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 PRIMARY KEY(organization_id,origin_receipt_id),
 FOREIGN KEY(organization_id,origin_receipt_id)
  REFERENCES public.canonical_forecast_price_flow_active_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT,
 CHECK(proof->>'state'='active_origin_activated'),
 CHECK(proof->'preHorizonCommitVerified'='true'::jsonb),
 CHECK(proof->'paidNumericServing'='false'::jsonb),
 CHECK(proof_digest=public.canonical_completion_digest(proof))
);
CREATE TRIGGER canonical_forecast_price_flow_active_origin_activations_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_flow_active_origin_activations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_capture_active_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,base_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_price_flow_active_origins%ROWTYPE;
 base_row public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 selected public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 active_state JSONB; active_event public.canonical_forecast_price_flow_active_algorithms%ROWTYPE;
 source_state JSONB; current_source JSONB; profile_state JSONB; zero JSONB;
 key_hash TEXT; request_hash TEXT; zero_key TEXT;
 chosen_run UUID;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    base_run_value IS NULL THEN
  RAISE EXCEPTION 'Active origin request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'baseRunId',base_run_value));
 PERFORM set_config('lock_timeout','28000ms',TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':'||actor::text||':active-origin:'||key_hash,0));
 PERFORM set_config('lock_timeout','2000ms',TRUE);
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_active_origins
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Active origin replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','active_origin_saved',
   'originReceiptId',prior.id,'runId',prior.selected_run_id,
   'baseRunId',prior.base_run_id,'activeEventId',prior.active_event_id,
   'algorithmVersion',prior.algorithm_version,'replayed',TRUE,
   'paidNumericServing',FALSE,'preHorizonCommitVerified',FALSE);
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
    base_row.receipt_digest<>public.canonical_completion_digest(base_row.output) OR
    clock_timestamp()>=base_row.horizon_start THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','base_origin_unavailable','paidNumericServing',FALSE);
 END IF;
 source_state:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,base_run_value);
 current_source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,base_row.source_receipt_id);
 IF source_state->>'state' IS DISTINCT FROM 'pair_source_verified' OR
    current_source->>'state' IS DISTINCT FROM 'current' OR
    source_state->>'sourceReceiptDigest' IS DISTINCT FROM
      base_row.receipt_digest THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','base_source_unavailable','paidNumericServing',FALSE);
 END IF;
 profile_state:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,
  (source_state->>'profileAnchorId')::uuid,base_row.saved_at,clock_timestamp());
 IF profile_state->>'state' IS DISTINCT FROM
    'profile_effective_window_verified' THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','base_profile_source_changed','paidNumericServing',FALSE);
 END IF;
 active_state:=public.canonical_forecast_price_flow_active_read(
  org,actor,role_value,session_value,base_run_value);
 IF active_state->>'state' IS DISTINCT FROM 'active_algorithm_current' THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','active_choice_unavailable','paidNumericServing',FALSE);
 END IF;
 SELECT * INTO active_event FROM public.canonical_forecast_price_flow_active_algorithms
  WHERE organization_id=org AND id=(active_state->>'eventId')::uuid;
 IF active_event.id IS NULL OR active_event.algorithm_version IS DISTINCT FROM
    active_state->>'algorithmVersion' OR active_event.paid_numeric_serving THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','active_choice_mismatch','paidNumericServing',FALSE);
 END IF;
 chosen_run:=base_run_value;
 IF active_event.algorithm_version='m26_price_flow_zero_baseline_v1' THEN
  zero_key:=encode(sha256(convert_to('active-zero:'||key_value,'UTF8')),'hex');
  zero:=public.canonical_forecast_capture_price_flow_zero_baseline(
   org,actor,role_value,session_value,csrf,zero_key,base_run_value);
  IF zero->>'state' IS DISTINCT FROM 'saved_price_flow_origin' THEN
   RETURN jsonb_build_object('state','active_origin_unavailable',
    'reason',COALESCE(zero->>'reason','selected_origin_unavailable'),
    'paidNumericServing',FALSE);
  END IF;
  chosen_run:=(zero->>'runId')::uuid;
 END IF;
 SELECT * INTO selected FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen_run;
 IF selected.id IS NULL OR selected.output->>'calculationVersion' IS DISTINCT FROM
    active_event.algorithm_version OR
    selected.horizon_start<>base_row.horizon_start OR
    selected.horizon_end<>base_row.horizon_end OR
    selected.source_receipt_id<>base_row.source_receipt_id OR
    selected.receipt_digest<>public.canonical_completion_digest(selected.output) THEN
  RAISE EXCEPTION 'Active selected origin mismatch' USING ERRCODE='23514';
 END IF;
 IF clock_timestamp()>=base_row.horizon_start THEN
  RAISE EXCEPTION 'Active selection crossed horizon before insert'
   USING ERRCODE='23514';
 END IF;
 INSERT INTO public.canonical_forecast_price_flow_active_origins(
  organization_id,active_event_id,base_run_id,selected_run_id,
  algorithm_version,actor_user_id,auth_session_id,request_key_hash,request_digest)
 VALUES(org,active_event.id,base_run_value,chosen_run,active_event.algorithm_version,
  actor,session_value,key_hash,request_hash) RETURNING * INTO prior;
 IF clock_timestamp()>=base_row.horizon_start THEN
  RAISE EXCEPTION 'Active selection crossed horizon after insert'
   USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object('state','active_origin_saved',
  'originReceiptId',prior.id,'runId',prior.selected_run_id,
  'baseRunId',prior.base_run_id,'activeEventId',prior.active_event_id,
  'algorithmVersion',prior.algorithm_version,'replayed',FALSE,
  'paidNumericServing',FALSE,'preHorizonCommitVerified',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_activate_active_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE chosen public.canonical_forecast_price_flow_active_origins%ROWTYPE;
 base public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 selected public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 prior public.canonical_forecast_price_flow_active_origin_activations%ROWTYPE;
 active_state JSONB; source_state JSONB; current_source JSONB; profile_state JSONB;
 chosen_xid XID8; selected_xid XID8; observed TIMESTAMPTZ; proof_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    origin_value IS NULL THEN
  RAISE EXCEPTION 'Active activation request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast profile source busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO chosen FROM public.canonical_forecast_price_flow_active_origins
  WHERE organization_id=org AND id=origin_value;
 IF chosen.id IS NULL THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','origin_not_found','preHorizonCommitVerified',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_active_origin_activations
  WHERE organization_id=org AND origin_receipt_id=origin_value;
 IF prior.origin_receipt_id IS NOT NULL THEN
  RETURN prior.proof||jsonb_build_object('proofDigest',prior.proof_digest,
   'replayed',TRUE);
 END IF;
 active_state:=public.canonical_forecast_price_flow_active_read(
  org,actor,role_value,session_value,chosen.base_run_id);
 IF active_state->>'state' IS DISTINCT FROM 'active_algorithm_current' OR
    active_state->>'eventId' IS DISTINCT FROM chosen.active_event_id::text OR
    active_state->>'algorithmVersion' IS DISTINCT FROM chosen.algorithm_version THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','active_choice_changed','preHorizonCommitVerified',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 SELECT * INTO base FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen.base_run_id;
 SELECT * INTO selected FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen.selected_run_id;
 IF base.id IS NULL OR selected.id IS NULL OR
    base.output->>'calculationVersion' IS DISTINCT FROM
      'm26_price_flow_carry_forward_v1' OR
    selected.output->>'calculationVersion' IS DISTINCT FROM
      chosen.algorithm_version OR
    selected.horizon_start<>base.horizon_start OR
    selected.horizon_end<>base.horizon_end OR
    selected.source_receipt_id<>base.source_receipt_id OR
    selected.receipt_digest<>public.canonical_completion_digest(selected.output) THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','origin_lineage_unverified','preHorizonCommitVerified',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO chosen_xid
  FROM public.canonical_forecast_price_flow_active_origins
  WHERE organization_id=org AND id=origin_value;
 SELECT xmin::text::xid8 INTO selected_xid
  FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen.selected_run_id;
 IF pg_xact_status(chosen_xid)='in progress' OR
    pg_xact_status(selected_xid)='in progress' THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','origin_commit_not_observed','preHorizonCommitVerified',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 source_state:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,chosen.base_run_id);
 current_source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,base.source_receipt_id);
 IF source_state->>'state' IS DISTINCT FROM 'pair_source_verified' OR
    current_source->>'state' IS DISTINCT FROM 'current' THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','source_changed','preHorizonCommitVerified',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 observed:=clock_timestamp();
 profile_state:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,
  (source_state->>'profileAnchorId')::uuid,base.saved_at,observed);
 IF profile_state->>'state' IS DISTINCT FROM
    'profile_effective_window_verified' THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','base_profile_source_changed','preHorizonCommitVerified',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 IF observed>=base.horizon_start OR chosen.captured_at>=base.horizon_start THEN
  RETURN jsonb_build_object('state','active_origin_unavailable',
   'reason','origin_commit_not_observed_before_horizon',
   'preHorizonCommitVerified',FALSE,'paidNumericServing',FALSE);
 END IF;
 proof_value:=jsonb_build_object('state','active_origin_activated',
  'originReceiptId',chosen.id,'runId',chosen.selected_run_id,
  'baseRunId',chosen.base_run_id,'algorithmVersion',chosen.algorithm_version,
  'activeEventId',chosen.active_event_id,
  'originCommitObservedAt',public.canonical_forecast_utc_instant(observed),
  'horizonStartsAt',public.canonical_forecast_utc_instant(base.horizon_start),
  'preHorizonCommitVerified',TRUE,'paidNumericServing',FALSE,
  'realForecastEligible',FALSE);
 INSERT INTO public.canonical_forecast_price_flow_active_origin_activations(
  organization_id,origin_receipt_id,observed_at,proof,proof_digest,
  actor_user_id,auth_session_id)
 VALUES(org,origin_value,observed,proof_value,
  public.canonical_completion_digest(proof_value),actor,session_value)
 ON CONFLICT (organization_id,origin_receipt_id) DO NOTHING;
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_active_origin_activations
  WHERE organization_id=org AND origin_receipt_id=origin_value;
 IF prior.origin_receipt_id IS NULL THEN
  RAISE EXCEPTION 'Active origin activation unavailable' USING ERRCODE='40001';
 END IF;
 RETURN prior.proof||jsonb_build_object('proofDigest',prior.proof_digest,
  'replayed',prior.observed_at<>observed);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_active_origins,
 public.canonical_forecast_price_flow_active_origin_activations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_active_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_activate_active_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_active_origins,
  public.canonical_forecast_price_flow_active_origin_activations
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_active_price_flow_origin(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_activate_active_price_flow_origin(
  UUID,UUID,TEXT,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
