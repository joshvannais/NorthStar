-- Mission 26 Part 3D additive correction: bind complete same-origin
-- candidate-versus-current descriptive metrics and an explicit human-review
-- policy verdict into every immutable governance review and selection.
-- Migration 218 remains immutable; old reviews fail currentness after install.
CREATE FUNCTION public.canonical_forecast_complete_window_governance_evidence_v3(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value JSONB; measurement JSONB; population JSONB;
 saved public.canonical_forecast_complete_window_evaluations_v2%ROWTYPE;
 statistical_method JSONB; registration RECORD;
 evidence_value JSONB; expected_base_ids JSONB; observed_base_ids JSONB;
 expected_all_ids JSONB; observed_all_ids JSONB;
 run_value UUID; population_item JSONB; comparison_value JSONB;
 actual_amount NUMERIC; base_error NUMERIC; candidate_error NUMERIC;
 base_absolute_error NUMERIC:=0; candidate_absolute_error NUMERIC:=0;
 candidate_better_count INTEGER:=0; candidate_worse_count INTEGER:=0;
 candidate_equal_count INTEGER:=0;
 candidate_pair_count INTEGER; candidate_paired_count INTEGER;
 candidate_partial_count INTEGER; candidate_missing_actual_count INTEGER;
 candidate_revoked_count INTEGER; candidate_unavailable_count INTEGER;
 amount_pattern CONSTANT TEXT:='^(0|[1-9][0-9]{0,14})\.[0-9]{2}$';
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    evaluation_value IS NULL THEN
  RAISE EXCEPTION 'Complete-window governance review invalid'
   USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 current_value:=public.canonical_forecast_complete_window_evaluation_v2_read(
  org,actor,role_value,session_value,evaluation_value);
 IF current_value->>'state'<>'complete_window_evaluation_available' THEN
  RETURN jsonb_build_object('state','complete_window_governance_unavailable',
   'reason',COALESCE(current_value->>'reason','evaluation_not_found'),
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'realForecastEligible',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 SELECT * INTO saved
 FROM public.canonical_forecast_complete_window_evaluations_v2
 WHERE organization_id=org AND id=evaluation_value;
 IF saved.id IS NULL OR saved.evidence_digest IS DISTINCT FROM
    public.canonical_completion_digest(saved.evidence) THEN
  RETURN jsonb_build_object('state','complete_window_governance_unavailable',
   'reason','evaluation_receipt_invalid','internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 measurement:=public.canonical_forecast_complete_window_measurement_v2(
  org,actor,role_value,session_value,evaluation_value);
 IF measurement->>'state'<>'complete_window_measurement_available' OR
    measurement->'measurement'->>'organizationId' IS DISTINCT FROM org::text OR
    measurement->'measurement'->>'evaluationId' IS DISTINCT FROM
      evaluation_value::text OR
    measurement->'measurement'->>'digest' IS NULL OR
    measurement->'measurement'->>'digest'!~'^[a-f0-9]{64}$' THEN
  RETURN jsonb_build_object('state','complete_window_governance_unavailable',
   'reason','tenant_bound_measurement_unavailable','internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 population:=public.canonical_forecast_price_flow_matched_population(
  org,actor,role_value,session_value,TRUE);
 IF population->>'state'<>'matched_population_observed' OR
    jsonb_typeof(population->'selectedRunIds')<>'array' OR
    jsonb_array_length(population->'selectedRunIds') NOT BETWEEN 2 AND 200 THEN
  RETURN jsonb_build_object('state','complete_window_governance_unavailable',
   'reason','complete_matched_governance_evidence_unavailable',
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'realForecastEligible',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 -- The initial population read holds the saved-origin inventory fence. Lock
 -- every base and candidate actual generation in deterministic order, then
 -- rebuild the population so neither review capture nor selection currentness
 -- can digest a candidate outcome that is committing concurrently.
 FOR run_value IN
  SELECT value::uuid FROM jsonb_array_elements_text(
   population->'selectedRunIds') value ORDER BY value::uuid
 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-flow-actual:'||org::text||':'||run_value::text,0)) THEN
   RAISE EXCEPTION 'Complete-window governance actual busy'
    USING ERRCODE='55P03';
  END IF;
 END LOOP;
 population:=public.canonical_forecast_price_flow_matched_population(
  org,actor,role_value,session_value,TRUE);
 statistical_method:=public.canonical_forecast_price_flow_method_eligibility(
  org,actor,role_value,session_value,
  (saved.evidence->>'anchorRunId')::uuid,'statistical');
 SELECT version,dependency_closure_digest INTO registration
 FROM public.canonical_forecast_complete_window_governance_methods_v2
 WHERE version='m26_complete_window_deterministic_closure_v2';
 SELECT COALESCE(jsonb_agg(entry->>'runId' ORDER BY entry->>'runId'),'[]'::jsonb)
 INTO expected_base_ids FROM jsonb_array_elements(saved.evidence->'origins') entry
 WHERE entry->>'eligibility'='matching_context';
 SELECT COALESCE(jsonb_agg(entry->>'runId' ORDER BY entry->>'runId'),'[]'::jsonb)
 INTO expected_all_ids FROM jsonb_array_elements(saved.evidence->'origins') entry;
 SELECT COALESCE(jsonb_agg(elem.value->>'baseRunId' ORDER BY elem.value->>'baseRunId'),'[]'::jsonb)
 INTO observed_base_ids FROM jsonb_array_elements(population->'items') AS elem(value)
 WHERE elem.value ? 'baseRunId';
 SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb)
 INTO observed_all_ids FROM jsonb_array_elements_text(
  population->'selectedRunIds') value;
 SELECT count(*),
  count(*) FILTER(WHERE elem.value->>'actualPairStatus'='paired'),
  count(*) FILTER(WHERE elem.value->>'actualPairStatus'='partial'),
  count(*) FILTER(WHERE elem.value->>'actualPairStatus'='missing'),
  count(*) FILTER(WHERE elem.value->>'actualPairStatus'='revoked'),
  count(*) FILTER(WHERE elem.value->>'actualPairStatus'='unavailable')
 INTO candidate_pair_count,candidate_paired_count,candidate_partial_count,
  candidate_missing_actual_count,candidate_revoked_count,
  candidate_unavailable_count
 FROM jsonb_array_elements(population->'items') AS elem(value)
 WHERE elem.value->>'state'='matched_algorithms_observed';
 IF population->>'state'<>'matched_population_observed' OR
    statistical_method->>'state'<>'method_unavailable' OR
    registration.version IS NULL OR
    registration.dependency_closure_digest IS NULL OR
    registration.dependency_closure_digest IS DISTINCT FROM
      public.canonical_forecast_price_flow_method_closure_digest() OR
    population->>'anchorRunId' IS DISTINCT FROM saved.evidence->>'anchorRunId' OR
    population->>'windowStart' IS DISTINCT FROM saved.evidence->>'windowStart' OR
    population->>'windowEnd' IS DISTINCT FROM saved.evidence->>'windowEnd' OR
    (population->>'storedBaseCount')::integer IS DISTINCT FROM
      (saved.evidence->>'matchingContextCount')::integer OR
    (population->>'matchingBaseCount')::integer IS DISTINCT FROM
      (saved.evidence->>'matchingContextCount')::integer OR
    (population->>'candidateMissingCount')::integer<>0 OR
    (population->>'candidateDuplicateCount')::integer<>0 OR
    (population->>'orphanCandidateCount')::integer<>0 OR
    expected_base_ids IS DISTINCT FROM observed_base_ids OR
    expected_all_ids IS DISTINCT FROM observed_all_ids OR
    candidate_pair_count IS DISTINCT FROM
      (saved.evidence->>'matchingContextCount')::integer OR
    candidate_paired_count IS DISTINCT FROM candidate_pair_count OR
    candidate_partial_count<>0 OR candidate_missing_actual_count<>0 OR
    candidate_revoked_count<>0 OR candidate_unavailable_count<>0 THEN
  RETURN jsonb_build_object('state','complete_window_governance_unavailable',
   'reason','complete_matched_governance_evidence_unavailable',
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'realForecastEligible',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 FOR population_item IN SELECT value FROM jsonb_array_elements(population->'items') LOOP
  IF population_item->>'state' IS DISTINCT FROM 'matched_algorithms_observed' OR
     population_item->>'actualPairStatus' IS DISTINCT FROM 'paired' OR
     population_item->'baseActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
     population_item->'candidateActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
     population_item->'baseActual'->>'amount' IS DISTINCT FROM
       population_item->'candidateActual'->>'amount' OR
     population_item->'baseActual'->>'sourceDigest' IS DISTINCT FROM
       population_item->'candidateActual'->>'sourceDigest' OR
     population_item->'baseOutput'->>'calculationVersion' IS DISTINCT FROM
       'm26_price_flow_carry_forward_v1' OR
     population_item->'candidateOutput'->>'calculationVersion' IS DISTINCT FROM
       'm26_price_flow_zero_baseline_v1' OR
     population_item->'baseOutput'->'unit' IS DISTINCT FROM population_item->'candidateOutput'->'unit' OR
     (population_item->'baseActual'->>'amount' ~ amount_pattern) IS DISTINCT FROM TRUE OR
     (population_item->'baseOutput'->'value'->>'amount' ~ amount_pattern) IS DISTINCT FROM TRUE OR
     (population_item->'candidateOutput'->'value'->>'amount' ~ amount_pattern) IS DISTINCT FROM TRUE THEN
   RETURN jsonb_build_object('state','complete_window_governance_unavailable',
    'reason','candidate_comparison_metrics_unavailable',
    'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
    'realForecastEligible',FALSE,'paidNumericServing',FALSE,
    'forecastServingEnabled',FALSE);
  END IF;
  actual_amount:=(population_item->'baseActual'->>'amount')::numeric;
  base_error:=abs((population_item->'baseOutput'->'value'->>'amount')::numeric-actual_amount);
  candidate_error:=abs((population_item->'candidateOutput'->'value'->>'amount')::numeric-actual_amount);
  base_absolute_error:=base_absolute_error+base_error;
  candidate_absolute_error:=candidate_absolute_error+candidate_error;
  IF candidate_error<base_error THEN
   candidate_better_count:=candidate_better_count+1;
  ELSIF candidate_error>base_error THEN
   candidate_worse_count:=candidate_worse_count+1;
  ELSE candidate_equal_count:=candidate_equal_count+1;
  END IF;
 END LOOP;
 IF candidate_pair_count<=0 OR
    candidate_better_count+candidate_worse_count+candidate_equal_count<>
      candidate_pair_count THEN
  RETURN jsonb_build_object('state','complete_window_governance_unavailable',
   'reason','candidate_comparison_metrics_unavailable',
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'realForecastEligible',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 comparison_value:=jsonb_build_object(
  'version','m26-complete-window-candidate-comparison-v3',
  'state','descriptive_comparison_available',
  'pairedOriginCount',candidate_pair_count,
  'baseMeanAbsoluteError',to_char(
    round(base_absolute_error/candidate_pair_count,2),'FM999999999999990.00'),
  'candidateMeanAbsoluteError',to_char(
    round(candidate_absolute_error/candidate_pair_count,2),'FM999999999999990.00'),
  'direction',CASE WHEN candidate_absolute_error<base_absolute_error THEN
    'candidate_lower_error' WHEN candidate_absolute_error>base_absolute_error THEN
    'candidate_higher_error' ELSE 'equal_absolute_error' END,
  'candidateBetterOriginCount',candidate_better_count,
  'candidateWorseOriginCount',candidate_worse_count,
  'candidateEqualOriginCount',candidate_equal_count,
  'policyVerdict','human_review_required_no_automatic_winner',
  'empiricalFitnessEstablished',FALSE,
  'productionPromotionEligible',FALSE,
  'realForecastEligible',FALSE);
 evidence_value:=jsonb_build_object(
  'version','m26-complete-window-governance-review-v2',
  'organizationId',org,'scope','northstar_m24_registered_saved_origins_only',
  'evaluationId',saved.id,'evaluationRevision',saved.revision,
  'evaluationDigest',saved.evidence_digest,
  'measurementDigest',measurement->'measurement'->>'digest',
  'anchorRunId',saved.evidence->>'anchorRunId',
  'windowStart',saved.evidence->>'windowStart',
  'windowEnd',saved.evidence->>'windowEnd',
  'originInventoryDigest',saved.evidence->>'originInventoryDigest',
  'matchedPopulationDigest',public.canonical_completion_digest(population),
  'comparisonVersion','m26-complete-same-origin-deterministic-review-v3',
  'comparison',comparison_value,
  'comparisonDigest',public.canonical_completion_digest(comparison_value),
  'baseAlgorithmVersion','m26_price_flow_carry_forward_v1',
  'candidateAlgorithmVersion','m26_price_flow_zero_baseline_v1',
  'methodRegistrationVersion',registration.version,
  'methodDependencyClosureDigest',registration.dependency_closure_digest,
  'statisticalMethodState',statistical_method->>'state',
  'statisticalUnavailableReason',statistical_method->>'reason',
  'storedOriginCount',(saved.evidence->>'storedOriginCount')::integer,
  'matchingContextCount',(saved.evidence->>'matchingContextCount')::integer,
  'excludedContextCount',(saved.evidence->>'excludedContextCount')::integer,
  'pairedCount',(saved.evidence->>'pairedCount')::integer,
  'missingCount',(saved.evidence->>'missingCount')::integer,
  'revokedCount',(saved.evidence->>'revokedCount')::integer,
  'excludedCount',(saved.evidence->>'excludedCount')::integer,
  'candidateMissingCount',(population->>'candidateMissingCount')::integer,
  'candidateDuplicateCount',(population->>'candidateDuplicateCount')::integer,
  'orphanCandidateCount',(population->>'orphanCandidateCount')::integer,
  'candidatePairCount',candidate_pair_count,
  'candidatePairedCount',candidate_paired_count,
  'candidatePartialCount',candidate_partial_count,
  'candidateMissingActualCount',candidate_missing_actual_count,
  'candidateRevokedCount',candidate_revoked_count,
  'candidateUnavailableCount',candidate_unavailable_count,
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'realForecastEligible',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'humanDecisionRequired',TRUE,
  'unsavedOriginCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE);
 RETURN jsonb_build_object('state','complete_window_governance_evidence_current',
  'evidence',evidence_value,
  'evidenceDigest',public.canonical_completion_digest(evidence_value));
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_complete_window_governance_review_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_complete_window_governance_reviews_v2%ROWTYPE;
 saved public.canonical_forecast_complete_window_governance_reviews_v2%ROWTYPE;
 current_value JSONB; key_hash TEXT; request_hash TEXT; next_revision INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    evaluation_value IS NULL THEN
  RAISE EXCEPTION 'Complete-window governance capture invalid'
   USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-complete-window-governance-review-request-v2',
  'evaluationId',evaluation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':'||actor::text||':complete-window-governance-review:'||key_hash,0));
 SELECT * INTO prior
 FROM public.canonical_forecast_complete_window_governance_reviews_v2
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Complete-window governance replay changed'
    USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','complete_window_governance_review_saved',
   'reviewId',prior.id,'revision',prior.revision,
   'reviewDigest',prior.evidence_digest,
   'comparisonDigest',prior.evidence->>'comparisonDigest',
   'comparison',prior.evidence->'comparison','replayed',TRUE,
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'realForecastEligible',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 current_value:=public.canonical_forecast_complete_window_governance_evidence_v3(
  org,actor,role_value,session_value,evaluation_value);
 IF current_value->>'state'<>'complete_window_governance_evidence_current' THEN
  RETURN jsonb_build_object('state','complete_window_governance_review_unavailable',
   'reason',COALESCE(current_value->>'reason','governance_evidence_unavailable'),
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'realForecastEligible',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:complete-window-governance-review:'||org::text,0));
 SELECT COALESCE(max(revision),0)+1 INTO next_revision
 FROM public.canonical_forecast_complete_window_governance_reviews_v2
 WHERE organization_id=org;
 INSERT INTO public.canonical_forecast_complete_window_governance_reviews_v2(
  organization_id,revision,evaluation_id,evidence,evidence_digest,
  actor_user_id,auth_session_id,request_key_hash,request_digest)
 VALUES(org,next_revision,evaluation_value,current_value->'evidence',
  current_value->>'evidenceDigest',actor,session_value,key_hash,request_hash)
 RETURNING * INTO saved;
 RETURN jsonb_build_object('state','complete_window_governance_review_saved',
  'reviewId',saved.id,'revision',saved.revision,
  'reviewDigest',saved.evidence_digest,
  'comparisonDigest',saved.evidence->>'comparisonDigest',
  'comparison',saved.evidence->'comparison','replayed',FALSE,
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'realForecastEligible',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_complete_window_governance_review_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,review_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_complete_window_governance_reviews_v2%ROWTYPE;
 current_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    review_value IS NULL THEN
  RAISE EXCEPTION 'Complete-window governance review read invalid'
   USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved
 FROM public.canonical_forecast_complete_window_governance_reviews_v2
 WHERE organization_id=org AND id=review_value;
 IF saved.id IS NULL THEN
  RETURN jsonb_build_object('state','complete_window_governance_review_unavailable',
   'reason','governance_review_not_found','internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 current_value:=public.canonical_forecast_complete_window_governance_evidence_v3(
  org,actor,role_value,session_value,saved.evaluation_id);
 IF current_value->>'state'<>'complete_window_governance_evidence_current' OR
    current_value->>'evidenceDigest' IS DISTINCT FROM saved.evidence_digest THEN
  RETURN jsonb_build_object('state','complete_window_governance_review_stale',
   'reviewId',saved.id,'revision',saved.revision,
   'reason',COALESCE(current_value->>'reason','governance_evidence_changed'),
   'restartRequired',TRUE,
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'realForecastEligible',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);
 END IF;
 RETURN jsonb_build_object('state','complete_window_governance_review_available',
  'reviewId',saved.id,'revision',saved.revision,
  'reviewDigest',saved.evidence_digest,'evaluationId',saved.evaluation_id,
  'baseAlgorithmVersion',saved.evidence->>'baseAlgorithmVersion',
  'candidateAlgorithmVersion',saved.evidence->>'candidateAlgorithmVersion',
  'comparisonDigest',saved.evidence->>'comparisonDigest',
  'comparison',saved.evidence->'comparison',
  'storedOriginCount',(saved.evidence->>'storedOriginCount')::integer,
  'pairedCount',(saved.evidence->>'pairedCount')::integer,
  'missingCount',(saved.evidence->>'missingCount')::integer,
  'revokedCount',(saved.evidence->>'revokedCount')::integer,
  'excludedCount',(saved.evidence->>'excludedCount')::integer,
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'realForecastEligible',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'humanDecisionRequired',TRUE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_complete_window_governance_select_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 review_value UUID,expected_revision INTEGER,action_value TEXT,
 algorithm_value TEXT,reverses_value UUID,reason_value TEXT,
 review_digest_value TEXT,confirmed_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_complete_window_governance_selections_v2%ROWTYPE;
 latest public.canonical_forecast_complete_window_governance_selections_v2%ROWTYPE;
 saved public.canonical_forecast_complete_window_governance_selections_v2%ROWTYPE;
 reviewed JSONB; key_hash TEXT; request_hash TEXT; receipt_value JSONB;
 next_revision INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    review_value IS NULL OR expected_revision IS NULL OR expected_revision<0 OR
    action_value NOT IN ('promote','rollback') OR
    algorithm_value NOT IN ('m26_price_flow_carry_forward_v1',
      'm26_price_flow_zero_baseline_v1') OR
    reason_value IS NULL OR length(reason_value) NOT BETWEEN 16 AND 500 OR
    review_digest_value IS NULL OR review_digest_value!~'^[a-f0-9]{64}$' OR
    confirmed_value IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Complete-window governance selection invalid'
   USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF (action_value='promote' AND
     (algorithm_value<>'m26_price_flow_zero_baseline_v1' OR reverses_value IS NOT NULL)) OR
    (action_value='rollback' AND
     (algorithm_value<>'m26_price_flow_carry_forward_v1' OR reverses_value IS NULL)) THEN
  RAISE EXCEPTION 'Complete-window governance transition invalid'
   USING ERRCODE='22023';
 END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-complete-window-governance-selection-request-v2',
  'reviewId',review_value,'expectedRevision',expected_revision,
  'action',action_value,'algorithmVersion',algorithm_value,
  'reversesEventId',reverses_value,'reason',reason_value,
  'reviewDigest',review_digest_value,'confirmed',confirmed_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':'||actor::text||':complete-window-governance-selection:'||key_hash,0));
 SELECT * INTO prior
 FROM public.canonical_forecast_complete_window_governance_selections_v2
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Complete-window governance selection replay changed'
    USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','complete_window_governance_selection_recorded',
   'eventId',prior.id,'revision',prior.revision,'action',prior.action,
   'algorithmVersion',prior.algorithm_version,'receiptDigest',prior.receipt_digest,
   'replayed',TRUE,'internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:complete-window-governance-selection:'||org::text,0));
 SELECT * INTO latest
 FROM public.canonical_forecast_complete_window_governance_selections_v2
 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF COALESCE(latest.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Complete-window governance revision changed'
   USING ERRCODE='23505';
 END IF;
 IF (action_value='promote' AND latest.id IS NOT NULL AND latest.action<>'rollback') OR
    (action_value='rollback' AND
      (latest.id IS NULL OR latest.action<>'promote' OR reverses_value<>latest.id)) THEN
  RAISE EXCEPTION 'Complete-window governance transition changed'
   USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1
  FROM public.canonical_forecast_complete_window_governance_selections_v2
  WHERE organization_id=org AND review_id=review_value) THEN
  RAISE EXCEPTION 'Complete-window governance review already selected'
   USING ERRCODE='23505';
 END IF;
 reviewed:=public.canonical_forecast_complete_window_governance_review_v2_read(
  org,actor,role_value,session_value,review_value);
 IF reviewed->>'state'<>'complete_window_governance_review_available' OR
    reviewed->>'reviewDigest' IS DISTINCT FROM review_digest_value OR
    reviewed->'comparison'->>'state' IS DISTINCT FROM
      'descriptive_comparison_available' OR
    reviewed->>'comparisonDigest' IS NULL OR
    reviewed->>'comparisonDigest'!~'^[a-f0-9]{64}$' THEN
  RETURN jsonb_build_object('state','complete_window_governance_selection_unavailable',
   'reason','governance_review_unavailable','internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 next_revision:=expected_revision+1;
 receipt_value:=jsonb_build_object(
  'version','m26-complete-window-governance-selection-v2',
  'organizationId',org,'revision',next_revision,'reviewId',review_value,
  'reviewDigest',review_digest_value,
  'comparisonDigest',reviewed->>'comparisonDigest','action',action_value,
  'algorithmVersion',algorithm_value,'previousEventId',latest.id,
  'reversedEventId',reverses_value,'reason',reason_value,
  'humanReviewed',TRUE,'internalExperimentOnly',TRUE,
  'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 INSERT INTO public.canonical_forecast_complete_window_governance_selections_v2(
  organization_id,revision,review_id,action,algorithm_version,
  previous_event_id,reversed_event_id,reason,receipt,receipt_digest,
  actor_user_id,auth_session_id,request_key_hash,request_digest)
 VALUES(org,next_revision,review_value,action_value,algorithm_value,
  latest.id,reverses_value,reason_value,receipt_value,
  public.canonical_completion_digest(receipt_value),actor,session_value,
  key_hash,request_hash) RETURNING * INTO saved;
 RETURN jsonb_build_object('state','complete_window_governance_selection_recorded',
  'eventId',saved.id,'revision',saved.revision,'action',saved.action,
  'algorithmVersion',saved.algorithm_version,'receiptDigest',saved.receipt_digest,
  'replayed',FALSE,'internalExperimentOnly',TRUE,
  'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_complete_window_governance_selection_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.canonical_forecast_complete_window_governance_selections_v2%ROWTYPE;
 reviewed JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Complete-window governance selection read invalid'
   USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO latest
 FROM public.canonical_forecast_complete_window_governance_selections_v2
 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF latest.id IS NULL THEN
  RETURN jsonb_build_object('state','complete_window_governance_selection_unavailable',
   'reason','governance_selection_not_found','internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 reviewed:=public.canonical_forecast_complete_window_governance_review_v2_read(
  org,actor,role_value,session_value,latest.review_id);
 IF reviewed->>'state'<>'complete_window_governance_review_available' THEN
  RETURN jsonb_build_object('state','complete_window_governance_selection_unavailable',
   'eventId',latest.id,'revision',latest.revision,
   'reason','governance_review_stale','internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 RETURN jsonb_build_object('state','complete_window_governance_selection_current',
  'eventId',latest.id,'revision',latest.revision,'reviewId',latest.review_id,
  'action',latest.action,'algorithmVersion',latest.algorithm_version,
  'rollbackCurrent',latest.action='rollback','receiptDigest',latest.receipt_digest,
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'realForecastEligible',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_governance_evidence_v3(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_governance_evidence_v3(
  UUID,UUID,TEXT,UUID,UUID) FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_governance_review_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_governance_review_v2_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_governance_select_v2(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,BOOLEAN)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_governance_selection_v2_read(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
