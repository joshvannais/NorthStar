-- Mission 26 Part 3D: private, source-owned one-origin pairing of the two
-- installed deterministic selected-M24 versions. This is comparison input,
-- not an aggregate evaluation or promotion decision.
CREATE FUNCTION public.canonical_forecast_price_flow_matched_algorithms(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 base_run_value UUID,candidate_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 candidate public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 base_source JSONB; candidate_source JSONB;
 base_actual JSONB; candidate_actual JSONB;
 candidate_request TEXT; base_registry TEXT; candidate_registry TEXT;
 base_installed TEXT; candidate_installed TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  base_run_value IS NULL OR candidate_run_value IS NULL OR
  base_run_value=candidate_run_value THEN
  RAISE EXCEPTION 'Algorithm pair input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO base FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=base_run_value;
 SELECT * INTO candidate FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=candidate_run_value;
 IF base.id IS NULL OR candidate.id IS NULL THEN
  RETURN jsonb_build_object('state','matched_algorithms_unavailable',
   'reason','run_not_found','matched',FALSE);
 END IF;
 SELECT implementation_digest INTO base_registry
  FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version='m26_price_flow_carry_forward_v1';
 SELECT implementation_digest INTO candidate_registry
  FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version='m26_price_flow_zero_baseline_v1';
 base_installed:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_capture_price_flow_origin(uuid,uuid,text,uuid,text,text,uuid,text,timestamptz,timestamptz)'::regprocedure),
  'UTF8')),'hex');
 candidate_installed:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_capture_price_flow_zero_baseline(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure),
  'UTF8')),'hex');
 IF base_registry IS DISTINCT FROM base_installed OR
  candidate_registry IS DISTINCT FROM candidate_installed THEN
  RETURN jsonb_build_object('state','matched_algorithms_unavailable',
   'reason','algorithm_registration_unverified','matched',FALSE);
 END IF;
 candidate_request:=public.canonical_completion_digest(jsonb_build_object(
  'baseRunId',base.id,'algorithmVersion',
  'm26_price_flow_zero_baseline_v1'));
 IF base.output->>'calculationVersion' IS DISTINCT FROM
    'm26_price_flow_carry_forward_v1' OR
  candidate.output->>'calculationVersion' IS DISTINCT FROM
    'm26_price_flow_zero_baseline_v1' OR
  candidate.request_digest IS DISTINCT FROM candidate_request OR
  base.source_receipt_id<>candidate.source_receipt_id OR
  base.horizon_start<>candidate.horizon_start OR
  base.horizon_end<>candidate.horizon_end OR
  base.output->'target'<>candidate.output->'target' OR
  base.output->'unit'<>candidate.output->'unit' OR
  base.output->>'sourceSnapshotDigest' IS DISTINCT FROM
    candidate.output->>'sourceSnapshotDigest' OR
  candidate.output->'value' IS DISTINCT FROM
    '{"kind":"point","amount":"0.00"}'::jsonb THEN
  RETURN jsonb_build_object('state','matched_algorithms_unavailable',
   'reason','source_context_mismatch','matched',FALSE);
 END IF;
 base_source:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,base.id);
 candidate_source:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,candidate.id);
 IF base_source->>'state' IS DISTINCT FROM 'pair_source_verified' OR
  candidate_source->>'state' IS DISTINCT FROM 'pair_source_verified' OR
  base_source->>'profileAnchorId' IS DISTINCT FROM
    candidate_source->>'profileAnchorId' OR
  base_source->>'sourceSnapshotAsOf' IS DISTINCT FROM
    candidate_source->>'sourceSnapshotAsOf' THEN
  RETURN jsonb_build_object('state','matched_algorithms_unavailable',
   'reason','source_proof_unavailable','matched',FALSE);
 END IF;
 base_actual:=public.canonical_forecast_price_flow_pair_actual_read(
  org,actor,role_value,session_value,base.id);
 candidate_actual:=public.canonical_forecast_price_flow_pair_actual_read(
  org,actor,role_value,session_value,candidate.id);
 IF base_actual->>'state'='pair_actual_known' AND
  candidate_actual->>'state'='pair_actual_known' AND
  (base_actual->>'amount' IS DISTINCT FROM candidate_actual->>'amount' OR
   base_actual->>'sourceDigest' IS DISTINCT FROM
     candidate_actual->>'sourceDigest' OR
   base_actual->>'observedThrough' IS DISTINCT FROM
     candidate_actual->>'observedThrough') THEN
  RETURN jsonb_build_object('state','matched_algorithms_unavailable',
   'reason','actual_source_mismatch','matched',FALSE);
 END IF;
 RETURN jsonb_build_object('state','matched_algorithms_observed',
  'matched',TRUE,'baseRunId',base.id,'candidateRunId',candidate.id,
  'horizonStart',public.canonical_forecast_utc_instant(base.horizon_start),
  'horizonEnd',public.canonical_forecast_utc_instant(base.horizon_end),
  'sourceReceiptId',base.source_receipt_id,
  'profileAnchorId',base_source->>'profileAnchorId',
  'baseOutput',base_source->'output',
  'candidateOutput',candidate_source->'output',
  'baseActual',base_actual,'candidateActual',candidate_actual,
  'actualPairStatus',CASE
   WHEN base_actual->>'state'='pair_actual_known' AND
    candidate_actual->>'state'='pair_actual_known' THEN 'paired'
   WHEN base_actual->>'state'='pair_actual_revoked' OR
    candidate_actual->>'state'='pair_actual_revoked' THEN 'revoked'
   WHEN (base_actual->>'state'='pair_actual_unavailable' AND
     base_actual->>'reason' IS DISTINCT FROM 'no_saved_actual') OR
    (candidate_actual->>'state'='pair_actual_unavailable' AND
     candidate_actual->>'reason' IS DISTINCT FROM 'no_saved_actual') THEN
     'unavailable'
   WHEN base_actual->>'state'='pair_actual_known' OR
    candidate_actual->>'state'='pair_actual_known' THEN 'partial'
   ELSE 'missing' END,
  'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_matched_algorithms(
 UUID,UUID,TEXT,UUID,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_matched_algorithms(
  UUID,UUID,TEXT,UUID,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
