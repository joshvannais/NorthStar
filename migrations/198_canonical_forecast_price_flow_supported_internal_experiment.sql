-- Mission 26 Part 3D: a versioned, source-owned local eligibility decision
-- for the selected-M24 internal experiment. This never releases production
-- promotion, paid numeric serving, or real forecast eligibility.
CREATE FUNCTION public.canonical_forecast_price_flow_supported_experiment_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,anchor_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE compared JSONB; policy_digest TEXT;
 policy_version CONSTANT TEXT:='m26_selected_m24_two_window_internal_experiment_v1';
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    anchor_run_value IS NULL THEN
  RAISE EXCEPTION 'Supported experiment review request invalid'
   USING ERRCODE='22023';
 END IF;
 -- The private comparator checks current actor/tenant permission, the fixed
 -- 60-day source-owned cohort, exact matched outcomes and source corrections
 -- under the tenant source fence. Caller-supplied scores cannot enter here.
 compared:=public.canonical_forecast_price_flow_promotion_review(
  org,actor,role_value,session_value,anchor_run_value);
 IF compared->>'state' IS DISTINCT FROM 'promotion_review_ready' THEN
  RETURN jsonb_build_object('state','internal_experiment_support_unavailable',
   'reason','matched_source_or_outcome_unavailable',
   'policyVersion',policy_version,'internalExperimentSupported',FALSE,
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'humanDecisionRequired',TRUE,'paidNumericServing',FALSE,
   'realForecastEligible',FALSE);
 END IF;
 -- The candidate must strictly reduce absolute error in both independently
 -- comparable halves. This conservative dominance rule has no invented
 -- numerical tolerance and remains bounded to the internal experiment.
 IF compared->>'referenceDirection' IS DISTINCT FROM 'candidate_lower_error' OR
    compared->>'laterDirection' IS DISTINCT FROM 'candidate_lower_error' THEN
  RETURN jsonb_build_object('state','internal_experiment_support_unavailable',
   'reason','candidate_not_better_in_both_windows',
   'policyVersion',policy_version,
   'referenceDirection',compared->>'referenceDirection',
   'laterDirection',compared->>'laterDirection',
   'candidateWorseDays',compared->'candidateWorseDays',
   'internalExperimentSupported',FALSE,'internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,'humanDecisionRequired',TRUE,
   'paidNumericServing',FALSE,'realForecastEligible',FALSE);
 END IF;
 policy_digest:=public.canonical_completion_digest(jsonb_build_object(
  'policyVersion',policy_version,'comparisonDigest',
    compared->>'comparisonDigest','internalReviewDigest',
    compared->>'reviewDigest','referenceDirection',
    compared->>'referenceDirection','laterDirection',
    compared->>'laterDirection','candidateWorseDays',
    compared->'candidateWorseDays'));
 RETURN jsonb_build_object('state','internal_experiment_support_ready',
  'policyVersion',policy_version,'anchorRunId',anchor_run_value,
  'comparisonDigest',compared->>'comparisonDigest',
  'policyDigest',policy_digest,
  'referenceDirection',compared->>'referenceDirection',
  'laterDirection',compared->>'laterDirection',
  'candidateWorseDays',compared->'candidateWorseDays',
  'internalExperimentSupported',TRUE,'internalExperimentOnly',TRUE,
  'productionPromotionEligible',FALSE,'humanDecisionRequired',TRUE,
  'paidNumericServing',FALSE,'realForecastEligible',FALSE,
  'wholeBusinessCoverageVerified',FALSE,
  'statisticalAlgorithmEligible',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_supported_experiment_review(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_supported_experiment_review(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
