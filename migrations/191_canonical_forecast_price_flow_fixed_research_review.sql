-- Mission 26 Part 3D: re-evaluate one reviewed registered-run cohort.
-- The fixed anchor prevents later completed runs outside its span from
-- silently changing the review population. Late in-span runs and changed
-- source/outcome evidence still make its digest change or fail closed.
-- This is non-serving research review, not production promotion.
CREATE FUNCTION public.canonical_forecast_price_flow_fixed_research_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 anchor_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE population JSONB; item JSONB; lag_ok BOOLEAN:=TRUE;
 horizon_end TIMESTAMPTZ; observed_through TIMESTAMPTZ;
 complete BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    anchor_run_value IS NULL THEN
  RAISE EXCEPTION 'Fixed review input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 population:=public.canonical_forecast_price_flow_matched_population_at_anchor(
  org,actor,role_value,session_value,anchor_run_value);
 IF population->>'state' IS DISTINCT FROM 'matched_population_observed' OR
    population->>'anchorRunId' IS DISTINCT FROM anchor_run_value::text THEN
  RETURN jsonb_build_object('state','fixed_research_review_unavailable',
   'reason','matched_population_unavailable','researchOnly',TRUE,
   'productionPromotionEligible',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 complete:=jsonb_typeof(population->'completeRegisteredPopulation')='boolean' AND
  population->'completeRegisteredPopulation'='true'::jsonb AND
  jsonb_typeof(population->'sourceEventDiversityVerified')='boolean' AND
  population->'sourceEventDiversityVerified'='true'::jsonb AND
  jsonb_typeof(population->'distinctSourceEventDays')='number' AND
  COALESCE((population->>'distinctSourceEventDays')::numeric=60,FALSE) AND
  jsonb_typeof(population->'items')='array' AND
  jsonb_array_length(population->'items')=60;
 IF complete IS TRUE THEN
  FOR item IN SELECT value FROM jsonb_array_elements(population->'items') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR
      jsonb_typeof(item->'baseActual') IS DISTINCT FROM 'object' OR
      jsonb_typeof(item->'candidateActual') IS DISTINCT FROM 'object' OR
      jsonb_typeof(item->'horizonEnd') IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'baseActual'->'observedThrough')
       IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'candidateActual'->'observedThrough')
       IS DISTINCT FROM 'string' OR
      item->>'horizonEnd' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' OR
      item->'baseActual'->>'observedThrough' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' OR
      item->'candidateActual'->>'observedThrough' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' OR
      item->>'state' IS DISTINCT FROM 'matched_algorithms_observed' OR
      item->>'actualPairStatus' IS DISTINCT FROM 'paired' OR
      item->'baseActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
      item->'candidateActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
      item->'baseActual'->>'observedThrough' IS DISTINCT FROM
       item->'candidateActual'->>'observedThrough' THEN
    lag_ok:=FALSE; EXIT;
   END IF;
   horizon_end:=(item->>'horizonEnd')::timestamptz;
   observed_through:=(item->'baseActual'->>'observedThrough')::timestamptz;
   IF observed_through IS NULL OR horizon_end IS NULL OR
      observed_through<horizon_end OR
      observed_through>horizon_end+INTERVAL '60 days' THEN
    lag_ok:=FALSE; EXIT;
   END IF;
  END LOOP;
 END IF;
 IF complete IS DISTINCT FROM TRUE OR lag_ok IS DISTINCT FROM TRUE THEN
  RETURN jsonb_build_object('state','fixed_research_review_unavailable',
   'reason',CASE WHEN complete IS DISTINCT FROM TRUE
    THEN 'matched_population_incomplete'
    ELSE 'source_observation_lag_unverified' END,
   'anchorRunId',anchor_run_value,'researchOnly',TRUE,
   'productionPromotionEligible',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 RETURN jsonb_build_object('state','fixed_research_review_ready',
  'policyVersion','m26_selected_m24_fixed_research_review_v1',
  'anchorRunId',anchor_run_value,
  'comparisonDigest',public.canonical_completion_digest(population),
  'scope','northstar_m24_registered_saved_algorithms_only',
  'unsavedOriginCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,
  'researchOnly',TRUE,'productionPromotionEligible',FALSE,
  'forecastServingEnabled',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_fixed_research_review(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_fixed_research_review(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
