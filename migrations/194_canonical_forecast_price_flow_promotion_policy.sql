-- Mission 26 Part 3D: conservative selected-M24 promotion review.
-- This is a decision prerequisite, never automatic promotion or permission
-- to disclose a paid numerical forecast.
CREATE FUNCTION public.canonical_forecast_price_flow_promotion_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,anchor_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reviewed JSONB; population JSONB; item JSONB;
 start_at TIMESTAMPTZ; day_index INTEGER;
 actual_amount NUMERIC; base_error NUMERIC; candidate_error NUMERIC;
 base_reference NUMERIC:=0; candidate_reference NUMERIC:=0;
 base_later NUMERIC:=0; candidate_later NUMERIC:=0;
 worse_days INTEGER:=0; seen_days INTEGER[]:=ARRAY[]::INTEGER[];
 amount_pattern CONSTANT TEXT:='^(0|[1-9][0-9]{0,14})\.[0-9]{2}$';
 policy_version CONSTANT TEXT:='m26_selected_m24_promotion_policy_v1';
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    anchor_run_value IS NULL THEN
  RAISE EXCEPTION 'Promotion review request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 reviewed:=public.canonical_forecast_price_flow_fixed_research_review(
  org,actor,role_value,session_value,anchor_run_value);
 IF reviewed->>'state' IS DISTINCT FROM 'fixed_research_review_ready' THEN
  RETURN jsonb_build_object('state','promotion_review_unavailable',
   'reason','source_or_cohort_incomplete','policyVersion',policy_version,
   'productionPromotionEligible',FALSE,'forecastServingEnabled',FALSE,
   'realForecastEligible',FALSE);
 END IF;
 population:=public.canonical_forecast_price_flow_matched_population_at_anchor(
  org,actor,role_value,session_value,anchor_run_value);
 IF population->>'state' IS DISTINCT FROM 'matched_population_observed' OR
    public.canonical_completion_digest(population) IS DISTINCT FROM
      reviewed->>'comparisonDigest' OR
    population->>'completeRegisteredPopulation' IS DISTINCT FROM 'true' OR
    population->>'sourceEventDiversityVerified' IS DISTINCT FROM 'true' OR
    (population->>'distinctSourceEventDays')::INTEGER<>60 OR
    jsonb_array_length(population->'items')<>60 THEN
  RETURN jsonb_build_object('state','promotion_review_unavailable',
   'reason','matched_evidence_changed','policyVersion',policy_version,
   'productionPromotionEligible',FALSE,'forecastServingEnabled',FALSE,
   'realForecastEligible',FALSE);
 END IF;
 start_at:=(population->>'windowStart')::timestamptz;
 FOR item IN SELECT value FROM jsonb_array_elements(population->'items') LOOP
  IF item->>'state' IS DISTINCT FROM 'matched_algorithms_observed' OR
     item->>'actualPairStatus' IS DISTINCT FROM 'paired' OR
     item->'baseOutput'->>'calculationVersion' IS DISTINCT FROM
       'm26_price_flow_carry_forward_v1' OR
     item->'candidateOutput'->>'calculationVersion' IS DISTINCT FROM
       'm26_price_flow_zero_baseline_v1' OR
     item->'baseActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
     item->'candidateActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
     item->'baseActual'->>'amount' IS DISTINCT FROM
       item->'candidateActual'->>'amount' OR
     item->'baseOutput'->'unit' IS DISTINCT FROM
       item->'candidateOutput'->'unit' OR
     (item->'baseActual'->>'amount' ~ amount_pattern) IS DISTINCT FROM TRUE OR
     (item->'baseOutput'->'value'->>'amount' ~ amount_pattern) IS DISTINCT FROM TRUE OR
     (item->'candidateOutput'->'value'->>'amount' ~ amount_pattern) IS DISTINCT FROM TRUE THEN
   RETURN jsonb_build_object('state','promotion_review_unavailable',
    'reason','matched_amount_unverified','policyVersion',policy_version,
    'productionPromotionEligible',FALSE,'forecastServingEnabled',FALSE,
    'realForecastEligible',FALSE);
  END IF;
  day_index:=floor(extract(epoch FROM
   ((item->>'horizonStart')::timestamptz-start_at))/86400)::integer;
  IF day_index<0 OR day_index>=60 OR day_index=ANY(seen_days) OR
     (item->>'horizonStart')::timestamptz<>
       start_at+day_index*INTERVAL '1 day' THEN
   RETURN jsonb_build_object('state','promotion_review_unavailable',
    'reason','held_out_window_unverified','policyVersion',policy_version,
    'productionPromotionEligible',FALSE,'forecastServingEnabled',FALSE,
    'realForecastEligible',FALSE);
  END IF;
  seen_days:=array_append(seen_days,day_index);
  actual_amount:=(item->'baseActual'->>'amount')::numeric;
  base_error:=abs((item->'baseOutput'->'value'->>'amount')::numeric-actual_amount);
  candidate_error:=abs((item->'candidateOutput'->'value'->>'amount')::numeric-actual_amount);
  IF candidate_error>base_error THEN worse_days:=worse_days+1; END IF;
  IF day_index<30 THEN
   base_reference:=base_reference+base_error;
   candidate_reference:=candidate_reference+candidate_error;
  ELSE
   base_later:=base_later+base_error;
   candidate_later:=candidate_later+candidate_error;
  END IF;
 END LOOP;
 IF cardinality(seen_days)<>60 THEN
  RETURN jsonb_build_object('state','promotion_review_unavailable',
   'reason','held_out_window_unverified','policyVersion',policy_version,
   'productionPromotionEligible',FALSE,'forecastServingEnabled',FALSE,
   'realForecastEligible',FALSE);
 END IF;
 -- The policy demands complete comparable evidence and names downside;
 -- it does not set a universal error threshold or choose a winner. An
 -- owner must explicitly review the directional tradeoff before a switch.
 RETURN jsonb_build_object('state','promotion_review_ready',
  'policyVersion',policy_version,'anchorRunId',anchor_run_value,
  'contextScope','northstar_m24_approved_price_flow_only',
  'comparisonDigest',reviewed->>'comparisonDigest',
  'reviewDigest',public.canonical_completion_digest(jsonb_build_object(
   'policyVersion',policy_version,'comparisonDigest',
    reviewed->>'comparisonDigest','referenceDirection',
    CASE WHEN candidate_reference<base_reference THEN 'candidate_lower_error'
     WHEN candidate_reference>base_reference THEN 'candidate_higher_error'
     ELSE 'equal_absolute_error' END,
   'laterDirection',CASE WHEN candidate_later<base_later THEN
    'candidate_lower_error' WHEN candidate_later>base_later THEN
    'candidate_higher_error' ELSE 'equal_absolute_error' END,
   'candidateWorseDays',worse_days)),
  'referenceDirection',CASE WHEN candidate_reference<base_reference THEN
    'candidate_lower_error' WHEN candidate_reference>base_reference THEN
    'candidate_higher_error' ELSE 'equal_absolute_error' END,
  'laterDirection',CASE WHEN candidate_later<base_later THEN
    'candidate_lower_error' WHEN candidate_later>base_later THEN
    'candidate_higher_error' ELSE 'equal_absolute_error' END,
  'candidateWorseDays',worse_days,
  'productionPromotionEligible',FALSE,'humanDecisionRequired',TRUE,
  'forecastServingEnabled',FALSE,'realForecastEligible',FALSE,
  'wholeBusinessCoverageVerified',FALSE,
  'unsavedOriginCoverageVerified',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_promotion_review(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_promotion_review(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
