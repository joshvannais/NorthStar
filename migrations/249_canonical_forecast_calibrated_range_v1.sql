-- Mission 26 Part 9B: expose the authenticated calibrated-range boundary
-- without manufacturing a probability distribution. The only currently
-- compatible runtime subject is Part 9A's exact deterministic Retell baseline;
-- no complete saved-prediction inventory, quantile policy, held-out outcomes,
-- or reviewed calibration evaluation exists for that target.

CREATE FUNCTION public.canonical_forecast_calibrated_range_v1_unavailable(
 baseline JSONB,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE baseline_current BOOLEAN:=baseline->>'state'='current';
 baseline_identity JSONB;requirements_value JSONB;assessment_digest TEXT;
BEGIN
 requirements_value:=jsonb_build_object(
  'completeEligibleOriginInventory',jsonb_build_object(
   'state','unavailable','reason','complete_saved_prediction_inventory_not_available',
   'inventoryDigest',NULL,'totalCount',NULL,'issuedCount',NULL,
   'unavailableCount',NULL,'unpairedCount',NULL,'correctedCount',NULL,
   'revokedCount',NULL,'normalizationFailedCount',NULL,
   'denominatorCategories',jsonb_build_array('issued','unavailable','unpaired',
    'corrected','revoked','normalization_failed')),
  'preOutcomeChronology',jsonb_build_object(
   'state','unavailable','reason','pre_outcome_prediction_chronology_not_available',
   'verified',FALSE,'latestPredictionIssuedAt',NULL,'earliestOutcomeFinalizedAt',NULL),
  'comparableFinalizedOutcomes',jsonb_build_object(
   'state','unavailable','reason','comparable_finalized_outcomes_not_available',
   'outcomeFinalityPolicyVersion',NULL,'outcomeFinalityPolicyDigest',NULL,
   'pairedCount',NULL,'unpairedCount',NULL,'correctedCount',NULL,
   'revokedCount',NULL),
  'reviewedCalibrationPolicy',jsonb_build_object(
   'state','unavailable','reason','contractor_calibration_policy_not_available',
   'policyVersion',NULL,'policyDigest',NULL,'sufficiencyRule',NULL,
   'independenceRule',NULL,'concentrationRule',NULL,'acceptableErrorRule',NULL),
  'versionedQuantilePolicy',jsonb_build_object(
   'state','unavailable','reason','versioned_quantile_policy_not_available',
   'policyVersion',NULL,'policyDigest',NULL,'nominalCoverage',NULL,
   'quantileDefinition',NULL,'p10Definition',NULL,'p50Definition',NULL,
   'p90Definition',NULL),
  'heldOutEvaluation',jsonb_build_object(
   'state','unavailable','reason','held_out_calibration_evaluation_not_available',
   'evaluationPolicyVersion',NULL,'evaluationPolicyDigest',NULL,
   'evaluationDigest',NULL,'evaluationCurrentnessDigest',NULL,'evaluatedAt',NULL,
   'trainingOriginPeriods',NULL,'heldOutOriginPeriods',NULL,'pairedCount',NULL,
   'exclusions',jsonb_build_object('unavailable',NULL,'unpaired',NULL,
    'corrected',NULL,'revoked',NULL,'normalizationFailed',NULL),
   'nominalCoverage',NULL,'empiricalCoverage',NULL,
   'quantileScores',NULL,'recency',NULL,'drift',NULL,'materialDownside',NULL),
  'existingDescriptiveEvidence',jsonb_build_object(
   'state','inapplicable','targetKey','pipeline.approved_estimates',
   'requestedTargetKey','demand.inbound_leads','usableForCalibration',FALSE,
   'reason','different_target_and_point_only_descriptive_evidence'));

 IF baseline_current THEN
  baseline_identity:=jsonb_build_object(
   'target',baseline->'target','unit',baseline->'unit','horizon',baseline->'horizon',
   'scope',jsonb_build_object('sourceScope',baseline#>>'{target,sourceScope}',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKeys','[]'::jsonb),
   'profile',baseline#>'{sourceSnapshot,profile}',
   'sourceAsOf',baseline#>>'{sourceSnapshot,sourceAsOf}',
   'sourceSnapshotDigest',baseline#>>'{digests,input}',
   'sourceReceiptDigest',baseline#>>'{digests,receipt}',
   'baselineDigest',baseline#>>'{digests,baseline}',
   'configurationDigest',baseline#>>'{digests,configuration}',
   'algorithm',baseline#>'{provenance,algorithm}');
  assessment_digest:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-calibrated-range-assessment-v1',
   'originId',baseline->>'originId','baselineIdentity',baseline_identity,
   'requirements',requirements_value));
 ELSE
  baseline_identity:=NULL;assessment_digest:=NULL;
 END IF;

 RETURN jsonb_build_object(
  'version','m26-calibrated-range-assessment-v1','state','unavailable',
  'reason',reason_value,'originId',(baseline->>'originId')::uuid,
  'assessedAt',baseline->>'checkedAt',
  'baselineIdentity',baseline_identity,
  'range',jsonb_build_object('state','unavailable','reason',reason_value,
   'p10',NULL,'p50',NULL,'p90',NULL,'nominalCentralCoverage',NULL,
   'empiricalCalibrationClaimed',FALSE),
  'distribution',jsonb_build_object('state','unavailable','reason',reason_value,
   'family',NULL,'parameters',NULL,'distributionDigest',NULL),
  'requirements',requirements_value,
  'currentness',jsonb_build_object('baselineCurrent',baseline_current,
   'evidenceCurrent',FALSE,'refreshRequired',TRUE,
   'correctionOrRevocationApplied',NOT baseline_current),
  'digests',jsonb_build_object('assessment',assessment_digest,
   'completeOriginInventory',NULL,'calibrationPolicy',NULL,
   'quantilePolicy',NULL,'heldOutEvaluation',NULL,'backtest',NULL),
  'sourceAuthenticated',baseline_current,
  'researchOnly',TRUE,'realForecastEligible',FALSE,
  'probabilityDistributionIssued',FALSE,'calibratedRangeIssued',FALSE,
  'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE)
 ;
END
$$;

CREATE FUNCTION public.canonical_forecast_calibrated_range_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE baseline JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    origin_value IS NULL OR role_value IS NULL OR
    role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Calibrated range access restricted' USING ERRCODE='42501';
 END IF;
 baseline:=public.canonical_forecast_deterministic_baseline_v1_read(
  org,actor,role_value,session_value,origin_value);
 IF baseline IS NULL THEN RETURN NULL;END IF;
 IF baseline->>'state'<>'current' THEN
  RETURN public.canonical_forecast_calibrated_range_v1_unavailable(
   baseline,'deterministic_baseline_not_current');
 END IF;
 IF baseline->>'version'<>'m26-deterministic-baseline-v1' OR
    baseline#>>'{target,key}'<>'demand.inbound_leads' OR
    baseline#>>'{target,definitionVersion}'<>'v1' OR
    baseline#>>'{target,sourceScope}'<>'retell_only_tenant_all' OR
    baseline#>>'{unit,key}'<>'count' OR baseline#>'{unit,currency}'<>'null'::jsonb OR
    baseline#>>'{configuration,algorithmId}'<>'retell_three_complete_month_mean' OR
    baseline#>>'{configuration,algorithmVersion}'<>'m26-retell-three-month-mean-v2' OR
    baseline#>>'{configuration,horizonGrain}'<>'business_local_month' OR
    baseline#>>'{sourceSnapshot,state}'<>'complete_as_of' OR
    baseline#>>'{sourceSnapshot,completeAsOf}'<>'true' OR
    baseline#>>'{sourceSnapshot,hasMore}'<>'false' OR
    baseline->>'sourceAuthenticated'<>'true' OR
    baseline->>'researchOnly'<>'true' OR
    baseline->>'realForecastEligible'<>'false' OR
    baseline->>'paidNumericServing'<>'false' OR
    baseline->>'probabilityIssued'<>'false' OR
    baseline->>'calibratedRangeIssued'<>'false' OR
    baseline#>>'{evaluation,state}'<>'unavailable' THEN
  RAISE EXCEPTION 'Calibrated range subject changed' USING ERRCODE='40001';
 END IF;
 RETURN public.canonical_forecast_calibrated_range_v1_unavailable(
  baseline,'calibration_evidence_not_established');
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_calibrated_range_v1_unavailable(
 JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_calibrated_range_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_calibrated_range_v1_unavailable(jsonb,text) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_calibrated_range_v1_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
