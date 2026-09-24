-- Mission 26 Part 3B: bounded, tenant-private status manifest for one saved
-- selected-M24 two-origin evaluation. Numerical results stay in the private
-- immutable row and are never returned to the paid reader.
ALTER TABLE public.canonical_forecast_price_flow_evaluations
 ADD COLUMN source_provenance JSONB NOT NULL DEFAULT jsonb_build_object(
  'outcomeReaderVersion','selected_m24_price_flow_actual_v1',
  'sourceScope','northstar_m24_ordered_price_only',
  'permissionAtCapture','authorized_owner_or_admin',
  'retentionApplicability','no_m24_expiry_policy'),
 ADD CONSTRAINT canonical_forecast_price_flow_evaluations_provenance_check
 CHECK(source_provenance=jsonb_build_object(
  'outcomeReaderVersion','selected_m24_price_flow_actual_v1',
  'sourceScope','northstar_m24_ordered_price_only',
  'permissionAtCapture','authorized_owner_or_admin',
  'retentionApplicability','no_m24_expiry_policy'));

CREATE FUNCTION public.canonical_forecast_price_flow_evaluation_manifest(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_evaluations%ROWTYPE;
 item JSONB; run_value UUID; source_state JSONB; actual_state JSONB;
 profile_state JSONB; origin_rows JSONB:='[]'::jsonb;
 current_state TEXT; reason_value TEXT; paired_count INTEGER:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  evaluation_value IS NULL THEN
  RAISE EXCEPTION 'Evaluation manifest request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_evaluations
  WHERE organization_id=org AND id=evaluation_value;
 IF saved.id IS NULL THEN
  RETURN jsonb_build_object('state','evaluation_manifest_unavailable',
   'reason','evaluation_not_found');
 END IF;
 IF jsonb_typeof(saved.result->'comparisons')<>'array' OR
  jsonb_array_length(saved.result->'comparisons')<>2 THEN
  RETURN jsonb_build_object('state','evaluation_manifest_unavailable',
   'reason','saved_result_invalid');
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(saved.result->'comparisons') LOOP
  run_value:=(item->>'forecastRunId')::uuid;
  source_state:=public.canonical_forecast_price_flow_pair_source_read(
   org,actor,role_value,session_value,run_value);
  actual_state:=public.canonical_forecast_price_flow_pair_actual_read(
   org,actor,role_value,session_value,run_value);
  IF source_state->>'state'<>'pair_source_verified' THEN
   current_state:='stale'; reason_value:='source_evidence_unavailable';
  ELSE
   profile_state:=public.canonical_forecast_profile_effective_window(
    org,actor,role_value,session_value,
    (source_state->>'profileAnchorId')::uuid,
    (source_state->'output'->'horizon'->>'startsAt')::timestamptz,
    (source_state->'output'->'horizon'->>'endsAt')::timestamptz);
   IF profile_state->>'state'<>'profile_effective_window_verified' THEN
    current_state:='excluded'; reason_value:='profile_period_unavailable';
   ELSIF item->>'outcomeReceiptId' IS NULL AND
    actual_state->>'state'='pair_actual_known' THEN
    current_state:='late_outcome'; reason_value:='later_actual_available';
   ELSIF item->>'outcomeReceiptId' IS NULL AND
    actual_state->>'state'='pair_actual_revoked' THEN
    current_state:='revoked'; reason_value:='actual_revoked';
   ELSIF item->>'outcomeReceiptId' IS DISTINCT FROM
    actual_state->>'receiptId' THEN
    current_state:='stale'; reason_value:='actual_revision_changed';
   ELSIF item->>'status'='paired' AND
    actual_state->>'state'='pair_actual_known' THEN
    current_state:='paired'; reason_value:=NULL;
    paired_count:=paired_count+1;
   ELSIF item->>'status'='window_normalization_required' THEN
    current_state:='excluded'; reason_value:='window_normalization_required';
   ELSIF actual_state->>'state'='pair_actual_unavailable' AND
    actual_state->>'reason'='no_saved_actual' THEN
    current_state:='missing'; reason_value:='actual_not_recorded';
   ELSIF actual_state->>'state'='pair_actual_unavailable' AND
    actual_state->>'reason'='source_changed' THEN
    current_state:='stale'; reason_value:='actual_source_changed';
   ELSIF actual_state->>'state'='pair_actual_unavailable' AND
    actual_state->>'reason'='actual_commit_unverified' THEN
    current_state:='excluded'; reason_value:='actual_commit_unverified';
   ELSIF actual_state->>'state'='pair_actual_unavailable' THEN
    current_state:='excluded'; reason_value:='actual_evidence_unavailable';
   ELSE
    current_state:='excluded';
    reason_value:=COALESCE(item->>'reason','source_evidence_unavailable');
   END IF;
  END IF;
  origin_rows:=origin_rows||jsonb_build_array(jsonb_build_object(
   'forecastRunId',run_value,'savedStatus',item->>'status',
   'currentStatus',current_state,'reason',reason_value,
   'outcomeReaderVersion',saved.source_provenance->>'outcomeReaderVersion',
   'sourceScope',saved.source_provenance->>'sourceScope',
   'permissionAtCapture',saved.source_provenance->>'permissionAtCapture',
   'permissionAtRead','authorized',
   'retentionApplicability',saved.source_provenance->>'retentionApplicability'));
 END LOOP;
 RETURN jsonb_build_object('state','evaluation_manifest_available',
  'evaluationId',saved.id,'revision',saved.revision,
  'previousId',saved.previous_id,'originCount',2,
  'pairedCount',paired_count,'origins',origin_rows,
  'accuracyAvailable',FALSE,'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_evaluation_manifest(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_evaluation_manifest(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
