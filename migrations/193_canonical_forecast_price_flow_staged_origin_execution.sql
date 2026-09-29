-- Mission 26 Part 3D: future fictional research origin follows the
-- staged tenant/context algorithm choice, not the moving research review.
-- Historical replay remains immutable; first activation checks the current
-- staged choice before observing the sidecar/run commits. Still non-serving.
ALTER TABLE public.canonical_forecast_price_flow_staged_algorithms
 ADD CONSTRAINT canonical_forecast_price_flow_staged_tenant_id
 UNIQUE(organization_id,id);
ALTER TABLE public.canonical_forecast_price_flow_research_selected_origins
 ADD COLUMN staged_event_id UUID,
 ADD CONSTRAINT canonical_forecast_price_flow_selected_staged_event_fk
 FOREIGN KEY(organization_id,staged_event_id)
 REFERENCES public.canonical_forecast_price_flow_staged_algorithms(organization_id,id)
 ON DELETE RESTRICT,
 -- Keep historical pre-193 rows readable, but reject every new row that an
 -- already-running pre-193 function body could try to insert after this table
 -- fence commits during a rolling deployment.
 ADD CONSTRAINT canonical_forecast_price_flow_selected_staged_event_required
 CHECK(staged_event_id IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION public.canonical_forecast_capture_research_selected_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,base_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_price_flow_research_selected_origins%ROWTYPE;
 choice public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 base_row public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 selected public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 staged JSONB; stage_row public.canonical_forecast_price_flow_staged_algorithms%ROWTYPE;
 source_state JSONB; current_source JSONB; profile_state JSONB; zero JSONB;
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
 -- Serialize one actor/request key before taking the shared source locks so a
 -- concurrent retry waits for the first durable receipt and replays it.
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
   'stagedEventId',prior.staged_event_id,
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
 staged:=public.canonical_forecast_price_flow_staged_read(
  org,actor,role_value,session_value,base_run_value);
 IF staged->>'state' IS DISTINCT FROM 'staged_algorithm_current' THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','staged_choice_unavailable','forecastServingEnabled',FALSE);
 END IF;
 SELECT * INTO stage_row FROM public.canonical_forecast_price_flow_staged_algorithms
  WHERE organization_id=org AND id=(staged->>'eventId')::uuid;
 SELECT * INTO choice FROM public.canonical_forecast_price_flow_research_selections
  WHERE organization_id=org AND id=stage_row.research_event_id;
 IF stage_row.id IS NULL OR choice.id IS NULL OR
    choice.algorithm_version IS DISTINCT FROM stage_row.algorithm_version THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','staged_choice_mismatch','forecastServingEnabled',FALSE);
 END IF;
 chosen_version:=stage_row.algorithm_version;
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
  staged_event_id,algorithm_version,actor_user_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,base_run_value,chosen_run,choice.id,stage_row.id,chosen_version,
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
  'stagedEventId',prior.staged_event_id,
  'replayed',FALSE,'researchOnly',TRUE,'forecastServingEnabled',FALSE,
  'preHorizonCommitVerified',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_activate_research_selected_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 selection_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE chosen public.canonical_forecast_price_flow_research_selected_origins%ROWTYPE;
 base public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 selected public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 prior public.canonical_forecast_price_flow_research_selected_activations%ROWTYPE;
 staged JSONB; source_state JSONB; current_source JSONB; profile_state JSONB;
 chosen_xid XID8; selected_xid XID8; observed TIMESTAMPTZ; proof_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    selection_value IS NULL THEN
  RAISE EXCEPTION 'Research activation request invalid' USING ERRCODE='22023';
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
 SELECT * INTO chosen FROM public.canonical_forecast_price_flow_research_selected_origins
  WHERE organization_id=org AND id=selection_value;
 IF chosen.id IS NULL THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','selection_not_found','preHorizonCommitVerified',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_research_selected_activations
  WHERE organization_id=org AND selection_receipt_id=selection_value;
 IF prior.selection_receipt_id IS NOT NULL THEN
  RETURN prior.proof||jsonb_build_object('proofDigest',prior.proof_digest,
   'replayed',TRUE);
 END IF;
 SELECT * INTO base FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen.base_run_id;
 SELECT * INTO selected FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen.selected_run_id;
 IF base.id IS NULL OR selected.id IS NULL OR
    chosen.algorithm_version IS DISTINCT FROM
      selected.output->>'calculationVersion' OR
    base.output->>'calculationVersion' IS DISTINCT FROM
      'm26_price_flow_carry_forward_v1' OR
    selected.horizon_start<>base.horizon_start OR
    selected.horizon_end<>base.horizon_end OR
    selected.source_receipt_id<>base.source_receipt_id OR
    selected.receipt_digest<>public.canonical_completion_digest(selected.output) THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','selection_lineage_unverified',
   'preHorizonCommitVerified',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO chosen_xid
  FROM public.canonical_forecast_price_flow_research_selected_origins
  WHERE organization_id=org AND id=selection_value;
 SELECT xmin::text::xid8 INTO selected_xid
  FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=chosen.selected_run_id;
 -- READ COMMITTED can only see another transaction's row after commit. Refuse
 -- active transactions, including released subtransactions; old committed or
 -- frozen rows do not depend on retained transaction-status history.
 IF pg_xact_status(chosen_xid)='in progress' OR
    pg_xact_status(selected_xid)='in progress' THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','selection_commit_not_observed',
   'preHorizonCommitVerified',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 source_state:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,chosen.base_run_id);
 current_source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,base.source_receipt_id);
 IF source_state->>'state' IS DISTINCT FROM 'pair_source_verified' OR
    current_source->>'state' IS DISTINCT FROM 'current' THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','source_changed','preHorizonCommitVerified',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 observed:=clock_timestamp();
 profile_state:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,
  (source_state->>'profileAnchorId')::uuid,base.saved_at,observed);
 IF profile_state->>'state' IS DISTINCT FROM
    'profile_effective_window_verified' THEN
 RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','base_profile_source_changed','preHorizonCommitVerified',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 IF chosen.staged_event_id IS NULL THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','staged_choice_missing','preHorizonCommitVerified',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 staged:=public.canonical_forecast_price_flow_staged_read(
  org,actor,role_value,session_value,chosen.base_run_id);
 IF staged->>'state' IS DISTINCT FROM 'staged_algorithm_current' OR
    staged->>'eventId' IS DISTINCT FROM chosen.staged_event_id::text OR
    staged->>'algorithmVersion' IS DISTINCT FROM chosen.algorithm_version THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','staged_choice_changed','preHorizonCommitVerified',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 IF observed>=base.horizon_start OR chosen.captured_at>=base.horizon_start THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','selection_commit_not_observed_before_horizon',
   'preHorizonCommitVerified',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 proof_value:=jsonb_build_object('state','research_selected_origin_activated',
  'selectionReceiptId',chosen.id,'runId',chosen.selected_run_id,
  'baseRunId',chosen.base_run_id,'algorithmVersion',chosen.algorithm_version,
  'selectionEventId',chosen.selection_event_id,
  'stagedEventId',chosen.staged_event_id,
  'selectionCommitObservedAt',public.canonical_forecast_utc_instant(observed),
  'horizonStartsAt',public.canonical_forecast_utc_instant(base.horizon_start),
  'preHorizonCommitVerified',TRUE,'researchOnly',TRUE,
  'forecastServingEnabled',FALSE,'realForecastEligible',FALSE);
 INSERT INTO public.canonical_forecast_price_flow_research_selected_activations(
  organization_id,selection_receipt_id,observed_at,proof,proof_digest,
  actor_user_id,auth_session_id)
 VALUES(org,selection_value,observed,proof_value,
  public.canonical_completion_digest(proof_value),actor,session_value)
 ON CONFLICT (organization_id,selection_receipt_id)
 DO NOTHING;
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_research_selected_activations
  WHERE organization_id=org AND selection_receipt_id=selection_value;
 IF prior.selection_receipt_id IS NULL THEN
  RAISE EXCEPTION 'Research activation unavailable' USING ERRCODE='40001';
 END IF;
 RETURN prior.proof||jsonb_build_object('proofDigest',prior.proof_digest,
  'replayed',prior.observed_at<>observed);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_capture_research_selected_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_activate_research_selected_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
