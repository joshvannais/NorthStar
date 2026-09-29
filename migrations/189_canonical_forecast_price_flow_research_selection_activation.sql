-- Mission 26 Part 3D: observe the selected research record's commit before
-- its future horizon in a separate transaction. This is not serving approval.
CREATE TABLE public.canonical_forecast_price_flow_research_selected_activations (
 organization_id UUID NOT NULL,
 selection_receipt_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 proof JSONB NOT NULL,
 proof_digest TEXT NOT NULL CHECK(proof_digest~'^[a-f0-9]{64}$'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 PRIMARY KEY(organization_id,selection_receipt_id),
 FOREIGN KEY(organization_id,selection_receipt_id)
  REFERENCES public.canonical_forecast_price_flow_research_selected_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CHECK(proof->>'state'='research_selected_origin_activated'),
 CHECK(proof->'preHorizonCommitVerified'='true'::jsonb),
 CHECK(proof->'forecastServingEnabled'='false'::jsonb),
 CHECK(proof_digest=public.canonical_completion_digest(proof))
);
CREATE TRIGGER canonical_forecast_price_flow_research_selected_activation_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_research_selected_activations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_activate_research_selected_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 selection_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE chosen public.canonical_forecast_price_flow_research_selected_origins%ROWTYPE;
 base public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 selected public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 prior public.canonical_forecast_price_flow_research_selected_activations%ROWTYPE;
 source_state JSONB; current_source JSONB; profile_state JSONB;
 chosen_xid XID8; selected_xid XID8;
 observed TIMESTAMPTZ; proof_value JSONB;
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
 -- READ COMMITTED exposes another transaction's row only after commit.
 -- Refuse only active transactions, including released subtransactions. Old
 -- committed/frozen rows do not need retained historical commit status.
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
 IF observed>=base.horizon_start OR chosen.captured_at>=base.horizon_start THEN
  RETURN jsonb_build_object('state','research_selected_origin_unavailable',
   'reason','selection_commit_not_observed_before_horizon',
   'preHorizonCommitVerified',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 proof_value:=jsonb_build_object('state','research_selected_origin_activated',
  'selectionReceiptId',chosen.id,'runId',chosen.selected_run_id,
  'baseRunId',chosen.base_run_id,'algorithmVersion',chosen.algorithm_version,
  'selectionEventId',chosen.selection_event_id,
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

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_selected_activations
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_activate_research_selected_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_selected_activations
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_activate_research_selected_price_flow_origin(
  UUID,UUID,TEXT,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
