-- Mission 26 Part 3C: inventory every stored selected-M24 origin in the
-- capture-time span of one saved two-origin evaluation. This bounded inventory
-- cannot prove that an origin was created on every day or that off-platform
-- sources were captured. It can detect cherry-picking among stored origins.
CREATE FUNCTION public.canonical_forecast_price_flow_evaluation_population(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE guarded JSONB;
 saved public.canonical_forecast_price_flow_evaluations%ROWTYPE;
 first_origin public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 second_origin public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 item public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 source_state JSONB; actual_state JSONB; origin_rows JSONB:='[]'::jsonb;
 window_start TIMESTAMPTZ; window_end TIMESTAMPTZ;
 total_count INTEGER:=0; eligible_count INTEGER:=0;
 omitted_count INTEGER:=0; selected_matched INTEGER:=0;
 selected BOOLEAN; context_matches BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Evaluation population requires read committed'
   USING ERRCODE='25001';
 END IF;
 guarded:=public.canonical_forecast_price_flow_evaluation_private_read(
  org,actor,role_value,session_value,evaluation_value);
 IF guarded->>'state'<>'evaluation_measurement_source_verified' THEN
  RETURN jsonb_build_object('state','evaluation_population_unavailable',
   'reason','guarded_evaluation_unavailable');
 END IF;
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_evaluations
  WHERE organization_id=org AND id=evaluation_value;
 SELECT * INTO first_origin FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=saved.first_run_id;
 SELECT * INTO second_origin FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=saved.second_run_id;
 IF first_origin.id IS NULL OR second_origin.id IS NULL THEN
  RETURN jsonb_build_object('state','evaluation_population_unavailable',
   'reason','saved_origin_missing');
 END IF;
 window_start:=LEAST(first_origin.saved_at,second_origin.saved_at);
 window_end:=GREATEST(first_origin.saved_at,second_origin.saved_at);
 FOR item IN
  SELECT * FROM public.canonical_forecast_price_flow_saved_origins
   WHERE organization_id=org AND saved_at>=window_start AND saved_at<=window_end
   ORDER BY saved_at,id LIMIT 101
 LOOP
  total_count:=total_count+1;
  IF total_count>100 THEN
   RETURN jsonb_build_object('state','evaluation_population_unavailable',
    'reason','bounded_inventory_limit_exceeded');
  END IF;
  selected:=item.id IN (saved.first_run_id,saved.second_run_id);
  context_matches:=item.output->'target'=saved.result->'target' AND
   item.output->'unit'=saved.result->'unit' AND
   item.output->'applicability'=saved.result->'applicability' AND
   item.output->>'calculationVersion'=saved.result->>'calculationVersion';
  IF context_matches THEN
   eligible_count:=eligible_count+1;
   IF selected THEN selected_matched:=selected_matched+1;
   ELSE omitted_count:=omitted_count+1; END IF;
   source_state:=public.canonical_forecast_price_flow_pair_source_read(
    org,actor,role_value,session_value,item.id);
   actual_state:=public.canonical_forecast_price_flow_pair_actual_read(
    org,actor,role_value,session_value,item.id);
  ELSE
   source_state:=NULL; actual_state:=NULL;
  END IF;
  origin_rows:=origin_rows||jsonb_build_array(jsonb_build_object(
   'runId',item.id,'selected',selected,
   'eligibility',CASE WHEN context_matches THEN 'matching_context'
    ELSE 'excluded_context' END,
   'sourceState',source_state->>'state',
   'actualState',actual_state->>'state'));
 END LOOP;
 RETURN jsonb_build_object(
  'state',CASE WHEN selected_matched=2 AND omitted_count=0 THEN
   'bounded_saved_origin_inventory_verified' ELSE
   'evaluation_selection_incomplete' END,
  'scope','stored_selected_m24_origins_between_selected_capture_times',
  'evaluationId',saved.id,
  'windowStart',public.canonical_forecast_utc_instant(window_start),
  'windowEnd',public.canonical_forecast_utc_instant(window_end),
  'storedOriginCount',total_count,'matchingContextCount',eligible_count,
  'excludedContextCount',total_count-eligible_count,
  'omittedMatchingCount',omitted_count,
  'unsavedOriginCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,
  'origins',origin_rows);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_evaluation_population(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_evaluation_population(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
